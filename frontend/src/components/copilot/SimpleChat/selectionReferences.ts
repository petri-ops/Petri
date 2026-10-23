// ============================================================
// selectionReferences.ts — BLOCK-52 P1「选中即引用」纯函数助手
//
// 职责：selectionQuote 事件载荷 → composer 引用块（chip）状态管理 +
// 发送时把引用块渲染进消息文本。不做 React / IPC / 事件订阅（那些
// 分别住在 SimpleChat.tsx 与 WorkspaceFilePreview）。
//
// 数据流：
//   WorkspaceFilePreview（右栏预览）--selectionQuote 事件-->
//   SimpleChat（中央会话）appendSelectionReference --> chip 列表
//   发送时 composeMessageWithSelectionReferences(text, refs) --> 消息正文
// ============================================================

import type { SelectionQuoteDetail } from '@/lib/events';

/** 单个引用块（composer chip 状态 + 发送渲染输入）。 */
export interface SelectionReference {
  id: string;
  /** workspace 相对路径。 */
  path: string;
  /** 文件名（chip 显示用）。 */
  name: string;
  /** 起始行（1-based）；Markdown 渲染视图等无行号来源缺省。 */
  startLine?: number;
  /** 结束行（1-based，含端点）。 */
  endLine?: number;
  /** 选中文字原文（已在创建时截断到 MAX_SELECTION_REFERENCE_CHARS）。 */
  text: string;
  /** BLOCK-246 C16 — 代码文件的语法高亮语言（有值时按围栏代码块渲染）。 */
  language?: string;
}

/** 选中文字截断上限（字符）——引用是上下文提示，不是文件传输通道。 */
export const MAX_SELECTION_REFERENCE_CHARS = 8000;

/** composer 引用块数量上限——防误操作连点刷屏。 */
export const MAX_SELECTION_REFERENCES = 8;

let seq = 0;
function nextId(): string {
  seq += 1;
  return `selref-${Date.now()}-${seq}`;
}

/** 由 selectionQuote 事件载荷创建引用块（截断 + 文件名推导）。 */
export function makeSelectionReference(detail: SelectionQuoteDetail): SelectionReference | null {
  const path = detail.path?.trim();
  const text = detail.text ?? '';
  if (!path || !text.trim()) return null;
  return {
    id: nextId(),
    path,
    name: detail.name?.trim() || path.split('/').pop() || path,
    startLine: detail.startLine,
    endLine: detail.endLine,
    text: text.length > MAX_SELECTION_REFERENCE_CHARS
      ? `${text.slice(0, MAX_SELECTION_REFERENCE_CHARS)}\n…（选中内容过长，已截断）`
      : text,
    language: detail.language,
  };
}

/**
 * 追加一个引用块：上限截断 + 与上一条完全同源（同路径同行同文）时去重。
 * 返回新数组；无效载荷原样返回。
 */
export function appendSelectionReference(
  prev: SelectionReference[],
  detail: SelectionQuoteDetail,
): SelectionReference[] {
  const ref = makeSelectionReference(detail);
  if (!ref) return prev;
  const last = prev[prev.length - 1];
  if (
    last
    && last.path === ref.path
    && last.startLine === ref.startLine
    && last.endLine === ref.endLine
    && last.text === ref.text
  ) {
    return prev;
  }
  return [...prev, ref].slice(-MAX_SELECTION_REFERENCES);
}

/** 引用块的位置标签：`path:L42` / `path:L42-L48` / `path`（无行号）。 */
export function selectionReferenceLocation(ref: Pick<SelectionReference, 'path' | 'startLine' | 'endLine'>): string {
  if (!ref.startLine) return ref.path;
  if (ref.endLine && ref.endLine !== ref.startLine) return `${ref.path}:L${ref.startLine}-L${ref.endLine}`;
  return `${ref.path}:L${ref.startLine}`;
}

/**
 * 发送时把引用块渲染成消息正文前缀（引用块在前、用户文本在后）。
 * 引用文字以 blockquote（`>`）逐行呈现，模型可直接读到原文；
 * 无引用时原样返回，零干扰。
 * 注意：引用头用全角【】而非 []——服务端落库会剥掉行首半角 [...] 前缀
 * （chat.js cleanContent legacy 正则），[] 会导致落库消息缺头 + 前后端重复渲染。
 */
export function composeMessageWithSelectionReferences(
  raw: string,
  refs: SelectionReference[],
): string {
  if (refs.length === 0) return raw;
  const block = refs
    .map((ref) => `【引用 ${selectionReferenceLocation(ref)}】\n${
      ref.text.split('\n').map((line) => `> ${line}`).join('\n')
    }`)
    .join('\n\n');
  return `${block}\n\n${raw}`;
}

/** chip 显示文字：`name:L42-L48 「text 前 24 字…」`。 */
export function selectionReferenceChipLabel(
  ref: SelectionReference,
  maxTextChars = 24,
): string {
  const flat = ref.text.replace(/\s+/g, ' ').trim();
  const short = flat.length > maxTextChars ? `${flat.slice(0, maxTextChars)}…` : flat;
  return `「${short}」`;
}
