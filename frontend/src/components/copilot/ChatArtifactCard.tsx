import React from 'react';
import { Model3DScene } from '@/components/work-surface/Model3DScene';
import { getApiPrefix } from '@/lib/env';
import { getToken } from '@/lib/authClient';

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
}

export interface ChatArtifactCardProps {
  toolJobId: string;
  /** 惰性：仅在展开时才拉取 /tools/status */
  expanded: boolean;
  projectId?: string | null;
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);
const MODEL_3D_EXTENSIONS = new Set(['.glb', '.gltf']);
const STEP_EXTENSIONS = new Set(['.step', '.stp']);

function ext(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

async function fetchToolArtifacts(jobId: string): Promise<{ ok: boolean; artifacts: ChatArtifact[] }> {
  const token = getToken();
  const response = await fetch(`${getApiPrefix()}/tools/status/${encodeURIComponent(jobId)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => ({}));
  const result = data?.result || data;
  return { ok: response.ok === true, artifacts: Array.isArray(result?.artifacts) ? result.artifacts : [] };
}

export function ChatArtifactCard({ toolJobId, expanded, projectId }: ChatArtifactCardProps): React.ReactElement | null {
  const [artifacts, setArtifacts] = React.useState<ChatArtifact[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = React.useState<string | null>(null);
  const [show3D, setShow3D] = React.useState(false);

  React.useEffect(() => {
    if (!expanded || !toolJobId) return;
    let cancelled = false;
    fetchToolArtifacts(toolJobId).then((result) => {
      if (!cancelled) {
        if (result.ok) setArtifacts(result.artifacts);
        else setError('tool_status_fetch_failed');
      }
    }).catch(() => { if (!cancelled) setError('tool_status_fetch_failed'); });
    return () => { cancelled = true; };
  }, [expanded, toolJobId]);

  if (!expanded || !toolJobId) return null;
  if (error) return <div className="chat-artifact-error" style={{ padding: '4px 8px', fontSize: 11, color: '#999' }}>产物信息获取失败</div>;
  if (artifacts === null) return <div style={{ padding: '4px 8px', fontSize: 11, color: '#888' }}>加载产物…</div>;
  if (artifacts.length === 0) return null;

  const token = getToken();
  const fileUrl = (artifact: ChatArtifact): string => {
    if (artifact.url) return artifact.url;
    if (artifact.path && projectId) {
      return `${getApiPrefix()}/workspaces/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(artifact.path)}`;
    }
    return '';
  };

  const model3dArtifacts = artifacts.filter((a) => MODEL_3D_EXTENSIONS.has(ext(a.name || a.filename || '')));
  const imageArtifacts = artifacts.filter((a) => IMAGE_EXTENSIONS.has(ext(a.name || a.filename || '')));
  const otherArtifacts = artifacts.filter(
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
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary, #888)' }}>3D 预览</span>
            <button
              type="button"
              style={{ fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent, #3b82f6)' }}
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
          <span style={{ fontSize: 11 }}>{artifact.name}</span>
          <a
            href={fileUrl(artifact)}
            download={artifact.name}
            style={{ fontSize: 11, color: 'var(--accent, #3b82f6)', textDecoration: 'none' }}
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
  const token = getToken();
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

export default ChatArtifactCard;
