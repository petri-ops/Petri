import { Icon } from '@/components/icons/Icon';

/**
 * EditCheckpointDialog — 编辑重发时的 checkpoint 回退选择（BLOCK-244 Q1-REM C5）。
 *
 * 只展示选择与诚实边界；回退/重发由 SimpleChat 调 git.checkpointRollback 后执行。
 * 部分未记录的文件可能无法恢复；回退失败不得静默继续。
 */
export interface EditCheckpointDialogProps {
  open: boolean;
  at?: number | null;
  busy?: boolean;
  error?: string | null;
  onRollback: () => void;
  onResend: () => void;
  onCancel: () => void;
}

function formatAt(at?: number | null): string {
  if (!at || !Number.isFinite(at)) return '本轮';
  try {
    return new Date(at).toLocaleTimeString();
  } catch {
    return '本轮';
  }
}

export function EditCheckpointDialog({
  open,
  at = null,
  busy = false,
  error = null,
  onRollback,
  onResend,
  onCancel,
}: EditCheckpointDialogProps): React.ReactElement | null {
  if (!open) return null;
  return (
    <div className="sc-full-access-overlay" data-testid="edit-checkpoint-dialog">
      <div className="sc-full-access-dialog" role="alertdialog" aria-label="编辑重发与文件回退">
        <div className="sc-full-access-dialog__head">
          <span className="sc-full-access-dialog__icon" aria-hidden="true"><Icon name="restore" size={16} /></span>
          <strong>本轮有文件修改快照</strong>
        </div>
        <p className="sc-full-access-dialog__intro">
          检测到 {formatAt(at)} 的快照。选择「回退并重发」会先恢复本轮开始前的跟踪文件，
          并清理快照后新增的未跟踪文件，再按编辑后的消息重新发送。
        </p>
        <p className="sc-full-access-dialog__risk" data-testid="edit-checkpoint-warning">
          诚实边界：只回退快照内记录的文件；部分未记录/被外部修改的文件可能无法恢复。回退失败时不会静默继续。
        </p>
        {error ? <p className="sc-full-access-dialog__risk" role="alert" data-testid="edit-checkpoint-error">{error}</p> : null}
        <div className="sc-full-access-dialog__actions">
          <button
            type="button"
            className="sc-full-access-dialog__btn sc-full-access-dialog__btn-primary"
            disabled={busy}
            data-testid="edit-checkpoint-rollback"
            onClick={onRollback}
          >
            {busy ? '回退中…' : '回退并重发'}
          </button>
          <button
            type="button"
            className="sc-full-access-dialog__btn"
            disabled={busy}
            data-testid="edit-checkpoint-resend"
            onClick={onResend}
          >
            仅重发
          </button>
          <button
            type="button"
            className="sc-full-access-dialog__btn"
            disabled={busy}
            data-testid="edit-checkpoint-cancel"
            onClick={onCancel}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
