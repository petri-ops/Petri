/**
 * LineageStrip — BLOCK-127（G0-BIO BIO-3 P1）结果血缘条。
 *
 * 数据=result_workflow_graphs 权威图的只读投影（fetchResultLineage）：
 * 祖先链上游在前、当前节点末尾。单节点链（无上下游）不渲染——不拿
 * 「只有自己」冒充血缘；无持久化图（lineage=null）同样不渲染。
 * 节点点击走 projectOpenResult 事件（UI-455 打开链修复后无会话 job 亦可达）。
 */

import React from 'react';
import { fetchResultLineage, type ResultLineage } from './resultStudioClient';
import { findCatalogTool, useToolCatalog } from '@/lib/tool-catalog';
import { dispatchPetriEvent, petriEvents } from '@/lib/events';
import styles from './LineageStrip.module.css';

export function LineageStrip({ projectId, jobId, onPinArtifact }: {
  projectId: string | null;
  jobId: string;
  /** BLOCK-140 P1 — 「钉住」次级动作（悬停小钮）：把该节点 job 的产物钉入副栏对比。 */
  onPinArtifact?: (request: { projectId: string | null; toolJobId: string }) => void;
}): React.ReactElement | null {
  const [lineage, setLineage] = React.useState<ResultLineage | null>(null);
  const [failed, setFailed] = React.useState(false);
  const { tools: catalogTools } = useToolCatalog();

  React.useEffect(() => {
    let cancelled = false;
    setLineage(null);
    setFailed(false);
    fetchResultLineage(jobId, projectId)
      .then((response) => { if (!cancelled && response.lineage) setLineage(response.lineage); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [jobId, projectId]);

  if (failed) return null;
  if (!lineage || lineage.chain.length <= 1) return null;

  return (
    <nav className={styles.lineage} aria-label="结果血缘链" data-downstream={lineage.downstreamCount}>
      <span className={styles.caption}>血缘</span>
      {lineage.chain.map((node, index) => {
        const label = node.toolId ? (findCatalogTool(catalogTools, node.toolId)?.title || node.toolId) : node.toolJobId;
        return (
          <React.Fragment key={node.toolJobId}>
            {index > 0 && <span className={styles.arrow} aria-hidden>→</span>}
            <span className={styles.nodeWrap}>
              <button
                type="button"
                className={styles.node}
                aria-current={node.isCurrent ? 'true' : undefined}
                title={node.isCurrent ? `当前结果（直接下游 ${lineage.downstreamCount} 个）` : `打开上游 ${node.toolId || node.toolJobId}`}
                onClick={() => dispatchPetriEvent(petriEvents.projectOpenResult, { toolJobId: node.toolJobId, projectId })}
              >
                {label}
              </button>
              {/* BLOCK-140 P1 — 钉住次级动作：悬停/聚焦显现，主点击打开链不变 */}
              {onPinArtifact && (
                <button
                  type="button"
                  className={styles.nodePin}
                  aria-label={`钉住 ${label}`}
                  title="把该结果的产物钉入副栏对比"
                  onClick={() => onPinArtifact({ projectId, toolJobId: node.toolJobId })}
                >
                  钉住
                </button>
              )}
            </span>
          </React.Fragment>
        );
      })}
    </nav>
  );
}
