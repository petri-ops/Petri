import type { ReactElement } from 'react';
import type { ResultStudioComparison } from '../resultStudioClient';
import styles from '../ResultStudioChangeSetPanel.module.css';

// BLOCK-92 Wave B-8 — ResultStudioChangeSetPanel 纯展示/解析函数外迁
// （原文件内联，纯搬运零行为变化）。

export const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  running: '处理中',
  preview_ready: '待采用',
  validation_failed: '验证失败',
  adopted: '已采用',
  reverted: '已撤销',
  abandoned: '已放弃',
};

export const IMPACT_LABEL: Record<string, string> = {
  view_only: '仅查看',
  presentation_rerender: '展示变化',
  data_transform: '数据变化',
  scientific_recompute: '科学重算',
  workflow_replan: '流程变化',
  version_restore: '版本恢复',
};

export const SCOPE_LABEL: Record<string, string> = {
  none: '不影响结果',
  current_result_only: '仅当前结果',
  workflow_subgraph: '影响下游流程',
  unknown: '影响范围待确认',
};

export const VALIDATION_LABEL: Record<string, string> = {
  valid: '验证通过',
  degraded: '验证需要复核',
  blocked: '验证已阻断',
};

export type ResultStudioReviewMode = 'result' | 'compare' | 'history';

export function fileName(path: string): string {
  return path.split('/').pop() || path;
}

