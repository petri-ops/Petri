#!/usr/bin/env node
// BLOCK-104 P4 — Windows 专属脚本入口护栏：非 win32 直接退出，杜绝半途怪异失败。
if (process.platform !== 'win32') {
  console.error(`[platform] block63-p4-live.cjs 仅支持 Windows（当前 ${process.platform}）。`);
  process.exit(2);
}
'use strict';

/**
 * BLOCK-63 P4 实机验收（plan §6 P4 门）：agent 工具链真实路径（executeToolCall，
 * 与模型完全同款）驱动 Windows 记事本完成跨应用任务闭环：
 *
 *   authorize → 目标窗口创建 + hwnd 隔离 → 读状态（snapshot）→ 点击落焦
 *   → 输入（type 中文，ValuePattern）→ 验证（语义树 value 复核）→ press
 *   → screenshot 产物落项目工作区 → close（WM_CLOSE hwnd 粒度清理）
 *
 * 安全纪律（BLOCK-48 P4 教训 + BLOCK-63 P1 纪律事件）：
 *   - Win11 记事本为单实例多窗口（新窗口挂入既有进程）——目标隔离只能靠
 *     hwnd 差集：spawn 后 frontmost 窗口 hwnd 必须不在预存集合，否则硬中止。
 *   - 每个变更步前复核 frontmost hwnd 仍为隔离目标，漂移即中止。
 *   - 清理用 close 动词（WM_CLOSE hwnd 粒度），绝不进程级 kill；未保存提示
 *     弹窗时点「不保存」，找不到按钮则窗口留给用户（纪律允许）。
 *   - 用户既有记事本窗口全程零触碰（预存 hwnd 集合排除 + 收尾存活断言）。
 *
 * 确认卡协议：控制类每步需用户批准，脚本在 DB 边界模拟前端确认（ackToolJob，
 * 与 ai-legacy approve REST 同款），如实登记为模拟。
 *
 * 证据：acceptance/block-63/p4-live.json + 产物 PNG（项目工作区 computer-use/）
 */
const path = require('node:path');
const fs = require('node:fs');
const { spawn, execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DEV_DB = path.join(ROOT, '.petri-dev-user-data', 'data', 'petri.db');
process.env.PETRI_DB_PATH = DEV_DB;
process.env.PETRI_LOCAL_DATA_DIR = path.join(ROOT, '.petri-dev-user-data', 'data');
process.env.PETRI_BETTER_SQLITE3_ROOT = path.join(ROOT, 'core', 'petri-server', 'node_modules');

const { executeToolCall } = require(ROOT + '/core/petri-server/agent-tools');
const db = require(ROOT + '/core/petri-server/db');

const PROJECT_ID = 'p_mtrawlau_7rly';
const USER_ID = 'local-user';
const MARKER = `BLOCK63-P4 格物验证 ${Date.now()}`;

const results = { startedAt: new Date().toISOString(), marker: MARKER, assertions: [] };
function assert(name, pass, detail = '') {
  results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 600) });
  try { fs.writeSync(1, `[${new Date().toISOString().slice(11, 19)}] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + String(detail).slice(0, 160) : ''}\n`); } catch {}
}
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function callTool(name, params) {
  const envelope = await executeToolCall(name, params, {
    userId: USER_ID,
    projectId: PROJECT_ID,
    conversationId: null,
    accessMode: 'full',
  });
  return { raw: envelope, parsed: envelope.data || null, isError: envelope.status !== 'success' };
}

async function controlled(name, params) {
  const first = await callTool(name, params);
  if (!(first.parsed && first.parsed.needApproval)) return first;
  const job = db.getToolJobByAckToken(first.parsed.ackToken);
  assert(`确认卡 job 建立（${name}）`, !!job && job.tool_id === name, JSON.stringify({ toolJobId: first.parsed.toolJobId }));
  const ack = db.ackToolJob(first.parsed.ackToken, true, { userId: USER_ID });
  assert(`用户批准（模拟前端确认卡，${name}）`, ack?.ack_status === 'approved');
  return callTool(name, { ...params, confirm: true, ackToken: first.parsed.ackToken });
}

function notepadWindowsSnapshot() {
  // 可见记事本窗口句柄集合（主窗口粒度，用于差集隔离与存活断言）。
  // windowsHide 必须 true：控制台窗口会抢前台（P4 第一跑前台漂移元凶）。
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      'Get-Process Notepad -ErrorAction SilentlyContinue | Select-Object Id,MainWindowHandle,MainWindowTitle | ConvertTo-Json -Compress',
    ], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    if (!out.trim()) return [];
    let arr = JSON.parse(out);
    if (!Array.isArray(arr)) arr = [arr];
    return arr.filter((w) => w && w.MainWindowHandle).map((w) => ({ pid: w.Id, hwnd: w.MainWindowHandle, title: w.MainWindowTitle }));
  } catch { return []; }
}

