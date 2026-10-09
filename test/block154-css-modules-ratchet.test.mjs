/**
 * BLOCK-154 P2-2 — CSS Modules 约定棘轮自测（红/绿样本）。
 *
 * plain CSS 只出不进：白名单外新增 plain CSS 即红；白名单内已移除→提示收缩。
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const importScript = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const { evaluateGate } = await importScript('scripts/css-modules-ratchet.mjs');

const baseline = (paths) => ({ schema: 'biof3/block154-css-plain-ratchet.v1', plainCssPaths: paths });

test('P2-2 绿样本：白名单内 plain CSS 全在列 → pass', () => {
  const current = ['frontend/src/styles/global.css', 'frontend/src/components/ui/Lightbox.css'];
  const r = evaluateGate({ current, baseline: baseline(current) });
  assert.equal(r.ok, true, JSON.stringify(r.violations));
});

test('P2-2 红样本：白名单外新增 plain CSS → 红（必须用 *.module.css）', () => {
  const r = evaluateGate({
    current: ['frontend/src/styles/global.css', 'frontend/src/components/NewWidget.css'],
    baseline: baseline(['frontend/src/styles/global.css']),
  });
  assert.equal(r.ok, false);
  assert.match(r.violations.join('\n'), /新增 plain CSS/);
  assert.match(r.violations.join('\n'), /CSS Modules/);
});

test('P2-2 样本：白名单内已移除的 plain CSS → 只 warn 不红（鼓励迁移收缩）', () => {
  const r = evaluateGate({
    current: ['frontend/src/styles/global.css'],
    baseline: baseline(['frontend/src/styles/global.css', 'frontend/src/components/ui/Lightbox.css']),
  });
  assert.equal(r.ok, true);
  assert.match(r.warnings.join('\n'), /已移除/);
});
