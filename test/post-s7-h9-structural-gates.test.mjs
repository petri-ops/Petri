/**
 * B-04 / B-16 / B-18 结构门契约（红绿先行）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ADMISSION_ENTRYPOINTS, evaluateAdmissionChannels,
  BIG_FILES, evaluateBigFileLedger,
  PLUGIN_SOURCE_SITES, evaluatePluginSourceSites,
} from '../scripts/post-s7-structural-gates.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('B-04 现场：三入口逐件在册，1 已消费 / 2 显式 deferred（不冒充接线）', () => {
  const files = Object.fromEntries(ADMISSION_ENTRYPOINTS.map((e) => [e.file, read(e.file)]));
  const r = evaluateAdmissionChannels(files);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.equal(r.rows.length, 3);
  assert.equal(r.rows.filter((x) => x.consumes).length, 1);
  assert.equal(r.rows.filter((x) => x.state === 'deferred').length, 2);
  for (const row of r.rows) assert.ok(row.reason);
});

test('B-04 负测：已消费入口丢调用 / deferred 入口偷偷接线 / 文件不可读都红', () => {
  const base = Object.fromEntries(ADMISSION_ENTRYPOINTS.map((e) => [e.file, read(e.file)]));
  const lost = { ...base, [ADMISSION_ENTRYPOINTS[0].file]: '// no consume' };
  assert.equal(evaluateAdmissionChannels(lost).ok, false);
  const wired = { ...base, [ADMISSION_ENTRYPOINTS[1].file]: base[ADMISSION_ENTRYPOINTS[1].file] + '\nconsumeExecutionAdmission(opts);' };
  assert.ok(evaluateAdmissionChannels(wired).issues.some((i) => i.includes('已接线')));
  const missing = { ...base }; delete missing[ADMISSION_ENTRYPOINTS[2].file];
  assert.equal(evaluateAdmissionChannels(missing).ok, false);
});

test('B-16 现场：4 个巨型文件独立行数锚在册且无漂移', () => {
  const anchor = JSON.parse(read('acceptance/post-s7-2026-11-10/h9/big-file-anchor.json'));
  const r = evaluateBigFileLedger(Object.fromEntries(BIG_FILES.map((f) => [f, read(f)])), anchor);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.equal(r.rows.length, 4);
  assert.ok(r.rows.every((x) => x.anchored));
});

test('B-16 负测：锚缺失 / 行数增长都红', () => {
  const files = Object.fromEntries(BIG_FILES.map((f) => [f, read(f)]));
  assert.equal(evaluateBigFileLedger(files, null).ok, false);
  const anchor = JSON.parse(read('acceptance/post-s7-2026-11-10/h9/big-file-anchor.json'));
  const drifted = { ...anchor, files: anchor.files.map((f) => ({ ...f, lines: f.lines + 1 })) };
  assert.equal(evaluateBigFileLedger(files, drifted).ok, false);
});

test('B-18 现场：pack-aware 两处走 pack 通道，installer 一处职责不同不误判', () => {
  const files = Object.fromEntries(PLUGIN_SOURCE_SITES.map((s) => [s.file, read(s.file)]));
  const r = evaluatePluginSourceSites(files);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.equal(r.rows.find((x) => x.id === 'plugin_manager').role, 'installer');
  assert.equal(r.rows.find((x) => x.id === 'mcp_registry').packAware, true);
});

test('B-18 负测：pack-aware 处丢通道 / 丢单源加载器 / 文件不可读都红', () => {
  const base = Object.fromEntries(PLUGIN_SOURCE_SITES.map((s) => [s.file, read(s.file)]));
  const lost = { ...base, [PLUGIN_SOURCE_SITES[0].file]: '// no pack awareness' };
  const r = evaluatePluginSourceSites(lost);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.includes('pack-registry')) || r.issues.some((i) => i.includes('单源')));
  const missing = { ...base }; delete missing[PLUGIN_SOURCE_SITES[1].file];
  assert.equal(evaluatePluginSourceSites(missing).ok, false);
});

// BLOCK-395 B-18：三源路径解析真收敛（pack 启停语义保留）
test('B-18 server.js 不再自写三源路径，且整包启停裁决未被合并掉', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/server.js'), 'utf8');
  assert.ok(src.includes('resolveDefaultPluginSources()'), '必须走唯一加载器');
  assert.equal(src.includes('PETRI_BUILT_IN_PLUGINS_DIR'), false, 'built-in 路径字面量应已收敛');
  assert.equal(src.includes("'Petri-Local', 'plugins'"), false, 'installed 路径字面量应已收敛');
  assert.ok(src.includes('enabled === false'), 'BLOCK-157 整包启停用户裁决必须保留');
  assert.ok(src.includes('packSourcesFromPacks'), 'pack 源仍由 server 独立处理');
});
