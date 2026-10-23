// ============================================================
// contextItems.ts — BLOCK-245 P2「上下文装配单列表」纯函数层
//
// 背景：composer 的上下文引用原本是三条互不复用的平行通道（选中文段 /
// 图片引用 / 附件行块），各自持有 state、append 去重、上限常量、渲染行，
// 组装顺序知识散在 SimpleChat.tsx 的三处调用点。本模块把它们收敛成
// 一种结构：ComposerContextItem + 唯一 append + 唯一渲染。
//
// 纪律：本文件是 **纯函数层**——不碰 React、不碰事件、不碰上传。
// 渲染形状由 `contextChannels.baseline.test.ts` 逐字冻结；改这里必须
// 让那条基线测继续逐字通过，否则就不是收敛而是行为变更。
// ============================================================

import {
  MAX_SELECTION_REFERENCES,
  selectionReferenceLocation,
  type SelectionReference,
} from './selectionReferences';
import {
  MAX_IMAGE_REFERENCES,
  imageReferenceSourceLine,
  type ImageReference,
} from './imageReferences';
import type { UploadedAttachmentRef } from './attachmentUpload';

/**
 * 渲染分组（决定引用块落在正文哪一侧、以及组内排序）：
 * - `image`：正文最前的 `【引用图片 …】` 块（现状 = 三层套嵌的最外层）
 * - `reference`：紧贴正文的 `【引用 …】` 块（选中文段，以及 P3/P4 新增的
 *   文件/技能/连接器/Agent/结果产物/知识空间/会话候选）
 * - `attachment`：尾追的半角 `[附件: …]` 行（服务端 cleanContent 只剥行首
 *   半角 `[...]`，附件行本就允许半角且位置在正文之后，语义不同，单列一组）
 */
export type ContextGroup = 'image' | 'reference' | 'attachment';

/** 条目种类（chip 图标、移除与后续统计用；组决定渲染位置）。 */
type ContextKind =
  | 'selection'
  | 'image'
  | 'attachment'
  | 'file'
  | 'skill'
  | 'connector'
  | 'agent'
  | 'artifact'
  | 'knowledge'
  | 'conversation'
  // BLOCK-246：速记板条目（C13）、文件夹整体引用 / 选中代码块 / 应用快照（C16）
  | 'scratchpad'
  | 'folder'
  | 'code'
  | 'snapshot'
  | 'message';

export interface ComposerContextItem {
  id: string;
  kind: ContextKind;
  group: ContextGroup;
  /** chip 主标题。 */
  label: string;
  /** chip 次行来源标签（同渲染进正文的「来源」信息，一条真相）。 */
  source: string;
  /** 渲染进正文的行（不含组间空行；由组决定前置/尾追拼接方式）。 */
  lines: string[];
  /** 相邻同源去重键；null = 该组不做相邻去重（附件每次都是新上传）。 */
  dedupeKey: string | null;
  /** UI 侧需要的原始结构化载荷（chip 缩略图、路径消歧等）。 */
  payload: SelectionReference | ImageReference | UploadedAttachmentRef | Record<string, unknown>;
}

/** 各组上限（单源）。附件不设组内上限——上限在暂存文件面（attachments.ts）。 */
export const CONTEXT_GROUP_CAPS: Record<ContextGroup, number | null> = {
  image: MAX_IMAGE_REFERENCES,
  reference: MAX_SELECTION_REFERENCES,
  attachment: null,
};

/**
 * 选中文段 → reference 组条目（渲染头用全角【】，见基线测的纪律断言）。
 *
 * BLOCK-246 C16：代码文件（带 `language`）改用**围栏代码块**——模型读代码时围栏比
 * 逐行 `>` 更省 token 也更清楚边界；非代码选区保持原样（基线测逐字不变）。
 */
export function selectionContextItem(ref: SelectionReference): ComposerContextItem {
  const location = selectionReferenceLocation(ref);
  const isCode = Boolean(ref.language);
  const fence = ref.language ? `\`\`\`${ref.language}` : '```';
  const body = isCode
    ? [fence, ...ref.text.split('\n'), '```']
    : ref.text.split('\n').map((line) => `> ${line}`);
  return {
    id: ref.id,
    kind: 'selection',
    group: 'reference',
    label: location,
    source: ref.path,
    lines: [isCode ? `【引用代码 ${location}】` : `【引用 ${location}】`, ...body],
    dedupeKey: `${ref.path}|${ref.startLine ?? ''}|${ref.endLine ?? ''}|${ref.language ?? ''}|${ref.text}`,
    payload: ref,
  };
}

