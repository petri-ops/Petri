'use strict';

/**
 * BLOCK-358 / C-47 — 证据回放脚本契约。
 * 重点不是「复现成功」，而是钉住「不伪造复现、不猜测性修复、不销票」。
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const mod = await import(pathToFileURL(path.join(ROOT, 'scripts/block358-filetree-repro.mjs')).href);

describe('BLOCK-358 分页证据回放', () => {
  test('单调增长的正常序列：cursorMonotonic=true', () => {
    const r = mod.replayPagingClicks([
      { click: 1, rowsBefore: 200, rowsAfter: 400 },
      { click: 2, rowsBefore: 400, rowsAfter: 520 },
    ]);
    assert.equal(r.cursorMonotonic, true);
    assert.equal(r.nonMonotonic, 0);
    assert.equal(r.resets, 0);
  });

  test('负测：惰性点击（不增长）与回弹（重置）都能被检出', () => {
    const inert = mod.replayPagingClicks([{ click: 1, rowsBefore: 200, rowsAfter: 200 }]);
    assert.equal(inert.nonMonotonic, 1);
    assert.equal(inert.cursorMonotonic, false);
    const reset = mod.replayPagingClicks([{ click: 2, rowsBefore: 400, rowsAfter: 200 }]);
    assert.equal(reset.resets, 1);
    assert.equal(reset.cursorMonotonic, false);
  });

  test('349 证据 B2/B3 被正确抽取为两次独立观察', () => {
    const ev = JSON.parse(fs.readFileSync(path.join(ROOT, 'acceptance/block-349/block349-bigdir-live-darwin.json'), 'utf8'));
    const obs = mod.observationsFromEvidence(ev);
    assert.equal(obs.b2CursorLoadMoreGrows, true);
    assert.equal(obs.b3RepeatClickInert, true);
    assert.equal(obs.clicks.length, 2);
  });

  test('结论为三态「观察在场但未复现」，且明确未归因 / 未修复 / 不销票', () => {
    const c = mod.buildConclusion();
    assert.equal(c.triState, 'observed_but_not_reproduced');
    assert.equal(c.rootCauseAttributed, false);
    assert.equal(c.fixApplied, false);
    assert.equal(c.ticketStatus, 'kept-open');
    assert.match(c.honestBoundary, /不是 GUI 复现/);
    assert.ok(c.candidateRacePoints.length >= 1, '至少列一个真实存在的候选竞态点');
  });

  test('磁盘结论与脚本输出一致（勿手改）', () => {
    const onDisk = JSON.parse(fs.readFileSync(path.join(ROOT, 'acceptance/block-358/repro-result.json'), 'utf8'));
    assert.deepEqual(onDisk, mod.buildConclusion());
  });
});
