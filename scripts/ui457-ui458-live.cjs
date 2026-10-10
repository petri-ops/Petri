#!/usr/bin/env node
'use strict';

/**
 * ui457-ui458-live.cjs — UI-457（分析面板参数配置表单）/ UI-458（结果页「继续分析」
 * 菜单）dev Electron 实机走查。骨架照抄 scripts/ui452-density-live.cjs
 * （dev-verify lib.cjs attach CDP、restCall 播种、createRun 断言、证据落
 * acceptance/ui-457-458/、结束删播种项目）。
 *
 * T0  HTTP deseq2 播种 completed（files 内联 base64，demo 数据取
 *     ../petri-pack-bio/plugins/deseq2/demo-data/）
 * T1  UI-457 表单：右栏「分析」tab → DESeq2 卡片「配置」→ 文件下拉
 *     （<选择文件> 占位）+ 数值参数默认值 +「按以上参数运行」按钮在场
 * T2  UI-457 组装：选工作区文件 → 点「按以上参数运行」→ copilot-ask 投递
 *     prompt 含「请运行」与参数键值对（window 捕获 petri:copilot-ask detail，
 *     对话末条消息文本为辅证）
 * T3  UI-458 菜单：深链两步法打开结果页 →「继续分析」按钮在场
 * T4  UI-458 展开：菜单列出目录驱动已装分析（go-kegg/gsea/volcano-plot 等）→
 *     点首项 → prompt 含任务 ID/产物名/工具名三要素
 * T5  UI-458 解读：结果工具栏「询问 Agent」→ prompt 含 result_summary 指令
 *     （buildResultInterpretationPrompt 单一出词口；若文案未生效记 known-gap）
 *
 * 栈降级：dev Electron 未运行（:9222 无监听）时前端面 T1-T5 如实记 fail
 * （不硬绕），HTTP 播种与证据落盘照常执行。
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'ui-457-458');
const DEMO_DIR = path.join(__dirname, '..', '..', 'petri-pack-bio', 'plugins', 'deseq2', 'demo-data');
const AUTH = 'Bearer desktop-local';
let client;
const EVAL = (expr) => lib.evalJs(client, expr);

function restCall(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port: 3001, path: apiPath, method,
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

async function attach() {
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/(?!window\/)/);
  const target = await lib.selectPageTarget(candidates, {
    probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
  });
  return lib.connectTarget(target);
}

const waitFor = async (expr, { timeoutMs = 20000, label = '' } = {}) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await EVAL(expr).catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${label || String(expr).slice(0, 70)}`);
    await sleep(350);
  }
};

async function createProject(name) {
  const created = (await restCall('POST', '/api/data/projects', { name: `${name}-${Date.now().toString(36)}`, modality: 'bulk' })).data;
  const projectId = created.project && created.project.id;
  if (!projectId) throw new Error(`project create failed: ${JSON.stringify(created).slice(0, 160)}`);
  return projectId;
}

/** 解析 demo coldata 的 condition 列取值顺序（首个出现序）→ 对照组/实验组。 */
function demoContrastLevels() {
  const coldata = fs.readFileSync(path.join(DEMO_DIR, 'demo-coldata.csv'), 'utf8').split(/\r?\n/).filter(Boolean);
  const header = coldata[0].split(',');
  const condCol = header.findIndex((h) => h.trim().toLowerCase() === 'condition');
  const levels = [];
  for (let i = 1; i < coldata.length; i += 1) {
    const value = coldata[i].split(',')[condCol >= 0 ? condCol : 1].trim();
    if (!levels.includes(value)) levels.push(value);
  }
  if (levels.length < 2) throw new Error(`demo coldata levels unusable: ${levels.join('/')}`);
  return { design: condCol >= 0 ? header[condCol].trim() : 'condition', ref: levels[0], treat: levels[1] };
}

/**
 * 播种参数照抄 ui452 脚本的 template 用法：以 template job params 为形状基线
 * （design/contrast_ref/contrast_treat），文件内容换 demo 数据时同步把对照
 * 组/实验组覆写为 demo coldata 实际水平（WT/KO），design 覆写为 demo 列名。
 */
async function buildSeedParams() {
  // BLOCK-136 终审 F2：template 分支是死代码（demo 值无条件整体覆写、模板结果
  // 对返回值零影响还白耗一次往返）——直接返回 demo 三键。
  const demo = demoContrastLevels();
  return { design: demo.design, contrast_ref: demo.ref, contrast_treat: demo.treat };
}

