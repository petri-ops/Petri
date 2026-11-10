/**
 * BLOCK-394 B-07 — 运行健康四事件的前端投影映射（纯函数，可离线断言）。
 *
 * 后端 `reason-codes.js` 已注册 compaction_failed / trim_skipped / provider_retry /
 * stream_stall，`trajectory-events.js` 也已分派类别，但前端此前对这四个码 0 命中：
 * 事件到了 SSE 却没有任何消费点，用户看不到「压缩失败 / 裁剪跳过 / 上游重试 / 流停滞」。
 *
 * 本模块只做「事件码 → 可见文案 + 严重度」的单点映射，不新建 UI truth / 状态中心；
 * 消费方走既有 `onAgentStatus` 通道（`conversationRunStore` 的 `statusMessage`）。
 */

export const RUN_HEALTH_EVENT_CODES = Object.freeze([
  'compaction_failed', 'trim_skipped', 'provider_retry', 'stream_stall',
] as const);

export type RunHealthEventCode = (typeof RUN_HEALTH_EVENT_CODES)[number];

export interface RunHealthEventPayload {
  detail?: string;
  attempt?: number;
  phase?: string;
}

export interface RunHealthEventView {
  code: RunHealthEventCode;
  message: string;
  severity: 'warning' | 'error';
}

export function mapRunHealthEvent(
  code: string,
  payload: RunHealthEventPayload = {},
): RunHealthEventView | null {
  if (!(RUN_HEALTH_EVENT_CODES as readonly string[]).includes(code)) return null;
  const typed = code as RunHealthEventCode;
  const detail = typeof payload.detail === 'string' ? payload.detail : '';
  switch (typed) {
    case 'compaction_failed':
      return { code: typed, severity: 'error', message: `上下文压缩失败${detail ? `：${detail}` : ''}；本轮可能受上下文上限影响` };
    case 'trim_skipped':
      return { code: typed, severity: 'warning', message: `上下文裁剪被跳过${detail ? `：${detail}` : ''}；长对话请注意` };
    case 'provider_retry':
      return { code: typed, severity: 'warning', message: `上游调用失败，正在重试${Number.isFinite(payload.attempt) ? `（第 ${payload.attempt} 次）` : ''}${detail ? `：${detail}` : ''}` };
    case 'stream_stall':
      return { code: typed, severity: 'warning', message: `模型流式响应停滞${payload.phase ? `（${payload.phase}）` : ''}，正在按策略恢复` };
    default:
      return null;
  }
}
