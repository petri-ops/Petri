import type { ResultArtifactKind } from '@/lib/result-manifest';

export type ResultSurfaceMode = 'result' | 'compare' | 'history';
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
  openStart: 'biof3:result-surface:open-start',
  openEnd: 'biof3:result-surface:open-end',
  openMeasure: 'biof3:result-surface:first-visible',
  artifactStart: 'biof3:result-surface:artifact-start',
  artifactEnd: 'biof3:result-surface:artifact-end',
  artifactMeasure: 'biof3:result-surface:artifact-switch',
  returnStart: 'biof3:result-surface:return-start',
  returnEnd: 'biof3:result-surface:return-end',
  returnMeasure: 'biof3:result-surface:return-conversation',
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
  if (input.kind === 'plot' || /\.(png|jpe?g|gif|svg|webp)$/.test(name)) return 'image';
  if (input.kind === 'table' || /\.(csv|tsv|xlsx?)$/.test(name)) return 'table';
  if (/\.json$/.test(name)) return 'json';
  if (input.kind === 'text' || /\.(txt|md|log|ya?ml)$/.test(name)) return 'text';
  return 'binary';
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
