/**
 * agent-tools/act-tool-core.js — Pure utility functions extracted from act-tools.js
 *
 * A-008: Extract to break the act-tools ↔ plan-ui-tools require cycle.
 *
 * 4 functions migrated:
 *   testFilterOne / testFilterExpr — cell filter expression evaluator
 *   _setImpliedPage / _getImpliedPage / _getRequestKey — page-implied tracking
 *
 * DESIGN RULES:
 * - NO require of act-tools.js or plan-ui-tools.js (zero circular risk)
 * - NO side effects at module load (except the _impliedPageByRequest Map)
 * - The Map is module-level state (same as before; one per process is correct)
 */
'use strict';

// --------------------------------------------------------------
// FILTER_AND_OR_v1 — single-cell filter expression evaluator
// Mirrors CsvTable logic; unchanged from act-tools.js L69-114
// --------------------------------------------------------------

function testFilterOne(cellRaw, expr) {
  const trimmed = String(expr).trim();
  if (!trimmed) return true;
  const cmp = trimmed.match(/^(>=|<=|>|<|=|!=)\s*(-?\d+(?:\.\d+)?)\s*$/);
  const between = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*$/);
  const num = parseFloat(cellRaw);
  if (cmp && !isNaN(num)) {
    const op = cmp[1];
    const v = parseFloat(cmp[2]);
    if (op === '>') return num > v;
    if (op === '>=') return num >= v;
    if (op === '<') return num < v;
    if (op === '<=') return num <= v;
    if (op === '=') return num === v;
    if (op === '!=') return num !== v;
  } else if (between && !isNaN(num)) {
    return num >= parseFloat(between[1]) && num <= parseFloat(between[2]);
  }
  return String(cellRaw).toLowerCase().includes(trimmed.toLowerCase());
}

function testFilterExpr(cellRaw, searchStr) {
  if (!searchStr) return true;
  if (/\s+AND\s+/i.test(searchStr)) {
    const parts = searchStr
      .split(/\s+AND\s+/i)
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.every((p) => testFilterOne(cellRaw, p));
  }
  if (/\s+OR\s+/i.test(searchStr)) {
    const parts = searchStr
      .split(/\s+OR\s+/i)
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.some((p) => testFilterOne(cellRaw, p));
  }
  if (/[,;:/|]/.test(searchStr) && !/^[><=!]/.test(searchStr)) {
    const terms = searchStr
      .split(/[,;:/|]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (terms.length > 0) return terms.some((t) => testFilterOne(cellRaw, t));
  }
  return testFilterOne(cellRaw, searchStr);
}

// --------------------------------------------------------------
// FIGCODE_PAGE_RACE_FIX_v1 — implied page tracking
// Unchanged from act-tools.js L143-165
// --------------------------------------------------------------

// Track implied page transitions within a single agent loop.
// Key: ctx requestId or visitorId+timestamp combo; Value: implied page string.
const _impliedPageByRequest = new Map();

function _setImpliedPage(ctx, page) {
  const key = _getRequestKey(ctx);
  if (key) _impliedPageByRequest.set(key, page);
  // Auto-cleanup after 30s (one agent loop never lasts that long)
  setTimeout(() => _impliedPageByRequest.delete(key), 30000);
}

function _getImpliedPage(ctx) {
  const key = _getRequestKey(ctx);
  return key ? _impliedPageByRequest.get(key) || null : null;
}

function _getRequestKey(ctx) {
  // Use conversationId + the message timestamp as a unique key per agent turn
  if (ctx && ctx.conversationId) return ctx.conversationId + ':' + (ctx._turnTs || '0');
  if (ctx && ctx.userId) return ctx.userId + ':' + (ctx._turnTs || '0');
  return null;
}

module.exports = {
  testFilterExpr,
  testFilterOne,
  _setImpliedPage,
  _getImpliedPage,
  _getRequestKey,
};
