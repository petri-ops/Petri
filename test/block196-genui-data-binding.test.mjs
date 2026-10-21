/**
 * BLOCK-196 — gen-ui 数据面只读绑定（petri.getData → `gen-ui:get-data`）契约测。
 *
 * 缘起（BLOCK-195 竞争力复测的副产品）：锚点清单把 dim6「D16 卡片自取数」记成无锚点位，
 * 实为**有实现无锚**——`src/ipc/gen-ui.js:244` 的 CP-11 中继自 BLOCK-174 落地起零机械断言。
 * 补锚过程中撞出真缺陷：跨会话归属校验用 `session.filePath.split('/')` 取 conversationId，
 * 而 Windows 真实路径是反斜杠（prepareGenUi 走 realpath 得原生分隔符），于是 conversationId 恒 null、
 * `cross_conversation` 分支**在 Windows 上整体空转**——同窗内任意会话的 jobId 都能被读到。
 * 因此本测既是锚，也是红绿对：Windows 形状用例在修复前必须红。
 *
 * 六道闸逐一钉：会话存在 / 窗主一致（ownerWebContentsId）/ 入参形状 / 任务存在 /
 * 跨会话拒 / 未完成拒 / 有界投影（>12KB 置 truncated 并截尾）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// ---- 环境准备（必须在 require 目标模块之前装好 electron/db 替身） ----------------
const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'b196-genui-'));
const CONVERSATION = 'conv_a1b2c3';
const OTHER_CONVERSATION = 'conv_zzz999';

function fragmentPath(conversationId) {
  const dir = path.join(wsRoot, '.petri', 'gen-ui', conversationId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'chart.html');
  fs.writeFileSync(file, '<div>x</div>');
  return file;
}

const handlers = new Map();
const fakeIpcMain = { handle: (name, fn) => handlers.set(name, fn) };
let senderId = 7; // 每个用例可切换"当前调用窗"
const fakeEvent = { get sender() { return { id: senderId }; }, senderFrame: { url: 'http://localhost:3000/' } };

const electronStub = new Proxy(
  {
    ipcMain: fakeIpcMain,
    app: { getPath: () => wsRoot, getAppPath: () => wsRoot, on: () => {}, whenReady: () => Promise.resolve() },
    BrowserWindow: class {},
    shell: { openExternal: () => Promise.resolve(true) },
  },
  { get: (target, key) => (key in target ? target[key] : () => undefined) },
);

let currentJob;
// BLOCK-228 rider — 实现改走后端 REST /api/tools/status/:id（主进程不开库），
// 测试替身从 db stub 同步换成 fetch stub（契约漂移：让测试追上契约）。
const origFetch = globalThis.fetch;
globalThis.fetch = async () => {
  if (!currentJob) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  let result = currentJob.result_json;
  try { result = JSON.parse(currentJob.result_json); } catch {}
  return new Response(JSON.stringify({
    ok: true,
    id: currentJob.id,
    toolId: currentJob.tool_id,
    status: currentJob.status,
    conversationId: currentJob.conversation_id || null,
    result,
  }), { status: 200 });
};

const origLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return origLoad.call(this, request, parent, isMain);
};

const { createGenUiSession } = require('../src/main/gen-ui/scheme.js');
const { setupGenUiIpc } = require('../src/ipc/gen-ui.js');
setupGenUiIpc();
const callGetData = (payload) => handlers.get('gen-ui:get-data')(fakeEvent, payload);

function session(conversationId, ownerWebContentsId = 7) {
  const created = createGenUiSession({ filePath: fragmentPath(conversationId), title: 'chart', ownerWebContentsId });
  return typeof created === 'string' ? created : created.id || created.sessionId;
}

function doneJob(id = 'job_1', conversationId = CONVERSATION, result = { rows: [[1, 2]] }) {
  return { id, user_id: 'u1', conversation_id: conversationId, tool_id: 'workspace_exec', status: 'done', result_json: JSON.stringify(result) };
}

const sessionIdForA = session(CONVERSATION);

test('注册面：gen-ui:get-data 处理器在场（通道登记与 handler 不脱节）', () => {
  assert.equal(typeof handlers.get('gen-ui:get-data'), 'function');
});

test('六道闸诚实拒绝：会话不存在/空 jobId/窗主不符/任务不存在/未完成 各给码', async () => {
  currentJob = doneJob();
  assert.equal((await callGetData({ sessionId: 'nope', jobId: 'job_1' })).code, 'session_not_found');
  assert.equal((await callGetData({ sessionId: sessionIdForA, jobId: '   ' })).code, 'invalid_arguments');
  senderId = 99;
  assert.equal((await callGetData({ sessionId: sessionIdForA, jobId: 'job_1' })).code, 'forbidden');
  senderId = 7;
  currentJob = null;
  assert.equal((await callGetData({ sessionId: sessionIdForA, jobId: 'missing' })).code, 'job_not_found');
  currentJob = { ...doneJob(), status: 'running' };
  assert.equal((await callGetData({ sessionId: sessionIdForA, jobId: 'job_1' })).code, 'job_not_done');
});

test('正常路径：本会话已完成任务返回有界投影并带 jobId/toolId/status', async () => {
  currentJob = doneJob();
  const res = await callGetData({ sessionId: sessionIdForA, jobId: 'job_1' });
  assert.equal(res.ok, true);
  assert.equal(res.data.jobId, 'job_1');
  assert.equal(res.data.toolId, 'workspace_exec');
  assert.deepEqual(res.data.result, { rows: [[1, 2]] });
  assert.equal(res.data.truncated, undefined);
});

test('有界投影：>12KB 结果置 truncated 并截尾，不把整坨原文塞进沙箱', async () => {
  currentJob = doneJob('job_big', CONVERSATION, { blob: 'x'.repeat(20_000) });
  const res = await callGetData({ sessionId: sessionIdForA, jobId: 'job_big' });
  assert.equal(res.ok, true);
  assert.equal(res.data.truncated, true);
  assert.ok(JSON.stringify(res.data).length <= 13 * 1024, '投影必须守在上界内');
});

function registerSessionWithFilePath(filePath, ownerWebContentsId = 7) {
  const created = createGenUiSession({ filePath, title: 'chart', ownerWebContentsId });
  return typeof created === 'string' ? created : created.id || created.sessionId;
}

test('跨会话取数必须拒（原生与强制两种路径形状都得算出 conversationId）', async () => {
  currentJob = doneJob('job_x', OTHER_CONVERSATION);
  const native = fragmentPath(CONVERSATION);
  const shapes = [['本机原生形状', native], ['斜杠形状', native.replaceAll('\\', '/')], ['反斜杠形状', native.replaceAll('/', '\\')]];
  for (const [label, filePath] of shapes) {
    const sid = registerSessionWithFilePath(filePath);
    const res = await callGetData({ sessionId: sid, jobId: 'job_x' });
    assert.equal(res.code, 'cross_conversation', `${label} 下跨会话取数必须被拦住（拿到 ${res.code}）`);
  }
});

test('算不出会话归属时 fail-closed：不拿"未知"当"允许"', async () => {
  currentJob = doneJob('job_y', CONVERSATION);
  const weird = registerSessionWithFilePath(path.join(wsRoot, 'loose', 'chart.html'));
  const res = await callGetData({ sessionId: weird, jobId: 'job_y' });
  assert.equal(res.ok, false, '路径里没有 conv 段=无法证明归属，必须拒');
  assert.equal(res.code, 'session_scope_unknown');
});
test('同会话任务放行不受路径形状影响（修复不得反向变严）', async () => {
  currentJob = doneJob('job_same', CONVERSATION);
  const res = await callGetData({ sessionId: sessionIdForA, jobId: 'job_same' });
  assert.equal(res.ok, true);
});

process.on('exit', () => { Module._load = origLoad; globalThis.fetch = origFetch; try { fs.rmSync(wsRoot, { recursive: true, force: true }); } catch { /* 句柄延迟 */ } });
