'use strict';

/**
 * G0-RS-P5 — bounded, schema-declared scientific comparison.
 *
 * This module never guesses a biological conclusion from an arbitrary CSV.
 * Only Artifact identities whose comparison profile is declared by an
 * installed domain pack are interpreted. Any missing profile, duplicate stable
 * identifier, malformed numeric value or oversized table becomes an explicit
 * `unavailable` result rather than a plausible-looking statistic.
 *
 * BLOCK-234 S5: the admitted schemas and classification vocabularies are pack
 * data (`provides.scientificProfiles`); this engine only implements the
 * bounded modes `threshold`, `status` and `ranked`.
 */

const fs = require('fs');
const { loadScientificProfiles } = require('./pack-scientific-profiles');

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

function parameterNumber(params, aliases) {
  for (const alias of aliases) {
    const value = params?.[alias];
    if (value == null) continue;
    return number(value);
  }
  return null;
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

function schemaInvalidReason(profile) {
  return profile.reasons?.schemaInvalid || 'scientific_schema_invalid';
}

function thresholdValues(params, profile) {
  const padj = parameterNumber(params, profile.thresholdParameters.significance);
  const lfc = parameterNumber(params, profile.thresholdParameters.effect);
  return padj != null && padj >= 0 && padj <= 1 && lfc != null && lfc >= 0
    ? { padjCutoff: padj, lfcCutoff: lfc }
    : null;
}

function classifyThreshold(table, profile, thresholds) {
  const idColumn = findColumn(table.columns, profile.idColumns);
  const effectColumn = findColumn(table.columns, profile.effectColumns);
  const significanceColumn = findColumn(table.columns, profile.significanceColumns);
  if (!idColumn || !effectColumn || !significanceColumn) return null;
  const rows = stableRows(table, idColumn);
  if (!rows) return null;
  const significant = new Set();
  let up = 0;
  let down = 0;
  for (const [id, row] of rows) {
    const effect = number(row[effectColumn]);
    const significance = number(row[significanceColumn]);
    if (effect == null || significance == null || significance < 0 || significance > 1) return null;
    // Match the admitted producers exactly: boundary values are not
    // significant because their scripts use strict cutoffs.
    if (significance < thresholds.padjCutoff && Math.abs(effect) > thresholds.lfcCutoff) {
      significant.add(id);
      if (effect > 0) up += 1;
      if (effect < 0) down += 1;
    }
  }
  return { significant, summary: { significantCount: significant.size, upCount: up, downCount: down } };
}

function compareThreshold(before, after, beforeParams, afterParams, profile) {
  const beforeThresholds = thresholdValues(beforeParams, profile);
  const afterThresholds = thresholdValues(afterParams, profile);
  if (!beforeThresholds || !afterThresholds) {
    return unavailable(profile.kind, profile.reasons?.thresholdsUnavailable || 'scientific_thresholds_unavailable');
  }
  const left = classifyThreshold(before, profile, beforeThresholds);
  const right = classifyThreshold(after, profile, afterThresholds);
  if (!left || !right) return unavailable(profile.kind, schemaInvalidReason(profile));
  return {
    scientificComparisonVersion: SCIENTIFIC_COMPARE_VERSION,
    status: 'available',
    kind: profile.kind,
    thresholds: { before: beforeThresholds, after: afterThresholds },
    significantGenes: { before: left.summary, after: right.summary, membership: setChanges(left.significant, right.significant) },
  };
}

function classifyStatus(table, profile) {
  const idColumn = findColumn(table.columns, profile.idColumns);
  const statusColumn = findColumn(table.columns, profile.statusColumns);
  if (!idColumn || !statusColumn) return null;
  const rows = stableRows(table, idColumn);
  if (!rows) return null;
  const significant = new Set();
  const summary = { upCount: 0, downCount: 0, nonSignificantCount: 0 };
  for (const [id, row] of rows) {
    const status = String(row[statusColumn] || '').trim().toLowerCase();
    if (status === profile.statuses.positive) { summary.upCount += 1; significant.add(id); }
    else if (status === profile.statuses.negative) { summary.downCount += 1; significant.add(id); }
    else if (status === profile.statuses.neutral) summary.nonSignificantCount += 1;
    else return null;
  }
  return { significant, summary: { ...summary, significantCount: significant.size } };
}

function compareStatus(before, after, profile) {
  const left = classifyStatus(before, profile);
  const right = classifyStatus(after, profile);
  if (!left || !right) return unavailable(profile.kind, schemaInvalidReason(profile));
  return {
    scientificComparisonVersion: SCIENTIFIC_COMPARE_VERSION,
    status: 'available',
    kind: profile.kind,
    classifications: { before: left.summary, after: right.summary, membership: setChanges(left.significant, right.significant) },
  };
}

function rankTerms(table, profile) {
  const idColumn = findColumn(table.columns, profile.idColumns);
  const rankColumn = findColumn(table.columns, profile.rankColumns);
  const directionColumn = profile.directionColumns ? findColumn(table.columns, profile.directionColumns) : null;
  if (!idColumn || !rankColumn) return null;
  const rows = stableRows(table, idColumn);
  if (!rows) return null;
  if (directionColumn && (!Array.isArray(profile.directionValues) || profile.directionValues.length === 0)) return null;
  const ranked = [];
  for (const [id, row] of rows) {
    const adjusted = number(row[rankColumn]);
    if (adjusted == null || adjusted < 0 || adjusted > 1) return null;
    const direction = directionColumn ? String(row[directionColumn] || '').trim() : null;
    if (directionColumn && !profile.directionValues.includes(direction)) return null;
    ranked.push({ id, adjusted, direction });
  }
  ranked.sort((left, right) => left.adjusted - right.adjusted || left.id.localeCompare(right.id));
  return {
    ranked,
    directionStatus: !directionColumn
      ? { status: 'unavailable', reason: profile.reasons?.noDirectionColumn || 'enrichment_direction_column_missing' }
      : ranked.some((item) => item.direction === profile.unavailableDirectionValue)
        ? { status: 'unavailable', reason: profile.reasons?.directionUnavailable || 'enrichment_direction_unavailable' }
        : { status: 'available' },
  };
}

function compareRanked(before, after, profile) {
  const leftResult = rankTerms(before, profile);
  const rightResult = rankTerms(after, profile);
  if (!leftResult || !rightResult) return unavailable(profile.kind, schemaInvalidReason(profile));
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
    kind: profile.kind,
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

function compareScientificTables({
  artifactId,
  beforePath,
  afterPath,
  beforeParameters = null,
  afterParameters = null,
  profiles = null,
} = {}) {
  const comparisonProfiles = profiles || loadScientificProfiles().comparisons;
  const profile = comparisonProfiles[artifactId];
  if (!profile) return unavailable('unrecognized', 'scientific_schema_not_declared_for_artifact');
  let before;
  let after;
  try { before = readExactTable(beforePath); after = readExactTable(afterPath); }
  catch { return unavailable(profile.kind, 'scientific_table_unreadable'); }
  if (!before.ok) return unavailable(profile.kind, before.reason);
  if (!after.ok) return unavailable(profile.kind, after.reason);
  if (profile.mode === 'threshold') return compareThreshold(before, after, beforeParameters, afterParameters, profile);
  if (profile.mode === 'status') return compareStatus(before, after, profile);
  return compareRanked(before, after, profile);
}

module.exports = {
  SCIENTIFIC_COMPARE_VERSION,
  compareScientificTables,
};