function redactWindowsCoordinates(value: string): string {
  let output = '';
  let index = 0;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    const startsCoordinate = ((code >= 65 && code <= 90) || (code >= 97 && code <= 122))
      && value[index + 1] === ':' && value.charCodeAt(index + 2) === 92;
    if (!startsCoordinate) {
      output += value[index];
      index += 1;
      continue;
    }
    const quote = index > 0 && (value[index - 1] === '"' || value[index - 1] === "'")
      ? value[index - 1]
      : null;
    let end = index + 3;
    while (end < value.length) {
      const character = value[end];
      if (character === '\r' || character === '\n'
          || (quote ? character === quote : /\s|["'`<>]/.test(character))) break;
      end += 1;
    }
    output += '[project file]';
    index = end;
  }
  return output;
}

export function publicDisplayText(value: string): string {
  return redactWindowsCoordinates(value
    .replace(/(["'])(?:\/Users\/|\/home\/)[^"'\r\n]*\1/g, '$1[project file]$1')
    .replace(/(?:\/Users\/|\/home\/)[^\s"'`<>]*/g, '[project file]'));
}

export function displayValue(value: unknown): string {
  if (value == null) return '—';
  return publicDisplayText(typeof value === 'string' ? value : JSON.stringify(value));
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function measuredNumber(
  measurement: { status: 'measured' | 'partial' | 'unavailable'; value: number | null },
  formatter: (value: number) => string,
): string {
  if (measurement.value == null || measurement.status === 'unavailable') return '不可用';
  const formatted = formatter(measurement.value);
  return measurement.status === 'partial' ? `至少 ${formatted}` : formatted;
}

export function measuredCost(
  measurement: { status: 'measured' | 'partial' | 'unavailable'; value: number | null; unit: string | null },
): string {
  if (measurement.status !== 'measured' || measurement.value == null || !measurement.unit) return '不可用';
  return `${measurement.unit} ${measurement.value}`;
}

export interface EnrichmentDirectionEntry {
  id: string;
  direction: string;
}

export interface EnrichmentDirectionChange {
  id: string;
  before: string;
  after: string;
}

export interface AvailableEnrichmentDirection {
  changedCount: number;
  before: EnrichmentDirectionEntry[];
  after: EnrichmentDirectionEntry[];
  changes: EnrichmentDirectionChange[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function directionEntries(value: unknown): EnrichmentDirectionEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: EnrichmentDirectionEntry[] = [];
  for (const item of value) {
    const candidate = record(item);
    if (!candidate || typeof candidate.id !== 'string' || typeof candidate.direction !== 'string') return null;
    entries.push({ id: candidate.id, direction: candidate.direction });
  }
  return entries;
}

function directionChanges(value: unknown): EnrichmentDirectionChange[] | null {
  if (!Array.isArray(value)) return null;
  const changes: EnrichmentDirectionChange[] = [];
  for (const item of value) {
    const candidate = record(item);
    if (!candidate || typeof candidate.id !== 'string'
        || typeof candidate.before !== 'string' || typeof candidate.after !== 'string') return null;
    changes.push({ id: candidate.id, before: candidate.before, after: candidate.after });
  }
  return changes;
}

function availableEnrichmentDirection(value: unknown): AvailableEnrichmentDirection | null {
  const candidate = record(value);
  if (!candidate || candidate.status !== 'available'
      || typeof candidate.changedCount !== 'number' || !Number.isInteger(candidate.changedCount)
      || candidate.changedCount < 0) return null;
  const before = directionEntries(candidate.before);
  const after = directionEntries(candidate.after);
  const changes = directionChanges(candidate.changes);
  if (!before || !after || !changes || candidate.changedCount !== changes.length) return null;
  return { changedCount: candidate.changedCount, before, after, changes };
}

function formatDirectionEntries(entries: EnrichmentDirectionEntry[]): string {
  return entries.map((entry) => `${entry.id} ${entry.direction}`).join('、') || '无';
}

export function executedNodeIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

// BLOCK-150 ⑫ 渲染层领域盲契约（docs/artifact-plane-direction.md §2）：行标签用
// 中性统计词汇（条目 / 效应量），不得回退为「基因 / padj / log2FC」等领域词；
// 领域语义由数据键与 producer schema 承载，不进渲染文案。
export function ScientificDifference({ scientific }: { scientific: NonNullable<ResultStudioComparison['artifacts'][number]['scientific']> }): ReactElement {
  if (scientific.status === 'unavailable') {
    return <p className={styles.scientificUnavailable}>科学差异暂不可用：{scientific.reason || '来源表缺少可验证的语义契约。'}</p>;
  }
  if (scientific.kind === 'differential_expression' && scientific.significantGenes) {
    const { before, after, membership } = scientific.significantGenes;
    return <table className={styles.tableCompare}><tbody>
      <tr><td>显著条目</td><td>{before.significantCount} → {after.significantCount}</td></tr>
      <tr><td>上调 / 下调</td><td>{before.upCount} / {before.downCount} → {after.upCount} / {after.downCount}</td></tr>
      <tr><td>关键条目变化</td><td>新增 {membership.gainedCount}，移除 {membership.lostCount}；{[...membership.gained, ...membership.lost].join('、') || '无'}</td></tr>
      {scientific.thresholds && <tr><td>阈值 (调整 p / |效应量|)</td><td>{scientific.thresholds.before.padjCutoff} / {scientific.thresholds.before.lfcCutoff} → {scientific.thresholds.after.padjCutoff} / {scientific.thresholds.after.lfcCutoff}</td></tr>}
    </tbody></table>;
  }
  if (scientific.kind === 'volcano_classification' && scientific.classifications) {
    const { before, after, membership } = scientific.classifications;
    return <table className={styles.tableCompare}><tbody>
      <tr><td>显著分类</td><td>{before.significantCount} → {after.significantCount}</td></tr>
      <tr><td>上调 / 下调</td><td>{before.upCount} / {before.downCount} → {after.upCount} / {after.downCount}</td></tr>
      <tr><td>标记条目变化</td><td>新增 {membership.gainedCount}，移除 {membership.lostCount}；{[...membership.gained, ...membership.lost].join('、') || '无'}</td></tr>
    </tbody></table>;
  }
  if (scientific.kind === 'functional_enrichment' && scientific.terms) {
    const direction = availableEnrichmentDirection(scientific.direction);
    return <table className={styles.tableCompare}><tbody>
      <tr><td>富集条目</td><td>{scientific.terms.beforeCount} → {scientific.terms.afterCount}</td></tr>
      <tr><td>通路变化</td><td>新增 {scientific.terms.membership.gainedCount}，移除 {scientific.terms.membership.lostCount}</td></tr>
      <tr><td>前列通路</td><td>{scientific.terms.topBefore.slice(0, 3).map((item) => item.id).join('、') || '—'} → {scientific.terms.topAfter.slice(0, 3).map((item) => item.id).join('、') || '—'}</td></tr>
      <tr><td>方向变化</td><td>{direction
        ? `${direction.changedCount} 条；${direction.changes.map((item) => `${item.id} ${item.before} → ${item.after}`).join('、') || '无'}`
        : scientific.direction?.status === 'available'
          ? '方向明细不完整，未作推断'
          : '当前结果表未声明方向，未作推断'}</td></tr>
      {direction && <tr><td>前列通路方向</td><td>{formatDirectionEntries(direction.before)} → {formatDirectionEntries(direction.after)}</td></tr>}
    </tbody></table>;
  }
  return <p className={styles.scientificUnavailable}>科学差异没有可展示的受信摘要。</p>;
}
