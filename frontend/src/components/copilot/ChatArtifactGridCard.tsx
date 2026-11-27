import React from 'react';
import { ChatArtifactCard } from './ChatArtifactCard';
import type { GeneratedArtifactGroup } from '@/lib/generatedArtifactGroups';

/** 视频/3D 播放器需要宽度，独占整行；图片/HTML 走自适应多列。 */
const WIDE_TILE_RE = /\.(mp4|webm|mov|glb|gltf)$/i;

/**
 * item83 追加④：同一轮产物聚合到一个网格卡（多行多列自适应），不同轮次各卡。
 * 单项行为复用 ChatArtifactCard（放大/工具条/blob 播放/沙箱/元信息），不复制交互逻辑。
 */
export function ChatArtifactGridCard({
  groups,
  projectId,
}: {
  groups: GeneratedArtifactGroup[];
  projectId?: string | null;
}): React.ReactElement | null {
  if (!groups.length) return null;
  return (
    <>
      {groups.map((group) => (
        <section
          key={`round:${group.iteration}`}
          data-testid="chat-artifact-grid-card"
          style={{
            margin: '4px 0',
            padding: 8,
            border: '1px solid var(--petri-border-card, var(--petri-border))',
            borderRadius: 8,
            background: 'var(--petri-bg-subtle)',
          }}
        >
          <div
            data-testid="chat-artifact-grid-header"
            style={{ fontSize: 'var(--petri-font-size-sm)', color: 'var(--petri-text-secondary)', marginBottom: 6 }}
          >
            {`本轮产物 ${group.artifacts.length} 项`}
          </div>
          <div
            data-testid="chat-artifact-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
              gap: 'var(--petri-space-3)',
            }}
          >
            {group.artifacts.map((artifact, index) => {
              const wide = WIDE_TILE_RE.test(artifact.name) || /video|model/i.test(artifact.mime || '');
              const tileStyle: React.CSSProperties = { minWidth: 0, gridColumn: wide ? '1 / -1' : undefined };
              return (
                <div key={`${artifact.name}:${index}`} data-testid="chat-artifact-grid-tile" style={tileStyle}>
                  <div
                    data-testid={`chat-artifact-grid-tile-${wide ? 'video' : 'image'}`}
                    style={{ gridColumn: wide ? '1 / -1' : undefined }}
                  >
                    <ChatArtifactCard
                      toolJobId=""
                      expanded
                      projectId={projectId}
                      durationMs={group.durationMs}
                      artifacts={[artifact]}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
