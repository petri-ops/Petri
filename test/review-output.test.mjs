import { test } from 'node:test';
import assert from 'node:assert/strict';

import reviewOutput from '../core/r-server/agent-review/review-output.js';
const { parseReviewOutputEvent, sanitizeFinding, sanitizeReviewOutputEvent, MAX_FINDINGS } = reviewOutput;

const VALID_EVENT = {
  findings: [
    {
      title: '[P1] Un-padding slices along wrong tensor dimensions',
      body: 'Slicing drops the batch dimension when `input.ndim == 3`, breaking downstream reshape. See runner.py:42.',
      confidence_score: 0.8,
      priority: 1,
      code_location: { absolute_file_path: 'src/runner.py', line_range: { start: 42, end: 44 } },
    },
  ],
  overall_correctness: 'patch is incorrect',
  overall_explanation: 'One batching bug blocks merge.',
  overall_confidence_score: 0.9,
};

test('level 1: whole-text JSON parses with sanitized fields', () => {
  const { level, event } = parseReviewOutputEvent(JSON.stringify(VALID_EVENT));
  assert.equal(level, 'whole_json');
  assert.equal(event.findings.length, 1);
  assert.equal(event.findings[0].title, VALID_EVENT.findings[0].title);
  assert.equal(event.findings[0].priority, 1);
  assert.deepEqual(event.findings[0].codeLocation.lineRange, { start: 42, end: 44 });
  assert.equal(event.overallCorrectness, 'patch is incorrect');
  assert.equal(event.overallConfidenceScore, 0.9);
  assert.equal(event.droppedFindings, 0);
});

test('level 2: embedded JSON object inside prose is extracted', () => {
  const text = `Reviewer notes:\n\n${JSON.stringify(VALID_EVENT)}\n\nEnd of output.`;
  const { level, event } = parseReviewOutputEvent(text);
  assert.equal(level, 'embedded_json');
  assert.equal(event.findings.length, 1);
  assert.equal(event.overallExplanation, VALID_EVENT.overall_explanation);
});

test('level 3: non-JSON text becomes explanation with zero findings', () => {
  const { level, event } = parseReviewOutputEvent('The patch looks fine to me.');
  assert.equal(level, 'plain_text_fallback');
  assert.deepEqual(event.findings, []);
  assert.equal(event.overallExplanation, 'The patch looks fine to me.');
  assert.equal(event.overallCorrectness, 'unknown');
});

test('invalid findings are dropped individually and counted', () => {
  const raw = {
    findings: [
      VALID_EVENT.findings[0],
      { title: '', body: 'no title' },
      { title: 'no body' },
      { title: 'no location', body: 'body', code_location: { line_range: { start: 1, end: 1 } } },
      'not an object',
    ],
    overall_correctness: 'patch is correct',
    overall_explanation: 'ok',
  };
  const event = sanitizeReviewOutputEvent(raw);
  assert.equal(event.findings.length, 1);
  assert.equal(event.droppedFindings, 4);
});

test('out-of-range priority and confidence are normalized, not trusted', () => {
  const finding = sanitizeFinding({
    title: 't',
    body: 'b',
    confidence_score: 7,
    priority: 99,
    code_location: { absolute_file_path: 'a.txt', line_range: { start: 3, end: 3 } },
  });
  assert.equal(finding.priority, null);
  assert.equal(finding.confidenceScore, 1);
});

test('line range is clamped: start floor 1, end >= start', () => {
  const finding = sanitizeFinding({
    title: 't',
    body: 'b',
    code_location: { absolute_file_path: 'a.txt', line_range: { start: 0, end: -4 } },
  });
  assert.deepEqual(finding.codeLocation.lineRange, { start: 1, end: 1 });
});

test('finding budget: at most MAX_FINDINGS survive, overflow counted as dropped', () => {
  const finding = VALID_EVENT.findings[0];
  const raw = {
    findings: Array.from({ length: MAX_FINDINGS + 3 }, () => finding),
    overall_correctness: 'patch is correct',
    overall_explanation: 'ok',
  };
  const event = sanitizeReviewOutputEvent(raw);
  assert.equal(event.findings.length, MAX_FINDINGS);
  assert.equal(event.droppedFindings, 3);
});

test('string-priority and string-confidence from sloppy models are accepted', () => {
  const finding = sanitizeFinding({
    title: 't',
    body: 'b',
    confidence_score: '0.55',
    priority: '2',
    code_location: { absolute_file_path: 'a.txt', line_range: { start: '7', end: '9' } },
  });
  assert.equal(finding.priority, 2);
  assert.equal(finding.confidenceScore, 0.55);
  assert.deepEqual(finding.codeLocation.lineRange, { start: 7, end: 9 });
});
