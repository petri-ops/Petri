import React from 'react';
import type { AgentTaskTodoItem } from '@/components/copilot/copilotClient';
import sharedStyles from '@/pages/project-workspace.module.css';
import styles from './WorkspaceTodoSection.module.css';

/**
 * BLOCK-97 / UI-398 — 摘要卡「任务清单」节：agent todo_write 清单快照渲染。
 *
 * 编号条目 + 做完一条勾一条 + 进行中高亮；数据来自 conversationRunStore 的
 * task_todo 事件投影（整单快照，生命周期=单次 agent 任务运行）。
 * 渲染逻辑独立子组件承载，WorkspaceSummaryCard 不推高行数棘轮基线。
 * 空清单整节不渲染（与既有各节同一模式）。
 */
export function WorkspaceTodoSection({ items }: { items: AgentTaskTodoItem[] }) {
  if (!items || items.length === 0) return null;
  const completed = items.filter((item) => item.status === 'completed').length;
  const allDone = completed === items.length;
  return (
    <section className={sharedStyles.workspacePinnedSummarySection} aria-label="任务清单">
      <div className={sharedStyles.workspacePinnedSummarySectionHeading}>
        <div className={sharedStyles.workspacePinnedSummarySectionTitle}>任务清单</div>
        <span className={styles.progress} data-done={allDone ? 'true' : 'false'}>
          {completed}/{items.length}
        </span>
      </div>
      <ol className={styles.list}>
        {items.map((item, index) => (
          <li key={item.id || index} className={styles.item} data-status={item.status}>
            <span className={styles.check} aria-hidden="true">
              {item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '▸' : '○'}
            </span>
            <span className={styles.index}>{index + 1}.</span>
            <span className={styles.content}>{item.content}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
