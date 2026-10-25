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
