// ============================================================
// messageActions.ts — BLOCK-246 C4 消息动作注册表（纯函数层）
//
// 背景：回复行的动作原来是三段硬编码 JSX（复制 / 重新生成 / 创建分支）+ 用户行的
// 编辑钮，想加一个动作就要动渲染代码。这里把"哪些动作、什么顺序、什么状态、什么
// 理由不可点"收成一张表，渲染面只负责把 spec 映射成按钮。
//
// 纪律：
//   · 既有动作的**语义与顺序不变**（复制 → 重新生成 → 创建分支）；
//   · 新增动作只有两个：加入上下文（走单一 ComposerContextItem 通道）与评价；
//   · 不可点必须给 title 说明（禁用不是"消失"，用户要看得见为什么）。
// ============================================================

import type { IconName } from '@/components/icons/Icon';

export type MessageActionId =
  | 'edit'
  | 'copy'
  | 'regenerate'
  | 'fork'
  | 'quote-context'
  | 'stats'
  | 'polish'
  | 'suggest-followups'
  | 'rate-up'
  | 'rate-down';

export type MessageRatingValue = 'up' | 'down';

export interface MessageActionInput {
  role: 'user' | 'assistant';
  hasContent: boolean;
  pending: boolean;
  streaming: boolean;
  forking: boolean;
  copied: boolean;
  rating: MessageRatingValue | null;
  /** BLOCK-255 C4 — 统计面板是否展开（按钮文案/按下态）。 */
  statsOpen?: boolean;
}

export interface MessageActionSpec {
  id: MessageActionId;
  label: string;
  title: string;
  icon: IconName;
  disabled: boolean;
  /** 该动作之后是否画分隔线（渲染面用它保留原有分组观感）。 */
  dividerAfter: boolean;
  /** 评价类动作的按下态（aria-pressed）。 */
  pressed?: boolean;
}

const EMPTY: MessageActionSpec[] = [];

/** BLOCK-259 C14 — 固定追问模板（本地、可预期；点击只填入输入框，不自动发送）。 */
export const FOLLOWUP_PROMPTS: ReadonlyArray<{ label: string; prompt: string }> = Object.freeze([
  { label: '解释关键结论', prompt: '请解释上一条回复的关键结论，以及每个结论对应的依据。' },
  { label: '继续深入分析', prompt: '请在上一条回复的基础上继续深入分析下一步，指出最值得做的验证。' },
  { label: '整理成可执行摘要', prompt: '请把上一条回复整理成可执行的步骤摘要，标明前置条件与风险。' },
]);

const RESULT_FOLLOWUPS = Object.freeze([
  { label: '解释这个结果', prompt: '请解释上一条回复里的结果指标与关键结论，并说明哪些是推断、哪些有证据。' },
  { label: '检查结果可信度', prompt: '请检查上一条结果的可信度：样本量、阈值、质控与可能的混杂因素。' },
  { label: '给出下一步验证', prompt: '基于上一条结果，给出最值得做的下一步验证与预期判据。' },
]);

const CODE_FOLLOWUPS = Object.freeze([
  { label: '审查这处改动', prompt: '请审查上一条回复涉及的代码改动，指出风险、回归面与缺失的测试。' },
  { label: '解释改动影响', prompt: '请解释上一条回复中改动的影响范围，以及哪些调用方会受影响。' },
  { label: '生成验证步骤', prompt: '请为这次改动生成最小验证步骤，包含正例与边界用例。' },
]);

const ERROR_FOLLOWUPS = Object.freeze([
  { label: '定位失败根因', prompt: '请定位上一条失败/报错的根因，列出已排除项与下一步取证。' },
  { label: '给出修复方案', prompt: '请给出最小修复方案，并说明为什么不会引入新的回归。' },
  { label: '给出复现步骤', prompt: '请给出可复现该问题的最小步骤与判据。' },
]);

/** BLOCK-260 C14 — 本地关键词启发式，不调用模型；未命中回默认三条。 */
export function selectFollowupPrompts(content: string): ReadonlyArray<{ label: string; prompt: string }> {
  const text = String(content || '').toLowerCase();
  if (/失败|报错|错误|异常|error|exception|failed|traceback/.test(text)) return ERROR_FOLLOWUPS;
  if (/表格|结果|指标|差异|富集|聚类|p-value|result|summary|图/.test(text)) return RESULT_FOLLOWUPS;
  if (/代码|文件|修改|改动|审查|diff|patch|commit/.test(text)) return CODE_FOLLOWUPS;
  return FOLLOWUP_PROMPTS;
}