/** 图片引用 → image 组条目（结果图带 artifact 元数据行，静态图带 path 行）。 */
export function imageContextItem(ref: ImageReference): ComposerContextItem {
  const source = imageReferenceSourceLine(ref);
  const lines = [`【引用图片 ${ref.name}】`, `> 来源：${source}`];
  if (ref.kind === 'result-artifact' && ref.artifact) {
    const { toolJobId, revisionId, artifactId, revisionOrdinal } = ref.artifact;
    const meta = [
      `toolJobId=${toolJobId}`,
      revisionOrdinal ? `revisionOrdinal=${revisionOrdinal}` : '',
      revisionId ? `revisionId=${revisionId}` : '',
      artifactId ? `artifactId=${artifactId}` : '',
    ].filter(Boolean).join(' ');
    lines.push(`> artifact: ${meta}`);
  } else if (ref.path) {
    lines.push(`> path: ${ref.path}`);
  }
  return {
    id: ref.id,
    kind: 'image',
    group: 'image',
    label: ref.name,
    source,
    lines,
    dedupeKey: [ref.kind, ref.name, ref.path ?? '', ref.artifact?.revisionId ?? ''].join('|'),
    payload: ref,
  };
}

/** 已上传附件 → 尾追组条目（每个附件一行，无相邻去重）。 */
export function attachmentContextItems(refs: UploadedAttachmentRef[]): ComposerContextItem[] {
  return refs.map((ref, index) => {
    const sizeLabel = ref.size > 0 ? `（${(ref.size / 1024).toFixed(1)}KB）` : '';
    return {
      // 同名同大小重复上传也会拿到稳定且唯一的 id（移除单项不误伤另一项）。
      id: `att-${index}-${ref.path}-${ref.size}`,
      kind: 'attachment',
      group: 'attachment',
      label: ref.name,
      source: ref.path,
      lines: [`[附件: ${ref.path}${sizeLabel}]`],
      dedupeKey: null,
      payload: ref,
    };
  });
}

/** 速记正文进引用块的上限（速记本身可到 8000 字，但上行块必须保持可读）。 */
export const MAX_SCRATCHPAD_BLOCK_CHARS = 2000;

export interface ScratchpadQuoteInput {
  entryId: string;
  kind: 'text' | 'image';
  title: string | null;
  body: string;
  sourceKind: string;
  sourceRef: string | null;
  createdAt: string;
}

const SCRATCHPAD_SOURCE_LABELS: Record<string, string> = {
  manual: '手动记录',
  conversation: '会话',
  file: '文件',
  selection: '选区',
};

/**
 * 速记板条目 → reference 组条目（C13「引用」出速记板的唯一出口）。
 *
 * 图片速记**不**把 data URL 塞进正文（几 MB 的 base64 会撑爆上行且对模型无意义），
 * 只留一行来源说明——诚实标注"这里有一张图，但没有把图传上来"。
 */
export function scratchpadContextItem(entry: ScratchpadQuoteInput): ComposerContextItem {
  // 首行取"第一个非空行"并去首尾空白：否则 chip 标题会带上缩进，读起来像坏数据。
  const firstLine = (entry.body.split('\n').find((line) => line.trim()) ?? '').trim();
  const title = entry.title || firstLine.slice(0, 40) || '速记';
  const sourceLabel = SCRATCHPAD_SOURCE_LABELS[entry.sourceKind] ?? entry.sourceKind;
  const lines = [`【引用速记 ${title}】`, `> 来源：${sourceLabel}${entry.sourceRef ? ` · ${entry.sourceRef}` : ''}`];
  if (entry.kind === 'image') {
    lines.push('> 内容：图片速记（图片本身未随引用上传，仅标注存在）');
  } else {
    const chars = Array.from(entry.body);
    const clipped = chars.length > MAX_SCRATCHPAD_BLOCK_CHARS
      ? `${chars.slice(0, MAX_SCRATCHPAD_BLOCK_CHARS).join('')}\n…（速记过长，已截断前 ${MAX_SCRATCHPAD_BLOCK_CHARS} 字）`
      : entry.body;
    lines.push(...clipped.split('\n').map((line) => `> ${line}`));
  }
  return {
    id: `ctx-scratch-${entry.entryId}`,
    kind: 'scratchpad',
    group: 'reference',
    label: title,
    source: `速记板 · ${sourceLabel}`,
    lines,
    dedupeKey: `scratchpad|${entry.entryId}`,
    payload: { entryId: entry.entryId, kind: entry.kind, sourceRef: entry.sourceRef },
  };
}

/** 回复正文进引用块的上限（C4「加入上下文」；与速记块同量级，保持可读）。 */
export const MAX_MESSAGE_QUOTE_CHARS = 2000;

