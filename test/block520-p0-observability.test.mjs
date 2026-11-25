/**
 * BLOCK-520 P0 — HK-01 红绿先行契约
 *
 * OB-001 console→logger 收敛 / OB-004 error-log 静默吞修复+dedupe+console.error 桥接 /
 * OB-007 进程错误处理器加固（unhandledRejection 必触 error-log，E-019）。
 *
 * error-log 状态与 env 在 require 时固化，故用子进程隔离取证（不污染测试进程）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const EL = path.join(ROOT, 'core/shared-backend/error-log.js');

function runChild(body, extraEnv = {}) {
  const r = spawnSync(process.execPath, ['-e', body], {
    cwd: ROOT,
    encoding: 'utf-8',
    env: { ...process.env, ...extraEnv },
  });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

// ---- OB-001 静态收敛 ----------------------------------------------------

const CONSOLE_TARGETS = [
  'core/petri-server/helpers/tools-executor.js',
  'core/petri-server/server-main.js',
  'core/petri-server/routes/ai-chat.js',
  'core/petri-server/server.js',
];

test('OB-001 选定 4 文件 console. 合计 < 10 且均引入可解析的结构化 logger', () => {
  let total = 0;
  for (const rel of CONSOLE_TARGETS) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
    total += (src.match(/console\./g) || []).length;
    const m = src.match(/require\(['"]([^'"]*logger)['"]\)/);
    assert.ok(m, `${rel} 必须引入结构化 logger`);
    // 路径必须真实可解析：曾经 server.js 把 ../../ 写成越级路径导致启动即崩。
    const abs = path.resolve(path.dirname(path.join(ROOT, rel)), m[1]);
    assert.ok(fs.existsSync(`${abs}.js`) || fs.existsSync(abs), `${rel} 的 logger 路径不可解析：${m[1]}`);
  }
  assert.ok(total < 10, `4 文件 console. 合计须 <10，实测 ${total}`);
});

// ---- OB-004 error-log 写盘 / dedupe / 静默吞 -----------------------------

const WRITE_SCRIPT = `
const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b520-write-'));
process.env.PETRI_ERROR_LOG_FILE = path.join(dir, 'errors.log');
process.env.PETRI_ERROR_DEDUPE_MS = '60000';
const el = require(${JSON.stringify(EL)});
if (el.resetErrorLogState) el.resetErrorLogState();
el.logError('unit', new Error('first'));
el.logError('unit', new Error('first'));
el.logError('unit', new Error('second'));
setTimeout(() => {
  const raw = fs.readFileSync(path.join(dir, 'errors.log'), 'utf8');
  process.stdout.write(JSON.stringify({
    entries: raw.trim().split('\\n').filter(Boolean).map(JSON.parse),
    stats: el.getDedupeStats ? el.getDedupeStats() : null,
  }));
}, 60);
`;

test('OB-004 error-log 落盘且 dedupe 抑制重复（首次必落盘）', () => {
  const r = runChild(WRITE_SCRIPT);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.entries.length, 2, `应落 2 条（去重后），实测 ${JSON.stringify(out.entries)}`);
  assert.deepEqual(out.entries.map((e) => e.message), ['first', 'second']);
  assert.ok(out.stats && out.stats.suppressed >= 1, `dedupe 统计须记录抑制：${JSON.stringify(out.stats)}`);
});

const FAIL_SCRIPT = `
const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b520-fail-'));
process.env.PETRI_ERROR_LOG_FILE = dir; // 目录不可 append → EISDIR
process.env.PETRI_ERROR_DEDUPE_MS = '60000';
const el = require(${JSON.stringify(EL)});
if (el.resetErrorLogState) el.resetErrorLogState();
el.logError('unit', new Error('write-fail'));
setTimeout(() => {
  process.stdout.write(JSON.stringify({
    last: el.getLastWriteError ? el.getLastWriteError() : null,
  }));
}, 60);
`;

test('OB-004 写盘失败不再静默吞：留痕可查 + stderr 可见', () => {
  const r = runChild(FAIL_SCRIPT);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(out.last, '写盘失败必须可通过 getLastWriteError 查到');
  assert.match(r.stderr, /error-log.*write failed|write failed.*error-log/i, `stderr 须报写盘失败：${r.stderr}`);
});

// ---- OB-004 console.error 桥接 + OB-007 进程错误处理器 -------------------

const BRIDGE_SCRIPT = `
const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b520-bridge-'));
process.env.PETRI_ERROR_LOG_FILE = path.join(dir, 'errors.log');
process.env.PETRI_ERROR_DEDUPE_MS = '60000';
const el = require(${JSON.stringify(EL)});
if (el.resetErrorLogState) el.resetErrorLogState();
el.installConsoleErrorBridge();
el.installProcessErrorHandlers({ exitOnFatal: false });
console.error('bridged boom');
process.emit('unhandledRejection', new Error('rej boom'), Promise.resolve());
setTimeout(() => {
  const raw = fs.readFileSync(path.join(dir, 'errors.log'), 'utf8');
  process.stdout.write(raw);
}, 60);
`;

test('OB-004/007 console.error 与 unhandledRejection 均必触 error-log（E-019）', () => {
  const r = runChild(BRIDGE_SCRIPT);
  assert.equal(r.status, 0, r.stderr);
  const entries = r.stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
  const bySource = (s) => entries.find((e) => e.source === s);
  assert.ok(bySource('console.error'), `console.error 须桥接落盘，实测 ${r.stdout}`);
  assert.match(bySource('console.error').message, /bridged boom/);
  assert.ok(bySource('unhandledRejection'), `unhandledRejection 须落盘，实测 ${r.stdout}`);
  assert.match(bySource('unhandledRejection').message, /rej boom/);
  assert.match(r.stderr, /bridged boom/, 'console.error 原行为（stderr 可见）须保留');
});
