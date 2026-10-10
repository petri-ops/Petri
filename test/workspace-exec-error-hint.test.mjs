// G-04 根治（BLOCK-123 遗留观察项清偿）轻量批 — workspace_exec 命令不存在反馈增形契约。
// 红绿先行：本文件先于实现落盘。
// 语义：spawn ENOENT / command not found 时，结果附 commandNotFoundHint（有界候选：
// package.json scripts ≤10 / 根+test/ 测试文件 ≤8 / 常见 runner 文件 ≤5）+ note 一行指路；
// 真实失败（命令存在、非零退出）不得误挂提示——stderr 保持进程原貌。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require_ = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const R_SERVER = resolve(__dirname, '..', 'core', 'petri-server');

// 自举临时 DB（registry 链路 require 面同款，PETRI_DB_PATH 须在 require 前生效）
{
  const fs = require_('fs');
  const os = require_('os');
  const nodePath = require_('path');
  const Database = require_(R_SERVER + '/node_modules/better-sqlite3');
  const tempDbDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'g04-exec-hint-db-'));
  const boot = new Database(nodePath.join(tempDbDir, 'petri.db'));
  const migrationsDir = resolve(__dirname, '..', 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(nodePath.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = nodePath.join(tempDbDir, 'petri.db');
  process.on('exit', () => {
    try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch {}
  });
}

const { createWorkspaceTools } = require_('../core/petri-server/agent-tools/workspace-tools.js');

function seedProject({ scripts = { test: 'node run-tests.js', lint: 'eslint .' }, extraTestFiles = 0 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'g04-exec-hint-fx-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'fx',
    scripts: extraTestFiles
      ? Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`script${i}`, 'echo x']))
      : scripts,
  }));
  writeFileSync(join(root, 'run-tests.js'), "console.log('run-tests ALL PASS');\n");
  writeFileSync(join(root, 'app.test.js'), "console.log('app');\n");
  mkdirSync(join(root, 'test'), { recursive: true });
  writeFileSync(join(root, 'test', 'unit.test.js'), "console.log('unit');\n");
  return root;
}

function makeTools(root) {
  return createWorkspaceTools({
    dbProvider: () => ({
      getProject: () => ({ id: 'p_g04', user_id: 'u1', status: 'active', workspace_path: root }),
    }),
  });
}

const ctx = { projectId: 'p_g04', userId: 'u1', accessMode: 'full' };

test('命令不存在（ENOENT）→ commandNotFoundHint 在场：query+scripts+测试文件+runner 候选+note 指路', async () => {
  const root = seedProject();
  try {
    const tools = makeTools(root);
    const r = await tools.executeCommand({ command: 'definitely-missing-runner-xyz --check' }, ctx);
    assert.equal(r.ok, false);
    assert.ok(r.commandNotFoundHint, 'hint 字段在场');
    assert.equal(r.commandNotFoundHint.query, 'definitely-missing-runner-xyz');
    assert.ok(r.commandNotFoundHint.npmScripts.includes('test'), 'package.json scripts 候选');
    assert.ok(r.commandNotFoundHint.testFiles.includes('app.test.js'), '根级测试文件候选');
    assert.ok(r.commandNotFoundHint.testFiles.includes('test/unit.test.js'), 'test/ 目录文件候选');
    assert.ok(r.commandNotFoundHint.runnerFiles.includes('run-tests.js'), '常见 runner 候选');
    assert.match(r.note || '', /候选|不存在/);
    assert.ok((r.stderr || '').length > 0, 'stderr 保持进程原貌（Windows 为 cmd 本地化文案）');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('真实失败（命令存在、非零退出）→ 不误挂提示，stderr 保持进程原貌（模块不存在≠可执行文件不存在）', async () => {
  const root = seedProject();
  try {
    const tools = makeTools(root);
    const r = await tools.executeCommand({ command: 'node definitely-missing-script.js' }, ctx);
    assert.equal(r.ok, false);
    assert.match(r.stderr || '', /Cannot find module|MODULE_NOT_FOUND/);
    assert.equal(r.commandNotFoundHint, undefined, 'node 在场只是模块缺失——不得挂 not-found 提示');
    assert.equal(r.note, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('候选有界：scripts 截 10、测试文件合计截 8', async () => {
  const root = seedProject({ extraTestFiles: true });
  try {
    writeFileSync(join(root, 'b.test.js'), 'x');
    writeFileSync(join(root, 'c.test.js'), 'x');
    const tools = makeTools(root);
    const r = await tools.executeCommand({ command: 'no-such-binary-qq' }, ctx);
    assert.equal(r.ok, false);
    assert.ok(r.commandNotFoundHint, 'hint 在场');
    assert.ok(r.commandNotFoundHint.npmScripts.length <= 10, 'scripts ≤10');
    assert.ok(r.commandNotFoundHint.testFiles.length <= 8, '测试文件 ≤8');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('yield 路径同享：yield_ms 中间档 not-found 同样附提示', async () => {
  const root = seedProject();
  try {
    const tools = makeTools(root);
    const r = await tools.executeCommand({ command: 'no-such-binary-yq --run', yield_ms: 2000 }, ctx);
    assert.equal(r.ok, false);
    assert.ok(r.commandNotFoundHint, 'yield 路径 hint 在场');
    assert.equal(r.commandNotFoundHint.query, 'no-such-binary-yq');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
