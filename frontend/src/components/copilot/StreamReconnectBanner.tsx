import React from 'react';

/**
 * BLOCK-394 B-14 — SSE 重连独立横幅（纯展示，零状态源）。
 *
 * 现状：`conversationRunStore.onStreamReconnecting` 只把提示写进 `statusMessage`，
 * 由消息行顺带渲染（消息很多时看不到、断线态与正文混在一起）。本组件从**既有**
 * statusMessage 派生三态，投影为独立 live region；不新建 UI truth / 通知中心。
 *
 * 三态来源（都是 store 已有语义）：
 *   - reconnecting：statusMessage 含「正在重连」；
 *   - replaying：含「重放」/「续传」（水位续传既有文案）；
 *   - exhausted：含「重连失败」/「重连次数耗尽」；
 *   - hidden：其余（正常态不占位）。
 */
export type ReconnectPhase = 'hidden' | 'reconnecting' | 'replaying' | 'exhausted';

export function deriveReconnectPhase(statusMessage?: string): ReconnectPhase {
  const text = String(statusMessage || '');
  if (/重连失败|重连次数耗尽|连接已断开且无法恢复/.test(text)) return 'exhausted';
  if (/重放|续传/.test(text)) return 'replaying';
  if (/正在重连|失去连接/.test(text)) return 'reconnecting';
  return 'hidden';
}

export interface StreamReconnectBannerProps {
  statusMessage?: string;
  attempt?: number;
}

export function StreamReconnectBanner({ statusMessage, attempt }: StreamReconnectBannerProps): React.ReactElement | null {
  const phase = deriveReconnectPhase(statusMessage);
  if (phase === 'hidden') return null;
  const copy: Record<Exclude<ReconnectPhase, 'hidden'>, string> = {
    reconnecting: `与任务失去连接，正在重连${Number.isFinite(attempt) ? `（第 ${attempt} 次）` : ''}…`,
    replaying: '连接已恢复，正在按事件水位重放未收到的进度…',
    exhausted: '重连未成功，任务进度可能已停止。可稍后手动继续本轮。',
  };
  return (
    <div
      className="sc-reconnect-banner"
      data-reconnect-phase={phase}
      role="status"
      aria-live="polite"
    >
      <span className="sc-reconnect-banner-dot" aria-hidden="true" />
      <span>{copy[phase]}</span>
    </div>
  );
}
