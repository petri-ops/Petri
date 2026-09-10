'use strict';

/**
 * BLOCK-77 P2 — 驻留任务回访循环 + 交接班摘要（R2/R3/R6）。
 *
 * 回访（仅软件运行期，默认 60s）：对全部项目 status==='running' 的意图卡做
 *   ① 进程存活（ssh: gateway processAlive / local: process.kill(pid,0)）
 *   ② 退出标记（.exit → 退出码）
 *   ③ 日志增长（连续 stall 判「疑似卡死」，只提醒不处置）
 * 四态收敛：completed / failed（进程死+.exit）/ exited（死但退出码未知）/ 疑似卡死提醒。
 * 不自动重启失败任务（R5：kill/重跑必须用户确认）。
 *
 * 交接班（R6 双通道）：
 *   A. 后端启动首个回访 tick → 每项目 running 卡 >0 → notify.custom 交接班提醒；
 *   B. agent 会话注入 → residentHandoverDigest(projectId) 供 agent-runner 拼 systemPrompt。
 */

const fs = require('fs');
const path = require('path');
const { resolveWorkspaceBackend, safeRemoteJoin } = require('../workspace-gateway');

const DEFAULT_INTERVAL_MS = 60 * 1000;
const DEAD_TICKS_TO_FAIL = 2;
const STALL_TICKS_TO_NOTIFY = 3;

function residentDirAbs(project) {
  const resolved = resolveWorkspaceBackend(project);
  if (resolved.error || !resolved.backend) return null;
  const root = resolved.root;
  const dir = safeRemoteJoin(root, '.gewu/resident');
  if (!dir) return null;
  return { backend: resolved.backend, root, dir, kind: resolved.backend.kind };
}

/** 列出项目全部意图卡（损坏单卡跳过）。 */
async function listCards(ws) {
  let entries = [];
  try {
    entries = await ws.backend.list(ws.dir);
  } catch {
    return [];
  }
  const cards = [];
  for (const entry of entries.filter((x) => x.type === 'file' && x.name.endsWith('.json'))) {
    try {
      const buf = await ws.backend.read(`${ws.dir}/${entry.name}`);
      cards.push(JSON.parse(buf.toString('utf8')));
    } catch { /* 单卡损坏跳过 */ }
  }
  return cards;
}

function localAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function localReadFile(abs) {
  try { return fs.readFileSync(abs); } catch { return null; }
}

/** 单卡回访：返回 {transition, note} — transition ∈ 'completed'|'failed'|null。 */
async function revisitCard(ws, project, card, state, notify) {
  if (!card.backingProcess || !Number.isFinite(card.backingProcess.pid)) {
    return { transition: null };
  }
  const pid = card.backingProcess.pid;
  const st = state.get(card.taskId) || { deadTicks: 0, stallTicks: 0, lastLogSize: null, notifiedStall: false };
  state.set(card.taskId, st);

  // ① 存活
  let alive;
  if (ws.kind === 'ssh') {
    try {
      alive = (await ws.backend.processAlive(pid)).alive === true;
    } catch {
      return { transition: null, unknown: true }; // 传输失败 ≠ 作业失败（跳过本轮）
    }
  } else {
    alive = localAlive(pid);
  }

  // ② 退出标记（start 时包装命令写入）
  let exitBuf = null;
  const exitPath = ws.kind === 'ssh'
    ? `${ws.dir}/${card.taskId}.exit`
    : path.join(ws.root, '.gewu', 'resident', `${card.taskId}.exit`);
  if (ws.kind === 'ssh') {
    try { exitBuf = await ws.backend.read(exitPath); } catch { exitBuf = null; }
  } else {
    exitBuf = localReadFile(exitPath);
  }

  if (!alive && !exitBuf) {
    st.deadTicks += 1;
    if (st.deadTicks >= DEAD_TICKS_TO_FAIL) {
      // 进程死且无退出标记（包装命令未跑完即亡/被外部 kill）——诚实记 failed
      await writeCardStatus(ws, project, card, 'failed', `进程 ${pid} 已退出且无退出标记`);
      notify.custom({
        title: `⚠️ 驻留任务异常结束：${card.intent.slice(0, 40)}`,
        template: 'orange',
        dedupeKey: `resident_failed_${card.taskId}`,
        lines: [`项目：${project.name}`, `taskId：${card.taskId}`, '进程已退出且无退出标记，详情请查看 .gewu/resident/ 意图卡与日志。'],
      });
      return { transition: 'failed' };
    }
    return { transition: null, retryLater: true };
  }

  // 有退出标记 → 终态
  if (exitBuf) {
    const code = parseInt(String(exitBuf).trim(), 10);
    const exitCode = Number.isFinite(code) ? code : null;
    if (exitCode === 0) {
      await writeCardStatus(ws, project, card, 'completed', `退出码 0`);
      notify.custom({
        title: `✅ 驻留任务完成：${card.intent.slice(0, 40)}`,
        template: 'blue',
        dedupeKey: `resident_done_${card.taskId}`,
        lines: [`项目：${project.name}`, `taskId：${card.taskId}`, '意图卡与产物已在项目 .gewu/resident/ 与输出目录。'],
      });
      return { transition: 'completed', exitCode: 0 };
    }
    await writeCardStatus(ws, project, card, 'failed', `退出码 ${exitCode}`);
    notify.custom({
      title: `❌ 驻留任务失败：${card.intent.slice(0, 40)}`,
      template: 'orange',
      dedupeKey: `resident_failed_${card.taskId}`,
      lines: [`项目：${project.name}`, `taskId：${card.taskId}`, `退出码 ${exitCode}（不自动重启；处置预案见意图卡 failure_handling）`],
    });
    return { transition: 'failed', exitCode };
  }

  // 存活但无退出标记 = 仍在运行 → ③ 日志增长检查（卡死提醒，只提醒不处置）
  let logSize = null;
  const logPath = ws.kind === 'ssh'
    ? `${ws.dir}/${card.taskId}.log`
    : path.join(ws.root, '.gewu', 'resident', `${card.taskId}.log`);
  if (ws.kind === 'ssh') {
    try { logSize = Number((await ws.backend.stat(logPath)).size || 0); } catch { logSize = null; }
  } else {
    try { logSize = fs.statSync(logPath).size; } catch { logSize = null; }
  }
  if (logSize !== null && st.lastLogSize !== null && logSize === st.lastLogSize) {
    st.stallTicks += 1;
    if (st.stallTicks >= STALL_TICKS_TO_NOTIFY && !st.notifiedStall) {
      st.notifiedStall = true;
      notify.custom({
        title: `🐌 驻留任务疑似卡死：${card.intent.slice(0, 40)}`,
        template: 'orange',
        dedupeKey: `resident_stall_${card.taskId}`,
        lines: [`项目：${project.name}`, `taskId：${card.taskId}`, `日志 ${STALL_TICKS_TO_NOTIFY} 轮无增长（回访只提醒，不自动处置）。`],
      });
    }
  } else {
    st.stallTicks = 0;
    st.notifiedStall = false;
  }
  st.lastLogSize = logSize;
  return { transition: null };
}

