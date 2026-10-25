/**
 * BLOCK-255 C4 — 一条助手回复的模型调用 usage 合计（跨 SimpleChat / run 投影共用）。
 *
 * `calls` 只数拿到 usage 的调用；`unmeasuredCalls` 单列没返回 usage 的调用。
 * 实时流只能看到已发 usage 的调用，故 `unmeasuredCalls` 缺省 undefined = 未知。
 */
export interface MessageUsage {
  calls: number;
  unmeasuredCalls?: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  durationMs: number;
  models: string[];
}