/** BLOCK-259 C14 — 润色要求（有界截取，避免把整段超长回复塞进输入框）。 */
export function polishPrompt(content: string): string {
  const text = String(content || '');
  const bounded = text.slice(0, 4000);
  const suffix = text.length > bounded.length ? '\n（内容较长，已截取前 4000 字）' : '';
  return `请润色上一条助手回复，保持事实、数字与结论不变，只改进结构与表达：\n\n${bounded}${suffix}`;
}

/** 用户消息的动作：编辑并重发（保持 BLOCK-244 的语义与提示文案）。 */
export function buildUserMessageActions(input: MessageActionInput): MessageActionSpec[] {
  if (!input.hasContent || input.pending) return EMPTY;
  return [
    {
      id: 'edit',
      label: '编辑',
      title: '编辑并重发：回退到这条消息之前，文本回填输入框',
      icon: 'pencil',
      disabled: false,
      dividerAfter: true,
    },
  ];
}

/** 助手回复的动作：复制 / 重新生成 / 创建分支 / 加入上下文 / 统计 / 评价。 */
export function buildAssistantMessageActions(input: MessageActionInput): MessageActionSpec[] {
  if (!input.hasContent || input.pending) return EMPTY;
  const rating = input.rating;
  return [
    {
      id: 'copy',
      label: input.copied ? '已复制' : '复制',
      title: '复制回复',
      icon: input.copied ? 'check' : 'copy',
      disabled: false,
      dividerAfter: true,
    },
    {
      id: 'regenerate',
      label: '重新生成',
      title: input.streaming ? '正在生成中，结束后可重新生成' : '用当前模型重新生成这条回复',
      icon: 'repeat',
      disabled: input.streaming,
      dividerAfter: true,
    },
    {
      id: 'fork',
      label: input.forking ? '创建中…' : '创建分支',
      title: '以此消息为终点创建分支（新分支将包含从开始到这条回复的所有消息）',
      icon: 'git-branch',
      disabled: input.forking,
      dividerAfter: true,
    },
    {
      id: 'quote-context',
      label: '加入上下文',
      title: '把这条回复作为上下文引用到输入框（可随时移除）',
      icon: 'layers',
      disabled: false,
      dividerAfter: true,
    },
    {
      id: 'stats',
      label: input.statsOpen ? '收起统计' : '统计',
      title: '查看这条回复的耗时、工具步数、迭代数与 token 统计',
      icon: 'bar-chart',
      disabled: false,
      dividerAfter: true,
      pressed: Boolean(input.statsOpen),
    },
    {
      id: 'polish',
      label: '润色',
      title: '把「润色这条回复」的要求填入输入框（不改原回复、不自动发送）',
      icon: 'pencil',
      disabled: false,
      dividerAfter: true,
    },
    {
      id: 'suggest-followups',
      label: '建议追问',
      title: '查看三条常用追问，点击填入输入框（不自动发送）',
      icon: 'message-circle',
      disabled: false,
      dividerAfter: true,
    },
    {
      id: 'rate-up',
      label: rating === 'up' ? '已赞' : '有用',
      title: rating === 'up' ? '取消「有用」评价' : '这条回复有用（写入本地评价表）',
      icon: 'check',
      disabled: false,
      dividerAfter: false,
      pressed: rating === 'up',
    },
    {
      id: 'rate-down',
      label: rating === 'down' ? '已踩' : '没用',
      title: rating === 'down' ? '取消「没用」评价' : '这条回复没帮上忙（写入本地评价表）',
      icon: 'flag',
      disabled: false,
      dividerAfter: false,
      pressed: rating === 'down',
    },
  ];
}

export function buildMessageActions(input: MessageActionInput): MessageActionSpec[] {
  return input.role === 'user' ? buildUserMessageActions(input) : buildAssistantMessageActions(input);
}

/** 评价按钮的切换语义：点同一边 = 撤销，点另一边 = 覆盖。 */
export function nextRating(current: MessageRatingValue | null, clicked: MessageRatingValue): MessageRatingValue | null {
  return current === clicked ? null : clicked;
}
