/**
 * annotations.ts — BLOCK-219 Q6 批注契约（前端镜像）。
 *
 * 权威在 `core/shared-backend/result-annotation-contracts.js`：枚举、上限、归一化
 * 语义都以后端为准，本文件只做三件事：
 *   1. 把同一组词汇表达成类型（越界即编译错，不靠约定）；
 *   2. 提供**纯函数**把指针拖拽变成归一化矩形（跨缩放可复现的唯一算法）；
 *   3. 把批注组装成「加入任务」的中文结构化引用（单一构造器，测试钉住边界）。
 *
 * 不变量：
 * - 坐标永远 0..1 归一化，像素只活在组件局部（缩放/DPI 不进库、不进 prompt）。
 * - prompt 有界：只带前 MAX_ANNOTATIONS_IN_PROMPT 条明细，其余如实报计数。
 * - 批注是旁路元数据：prompt 里必须声明「原始产物未被修改」，不暗示已改动文件。
 */

type AnnotationSurface = 'result-artifact' | 'workspace-file' | 'scratchpad-entry';
export type AnnotationColor = 'amber' | 'sky' | 'rose';
export type AnnotationKind = 'region' | 'ellipse' | 'arrow' | 'text' | 'mosaic' | 'text-selection';

export const ANNOTATION_COLORS: readonly AnnotationColor[] = ['amber', 'sky', 'rose'];
export const ANNOTATION_KINDS: readonly AnnotationKind[] = ['region', 'ellipse', 'arrow', 'text', 'mosaic', 'text-selection'];

export const ANNOTATION_KIND_LABELS: Record<AnnotationKind, string> = {
  region: '矩形',
  ellipse: '椭圆',
  arrow: '箭头',
  text: '文本',
  mosaic: '马赛克',
  // 与图形「文本」区分：这是锚在源码行范围上的批注，不是画在图上的文字框。
  'text-selection': '文本批注',
};

/**
 * BLOCK-254 P5 — 文本锚点：与归一化矩形**互斥**的另一种定位方式。
 * 只用于工作区文件（结果产物是图像/PDF，没有文本行）。
 */
export type AnchorUnit = 'line' | 'paragraph' | 'row';

export const ANCHOR_UNITS: readonly AnchorUnit[] = ['line', 'paragraph', 'row'];

export interface TextAnchor {
  kind: 'text-range';
  /** 序号语义：源码行 / 文档段落 / 表格行（缺省 line）。 */
  unit?: AnchorUnit;
  startLine: number;
  endLine: number;
  startColumn: number | null;
  endColumn: number | null;
  /** 选中原文（≤500 字）；没有它就无法校验锚点是否还指得住。 */
  quote: string;
  language: string | null;
}

export const MAX_ANCHOR_QUOTE_CHARS = 500;

export function describeAnnotationKind(kind: AnnotationKind | null | undefined): string {
  return ANNOTATION_KIND_LABELS[kind || 'region'];
}

/** 与后端 MAX_ANNOTATION_COMMENT_CHARS 同一数值（后端拒绝，前端 maxLength 提前挡）。 */
export const MAX_ANNOTATION_COMMENT_CHARS = 2000;
/** 单条 prompt 最多列出的批注明细数；超出只报计数，不让上下文无界膨胀。 */
export const MAX_ANNOTATIONS_IN_PROMPT = 20;
/** 指针拖拽产生的最小边长（归一化）；小于它视为误触，不创建批注。 */
const MIN_ANNOTATION_SIDE = 0.004;

/**
 * BLOCK-254 B-1 — 马赛克遮蔽边界（唯一措辞源）。
 *
 * 马赛克只是**屏显遮蔽**：它在查看器里把该区域模糊掉，既不裁掉像素，
 * 也不写回产物文件，更不做任何脱敏。任何「已遮蔽敏感信息 / 已打码」的说法
 * 都是超出实现能力的承诺，必须用下面这句话纠正。
 */
export const MOSAIC_DISCLOSURE = '马赛克只是屏显遮蔽，不是脱敏；原图与产物文件不会被修改。';

/** 短位（工具条 hint / 悬停标题）用的同一句话的压缩形态，避免长句撑破单行。 */
export const MOSAIC_SHORT = '仅屏显遮蔽，不是脱敏';

/** 「加入任务」里对马赛克条目的补充声明（只在真有马赛克批注时追加）。 */
export function mosaicTaskNote(count: number): string {
  return `其中 ${count} 条为「马赛克」标记：${MOSAIC_DISCLOSURE}请勿把遮蔽区域当作已移除的敏感信息。`;
}

