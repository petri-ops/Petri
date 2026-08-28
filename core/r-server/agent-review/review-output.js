'use strict';

/**
 * agent-review/review-output.js — BLOCK-25 review output parsing.
 *
 * Port of the Codex reviewer output contract (openai/codex
 * codex-rs/core/src/tasks/review.rs parse_review_output_event) with an
 * explicit sanitizer so a malformed reviewer response degrades honestly
 * instead of surfacing fabricated findings.
 *
 * Parsing levels (mirrors Codex):
 *   1. whole text parses as ReviewOutputEvent JSON
 *   2. first '{' .. last '}' substring parses
 *   3. plain-text fallback: text lands in overall_explanation, no findings
 *
 * The sanitizer is stricter than Codex: findings that fail field validation
 * are dropped individually and counted (droppedFindings), because a wrong
 * file/line in a review card is worse than a missing card.
 */

const MAX_FINDINGS = 100;
const MAX_TITLE_LEN = 200;
const MAX_BODY_LEN = 4000;
const MAX_EXPLANATION_LEN = 8000;
const MAX_PATH_LEN = 1024;

function toFiniteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clampConfidence(value) {
  const num = toFiniteNumber(value);
  if (num === null) return null;
  return Math.min(1, Math.max(0, num));
}

function clampPriority(value) {
  if (value === null || value === undefined) return null;
  const num = toFiniteNumber(value);
  if (num === null) return null;
  const int = Math.round(num);
  if (int < 0 || int > 3) return null;
  return int;
}

function clampLine(value) {
  const num = toFiniteNumber(value);
  if (num === null) return null;
  const int = Math.round(num);
  if (int < 1) return null;
  return Math.min(int, 10_000_000);
}

function clampText(value, maxLen) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen - 1)}…` : trimmed;
}

function sanitizeFinding(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = clampText(raw.title, MAX_TITLE_LEN);
  const body = clampText(raw.body, MAX_BODY_LEN);
  if (!title || !body) return null;

  const location = raw.code_location && typeof raw.code_location === 'object' ? raw.code_location : null;
  const filePath = clampText(location && location.absolute_file_path, MAX_PATH_LEN);
  const range = location && typeof location.line_range === 'object' ? location.line_range : null;
  const start = clampLine(range && range.start) ?? 1;
  let end = clampLine(range && range.end);
  if (!filePath) return null;
  if (end === null || end < start) end = start;

  const confidence = clampConfidence(raw.confidence_score);
  return {
    title,
    body,
    confidenceScore: confidence === null ? null : confidence,
    priority: clampPriority(raw.priority),
    codeLocation: {
      absoluteFilePath: filePath,
      lineRange: { start, end },
    },
  };
}

function sanitizeReviewOutputEvent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rawFindings = Array.isArray(raw.findings) ? raw.findings : [];
  const findings = [];
  let droppedFindings = 0;
  for (const item of rawFindings) {
    if (findings.length >= MAX_FINDINGS) {
      droppedFindings += 1;
      continue;
    }
    const sanitized = sanitizeFinding(item);
    if (sanitized) findings.push(sanitized);
    else droppedFindings += 1;
  }
  const correctnessRaw = typeof raw.overall_correctness === 'string' ? raw.overall_correctness.trim() : '';
  const correctness = correctnessRaw === 'patch is correct' || correctnessRaw === 'patch is incorrect'
    ? correctnessRaw
    : 'unknown';
  const explanation = clampText(raw.overall_explanation, MAX_EXPLANATION_LEN) || '';
  const confidence = clampConfidence(raw.overall_confidence_score);
  return {
    findings,
    droppedFindings,
    overallCorrectness: correctness,
    overallExplanation: explanation,
    overallConfidenceScore: confidence === null ? null : confidence,
  };
}

function tryParseJsonObject(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Parse the reviewer model's final text into a sanitized ReviewOutputEvent.
 * Always resolves — level 3 wraps the raw text into overallExplanation with
 * zero findings so the UI can show the reviewer's prose honestly.
 */
function parseReviewOutputEvent(text) {
  const rawText = typeof text === 'string' ? text : '';
  const trimmed = rawText.trim();

  const wholeParsed = trimmed ? tryParseJsonObject(trimmed) : null;
  let raw = wholeParsed;
  if (!raw) {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      raw = tryParseJsonObject(trimmed.slice(start, end + 1));
    }
  }

  if (raw) {
    const sanitized = sanitizeReviewOutputEvent(raw);
    if (sanitized) return { level: wholeParsed ? 'whole_json' : 'embedded_json', event: sanitized };
  }

  return {
    level: 'plain_text_fallback',
    event: {
      findings: [],
      droppedFindings: 0,
      overallCorrectness: 'unknown',
      overallExplanation: clampText(trimmed, MAX_EXPLANATION_LEN) || '',
      overallConfidenceScore: null,
    },
  };
}

module.exports = {
  MAX_FINDINGS,
  parseReviewOutputEvent,
  sanitizeFinding,
  sanitizeReviewOutputEvent,
};
