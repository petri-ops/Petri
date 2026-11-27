import React from 'react';

/**
 * item88 第二波：子任务卡内的审批请求面（设计稿 §4.3 审批档）。
 * 纯展示 + onDecide 回调；决策落 approval-request-store 由既有 task-actions 路由负责，
 * 不在会话卡区渲染、不抢主对话话筒。
 */

type ApprovalScope = 'once' | 'task' | 'always';

const SCOPES: ReadonlyArray<{ id: ApprovalScope; label: string }> = [
  { id: 'once', label: '仅此一次' },
  { id: 'task', label: '本任务内' },
  { id: 'always', label: '始终允许' },
];

export function WorkbenchApprovalCard({
  taskId,
  title,
  onDecide,
}: {
  taskId: string;
  title: string;
  onDecide: (scope: ApprovalScope) => void;
}): React.ReactElement {
  return (
    <div className="sc-full-access-dialog" role="alertdialog" aria-label="工作台审批" data-task-id={taskId}>
      <div className="sc-full-access-dialog__head"><strong>{title}</strong></div>
      <div style={{ display: 'flex', gap: 8 }}>
        {SCOPES.map((scope) => (
          <button
            key={scope.id}
            type="button"
            data-testid="wb-approval-scope"
            onClick={() => onDecide(scope.id)}
          >
            {scope.label}
          </button>
        ))}
      </div>
    </div>
  );
}
