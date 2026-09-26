#!/usr/bin/env node
/**
 * BLOCK-124 P1 — codegraph 工具实机走查探针（plan §3.1 C-13 验收）。
 *
 * 任务语义：临时项目带「死导出清理」场景（legacyRound 仅被 ui.mjs 无用导入）→
 * 真实 chat 指令「查清引用关系→确认安全→删→跑测试」→ 观察 agent 是否自主调用
 * codegraph_who_imports / codegraph_classify_edges（指令不点名工具），工具结果
 * 是否正确回传（UNUSED 判定），终态是否真清理 + 测试真通过。
 *
 * 判定口径：通（有证据）/ 涩（绕路但达成）/ 断（走不通）。
 * 产出：acceptance/block-124/p1-walkthrough.json + p1-walkthrough.log.txt
 * 前置：dev 后端 :3001（新代码已重启）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const TASK_TIMEOUT_MS = Number(process.env.BLOCK124_TASK_TIMEOUT_MS || 8 * 60_000);
const EVDIR = path.join(ROOT, 'acceptance', 'block-124');

const stages = [];
const record = (stage, verdict, detail) => {
  stages.push({ stage, verdict, detail: String(detail).slice(0, 800) });
  console.log(`[${verdict}] ${stage} — ${String(detail).slice(0, 220)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(method, p, body) {
  const resp = await fetch(API + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await resp.json(); } catch { /* non-json */ }
  return { ok: resp.ok, data };
}

async function submitAndWait(message, context, timeoutMs) {
  const sub = await rest('POST', '/ai/agent', { messages: [{ role: 'user', content: message }], context });
  if (!sub.ok || !sub.data || !sub.data.taskId) throw new Error('chat 提交失败: ' + JSON.stringify(sub.data).slice(0, 200));
  const { taskId, conversationId } = sub.data;
  const deadline = Date.now() + timeoutMs;
  let terminal = null;
  while (Date.now() < deadline) {
    await sleep(3000);
    const t = await rest('GET', '/ai/agent/task/' + encodeURIComponent(taskId) + '/meta');
    const status = t.data && (t.data.agentStatus || t.data.agent_status);
    if (['completed', 'done', 'failed', 'cancelled'].includes(status)) { terminal = status; break; }
  }
  return { taskId, conversationId, terminal };
}

async function collectEvents(taskId, timeoutMs) {
  const url = API + '/ai/agent/task/' + encodeURIComponent(taskId) + '?afterSeq=0';
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const events = [];
  try {
    const resp = await fetch(url, { headers: AUTH, signal: abort.signal });
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf8');
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const SEP = '\n\n';
      let sep;
      while ((sep = buffer.indexOf(SEP)) !== -1) {
        const line = buffer.slice(0, sep).trim();
        buffer = buffer.slice(sep + 2);
        if (!line.startsWith('data:')) continue;
        try { events.push(JSON.parse(line.slice(5).trim())); } catch { /* skip */ }
      }
    }
  } catch { /* timeout 中断属预期 */ }
  clearTimeout(timer);
  return events;
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

const UTIL_JS = `exports.safeDivide = (a, b) => {
  if (b === 0) throw new Error('division by zero');
  return a / b;
};
exports.legacyRound = (x) => Math.round(x);
`;
const UI_MJS = `import { legacyRound } from './lib/util.js';

export const label = 'ui';
console.log(label);
`;
const APP_JS = `const { safeDivide } = require('./lib/util');
console.log(safeDivide(10, 2));
`;
const UTIL_TEST_JS = `const { safeDivide } = require('../lib/util');

if (safeDivide(10, 2) !== 5) throw new Error('safeDivide(10,2) should be 5');
try {
  safeDivide(1, 0);
  throw new Error('safeDivide(1,0) should throw');
} catch (e) {
  if (!/zero/.test(e.message)) throw new Error('wrong error: ' + e.message);
}
console.log('util.test.js ALL PASS');
`;
const RUN_TESTS_JS = `const { execFileSync } = require('child_process');
execFileSync(process.execPath, ['test/util.test.js'], { stdio: 'inherit' });
console.log('run-tests ALL PASS');
`;

let projectId = null;

