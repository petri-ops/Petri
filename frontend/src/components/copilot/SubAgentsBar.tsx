// ============================================================
// SubAgentsBar — BLOCK-49 加映二：会话内子 agent 活动条。
//
// 数据源：conversationRunStore 的 subTaskRuns（用户 runInBackground +
// 模型 spawn_agent 双源登记；child_finished 终态落账）。
// 行内操作：中断（运行中，stopSubAgentTask 走既有 cancel REST）+
// 详情窗（BLOCK-59 P4 agent 详情窗弹出）。克制的单行折叠条。
// ============================================================
import React, { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import {
  stopSubAgentTask,
  useSubAgentTasksForConversation,
  type ConversationRunSnapshot,
} from '@/components/copilot/conversationRunStore';
import { getBridge } from '@/lib/desktopBridge';
import styles from './sub-agents-bar.module.css';

const STATUS_LABEL: Record<ConversationRunSnapshot['status'], string> = {
  running: '运行中',
  done: '已完成',
  error: '失败',
  stopped: '已停止',
};

function head(text: string): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > 56 ? `${t.slice(0, 56)}…` : t || '（无描述）';
}

export function SubAgentsBar({
  conversationId,
}: {
  conversationId: string | null | undefined;
}): React.ReactElement | null {
  const tasks = useSubAgentTasksForConversation(conversationId);
  const [open, setOpen] = useState(false);
  const windowManager = getBridge('windowManager');

  if (!conversationId || tasks.length === 0) return null;
  const running = tasks.filter((t) => t.status === 'running').length;

  const openDetail = (taskId: string) => {
    void windowManager?.popOut('agent', taskId);
  };

  return (
    <div className={styles.bar}>
      <button
        type="button"
        className={styles.summary}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="子 agent 活动列表"
      >
        <span className={styles.dot} data-status={running > 0 ? 'running' : 'done'} />
        <span>
          子 agent {running > 0 ? `${running} 运行中 · ` : ''}{tasks.length} 个
        </span>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
      </button>
      {open && (
        <div className={styles.list}>
          {tasks.map((task) => (
            <div key={task.taskId} className={styles.row} data-status={task.status}>
              <span className={styles.rowDot} data-status={task.status} />
              <span className={styles.rowText} title={task.userContent}>
                {head(task.userContent)}
              </span>
              <span className={styles.rowStatus} data-status={task.status}>
                {STATUS_LABEL[task.status]}
              </span>
              {windowManager && (
                <button
                  type="button"
                  className={styles.rowBtn}
                  onClick={() => void windowManager.popOut('agent', task.taskId || '')}
                  title="弹出 agent 详情窗（实时工作流 + 摘要）"
                  aria-label="打开详情窗"
                >
                  <Icon name="eye" size={12} />
                </button>
              )}
              {task.status === 'running' && (
                <button
                  type="button"
                  className={`${styles.rowBtn} ${styles.rowBtnDanger}`}
                  onClick={() => stopSubAgentTask(task.taskId || '')}
                  title="中断该子 agent（在下一个取消检查点让出）"
                  aria-label="中断子 agent"
                >
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
