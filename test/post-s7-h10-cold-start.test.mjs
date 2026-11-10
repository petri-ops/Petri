import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const e = JSON.parse(fs.readFileSync(path.join(ROOT, 'acceptance/post-s7-2026-11-10/h10/cold-start-x5.json'), 'utf8'));

test('B-22 冷启动 5 轮全 ready，非热栈轮询', () => {
  assert.equal(e.rounds, 5);
  assert.equal(e.readyCount, 5);
  assert.equal(e.roundsDetail.length, 5);
  assert.ok(e.worstRound.coldStartWallMs > 0);
  assert.ok(e.note.includes('冷启动 5 次非热栈轮询'));
});

test('4/5 段有权威读数，cdpPageReady 如实记 0 且解释路径差异', () => {
  for (const k of ['require', 'migrations', 'backendHealth', 'spa200']) assert.equal(e.stageCoverage[k], 5);
  assert.equal(e.stageCoverage.cdpPageReady, 0);
  assert.ok(e.stageCoverageInterpretation.cdpPageReady.includes('不编数字'));
  assert.equal(e.verdict, 'measured-with-declared-path-limit');
});

test('不冒充视觉绿 / 不冒充 5/5 全齐', () => {
  assert.equal(e.humanEyeEquivalent, false);
  assert.equal(e.visualVerified, false);
  assert.ok(e.verdict.includes('declared-path-limit'));
});
