#!/usr/bin/env node
'use strict';

/**
 * block349-subagent-live.cjs — BLOCK-349 探针 A：真实子智能体会话清 6 条 UI 台账
 * （UI-382 内联实况卡 / UI-383 只读折叠单行 / UI-384 只读输出内容 / UI-386 摘要卡
 * 图标带 / UI-387 职能图标 / UI-390 spawn role 贯通）。v2=v1 实机抓真三修：
 * ①时间线 run 折叠态先全展开再计数（BLOCK-108 v4 完成簇默认折叠）
 * ②摘要卡经标题栏「展开摘要概览」开关打开（默认关）
 * ③团队列表（右栏智能体 tab）补 UI-387/390 状态色断言。
 *
 * 真实数据来源=主 dev 栈（:3001，数据根 .petri-dev-user-data）active preset deepseek
 * 真跑 spawn_agent ×3——非合成事件注入。证据落 acceptance/block-349/。
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-349');
const AUTH = 'Bearer desktop-local';
const PORT = 3001;
let client;
const EVAL = (expr) => lib.evalJs(client, expr);

function restCall(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: apiPath, method,
      headers: { Authorization: AUTH, 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(b) }); } catch { resolve({ status: res.statusCode, data: { raw: b.slice(0, 200) } }); } });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const waitFor = async (expr, { timeoutMs = 30000, label = '' } = {}) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await EVAL(expr).catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${label || String(expr).slice(0, 70)}`);
    await sleep(400);
  }
};

async function createProject(name) {
  const created = (await restCall('POST', '/api/data/projects', { name: `${name}-${Date.now().toString(36)}` })).data;
  const projectId = created.project && created.project.id;
  if (!projectId) throw new Error(`project create failed: ${JSON.stringify(created).slice(0, 160)}`);
  return projectId;
}

async function seedWorkspaceFiles(projectId) {
  const detail = (await restCall('GET', `/api/data/projects/${projectId}`)).data;
  const workspacePath = detail.project && (detail.project.workspace_path || detail.project.workspacePath);
  if (!workspacePath || !fs.existsSync(workspacePath)) throw new Error(`workspace dir missing: ${workspacePath}`);
  fs.mkdirSync(path.join(workspacePath, 'topics'), { recursive: true });
  fs.writeFileSync(path.join(workspacePath, 'topics', 'a.md'), '# 方向A 缓存调研\n\n要点 QED-11：本地命中优先，TTL 15 分钟，命中率目标 60%。\n');
  fs.writeFileSync(path.join(workspacePath, 'topics', 'b.md'), '# 方向B 调度调研\n\n要点 HILBERT-4：公平队列按项目隔离配额，抢占阈值 80%。\n');
  fs.writeFileSync(path.join(workspacePath, 'topics', 'c.md'), '# 方向C 评测调研\n\n要点 TURING-9：判据先冻结后跑，同一任务两次独立采样。\n');
  return workspacePath;
}

async function providerSanity() {
  const start = await restCall('POST', '/api/ai/agent', {
    messages: [{ role: 'user', content: '这是一条连通性哨兵：只回复两个字母 OK，不要使用任何工具。' }],
    context: { accessMode: 'full' },
  });
  const taskId = start.data && start.data.taskId;
  if (!taskId) throw new Error(`sanity start failed: ${JSON.stringify(start.data || {}).slice(0, 160)}`);
  for (let i = 0; i < 60; i += 1) {
    await sleep(2000);
    const meta = await restCall('GET', `/api/ai/agent/task/${encodeURIComponent(taskId)}/meta`);
    const status = (meta.data && (meta.data.agentStatus || meta.data.status)) || '';
    if (['done', 'completed', 'error', 'failed', 'cancelled'].includes(status)) {
      if (status === 'done' || status === 'completed') return { taskId, elapsedMs: i * 2000 };
      throw new Error(`sanity task terminal=${status}: ${String((meta.data && meta.data.error) || '').slice(0, 160)}`);
    }
  }
  throw new Error('sanity task timeout 120s');
}

async function screenshot(name) {
  try {
    const shot = await client.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(EVIDENCE_DIR, name);
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    return path.relative(process.cwd(), file);
  } catch (e) {
    return `screenshot_failed: ${String(e && e.message).slice(0, 80)}`;
  }
}

(async () => {
  const run = lib.createRun({ name: 'block349-subagent', evidenceDir: EVIDENCE_DIR });
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  let projectId = null;
  try {
    // ============ T0：provider 哨兵 + 播种 + attach 9223 ============
    let sanity = null;
    try {
      sanity = await providerSanity();
      run.assert('T0_provider_sanity', true, `真实 agent 回合收口（${Math.round(sanity.elapsedMs / 1000)}s）——active preset 可达`);
    } catch (e) {
      run.assert('T0_provider_sanity', false, `环境不可得：${String(e && e.message).slice(0, 200)}`);
      run.finish({ extra: { envUnavailable: 'provider' } });
      process.exit(1);
    }
    projectId = await createProject('block349-subagent');
    await seedWorkspaceFiles(projectId);
    client = await lib.connectTestTarget({ timeoutMs: 30000 });
    try { await client.send('Page.bringToFront'); } catch { /* ignore */ }
    await EVAL(`location.href = 'http://localhost:3000/project/${projectId}'; 'nav'`);
    await sleep(2500);
    await waitFor(`document.querySelector('textarea.sc-input') ? true : null`, { label: 'composer mounted', timeoutMs: 45000 });
    run.assert('T0b_setup', true, `9223 已连接 + project=${projectId} 页面就绪`);

    // ============ T1：UI 发送 spawn 指令 ============
    const prompt = '请派出 3 个子代理并行工作：子代理 A 用 workspace_read 读取 topics/a.md 并用一句话返回要点；'
      + '子代理 B 用 workspace_read 读取 topics/b.md 并用一句话返回要点；'
      + '子代理 C 用 workspace_list 列出工作区顶层文件并用一句话返回清单。'
      + '三个都返回后，用一段话汇总三个要点。全程不要自己代读文件。';
    await EVAL(`window.dispatchEvent(new CustomEvent('petri:copilot-ask', { detail: { prompt: ${JSON.stringify(prompt)} } })); 'dispatched'`);
    await waitFor(`document.querySelector('[data-testid="chat-stop"]') ? true : null`, { label: 'run started', timeoutMs: 30000 });
    run.assert('T1_ui_send_spawn_prompt', true, 'copilot-ask 投递进入发送路径（stop 钮出现=run 启动）');

    const deadline = Date.now() + 420000;
    let settled = 0;
    while (Date.now() < deadline) {
      await sleep(4000);
      const state = await EVAL(`(() => {
        const stop = document.querySelector('[data-testid="chat-stop"]');
        const running = document.querySelectorAll('.sc-tool-activity-summary[data-state="running"]').length;
        return JSON.stringify({ stop: !!stop, running });
      })()`).catch(() => null);
      let parsed = null;
      try { parsed = JSON.parse(state); } catch { /* ignore */ }
      if (parsed && !parsed.stop && parsed.running === 0) { settled += 1; } else { settled = 0; }
      if (settled >= 3) break;
    }
    const stopGone = await EVAL(`!document.querySelector('[data-testid="chat-stop"]')`);
    run.assert('T1b_run_settled', stopGone, `主任务收口（stop 钮退场；420s 窗口内 settled=${settled}）`);

    // ============ 展开全部折叠簇/折叠行（v3 修：每元素只点击一次，防 toggle 回弹） ============
    // 实机抓真 v2：对同一元素两轮点击=展开再收起。v3=run 折叠行一轮、簇头一轮（各一次）。
    const expandAll = await EVAL(`(() => {
      const fold = [...document.querySelectorAll('button.sc-run-fold-line')];
      fold.forEach((b) => { try { b.click(); } catch { /* ignore */ } });
      return fold.length;
    })()`);
    await sleep(1400);
    const expandAll2 = await EVAL(`(() => {
      const heads = [...document.querySelectorAll('button.sc-tool-activity-summary')];
      heads.forEach((b) => { try { b.click(); } catch { /* ignore */ } });
      return heads.length;
    })()`);
    await sleep(1200);
    run.assert('T2_expand_all_clusters', true, `展开 run 折叠行 ${expandAll} 个 + 簇头 ${expandAll2} 个（各点击一次）`);

    // ============ T3 (UI-382)：spawn 点内联实况卡 ============
    // 实机抓真 v4：内联卡在 spawn 行展开体内（默认折叠不可见）——先展开全部「已派发」行。
    await EVAL(`(() => {
      const rows = [...document.querySelectorAll('.sc-tool-qoder-row')];
      const spawnRows = rows.filter((r) => {
        const label = (r.querySelector('.sc-tool-qoder-label') || {}).textContent || '';
        return label.includes('已派发');
      });
      spawnRows.forEach((r) => {
        const head = r.querySelector('.sc-tool-qoder-head');
        if (head && head.getAttribute('data-expanded') !== 'true') head.click();
      });
      return spawnRows.length;
    })()`);
    await sleep(1200);
    const inlineCards = await EVAL(`(() => {
      const cards = [...document.querySelectorAll('.sc-tool-subagent-inline[data-status]')];
      return JSON.stringify({ count: cards.length, statuses: cards.map((c) => c.getAttribute('data-status')).slice(0, 8) });
    })()`);
    const cards = JSON.parse(inlineCards || '{}');
    run.assert('T3_ui382_inline_subagent_cards', cards.count >= 3,
      `内联实况卡 × ${cards.count}（statuses=${(cards.statuses || []).join(',')}）——spawn 行展开即归宿（真实 spawn ×3 渲染）`);

    // ============ T4 (UI-383)：真实工具行单行折叠 + 簇头（排除 run 折叠行） ============
    const rowsInfo = await EVAL(`(() => {
      const rows = [...document.querySelectorAll('.sc-tool-qoder-row')];
      const real = rows.filter((r) => {
        const label = (r.querySelector('.sc-tool-qoder-label') || {}).textContent || '';
        return label && !label.includes('执行工具');
      });
      const labels = real.map((r) => (r.querySelector('.sc-tool-qoder-label') || {}).textContent).slice(0, 14);
      const expandedRows = real.filter((r) => {
        const head = r.querySelector('.sc-tool-qoder-head');
        return head && head.getAttribute('data-expanded') === 'true';
      }).length;
      return JSON.stringify({ total: rows.length, real: real.length, labels, expandedRows });
    })()`);
    const rowsParsed = JSON.parse(rowsInfo || '{}');
    run.assert('T4_ui383_readonly_singleline_collapse', rowsParsed.real >= 4,
      `真实工具行 × ${rowsParsed.real}/${rowsParsed.total}（labels=${(rowsParsed.labels || []).join('/')}；默认展开 ${rowsParsed.expandedRows} 行=单行折叠语义）`);

    // ============ T5 (UI-384)：展开 workspace_read 行见输出内容 ============
    const expandResult = await EVAL(`(async () => {
      const rows = [...document.querySelectorAll('.sc-tool-qoder-row')];
      const target = rows.find((r) => {
        const label = (r.querySelector('.sc-tool-qoder-label') || {}).textContent || '';
        return (label.includes('读取') || label.includes('列目录')) && !label.includes('执行工具');
      });
      if (!target) return JSON.stringify({ clicked: false, reason: 'no read row' });
      const head = target.querySelector('.sc-tool-qoder-head');
      if (!head) return JSON.stringify({ clicked: false, reason: 'no head' });
      if (head.getAttribute('data-expanded') !== 'true') head.click();
      await new Promise((r) => setTimeout(r, 700));
      const body = target.querySelector('.sc-tool-activity-output');
      return JSON.stringify({ clicked: true, hasOutput: !!body, text: body ? body.textContent.slice(0, 220) : '' });
    })()`);
    const expand = JSON.parse(expandResult || '{}');
    const outputHasSeed = expand.clicked && expand.hasOutput && /QED-11|HILBERT-4|TURING-9|topics\//.test(expand.text || '');
    run.assert('T5_ui384_readonly_output_content', outputHasSeed,
      `行展开=${expand.clicked} 输出体=${expand.hasOutput} 内容片段=${String(expand.text || '').replace(/\n+/g, ' ').slice(0, 110)}`);

    // ============ T6 (UI-386)：摘要卡智能体图标带（标题栏开关打开） ============
    const toggled = await EVAL(`(() => {
      const btn = document.querySelector('button[aria-label="展开摘要概览"]');
      if (btn) { btn.click(); return 'clicked'; }
      const pressed = document.querySelector('button[aria-label="收起摘要概览"]');
      return pressed ? 'already-open' : 'no-toggle';
    })()`);
    await sleep(1200);
    const summaryInfo = await EVAL(`(() => {
      const aside = document.querySelector('aside[aria-label="项目运行摘要"]');
      if (!aside) return JSON.stringify({ present: false, toggle: 'missing-aside' });
      const chips = [...aside.querySelectorAll('button[data-category]')];
      const cats = chips.map((b) => b.getAttribute('data-category'));
      const section = aside.querySelector('section[aria-label="智能体"]');
      return JSON.stringify({ present: true, sectionPresent: !!section, chips: chips.length, cats });
    })()`);
    const summary = JSON.parse(summaryInfo || '{}');
    run.assert('T6_ui386_summary_agent_strip', summary.present && summary.sectionPresent && (summary.chips || 0) >= 3,
      `toggle=${toggled} 摘要卡=${summary.present} 智能体节=${summary.sectionPresent} chips=${summary.chips}（cats=${(summary.cats || []).join(',')}）`);

    // ============ T7 (UI-387/390)：职能 category 键集 + 团队列表 role/status ============
    const KNOWN_CATS = ['search', 'collect', 'organize', 'read', 'analysis', 'test', 'write', 'plan', 'fix', 'investigator', 'general'];
    const catsValid = (summary.cats || []).every((c) => KNOWN_CATS.includes(c));
    run.assert('T7a_ui387_category_shape_valid', (summary.cats || []).length >= 3 && catsValid,
      `data-category 全部落在 AGENT_CATEGORIES 键集（形状=职能 emoji：${(summary.cats || []).join(',')}）`);
    const teamInfo = await EVAL(`(() => {
      const text = document.body.textContent || '';
      const teamHeader = /团队\\s*\\d+\\s*成员/.test(text);
      const doneCount = (text.match(/已完成/g) || []).length;
      const roleLabels = ['读取', '列目录', '检索', '分析', '通用'].filter((r) => text.includes(r));
      const inlineStatus = document.querySelectorAll('.sc-tool-agent-status[data-status]').length;
      return JSON.stringify({ teamHeader, doneCount, roleLabels, inlineStatus });
    })()`);
    const team = JSON.parse(teamInfo || '{}');
    run.assert('T7b_ui390_role_status_propagation', team.teamHeader && team.doneCount >= 3 && team.inlineStatus >= 3,
      `团队头=${team.teamHeader} 已完成标记 × ${team.doneCount} 角色词命中=${(team.roleLabels || []).join('/')} 状态色 chip × ${team.inlineStatus}（时间线内联卡+摘要卡 chip+团队列表三处贯通）`);

    // ============ T8：截图 ============
    const shot1 = await screenshot('block349-subagent-timeline.png');
    await EVAL(`(() => { const a = document.querySelector('aside[aria-label="项目运行摘要"]'); if (a) a.scrollIntoView({ block: 'center' }); return 'ok'; })()`);
    await sleep(500);
    const shot2 = await screenshot('block349-subagent-summary.png');
    run.assert('T8_screenshots', true, `timeline=${shot1} summary=${shot2}`);

    await run.finish({ extra: { projectId } });
  } catch (error) {
    run.assert('UNEXPECTED', false, String(error && error.message).slice(0, 240));
    try { await screenshot('block349-subagent-error.png'); } catch { /* ignore */ }
    await run.finish({ extra: { fatal: true } });
    process.exitCode = 1;
  } finally {
    if (projectId) {
      await restCall('DELETE', `/api/data/projects/${projectId}`).catch(() => {});
      console.log(`[cleanup] project ${projectId} deleted`);
    }
  }
})();
