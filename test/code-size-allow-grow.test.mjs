/**
 * BLOCK-511 S2.5 HK-01 — 棘轮上调必须带留因（--allow-grow path=reason）。
 * 纯函数直测 evaluateGate：无留因的上调红；带 growAllowances 的上调绿；下调始终绿。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { evaluateGate } = await import(pathToFileURL(path.join(root, 'scripts/code-size-ledger.mjs')).href);

const TODAY = '2026-11-24';
const base = [
  { path: 'frontend/x/a.tsx', lines: 100, sha256: 'sha-old', bytes: 1000 },
  { path: 'frontend/x/a.css', lines: 50, sha256: 'css-old', bytes: 2000 },
];
const baseline = { schema: 'petri/block109-size-ledger.v2', files: base, total: 150, growAllowances: [] };
const exceptions = { exceptions: [] };
const current = {
  schema: 'v2',
  files: [
    { path: 'frontend/x/a.tsx', lines: 125, sha256: 'sha-new', bytes: 1250 },
    { path: 'frontend/x/a.css', lines: 55, sha256: 'css-new', bytes: 2400 },
  ],
  total: 180,
};

test('HK-01：行数+字节上调无留因 → 红', () => {
  const r = evaluateGate({ current, baseline, exceptions, today: TODAY });
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.includes('a.tsx') && v.includes('棘轮只减不增')));
  assert.ok(r.violations.some((v) => v.includes('a.css') && v.includes('字节棘轮')));
});

test('HK-01：带 growAllowances（path+reason+date）→ 行数/字节上调放行，指纹仍需重打', () => {
  const growAllowances = [
    { path: 'frontend/x/a.tsx', reason: 'QODER-A2 骨架样式', date: TODAY },
    { path: 'frontend/x/a.css', reason: 'QODER-A2 骨架样式', date: TODAY },
  ];
  const r = evaluateGate({ current, baseline, exceptions, today: TODAY, growAllowances });
  assert.equal(r.ok, false, 'sha 漂移仍须同批重打');
  assert.ok(!r.violations.some((v) => v.includes('棘轮只减不增') || v.includes('字节棘轮')));
  const resynced = { ...current, files: current.files.map((f) => ({ ...f, sha256: f.path.endsWith('css') ? 'css-new' : 'sha-new' })) };
  // 指纹一致需 baseline 同步为新 sha、字节基线同步为新值（--write 语义）
  const syncedBaseline = { ...baseline, files: [
    { path: 'frontend/x/a.tsx', lines: 100, sha256: 'sha-new', bytes: 1000 },
    { path: 'frontend/x/a.css', lines: 50, sha256: 'css-new', bytes: 2000 },
  ], growAllowances: [
    { path: 'frontend/x/a.tsx', reason: 'r', date: TODAY },
    { path: 'frontend/x/a.css', reason: 'r', date: TODAY },
  ] };
  const r2 = evaluateGate({ current: resynced, baseline: syncedBaseline, exceptions, today: TODAY, growAllowances });
  assert.equal(r2.ok, true, JSON.stringify(r2.violations));
});

test('下调始终绿（无需留因）', () => {
  const down = { schema: 'v2', files: [{ path: 'frontend/x/a.tsx', lines: 80, sha256: 'sha-old', bytes: 900 }], total: 80 };
  const b = { ...baseline, files: [baseline.files[0]] };
  const r = evaluateGate({ current: down, baseline: b, exceptions, today: TODAY });
  assert.equal(r.ok, true, JSON.stringify(r.violations));
});
