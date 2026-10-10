#!/usr/bin/env node
/**
 * BLOCK-156 P3 实机走查 — MCP 工具投影进 agent 全链：
 * 夹具 MCP server 连接 → 工具以 mcp_fixture_fixture_echo 投影进 provider 请求 →
 * 真实模型自主调用 → 工具结果（echo: …）回流 assistant 回复 → 档位面（full 档放行）。
 * 产出：acceptance/block-156/mcp-agent-loop-live.json
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const LOCAL_DATA_DIR = path.join(ROOT, '.biof3-dev-user-data', 'data');
const EVDIR = path.join(ROOT, 'acceptance', 'block-156');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ASSERTIONS = [];
function assert(name, pass, detail = '') {
  ASSERTIONS.push({ name, pass: !!pass, detail: String(detail).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${String(detail).slice(0, 140)}` : ''}`);
}

async function api(method, p, body) {
  const resp = await fetch(API + p, {
    method,
    headers: AUTH,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  let text = '';
  try { json = await resp.json(); } catch { text = await resp.text().catch(() => ''); }
  return { status: resp.status, json, text: text || JSON.stringify(json || {}) };
}

// ---- 主流程 ----
const SERVER_ID = 'fixture';
const startedAt = new Date().toISOString();
console.log('[block156-p3-live] start', startedAt);

// 1) 栈健康
const health = await api('GET', '/data/projects');
assert('dev_stack_api_ready', health.status === 200, `GET /api/data/projects → ${health.status}`);
if (health.status !== 200) { console.log('ABORT'); process.exit(1); }

// 2) MCP server 就位：添加 + 连接（连接即投影）
await api('POST', '/mcp/servers/fixture/disconnect').catch(() => {});
await api('DELETE', '/mcp/servers/fixture').catch(() => {});
const add = await api('POST', '/mcp/servers', {
  id: SERVER_ID, command: process.execPath,
  args: [path.join(ROOT, 'test', 'fixtures', 'mcp-fixture-server.cjs')],
  autoConnect: false,
});
assert('fixture_server_added', add.status === 200, `status=${add.status}`);
const conn = await api('POST', `/mcp/servers/${SERVER_ID}/connect`);
assert('fixture_connected_toolcount_1',
  conn.status === 200 && conn.json && conn.json.toolCount === 1,
  `status=${conn.status} body=${JSON.stringify(conn.json).slice(0, 160)}`);

// 3) 选聊天渠道（复用 block155 选型：openai 系 preset 第一项即可，无需 vision）
const settingsRes = await api('GET', '/ai/settings');
const s = settingsRes.json || {};
const presets = s.chat_model_presets || (s.settings && s.settings.chat_model_presets) || [];
const chosen = presets[0];
assert('chat_preset_available', !!chosen, `presets=${presets.length}`);
if (!chosen) { console.log('ABORT: 无可用聊天渠道'); process.exit(1); }
console.log('[block156-p3-live] preset', chosen.id, chosen.model);

// 4) 临时项目 + 任务
const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b156-p3-ws-'));
const proj = await api('POST', '/data/projects', {
  name: 'BLOCK-156-P3（临时验收，可删）',
  workspacePath: wsDir,
  modality: 'general',
});
const project = proj.json && proj.json.project;
assert('temp_project_created', proj.status === 200 && !!project, `status=${proj.status}`);
if (!project) { console.log('ABORT'); process.exit(1); }

const secret = `格物${Date.now() % 100000}`;
const question = `请调用工具 mcp_fixture_fixture_echo，参数 message 设为 "${secret}"，然后把工具返回的文本原样告诉我（只要工具返回原文）。`;
const send = await api('POST', '/ai/agent', {
  messages: [{ role: 'user', content: question }],
  context: { projectId: project.id, accessMode: 'full' },
  modelPresetId: chosen.id,
  kind: 'primary',
});
const taskId = send.json && (send.json.taskId || (send.json.task && send.json.task.taskId));
assert('agent_task_accepted', send.status === 200 && !!taskId, `status=${send.status} body=${send.text.slice(0, 120)}`);
if (!taskId) { console.log('ABORT'); process.exit(1); }

// 5) 轮询完成
let meta = null;
for (let i = 0; i < 90; i++) {
  await sleep(2000);
  const m = await api('GET', `/ai/agent/task/${taskId}/meta`);
  if (m.status === 200 && m.json) {
    meta = m.json;
    process.stdout.write(`[${i}] status=${meta.status} agent=${meta.agentStatus}\n`);
    if (['completed', 'failed', 'error', 'cancelled'].includes(meta.status)) break;
  }
}
assert('task_completed', !!meta && meta.status === 'completed', `status=${meta && meta.status} agent=${meta && meta.agentStatus}`);

// 6) assistant 回复含工具回显
const conversationId = meta && meta.conversationId;
let assistantText = '';
if (conversationId) {
  const conv = await api('GET', `/ai/conversations/${conversationId}/messages`);
  const msgs = (conv.json && (conv.json.messages || conv.json)) || [];
  if (Array.isArray(msgs)) {
    const lastA = [...msgs].reverse().find((m) => m.role === 'assistant');
    assistantText = String((lastA && (lastA.content || lastA.text)) || '');
  }
}
assert('assistant_echoes_tool_result', assistantText.includes(`echo: ${secret}`),
  `reply=${assistantText.slice(0, 200)}`);

// 7) transcript 证据：模型按投影名发出 toolCall（openai 系 API 未声明函数名的
//    调用会 400——按名调用成功即投影进 provider 请求的反证）+ 流式帧在场。
//    transcript.request 只落 messages（tools 不序列化），故取 response.toolCalls。
let toolCallByName = false;
let streamFrame = false;
try {
  const tDir = path.join(LOCAL_DATA_DIR, 'llm-transcripts');
  const files = fs.readdirSync(tDir)
    .map((f) => ({ f, mtime: fs.statSync(path.join(tDir, f)).mtimeMs }))
    .filter((x) => x.mtime >= Date.parse(startedAt) - 60_000)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 30);
  outer:
  for (const { f } of files) {
    for (const line of fs.readFileSync(path.join(tDir, f), 'utf8').split('\n')) {
      if (!line.includes('mcp_fixture_fixture_echo')) continue;
      let entry = null;
      try { entry = JSON.parse(line); } catch { continue; }
      const calls = entry && entry.response && Array.isArray(entry.response.toolCalls) ? entry.response.toolCalls : [];
      for (const c of calls) {
        if (c && c.function && c.function.name === 'mcp_fixture_fixture_echo') toolCallByName = true;
      }
      const frames = entry && Array.isArray(entry.frames) ? entry.frames : [];
      if (frames.some((fr) => JSON.stringify(fr).includes('mcp_fixture_fixture_echo'))) streamFrame = true;
      if (toolCallByName && streamFrame) break outer;
    }
  }
} catch (e) {
  console.log('[block156-p3-live] transcript read warn:', e.message);
}
assert('model_called_projected_tool_by_name',
  toolCallByName, 'response.toolCalls[].function.name === mcp_fixture_fixture_echo（按名调用成功=投影进请求）');
assert('tool_stream_frame_present', streamFrame, '流式帧含投影工具名');

// 8) 断开后再问 → unknown_tool（动态层生命周期）——经 meta 侧不重发任务，
//    直接调 dispatch 面代价高；此处用 HTTP 工具清单断言投影消失 + 会话工具面收窄留待单测。
await api('POST', `/mcp/servers/${SERVER_ID}/disconnect`);
const toolsAfter = await api('GET', `/mcp/servers/${SERVER_ID}/tools`);
assert('disconnect_clears_tool_surface',
  toolsAfter.status === 409, `status=${toolsAfter.status}（未连接=工具面 409）`);

// 9) 清理：移除 server（项目与任务留档可删）
await api('DELETE', `/mcp/servers/${SERVER_ID}`);
const after = await api('GET', '/mcp/servers');
const leftovers = ((after.json && after.json.servers) || []).filter((x) => x.id === SERVER_ID);
assert('cleanup_server_removed', leftovers.length === 0, JSON.stringify(leftovers.map((x) => x.id)));

const allPass = ASSERTIONS.length > 0 && ASSERTIONS.every((a) => a.pass);
fs.mkdirSync(EVDIR, { recursive: true });
fs.writeFileSync(
  path.join(EVDIR, 'mcp-agent-loop-live.json'),
  JSON.stringify({ name: 'block156-mcp-agent-loop-live', startedAt, finishedAt: new Date().toISOString(), secret, assertions: ASSERTIONS, allPass }, null, 2) + '\n',
);
console.log(`run: ${ASSERTIONS.filter((a) => a.pass).length}/${ASSERTIONS.length} assertions, allPass=${allPass}`);
process.exit(allPass ? 0 : 1);
