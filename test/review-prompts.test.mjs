import { test } from 'node:test';
import assert from 'node:assert/strict';

import reviewPrompts from '../core/r-server/agent-review/review-prompts.js';
const { REVIEW_RUBRIC, buildReviewPrompt, normalizeReviewTarget, userFacingHint } = reviewPrompts;

test('rubric carries the read-only boundary and the strict JSON contract', () => {
  assert.match(REVIEW_RUBRIC, /strictly READ-ONLY/);
  assert.match(REVIEW_RUBRIC, /"overall_correctness"/);
  assert.match(REVIEW_RUBRIC, /"confidence_score"/);
  assert.match(REVIEW_RUBRIC, /\[P0\]/);
  assert.match(REVIEW_RUBRIC, /AGENTS\.md/);
  assert.match(REVIEW_RUBRIC, /Do not wrap the JSON in markdown fences/);
});

test('normalizeReviewTarget: uncommitted changes needs no fields', () => {
  const result = normalizeReviewTarget({ type: 'uncommitted_changes' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.target, { type: 'uncommitted_changes' });
});

test('normalizeReviewTarget: rejects unknown types and bad branches', () => {
  assert.equal(normalizeReviewTarget({ type: 'everything' }).ok, false);
  assert.equal(normalizeReviewTarget(null).ok, false);
  assert.equal(normalizeReviewTarget({ type: 'base_branch', branch: 'main; rm -rf /' }).ok, false);
  assert.equal(normalizeReviewTarget({ type: 'base_branch', branch: '' }).ok, false);
  assert.equal(normalizeReviewTarget({ type: 'commit', sha: 'zzzz' }).ok, false);
  assert.equal(normalizeReviewTarget({ type: 'custom', instructions: '   ' }).ok, false);
});

test('normalizeReviewTarget: valid base_branch / commit / custom', () => {
  const base = normalizeReviewTarget({ type: 'base_branch', branch: ' main ' });
  assert.equal(base.ok, true);
  assert.deepEqual(base.target, { type: 'base_branch', branch: 'main' });

  const commit = normalizeReviewTarget({ type: 'commit', sha: 'ABCDEF1234', title: 'feat: x' });
  assert.equal(commit.ok, true);
  assert.equal(commit.target.sha, 'abcdef1234');
  assert.equal(commit.target.title, 'feat: x');

  const custom = normalizeReviewTarget({ type: 'custom', instructions: '只看安全问题' });
  assert.equal(custom.ok, true);
  assert.equal(custom.target.instructions, '只看安全问题');
});

test('buildReviewPrompt: uncommitted / commit / custom shapes mirror the Codex prompts', () => {
  assert.match(
    buildReviewPrompt({ type: 'uncommitted_changes' }),
    /staged, unstaged, and untracked files/
  );
  assert.match(
    buildReviewPrompt({ type: 'commit', sha: 'abc1234' }),
    /commit abc1234/
  );
  assert.match(
    buildReviewPrompt({ type: 'commit', sha: 'abc1234', title: 'feat: y' }),
    /\("feat: y"\)/
  );
  assert.equal(buildReviewPrompt({ type: 'custom', instructions: 'check perf only' }), 'check perf only');
});

test('buildReviewPrompt: base_branch uses merge-base SHA when resolved, backup otherwise', () => {
  const target = { type: 'base_branch', branch: 'main' };
  const withSha = buildReviewPrompt(target, { mergeBaseSha: 'deadbeef' });
  assert.match(withSha, /merge base commit for this comparison is deadbeef/);
  assert.match(withSha, /git diff deadbeef/);

  const backup = buildReviewPrompt(target, { mergeBaseSha: null });
  assert.match(backup, /merge diff between the current branch/);
  assert.doesNotMatch(backup, /\{\{mergeBaseSha\}\}/);
});

test('userFacingHint covers every target type', () => {
  assert.equal(userFacingHint({ type: 'uncommitted_changes' }), '当前未提交变更');
  assert.match(userFacingHint({ type: 'base_branch', branch: 'main' }), /main/);
  assert.match(userFacingHint({ type: 'commit', sha: 'abcdef12345' }), /abcdef1/);
  assert.equal(userFacingHint({ type: 'custom', instructions: 'x'.repeat(100) }).length <= 60, true);
});
