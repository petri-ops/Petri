import React from 'react';
import { HtmlViewer } from '@/components/viewers/HtmlViewer';
// BLOCK-511 S4.2 — 3D 场景改走懒加载（同 Model3DSurface:46 的 lazy 包装），首屏不静态引入 three
const Model3DScene = React.lazy(() =>
  import('@/components/work-surface/Model3DScene').then((m) => ({ default: m.Model3DScene }))
);
import { getApiPrefix } from '@/lib/env';
import { getToken } from '@/lib/authClient';
import { workspaceFileUrlFor } from '@/lib/previewFileUtils';
import { dispatchPetriEvent, petriEvents } from '@/lib/events';
import {
  copyGeneratedImage,
  downloadGeneratedArtifact,
  openGeneratedArtifact,
  showGeneratedArtifactFolder,
} from '@/lib/generatedArtifactActions';

/**
 * ChatArtifactCard — BLOCK-322 产品洞察（用户 2026-10-30）：聊天时间线是一等交互面。
 *
 * 通用产物展示层——任何工具结果有 artifacts 的都在聊天内渲染为交互卡：
 *   - .glb/.gltf → 内嵌可旋转 3D 预览（Model3DScene 复用）
 *   - .png/.jpg  → 内嵌渲染图（可点击放大）
 *   - 其他       → 下载链接 + 文件图标
 * 数据源：/api/tools/status/:jobId → result.artifacts（含 url/path/sha256）。
 * 不是 3D 专用补丁——是所有产出工具的通用展示能力。
 */

export interface ChatArtifact {
  name: string;
  filename?: string;
  path?: string;
  url?: string;
  sha256?: string;
  /** item 83 — 生成产物描述符元信息（落盘真值，展示不替代） */
  mime?: string;
  source?: {
    provider?: string;
    model?: string;
    taskId?: string;
    prompt?: string;
    seed?: number | null;
    mode?: string;
    status?: string;
  };
}

interface ChatArtifactCardProps {
  toolJobId: string;
  /** 惰性：仅在展开时才拉取 /tools/status */
  expanded: boolean;
  projectId?: string | null;
  /** UI-713 — 聊天主链默认轻量摘要；详情点击后才展开产物明细。 */
  lightweight?: boolean;
  /** item 83 — 工具活动耗时（来自 toolActivity.durationMs），缺值不展示 */
  durationMs?: number | null;
  /** item 83 补：generate.* 活动无 toolJobId，直接传 resultData 归一化的产物 */
  artifacts?: ChatArtifact[] | null;
}

/** item 83 补：agent 工具 generate.* 的 resultData 是 artifact 描述符（单/数组），
 *  没有 tool_job，故不能直接走 /tools/status；在此归一化为卡片产物（只接受控读面 URL）。 */
export function generatedArtifactsFromResult(resultData: unknown): ChatArtifact[] | null {
  if (!resultData || typeof resultData !== 'object') return null;
  const items = Array.isArray(resultData) ? resultData : [resultData];
  const artifacts: ChatArtifact[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const d = raw as Record<string, unknown>;
    // item83 第二轮：产物主路径是当前项目工作区读面；/api/generated/ 仅留历史兼容。
    if (typeof d.path !== 'string' || typeof d.url !== 'string'
        || !(d.url.startsWith('/api/generated/') || d.url.startsWith('/api/workspaces/'))) continue;
    artifacts.push({
      name: d.path.split(/[\\/]/).pop() || 'artifact',
      path: d.path,
      url: d.url,
      sha256: typeof d.sha256 === 'string' ? d.sha256 : undefined,
      mime: typeof d.mime === 'string' ? d.mime : undefined,
      source: d.source && typeof d.source === 'object' ? d.source : undefined,
    });
  }
  return artifacts.length ? artifacts : null;
}

