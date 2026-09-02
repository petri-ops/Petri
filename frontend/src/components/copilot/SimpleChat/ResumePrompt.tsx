import React, { useCallback, useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { previewAgentTaskResume, type ResumeLastModelCall } from '../copilotClient';

/**
 * BLOCK-38 P2 / UI-275 — 「继续执行」入口。
 *
 * 仅服务中断（后端启动清扫标记 interrupted_at）的任务显示；点击后拉取
 * GET resume 只读预览，弹出轻量确认层（中断时间 + 中断前最后一次模型
 * 调用摘要 + 执行进度摘要），确认后由父组件调 resume 端点续跑。
 * 非中断失败任务不走此入口（诚实区分，走既有 retry 链路）。
 */

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString();
}

function formatFinishReason(reason: string | null | undefined): string {
  if (!reason) return '—';
  const labels: Record<string, string> = {
    stop: '完成回复',
    tool_calls: '准备调用工具',
    length: '长度截断',
    content_filter: '内容过滤',
  };
  return labels[reason] || reason;
}

interface ResumePreviewData {
  resumable: boolean;
  interruptedAt: string | null;
  lastModelCall: ResumeLastModelCall | null;
  progressDigest: string | null;
}

export function ResumePrompt({
  taskId,
  onConfirm,
}: {
  taskId: string;
  onConfirm: () => Promise<void>;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ResumePreviewData | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const openPopover = useCallback(async () => {
    setOpen(true);
    setConfirmError(null);
    if (preview || loadingPreview) return;
    setLoadingPreview(true);
    setPreviewError(null);
    try {
      setPreview(await previewAgentTaskResume(taskId));
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingPreview(false);
    }
  }, [taskId, preview, loadingPreview]);

  const handleConfirm = useCallback(async () => {
    setConfirming(true);
    setConfirmError(null);
    try {
      await onConfirm();
      setOpen(false);
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirming(false);
    }
  }, [onConfirm]);

  const last = preview?.lastModelCall || null;

  return (
    <div className="sc-resume-wrap" ref={wrapRef}>
      <button
        type="button"
        className="sc-resume-btn"
        onClick={() => void openPopover()}
        title="上次执行因服务重启中断，可从既有进度继续"
      >
        <Icon name="play" size={13} />
        继续执行
      </button>

      {open && (
        <div className="sc-resume-popover" role="dialog" aria-label="继续执行确认">
          <div className="sc-resume-popover-title">继续执行 · 中断恢复</div>

          <div className="sc-resume-row">
            <span className="sc-resume-label">中断时间</span>
            <span className="sc-resume-value">{formatTime(preview?.interruptedAt)}</span>
          </div>

          <div className="sc-resume-section">
            <div className="sc-resume-label">中断前最后状态</div>
            {loadingPreview && <div className="sc-resume-value">正在读取取证摘要…</div>}
            {previewError && <div className="sc-resume-error">{previewError}</div>}
            {!loadingPreview && !previewError && (
              <>
                {last ? (
                  <>
                    <div className="sc-resume-row">
                      <span className="sc-resume-label">模型</span>
                      <span className="sc-resume-value">{last.model || '—'}</span>
                    </div>
                    <div className="sc-resume-row">
                      <span className="sc-resume-label">调用时间</span>
                      <span className="sc-resume-value">{formatTime(last.ts)}</span>
                    </div>
                    <div className="sc-resume-row">
                      <span className="sc-resume-label">结束原因</span>
                      <span className="sc-resume-value">{formatFinishReason(last.finishReason)}</span>
                    </div>
                    {last.toolCallNames && last.toolCallNames.length > 0 && (
                      <div className="sc-resume-row">
                        <span className="sc-resume-label">待执行工具</span>
                        <span className="sc-resume-value">{last.toolCallNames.join('、')}</span>
                      </div>
                    )}
                    {last.error && <div className="sc-resume-error">{last.error}</div>}
                  </>
                ) : (
                  <div className="sc-resume-value">（无已记录的模型调用）</div>
                )}
                {preview?.progressDigest && (
                  <pre className="sc-resume-digest">{preview.progressDigest}</pre>
                )}
              </>
            )}
          </div>

          {confirmError && <div className="sc-resume-error">{confirmError}</div>}

          <div className="sc-resume-actions">
            <button
              type="button"
              className="sc-resume-cancel"
              onClick={() => setOpen(false)}
              disabled={confirming}
            >
              取消
            </button>
            <button
              type="button"
              className="sc-resume-confirm"
              onClick={() => void handleConfirm()}
              disabled={confirming || loadingPreview || Boolean(previewError)}
            >
              {confirming ? '正在恢复…' : '确认继续'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
