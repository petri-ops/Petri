#!/usr/bin/env node
'use strict';

/**
 * BLOCK-48 P4 实机验收（plan §6 P4 门）：dev Electron 真实环境下，经 agent
 * 工具链（registry.callTool——与模型完全同款代码路径）完成跨应用任务闭环：
 *
 *   读状态（snapshot）→ 点击/按键（cmd+n 开新文档）→ 输入（type 中文）
 *   → 验证（snapshot 语义树 value 复核）→ screenshot 产物落项目工作区
 *
 * 目标 app：TextEdit。安全纪律：先 Cmd+N 开**新文档**再输入，绝不触碰用户
 * 已打开的文档（本机存在用户文档「未命名2」）；结束不自动退出 TextEdit。
 *
 * 确认卡协议：控制类每步需用户批准。脚本在 DB 边界模拟前端确认（与
 * ai-legacy approve REST 同款 ackToolJob 调用），如实登记为模拟。
 *
 * 证据：acceptance/block-48/p4-live.json + 产物 PNG（项目工作区 computer-use/）
 */
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const DEV_DB = path.join(ROOT, '.biof3-dev-user-data', 'data', 'biof3.db');
process.env.BIOF3_DB_PATH = DEV_DB;
process.env.BIOF3_LOCAL_DATA_DIR = path.join(ROOT, '.biof3-dev-user-data', 'data');
process.env.BIOF3_BETTER_SQLITE3_ROOT = path.join(ROOT, 'core', 'biof3-server', 'node_modules');

const { executeToolCall } = require(ROOT + '/core/biof3-server/agent-tools');
const db = require(ROOT + '/core/biof3-server/db');
const { execFileSync } = require('node:child_process');

const PROJECT_ID = 'p_mtlnsv0f_xpjb';
const USER_ID = 'local-user';
const TEXTEDIT = 'com.apple.TextEdit';
const MARKER = `BLOCK48-P4-${Date.now()}`;

const results = { startedAt: new Date().toISOString(), assertions: [], marker: MARKER };
function assert(name, pass, detail = '') {
  results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 600) });
  try { fs.writeSync(1, `[${new Date().toISOString().slice(11, 19)}] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + String(detail).slice(0, 160) : ''}\n`); } catch {}
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * 模型同款调用路径：agent-tools executeToolCall（interceptor → policy →
 * handler → 信封），与 agent loop 调工具完全一致。
 */
async function callTool(name, params) {
  const envelope = await executeToolCall(name, params, {
    userId: USER_ID,
    projectId: PROJECT_ID,
    conversationId: null,
    accessMode: 'full',
  });
  return { raw: envelope, parsed: envelope.data || null, isError: envelope.status !== 'success' };
}

/**
 * 控制类两段式：首调 → needApproval → DB 边界模拟前端批准 → confirm 重调。
 * （与 ai-legacy approve REST 同款 ackToolJob 调用——用户确认步的模拟点。）
 */
async function controlled(name, params) {
  const first = await callTool(name, params);
  if (!(first.parsed && first.parsed.needApproval)) return first;
  const job = db.getToolJobByAckToken(first.parsed.ackToken);
  assert(`确认卡 job 建立（${name}）`, !!job && job.tool_id === name, JSON.stringify({ toolJobId: first.parsed.toolJobId }));
  const ack = db.ackToolJob(first.parsed.ackToken, true, { userId: USER_ID });
  assert(`用户批准（模拟前端确认卡，${name}）`, ack?.ack_status === 'approved');
  return callTool(name, { ...params, confirm: true, ackToken: first.parsed.ackToken });
}

function snapshotTextEdit() {
  return callTool('computer_snapshot', { app: TEXTEDIT, maxElements: 400, axManual: true });
}