function generatedApiUrl(artifact: ChatArtifact): string {
  return typeof artifact.url === 'string' && artifact.url.startsWith('/api/')
    ? `${getApiPrefix()}${artifact.url.slice(4)}`
    : '';
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);
const MODEL_3D_EXTENSIONS = new Set(['.glb', '.gltf']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov']);
const HTML_EXTENSIONS = new Set(['.html', '.htm']);

// item 83 UX：默认缩略上限（320–400 区间）；缩放档位只记本次会话（模块内、有界），不落盘。
const IMAGE_THUMB_MAX_HEIGHT = 360;
const IMAGE_THUMB_MAX_WIDTH = 480;
const ZOOM_LEVELS = [0.75, 1, 1.5, 2];
const zoomPreferences = new Map<string, number>();
function zoomKeyFor(projectId: string, artifact: ChatArtifact): string {
  return `${projectId}:${artifact.url || artifact.path || artifact.name}`;
}
function zoomIndexFor(key: string): number {
  return zoomPreferences.get(key) ?? 1;
}
function rememberZoom(key: string, index: number): void {
  zoomPreferences.set(key, index);
  if (zoomPreferences.size > 64) {
    const oldest = zoomPreferences.keys().next().value;
    if (oldest !== undefined) zoomPreferences.delete(oldest);
  }
}

const ACTION_BUTTON_STYLE: React.CSSProperties = {
  fontSize: 'var(--petri-font-size-xs, 11px)',
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  color: 'var(--accent, #3b82f6)',
};

function ext(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

interface ChatArtifactPayload {
  ok: boolean;
  artifacts: ChatArtifact[];
  /** 导出 run 目录（工作区相对路径）；用于定位本次导出的 scene.json 快照。 */
  outDir: string;
}

const artifactCache = new Map<string, ChatArtifactPayload>();

async function fetchToolArtifacts(jobId: string): Promise<ChatArtifactPayload> {
  const cached = artifactCache.get(jobId);
  if (cached) return cached;
  const token = getToken();
  const response = await fetch(`${getApiPrefix()}/tools/status/${encodeURIComponent(jobId)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(10_000),
  });
  const data: unknown = await response.json().catch(() => ({}));
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const result = record.result && typeof record.result === 'object'
    ? record.result as Record<string, unknown>
    : record;
  const payload: ChatArtifactPayload = {
    ok: response.ok === true,
    artifacts: Array.isArray(result.artifacts) ? result.artifacts as ChatArtifact[] : [],
    outDir: typeof result.outDir === 'string' ? result.outDir : '',
  };
  if (payload.ok) artifactCache.set(jobId, payload);
  return payload;
}

function sceneSnapshotPath(outDir: string, artifact: ChatArtifact): string {
  if (outDir) return `${outDir.replace(/\/+$/, '')}/scene.json`;
  const artifactPath = artifact.path || '';
  const slash = artifactPath.lastIndexOf('/');
  return slash >= 0 ? `${artifactPath.slice(0, slash)}/scene.json` : '';
}

export function ChatArtifactCard({ toolJobId, expanded, projectId, lightweight = false, durationMs, artifacts: directArtifacts }: ChatArtifactCardProps): React.ReactElement | null {
  const [artifacts, setArtifacts] = React.useState<ChatArtifact[] | null>(directArtifacts || null);
  const [error, setError] = React.useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = React.useState<string | null>(null);
  const [show3D, setShow3D] = React.useState(false);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [outDir, setOutDir] = React.useState('');

  React.useEffect(() => {
    // 直挂产物已在 useState 初始化；此处不再同步 setState（避免 effect 级联渲染）。
    if (directArtifacts || !expanded || !toolJobId) return;
    let cancelled = false;
    fetchToolArtifacts(toolJobId).then((result) => {
      if (!cancelled) {
        if (result.ok) {
          setArtifacts(result.artifacts);
          setOutDir(result.outDir);
        } else {
          setError('tool_status_fetch_failed');
        }
      }
    }).catch(() => { if (!cancelled) setError('tool_status_fetch_failed'); });
    return () => { cancelled = true; };
  }, [expanded, toolJobId]);

  // item 83 补：跨源 media 会被 Chromium 的 URL safety check 拒（见 csp-config.js:44-47），
  // 与 VideoResultViewer 同方案——fetch 字节后建 blob:（渲染进程自建，不回扩网络面）。
  const [videoBlobs, setVideoBlobs] = React.useState<Record<string, string>>({});
  const [activeImageIndex, setActiveImageIndex] = React.useState(0);
  const [, setZoomRevision] = React.useState(0);
  React.useEffect(() => {
    if (!expanded || !artifacts) return;
    let cancelled = false;
    const created: string[] = [];
    void (async () => {
      for (const artifact of artifacts) {
        if (!VIDEO_EXTENSIONS.has(ext(artifact.name || ''))) continue;
        const apiUrl = generatedApiUrl(artifact);
        if (!apiUrl) continue;
        try {
          const token = getToken();
          const response = await fetch(apiUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
          if (!response.ok) continue;
          const buffer = await response.arrayBuffer();
          if (cancelled || buffer.byteLength > 64 * 1024 * 1024) continue;
          const blobUrl = URL.createObjectURL(
            new Blob([buffer], { type: response.headers.get('content-type') || 'video/mp4' }),
          );
          created.push(blobUrl);
          if (!cancelled) setVideoBlobs((prev) => ({ ...prev, [artifact.name]: blobUrl }));
        } catch { /* 读取失败保留原文件出口，不伪造可播 */ }
      }
    })();
    return () => { cancelled = true; for (const url of created) URL.revokeObjectURL(url); };
  }, [expanded, artifacts]);

  if (!expanded || (!toolJobId && !directArtifacts)) return null;
  if (error) return <div className="chat-artifact-error" style={{ padding: '4px 8px', fontSize: 'var(--petri-font-size-xs, 11px)', color: '#999' }}>产物信息获取失败</div>;
  if (artifacts === null) return <div style={{ padding: '4px 8px', fontSize: 'var(--petri-font-size-xs, 11px)', color: '#888' }}>加载产物…</div>;
  if (artifacts.length === 0) return null;

  // 后端 artifacts.url 是 API 相对路径（/api/workspaces/…），渲染进程在 dev 下
  // 由 Vite(:3000) 承载，直接当 src 会打到 Vite 的 SPA 兜底；统一经 getApiPrefix
  // 拼成绝对地址（与工作区文件预览同一出口，不另立第二套 URL 规则）。
  const fileUrl = (artifact: ChatArtifact): string => {
    // item 83：generate.* 产物落在 dataDir，受控读面 URL 是唯一可展示地址；
    // 优先于 workspace path 分支，其余产物保持原逻辑（零回归）。
    const generated = generatedApiUrl(artifact);
    if (generated) return generated;
    if (artifact.path && projectId) return workspaceFileUrlFor(projectId, artifact.path);
    const url = artifact.url || '';
    if (!url) return '';
    if (/^(https?:|blob:|data:)/i.test(url)) return url;
    if (url.startsWith('/api/')) return `${getApiPrefix()}${url.slice(4)}`;
    return url;
  };
  const visibleArtifacts = artifacts.filter((artifact) => Boolean(fileUrl(artifact)));
  if (visibleArtifacts.length === 0) return null;

  if (lightweight && !detailOpen) {
    return (
      <div
        data-testid="chat-artifact-summary"
        style={{ margin: '4px 0', padding: '6px 8px', border: `1px solid var(--petri-border-card, var(--petri-border))`, borderRadius: 8, background: 'var(--petri-bg-subtle)', display: 'flex', alignItems: 'center', gap: 10 }}
      >
        <span style={{ fontSize: 'var(--petri-font-size-sm)', color: 'var(--petri-text-secondary)' }}>
          {`已生成 ${visibleArtifacts.length} 个产物 · ${visibleArtifacts[0]?.name || '结果'}`}
        </span>
        <button
          type="button"
          data-testid="chat-artifact-open-detail"
          style={ACTION_BUTTON_STYLE}
          onClick={() => setDetailOpen(true)}
        >
          查看结果详情
        </button>
      </div>
    );
  }

  const model3dArtifacts = visibleArtifacts.filter((a) => MODEL_3D_EXTENSIONS.has(ext(a.name || a.filename || '')));
  const imageArtifacts = visibleArtifacts.filter((a) => IMAGE_EXTENSIONS.has(ext(a.name || a.filename || '')));
  const videoArtifacts = visibleArtifacts.filter((a) => VIDEO_EXTENSIONS.has(ext(a.name || a.filename || '')));
  const htmlArtifacts = visibleArtifacts.filter((a) => HTML_EXTENSIONS.has(ext(a.name || a.filename || '')));
  const otherArtifacts = visibleArtifacts.filter(
    (a) => !MODEL_3D_EXTENSIONS.has(ext(a.name || a.filename || ''))
      && !IMAGE_EXTENSIONS.has(ext(a.name || a.filename || ''))
      && !VIDEO_EXTENSIONS.has(ext(a.name || a.filename || ''))
      && !HTML_EXTENSIONS.has(ext(a.name || a.filename || '')),
  );

  return (
    <div
      data-testid="chat-artifact-card"
      style={{ margin: '4px 0', padding: 8, border: '1px solid rgba(128,152,177,0.25)', borderRadius: 8, background: 'rgba(128,152,177,0.06)' }}
    >
      {lightweight ? (
        <button type="button" data-testid="chat-artifact-close-detail" style={ACTION_BUTTON_STYLE} onClick={() => setDetailOpen(false)}>
          收起结果详情
        </button>
      ) : null}
      {/* 3D 预览 */}
      {model3dArtifacts.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 'var(--petri-font-size-xs, 11px)', fontWeight: 600, color: 'var(--text-secondary, #888)' }}>3D 预览</span>
            <button
              type="button"
              style={{ fontSize: 'var(--petri-font-size-xs, 11px)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent, #3b82f6)' }}
              onClick={() => setShow3D((v) => !v)}
            >
              {show3D ? '收起' : '展开 3D 预览'}
            </button>
          </div>
          {show3D && model3dArtifacts.map((artifact) => (
            <div key={artifact.name} data-testid="chat-artifact-3d-preview" style={{ height: 220, border: '1px solid rgba(128,152,177,0.2)', borderRadius: 6, overflow: 'hidden' }}>
              <Model3DSceneWrapper url={fileUrl(artifact)} />
            </div>
          ))}
          {/* 产物落地动作：查看走结果面（artifact 级），工作台打开走本次导出的 scene.json 快照 */}
          {model3dArtifacts.map((artifact) => {
            const scenePath = sceneSnapshotPath(outDir, artifact);
            const canOpenWorkbench = Boolean(projectId && scenePath);
            return (
              <div
                key={`actions:${artifact.name || artifact.path || artifact.url}`}
                data-testid="chat-artifact-3d-actions"
                style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 'var(--petri-font-size-xs, 11px)', marginTop: 6 }}
              >
                <span style={{ color: 'var(--text-secondary, #888)' }}>{artifact.name}</span>
                <button
                  type="button"
                  style={ACTION_BUTTON_STYLE}
                  onClick={() => dispatchPetriEvent(petriEvents.projectOpenArtifact, {
                    jobId: toolJobId,
                    artifactName: artifact.name,
                    projectId: projectId || undefined,
                  })}
                >
                  在结果中查看
                </button>
                <button
                  type="button"
                  style={{
                    ...ACTION_BUTTON_STYLE,
                    color: canOpenWorkbench ? 'var(--accent, #3b82f6)' : 'var(--text-secondary, #888)',
                    cursor: canOpenWorkbench ? 'pointer' : 'not-allowed',
                  }}
                  disabled={!canOpenWorkbench}
                  title={!projectId
                    ? '需要已打开的项目工作区'
                    : !scenePath
                      ? '找不到本次导出 run 的场景快照（scene.json）'
                      : `在右栏「3D 模型」打开本次导出的场景快照：${scenePath}`}
                  onClick={() => {
                    if (!projectId || !scenePath) return;
                    dispatchPetriEvent(petriEvents.model3dOpen, {
                      projectId,
                      scenePath,
                      jobId: toolJobId,
                      label: artifact.name,
                    });
                  }}
                >
                  在 3D 工作台打开
                </button>
                <a href={fileUrl(artifact)} download={artifact.name} style={{ ...ACTION_BUTTON_STYLE, textDecoration: 'none' }}>
                  下载
                </a>
              </div>
            );
          })}
        </div>
      )}

      {/* BLOCK-509 视频结果：轻量摘要后点击展开才内联播放，避免聊天主链被媒体撑满 */}
      {videoArtifacts.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {videoArtifacts.map((artifact) => (
            <div key={`video:${artifact.name || artifact.path || artifact.url}`} style={{ marginBottom: 6 }}>
              <video
                data-testid="chat-artifact-video"
                controls
                preload="metadata"
                src={videoBlobs[artifact.name] || fileUrl(artifact)}
                style={{ display: 'block', width: '100%', maxWidth: 640, maxHeight: 360, borderRadius: 6, background: 'var(--petri-bg-subtle)' }}
              />
              <a
                data-testid="chat-artifact-video-download"
                href={fileUrl(artifact)}
                download={artifact.name}
                style={ACTION_BUTTON_STYLE}
              >
                下载视频 · {artifact.name}
              </a>
            </div>
          ))}
        </div>
      )}

      {/* item 83 HTML 产物：会话内沙箱预览——仅 allow-scripts，保持 opaque origin，
          与工作区 HtmlViewer 同安全边界；不可给 allow-same-origin（会逃逸隔离）。 */}
      {htmlArtifacts.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {htmlArtifacts.map((artifact) => (
            <div key={`html:${artifact.name}`} style={{ marginBottom: 6 }}>
              <HtmlViewer
                src={fileUrl(artifact)}
                title={artifact.name}
                sandbox="allow-scripts"
                testId="chat-artifact-html"
              />
              <a
                data-testid="chat-artifact-html-download"
                href={fileUrl(artifact)}
                download={artifact.name}
                style={ACTION_BUTTON_STYLE}
              >
                下载 HTML · {artifact.name}
              </a>
            </div>
          ))}
        </div>
      )}

      {/* item 83 元信息：model/provider/taskId 来自 artifact.source，耗时来自工具活动；
          费用未写入 ai_usage（generate.* 未记账），缺值不展示、不伪造 0。 */}
      {(() => {
        const sources = visibleArtifacts
          .map((a) => a.source)
          .filter((s): s is NonNullable<ChatArtifact['source']> => Boolean(s));
        const models = [...new Set(sources.map((s) => s.model).filter((v): v is string => Boolean(v)))];
        const providers = [...new Set(sources.map((s) => s.provider).filter((v): v is string => Boolean(v)))];
        const taskIds = [...new Set(sources.map((s) => s.taskId).filter((v): v is string => Boolean(v)))];
        if (!models.length && !providers.length && !taskIds.length && !durationMs) return null;
        return (
          <div data-testid="chat-artifact-meta" style={{ fontSize: 'var(--petri-font-size-xs)', color: 'var(--petri-text-secondary)', marginBottom: 8 }}>
            {providers.map((v) => <span key={`p:${v}`}>provider {v} · </span>)}
            {models.map((v) => <span key={`m:${v}`}>模型 {v} · </span>)}
            {taskIds.map((v) => <span key={`t:${v}`}>task {v} · </span>)}
            {durationMs ? <span>耗时 {Math.round(durationMs / 1000)}s</span> : null}
          </div>
        );
      })()}

      {/* 渲染图：默认缩略 + 编号 tabs（多结果只显示当前一张，不堆一长串）+ 会话内缩放 */}
      {imageArtifacts.length > 0 && (() => {
        const safeIndex = Math.min(activeImageIndex, imageArtifacts.length - 1);
        const active = imageArtifacts[safeIndex];
        const key = zoomKeyFor(projectId || '', active);
        const zoomIndex = zoomIndexFor(key);
        const scale = ZOOM_LEVELS[zoomIndex] ?? 1;
        const changeZoom = (delta: number) => {
          rememberZoom(key, Math.max(0, Math.min(ZOOM_LEVELS.length - 1, zoomIndex + delta)));
          setZoomRevision((v) => v + 1);
        };
        return (
          <div style={{ marginBottom: 8 }}>
            {imageArtifacts.length > 1 && (
              <div data-testid="chat-artifact-tabs" style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                {imageArtifacts.map((artifact, index) => (
                  <button
                    key={`tab:${artifact.name}`}
                    type="button"
                    data-testid="chat-artifact-tab"
                    aria-pressed={index === safeIndex}
                    style={ACTION_BUTTON_STYLE}
                    onClick={() => setActiveImageIndex(index)}
                  >
                    {`${index + 1}/${imageArtifacts.length}`}
                  </button>
                ))}
              </div>
            )}
            <div
              data-testid="chat-artifact-image-frame"
              style={{ display: 'flex', justifyContent: 'center', width: '100%' }}
            >
              <img
                data-testid="chat-artifact-image"
                src={fileUrl(active)}
                alt={active.name}
                style={{
                  maxWidth: Math.round(IMAGE_THUMB_MAX_WIDTH * scale),
                  maxHeight: Math.round(IMAGE_THUMB_MAX_HEIGHT * scale),
                  borderRadius: 4,
                  cursor: 'pointer',
                  border: '1px solid var(--petri-border)',
                }}
                onClick={() => setZoomedImage(fileUrl(active))}
                loading="lazy"
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button type="button" data-testid="chat-artifact-zoom-out" style={ACTION_BUTTON_STYLE} onClick={() => changeZoom(-1)}>-</button>
              <button
                type="button"
                data-testid="chat-artifact-zoom-toggle"
                style={ACTION_BUTTON_STYLE}
                onClick={() => setZoomedImage((prev) => (prev ? null : fileUrl(active)))}
              >
                {zoomedImage ? '还原' : '放大'}
              </button>
              <button type="button" data-testid="chat-artifact-zoom-in" style={ACTION_BUTTON_STYLE} onClick={() => changeZoom(1)}>+</button>
            </div>
            {/* item 83 打磨批：只做查看/带出/复制的常规操作；不提供裁剪/标注/滤镜等编辑入口。 */}
            <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              <button
                type="button"
                data-testid="chat-artifact-copy-image"
                style={ACTION_BUTTON_STYLE}
                onClick={() => { void copyGeneratedImage('image', active.name); }}
              >
                复制图片
              </button>
              <button
                type="button"
                data-testid="chat-artifact-export"
                style={ACTION_BUTTON_STYLE}
                onClick={() => { void downloadGeneratedArtifact(fileUrl(active), active.name); }}
              >
                另存为
              </button>
              <button
                type="button"
                data-testid="chat-artifact-open-folder"
                style={ACTION_BUTTON_STYLE}
                onClick={() => { void showGeneratedArtifactFolder(active.path || ''); }}
              >
                打开所在文件夹
              </button>
              <button
                type="button"
                data-testid="chat-artifact-open-system"
                style={ACTION_BUTTON_STYLE}
                onClick={() => { void openGeneratedArtifact(active.path || ''); }}
              >
                系统查看器打开
              </button>
            </div>
          </div>
        );
      })()}

      {/* 其他产物下载 */}
      {otherArtifacts.map((artifact) => (
        <div key={artifact.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 'var(--petri-font-size-xs, 11px)' }}>{artifact.name}</span>
          <a
            href={fileUrl(artifact)}
            download={artifact.name}
            style={{ fontSize: 'var(--petri-font-size-xs, 11px)', color: 'var(--accent, #3b82f6)', textDecoration: 'none' }}
          >
            下载
          </a>
        </div>
      ))}

      {/* 图片放大灯箱 */}
      {zoomedImage && (
        <div
          data-testid="chat-artifact-lightbox"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 'var(--petri-z-lightbox)' }}
          onClick={() => setZoomedImage(null)}
        >
          <img src={zoomedImage} alt="放大预览" style={{ maxWidth: '90%', maxHeight: '90%' }} />
        </div>
      )}
    </div>
  );
}

function Model3DSceneWrapper({ url }: { url: string }) {
  return (
    <div style={{ height: 220 }}>
      <React.Suspense fallback={<div />}>
        <Model3DScene
          view={null}
          viewAngle="iso"
          modelUrl={url}
          modelFormat="glb"
        />
      </React.Suspense>
    </div>
  );
}