/**
 * BLOCK-254 B-2 — 撤销边界（唯一判定源）。
 *
 * 边界（写死，不接受隐式扩张）：
 *  - **仅本次会话**：栈只活在 `useAnnotationSession` 的内存里，刷新/切 scope 即失效；
 *  - **仅当前 scope**：scope 身份一变视为空栈（同 pending 的纪律，不靠 effect 清空）；
 *  - **有界**：只保留最近 `MAX_ANNOTATION_UNDO` 次补偿，最旧的被丢弃；
 *  - **只做撤销，不做重做**：删除的补偿是「按原内容重建」，会生成新 annotationId；
 *    在这个不对称语义上再做 redo 只会形成 id 漂移链，故 redo 明确非范围。
 */
export const MAX_ANNOTATION_UNDO = 10;

export type AnnotationUndoAction =
  | { type: 'created'; annotationId: string }
  | { type: 'deleted'; annotation: ArtifactAnnotation };

/** 入栈（有界）；纯函数，便于把「上限语义」钉在测试里。 */
export function appendUndoAction(
  actions: readonly AnnotationUndoAction[],
  action: AnnotationUndoAction,
  max: number = MAX_ANNOTATION_UNDO,
): AnnotationUndoAction[] {
  const limit = Number.isInteger(max) && max > 0 ? max : MAX_ANNOTATION_UNDO;
  return [...actions, action].slice(-limit);
}

/** 撤销按钮 title：删除的补偿必须如实说明「重建为新条目」（id 会变）。 */
export function undoActionLabel(action: AnnotationUndoAction | null | undefined): string {
  if (!action) return '';
  return action.type === 'created'
    ? '撤销刚才的创建'
    : '撤销刚才的删除（将按原内容重建为新条目）';
}

export type CssSupportProbe = (property: string, value: string) => boolean;

/**
 * 当前环境是否支持 `backdrop-filter`（不支持的实现会静默什么都不遮，必须降级）。
 * 探测函数可注入，便于在 jsdom 里断言两条分支。
 */
export function supportsBackdropFilter(probe?: CssSupportProbe | null): boolean {
  const resolve = probe === undefined
    ? (typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
      ? (property: string, value: string) => CSS.supports(property, value)
      : null)
    : probe;
  if (!resolve) return false;
  try {
    return resolve('backdrop-filter', 'blur(1px)') || resolve('-webkit-backdrop-filter', 'blur(1px)');
  } catch {
    return false;
  }
}

