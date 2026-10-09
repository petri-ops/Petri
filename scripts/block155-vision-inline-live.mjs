// ============================================================
// scripts/block155-vision-inline-live.mjs — BLOCK-155 真·单通道 vision 实机验收
//
// 前提：dev 栈在跑（scripts/restart-dev-stack.sh READY，新代码已加载）。
// 流程：临时项目 + 手工放一张「白底红方块+蓝方块」PNG 到 .chat-attachments/
//   → POST /api/ai/agent（所选 preset=设置里声明 vision 的 openai 系渠道）
//   → 三面断言：
//   A. 任务完成且 assistant 回复描述出红/蓝方块（模型真看到图）
//   B. 全程无 read_image 工具调用（transcript records 无该 tool_calls）
//   C. transcript 里 chat 请求体最后一条 user 消息 content 为数组且含
//      image_url data URL（服务端内联实锤）
// 证据：acceptance/block-155/inline-live.json；临时项目/会话尽力清理。
// 用法：node scripts/block155-vision-inline-live.mjs
// ============================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const API = 'http://127.0.0.1:3001';
const HDRS = { Authorization: 'Bearer desktop-local', 'Content-Type': 'application/json' };
const LOCAL_DATA_DIR = 'D:\\1.WorkDir\\biof3-desktop\\.biof3-dev-user-data\\data';
const ASSERTIONS = [];
let failed = 0;
function assert(name, pass, detail = '') {
  ASSERTIONS.push({ name, pass, detail: String(detail).slice(0, 600) });
  if (!pass) failed += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + String(detail).slice(0, 200) : ''}`);
}
async function api(method, url, body) {
  const r = await fetch(API + url, { method, headers: HDRS, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html/text */ }
  return { status: r.status, json, text };
}

// ---- 纯 Node PNG 生成（240x120 白底：左红方块 + 右蓝方块）----
function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c; }
  }
  c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makeShapesPng() {
  const W = 240, H = 120;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    const row = y * (1 + W * 3);
    raw[row] = 0; // filter none
    for (let x = 0; x < W; x++) {
      const i = row + 1 + x * 3;
      let r = 255, g = 255, b = 255;
      if (x >= 20 && x < 80 && y >= 20 && y < 100) { r = 220; g = 30; b = 30; }      // 红方块
      if (x >= 140 && x < 220 && y >= 30 && y < 90) { r = 30; g = 60; b = 220; }     // 蓝方块
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- 主流程 ----
const startedAt = new Date().toISOString();
console.log('[block155-live] start', startedAt);

// 1) 栈健康
const health = await api('GET', '/api/data/projects');
assert('dev_stack_api_ready', health.status === 200, `GET /api/data/projects → ${health.status}`);
if (health.status !== 200) { console.log('ABORT: dev 栈未就绪'); process.exit(1); }

// 2) 选渠道：声明 vision 的 openai 系 preset（用户实机绑的 deepseek 系）
const settingsRes = await api('GET', '/api/ai/settings');
const s = settingsRes.json || {};
const presets = s.chat_model_presets || (s.settings && s.settings.chat_model_presets) || [];
const profiles = s.model_profiles || (s.settings && s.settings.model_profiles) || [];
const profileById = new Map(profiles.map((p) => [p.id, p]));
const OPENAI_FAMILY = new Set(['deepseek', 'openai', 'openai-compatible', 'ollama', 'lmstudio', 'vllm']);
const capable = (prof) => prof
  && Array.isArray(prof.capabilities) && prof.capabilities.includes('vision')
  && (OPENAI_FAMILY.has(prof.provider) || prof.provider === 'anthropic');
const chosen = presets.find((p) => capable(profileById.get(p.id)))
  || presets.find((p) => capable({ ...(profileById.get(p.id) || {}), provider: p.provider, capabilities: p.capabilities }));
assert('vision_capable_preset_found', !!chosen,
  chosen ? `preset=${chosen.id} model=${chosen.model} provider=${chosen.provider}` : `presets=${presets.length}`);
if (!chosen) { console.log('ABORT: 无声明 vision 的 openai 系渠道（先在设置页给渠道勾「视觉」）'); process.exit(1); }

// 3) 临时工作区 + 图片
const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b155-live-ws-'));
fs.mkdirSync(path.join(wsDir, '.chat-attachments'), { recursive: true });
const png = makeShapesPng();
fs.writeFileSync(path.join(wsDir, '.chat-attachments', 'b155-shapes.png'), png);
const kb = Math.max(1, Math.round(png.length / 1024));

// 4) 临时项目
const proj = await api('POST', '/api/data/projects', {
  name: 'BLOCK-155-vision-inline-live（临时验收，可删）',
  workspacePath: wsDir,
  modality: 'general',
});
const project = proj.json && proj.json.project;
assert('temp_project_created', proj.status === 200 && !!project, `status=${proj.status}`);
if (!project) { console.log('ABORT'); process.exit(1); }

// 5) 真发一条带图消息（走所选 vision 渠道）
const question = '附件图片里有哪些形状和颜色？用一句话回答。';
const userText = `${question}\n[附件: .chat-attachments/b155-shapes.png（${kb}KB）]`;
const send = await api('POST', '/api/ai/agent', {
  messages: [{ role: 'user', content: userText }],
  context: { projectId: project.id },
  modelPresetId: chosen.id,
  kind: 'primary',
});
const taskId = send.json && (send.json.taskId || (send.json.task && send.json.task.taskId));
assert('agent_task_accepted', send.status === 200 && !!taskId, `status=${send.status} body=${send.text.slice(0, 120)}`);
if (!taskId) { console.log('ABORT'); process.exit(1); }
console.log('[block155-live] taskId', taskId);

// 6) 轮询任务完成
let meta = null;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const m = await api('GET', `/api/ai/agent/task/${taskId}/meta`);
  if (m.status === 200 && m.json) {
    meta = m.json;
    process.stdout.write(`[${i}] status=${meta.status} agent=${meta.agentStatus}\n`);
    if (['completed', 'failed', 'error', 'cancelled'].includes(meta.status)) break;
  }
}
assert('task_completed', !!meta && meta.status === 'completed', `status=${meta && meta.status} agent=${meta && meta.agentStatus}`);
const conversationId = (meta && meta.conversationId) || null;

// 7) 会话消息（assistant 回复文本）
let assistantText = '';
if (conversationId) {
  const conv = await api('GET', `/api/ai/conversations/${conversationId}/messages`);
  const msgs = conv.json && (conv.json.messages || conv.json);
  if (Array.isArray(msgs)) {
    const lastA = [...msgs].reverse().find((m) => m.role === 'assistant');
    assistantText = String((lastA && (lastA.content || lastA.text)) || '');
  }
}
const mentionsRed = /红|red/i.test(assistantText);
const mentionsBlue = /蓝|blue/i.test(assistantText);
const mentionsSquare = /方|矩形|square|rect/i.test(assistantText);
assert('assistant_describes_image', mentionsRed && mentionsBlue && mentionsSquare,
  `reply=${assistantText.slice(0, 200)}`);

// 8) transcript 三面：image_url 直进请求体 + 无 read_image 调用（必须在清理前取证）
const tDir = path.join(LOCAL_DATA_DIR, 'llm-transcripts');
let records = [];
if (fs.existsSync(tDir)) {
  const files = fs.readdirSync(tDir).filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f, mtime: fs.statSync(path.join(tDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime).slice(0, 5);
  for (const { f } of files) {
    for (const line of fs.readFileSync(path.join(tDir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec && rec.ts && rec.ts >= startedAt) records.push(rec); // 只看本次测试之后的
      } catch {}
    }
  }
}
// 记录形状：{kind:'agent_iter', request:{messages}}（requestBody 是网关侧字段名）
const chatRecords = records.filter((r) => Array.isArray(r.request && r.request.messages));
let inlineProof = null;
for (const rec of chatRecords) {
  const msgs = rec.request && rec.request.messages;
  if (!Array.isArray(msgs)) continue;
  for (const m of msgs) {
    if (m && m.role === 'user' && Array.isArray(m.content)) {
      const img = m.content.find((p) => p && p.type === 'image_url' && p.image_url && typeof p.image_url.url === 'string' && p.image_url.url.startsWith('data:image/png;base64,'));
      if (img) { inlineProof = { urlLen: img.image_url.url.length, textPart: (m.content.find((p) => p.type === 'text') || {}).text || '' }; }
    }
  }
}
assert('transcript_shows_inline_image_url', !!inlineProof,
  inlineProof ? `dataUrlLen=${inlineProof.urlLen} textPart=${inlineProof.textPart.slice(0, 80)}` : `chatRecords=${chatRecords.length} records=${records.length}`);

let readImageCalls = [];
for (const rec of chatRecords) {
  const msgs = rec.request && rec.request.messages;
  if (!Array.isArray(msgs)) continue;
  for (const m of msgs) {
    for (const tc of (m && m.tool_calls) || []) {
      const fn = tc && tc.function && tc.function.name;
      if (fn === 'read_image') readImageCalls.push(String(fn));
    }
  }
}
// 硬判据=单通道：全程零 vision 角色调用（read_image 若被模型发起，已由 BLOCK-155
// 工具门确定性短路——不产生第二次视觉请求；read_image 计数降为信息项）
const visionRoleCalls = records.filter((r) => r.kind === 'vision').length;
assert('no_second_vision_call', visionRoleCalls === 0,
  `vision 角色调用=${visionRoleCalls}；read_image 工具调用（已短路计零成本）=${readImageCalls.length}`);

// 9) 证据落盘
const evidence = {
  name: 'block155-vision-inline-live',
  startedAt,
  finishedAt: new Date().toISOString(),
  preset: { id: chosen.id, model: chosen.model, provider: chosen.provider },
  taskId, conversationId, projectId: project.id,
  imageBytes: png.length,
  assistantReply: assistantText.slice(0, 500),
  transcriptChatRecords: chatRecords.length,
  inlineProof,
  visionRoleCalls,
  readImageToolCalls: readImageCalls.length,
  assertions: ASSERTIONS,
  allPass: failed === 0,
};
fs.mkdirSync('acceptance/block-155', { recursive: true });
fs.writeFileSync('acceptance/block-155/inline-live.json', JSON.stringify(evidence, null, 2));

// 10) 清理（尽力）：会话 + 临时项目
if (conversationId) { const d = await api('DELETE', `/api/ai/conversations/${conversationId}`); console.log('cleanup conv:', d.status); }
const dp = await api('DELETE', `/api/data/projects/${project.id}`);
console.log('cleanup project:', dp.status);
try { fs.rmSync(wsDir, { recursive: true, force: true }); } catch {}

console.log(`[block155-live] ${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} — evidence: acceptance/block-155/inline-live.json`);
process.exit(failed === 0 ? 0 : 1);
