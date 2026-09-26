#!/usr/bin/env node
/**
 * C-17c 走查 — 多文件深度任务续形态（队列项 5）：重复逻辑抽取为共享模块。
 * 播种 lib/a.js 与 lib/b.js 各自持有重复的 roundMoney 实现 + 行为测试 →
 * 真实模型任务「抽取到 lib/round.js，两文件改 import，行为不变」→
 * 防作弊验证：探针自持原始测试副本终态复跑（断言零弱化）+ 文件面核查。
 * 产出：acceptance/c17c-multifile/walkthrough.json
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const EVDIR = path.join(ROOT, 'acceptance', 'c17c-multifile');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(method, p, body) {
  const resp = await fetch(API + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await resp.json(); } catch {}
  return { ok: resp.ok, data };
}

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const A_JS = `function roundMoney(x) {
  return Math.round(x * 100) / 100;
}
function charge(cents) {
  return { billed: roundMoney(cents / 100), source: 'a' };
}
module.exports = { charge, roundMoney };
`;
const B_JS = `function roundMoney(x) {
  return Math.round(x * 100) / 100;
}
function refund(cents) {
  return { refunded: roundMoney(cents / 100), source: 'b' };
}
module.exports = { refund, roundMoney };
`;
const TESTS = `const { execFileSync } = require('child_process');
execFileSync(process.execPath, ['test/a.test.js'], { stdio: 'inherit' });
execFileSync(process.execPath, ['test/b.test.js'], { stdio: 'inherit' });
console.log('run-tests ALL PASS');
`;
const A_TEST = `const assert = require('assert');
const { charge } = require('../lib/a');
assert.deepStrictEqual(charge(1234), { billed: 12.34, source: 'a' });
assert.deepStrictEqual(charge(125), { billed: 1.25, source: 'a' });
console.log('a.test ALL PASS');
`;
const B_TEST = `const assert = require('assert');
const { refund } = require('../lib/b');
assert.deepStrictEqual(refund(999), { refunded: 9.99, source: 'b' });
assert.deepStrictEqual(refund(100), { refunded: 1, source: 'b' });
console.log('b.test ALL PASS');
`;

let projectId = null;

async function main() {
  fs.mkdirSync(EVDIR, { recursive: true });
  const created = await rest('POST', '/data/projects', { name: 'C17C-多文件-' + Date.now(), modality: 'general' });
  const project = created.data && (created.data.project || created.data);
  projectId = project && project.id;
  const detail = await rest('GET', '/data/projects/' + encodeURIComponent(projectId));
  const raw = (detail.data && detail.data.project) || project || {};
  const ws = raw.workspace_path || raw.workspacePath;
  fs.mkdirSync(path.join(ws, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(ws, 'test'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'lib', 'a.js'), A_JS);
  fs.writeFileSync(path.join(ws, 'lib', 'b.js'), B_JS);
  fs.writeFileSync(path.join(ws, 'test', 'a.test.js'), A_TEST);
  fs.writeFileSync(path.join(ws, 'test', 'b.test.js'), B_TEST);
  fs.writeFileSync(path.join(ws, 'run-tests.js'), TESTS);
  // 探针自持原始测试副本（防作弊验证器；.txt 后缀=纯证据文本，不进 knip 模块图）
  fs.writeFileSync(path.join(EVDIR, 'verify-runner.txt'), TESTS);
  fs.writeFileSync(path.join(EVDIR, 'a.test.origin.txt'), A_TEST);
  fs.writeFileSync(path.join(EVDIR, 'b.test.origin.txt'), B_TEST);
  git(ws, ['init']);
  git(ws, ['add', '.']);
  git(ws, ['-c', 'user.name=c17c', '-c', 'user.email=probe@local', 'commit', '-m', 'baseline: duplicated roundMoney']);
  execFileSync(process.execPath, ['run-tests.js'], { cwd: ws, stdio: 'pipe' });
  console.log('[S1] seeded', ws);

  // ── S2 任务（多文件抽取重构） ──
  const instruction = '工作区 ' + ws + '：lib/a.js 和 lib/b.js 里各自有一份完全重复的 roundMoney 函数。' +
    '请把它抽取到 lib/round.js（module.exports 共享），a.js 和 b.js 改为 require 它并删掉各自的重复实现，' +
    '对外行为必须完全不变（charge/refund 的返回值一个字段都不能变）。改完运行 node run-tests.js 验证并报告结果。';
  const started = Date.now();
  const sub = await rest('POST', '/ai/agent', {
    messages: [{ role: 'user', content: instruction }],
    context: { projectId, page: 'workspace', pageTitle: '项目工作区', accessMode: 'full' },
  });
  const { taskId } = sub.data;
  const deadline = Date.now() + 5 * 60_000;
  let terminal = null;
  while (Date.now() < deadline) {
    await sleep(3000);
    const t = await rest('GET', '/ai/agent/task/' + encodeURIComponent(taskId) + '/meta');
    const s = t.data && (t.data.agentStatus || t.data.agent_status);
    if (['completed', 'done', 'failed', 'cancelled'].includes(s)) { terminal = s; break; }
  }
  console.log(`[S2] terminal=${terminal} 耗时=${Math.round((Date.now() - started) / 1000)}s`);

  // ── S3 防作弊终态复核 ──
  const roundExists = fs.existsSync(path.join(ws, 'lib', 'round.js'));
  const aSrc = fs.readFileSync(path.join(ws, 'lib', 'a.js'), 'utf8');
  const bSrc = fs.readFileSync(path.join(ws, 'lib', 'b.js'), 'utf8');
  const dupGoneA = !/function roundMoney/.test(aSrc);
  const dupGoneB = !/function roundMoney/.test(bSrc);
  const bothImport = /require\(['"]\.\/round|require\(['"]\.\.\/round/.test(aSrc + bSrc);
  // 自持 runner + 自持测试副本复跑（不信任工作区测试文件）；验证工作区放系统临时目录
  // （不入 acceptance/——证据目录含活 JS 模块会触发 knip 误报）
  const tmpVerify = fs.mkdtempSync(path.join(os.tmpdir(), 'c17c-verify-'));
  fs.mkdirSync(path.join(tmpVerify, 'test'), { recursive: true });
  for (const f of ['lib/round.js', 'lib/a.js', 'lib/b.js']) {
    const src = path.join(ws, f);
    const dst = path.join(tmpVerify, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  fs.writeFileSync(path.join(tmpVerify, 'test', 'a.test.js'), A_TEST);
  fs.writeFileSync(path.join(tmpVerify, 'test', 'b.test.js'), B_TEST);
  let verifyPass = false;
  try {
    const out = execFileSync(process.execPath, ['test/a.test.js'], { cwd: tmpVerify, encoding: 'utf8' });
    const out2 = execFileSync(process.execPath, ['test/b.test.js'], { cwd: tmpVerify, encoding: 'utf8' });
    verifyPass = /ALL PASS/.test(out) && /ALL PASS/.test(out2);
  } catch { verifyPass = false; }
  const gitChanged = git(ws, ['status', '--porcelain']).trim().split('\n').filter(Boolean).length;

  const allPass = roundExists && dupGoneA && dupGoneB && bothImport && verifyPass && terminal !== 'failed';
  console.log(`[S3] round.js=${roundExists} 重复清除 a=${dupGoneA}/b=${dupGoneB} 双改 import=${bothImport}`);
  console.log(`[S3] 自持副本复跑（断言零弱化）=${verifyPass} 变更文件数=${gitChanged}`);
  fs.writeFileSync(path.join(EVDIR, 'walkthrough.json'), JSON.stringify({
    projectId, ws, taskId, terminal,
    at: new Date().toISOString(),
    roundExists, dupGoneA, dupGoneB, bothImport, verifyPass, changedFiles: gitChanged,
    allPass,
  }, null, 2));
  console.log('allPass=' + allPass);
}

main().catch((e) => { console.error('PROBE FAILED:', e); process.exitCode = 1; })
  .finally(async () => { if (projectId) { const d = await rest('DELETE', '/data/projects/' + encodeURIComponent(projectId)); console.log('cleanup:', d.ok ? 'ok' : 'fail'); } });
