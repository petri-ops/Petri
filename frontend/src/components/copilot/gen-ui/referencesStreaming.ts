/**
 * frontend/src/components/copilot/gen-ui/referencesStreaming.ts
 *
 * BLOCK-466 [W11 P3 流式首切片] ::compose 流式投影纯函数。
 *
 * 复用 `projectGenUiReferences(text, completed)` 既有 pending 语义（未闭合指令出
 * pending 占位、防原始 JSON 泄漏/防闪烁），把它显式命名为流式契约：
 *   - 流式期（streaming=true）：所有 compose 指令在 spec 完整合法前只出 pending 占位，
 *     即使文本已含完整 JSON 也不抢渲染（等 completed 升级，防半截 spec 闪烁）；
 *   - 完成期（streaming=false）：走严格 schema 校验，合法出 compose/失败出 invalid。
 *
 * 纯函数：投影只依赖 content + streaming 两个参数，与 agentTaskStream 的 seq/afterSeq
 * 重连历史无关——断线续传重建出同一累积 content 即得同一投影（兼容断言见测试）。
 * 零新增依赖、零 SSE 契约改动。
 */

import { projectGenUiReferences, type GenUiPart } from './references';

export interface StreamingComposeProjection {
  /** 当前是否处于流式期（消费方据此渲染占位 vs 卡片）。 */
  streaming: boolean;
  parts: GenUiPart[];
}

/**
 * ::compose 流式投影。
 *
 * @param content 当前累积的消息正文（流式每个 delta 重建；断线重连后由 store 按 afterSeq 重建）
 * @param streaming 消息是否仍在流式输出中
 */
export function projectStreamingCompose(content: string, streaming: boolean): StreamingComposeProjection {
  // 完成态走原投影（严格校验：合法 compose / 失败 invalid / 无指令快路径）。
  if (!streaming) {
    return { streaming: false, parts: projectGenUiReferences(content, true) };
  }

  // 流式态：对已有 compose 指令强制 pending 占位。projectGenUiReferences(text,false)
  // 已对「未闭合指令」出 pending；但对「已闭合但可能是半截/完整」的指令会继续 decode。
  // 为避免流式期泄漏/闪烁，这里对命中 compose 的文本统一以 completed=false 投影——
  // 若解析器把已闭合 spec 判成 compose，则主动替换为 pending（流式期不抢渲染）。
  const parts = projectGenUiReferences(content, false);
  const safe = parts.some((part) => part.kind === 'compose')
    ? parts.map((part): GenUiPart => (part.kind === 'compose' ? { kind: 'pending' } : part))
    : parts;
  return { streaming: true, parts: safe };
}
