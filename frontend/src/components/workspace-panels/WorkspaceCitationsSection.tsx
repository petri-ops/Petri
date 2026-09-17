import React from 'react';
import type { KnowledgeCitation } from '@/components/copilot/copilotClient';
import sharedStyles from '@/pages/project-workspace.module.css';
import styles from './WorkspaceCitationsSection.module.css';

/**
 * BLOCK-94 / UI-402 — 摘要卡「知识溯源」节：本轮自动召回注入的知识块清单。
 *
 * 回答「这段结论哪来的」：列出注入了哪些文档的哪些块与命中通道。
 * 数据来自 conversationRunStore 的 knowledge_citations 事件投影
 * （会话级存储，生命周期=单次 agent 任务运行，run 终态后仍可见）。
 * 空清单整节不渲染（与既有各节同一模式）。
 */
export function WorkspaceCitationsSection({ citations }: { citations: KnowledgeCitation[] }) {
  if (!citations || citations.length === 0) return null;
  return (
    <section className={sharedStyles.workspacePinnedSummarySection} aria-label="知识溯源">
      <div className={sharedStyles.workspacePinnedSummarySectionHeading}>
        <div className={sharedStyles.workspacePinnedSummarySectionTitle}>知识溯源</div>
        <span className={styles.count}>{citations.length} 块</span>
      </div>
      <ol className={styles.list}>
        {citations.map((citation, index) => {
          const channels = citation.channels;
          const channelLabel =
            channels && channels.vector != null && channels.fts != null
              ? '向量+全文'
              : channels && channels.fts != null
                ? '全文'
                : '向量';
          return (
            <li key={`${citation.docId || 'doc'}_${citation.seq ?? index}`} className={styles.item}>
              <span className={styles.doc}>{citation.docName || citation.docId || '未知文档'}</span>
              {citation.seq != null && <span className={styles.seq}>第 {citation.seq + 1} 块</span>}
              <span className={styles.channel}>{channelLabel}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