async function writeCardStatus(ws, project, card, status, note) {
  card.status = status;
  card.updatedAt = new Date().toISOString();
  card.lastCheckNote = String(note || '');
  const cardPath = ws.kind === 'ssh'
    ? `${ws.dir}/${card.taskId}.json`
    : path.join(ws.root, '.gewu', 'resident', `${card.taskId}.json`);
  try {
    if (ws.kind === 'ssh') {
      await ws.backend.write(cardPath, Buffer.from(JSON.stringify(card, null, 2), 'utf8'));
    } else {
      fs.writeFileSync(cardPath, JSON.stringify(card, null, 2), 'utf8');
    }
  } catch { /* 状态文件写失败不影响通知 */ }
}

/** 交接班摘要（双通道 B）：agent 会话注入用文本；无 running 卡返回 null。 */
async function residentHandoverDigest(project) {
  const ws = residentDirAbs(project);
  if (!ws) return null;
  const cards = await listCards(ws);
  const running = cards.filter((c) => c.status === 'running');
  if (!running.length) return null;
  const lines = running.map((c) => `- [${c.taskId}] ${String(c.intent || '').slice(0, 80)}（日志：${c.backingProcess ? c.backingProcess.logPath : '未知'}；可用 resident_task_read 读卡）`);
  return `本项目存在 ${running.length} 个驻留任务（跨会话挂机运行中）：\n${lines.join('\n')}\n可用 resident_task_list / resident_task_read 读取详情；完成后请主动向用户汇报核对结果。`;
}

/** 交接班摘要（双通道 A）：后端启动首个 tick 的应用内提醒（notify.custom）。 */
function startResidentRevisitLoop({ dbModule, notify, intervalMs } = {}) {
  const interval = Number(intervalMs) || Number(process.env.BIOF3_RESIDENT_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  let handoverNotified = false;
  let running = false;
  const stateByProject = new Map(); // projectId → Map(taskId → tick state)

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const db = dbModule.getAsyncDatabase();
      const projects = await db.prepare('SELECT id, name, workspace_kind, ssh_host, remote_path, workspace_path FROM projects').all();
      for (const project of projects) {
        const ws = residentDirAbs(project);
        if (!ws) continue;
        const cards = await listCards(ws);
        const runningCards = cards.filter((c) => c.status === 'running');
        if (!runningCards.length) continue;

        if (!handoverNotified) {
          notify.custom({
            title: `📋 交接班：${project.name} 有 ${runningCards.length} 个驻留任务进行中`,
            template: 'blue',
            dedupeKey: `resident_handover_${project.id}`,
            lines: runningCards.map((c) => `- ${String(c.intent || c.taskId).slice(0, 60)}`),
          });
        }

        const state = stateByProject.get(project.id) || new Map();
        stateByProject.set(project.id, state);
        for (const card of runningCards) {
          try {
            await revisitCard(ws, project, card, state, notify);
          } catch { /* 单卡异常不拖垮整轮 */ }
        }
      }
      handoverNotified = true;
    } catch { /* 整轮失败下轮重试 */ } finally {
      running = false;
    }
  };

  const timer = setInterval(() => { void tick(); }, interval);
  if (typeof timer.unref === 'function') timer.unref();
  void tick(); // 启动即首轮回访（含交接班提醒）
  return { stop: () => clearInterval(timer), tick };
}

/** 交接班摘要（按 projectId 查项目行后取 running 卡摘要，供 agent 会话注入）。 */
async function residentHandoverDigestByProjectId(dbModule, projectId) {
  try {
    const row = dbModule.getAsyncDatabase()
      .prepare('SELECT id, name, workspace_kind, ssh_host, remote_path, workspace_path FROM projects WHERE id = ?')
      .get(projectId);
    if (!row) return null;
    return await residentHandoverDigest(row);
  } catch {
    return null;
  }
}

module.exports = {
  startResidentRevisitLoop,
  residentHandoverDigest,
  residentHandoverDigestByProjectId,
  residentHandoverDigest,
  listCards,
  residentDirAbs,
  DEFAULT_INTERVAL_MS,
};