export interface ArtifactAnnotation {
  annotationId: string;
  contractVersion: number;
  projectId: string;
  conversationId: string | null;
  surface: AnnotationSurface;
  artifactId: string | null;
  revisionId: string | null;
  filePath: string | null;
  /** 仅 `surface='scratchpad-entry'` 有值。 */
  entryId: string | null;
  artifactName: string | null;
  kind: AnnotationKind;
  page: number | null;
  /** 区域批注为四元组；文本锚点批注为空数组（坐标由 anchor 取代）。 */
  rect: number[];
  /** 文本锚点批注为 `text-range` 对象；区域批注恒为 null。 */
  anchor: TextAnchor | null;
  comment: string;
  color: AnnotationColor;
  author: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnnotationScope {
  projectId: string;
  surface: AnnotationSurface;
  artifactId?: string | null;
  revisionId?: string | null;
  filePath?: string | null;
  /** 仅 `surface='scratchpad-entry'` 使用。 */
  entryId?: string | null;
}

export interface CreateAnnotationInput extends AnnotationScope {
  conversationId?: string | null;
  artifactName?: string | null;
  page?: number | null;
  /** 区域批注必填；`kind='text-selection'` 时必须省略（契约拒绝两者同时出现）。 */
  rect?: [number, number, number, number];
  /** 仅 `kind='text-selection'` 使用。 */
  anchor?: TextAnchor;
  comment: string;
  color?: AnnotationColor;
  kind?: AnnotationKind;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * 指针拖拽 → 归一化矩形。
 *
 * @param start 起点（0..1）
 * @param current 当前点（0..1）
 * @returns null = 拖拽过小（误触）；否则 [x, y, w, h] 全部非负且落在 [0,1]
 */
export function normalizePointerRect(
  start: { x: number; y: number },
  current: { x: number; y: number },
): [number, number, number, number] | null {
  const x1 = clamp01(Math.min(start.x, current.x));
  const y1 = clamp01(Math.min(start.y, current.y));
  const x2 = clamp01(Math.max(start.x, current.x));
  const y2 = clamp01(Math.max(start.y, current.y));
  const width = round4(x2 - x1);
  const height = round4(y2 - y1);
  if (width < MIN_ANNOTATION_SIDE || height < MIN_ANNOTATION_SIDE) return null;
  return [round4(x1), round4(y1), width, height];
}

/**
 * 容器内的指针坐标 → 归一化坐标（矩形外沿被钳制到容器边界）。
 *
 * 用 `getBoundingClientRect()` 而不是 `offsetWidth`：覆盖层可能被缩放/滚动，
 * rect 是唯一与视觉一致的尺寸来源。宽高为 0 的容器（未挂载/隐藏）返回 null。
 */
export function pointToNormalized(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: clamp01((clientX - rect.left) / rect.width),
    y: clamp01((clientY - rect.top) / rect.height),
  };
}

/** 归一化矩形 → 覆盖层内联样式（百分比定位，跨缩放天然一致）。 */
export function rectToStyle(rect: readonly number[]): {
  left: string; top: string; width: string; height: string;
} {
  const [x = 0, y = 0, width = 0, height = 0] = rect;
  return {
    left: `${(clamp01(x) * 100).toFixed(2)}%`,
    top: `${(clamp01(y) * 100).toFixed(2)}%`,
    width: `${(clamp01(width) * 100).toFixed(2)}%`,
    height: `${(clamp01(height) * 100).toFixed(2)}%`,
  };
}

/** 批注锚点的人类可读描述（「第 12 行」/「第 2 页」/「图像区域」）。 */
export function describeAnnotationAnchor(
  annotation: Pick<ArtifactAnnotation, 'page' | 'surface'> & { anchor?: TextAnchor | null },
): string {
  const anchor = annotation.anchor;
  if (anchor && Number.isInteger(anchor.startLine) && anchor.startLine > 0) {
    const unitLabel = anchor.unit === 'paragraph' ? '段' : '行';
    const head = anchor.unit === 'row' ? '表格第 ' : '第 ';
    return anchor.startLine === anchor.endLine
      ? `${head}${anchor.startLine} ${unitLabel}`
      : `${head}${anchor.startLine}–${anchor.endLine} ${unitLabel}`;
  }
  if (typeof annotation.page === 'number' && annotation.page > 0) return `第 ${annotation.page} 页`;
  if (annotation.surface === 'workspace-file') return '文件区域';
  if (annotation.surface === 'scratchpad-entry') return '速记图片';
  return '图像区域';
}

function formatPercentRect(rect: readonly number[]): string {
  const [x = 0, y = 0, width = 0, height = 0] = rect;
  const pct = (value: number) => `${Math.round(clamp01(value) * 100)}%`;
  return `(${pct(x)}, ${pct(y)}, ${pct(width)}×${pct(height)})`;
}

export interface AnnotationTaskTarget {
  surface: AnnotationSurface;
  artifactId?: string | null;
  revisionId?: string | null;
  artifactName?: string | null;
  revisionOrdinal?: number | null;
  filePath?: string | null;
  jobId?: string | null;
}

/**
 * 组装「加入任务」prompt。
 *
 * 该字符串是批注进入 Agent 上下文的**唯一**形态：产物身份 + 页/坐标 + 评论，
 * 并显式声明「批注是旁路元数据，原始产物未被修改」——否则模型会误以为需要
 * 重新读取被改写的文件。
 */
export function buildAnnotationTaskPrompt(
  annotations: readonly (Pick<ArtifactAnnotation, 'rect' | 'comment' | 'page' | 'surface'>
    & { kind?: AnnotationKind | null; anchor?: TextAnchor | null })[],
  target: AnnotationTaskTarget,
): string {
  const usable = annotations.filter((annotation) => annotation.comment.trim().length > 0);
  if (usable.length === 0) return '';

  const name = target.artifactName || target.filePath || '当前产物';
  const identityParts: string[] = [];
  if (target.jobId) identityParts.push(`任务 ${target.jobId}`);
  if (target.revisionOrdinal) identityParts.push(`第 ${target.revisionOrdinal} 版`);
  const identity = identityParts.length > 0 ? `（${identityParts.join('，')}）` : '';
  const head = target.surface === 'workspace-file'
    ? `请查看工作区文件「${name}」中的 ${usable.length} 条批注并给出结论或下一步：`
    : `请基于结果产物「${name}」${identity}的 ${usable.length} 条批注继续分析：`;

  const shown = usable.slice(0, MAX_ANNOTATIONS_IN_PROMPT);
  const lines = shown.map((annotation, index) => {
    // 文本锚点没有区域坐标：报行号比报一个假的 (0%,0%,0%×0%) 诚实。
    const where = annotation.anchor
      ? describeAnnotationAnchor(annotation)
      : `${describeAnnotationAnchor(annotation)} ${formatPercentRect(annotation.rect)}`;
    return `${index + 1}. ${where}：${annotation.comment.trim()}`;
  });
  const omitted = usable.length - shown.length;
  if (omitted > 0) lines.push(`… 另有 ${omitted} 条批注未逐条展开（可在结果面板查看）。`);

  // 只在该批注集真有马赛克时追加边界声明，避免无马赛克的任务被噪声干扰。
  const mosaicCount = usable.filter((annotation) => annotation.kind === 'mosaic').length;
  const notes = [
    '坐标是相对页/图的百分比区域。批注只存在于旁路元数据中，原始产物文件未被修改；'
      + '如需重新定位请以坐标为准，不要假设文件已被编辑。',
  ];
  if (mosaicCount > 0) notes.push(mosaicTaskNote(mosaicCount));

  return [head, ...lines, ...notes].join('\n');
}