async function main() {
  fs.mkdirSync(EVDIR, { recursive: true });
  const health = await rest('GET', '/health');
  if (!health.ok || !health.data || health.data.status !== 'ok') throw new Error('后端不健康');

  // ── S1 播种 ──
  const created = await rest('POST', '/data/projects', { name: 'BLOCK124-走查-' + Date.now(), modality: 'general' });
  const project = created.data && (created.data.project || created.data);
  projectId = project && project.id;
  if (!projectId) throw new Error('项目创建失败: ' + JSON.stringify(created.data).slice(0, 140));
  const detail = await rest('GET', '/data/projects/' + encodeURIComponent(projectId));
  const rawProject = (detail.data && detail.data.project) || project || {};
  const workspacePath = rawProject.workspace_path || rawProject.workspacePath;
  if (!workspacePath || !fs.existsSync(workspacePath)) throw new Error('workspace 未解析: ' + String(workspacePath));
  fs.mkdirSync(path.join(workspacePath, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(workspacePath, 'test'), { recursive: true });
  fs.writeFileSync(path.join(workspacePath, 'lib', 'util.js'), UTIL_JS);
  fs.writeFileSync(path.join(workspacePath, 'ui.mjs'), UI_MJS);
  fs.writeFileSync(path.join(workspacePath, 'app.js'), APP_JS);
  fs.writeFileSync(path.join(workspacePath, 'test', 'util.test.js'), UTIL_TEST_JS);
  fs.writeFileSync(path.join(workspacePath, 'run-tests.js'), RUN_TESTS_JS);
  git(workspacePath, ['init']);
  git(workspacePath, ['add', '.']);
  git(workspacePath, ['-c', 'user.name=b124-probe', '-c', 'user.email=probe@local', 'commit', '-m', 'baseline: legacyRound dead-export scenario']);
  try { execFileSync(process.execPath, ['run-tests.js'], { cwd: workspacePath }); } catch ( e ) { throw new Error('基线测试本应通过: ' + e); }
  record('S1 播种', '通', `projectId=${projectId} workspace=${workspacePath}（legacyRound=死导出场景：ui.mjs 导入未用）`);

  // ── S2 指令（真实模型；不点名工具） ──
  const instruction =
    '工作区 ' + workspacePath + '：lib/util.js 里的 legacyRound 我们想清理掉。' +
    '请先查清它当前所有的引用关系（哪些文件导入、是否真实使用），确认删除安全后：' +
    '删除 legacyRound 的导出，同时清掉所有文件里对它的无用导入行，' +
    '然后运行 node run-tests.js 验证，并报告引用查证结论与测试结果。';
  const started = Date.now();
  const { taskId, conversationId, terminal } = await submitAndWait(
    instruction,
    { projectId, page: 'workspace', pageTitle: '项目工作区', accessMode: 'full' },
    TASK_TIMEOUT_MS,
  );
  record('S2 指令', terminal === 'completed' || terminal === 'done' ? '通' : '断',
    `taskId=${taskId} terminal=${terminal} 耗时=${Math.round((Date.now() - started) / 1000)}s`);

  // ── S3 工具序列取证 ──
  const events = await collectEvents(taskId, 15_000);
  const payloads = events.map((e) => (e && e.payload) || e);
  const toolCalls = payloads
    .filter((p) => p && p.event === 'tool_call')
    .map((p) => ({ name: p.name || (p.tool && p.tool.name) || p.toolName, args: p.arguments || p.args || p.tool_arguments }));
  const seq = toolCalls.map((t) => t.name).filter(Boolean);
  const codegraphCalls = toolCalls.filter((t) => typeof t.name === 'string' && t.name.startsWith('codegraph_'));
  record('S3 工具序列', '通', `序列=[${seq.join(' → ')}]；codegraph 调用=${codegraphCalls.length}`);

  // ── S4 codegraph 工具结果取证（回传内容正确性） ──
  const toolResults = payloads.filter((p) => p && (p.event === 'tool_result' || p.event === 'tool_output'));
  const codegraphResults = [];
  for (const p of toolResults) {
    const text = JSON.stringify(p).slice(0, 2000);
    if (text.includes('codegraph_')) codegraphResults.push(text);
  }
  const sawUnusedVerdict = codegraphResults.some((t) => /UNUSED|导入未用|used.: false/i.test(t));
  record('S4 工具结果', codegraphCalls.length > 0 ? (sawUnusedVerdict ? '通' : '涩') : '断',
    codegraphCalls.length > 0
      ? `codegraph 结果 ${codegraphResults.length} 条；UNUSED 判定回传=${sawUnusedVerdict}；样例=${codegraphResults[0] ? codegraphResults[0].slice(0, 200) : 'n/a'}`
      : '模型未调用 codegraph 工具（改用 grep/search 路径）');

  // ── S5 终态独立复核（探针自持，不信任模型自述） ──
  const utilFinal = fs.readFileSync(path.join(workspacePath, 'lib', 'util.js'), 'utf8');
  const uiFinal = fs.readFileSync(path.join(workspacePath, 'ui.mjs'), 'utf8');
  const legacyGone = !utilFinal.includes('legacyRound');
  const uiImportCleaned = !uiFinal.includes('legacyRound');
  let testsPass = false;
  try {
    const out = execFileSync(process.execPath, ['run-tests.js'], { cwd: workspacePath, encoding: 'utf8' });
    testsPass = /ALL PASS/.test(out);
  } catch { testsPass = false; }
  record('S5 终态复核', legacyGone && uiImportCleaned && testsPass ? '通' : '断',
    `legacyRound 删除=${legacyGone} ui.mjs 导入清理=${uiImportCleaned} 探针独立复跑测试 PASS=${testsPass}`);

  // ── S6 最终回答（引用结论是否真实） ──
  const messages = payloads.filter((p) => p && p.event === 'message' && p.role !== 'user');
  const finalText = messages.map((m) => String(m.content || '')).join('\n').slice(-1500);
  record('S6 回答引用', /legacyRound/.test(finalText) ? '通' : '涩', `回答提及 legacyRound 结论；尾部=${finalText.slice(-260)}`);

  const allPass = stages.every((s) => s.verdict !== '断') && codegraphCalls.length > 0 && legacyGone && testsPass;
  const summary = {
    projectId, workspacePath, taskId, conversationId,
    at: new Date().toISOString(),
    toolSequence: seq,
    codegraphCalls: codegraphCalls.map((c) => c.name),
    stages,
    allPass,
  };
  fs.writeFileSync(path.join(EVDIR, 'p1-walkthrough.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(EVDIR, 'p1-walkthrough.log.txt'), stages.map((s) => `[${s.verdict}] ${s.stage} — ${s.detail}`).join('\n\n'));
  console.log(`\nallPass=${summary.allPass}（判定=codegraph 被自主调用 + 终态真清理 + 测试真通过 + 零断）`);
}

main().catch((e) => {
  console.error('PROBE FAILED:', e);
  process.exitCode = 1;
}).finally(async () => {
  if (projectId) {
    const d = await rest('DELETE', '/data/projects/' + encodeURIComponent(projectId));
    console.log(`cleanup: project delete ${d.ok ? 'ok' : 'failed'}`);
  }
});
