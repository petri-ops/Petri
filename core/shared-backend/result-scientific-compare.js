'use strict';

/**
 * G0-RS-P5 — bounded, schema-declared scientific comparison.
 *
 * This module never guesses a biological conclusion from an arbitrary CSV.
 * Only the formal artifact identities and schemas declared by the built-in
 * Result Studio contracts are interpreted.  Any missing schema, duplicate
 * stable identifier, malformed numeric value or oversized table becomes an
 * explicit `unavailable` result rather than a plausible-looking statistic.
 */

const fs = require('fs');

const SCIENTIFIC_COMPARE_VERSION = 1;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_KEY_ENTITIES = 20;

function unavailable(kind, reason) {
  return { scientificComparisonVersion: SCIENTIFIC_COMPARE_VERSION, status: 'unavailable', kind, reason };
}

function splitDelimitedLine(line, delimiter) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1; continue; }
      quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) { cells.push(current); current = ''; continue; }
    current += char;
  }
  cells.push(current);
  return cells;
}

function readExactTable(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_BYTES) return { ok: false, reason: 'scientific_table_exceeds_exact_bound' };
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return { ok: false, reason: 'scientific_table_empty' };
  const delimiter = (lines[0].match(/\t/g) || []).length > (lines[0].match(/,/g) || []).length ? '\t' : ',';
  const columns = splitDelimitedLine(lines[0], delimiter).map((value) => value.trim());
  if (columns.length === 0 || columns.some((value) => !value)) return { ok: false, reason: 'scientific_table_header_invalid' };
  if (new Set(columns.map((value) => value.toLowerCase())).size !== columns.length) {
    return { ok: false, reason: 'scientific_table_header_ambiguous' };
  }
  const rows = [];
  for (const line of lines.slice(1)) {
    const values = splitDelimitedLine(line, delimiter);
    if (values.length !== columns.length) return { ok: false, reason: 'scientific_table_row_shape_invalid' };
    rows.push(Object.fromEntries(columns.map((column, index) => [column, values[index]])));
  }
  return { ok: true, columns, rows };
}

function findColumn(columns, aliases) {
  const byLower = new Map(columns.map((column) => [column.toLowerCase(), column]));
  for (const alias of aliases) if (byLower.has(alias.toLowerCase())) return byLower.get(alias.toLowerCase());
  return null;
}

