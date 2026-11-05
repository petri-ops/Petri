/**
 * activeRunWindow — UI-COLLAPSE-2：本轮任务 run 的消息窗口边界。
 *
 * 背景：原先折叠判断挂在「单条消息 pending」上，run 跨多条消息（durable loop /
 * 分条输出）时上一轮一结束就立即折叠，过程割裂、阅读跳动。改为：run 进行中，
 * **本轮 user 消息之后的全部消息**保持展开；run 结束（streaming=false）后统一折叠。
 *
 * 纯函数、无 React 依赖，便于契约测试。
 */

export interface RunWindowMessage {
  role: string;
}

/**
 * 返回「当前 run 的起始下标」：最后一个 user 消息的位置；run 未进行时为 -1。
 * 调用方以 `index > startIndex` 判定该消息是否属于当前 run。
 */
export function resolveActiveRunStartIndex(messages: readonly RunWindowMessage[], streaming: boolean): number {
  if (!streaming) return -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i] && messages[i].role === 'user') return i;
  }
  return -1;
}

/** 该消息是否属于当前进行中的 run（run 中统一展开、结束统一折叠）。 */
export function isMessageInActiveRun(
  messages: readonly RunWindowMessage[],
  streaming: boolean,
  index: number,
): boolean {
  const start = resolveActiveRunStartIndex(messages, streaming);
  return start >= 0 && index > start;
}