/**
 * 会话里的一条回复 → reference 组条目（C4「加入上下文」）。
 *
 * 为什么需要它：用户常要"就上一条回复继续追问/对比"，此前只能复制粘贴。
 * 走同一条唯一通道，因此可逐项移除、有上限、有来源标签。
 */
export function messageQuoteContextItem(input: {
  messageKey: string;
  content: string;
  conversationId?: string | null;
}): ComposerContextItem {
  const chars = Array.from(input.content);
  const clipped = chars.length > MAX_MESSAGE_QUOTE_CHARS
    ? `${chars.slice(0, MAX_MESSAGE_QUOTE_CHARS).join('')}\n…（回复过长，已截断前 ${MAX_MESSAGE_QUOTE_CHARS} 字）`
    : input.content;
  const firstLine = (clipped.split('\n').find((line) => line.trim()) ?? '').trim();
  const label = firstLine.slice(0, 40) || '上一条回复';
  return {
    id: `ctx-message-${input.messageKey}`,
    kind: 'message',
    group: 'reference',
    label,
    source: '会话回复',
    lines: [
      '【引用回复】',
      ...(input.conversationId ? [`> 会话：${input.conversationId}`] : []),
      ...clipped.split('\n').map((line) => `> ${line}`),
    ],
    dedupeKey: `message|${input.messageKey}`,
    payload: { messageKey: input.messageKey, conversationId: input.conversationId ?? null },
  };
}

export interface AppendContextResult {
  items: ComposerContextItem[];
  /** 因相邻同源被丢弃的条目（现状语义：与同组上一条完全同源 → 不重复计入）。 */
  deduped: boolean;
  /** 因组内上限被移出的条目数（现状语义：保留最后 N 条）。 */
  dropped: number;
}

/**
 * 追加一个条目：同组相邻同源去重 + 同组超限只保留最后 N 条。
 * 返回新数组与两个可见性信号（P5 的超限提示就读这两个字段，不再静默）。
 */
export function appendContextItem(prev: ComposerContextItem[], item: ComposerContextItem): AppendContextResult {
  if (item.dedupeKey !== null) {
    const lastOfGroup = [...prev].reverse().find((entry) => entry.group === item.group);
    if (lastOfGroup && lastOfGroup.dedupeKey === item.dedupeKey) {
      return { items: prev, deduped: true, dropped: 0 };
    }
  }
  const next = [...prev, item];
  const cap = CONTEXT_GROUP_CAPS[item.group];
  if (cap === null) return { items: next, deduped: false, dropped: 0 };
  const inGroup = next.filter((entry) => entry.group === item.group);
  if (inGroup.length <= cap) return { items: next, deduped: false, dropped: 0 };
  const keep = new Set(inGroup.slice(inGroup.length - cap).map((entry) => entry.id));
  const trimmed = next.filter((entry) => entry.group !== item.group || keep.has(entry.id));
  return { items: trimmed, deduped: false, dropped: inGroup.length - cap };
}

/** 移除一项（chip 的 × ）。 */
export function removeContextItem(prev: ComposerContextItem[], id: string): ComposerContextItem[] {
  return prev.filter((entry) => entry.id !== id);
}

/**
 * 组内分隔符按组而定：引用块之间空行（`\n\n`），附件行之间不空行
 * （现状 `composeAttachmentReferenceLines` 用 `join('\n')`）——附件仍是
 * 可逐项移除的独立条目，只是渲染形状保持原样。
 */
const GROUP_JOIN: Record<ContextGroup, string> = {
  image: '\n\n',
  reference: '\n\n',
  attachment: '\n',
};

/**
 * 唯一渲染入口：引用块在前（image 组 → reference 组）、用户文本居中、附件尾追。
 * 与收敛前 `composeMessageWithImageReferences(composeMessageWithSelectionReferences(...))
 * + composeAttachmentReferenceLines(...)` 逐字等价——由基线测钉住。
 */
export function composeContextMessage(text: string, items: ComposerContextItem[]): string {
  const renderGroup = (group: ContextGroup): string => items
    .filter((entry) => entry.group === group)
    .map((entry) => entry.lines.join('\n'))
    .join(GROUP_JOIN[group]);
  const referenceBlock = renderGroup('reference');
  const imageBlock = renderGroup('image');
  const attachmentBlock = renderGroup('attachment');
  let out = text;
  if (referenceBlock) out = `${referenceBlock}\n\n${out}`;
  if (imageBlock) out = `${imageBlock}\n\n${out}`;
  if (attachmentBlock) out = `${out}\n\n${attachmentBlock}`;
  return out;
}

/** 组内计数（composer 的「引用 N」提示与上限文案用）。 */
export function countContextGroup(items: ComposerContextItem[], group: ContextGroup): number {
  return items.filter((entry) => entry.group === group).length;
}