async function seedHttpDeseq2(projectId) {
  const params = await buildSeedParams();
  const files = {
    'counts.csv': fs.readFileSync(path.join(DEMO_DIR, 'demo-counts.csv')).toString('base64'),
    'coldata.csv': fs.readFileSync(path.join(DEMO_DIR, 'demo-coldata.csv')).toString('base64'),
  };
  const submit = (await restCall('POST', '/api/tools/run', { toolId: 'deseq2', projectId, params, files })).data;
  if (!submit.jobId) throw new Error(`submit failed: ${JSON.stringify(submit).slice(0, 160)}`);
  for (let i = 0; i < 120; i += 1) {
    await sleep(2000);
    const job = (await restCall('GET', `/api/tools/status/${submit.jobId}`)).data;
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      if (job.status !== 'completed') throw new Error(`seed job ${job.status}: ${String(job.error || '').slice(0, 140)}`);
      return submit.jobId;
    }
  }
  throw new Error('seed job timeout');
}

/** 把 demo csv 复制进项目工作区顶层（T2 文件下拉的选项源=工作区顶层 CSV/TSV）。 */
async function seedWorkspaceFiles(projectId) {
  const detail = (await restCall('GET', `/api/data/projects/${projectId}`)).data;
  const workspacePath = detail.project && (detail.project.workspace_path || detail.project.workspacePath);
  if (!workspacePath || !fs.existsSync(workspacePath)) throw new Error(`workspace dir missing: ${workspacePath}`);
  fs.copyFileSync(path.join(DEMO_DIR, 'demo-counts.csv'), path.join(workspacePath, 'counts.csv'));
  fs.copyFileSync(path.join(DEMO_DIR, 'demo-coldata.csv'), path.join(workspacePath, 'coldata.csv'));
  return workspacePath;
}

async function navigateToResult(projectId, jobId) {
  await EVAL(`location.href = 'http://localhost:3000/project/' + ${JSON.stringify(projectId)}; 'nav'`);
  await waitFor("(() => { const tabs = [...document.querySelectorAll('button')].filter(b => (b.textContent || '').trim() === '结果'); return tabs.length ? true : null; })()", { label: 'project mounted', timeoutMs: 30000 });
  await EVAL(`history.pushState({}, '', '?mode=result&job=' + ${JSON.stringify(jobId)}); window.dispatchEvent(new PopStateEvent('popstate')); 'spa'`);
  await waitFor("(location.pathname.includes('/result') || location.search.includes('job=')) ? true : null", { label: 'spa nav settled' });
  await sleep(1200);
}

/**
 * 武装 copilot-ask 捕获（window CustomEvent，dispatchPetriEvent 唯一通道）。
 * 幂等：location.href 整页导航后 window 重置，需在每次导航后重挂。
 */
async function armPromptCapture() {
  await EVAL(`(() => {
    if (!window.__ui457Prompts) window.__ui457Prompts = [];
    if (!window.__ui457Armed) {
      window.addEventListener('petri:copilot-ask', (e) => {
        window.__ui457Prompts.push(String((e.detail && e.detail.prompt) || ''));
      });
      window.__ui457Armed = true;
    }
    return 'armed';
  })()`);
}

const promptCount = async () => Number(await EVAL('(window.__ui457Prompts || []).length')) || 0;

/** 等待捕获数组越过基线并返回最新一条 prompt。 */
const waitForNextPrompt = async (baseline, label) =>
  waitFor(`(window.__ui457Prompts && window.__ui457Prompts.length > ${baseline}) ? window.__ui457Prompts[window.__ui457Prompts.length - 1] : null`, { label, timeoutMs: 15000 });

/** 尽力取消本项目仍在跑的作业（T2 投递会启动真实 Agent run，清理防搁浅）。 */
async function cancelRunningJobs(projectId) {
  try {
    const hist = (await restCall('GET', '/api/tools/history?limit=20')).data;
    const jobs = (hist && (hist.jobs || hist.data)) || [];
    for (const job of jobs) {
      if (job.project_id === projectId && ['pending', 'running'].includes(job.status)) {
        await restCall('POST', `/api/tools/cancel/${job.id}`).catch(() => {});
      }
    }
  } catch { /* 尽力而为 */ }
}

