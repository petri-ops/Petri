import React from 'react';
import { Model3DScene } from '@/components/work-surface/Model3DScene';
import { getApiPrefix } from '@/lib/env';
import { getToken } from '@/lib/authClient';
import { workspaceFileUrlFor } from '@/lib/previewFileUtils';
import { dispatchPetriEvent, petriEvents } from '@/lib/events';

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

interface ChatArtifact {
  name: string;
  filename?: string;
  path?: string;
  url?: string;
  sha256?: string;
}

interface ChatArtifactCardProps {
  toolJobId: string;
  /** 惰性：仅在展开时才拉取 /tools/status */
  expanded: boolean;
  projectId?: string | null;
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);
const MODEL_3D_EXTENSIONS = new Set(['.glb', '.gltf']);

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

export function ChatArtifactCard({ toolJobId, expanded, projectId }: ChatArtifactCardProps): React.ReactElement | null {
  const [artifacts, setArtifacts] = React.useState<ChatArtifact[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = React.useState<string | null>(null);
  const [show3D, setShow3D] = React.useState(false);
  const [outDir, setOutDir] = React.useState('');

  React.useEffect(() => {
    if (!expanded || !toolJobId) return;
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

  if (!expanded || !toolJobId) return null;
  if (error) return <div className="chat-artifact-error" style={{ padding: '4px 8px', fontSize: 'var(--petri-font-size-xs, 11px)', color: '#999' }}>产物信息获取失败</div>;
  if (artifacts === null) return <div style={{ padding: '4px 8px', fontSize: 'var(--petri-font-size-xs, 11px)', color: '#888' }}>加载产物…</div>;
  if (artifacts.length === 0) return null;

  // 后端 artifacts.url 是 API 相对路径（/api/workspaces/…），渲染进程在 dev 下
  // 由 Vite(:3000) 承载，直接当 src 会打到 Vite 的 SPA 兜底；统一经 getApiPrefix
  // 拼成绝对地址（与工作区文件预览同一出口，不另立第二套 URL 规则）。
  const fileUrl = (artifact: ChatArtifact): string => {
    if (artifact.path && projectId) return workspaceFileUrlFor(projectId, artifact.path);
    const url = artifact.url || '';
    if (!url) return '';
    if (/^(https?:|blob:|data:)/i.test(url)) return url;
    if (url.startsWith('/api/')) return `${getApiPrefix()}${url.slice(4)}`;
    return url;
  };
  const visibleArtifacts = artifacts.filter((artifact) => Boolean(fileUrl(artifact)));
  if (visibleArtifacts.length === 0) return null;

  const model3dArtifacts = visibleArtifacts.filter((a) => MODEL_3D_EXTENSIONS.has(ext(a.name || a.filename || '')));
  const imageArtifacts = visibleArtifacts.filter((a) => IMAGE_EXTENSIONS.has(ext(a.name || a.filename || '')));
  const otherArtifacts = visibleArtifacts.filter(
    (a) => !MODEL_3D_EXTENSIONS.has(ext(a.name || a.filename || '')) && !IMAGE_EXTENSIONS.has(ext(a.name || a.filename || '')),
  );

  return (
    <div
      data-testid="chat-artifact-card"
      style={{ margin: '4px 0', padding: 8, border: '1px solid rgba(128,152,177,0.25)', borderRadius: 8, background: 'rgba(128,152,177,0.06)' }}
    >
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
            <div key={artifact.name} style={{ height: 220, border: '1px solid rgba(128,152,177,0.2)', borderRadius: 6, overflow: 'hidden' }}>
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

      {/* 渲染图 */}
      {imageArtifacts.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {imageArtifacts.map((artifact) => (
            <img
              key={artifact.name}
              src={fileUrl(artifact)}
              alt={artifact.name}
              style={{ maxWidth: 120, maxHeight: 90, borderRadius: 4, cursor: 'pointer', border: '1px solid rgba(128,152,177,0.2)' }}
              onClick={() => setZoomedImage(fileUrl(artifact))}
              loading="lazy"
            />
          ))}
        </div>
      )}

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
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
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
      <Model3DScene
        view={null}
        viewAngle="iso"
        modelUrl={url}
        modelFormat="glb"
      />
    </div>
  );
}
