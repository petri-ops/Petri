import type { ResultArtifactKind } from '@/lib/result-manifest';
import { isTextFile } from '@/lib/previewFileUtils';

export type ResultSurfaceMode = 'result' | 'code' | 'compare' | 'history';
export type ResultViewerAdapter = 'report' | 'image' | 'table' | 'json' | 'text' | 'binary';
export type ResultTruthTone = 'valid' | 'degraded' | 'blocked' | 'running' | 'unknown';

export const RESULT_SURFACE_PERFORMANCE_BUDGETS = Object.freeze({
  firstCanvasVisibleMs: 1_000,
  artifactSwitchMs: 500,
  tableScrollResponseMs: 100,
  selectionFeedbackMs: 100,
  parameterPreviewMs: 500,
  compareOpenMs: 1_000,
  restartRestoreMs: 5_000,
  returnConversationMs: 250,
  maxToggleHeapGrowthBytes: 64 * 1024 * 1024,
});

export const RESULT_SURFACE_PERFORMANCE_MARKS = Object.freeze({
  openStart: 'gewu:result-surface:open-start',
  openEnd: 'gewu:result-surface:open-end',
  openMeasure: 'gewu:result-surface:first-visible',
  artifactStart: 'gewu:result-surface:artifact-start',
  artifactEnd: 'gewu:result-surface:artifact-end',
  artifactMeasure: 'gewu:result-surface:artifact-switch',
  returnStart: 'gewu:result-surface:return-start',
  returnEnd: 'gewu:result-surface:return-end',
  returnMeasure: 'gewu:result-surface:return-conversation',
});

export function beginResultSurfaceMeasure(markName: string): void {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return;
  performance.clearMarks(markName);
  performance.mark(markName);
}

export function completeResultSurfaceMeasure(input: {
  start: string;
  end: string;
  measure: string;
}): number | null {
  if (
    typeof performance === 'undefined' ||
    typeof performance.mark !== 'function' ||
    typeof performance.measure !== 'function' ||
    performance.getEntriesByName(input.start).length === 0
  ) return null;
  performance.clearMarks(input.end);
  performance.clearMeasures(input.measure);
  performance.mark(input.end);
  performance.measure(input.measure, input.start, input.end);
  const entries = performance.getEntriesByName(input.measure);
  return entries.length > 0 ? entries[entries.length - 1].duration : null;
}

export interface ResultTruthProjection {
  tone: ResultTruthTone;
  label: string;
}

export interface SelectionProjectionInput {
  entityIdCount?: number;
  fields?: string[];
  durable?: boolean;
  compatibility?: 'compatible' | 'stale' | 'invalid';
}

export function resolveResultViewerAdapter(input: {
  kind: ResultArtifactKind;
  fileName: string;
  preview?: boolean;
}): ResultViewerAdapter {
  const name = input.fileName.toLowerCase();
  if (input.preview === false) return 'binary';
  if (input.kind === 'report' || /\.html?$/.test(name)) return 'report';
  if (/\.pdf$/.test(name)) return 'binary';
  if (input.kind === 'plot' || /\.(png|jpe?g|gif|svg|webp)$/.test(name)) return 'image';
  if (/\.xlsx?$/.test(name)) return 'binary';
  if (input.kind === 'table' || /\.(csv|tsv)$/.test(name)) return 'table';
  if (/\.json$/.test(name)) return 'json';
  if (input.kind === 'text' || isTextFile(name)) return 'text';
  return 'binary';
}

/**
 * Tables require interaction metadata for their full viewer, while images may
 * opt into a trusted scatter/matrix projection declared by the plugin.
 */
export function shouldRequestArtifactInteraction(adapter: ResultViewerAdapter): boolean {
  return adapter === 'table' || adapter === 'image';
}

/**
 * Image interaction is progressive enhancement: a failed discovery must leave
 * the static plot quiet and usable. A table failure is a material viewer
 * degradation, so it remains visible and retryable.
 */
export function shouldSurfaceInteractionFailure(adapter: ResultViewerAdapter): boolean {
  return adapter === 'table';
}

/**
 * A generated plot is the scientific result of record. Its generic interaction
 * projection is progressive enhancement and must only replace the image after
 * an explicit user action. Tables, by contrast, use their interactive viewer as
 * the primary readable surface.
 */
export function shouldShowResultInteraction(input: {
  adapter: ResultViewerAdapter;
  interactionAvailable: boolean;
  interactionRequested: boolean;
}): boolean {
  if (!input.interactionAvailable) return false;
  if (input.adapter === 'table') return true;
  return input.adapter === 'image' && input.interactionRequested;
}

export function resolveResultArtifactUrl(
  declaredUrl: string | null | undefined,
  fallbackUrl: string,
): string {
  const value = String(declaredUrl || '').trim();
  if (!value) return fallbackUrl;
  if (/^(https?:|blob:)/i.test(value) || (/^\/(?!\/)/.test(value))) return value;
  return fallbackUrl;
}

