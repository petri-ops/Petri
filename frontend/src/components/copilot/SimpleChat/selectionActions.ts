// ============================================================
// selectionActions.ts — BLOCK-246 C12 划词动作（纯函数层）
//
// 背景：`selectionQuote` 一直是「有消费无生产」的半截管线（composer 订阅了它，
// 但没有任何地方派发）。本模块把「选区 → 动作清单 / 事件载荷 / 速记载荷」的
// 判定收成纯函数，生产者（WorkspaceFilePreview）只负责测量选区与渲染动作条。
//
// 纪律：
//   · 「加入对话」只产 `SelectionQuoteDetail`（既有事件契约，不新增事件类型、
//     不建第四注入通道）；
//   · 批注在文本面**不可用**是有原因的（批注只支持 PDF/图像），所以不是隐藏按钮，
//     而是给出禁用理由——用户看得见"为什么没有"；
//   · 截断上限与 composer 侧同一常量（`MAX_SELECTION_REFERENCE_CHARS`），
//     生产侧先截一次只是为了不给剪贴板/网络塞 100KB。
// ============================================================
import type { SelectionQuoteDetail } from '@/lib/events';
import { MAX_SELECTION_REFERENCE_CHARS } from './selectionReferences';

export type SelectionActionId = 'copy' | 'quote' | 'scratchpad' | 'side-chat' | 'annotate';

export interface SelectionActionSpec {
  id: SelectionActionId;
  label: string;
  /** 悬停说明（含"为什么不给点"）。 */
  hint: string;
  disabled: boolean;
}

/** 文本面的批注不可用原因（与 WorkspaceFilePreview 里 Office 的同类说明同风格）。 */
export const TEXT_ANNOTATION_UNAVAILABLE_REASON =
  '文本批注暂不支持：批注只支持 PDF 与图像文件；可先「加入对话」让 Agent 解读这段';

/** 选中原文的截断（与 composer 引用块同上限，早截一次省剪贴板与网络）。 */
export function clampSelectionText(text: string): { text: string; truncated: boolean } {
  const chars = Array.from(text);
  if (chars.length <= MAX_SELECTION_REFERENCE_CHARS) return { text, truncated: false };
  return {
    text: `${chars.slice(0, MAX_SELECTION_REFERENCE_CHARS).join('')}\n…（选中内容过长，已截断）`,
    truncated: true,
  };
}

/**
 * 选区动作清单。`charCount` 为 0（空选区）时全部禁用——调用方本就不该弹条，
 * 这里再兜一层，避免"空选区也能点出引用"的假动作。
 */
export function buildSelectionActions(input: { charCount: number }): SelectionActionSpec[] {
  const empty = input.charCount <= 0;
  return [
    {
      id: 'copy',
      label: '复制',
      hint: empty ? '没有选中文字' : '复制选中文字到剪贴板',
      disabled: empty,
    },
    {
      id: 'quote',
      label: '加入对话',
      hint: empty ? '没有选中文字' : '作为一条引用块加入输入框（可随时移除）',
      disabled: empty,
    },
    {
      id: 'scratchpad',
      label: '加入速记',
      hint: empty ? '没有选中文字' : '存进速记板，随时引用回对话',
      disabled: empty,
    },
    {
      id: 'side-chat',
      label: '侧聊提问',
      hint: empty ? '没有选中文字' : '复制选中文字并打开侧边会话（粘贴即问）',
      disabled: empty,
    },
    {
      id: 'annotate',
      label: '批注',
      hint: TEXT_ANNOTATION_UNAVAILABLE_REASON,
      disabled: true,
    },
  ];
}

export interface SelectionSourceInfo {
  /** 工作区相对路径（无文件的选区面不传）。 */
  path: string;
  name?: string;
  projectId?: string;
  /** 编辑器内选中时的行号（Markdown 渲染视图没有行号，如实留空）。 */
  startLine?: number;
  endLine?: number;
  /** BLOCK-246 C16 — 代码面选区的语言（有值 → 引用块用围栏代码块）。 */
  language?: string;
}

/** 选区 → `selectionQuote` 事件载荷（唯一契约，不新增字段）。 */
export function selectionQuoteDetail(text: string, source: SelectionSourceInfo): SelectionQuoteDetail | null {
  const trimmed = text.trim();
  if (!trimmed || !source.path) return null;
  const clamped = clampSelectionText(trimmed);
  return {
    projectId: source.projectId,
    path: source.path,
    name: source.name,
    startLine: source.startLine,
    endLine: source.endLine,
    text: clamped.text,
    ...(source.language ? { language: source.language } : {}),
  };
}

/** 选区 → 速记载荷（来源固定 selection，带上文件位置便于回溯）。 */
export function selectionScratchpadInput(text: string, source: SelectionSourceInfo) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const clamped = clampSelectionText(trimmed);
  const position = source.startLine
    ? `${source.path}:L${source.startLine}${source.endLine && source.endLine !== source.startLine ? `-L${source.endLine}` : ''}`
    : source.path;
  const firstLine = trimmed.split('\n').find((line) => line.trim())?.trim() ?? '';
  return {
    kind: 'text' as const,
    title: firstLine.slice(0, 40) || source.name || source.path,
    body: clamped.text,
    sourceKind: 'selection' as const,
    sourceRef: position,
    projectId: source.projectId ?? null,
  };
}
