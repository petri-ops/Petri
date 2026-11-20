import React, { useEffect, useRef, useState } from 'react';

export interface ChatWorkingStatusProps {
  /** 由 useChatStream 的 `starting || activeRun.status === 'running'` 提供。 */
  running: boolean;
  /** conversationRunStore 的本轮起始时刻；缺省时以组件挂载时刻起算。 */
  startedAt?: number;
}

function formatElapsed(ms: number): string {
  return `${Math.max(0, Math.floor(ms / 1000))} 秒`;
}

/**
 * UI-712 — ZCode 形态的底部运行反馈：运行期常驻「工作中 + 已运行时长」。
 * 正文/过程行的折叠仍由既有 SimpleChatMessageRow / ConversationTimeline 负责，
 * 本组件只补底部状态，不接管内容渲染。
 */
export function ChatWorkingStatus({ running, startedAt }: ChatWorkingStatusProps): React.ReactElement | null {
  const [elapsedMs, setElapsedMs] = useState(0);
  const anchorRef = useRef(startedAt);

  useEffect(() => {
    if (!running) return undefined;
    if (typeof startedAt === 'number' && Number.isFinite(startedAt)) {
      anchorRef.current = startedAt;
    } else {
      anchorRef.current = anchorRef.current ?? Date.now();
    }
    const tick = () => setElapsedMs(Math.max(0, Date.now() - (anchorRef.current ?? 0)));
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [running, startedAt]);

  if (!running) return null;

  return (
    <div className="sc-working-status" role="status" aria-live="polite" data-testid="chat-working-status">
      <span className="sc-tool-term-spinner" aria-hidden="true" />
      <span className="sc-working-status-label">工作中</span>
      <span className="sc-working-status-elapsed">{`已运行 ${formatElapsed(elapsedMs)}`}</span>
    </div>
  );
}
