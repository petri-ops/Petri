/**
 * BLOCK-342 W1 P2 — SVG 工具面契约（svg_inspect / svg_edit 注册全链 + propose/apply + 冲突/安全/守卫）。
 *
 * 只钉机制：
 *  - 注册四件套：TOOL_DEFS schema / registry handler / contract / metadata；域并集恒等。
 *  - svg_inspect：只读清单 + target 详情 + 危险面标记；不写盘。
 *  - svg_edit propose：只校验、不写盘；返回 beforeSha256 / afterSha256 / 语义 diff。
 *  - svg_edit apply：带 beforeSha256 前提写盘 + 旧版本审计快照；期间外部改动 ⇒ svg_hash_mismatch。
 *  - 零改动：不写盘（mtime/sha 不变）。
 *  - 守卫：路径穿越 / 非 .svg / 文件缺席 / 超上限 / apply 缺 beforeSha。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// registry 链路 require db.js——PETRI_DB_PATH 隔离须在 require 前（block341 同款）
{
  const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'block342-db-'));
  const boot = new Database(path.join(tempDbDir, 'petri.db'));
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = path.join(tempDbDir, 'petri.db');
  process.on('exit', () => {
    try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });
}

const svgTools = require(path.join(ROOT, 'core/petri-server/agent-tools/svg-tools.js'));
const registry = require(path.join(ROOT, 'core/petri-server/agent-tools/registry.js'));
const { TOOL_DEFS, DOMAIN_TOOL_DEFS } = require(path.join(ROOT, 'core/petri-server/agent-tools/tool-defs.js'));
const { getToolMetadata } = require(path.join(ROOT, 'core/petri-server/agent-tools/tool-metadata.js'));

const SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60" viewBox="0 0 100 60">
  <g id="plot">
    <text id="title" x="50" y="15">Signal</text>
    <rect id="bar" x="10" y="30" width="20" height="20" fill="#3366cc"/>
  </g>
</svg>
`;

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function makeWorkspace(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block342-ws-'));
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }
  return dir;
}

function ctxFor(workspaceRoot) {
  return {
    projectId: 'p_svg_test',
    db: {
      getProject(id) {
        return id === 'p_svg_test' ? { id, name: 'svg-test', workspace_path: workspaceRoot } : null;
      },
    },
  };
}

test('BLOCK-342 P2 注册四件套：svg_inspect / svg_edit 全链在位且 contract 归 workspace 域', () => {
  for (const name of ['svg_inspect', 'svg_edit']) {
    assert.ok(registry.getToolEntry(name), `${name} 应注册`);
    assert.equal(typeof registry.getToolHandler(name), 'function');
    const contract = registry.getToolContract(name);
    assert.equal(contract.category, 'workspace', `${name} category=${contract && contract.category}`);
    const meta = getToolMetadata(name);
    assert.equal(meta.known, true, `${name} metadata 未登记`);
  }
  assert.equal(getToolMetadata('svg_inspect').readOnly, true);
  assert.equal(getToolMetadata('svg_inspect').concurrentSafe, true);
  assert.equal(getToolMetadata('svg_edit').needsApproval, true);
  assert.equal(getToolMetadata('svg_edit').destructive, false);

  const inspect = TOOL_DEFS.find((d) => d.function.name === 'svg_inspect');
  const edit = TOOL_DEFS.find((d) => d.function.name === 'svg_edit');
  assert.ok(inspect && edit);
  assert.deepEqual(edit.function.parameters.required, ['filePath', 'ops']);
  assert.ok(edit.function.parameters.properties.beforeSha256, 'apply 前提参数必须在 schema 里可见');

  // 域并集恒等（⋃ DOMAIN_TOOL_DEFS = TOOL_DEFS）
  const union = Object.values(DOMAIN_TOOL_DEFS).flat().map((d) => d.function.name).sort();
  const all = TOOL_DEFS.map((d) => d.function.name).sort();
  assert.deepEqual(union, all);
  assert.ok(DOMAIN_TOOL_DEFS.svg.map((d) => d.function.name).includes('svg_edit'), 'svg 域模块应可定位');
});

test('BLOCK-342 P2 svg_inspect：清单 + tag 过滤 + target 详情 + 危险面标记；不写盘', () => {
  const ws = makeWorkspace({ 'figures/plot.svg': SVG });
  const ctx = ctxFor(ws);
  const before = fs.statSync(path.join(ws, 'figures/plot.svg')).mtimeMs;

  const r = svgTools.tool_svg_inspect({ filePath: 'figures/plot.svg' }, ctx);
  assert.equal(r.ok, true, JSON.stringify({ error: r.error, message: r.message }));
  assert.equal(r.filePath, 'figures/plot.svg');
  assert.equal(r.rootTag, 'svg');
  assert.ok(r.total >= 4, `total=${r.total}`);
  assert.equal(r.unsafe.any, false);
  assert.ok(r.description.includes('plot.svg'));

  const onlyText = svgTools.tool_svg_inspect({ filePath: 'figures/plot.svg', tag: 'text' }, ctx);
  assert.equal(onlyText.elements.length, 1);
  assert.equal(onlyText.elements[0].id, 'title');

  const targeted = svgTools.tool_svg_inspect({ filePath: 'figures/plot.svg', target: { id: 'plot' } }, ctx);
  assert.equal(targeted.target.tag, 'g');
  assert.equal(targeted.target.childCount, 2);
  assert.deepEqual(targeted.target.path, [0]);

  assert.equal(fs.statSync(path.join(ws, 'figures/plot.svg')).mtimeMs, before, 'inspect 不得触碰文件');
  assert.equal(fs.readFileSync(path.join(ws, 'figures/plot.svg'), 'utf8'), SVG);

  const dirty = makeWorkspace({ 'dirty.svg': '<svg><script>alert(1)</script><rect id="r" onclick="x"/></svg>' });
  const dirtyCtx = ctxFor(dirty);
  const d = svgTools.tool_svg_inspect({ filePath: 'dirty.svg' }, dirtyCtx);
  assert.equal(d.ok, true);
  assert.equal(d.unsafe.script, true);
  assert.ok(d.unsafe.eventAttrs >= 1);
  assert.ok(d.description.includes('危险面'), d.description);
});

test('BLOCK-342 P2 svg_edit propose：只校验不写盘，返回 before/after sha 与语义 diff', () => {
  const ws = makeWorkspace({ 'plot.svg': SVG });
  const ctx = ctxFor(ws);
  const file = path.join(ws, 'plot.svg');
  const beforeMtime = fs.statSync(file).mtimeMs;

  const r = svgTools.tool_svg_edit({
    filePath: 'plot.svg',
    ops: [{ op: 'set_attr', target: { id: 'bar' }, name: 'fill', value: '#cc0000' }],
  }, ctx);

  assert.equal(r.ok, true, JSON.stringify({ error: r.error, message: r.message }));
  assert.equal(r.propose, true);
  assert.equal(r.beforeSha256, sha256(SVG));
  assert.ok(r.afterSha256 && r.afterSha256 !== r.beforeSha256);
  assert.equal(r.changed, true);
  assert.equal(r.semanticDiff.length, 1);
  assert.equal(r.semanticDiff[0].op, 'set_attr');
  assert.ok(r.semanticDiff[0].target.includes('bar'), r.semanticDiff[0].target);

  // 切片6 交接 — ops 回显（提案消费者按 op 逐项取舍）
  assert.deepEqual(r.ops, [{ op: 'set_attr', target: { id: 'bar' }, name: 'fill', value: '#cc0000' }]);

  // propose 绝不写盘
  assert.equal(fs.readFileSync(file, 'utf8'), SVG);
  assert.equal(fs.statSync(file).mtimeMs, beforeMtime);
});

test('BLOCK-342 P2 svg_edit apply：写盘 + 审计快照 + 回读内容正确', () => {
  const ws = makeWorkspace({ 'plot.svg': SVG });
  const ctx = ctxFor(ws);
  const file = path.join(ws, 'plot.svg');

  const proposed = svgTools.tool_svg_edit({
    filePath: 'plot.svg',
    ops: [
      { op: 'set_attr', target: { id: 'bar' }, name: 'fill', value: '#cc0000' },
      { op: 'set_text', target: { id: 'title' }, text: 'Peak' },
    ],
  }, ctx);
  assert.equal(proposed.ok, true);

  const applied = svgTools.tool_svg_edit({
    filePath: 'plot.svg',
    ops: [
      { op: 'set_attr', target: { id: 'bar' }, name: 'fill', value: '#cc0000' },
      { op: 'set_text', target: { id: 'title' }, text: 'Peak' },
    ],
    apply: true,
    beforeSha256: proposed.beforeSha256,
  }, ctx);

  assert.equal(applied.ok, true, JSON.stringify({ error: applied.error, message: applied.message }));
  assert.equal(applied.apply, true);
  assert.equal(applied.beforeSha256, proposed.beforeSha256);
  assert.equal(applied.afterSha256, proposed.afterSha256);
  assert.equal(applied.changed, true);

  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.includes('fill="#cc0000"'), text);
  assert.ok(text.includes('>Peak</text>'), text);
  assert.equal(sha256(text), applied.afterSha256);

  // 审计快照：旧版本原文落 .petri/svg-revisions/，且是真值的副本不是第二真值
  assert.ok(applied.snapshotPath && applied.snapshotPath.startsWith('.petri/svg-revisions/'), applied.snapshotPath);
  assert.equal(fs.readFileSync(path.join(ws, applied.snapshotPath), 'utf8'), SVG);
});

test('BLOCK-342 P2 冲突安全：propose 后文件被外部改动 ⇒ apply 报 svg_hash_mismatch 且不覆盖', () => {
  const ws = makeWorkspace({ 'plot.svg': SVG });
  const ctx = ctxFor(ws);
  const file = path.join(ws, 'plot.svg');

  const proposed = svgTools.tool_svg_edit({
    filePath: 'plot.svg',
    ops: [{ op: 'set_attr', target: { id: 'bar' }, name: 'width', value: '40' }],
  }, ctx);
  assert.equal(proposed.ok, true);

  // 人在编辑器里改过（外部写入）
  const humanText = SVG.replace('fill="#3366cc"', 'fill="#00aa00"');
  fs.writeFileSync(file, humanText, 'utf8');

  const applied = svgTools.tool_svg_edit({
    filePath: 'plot.svg',
    ops: [{ op: 'set_attr', target: { id: 'bar' }, name: 'width', value: '40' }],
    apply: true,
    beforeSha256: proposed.beforeSha256,
  }, ctx);

  assert.equal(applied.ok, undefined);
  assert.equal(applied.error, 'svg_hash_mismatch');
  assert.ok(String(applied.hint || '').includes('重新'), applied.hint);
  assert.equal(fs.readFileSync(file, 'utf8'), humanText, '人的修正不得被 agent 覆盖');
});

test('BLOCK-342 P2 零改动：apply 不产生字节变化时拒绝写盘（mtime 与 sha 不变）', () => {
  const ws = makeWorkspace({ 'plot.svg': SVG });
  const ctx = ctxFor(ws);
  const file = path.join(ws, 'plot.svg');
  const beforeMtime = fs.statSync(file).mtimeMs;

  const r = svgTools.tool_svg_edit({
    filePath: 'plot.svg',
    ops: [{ op: 'set_attr', target: { id: 'bar' }, name: 'fill', value: '#3366cc' }],
    apply: true,
    beforeSha256: sha256(SVG),
  }, ctx);

  assert.equal(r.ok, true, JSON.stringify({ error: r.error, message: r.message }));
  assert.equal(r.changed, false);
  assert.equal(r.snapshotPath, undefined);
  assert.equal(fs.readFileSync(file, 'utf8'), SVG);
  assert.equal(fs.statSync(file).mtimeMs, beforeMtime);

  const empty = svgTools.tool_svg_edit({ filePath: 'plot.svg', ops: [], apply: true, beforeSha256: sha256(SVG) }, ctx);
  assert.equal(empty.ok, true);
  assert.equal(empty.changed, false);
});

test('BLOCK-342 P2 守卫：路径穿越 / 非 svg / 缺席 / apply 缺 beforeSha / 白名单外 requireAck', () => {
  const ws = makeWorkspace({ 'plot.svg': SVG, 'notes.md': '# x' });
  const ctx = ctxFor(ws);

  assert.equal(svgTools.tool_svg_inspect({ filePath: '../escape.svg' }, ctx).error, 'path_escape');
  assert.equal(svgTools.tool_svg_inspect({ filePath: 'notes.md' }, ctx).error, 'unsupported_format');
  assert.equal(svgTools.tool_svg_inspect({ filePath: 'ghost.svg' }, ctx).error, 'file_not_found');
  assert.equal(svgTools.tool_svg_inspect({ filePath: '' }, ctx).error, 'path_invalid');

  const noProject = svgTools.tool_svg_inspect({ filePath: 'plot.svg' }, {});
  assert.equal(noProject.error, 'project_required');

  const noSha = svgTools.tool_svg_edit({
    filePath: 'plot.svg',
    ops: [{ op: 'set_attr', target: { id: 'bar' }, name: 'x', value: '1' }],
    apply: true,
  }, ctx);
  assert.equal(noSha.error, 'before_sha_required');

  const dangerous = svgTools.tool_svg_edit({
    filePath: 'plot.svg',
    ops: [{ op: 'insert', parent: { id: 'plot' }, index: 'end', markup: '<script>alert(1)</script>' }],
  }, ctx);
  assert.equal(dangerous.error, 'svg_unsafe_markup');
  assert.equal(dangerous.requireAck, true);

  const unknownOp = svgTools.tool_svg_edit({
    filePath: 'plot.svg',
    ops: [{ op: 'rm_rf' }],
  }, ctx);
  assert.equal(unknownOp.error, 'svg_op_not_allowed');
  assert.equal(unknownOp.requireAck, true);

  assert.equal(fs.readFileSync(path.join(ws, 'plot.svg'), 'utf8'), SVG, '所有拒绝路径都不得写盘');
});

test('BLOCK-342 P2 超上限：>8MB 文件诚实拒收', () => {
  const ws = makeWorkspace({});
  const big = path.join(ws, 'big.svg');
  fs.writeFileSync(big, `<svg>${'<rect/>'.repeat(Math.ceil((9 * 1024 * 1024) / 6))}</svg>`, 'utf8');
  const r = svgTools.tool_svg_inspect({ filePath: 'big.svg' }, ctxFor(ws));
  assert.equal(r.error, 'file_too_large');
  assert.ok(String(r.message).includes('8MB'), r.message);
});
