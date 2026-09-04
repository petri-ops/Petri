#!/usr/bin/env node
'use strict';

/**
 * BLOCK-55 P1/P2/P3 用户侧实机 CDP 断言驱动：工程计划模式 Spec 门（dev Electron + 真实模型）。
 *   场景 A（P1 Spec 门 + P2 分派顺带覆盖）：
 *     1) UI 点击「计划模式」开关（aria-pressed=true）
 *     2) 真实模型只读探索 + plan(create, draft=true, specMd, steps[assignee]) 起草 → draft 落库
 *     3) run 结束后前端拉取 draft → 批准卡渲染 → 截图
 *     4) 点击「批准并清上下文执行」→ plan 转 approved + freshTurn 消息数组仅含 spec 自包含首条
 *     5) 执行期：assignee 步骤经 spawn_agent 派子 agent + update_step 回写 + 最终汇总回复
 *   场景 B（P3 Replan，直构数据 + UI 批准）：
 *     6) SQLite 直构 active plan（done/pending 混合）+ proposed 修订案 → 重新导航触发重拉
 *     7) 修订批准条渲染 → 点击「批准修订」→ 步骤表替换 + revision applied
 * 前置：dev Electron 已在跑（wrapper 自带 --remote-debugging-port=9222）。
 * 证据：acceptance/block-55/ui-live.json + p55-0*.png
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const http = require('node:http');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');

const DEBUG_PORT = process.env.BIOF3_DEBUG_PORT || '9222';
// 前端 rApiBase 指向 Electron 主进程 spawn 的 biof3-server（随机端口），
// 其 BIOF3_DB_PATH 由 env-coordinator 指向 BIOF3_LOCAL_DATA_DIR（dev = .biof3-dev-user-data/data）。
const PROJECT_ID = process.env.BIOF55_PROJECT || 'p_mtlnsv0f_xpjb';
const DB_PATH = process.env.BIOF55_DB
  || path.join(__dirname, '..', '.biof3-dev-user-data', 'data', 'biof3.db');
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-55');
const WAIT_MS = 8 * 60 * 1000;
const POLL_MS = 4000;

const PROMPT = [
  '请为以下任务起草一份完整计划（只起草，不要执行）：',
  '「给出 BRCA1、TP53 两个基因各一句话功能说明，并把字符串 biof3 反转」。要求 3 个步骤：',
  '步骤 1：给出 BRCA1、TP53 各一句话功能说明（该步骤标记 assignee 为 subagent，适合派子智能体独立完成）；',
  '步骤 2：把字符串 biof3 反转；',
  '步骤 3：把步骤 1 和步骤 2 的结果合并成一段汇报。',
  '计划正文 specMd 必须自包含（含目标、边界、每步验收标准）。起草完成后提交计划等待批准，不要执行任何步骤。',
].join('\n');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function evalJS(client, expr) {
  // CdpClient.send 无内置超时：renderer 忙时 promise 永挂（上次卡点）。
  // 竞速 30s 超时，由 evalJSRetry 统一重试。
  const r = await Promise.race([
    client.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('cdp_eval_timeout_30s')), 30000)),
  ]);
  if (r.exceptionDetails) {
    throw new Error(`evaluate_failed: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description || ''}`.slice(0, 500));
  }
  return r.result.value;
}

// dev 模式偶发执行上下文销毁（HMR / renderer 重启抛 -32000）：带重试的 evalJS
async function evalJSRetry(client, expr, { tries = 6, delayMs = 2500 } = {}) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      return await evalJS(client, expr);
    } catch (e) {
      lastErr = e;
      if (!/-32000|context|cdp_command_failed/i.test(e.message)) throw e;
      await delay(delayMs);
    }
  }
  throw lastErr;
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

// 同步 stdout（绕开 pipe 缓冲，长跑脚本进度立即可见）
function log(msg) {
  try { fs.writeSync(1, `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`); } catch {}
}

async function screenshot(client, file) {
  try {
    await client.send('Page.bringToFront', {});
    const r = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  } catch (e) {
    log(`WARN screenshot skipped (${path.basename(file)}): ${e.message}`);
  }
}

function sqliteRows(sql) {
  const out = execFileSync('sqlite3', [DB_PATH, '-json', sql], { encoding: 'utf8' });
  return out.trim() ? JSON.parse(out) : [];
}

function planRows(baselineIso) {
  return sqliteRows(
    `SELECT id, user_id, conversation_id, title, status, spec_md, created_at
     FROM copilot_plans WHERE created_at > '${baselineIso}' ORDER BY created_at`
  );
}

function planSteps(planId) {
  return sqliteRows(
    `SELECT n, title, assignee, status, result FROM copilot_plan_steps
     WHERE plan_id='${planId}' ORDER BY n`
  );
}

function spawnedChildren(baselineIso) {
  return sqliteRows(
    `SELECT id, status, agent_status, created_at, finished_at, params
     FROM tasks WHERE type='agent_loop'
       AND params LIKE '%"spawnSource":"tool:spawn_agent"%'
       AND created_at > '${baselineIso}'
     ORDER BY created_at`
  ).map((row) => {
    let params = {};
    try { params = JSON.parse(row.params || '{}'); } catch {}
    return {
      agentId: row.id,
      status: row.status,
      agentStatus: row.agent_status,
      kind: params.kind,
      parentTaskId: params.parentTaskId,
      task: String(params.messages && params.messages[0] && params.messages[0].content || '').slice(0, 80),
    };
  });
}

function taskMessages(taskId) {
  const rows = sqliteRows(
    `SELECT params FROM tasks WHERE id='${taskId}'`
  );
  if (!rows[0]) return null;
  try {
    const p = JSON.parse(rows[0].params || '{}');
    return Array.isArray(p.messages) ? p.messages : null;
  } catch { return null; }
}

function finalAssistant(taskId) {
  const rows = sqliteRows(
    `SELECT content, ts FROM copilot_messages
     WHERE task_id='${taskId}' AND role='assistant'
     ORDER BY ts DESC, id DESC LIMIT 1`
  );
  return rows[0] || null;
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const page = targets.find((t) => t.type === 'page' && /localhost:3000/.test(t.url || ''));
  if (!page) throw new Error('biof3_page_not_found');
  const client = await new CdpClient(page.webSocketDebuggerUrl).connect();

  const results = {
    startedAt: new Date().toISOString(),
    page: page.url,
    projectId: PROJECT_ID,
    dbPath: DB_PATH,
    assertions: [],
  };
  const assert = (name, pass, detail) => {
    results.assertions.push({ name, pass: !!pass, detail: String(detail || '').slice(0, 400) });
    log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + String(detail).slice(0, 200) : ''}`);
  };

  const baselineIso = results.startedAt;
  const deadline = Date.now() + WAIT_MS;
  const SKIP_A = process.env.BIOF55_SKIP_A === '1';

  // ===== 场景 A：P1 Spec 门 =====
  // 1. 导航到项目 chat 模式
  const targetUrl = `http://localhost:3000/project/${PROJECT_ID}?mode=chat`;
  await client.send('Page.navigate', { url: targetUrl });
  await delay(3500);

  let draft = null;
  if (!SKIP_A) {
  // 2. UI 点击「计划模式」开关
  const toggled = await evalJSRetry(client, `(async () => {
    const btn = document.querySelector('.sc-plan-mode-btn');
    if (!btn) return { ok: false, reason: 'no_plan_mode_btn' };
    btn.click();
    await new Promise(r => setTimeout(r, 300));
    const after = document.querySelector('.sc-plan-mode-btn');
    return { ok: true, pressed: after ? after.getAttribute('aria-pressed') : null, active: !!document.querySelector('.sc-plan-mode-btn.is-active') };
  })()`);
  assert('UI「计划模式」开关可点击且进入激活态（aria-pressed=true）',
    toggled && toggled.ok && toggled.pressed === 'true' && toggled.active,
    JSON.stringify(toggled));

  // 3. composer 输入起草指令并发送
  const typed = await evalJSRetry(client, `(async () => {
    const ta = document.querySelector('.sc-input');
    if (!ta) return { ok: false, reason: 'no_textarea' };
    ta.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(PROMPT)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    return { ok: true };
  })()`);
  assert('composer 输入计划起草指令并发送', typed && typed.ok, JSON.stringify(typed));
  await delay(2500);

  // 4. 轮询：draft 计划落库（status=draft + spec_md 非空 + assignee 步骤）
  log('阶段4: 轮询 draft 计划落库');
  let drafts = [];
  let shotDraft = false;
  let pollTick = 0;
  while (Date.now() < deadline) {
    await delay(POLL_MS);
    drafts = planRows(baselineIso).filter((p) => p.status === 'draft');
    if ((++pollTick) % 10 === 0) log(`  轮询#${pollTick}: drafts=${drafts.length}`);
    if (drafts.length >= 1 && !shotDraft) {
      draft = drafts[drafts.length - 1];
      const steps = planSteps(draft.id);
      if (draft.spec_md && steps.some((s) => s.assignee === 'subagent')) {
        shotDraft = true;
        log(`NOTICE: draft 计划已落库 planId=${draft.id} steps=${steps.length}`);
        break;
      }
    }
  }
  draft = draft || (drafts[drafts.length - 1] || null);
  results.draft = draft ? { id: draft.id, conversationId: draft.conversationId, userId: draft.user_id } : null;
  assert('真实模型经 plan(create, draft=true) 提交 draft 计划（status=draft）',
    !!draft, draft ? `planId=${draft.id}` : `drafts=${drafts.length}`);
  assert('draft 计划携带自包含 specMd（spec_md 非空）',
    !!draft && !!draft.spec_md && draft.spec_md.length > 40,
    draft && draft.spec_md ? `len=${draft.spec_md.length}` : 'no spec');
  const draftSteps = draft ? planSteps(draft.id) : [];
  assert('draft 步骤表含 assignee=subagent 标记（P2 分派语义进计划）',
    draftSteps.some((s) => s.assignee === 'subagent'),
    JSON.stringify(draftSteps.map((s) => ({ n: s.n, assignee: s.assignee, status: s.status }))));

  // 5. 轮询 DOM：批准卡渲染
  let cardShown = null;
  while (Date.now() < deadline) {
    await delay(POLL_MS);
    cardShown = await evalJS(client, `(() => {
      const card = document.querySelector('.sc-plan-approval');
      if (!card) return null;
      return {
        title: (card.querySelector('.sc-plan-approval-plan-title') || {}).textContent || null,
        hasSpec: !!card.querySelector('.sc-plan-approval-spec'),
        stepCount: card.querySelectorAll('.sc-plan-approval-step').length,
        buttons: Array.from(card.querySelectorAll('.sc-plan-approval-btn')).map(b => b.textContent.trim()),
      };
    })()`);
    if (cardShown) break;
  }
  results.approvalCard = cardShown;
  assert('run 结束后前端拉取 draft → 批准卡渲染（spec 正文 + 步骤表 + 三按钮）',
    !!cardShown && cardShown.buttons && cardShown.buttons.length === 3,
    JSON.stringify(cardShown));
  await screenshot(client, path.join(EVIDENCE_DIR, 'p55-01-approval-card.png'));

  // 6. 点击「批准并清上下文执行」
  const approveAt = new Date().toISOString();
  const clicked = await evalJSRetry(client, `(async () => {
    const btn = Array.from(document.querySelectorAll('.sc-plan-approval-btn'))
      .find(b => (b.title || '').includes('全新上下文'));
    if (!btn) return { ok: false, reason: 'no_fresh_btn' };
    btn.click();
    await new Promise(r => setTimeout(r, 500));
    return { ok: true };
  })()`);
  assert('点击「批准并清上下文执行」', clicked && clicked.ok, JSON.stringify(clicked));

  // 7. 断言：plan 转 approved + planMode 开关回 false + freshTurn 消息仅一条
  let approvedPlan = null;
  let freshTask = null;
  let freshMsgs = null;
  while (Date.now() < deadline) {
    await delay(POLL_MS);
    approvedPlan = planRows(baselineIso).find((p) => p.id === (draft && draft.id) && p.status === 'approved') || null;
    const modeOff = await evalJSRetry(client, `(() => {
      const btn = document.querySelector('.sc-plan-mode-btn');
      return btn ? btn.getAttribute('aria-pressed') : null;
    })()`);
    results.planModeOffAfterApprove = modeOff;
    if (approvedPlan) {
      freshTask = sqliteRows(
        `SELECT id, status, created_at, params FROM tasks WHERE type='agent_loop' AND created_at > '${approveAt}'
         ORDER BY created_at DESC LIMIT 1`
      )[0] || null;
      freshMsgs = freshTask ? taskMessages(freshTask.id) : null;
      if (freshMsgs && freshMsgs.length === 1) break;
    }
  }
  assert('批准后 plan 状态 draft → approved', !!approvedPlan,
    approvedPlan ? `planId=${approvedPlan.id}` : 'not approved');
  assert('批准后计划模式开关自动关闭（aria-pressed=false）',
    results.planModeOffAfterApprove === 'false', `aria-pressed=${results.planModeOffAfterApprove}`);
  assert(
    '清上下文执行：执行 run 消息数组仅含 spec 自包含首条（不带讨论历史）',
    Array.isArray(freshMsgs) && freshMsgs.length === 1
      && String(freshMsgs[0] && freshMsgs[0].content || '').includes('仅依据它执行'),
    freshMsgs ? `messages=${freshMsgs.length}, head=${String(freshMsgs[0] && freshMsgs[0].content || '').slice(0, 60)}` : 'no task'
  );
  await screenshot(client, path.join(EVIDENCE_DIR, 'p55-02-executing.png'));

  // 8. 轮询：执行期步骤推进 + spawn_agent 子 agent + 最终回复
  const execTaskId = freshTask ? freshTask.id : null;
  let stepsAfter = [];
  let children = [];
  let execFinal = null;
  while (Date.now() < deadline) {
    await delay(POLL_MS);
    stepsAfter = draft ? planSteps(draft.id) : [];
    children = spawnedChildren(baselineIso);
    const taskRow = execTaskId ? sqliteRows(`SELECT status FROM tasks WHERE id='${execTaskId}'`)[0] : null;
    if (taskRow && ['completed', 'failed', 'cancelled'].includes(taskRow.status)) {
      await delay(5000);
      execFinal = finalAssistant(execTaskId);
      if (execFinal) break;
    }
  }
  results.stepsAfterExecute = stepsAfter.map((s) => ({ n: s.n, status: s.status, assignee: s.assignee }));
  results.children = children;
  assert('执行期步骤推进：assignee 分派与主 agent 步骤经 update_step 写回终态',
    stepsAfter.filter((s) => s.status !== 'pending').length >= 2,
    JSON.stringify(stepsAfter.map((s) => ({ n: s.n, status: s.status }))));
  assert('P2 分派：assignee 步骤经 spawn_agent 派生真实子 agent（BLOCK-49 工具链）',
    children.length >= 1 && children.every((c) => c.kind === 'subagent'),
    JSON.stringify(children.map((c) => ({ agentId: c.agentId, status: c.status, task: c.task }))));
  assert('执行 run 最终回复产出（汇总报告）',
    !!execFinal && String(execFinal.content || '').length > 20,
    execFinal ? String(execFinal.content || '').slice(0, 120) : 'no final');
  await screenshot(client, path.join(EVIDENCE_DIR, 'p55-03-executed.png'));
  } // end SKIP_A 场景 A

  // ===== 场景 B：P3 Replan（直构数据 + UI 批准）=====
  // convId 取当前页面打开会话无法直接读 DOM，改用最近活跃会话（场景 A 结束后
  // 该会话即最新活跃，chat 模式默认打开它，批准拉取 effect 恰好命中）。
  const convRow = SKIP_A
    ? (sqliteRows(
        `SELECT c.id AS conv_id FROM copilot_conversations c
         WHERE c.id IN (SELECT DISTINCT conversation_id FROM copilot_messages WHERE conversation_id != '')
         ORDER BY (SELECT MAX(ts) FROM copilot_messages m WHERE m.conversation_id = c.id) DESC LIMIT 1`
      )[0] || null)
    : null;
  const convId = (draft && draft.conversation_id) || (convRow && convRow.conv_id) || null;
  const userId = (draft && draft.user_id) || 'local-user';
  if (convId && userId) {
    const revPlanId = 'plan_b55rev' + Date.now().toString(36).slice(-5);
    const nowIso = new Date().toISOString();
    execFileSync('sqlite3', [DB_PATH, [
      `INSERT INTO copilot_plans(id, user_id, title, goal, status, conversation_id, created_at, updated_at)
       VALUES ('${revPlanId}', '${userId}', 'BLOCK55 修订验证计划', '验证修订批准链', 'active', '${convId}', '${nowIso}', '${nowIso}')`,
      `INSERT INTO copilot_plan_steps(plan_id, n, title, hint, assignee, status, ts)
       VALUES ('${revPlanId}', 1, '旧步骤：将被修订替换', NULL, NULL, 'done', '${nowIso}')`,
      `INSERT INTO copilot_plan_steps(plan_id, n, title, hint, assignee, status, ts)
       VALUES ('${revPlanId}', 2, '旧步骤：执行失败待修订', NULL, NULL, 'pending', '${nowIso}')`,
      `INSERT INTO copilot_plan_revisions(id, plan_id, rev_no, reason, proposed_json, status, created_at)
       VALUES ('prev_b55rev${Date.now().toString(36).slice(-6)}', '${revPlanId}', 1, '步骤 2 前置条件缺失，修订为一步汇总',
         '[{"n":1,"title":"旧步骤：将被修订替换","status":"done"},{"n":2,"title":"新步骤：一句话说明修订已生效","status":"pending"}]',
         'proposed', '${nowIso}')`,
    ].join('; ')]);
    results.revisionPlanId = revPlanId;

    // 重新导航触发批准拉取 effect
    await client.send('Page.navigate', { url: targetUrl });
    await delay(3500);

    let banner = null;
    while (Date.now() < deadline) {
      await delay(POLL_MS);
      banner = await evalJSRetry(client, `(() => {
        const b = document.querySelector('.sc-plan-revision-banner');
        if (!b) return null;
        return { text: (b.querySelector('.sc-plan-revision-text') || {}).textContent || null,
                 hasApprove: !!Array.from(b.querySelectorAll('button')).find(x => x.textContent.includes('批准修订')) };
      })()`);
      if (banner) break;
    }
    results.revisionBanner = banner;
    assert('P3 replan：待批准修订条渲染（planId + revNo 可见）',
      !!banner && banner.hasApprove, JSON.stringify(banner));
    await screenshot(client, path.join(EVIDENCE_DIR, 'p55-04-revision-banner.png'));

    const revClicked = await evalJSRetry(client, `(async () => {
      const b = document.querySelector('.sc-plan-revision-banner');
      const btn = b && Array.from(b.querySelectorAll('button')).find(x => x.textContent.includes('批准修订'));
      if (!btn) return { ok: false, reason: 'no_btn' };
      btn.click();
      return { ok: true };
    })()`);
    assert('点击「批准修订」', revClicked && revClicked.ok, JSON.stringify(revClicked));

    let revApplied = null;
    let stepsReplaced = [];
    while (Date.now() < deadline) {
      await delay(POLL_MS);
      revApplied = sqliteRows(
        `SELECT status, applied_at FROM copilot_plan_revisions WHERE plan_id='${revPlanId}' AND rev_no=1`
      )[0] || null;
      stepsReplaced = planSteps(revPlanId);
      if (revApplied && revApplied.status === 'applied') break;
    }
    assert('修订案 applied（批准后生效，不可重复应用语义由后端守卫）',
      !!revApplied && revApplied.status === 'applied', JSON.stringify(revApplied));
    assert('修订批准后步骤表整体替换（保留 done，失败步骤被修订为新步骤）',
      stepsReplaced.length === 2
        && stepsReplaced[0].status === 'done'
        && /新步骤/.test(stepsReplaced[1].title || ''),
      JSON.stringify(stepsReplaced.map((s) => ({ n: s.n, title: s.title, status: s.status }))));
    await screenshot(client, path.join(EVIDENCE_DIR, 'p55-05-revision-applied.png'));
  } else {
    assert('P3 replan 场景（缺 conversation_id/user_id 上下文，跳过）', false, 'draft plan 无会话上下文');
  }

  const allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  results.allPass = allPass;
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'ui-live.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(`\n证据已写入 acceptance/block-55/ui-live.json (allPass=${allPass})`);
  process.exit(allPass ? 0 : 1);
}

const watchdog = setTimeout(() => {
  console.error('FAIL UI 实机脚本 10min 看门狗超时');
  process.exit(1);
}, 10 * 60 * 1000);
watchdog.unref();

main().catch((e) => {
  console.error('FAIL 脚本异常:', e && e.message);
  process.exit(1);
});
