/**
 * frontend/src/components/copilot/gen-ui/followUp.ts
 *
 * BLOCK-166 P2 — follow-up 追问的宿主侧判定（纯函数，vitest 直测）。
 * 规格 §8：把追问写入现有会话的输入绑定发送；只读/过期/非当前会话明确拒绝。
 * 判定与执行分离：本模块只产出 verdict（拒绝原因/归一化内容），
 * SimpleChat 依据 verdict 执行确认框与发送/排队。
 */

export interface GenUiFollowUpRequest {
  prompt: string;
  title?: string;
  /** 发起追问的卡片所属会话（过期绑定检测用）。 */
  messageConversationId: string | null;
}

export interface GenUiFollowUpInput {
  request: GenUiFollowUpRequest;
  /** 当前会话（null = 无绑定）。 */
  currentConversationId: string | null;
  /** 输入绑定是否可用（composer 未挂载 = 只读）。 */
  inputAvailable: boolean;
}

export interface GenUiFollowUpResult {
  ok: boolean;
  reason?: string;
  /** 归一化后的内容（trim 过），仅 ok 时有值。 */
  prompt?: string;
  /** 归一化确认框标题（≤250），仅 ok 时有值。 */
  title?: string;
}


const MAX_PROMPT = 8000;
const MAX_TITLE = 250;

export function resolveGenUiFollowUp({
  request,
  currentConversationId,
  inputAvailable,
}: GenUiFollowUpInput): GenUiFollowUpResult {
  const prompt = typeof request?.prompt === 'string' ? request.prompt.trim() : '';
  if (!prompt) return { ok: false, reason: '追问内容为空' };
  if (prompt.length > MAX_PROMPT) return { ok: false, reason: `追问内容超过 ${MAX_PROMPT} 字上限` };
  const rawTitle = typeof request?.title === 'string' ? request.title.trim() : '';
  if (rawTitle.length > MAX_TITLE) return { ok: false, reason: `确认框标题超过 ${MAX_TITLE} 字上限` };
  if (!currentConversationId || request.messageConversationId !== currentConversationId) {
    return { ok: false, reason: '非当前会话（绑定已过期）' };
  }
  if (!inputAvailable) return { ok: false, reason: '输入绑定只读不可用' };
  return {
    ok: true,
    prompt,
    title: rawTitle || '可视化追问',
  };
}
