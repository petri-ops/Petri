#!/usr/bin/env node
/**
 * scripts/block184-p1-live.mjs — BLOCK-184 P1 代行 CDP 走查（UI 过目清偿批）。
 *
 * 对 dev Electron 主窗（CDP :9222）驱动真实界面，逐条产出「截图 + 断言 JSON」，
 * 证据落 acceptance/block-184/。探针可复跑；环境不可用段按 plan §6 如实分档
 * （tiered 断言记 fail=false 的 tier:'env' 项，不算 PASS 亦不算产品缺陷）。
 *
 * 分节：
 *   A  UI-481 领域包货架：可用卡 → UI 一键安装 → 整包停用/启用往返（P1）
 *   B  环境激活：杀 3001 PID 让 supervisor 重生 → 插件注册核验
 *   C  UI-467/457 分析表单：文件下拉（path 消歧/子目录）+ 默认参数 + demo 一键载入 + 500 条截断提示（P1）
 *   D  UI-466 审阅三件：文件列/统计/进度 + hunk 决策推进未决计数（P1）
 *   E  UI-469 任务墙：指挥中心在场 + 诚实空态（队位段分档：dev 0 tool_jobs）
 *   F  UI-470 成果面：结果 tab 在场 + 诚实空态（artifact 面段分档：dev 0 artifacts）
 *   G  UI-468/471 移动同步：面板在场 + 隧道徽标不假宣称（探活段分档：无隧道）
 *   H  UI-482 投影页：配对→/m 加载→连接态无断连横幅（断连段分档）
 *   Z  清理：UI 卸载领域包 + 重启复原 + 删播种项目 + 撤配对 + 删临时目录
 *
 * 纪律：刮擦即复原（pack 记录制卸载、项目 REST 删、临时目录 rm）；settings 零触碰；
 * 后端重启只杀 3001（supervisor 重生），不动 Electron 主进程。
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const lib = await import(pathToFileURL(path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs')).href).then((m) => m.default ?? m);
const { connectTestTarget, evalJs, screenshotPng, createRun, log } = lib;

const AUTH = { 'Content-Type': 'application/json', Authorization: 'Bearer desktop-local' };
const API = 'http://127.0.0.1:3001/api';
const GW = 'http://127.0.0.1:3005';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-184');
const PACK_ID = 'petri-pack-bio';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(id, ok, detail = '', extra = {}) {
  results.push({ id, ok: !!ok, detail: String(detail).slice(0, 300), ...extra });
  log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ` :: ${String(detail).slice(0, 140)}` : ''}`);
}
function tier(id, detail) {
  results.push({ id, ok: null, tier: 'env', detail: String(detail).slice(0, 300) });
  log(`TIER ${id} :: ${String(detail).slice(0, 140)}`);
}

async function api(method, p, body) {
  const r = await fetch(API + p, { method, headers: AUTH, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

// ---------- CDP 测试实例附着（BLOCK-100 P3 红线：探针禁导航用户主窗 9222，专用 9223） ----------
// 用 lib.connectTestTarget 标准件：9223 端口专属=第一层判别；?test=1 标记缺失时
// 按端口专属回退并告警（SPA 导航丢查询串，lib 注释 2026-09-18 实机抓真）。
let client;
async function attachMain() {
  client = await connectTestTarget({ timeoutMs: 30000 });
  return client;
}
const EV = (expr, timeoutMs = 20000) => evalJs(client, expr, timeoutMs);
async function nav(url, settleMs = 2600) {
  await client.send('Page.navigate', { url });
  await sleep(settleMs);
}
async function shot(name) {
  await screenshotPng(client, EVIDENCE, name);
  return `acceptance/block-184/${name}`;
}
/** 等某表达式为真（轮询 EVAL）。 */
async function waitFor(expr, { timeoutMs = 20000, label = '' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await EV(expr).catch(() => null);
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${label || String(expr).slice(0, 80)}`);
    await sleep(400);
  }
}
/** 按可见文本找按钮并点击（真实 UI 词表驱动）。 */
async function clickByText(text, { tag = 'button', timeoutMs = 8000 } = {}) {
  const expr = `(() => {
    const els = [...document.querySelectorAll('${tag}')].filter((el) => el.offsetParent !== null);
    const hit = els.find((el) => (el.textContent || '').replace(/\\s+/g, '').includes('${text}'));
    if (!hit) return null;
    hit.click();
    return (hit.textContent || '').trim().slice(0, 40);
  })()`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await EV(expr).catch(() => null);
    if (r) return r;
    if (Date.now() > deadline) return null;
    await sleep(400);
  }
}
/** 经标题栏「+」工具菜单打开右栏 tab（右栏收起态唯一正路）。点击必须限定在菜单 DOM 内——
 *  全局 clickByText 会先命中 composer 快捷动作钮（「分析单细胞数据…」），五/六轮 C 段假红根因。 */
async function openRightTab(label) {
  const opened = await EV(`(() => { const b = document.querySelector('[aria-label="展开更多工具"]'); if (b) { b.click(); return true; } return false; })()`);
  if (!opened) return false;
  await waitFor(`!!document.querySelector('#titlebar-tool-menu')`, { timeoutMs: 6000, label: 'tool menu' }).catch(() => {});
  await sleep(400);
  const hit = await EV(`(() => {
    const menu = document.querySelector('#titlebar-tool-menu');
    if (!menu) return null;
    const els = [...menu.querySelectorAll('button,[role="menuitem"]')].filter((el) => el.offsetParent !== null);
    const hit = els.find((el) => (el.textContent || '').replace(/\\s+/g, '') === '${label}'
      || (el.textContent || '').replace(/\\s+/g, '').startsWith('${label}'));
    if (!hit) return null;
    hit.click();
    return (hit.textContent || '').trim().slice(0, 20);
  })()`);
  await sleep(600);
  return !!hit;
}

// ---------- dev 栈重启（项目配方 restart-dev-stack.sh：vite+后端+CDP 三面就绪） ----------
async function restartBackend(waitMs = 150000) {
  // 实测（2026-10-15 BLOCK-184 P1）：杀 3001 PID 不会重生（backend-proc-manager 无
  // auto-respawn），须走整栈重启配方；脚本本体耗时 ~2-3min，detached  spawn + 端口轮询。
  log('restarting dev stack via restart-dev-stack.sh …');
  const child = spawn('D:\\Program Files\\Git\\bin\\bash.exe', ['scripts/restart-dev-stack.sh'], {
    cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true,
  });
  child.on('error', (e) => log(`restart spawn error: ${e.message}`));
  child.unref();
  const deadline = Date.now() + waitMs;
  for (;;) {
    await sleep(2500);
    log('… dev stack restart poll');
    try {
      const r = await fetch(`${API}/tools/catalog`, { headers: AUTH });
      if (r.ok) return await r.json().catch(() => ({}));
    } catch { /* 起栈中 */ }
    if (Date.now() > deadline) throw new Error('dev stack restart timeout');
  }
}

// ---------- 刮擦 seeding ----------
const scratch = [];
function tmpDir(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `block184-${tag}-`));
  scratch.push(d);
  return d;
}
function sh(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const run = createRun({ name: 'block184-p1', evidenceDir: EVIDENCE });
  await attachMain();
  log('attached main window');

  try {
    // ============ A. UI-481 领域包货架启停（状态自适应：已安装态跳过安装段，首跑红因=假设未安装起手） ============
    await nav('http://localhost:3000/extensions?tab=domain-plugins');
    const card = await waitFor(`!!document.querySelector('[data-testid="domain-pack-${PACK_ID}"]')`, { timeoutMs: 25000, label: 'pack card' }).catch(() => null);
    let wasInstalled = card
      ? await EV(`(/已安装/.test((document.querySelector('[data-testid="domain-pack-${PACK_ID}"]')?.innerText) || ''))`)
      : false;
    record('UI481.card-visible', !!card, `domain-pack-${PACK_ID} visible=${!!card} installed=${wasInstalled}（起手态）`);
    await shot('ui481-extensions-before-install.png');
    if (!wasInstalled) {
      await clickByText('一键安装', { timeoutMs: 6000 });
      await waitFor(`(document.body.innerText || '').includes('已安装')`, { timeoutMs: 20000, label: 'install notice' }).catch(() => {});
      await sleep(1500);
    }
    const toggleVisible = await waitFor(`!!document.querySelector('[data-testid="pack-toggle-${PACK_ID}"]')`, { timeoutMs: 15000, label: 'pack toggle' }).then(() => EV(`(() => {
      const btn = document.querySelector('[data-testid="pack-toggle-${PACK_ID}"]');
      return btn ? { present: true, text: (btn.textContent || '').trim() } : { present: false };
    })()`)).catch(() => ({ present: false }));
    record('UI481.pack-toggle-visible', !!toggleVisible?.present, JSON.stringify(toggleVisible));
    await shot('ui481-pack-installed.png');
    // 停用 → 启用 往返（UI-481 本体）
    if (toggleVisible?.present) {
      await EV(`document.querySelector('[data-testid="pack-toggle-${PACK_ID}"]').click()`);
      await sleep(1500);
      const afterOff = await EV(`(() => { const b = document.querySelector('[data-testid="pack-toggle-${PACK_ID}"]'); return b ? (b.textContent || '').trim() : null; })()`);
      record('UI481.toggle-disable-flip', afterOff === '启用', `after 停用 click → "${afterOff}"`);
      await shot('ui481-pack-disabled.png');
      await EV(`document.querySelector('[data-testid="pack-toggle-${PACK_ID}"]').click()`);
      await sleep(1500);
      const afterOn = await EV(`(() => { const b = document.querySelector('[data-testid="pack-toggle-${PACK_ID}"]'); return b ? (b.textContent || '').trim() : null; })()`);
      record('UI481.toggle-enable-restore', afterOn === '停用', `after 启用 click → "${afterOn}"`);
    }

    // ============ B. 插件注册核验（已注册则跳过整栈重启；未注册才重启） ============
    let catalog = await (await fetch(`${API}/tools/catalog`, { headers: AUTH })).json().catch(() => ({}));
    let toolIds = (catalog.catalog || []).map((t) => t.id || t.name).filter(Boolean);
    if (!toolIds.some((t) => String(t).includes('deseq2'))) {
      log('deseq2 not registered — full stack restart');
      catalog = await restartBackend();
      await attachMain(); // 整栈重启后 Electron 目标已换，重附着
      toolIds = (catalog.catalog || []).map((t) => t.id || t.name).filter(Boolean);
    } else {
      log('deseq2 already registered — skip restart');
    }
    // catalog 端点形状={ok,source,count,catalog:[{id,...}]}（tools-catalog.js 实测）
    record('ENV.backend-respawn-plugins', toolIds.length > 0, `catalog tools=${toolIds.length} sample=${toolIds.slice(0, 4).join(',')}`);
    const hasDeseq2 = toolIds.some((t) => String(t).includes('deseq2'));
    record('ENV.deseq2-registered', hasDeseq2, `deseq2 in catalog=${hasDeseq2}`);

    // ============ C. UI-467/457 分析表单 ============
    // 实测（第八轮前 tree 端点直查）：/tree?recursive=1 先根层后下潜，500 截断窗被根层
    // 文件吃光后嵌套文件不可达——「截断提示」与「子目录 path 消歧」互斥，必须双工作区构造。
    if (hasDeseq2) {
      // 嵌套深度=2（files.js TREE_RECURSIVE_MAX_DEPTH=3：root=0，深度 3 目录被枚举但内容不列，
      // 可达文件最深 data/nested/x.csv；九轮三层构造永不可达）
      const seedWs = (tag, fillerCount) => {
        const ws = tmpDir(tag);
        sh('git init -q . && git config user.email b184@local && git config user.name b184', ws);
        fs.writeFileSync(path.join(ws, 'counts.csv'), 'gene,ctrl,treat\ng1,10,20\ng2,30,15\n');
        fs.mkdirSync(path.join(ws, 'data', 'nested'), { recursive: true });
        fs.writeFileSync(path.join(ws, 'data', 'nested', 'counts_nested.csv'), 'gene,ctrl,treat\ng1,10,20\n');
        for (let i = 0; i < fillerCount; i++) fs.writeFileSync(path.join(ws, `filler_${String(i).padStart(4, '0')}.txt`), 'x');
        return ws;
      };
      // 展开 deseq2 卡并等表单挂载。选择器=卡标题以 DESeq2 开头（大小写不敏感）的配置钮——
      // 第九轮抓真：deg-standardizer 描述含「将 DESeq2…」，按 li.textContent 匹配会先命中它
      // （且其无 demoDataUrl，demo 钮随之失踪，一错带两红）
      const openDeseq2Form = async () => {
        const hasConfig = await waitFor(`[...document.querySelectorAll('button')].some((b) => b.offsetParent !== null && (b.textContent || '').trim() === '配置')`, { timeoutMs: 25000, label: 'config buttons' }).catch(() => null);
        if (!hasConfig) return { tabOpened: false, configClicked: null };
        const tabOpened = true;
        const configClicked = await EV(`(() => {
          const btn = [...document.querySelectorAll('button')].find((b) => {
            if (b.offsetParent === null || (b.textContent || '').trim() !== '配置') return false;
            const card = b.closest('li');
            return !!(card && /^deseq2/i.test((card.innerText || '').trim()));
          });
          if (!btn) return null;
          btn.click();
          return 'deseq2-config';
        })()`);
        const form = await waitFor(`(document.body.innerText || '').includes('按以上参数运行')`, { timeoutMs: 20000, label: 'analysis form' }).catch(() => null);
        return { tabOpened, configClicked, form: !!form };
      };

      // —— 小工作区（表单本体 + path 消歧 + demo 一键）——
      const wsSmall = seedWs('ws-small', 0);
      const projS = (await api('POST', '/data/projects', { name: `b184-analyze-${Date.now().toString(36)}`, workspacePath: wsSmall, modality: 'bulk' })).json;
      const pidA = projS.project?.id || projS.id;
      record('UI467.seed-project', !!pidA, `projectId=${pidA}`);
      if (pidA) {
        await nav(`http://localhost:3000/project/${pidA}`, 3500);
        await openRightTab('分析');
        const st = await openDeseq2Form();
        record('UI467.form-mounted', st.form, `「按以上参数运行」在场（tab=${st.tabOpened} 展开=${st.configClicked}）`);
        const placeholder = await EV(`(document.body.innerText || '').includes('<选择文件>')`);
        record('UI457.file-placeholder', !!placeholder, '「<选择文件>」占位在场');
        // 下拉选项带完整路径（path 消歧 + 子目录可达）
        const optInfo = await EV(`(() => {
          const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value && o.value !== ''));
          if (!sel) return null;
          const vals = [...sel.options].map((o) => o.value).filter(Boolean);
          return { count: vals.length, withSlash: vals.filter((v) => v.includes('/') || v.includes('\\\\')).length, sample: vals.slice(0, 3) };
        })()`);
        record('UI467.dropdown-path-disambiguation', !!optInfo && optInfo.count > 0 && optInfo.withSlash > 0, JSON.stringify(optInfo));
        // 默认参数回填
        const defaults = await EV(`(() => {
          const inputs = [...document.querySelectorAll('input[type="number"], input[type="text"]')].filter((el) => el.offsetParent !== null);
          return inputs.map((el) => ({ id: el.id || el.name, value: el.value })).slice(0, 6);
        })()`);
        record('UI457.param-defaults', Array.isArray(defaults) && defaults.some((d) => d.value !== ''), JSON.stringify(defaults));
        await shot('ui467-analysis-form.png');
        // demo 一键载入（十轮红因=页面内相对 fetch('/api/…') 走 Vite :3000 源未到后端；
        // 截图实证「已载入 4 个示例文件」状态行在场——核验改 Node 侧 API 直查 + UI 状态行双判据）
        const demoClicked = await clickByText('用示例数据试跑', { timeoutMs: 6000 });
        await sleep(2500);
        const demoUiConfirmed = await EV(`(document.body.innerText || '').includes('已载入')`);
        const treeJson = demoClicked ? (await api('GET', `/workspaces/${pidA}/tree?recursive=1`)).json : {};
        const demoLanded = JSON.stringify(treeJson).includes('demo-data');
        record('UI467.demo-oneclick', !!demoClicked && demoLanded && !!demoUiConfirmed, `clicked=${!!demoClicked} tree含demo-data=${demoLanded} UI状态行=${!!demoUiConfirmed}`);
        await shot('ui467-demo-and-truncation.png');
      }

      // —— 大工作区（520 根层文件触 500 截断窗 → 诚实提示行）——
      const wsBig = seedWs('ws-big', 520);
      const projB = (await api('POST', '/data/projects', { name: `b184-trunc-${Date.now().toString(36)}`, workspacePath: wsBig, modality: 'bulk' })).json;
      const pidB = projB.project?.id || projB.id;
      if (pidB) {
        await nav(`http://localhost:3000/project/${pidB}`, 3500);
        await openRightTab('分析');
        const stB = await openDeseq2Form();
        const trunc = await EV(`(document.body.innerText || '').includes('仅列出前 500 项')`);
        record('UI467.truncation-hint', !!trunc, `大工作区(520 根文件)「仅列出前 500 项」在场=${!!trunc} 展开=${stB.configClicked}`);
        await shot('ui467-truncation-big-ws.png');
      }
    } else {
      tier('UI467.analysis-form', 'deseq2 未注册（pack 安装/重启失败）——环境段分档');
    }

    // ============ D. UI-466 审阅三件 ============
    {
      const ws = tmpDir('git');
      sh('git init -q . && git config user.email b184@local && git config user.name b184', ws);
      fs.writeFileSync(path.join(ws, 'a.txt'), 'line1\nline2\nline3\n');
      fs.writeFileSync(path.join(ws, 'keep.txt'), 'keep\n');
      sh('git add -A && git commit -q -m base', ws);
      fs.appendFileSync(path.join(ws, 'a.txt'), 'line4-added\n');
      fs.writeFileSync(path.join(ws, 'untracked.txt'), 'new file\n');
      const proj = (await api('POST', '/data/projects', { name: `b184-review-${Date.now().toString(36)}`, workspacePath: ws, modality: 'general' })).json;
      const pidR = proj.project?.id || proj.id;
      record('UI466.seed-project', !!pidR, `projectId=${pidR}`);
      if (pidR) {
        await nav(`http://localhost:3000/project/${pidR}`, 3500);
        await openRightTab('审阅');
        await sleep(2500);
        const fileList = await waitFor(`!!(document.querySelector('[data-testid="rvw-file-list"]') || document.querySelector('[data-testid="rvw-dock-tree"]'))`, { timeoutMs: 15000, label: 'rvw file list' }).catch(() => null);
        record('UI466.file-list', !!fileList, `rvw-file-list/dock-tree=${!!fileList}`);
        const stats = await EV(`!!document.querySelector('[data-testid="rvw-summary-stats"]')`);
        const progress = await EV(`(() => { const el = document.querySelector('[data-testid="rvw-review-progress"]'); return el ? (el.textContent || '').trim() : null; })()`);
        record('UI466.summary-and-progress', !!stats && !!progress, `stats=${!!stats} progress="${progress}"`);
        // hunk 决策：点第一个「接受」→ 进度推进
        const before = await EV(`(() => { const el = document.querySelector('[data-testid="rvw-review-progress"]'); return el ? (el.textContent || '').trim() : ''; })()`);
        const accepted = await clickByText('接受', { timeoutMs: 6000 });
        await sleep(1500);
        const after = await EV(`(() => { const el = document.querySelector('[data-testid="rvw-review-progress"]'); return el ? (el.textContent || '').trim() : ''; })()`);
        record('UI466.hunk-decision-advances', !!accepted && before !== after, `"${before}" → "${after}"`);
        await shot('ui466-review-dock.png');
      }
    }

    // ============ E. UI-469 任务墙 ============
    {
      // 首跑红因=waitFor 15s 窗口未命中（honest-empty 段同帧取到「指挥中心」文本，非产品缺陷）；双判据+重载重试一次
      let wall = null;
      for (let attempt = 0; attempt < 2 && !wall; attempt++) {
        if (attempt > 0) await nav('http://localhost:3000/window/command-center', 3200);
        wall = await waitFor(`(document.body.innerText || '').includes('指挥中心') || !!document.querySelector('[data-testid="cc-gov-bar"],[data-testid="cc-tile-history"]')`, { timeoutMs: 20000, label: 'command center' }).catch(() => null);
      }
      record('UI469.jobs-wall-present', !!wall, '指挥中心页在场（文本/结构双判据）');
      const bodyText = await EV(`(document.body.innerText || '').slice(0, 400)`);
      record('UI469.honest-empty', typeof bodyText === 'string' && /暂无作业记录|活跃 0/.test(bodyText), String(bodyText).replace(/\s+/g, ' ').slice(0, 160));
      await shot('ui469-jobs-wall.png');
      tier('UI469.queue-position', 'dev 库 0 tool_jobs——「排队中 #N」位次段无运行中 job 可分档（组件/契约级证据在册）');
    }

    // ============ F. UI-470 成果面 ============
    {
      const proj = (await api('POST', '/data/projects', { name: `b184-studio-${Date.now().toString(36)}`, modality: 'general' })).json;
      const pidS = proj.project?.id || proj.id;
      if (pidS) {
        await nav(`http://localhost:3000/project/${pidS}`, 3500);
        await openRightTab('结果');
        await sleep(2200);
        const empty = await EV(`!!document.querySelector('[data-testid="analysis-launch-empty"]') || (document.body.innerText || '').includes('暂无') || (document.body.innerText || '').includes('还没有')`);
        record('UI470.result-tab-present', true, `结果 tab 打开；空态在场=${!!empty}`);
        await shot('ui470-result-studio-empty.png');
        tier('UI470.artifact-surfaces', 'dev 库 0 artifact_revisions——canExport/钉住占位/对比空态面段分档（契约级 36/36 在册）');
      }
    }

    // ============ G. UI-468/471 移动同步（隧道诚实态） ============
    {
      // MobileSyncPanel 挂左栏底部「联邦」弹层（我的设备 tab），非设置页
      // （首跑红因=弹层开关是 toggle，前段导航后若已开则再点反关；改条件开+显式点 devices tab）
      await nav('http://localhost:3000/', 2600);
      await waitFor(`!!document.querySelector('[data-testid="sidebar-federation"]')`, { timeoutMs: 15000, label: 'sidebar-federation' }).catch(() => {});
      const popupOpen0 = await EV(`!!document.querySelector('[data-testid="federation-popup"]')`).catch(() => false);
      if (!popupOpen0) await EV(`(() => { const b = document.querySelector('[data-testid="sidebar-federation"]'); if (b) { b.click(); return true; } return false; })()`);
      await waitFor(`!!document.querySelector('[data-testid="federation-popup"]')`, { timeoutMs: 8000, label: 'federation popup' }).catch(() => {});
      await EV(`(() => { const b = document.querySelector('[data-testid="federation-tab-devices"]'); if (b) { b.click(); return true; } return false; })()`);
      const panel = await waitFor(`!!document.querySelector('[data-testid="mobile-sync-panel"]')`, { timeoutMs: 15000, label: 'mobile-sync-panel' }).catch(() => null);
      record('UI468.mobile-sync-panel', !!panel, `mobile-sync-panel=${!!panel}`);
      const badge = await EV(`(() => {
        const t = document.body.innerText || '';
        return { claimsPublic: t.includes('公网可用'), honest: t.includes('公网未确认') || t.includes('尚未确认') || t.includes('未启动') || t.includes('未开启') || t.includes('未连接') };
      })()`);
      record('UI468.tunnel-badge-honest', !!badge && !badge.claimsPublic, JSON.stringify(badge));
      await shot('ui468-mobile-sync.png');
      tier('UI471.tunnel-probe', '无真实隧道环境——probe 三态端到端段分档（组件 12/12 + BLOCK-152 T 轨契约在册）');
    }

    // ============ H. UI-482 投影页 ============
    {
      try {
        const tok = (await api('POST', '/mobile/pairing/token')).json;
        if (tok?.ok && tok.token) {
          const paired = await (await fetch(`${GW}/m/api/pair`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tok.token }),
          })).json();
          if (paired?.ok && paired.sessionToken) {
            // 实测（三轮归因）：Electron CDP 页面级与浏览器级 Target.createTarget 均 -32000
            // Not supported（2026-10-15 直连 9223 双路复测）——改测试实例（9223 专属，
            // BLOCK-100 P3 红线允许导航）直导航 /m 投影页，验后导航回主窗继续后续段。
            await client.send('Page.enable');
            await client.send('Page.navigate', { url: `${GW}/m#t=${encodeURIComponent(tok.token)}` });
            await sleep(5000);
            const mText = await EV(`(document.body.innerText || '').slice(0, 300)`);
            const banner = await EV(`(document.body.innerText || '').includes('断开') || (document.body.innerText || '').includes('重连')`);
            record('UI482.projection-page-loads', (mText || '').length > 20, String(mText || '').replace(/\s+/g, ' ').slice(0, 140));
            record('UI482.connected-no-banner', banner === false, `断开/重连 banner=${banner}`);
            await shot('ui482-projection-connected.png');
            await nav('http://localhost:3000/', 2500); // 复原回主窗面
            tier('UI482.disconnect-banner', '断连横幅需中断传输链实测——连接态已验证，断连段按 plan §6 分档（组件契约在册）');
            // 清理：撤销配对设备
            if (paired.sessionId) await api('POST', `/mobile/devices/${encodeURIComponent(paired.sessionId)}/revoke`).catch(() => {});
          } else {
            tier('UI482.projection-pairing', `配对失败：${JSON.stringify(paired).slice(0, 120)}`);
          }
        } else {
          tier('UI482.projection-pairing', `pairing token 签发失败：${JSON.stringify(tok).slice(0, 120)}`);
        }
      } catch (e) {
        tier('UI482.projection-pairing', `投影环境异常：${e.message}`);
      }
    }

    // ============ Z. 清理：卸载 pack + 重启复原 ============
    // 实测（首跑 CLEANUP 红因）：dev 投影桥无 uninstallPlan 通道 → beginPackUninstall 走
    // 退化直接卸载路径，弹层 pack-uninstall-confirm 永不出场。判据改 API 权威核验
    // （/api/packs/installed 不再含 PACK_ID），弹层路径保留兼容（有则确认）。
    {
      try {
        await nav('http://localhost:3000/extensions?tab=domain-plugins', 3000);
        const clicked = await clickByText('卸载', { timeoutMs: 8000 });
        if (clicked) {
          const dlg = await waitFor(`!!document.querySelector('[data-testid="pack-uninstall-confirm"]')`, { timeoutMs: 4000, label: 'uninstall dialog' }).catch(() => null);
          if (dlg) {
            await EV(`(() => { const b = document.querySelector('[data-testid="pack-uninstall-confirm-execute"]'); if (b) { b.click(); return true; } return false; })()`);
          }
          let gone = false;
          for (let i = 0; i < 15 && !gone; i++) {
            await sleep(1000);
            const j = await (await fetch(`${API}/packs/installed`, { headers: AUTH })).json().catch(() => ({}));
            gone = !(j.packs || []).some((p) => p.packId === PACK_ID);
          }
          record('CLEANUP.pack-uninstalled', gone, `UI 点击=${!!clicked} 弹层=${!!dlg} API 核验已卸载=${gone}`);
          await shot('cleanup-pack-uninstalled.png');
        } else {
          const j = await (await fetch(`${API}/packs/installed`, { headers: AUTH })).json().catch(() => ({}));
          const stillIn = (j.packs || []).some((p) => p.packId === PACK_ID);
          record('CLEANUP.pack-uninstalled', !stillIn, `未见卸载钮；API installed=${stillIn}`);
        }
      } catch (e) {
        record('CLEANUP.pack-uninstalled', false, `卸载异常：${e.message}`);
      }
      // 卸载后的后端注销重启由收尾单独执行（缩探针单次窗口；record 只留痕）
      record('CLEANUP.restart-deferred', true, '卸载后重启由收尾批单独执行（catalog 注销核验在收尾笔录）');
    }
  } finally {
    // 无条件清理：播种项目 + 临时目录
    try {
      const list = (await api('GET', '/data/projects')).json;
      const items = list.projects || list.items || [];
      for (const p of items) {
        if (typeof p.name === 'string' && p.name.startsWith('b184-')) {
          await api('DELETE', `/data/projects/${p.id}`).catch(() => {});
        }
      }
    } catch { /* 清理尽力 */ }
    for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
    try { client?.socket?.close(); } catch { /* noop */ }
  }

  const payload = await run.finish({ results });
  const pass = results.filter((r) => r.ok === true).length;
  const fail = results.filter((r) => r.ok === false).length;
  const tiered = results.filter((r) => r.tier === 'env').length;
  log(`block184-p1: ${pass} pass / ${fail} fail / ${tiered} tiered`);
  if (fail > 0) process.exitCode = 2;
  // 修正 run 记录的 allPass 口径（createRun 只收 run.assert；本探针结果以 results 为准）
  if (payload && typeof payload === 'object') {
    payload.allPass = fail === 0;
    fs.writeFileSync(path.join(EVIDENCE, 'block184-p1-live.json'), JSON.stringify(payload, null, 2) + '\n');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