async function main() {
  const evidenceDir = path.join(ROOT, 'acceptance', 'block-48');
  fs.mkdirSync(evidenceDir, { recursive: true });

  // 0) authorize：agent 视角的权限探测（真实 dev 环境）
  const auth = await callTool('computer_authorize', {});
  const authData = auth.parsed || {};
  assert('P4-0 computer_authorize：agent 链路权限探测', authData.ok === true && authData.trusted === true,
    JSON.stringify(authData).slice(0, 200));

  // 1) TextEdit 运行保障
  const pgrep = (() => { try { return execFileSync('pgrep', ['-x', 'TextEdit'], { encoding: 'utf8' }).trim(); } catch { return ''; } })();
  if (!pgrep) {
    execFileSync('open', ['-a', 'TextEdit']);
    await delay(3000);
  }
  assert('P4-1 TextEdit 目标应用就绪', true, `pid=${pgrep || 'launched'}`);

  // 2) 读状态：语义树
  const snap1 = await snapshotTextEdit();
  assert('P4-2 snapshot 读状态（agent 链路语义树）', snap1.parsed?.ok === true && (snap1.parsed?.count || 0) > 2,
    JSON.stringify({ count: snap1.parsed?.count, error: snap1.parsed?.error || snap1.raw.isError }));

  // 3) 按键：Cmd+N 开新文档（用户批准模拟 → 执行）
  const windowsBefore = (snap1.parsed?.elements || []).filter((e) => e.role === 'AXWindow').length;
  const pressRes = await controlled('computer_press', { key: 'n', modifiers: ['cmd'], app: TEXTEDIT, activate: true });
  assert('P4-3 press Cmd+N（确认门两段式 + 执行）',
    pressRes.parsed?.ok === true && pressRes.parsed?.method === 'cgevent-key', JSON.stringify(pressRes.parsed || pressRes.raw.isError));
  await delay(2000);

  // 4) 读状态复核：新窗口出现
  const snap2 = await snapshotTextEdit();
  const windowsAfter = (snap2.parsed?.elements || []).filter((e) => e.role === 'AXWindow').length;
  assert('P4-4 状态变化：Cmd+N 后窗口数增加', windowsAfter > windowsBefore,
    JSON.stringify({ before: windowsBefore, after: windowsAfter }));
  // 安全硬闸：新窗口创建失败绝不继续输入（防止误写用户已有文档内容）
  if (windowsAfter <= windowsBefore) {
    results.note = 'Cmd+N 未产生新窗口——安全硬闸中止，未输入任何文本';
    results.finishedAt = new Date().toISOString();
    results.allPass = false;
    fs.writeFileSync(path.join(evidenceDir, 'p4-live.json'), JSON.stringify(results, null, 2) + '\n');
    console.error('ABORT: 新窗口未创建，安全中止（未输入）');
    process.exit(1);
  }

  // 5) 输入：Cmd+N 新文档默认获得焦点，直接键入（不做跨窗口点击，防误触用户文档）
  const typeRes = await controlled('computer_type', { text: MARKER + ' 跨应用验证', app: TEXTEDIT });
  assert('P4-5 type 中文跨应用输入（焦点=新文档）', typeRes.parsed?.ok === true && typeRes.parsed?.typed > 0,
    JSON.stringify(typeRes.parsed || typeRes.raw.isError));

  // 6) 验证：语义树 value 复核——marker 出现在某个文本区，且用户旧文档未被污染
  await delay(800);
  const snap3 = await snapshotTextEdit();
  const areas3 = (snap3.parsed?.elements || []).filter((e) => /textarea/i.test(e.role || ''));
  const hit = areas3.find((e) => String(e.value || '').includes(MARKER));
  assert('P4-6 验证：输入内容出现在 TextEdit 语义树（value 复核）', !!hit,
    JSON.stringify({ areas: areas3.length, hit: hit?.value?.slice(0, 80) }));
  const userDoc = areas3.find((e) => String(e.value || '').includes('AB') && e.ref !== hit?.ref);
  assert('P4-7 用户旧文档未被污染（不含 marker）', !userDoc || !String(userDoc.value).includes(MARKER),
    JSON.stringify(userDoc?.value?.slice(0, 60)));

  // 7) screenshot：产物落项目工作区 computer-use/
  const shot = await callTool('computer_screenshot', { app: TEXTEDIT, filename: `p4-${Date.now()}.png` });
  const shotData = shot.parsed || {};
  if (shotData.ok === false && shotData.error === 'not_trusted_screen') {
    assert('P4-8 screenshot：屏幕录制未授权 → 诚实引导（双态兼容）',
      shotData.message.includes('屏幕录制'), JSON.stringify(shotData));
  } else {
    assert('P4-8 screenshot 产物落项目工作区（路径白名单）',
      shotData.ok === true && shotData.path && shotData.path.includes('computer-use/') && fs.existsSync(shotData.path),
      JSON.stringify(shotData).slice(0, 200));
    if (shotData.path) {
      const head = fs.readFileSync(shotData.path).subarray(0, 4);
      assert('P4-9 截图产物为真实 PNG', [...head].join(',') === '137,80,78,71', `path=${shotData.path}`);
    }
  }

  const allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  results.allPass = allPass;
  results.note = '控制类确认卡的用户批准步在 DB 边界模拟（ackToolJob，与 ai-legacy approve REST 同款调用）；TextEdit 不自动退出（用户文档保护）。';
  fs.writeFileSync(path.join(evidenceDir, 'p4-live.json'), JSON.stringify(results, null, 2) + '\n');
  log(`证据已写入 acceptance/block-48/p4-live.json (allPass=${allPass})`);
  process.exit(allPass ? 0 : 1);
}

function log(msg) {
  try { fs.writeSync(1, `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`); } catch {}
}
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

const watchdog = setTimeout(() => {
  console.error('FAIL P4 实机脚本 6min 看门狗超时');
  process.exit(1);
}, 6 * 60 * 1000);
watchdog.unref();

main().catch((e) => {
  console.error('FAIL 脚本异常:', e && e.message);
  process.exit(1);
});