function number(value) {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stableRows(table, idColumn) {
  const rows = new Map();
  for (const row of table.rows) {
    const id = String(row[idColumn] || '').trim();
    if (!id || rows.has(id)) return null;
    rows.set(id, row);
  }
  return rows;
}

function bounded(values) {
  return [...values].sort().slice(0, MAX_KEY_ENTITIES);
}

function setChanges(before, after) {
  const gained = [];
  const lost = [];
  const retained = [];
  for (const id of after) (before.has(id) ? retained : gained).push(id);
  for (const id of before) if (!after.has(id)) lost.push(id);
  return {
    gainedCount: gained.length,
    lostCount: lost.length,
    retainedCount: retained.length,
    gained: bounded(gained),
    lost: bounded(lost),
  };
}

function degThresholds(params) {
  const padj = number(params?.padj_cutoff ?? params?.padj_threshold);
  const lfc = number(params?.lfc_cutoff ?? params?.lfc_threshold);
  return padj != null && padj >= 0 && padj <= 1 && lfc != null && lfc >= 0
    ? { padjCutoff: padj, lfcCutoff: lfc }
    : null;
}

function classifyDeg(table, thresholds) {
  const geneColumn = findColumn(table.columns, ['gene', 'gene_id']);
  const lfcColumn = findColumn(table.columns, ['log2FoldChange', 'log2FC']);
  const padjColumn = findColumn(table.columns, ['padj', 'p_adjust']);
  if (!geneColumn || !lfcColumn || !padjColumn) return null;
  const rows = stableRows(table, geneColumn);
  if (!rows) return null;
  const significant = new Set();
  let up = 0;
  let down = 0;
  for (const [gene, row] of rows) {
    const lfc = number(row[lfcColumn]);
    const padj = number(row[padjColumn]);
    if (lfc == null || padj == null || padj < 0 || padj > 1) return null;
    // Match the admitted DESeq2/go-kegg producers exactly. Boundary values
    // are not significant because both scripts use strict cutoffs.
    if (padj < thresholds.padjCutoff && Math.abs(lfc) > thresholds.lfcCutoff) {
      significant.add(gene);
      if (lfc > 0) up += 1;
      if (lfc < 0) down += 1;
    }
  }
  return { significant, summary: { significantCount: significant.size, upCount: up, downCount: down } };
}

function compareDeg(before, after, beforeParams, afterParams) {
  const beforeThresholds = degThresholds(beforeParams);
  const afterThresholds = degThresholds(afterParams);
  if (!beforeThresholds || !afterThresholds) return unavailable('differential_expression', 'scientific_thresholds_unavailable');
  const left = classifyDeg(before, beforeThresholds);
  const right = classifyDeg(after, afterThresholds);
  if (!left || !right) return unavailable('differential_expression', 'deg_schema_or_stable_gene_id_invalid');
  return {
    scientificComparisonVersion: SCIENTIFIC_COMPARE_VERSION,
    status: 'available',
    kind: 'differential_expression',
    thresholds: { before: beforeThresholds, after: afterThresholds },
    significantGenes: { before: left.summary, after: right.summary, membership: setChanges(left.significant, right.significant) },
  };
}

function classifyVolcano(table) {
  const geneColumn = findColumn(table.columns, ['gene', 'gene_id']);
  const statusColumn = findColumn(table.columns, ['sig']);
  if (!geneColumn || !statusColumn) return null;
  const rows = stableRows(table, geneColumn);
  if (!rows) return null;
  const significant = new Set();
  const summary = { upCount: 0, downCount: 0, nonSignificantCount: 0 };
  for (const [gene, row] of rows) {
    const status = String(row[statusColumn] || '').trim().toLowerCase();
    if (status === 'up') { summary.upCount += 1; significant.add(gene); }
    else if (status === 'down') { summary.downCount += 1; significant.add(gene); }
    else if (status === 'ns') summary.nonSignificantCount += 1;
    else return null;
  }
  return { significant, summary: { ...summary, significantCount: significant.size } };
}

function compareVolcano(before, after) {
  const left = classifyVolcano(before);
  const right = classifyVolcano(after);
  if (!left || !right) return unavailable('volcano_classification', 'volcano_schema_or_stable_gene_id_invalid');
  return {
    scientificComparisonVersion: SCIENTIFIC_COMPARE_VERSION,
    status: 'available',
    kind: 'volcano_classification',
    classifications: { before: left.summary, after: right.summary, membership: setChanges(left.significant, right.significant) },
  };
}

function rankTerms(table) {
  const idColumn = findColumn(table.columns, ['ID', 'term_id']);
  const adjustedColumn = findColumn(table.columns, ['p.adjust', 'p_adjust', 'padj']);
  const directionColumn = findColumn(table.columns, ['direction', 'regulation']);
  if (!idColumn || !adjustedColumn) return null;
  const rows = stableRows(table, idColumn);
  if (!rows) return null;
  const ranked = [];
  for (const [id, row] of rows) {
    const adjusted = number(row[adjustedColumn]);
    if (adjusted == null || adjusted < 0 || adjusted > 1) return null;
    const direction = directionColumn ? String(row[directionColumn] || '').trim() : null;
    if (directionColumn && !['up', 'down', 'mixed', 'unresolved', 'unavailable_without_signed_deg'].includes(direction)) {
      return null;
    }
    ranked.push({ id, adjusted, direction });
  }
  ranked.sort((left, right) => left.adjusted - right.adjusted || left.id.localeCompare(right.id));
  return {
    ranked,
    directionStatus: !directionColumn
      ? { status: 'unavailable', reason: 'enrichment_table_has_no_declared_direction_column' }
      : ranked.some((item) => item.direction === 'unavailable_without_signed_deg')
        ? { status: 'unavailable', reason: 'enrichment_direction_unavailable_without_signed_deg' }
        : { status: 'available' },
  };
}

function compareEnrichment(before, after) {
  const leftResult = rankTerms(before);
  const rightResult = rankTerms(after);
  if (!leftResult || !rightResult) return unavailable('functional_enrichment', 'enrichment_schema_or_stable_term_id_invalid');
  const left = leftResult.ranked;
  const right = rightResult.ranked;
  const leftIds = new Set(left.map((item) => item.id));
  const rightIds = new Set(right.map((item) => item.id));
  const directionAvailable = leftResult.directionStatus.status === 'available'
    && rightResult.directionStatus.status === 'available';
  const rightById = new Map(right.map((item) => [item.id, item]));
  const directionChanges = directionAvailable
    ? left
      .filter((item) => rightById.has(item.id) && rightById.get(item.id).direction !== item.direction)
      .map((item) => ({ id: item.id, before: item.direction, after: rightById.get(item.id).direction }))
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, MAX_KEY_ENTITIES)
    : [];
  return {
    scientificComparisonVersion: SCIENTIFIC_COMPARE_VERSION,
    status: 'available',
    kind: 'functional_enrichment',
    terms: {
      beforeCount: left.length,
      afterCount: right.length,
      membership: setChanges(leftIds, rightIds),
      topBefore: left.slice(0, 10).map((item, index) => ({ rank: index + 1, id: item.id, adjustedPValue: item.adjusted })),
      topAfter: right.slice(0, 10).map((item, index) => ({ rank: index + 1, id: item.id, adjustedPValue: item.adjusted })),
    },
    direction: directionAvailable
      ? {
        status: 'available',
        before: left.slice(0, 10).map((item) => ({ id: item.id, direction: item.direction })),
        after: right.slice(0, 10).map((item) => ({ id: item.id, direction: item.direction })),
        changedCount: directionChanges.length,
        changes: directionChanges,
      }
      : {
        status: 'unavailable',
        reason: leftResult.directionStatus.status === 'unavailable'
          ? leftResult.directionStatus.reason
          : rightResult.directionStatus.reason,
      },
  };
}

function compareScientificTables({ artifactId, beforePath, afterPath, beforeParameters = null, afterParameters = null } = {}) {
  const type = artifactId === 'deg_table'
    ? 'differential_expression'
    : artifactId === 'classified_table'
      ? 'volcano_classification'
      : ['go_bp_results', 'kegg_results'].includes(artifactId)
        ? 'functional_enrichment'
        : 'unrecognized';
  if (type === 'unrecognized') return unavailable(type, 'scientific_schema_not_declared_for_artifact');
  let before;
  let after;
  try { before = readExactTable(beforePath); after = readExactTable(afterPath); }
  catch { return unavailable(type, 'scientific_table_unreadable'); }
  if (!before.ok) return unavailable(type, before.reason);
  if (!after.ok) return unavailable(type, after.reason);
  if (type === 'differential_expression') return compareDeg(before, after, beforeParameters, afterParameters);
  if (type === 'volcano_classification') return compareVolcano(before, after);
  return compareEnrichment(before, after);
}

module.exports = {
  SCIENTIFIC_COMPARE_VERSION,
  compareScientificTables,
};