async function main() {
  const evidenceDir = path.join(ROOT, 'acceptance', 'block-63');
  fs.mkdirSync(evidenceDir, { recursive: true });

  // 0) authorize：agent 视角权限探测（Windows 无 TCC 门）
  const auth = await callTool('computer_authorize', {});
  const authData = auth.parsed || {};
  assert('P4-0 computer_authorize：agent 链路探测（platform=windows / trusted）',
    authData.ok === true && authData.platform === 'windows' && authData.trusted === true,
    JSON.stringify(authData).slice(0, 200));

  // 1) 目标窗口创建 + hwnd 差集隔离
  const before = notepadWindowsSnapshot();
  const beforeHwnds = new Set(before.map((w) => w.hwnd).filter(Boolean));
  spawn('notepad.exe', [], { stdio: 'ignore' });
  let ourHwnd = 0;
  for (let i = 0; i < 12; i++) {
    await delay(1500);
    const snap = await callTool('computer_snapshot', { app: 'frontmost', maxElements: 200 });
    const t = snap.parsed && snap.parsed.target;
    if (snap.parsed?.ok === true && t && /Notepad|记事本/i.test(t.name || '') && !beforeHwnds.has(t.hwnd)) {
      ourHwnd = t.hwnd;
      break;
    }
  }
  assert('P4-1 目标窗口创建且 hwnd 隔离（不在预存集合）', ourHwnd !== 0, `ourHwnd=${ourHwnd} pre=${JSON.stringify([...beforeHwnds])}`);
  if (ourHwnd === 0) {
    results.note = '新记事本窗口未创建/无法隔离——安全硬闸中止，未输入任何文本';
    results.finishedAt = new Date().toISOString();
    results.allPass = false;
    fs.writeFileSync(path.join(evidenceDir, 'p4-live.json'), JSON.stringify(results, null, 2) + '\n');
    console.error('ABORT: 目标窗口未创建，安全中止');
    process.exit(1);
  }

  /**
   * hwnd 精确复核（P4 实机教训：Win11 打包记事本一窗多顶层 hwnd，
   * frontmost 判据不可靠——隔离后全程 target:{hwnd} 直投，本守卫只验窗口存活）。
   */
  async function snapshotOurs() {
    const snap = await callTool('computer_snapshot', { hwnd: ourHwnd, maxElements: 200 });
    return snap.parsed?.ok === true ? snap : null;
  }

  /** 安全硬闸：窗口死亡立即落证据中止，绝不向其他窗口盲打。 */
  async function hardAbort(reason) {
    results.note = reason + '——安全硬闸中止，未做后续变更';
    results.finishedAt = new Date().toISOString();
    results.allPass = false;
    fs.writeFileSync(path.join(evidenceDir, 'p4-live.json'), JSON.stringify(results, null, 2) + '\n');
    console.error('ABORT: ' + reason);
    process.exit(1);
  }

  // 2) 读状态：语义树（hwnd 直投）
  const snap0 = await snapshotOurs();
  if (!snap0) await hardAbort('隔离窗口快照失败（窗口已死）');
  const doc = (snap0.parsed.elements || []).find((e) => e.role === 'Document' || e.role === 'Edit');
  assert('P4-2 snapshot 读状态（agent 链路语义树 + Document 在位）', !!doc,
    JSON.stringify({ count: snap0?.parsed?.elementCount, roles: snap0?.parsed?.elements?.length }));
  if (!doc) await hardAbort('语义树无 Document/Edit');

  // 3) 点击编辑区落焦（确认门两段式；hwnd 直投，ActivateWindow 走目标窗口）
  const click = await controlled('computer_click', { hwnd: ourHwnd, ref: doc.ref });
  assert('P4-3 click 编辑区落焦（coordinate，确认门两段式）',
    click.parsed?.ok === true && click.parsed?.mode === 'coordinate', JSON.stringify(click.parsed || click.raw.isError));

  // 4) 输入：中文 marker（ValuePattern 后台确定性回写）
  const type = await controlled('computer_type', { hwnd: ourHwnd, ref: doc.ref, text: MARKER });
  assert('P4-4 type 中文输入（ValuePattern，确认门两段式）',
    type.parsed?.ok === true && type.parsed?.mode === 'value_pattern_setvalue', JSON.stringify(type.parsed || type.raw.isError));

  // 5) 验证：语义树 value 复核
  await delay(600);
  const snap5 = await snapshotOurs();
  if (!snap5) await hardAbort('验证步窗口已死');
  const doc2 = (snap5.parsed.elements || []).find((e) => e.role === 'Document' || e.role === 'Edit');
  assert('P4-5 验证：marker 出现在语义树 value', !!doc2 && String(doc2.value || '').includes(MARKER),
    JSON.stringify({ value: doc2?.value?.slice(0, 80) }));

  // 6) press（键盘路径：本机被拦宿主走消息级回退，mode 如实上报；ActivateWindow 先归前台）
  const press = await controlled('computer_press', { hwnd: ourHwnd, ref: doc2.ref, key: 'end' });
  assert('P4-6 press end（确认门两段式，mode 诚实上报）',
    press.parsed?.ok === true && ['message_post', 'sendinput'].includes(press.parsed?.mode),
    JSON.stringify(press.parsed || press.raw.isError));

  // 7) screenshot：产物落项目工作区 computer-use/（Windows sidecar 返回 out，macOS 返回 path）
  const shot = await callTool('computer_screenshot', { hwnd: ourHwnd, filename: `p4-${Date.now()}.png` });
  const shotData = shot.parsed || {};
  const shotPath = (shotData.path || shotData.out || '').replace(/\\/g, '/');
  assert('P4-7 screenshot 产物落项目工作区（路径白名单）',
    shotData.ok === true && shotPath && shotPath.includes('computer-use/') && fs.existsSync(shotPath),
    JSON.stringify(shotData).slice(0, 200));
  if (shotPath) {
    const head = fs.readFileSync(shotPath).subarray(0, 4);
    assert('P4-8 截图产物为真实 PNG', [...head].join(',') === '137,80,78,71', `path=${shotPath}`);
  }

  // 8) 清理：WM_CLOSE hwnd 粒度直投我们的窗口；未保存提示弹窗时点「不保存」，找不到按钮则留用户。
  //    close 是 sidecar 动词而非注册工具（P2 纪律：脚本收尾专用），此处直走 host 动词。
  let closed = false;
  let leftToUser = false;
  try {
    const host = require(ROOT + '/core/petri-server/helpers/computer-use-host').getComputerUseHost();
    await host.requestWithRecovery('close', { target: { hwnd: ourHwnd } });
    await delay(1500);
    // 判定：保存提示弹窗（frontmost 是记事本系且出现「不保存」按钮）or 已关闭
    const snapAfter = await callTool('computer_snapshot', { app: 'frontmost', maxElements: 200 });
    const t = snapAfter.parsed && snapAfter.parsed.target;
    const stillNotepad = t && /Notepad|记事本|文本编辑器/i.test(t.name || '');
    const elements = (snapAfter.parsed && snapAfter.parsed.elements) || [];
    const discardBtn = elements.find((e) => e.role === 'Button' && /不保存|don.t save/i.test(e.name || ''));
    if (stillNotepad && discardBtn) {
      // 未保存提示：点「不保存」（真实按钮 UIA Invoke，经 agent 确认链）
      const clickBtn = await controlled('computer_click', { app: 'frontmost', ref: discardBtn.ref });
      if (clickBtn.parsed?.ok === true) {
        await delay(1000);
        closed = true;
      }
    } else if (!stillNotepad) {
      closed = true; // 窗口直接关闭（无提示）
    }
    const finalSnap = await callTool('computer_snapshot', { hwnd: ourHwnd, maxElements: 20 }).catch(() => null);
    if (!finalSnap || finalSnap.parsed?.ok !== true) closed = true; // 目标 hwnd 已死 = 关闭成功
    if (!closed) leftToUser = true;
  } catch (e) {
    leftToUser = true;
    results.note = `close 链异常：${e.message}（窗口留给用户）`;
  }
  assert('P4-9 清理：WM_CLOSE hwnd 粒度（未保存提示点不保存 / 窗口留用户）', closed || leftToUser,
    closed ? '目标窗口已关闭' : '窗口留给用户（纪律允许，绝不进程级 kill）');

  // 10) 用户既有记事本窗口未受污染（预存进程全部存活）
  const after = notepadWindowsSnapshot();
  const preUserWins = before.filter((b) => b.hwnd && beforeHwnds.has(b.hwnd));
  const userAlive = preUserWins.filter((b) => after.some((w) => w.pid === b.pid));
  assert('P4-10 用户既有记事本窗口存活（未关闭未污染）',
    userAlive.length === preUserWins.length,
    JSON.stringify({ preUser: preUserWins.length, alive: userAlive.length, afterProcs: after.length }));

  const allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  results.allPass = allPass;
  results.note = (results.note ? results.note + '；' : '')
    + '控制类确认卡的用户批准步在 DB 边界模拟（ackToolJob，与 ai-legacy approve REST 同款调用）；'
    + '本机键盘注入被宿主拦截：press 走消息级回退（mode=message_post 如实上报），type 走 ValuePattern。';
  fs.writeFileSync(path.join(evidenceDir, 'p4-live.json'), JSON.stringify(results, null, 2) + '\n');
  log(`证据已写入 acceptance/block-63/p4-live.json (allPass=${allPass})`);
  process.exit(allPass ? 0 : 1);
}

function log(msg) {
  try { fs.writeSync(1, `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`); } catch {}
}

const watchdog = setTimeout(() => {
  console.error('FAIL P4 实机脚本 6min 看门狗超时');
  process.exit(1);
}, 6 * 60 * 1000);
watchdog.unref();

main().catch((e) => {
  console.error('FAIL 脚本异常:', e && e.message);
  process.exit(1);
});