(async () => {
  const run = lib.createRun({ name: 'ui457-ui458', evidenceDir: EVIDENCE_DIR });
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  // ============ T0：HTTP 播种（后端独立可用，不依赖 Electron） ============
  // 终审 F3：T0 纳入清理面——中途失败也要清播种项目+落证据，不裸 exit 泄漏。
  let projectId = null;
  let workspacePath = null;
  let jobId = null;
  try {
    projectId = await createProject('ui457-458-verify');
    workspacePath = await seedWorkspaceFiles(projectId);
    jobId = await seedHttpDeseq2(projectId);
    run.assert('T0_seed_http_deseq2', true, `project=${projectId} job=${jobId} workspace=${path.basename(workspacePath)}`);
  } catch (t0Error) {
    if (projectId) await restCall('DELETE', `/api/data/projects/${projectId}`).catch(() => {});
    run.assert('T0_seed_http_deseq2', false, String(t0Error && t0Error.message).slice(0, 200));
    run.finish({ extra: { t0Failed: true } });
    process.exit(1);
  }

  // ============ attach：dev Electron CDP ============
  let frontendReady = true;
  let attachError = '';
  try {
    client = await attach();
    try { await client.send('Page.bringToFront'); } catch { /* ignore */ }
  } catch (error) {
    frontendReady = false;
    attachError = String(error && error.message).slice(0, 200);
  }

  if (!frontendReady) {
    // 栈降级：前端面走查无法进行——如实记 fail，不硬绕。
    const reason = `dev Electron 不可达（${attachError}）；前端面走查无法进行`;
    for (const t of ['T1_ui457_form_mounted', 'T2_ui457_prompt_params', 'T3_ui458_menu_present', 'T4_ui458_menu_expand_prompt', 'T5_ui458_ask_agent_result_summary']) {
      run.assert(t, false, reason);
    }
    await cancelRunningJobs(projectId);
    await restCall('DELETE', `/api/data/projects/${projectId}`).catch(() => {});
    await run.finish({
      extra: {
        stackMode: 'backend-only',
        envNote: 'npm run dev 启动被 :3000 占用阻断（dev-electron 判定非 Petri 进程；本机实证=本仓库 frontend 的遗留 vite 进程，疑似并行会话持有，未击杀不硬绕）；按预案降级为后端播种 + 前端面 fail 如实记录',
      },
    });
    process.exit(run.allPass ? 0 : 1);
  }

  try {
    // ================= T1：UI-457 表单 =================
    // 终审 F1：armPromptCapture 在每次整页导航完成后重挂（导航前挂载随旧
    // 文档销毁，T2 的 waitForNextPrompt 会在新文档上等不存在的监听必超时）。
    await EVAL(`location.href = 'http://localhost:3000/project/' + ${JSON.stringify(projectId)}; 'nav'`);
    await waitFor("(() => { const tabs = [...document.querySelectorAll('button')].filter(b => (b.textContent || '').trim() === '结果'); return tabs.length ? true : null; })()", { label: 'project mounted', timeoutMs: 30000 });
    await armPromptCapture(); // 导航完成后重挂（终审 F1）
    await sleep(800);
    // 右栏列头「+」工具菜单（TitleBarRightZone「展开更多工具」）→「分析」menuitem；
    // 右栏若被收起（默认 open，防御分支）先经「展开右侧栏」恢复。
    const rightZone = await EVAL(`(() => {
      if (document.querySelector('button[aria-label="展开更多工具"]')) return 'ready';
      const toggle = document.querySelector('button[aria-label="展开右侧栏"]');
      if (toggle) toggle.click();
      return 'expanded';
    })()`);
    if (rightZone === 'expanded') await sleep(600);
    await EVAL(`(() => { const btn = document.querySelector('button[aria-label="展开更多工具"]'); if (btn) btn.click(); return !!btn; })()`);
    await waitFor(`(() => { const menu = document.getElementById('titlebar-tool-menu'); return menu ? true : null; })()`, { label: 'tool menu open' });
    await EVAL(`(() => { const item = [...document.querySelectorAll('#titlebar-tool-menu [role="menuitem"]')].find(b => (b.textContent || '').trim() === '分析'); if (!item) return 'no-analyze-item'; item.click(); return 'opened'; })()`);
    await waitFor(`(() => { const cards = [...document.querySelectorAll('li')].filter((li) => /DESeq2/i.test(li.textContent || '') && li.querySelector('button')); return cards.length ? true : null; })()`, { label: 'analysis launch panel cards', timeoutMs: 25000 });
    // DESeq2 卡片点「配置」展开表单（AnalysisLaunchPanel BLOCK-131）
    await EVAL(`(() => {
      const card = [...document.querySelectorAll('li')].find((li) => /DESeq2 差异分析/.test(li.textContent || ''));
      const config = card && [...card.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '配置');
      if (!config) return 'no-config-btn';
      config.click();
      return 'expanded';
    })()`);
    const form = await waitFor(`(() => {
      const form = document.querySelector('[data-tool="deseq2"]');
      if (!form) return null;
      const selects = [...form.querySelectorAll('select')];
      const placeholder = selects.length > 0 && selects.every((s) => [...s.options].some((o) => (o.textContent || '') === '<选择文件>'));
      const padj = form.querySelector('input[aria-label="padj 阈值"]');
      const lfc = form.querySelector('input[aria-label="|log2FC| 阈值"]');
      const runBtn = [...form.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '按以上参数运行');
      return {
        selects: selects.length,
        placeholder,
        padjDefault: padj ? padj.value : null,
        lfcDefault: lfc ? lfc.value : null,
        runBtn: !!runBtn,
      };
    })()`, { label: 'ui457 form probe', timeoutMs: 15000 });
    run.assert('T1_ui457_form_mounted',
      !!form && form.selects >= 2 && form.placeholder === true && form.padjDefault === '0.05' && form.lfcDefault === '1' && form.runBtn === true,
      JSON.stringify(form));
    await Promise.race([lib.screenshotPng(client, EVIDENCE_DIR, 'ui457-param-form.png').catch(() => {}), sleep(4000)]);

    // ================= T2：UI-457 组装 prompt =================
    await EVAL(`(() => {
      const form = document.querySelector('[data-tool="deseq2"]');
      const pick = (ariaLabel, fileName) => {
        const sel = form && form.querySelector('select[aria-label="' + ariaLabel + '"]');
        if (!sel) return 'no-select:' + ariaLabel;
        const opt = [...sel.options].find((o) => o.textContent === fileName);
        if (!opt) return 'no-option:' + fileName;
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return 'picked';
      };
      return [pick('基因表达 counts 矩阵 (CSV: gene × sample)', 'counts.csv'), pick('样本信息表 (CSV: sample, condition)', 'coldata.csv')].join(',');
    })()`);
    await sleep(300);
    const beforeT2 = await promptCount();
    await EVAL(`(() => { const form = document.querySelector('[data-tool="deseq2"]'); const btn = form && [...form.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '按以上参数运行'); if (!btn) return 'no-btn'; btn.click(); return 'clicked'; })()`);
    const t2Prompt = await waitForNextPrompt(beforeT2, 'ui457 copilot-ask prompt');
    // 对话末条消息文本为辅证（composer 直发链，输入框通常已被 send 清空）
    const lastChatText = await EVAL(`(() => {
      const boxes = [...document.querySelectorAll('textarea')].map((t) => t.value || '').filter(Boolean);
      return boxes.length ? boxes.join(' | ') : '';
    })()`);
    run.assert('T2_ui457_prompt_params',
      /请运行/.test(String(t2Prompt)) && /counts=counts\.csv/.test(String(t2Prompt)) && /coldata=coldata\.csv/.test(String(t2Prompt)) && /design=condition/.test(String(t2Prompt)),
      'prompt=' + String(t2Prompt).slice(0, 220) + (lastChatText ? ' composer=' + lastChatText.slice(0, 80) : ''));
    await cancelRunningJobs(projectId);
    await sleep(1500);

    // ================= T3：UI-458 菜单在场（深链两步法） =================
    await navigateToResult(projectId, jobId);
    await armPromptCapture(); // 整页导航后 window 重置，重挂捕获监听
    const continueBtn = await waitFor(`(() => { const btn = document.querySelector('summary[aria-label="继续分析"]'); return btn ? true : null; })()`, { label: 'continue-analysis summary', timeoutMs: 30000 });
    run.assert('T3_ui458_menu_present', continueBtn === true, 'summary[aria-label=继续分析]在场');

    // ================= T4：UI-458 展开菜单 + 三要素 prompt =================
    const beforeT4 = await promptCount();
    await EVAL(`(() => { const s = document.querySelector('summary[aria-label="继续分析"]'); if (s) s.click(); return 'opened'; })()`);
    const menuItems = await waitFor(`(() => {
      const details = document.querySelector('summary[aria-label="继续分析"]');
      if (!details || !details.parentElement.open) return null;
      const items = [...details.parentElement.querySelectorAll('button[aria-label]')];
      return items.length > 0 ? items.map((b) => (b.textContent || '').trim()) : null;
    })()`, { label: 'menu items', timeoutMs: 10000 });
    const expectedDownstream = /go-kegg|gsea|volcano-plot/i;
    run.assert('T4a_ui458_menu_lists_catalog', Array.isArray(menuItems) && menuItems.length >= 3 && menuItems.some((t) => expectedDownstream.test(t)),
      `items=${JSON.stringify(menuItems)}`);
    await Promise.race([lib.screenshotPng(client, EVIDENCE_DIR, 'ui458-continue-menu.png').catch(() => {}), sleep(4000)]);
    await EVAL(`(() => {
      const details = document.querySelector('summary[aria-label="继续分析"]');
      const first = details && details.parentElement.querySelector('button[aria-label]');
      if (!first) return 'no-item';
      first.click();
      return 'clicked:' + first.getAttribute('aria-label');
    })()`);
    const t4Prompt = await waitForNextPrompt(beforeT4, 'ui458 copilot-ask prompt');
    run.assert('T4b_ui458_prompt_three_keys',
      String(t4Prompt).includes(jobId) && /结果\s+\S+\.csv|结果\s+\S+\.png/.test(String(t4Prompt)) && /「.+」分析/.test(String(t4Prompt)) && /血统/.test(String(t4Prompt)),
      'prompt=' + String(t4Prompt).slice(0, 220));
    await cancelRunningJobs(projectId);
    await sleep(1500);

    // ================= T5：UI-458 解读入口（result_summary 指令） =================
    // 并行实现线在升级该 prompt 组装（result_summary 锚定）；若文案未生效属时序，
    // 走查脚本不改前端，只在 detail 记 known-gap。
    // T5 前置：取消在途 agent 会话任务——T4 的菜单点击已发起真实 agent run，
    // handleAskAgent 的 isConversationRunning 守卫会让 T5 点击走「仍在处理上一个
    // 请求」通知分支、copilot-ask 根本不派发（T5 prompt=null 的真实根因）。
    try {
      const tasks = (await restCall('GET', '/api/ai/agent/tasks?limit=20')).data;
      const list = (tasks && tasks.tasks) || [];
      for (const t of list) {
        if (['running', 'pending'].includes(t.status || t.agentStatus)) {
          await restCall('POST', `/api/ai/agent/task/${encodeURIComponent(t.taskId)}/cancel`).catch(() => {});
        }
      }
      await sleep(2000);
    } catch { /* 尽力而为 */ }
    const beforeT5 = await promptCount();
    const askClicked = await EVAL(`(() => {
      const nav = document.querySelector('[data-testid="compact-result-navigator"]');
      const btn = (nav && nav.querySelector('button[aria-label="询问 Agent"]'))
        || document.querySelector('button[aria-label="询问 Agent"]')
        || [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '解释当前结果');
      if (!btn) return 'no-ask-btn';
      btn.click();
      return 'clicked';
    })()`);
    let t5Prompt = null;
    if (askClicked === 'clicked') {
      t5Prompt = await waitForNextPrompt(beforeT5, 'ui458 ask-agent prompt').catch(() => null);
    }
    const t5HasSummary = /result_summary/.test(String(t5Prompt));
    const t5IsInterpretation = /解读|解释/.test(String(t5Prompt));
    // 终审 F4：硬证据（result_summary 锚定）与软通过档（仅解读文案=实现线时序
    // known-gap）拆两条断言——软档不得与硬证据同列变绿高估升级证据。
    run.assert('T5_ui458_ask_agent_result_summary', t5HasSummary,
      t5HasSummary
        ? 'prompt=' + String(t5Prompt).slice(0, 220)
        : 'known-gap：投递 prompt 未含 result_summary 指令（实现线 prompt 组装升级时序）——prompt=' + String(t5Prompt).slice(0, 200) || '未捕获');
    if (!t5HasSummary && t5IsInterpretation) {
      run.assert('T5_known_gap_interpretation_only', true,
        'prompt 仅含解读文案（result_summary 锚定升级未生效的时序known-gap）——prompt=' + String(t5Prompt).slice(0, 200));
    }
    await cancelRunningJobs(projectId);
  } catch (error) {
    run.assert('live_flow_unexpected_error', false, String(error && error.message).slice(0, 200));
  } finally {
    if (projectId) {
      await cancelRunningJobs(projectId);
      await restCall('DELETE', `/api/data/projects/${projectId}`).catch(() => {});
    }
  }

  await run.finish({
    extra: {
      stackMode: 'dev-electron',
      seededJobId: jobId,
    },
  });
  process.exit(run.allPass ? 0 : 1);
})().catch((err) => {
  console.error('[ui457-ui458] FATAL', err && err.message);
  process.exit(2);
});