export function chooseResultArtifactName(input: {
  currentName?: string | null;
  pendingName?: string | null;
  preferredName?: string | null;
  availableNames: string[];
}): string {
  const available = new Set(input.availableNames);
  if (input.pendingName && available.has(input.pendingName)) return input.pendingName;
  if (input.currentName && available.has(input.currentName)) return input.currentName;
  if (input.preferredName && available.has(input.preferredName)) return input.preferredName;
  return input.availableNames[0] || '';
}

export function requestedArtifactRequestKey(input: {
  projectId?: string | null;
  jobId?: string | null;
  artifactName?: string | null;
}): string | null {
  if (!input.projectId || !input.jobId || !input.artifactName) return null;
  return JSON.stringify([input.projectId, input.jobId, input.artifactName]);
}

export function shouldApplyRequestedArtifact(
  lastAppliedKey: string | null,
  nextKey: string | null,
): boolean {
  return nextKey !== null && nextKey !== lastAppliedKey;
}

export function chooseResultSectionLandingName(
  artifacts: Array<{ name: string; preview?: boolean }>,
): string {
  return artifacts.find((artifact) => artifact.preview !== false)?.name || artifacts[0]?.name || '';
}

export function describeTruthStatus(
  truthStatus: string | null | undefined,
  jobStatus: string | null | undefined,
): ResultTruthProjection {
  if (jobStatus === 'running' || jobStatus === 'pending') {
    return { tone: 'running', label: jobStatus === 'running' ? '正在生成' : '等待运行' };
  }
  if (truthStatus === 'valid') return { tone: 'valid', label: '可信结果' };
  if (truthStatus === 'degraded') return { tone: 'degraded', label: '需要复核' };
  if (truthStatus === 'blocked' || jobStatus === 'failed') return { tone: 'blocked', label: '结果已阻断' };
  return { tone: 'unknown', label: '尚未核验' };
}

/**
 * The version a user reads in the result header.
 *
 * The acceptance matrix asks for 「结果名称 · vN · validation」, but the only
 * available input used to be the Revision ID, which this truncated into
 * 「版本 a3f9c21b」 — an opaque fragment presented where an ordinal was
 * promised. `revision_ordinal` existed in SQL from the start
 * (001_result_studio.sql:62, unique per family) and the interaction endpoint
 * already returned it; the client simply discarded it.
 *
 * With an ordinal, this reads `v2`. Without one it degrades to a statement of
 * what is known — never to a truncated id dressed up as a version.
 */
export function shortRevisionLabel(
  revisionId: string | null | undefined,
  revisionOrdinal?: number | null,
): string {
  if (Number.isInteger(revisionOrdinal) && (revisionOrdinal as number) >= 1) {
    return `v${revisionOrdinal}`;
  }
  if (!revisionId) return '原始结果';
  // Honest degradation: we know a revision exists but not which number it is.
  return '当前版本';
}

export function describeSelection(selection: SelectionProjectionInput | null | undefined): string {
  if (!selection) return '未选择对象';
  const count = Math.max(0, Number(selection.entityIdCount || 0));
  const fieldCount = Array.isArray(selection.fields) ? selection.fields.length : 0;
  if (count === 0 && fieldCount === 0) return '未选择对象';
  const scope = selection.compatibility === 'stale'
    ? '已过期'
    : selection.compatibility === 'invalid'
      ? '不可用'
      : selection.durable ? '可恢复' : '当前会话';
  if (count > 0) return `已选择 ${count} 个对象 · ${scope}`;
  return `已选择 ${fieldCount} 列 · ${scope}`;
}

/**
 * BIO-6（BIO-D4 裁决 b：单一真相）— 「解释当前结果」解读 prompt 的唯一出词口。
 *
 * 解读统一走 Agent + result_summary 链：prompt 锚定任务与产物坐标，要求
 * Agent 先调用 result_summary 读取有界真值再解读，引用的数字必须来自工具
 * 返回。不接遗留 /api/ai/interpret 模板，也不允许各入口各自拼 prompt 造
 * 第二解读真相——CenterPanel（询问 Agent）与 ResultStudioInspector（解释
 * 当前结果）两个入口都经本构造器取词。jobId 缺失的退化路径不伪造任务锚点，
 * 但保持同一条 result_summary 纪律（Agent 侧 bind_artifact 血统链兜底）。
 */
export function buildResultInterpretationPrompt(input: {
  jobId?: string | null;
  artifactName?: string | null;
}): string {
  const jobId = String(input.jobId || '').trim();
  const artifactName = String(input.artifactName || '').trim();
  const target = jobId
    ? `任务 ${jobId} 的结果 ${artifactName || '当前产物'}`
    : `当前结果${artifactName ? `“${artifactName}”` : ''}`;
  return `请解读${target}：先调用 result_summary 工具读取该结果的有界真值，基于返回数据解读主要结论、可信边界与建议的下一步；引用的数字必须来自工具返回，不得编造。`;
}
