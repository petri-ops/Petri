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

type AnnotationSurface = 'result-artifact' | 'workspace-file';
export type AnnotationColor = 'amber' | 'sky' | 'rose';
type AnnotationKind = 'region' | 'ellipse' | 'arrow';

export const ANNOTATION_COLORS: readonly AnnotationColor[] = ['amber', 'sky', 'rose'];

/** 与后端 MAX_ANNOTATION_COMMENT_CHARS 同一数值（后端拒绝，前端 maxLength 提前挡）。 */
export const MAX_ANNOTATION_COMMENT_CHARS = 2000;
/** 单条 prompt 最多列出的批注明细数；超出只报计数，不让上下文无界膨胀。 */
export const MAX_ANNOTATIONS_IN_PROMPT = 20;
/** 指针拖拽产生的最小边长（归一化）；小于它视为误触，不创建批注。 */
const MIN_ANNOTATION_SIDE = 0.004;

export interface ArtifactAnnotation {
  annotationId: string;
  contractVersion: number;
  projectId: string;
  conversationId: string | null;
  surface: AnnotationSurface;
  artifactId: string | null;
  revisionId: string | null;
  filePath: string | null;
  artifactName: string | null;
  kind: AnnotationKind;
  page: number | null;
  rect: [number, number, number, number];
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
}

export interface CreateAnnotationInput extends AnnotationScope {
  conversationId?: string | null;
  artifactName?: string | null;
  page?: number | null;
  rect: [number, number, number, number];
  comment: string;
  color?: AnnotationColor;
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

/** 批注锚点的人类可读描述（「第 2 页」/「图像区域」）。 */
export function describeAnnotationAnchor(annotation: Pick<ArtifactAnnotation, 'page' | 'surface'>): string {
  if (typeof annotation.page === 'number' && annotation.page > 0) return `第 ${annotation.page} 页`;
  return annotation.surface === 'workspace-file' ? '文件区域' : '图像区域';
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
  annotations: readonly Pick<ArtifactAnnotation, 'rect' | 'comment' | 'page' | 'surface'>[],
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
    const anchor = describeAnnotationAnchor(annotation);
    return `${index + 1}. ${anchor} ${formatPercentRect(annotation.rect)}：${annotation.comment.trim()}`;
  });
  const omitted = usable.length - shown.length;
  if (omitted > 0) lines.push(`… 另有 ${omitted} 条批注未逐条展开（可在结果面板查看）。`);

  return [
    head,
    ...lines,
    '坐标是相对页/图的百分比区域。批注只存在于旁路元数据中，原始产物文件未被修改；'
      + '如需重新定位请以坐标为准，不要假设文件已被编辑。',
  ].join('\n');
}
