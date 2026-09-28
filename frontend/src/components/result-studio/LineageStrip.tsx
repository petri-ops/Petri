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
import { dispatchGewuEvent, gewuEvents } from '@/lib/events';
import styles from './LineageStrip.module.css';

export function LineageStrip({ projectId, jobId }: {
  projectId: string | null;
  jobId: string;
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
      {lineage.chain.map((node, index) => (
        <React.Fragment key={node.toolJobId}>
          {index > 0 && <span className={styles.arrow} aria-hidden>→</span>}
          <button
            type="button"
            className={styles.node}
            aria-current={node.isCurrent ? 'true' : undefined}
            title={node.isCurrent ? `当前结果（直接下游 ${lineage.downstreamCount} 个）` : `打开上游 ${node.toolId || node.toolJobId}`}
            onClick={() => dispatchGewuEvent(gewuEvents.projectOpenResult, { toolJobId: node.toolJobId, projectId })}
          >
            {node.toolId ? (findCatalogTool(catalogTools, node.toolId)?.title || node.toolId) : node.toolJobId}
          </button>
        </React.Fragment>
      ))}
    </nav>
  );
}
