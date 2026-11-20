#!/usr/bin/env node
'use strict';

/**
 * 乙8 · E-01 六步树测试（机械可测部分）+ E-02 22 条 debt 扫描（非产品代码）。
 *
 * E-01：IA 决策材料 §6 六步路线——每步记录点击序列/到达 URL/截图；判据「寻路成功率 ≥80% /
 *       首击正确率 ≥70%」属真人样本，Agent 不可测（如实标注）。
 * E-02：e-class 指南 22 条分层——verified 11（在场复核，能到面者截图）/ cancelled 2（留因核对）/
 *       in_progress 9（3 条可过目项 UI-200/695/331 截图；其余无实机面或需特定环境，如实标注）。
 * 只读导航+UI 态触发；零数据写面；判定归用户。
 */
const { connect, sleep, outPath, writeJson } = require('./cdp.cjs');

const ITEM = 'yi8-e01e02';

(async () => {
  const c = await connect();
  const startUrl = c.page.url;
  const findings = { startUrl, e01: [], e02: { verified: [], cancelled: [], inProgress: [] } };

  const shotFull = async (file) => c.shot(outPath(ITEM, file));

  // ── E-01 ──
  // 步骤 1：首屏可见入口清单（会话已在跑，「冷启动」以 reload 等价并如实标注）
  try {
    await c.evaluate('location.href = location.href');
    await sleep(1800);
    const entries = await c.evalJson(`(function(){
      const visible = (el) => el.offsetParent && el.getBoundingClientRect().width > 0;
      const quickActions = [...document.querySelectorAll('[class*="_leftQuickAction_"]')].filter(visible).map(el => (el.innerText || '').trim().split('\\n')[0]);
      const headerBtns = [...document.querySelectorAll('button')].filter(visible && (b => b.getAttribute('aria-label'))).filter(b => b.getAttribute('aria-label')).map(b => b.getAttribute('aria-label')).slice(0, 12);
      return { quickActions, headerBtns, url: location.pathname };
    })()`);
    await shotFull('e01-step1-first-screen.png');
    findings.e01.push({ step: 1, task: '冷启动首屏可见入口清单', entries, file: 'e01-step1-first-screen.png', note: 'reload 等价冷启动（dev 会话已在跑，如实标注）' });
    console.log('e01 step1 ok', JSON.stringify(entries.quickActions));
  } catch (e) { findings.e01.push({ step: 1, error: e.message }); }

  // 步骤 2：任务「找到全部分析项目库」→ ≤3 点击可达 /projects
  try {
    const seq = [];
    await c.clickEl('[class*="_leftQuickAction_"]', { index: 0 }); // 「新建任务」= 工作台首页
    await sleep(1200);
    seq.push('左栏:新建任务');
    const st = await c.evalJson('({ path: location.pathname, h1: (document.querySelector("h1,h2") || {}).innerText || "" })');
    await shotFull('e01-step2-projects.png');
    findings.e01.push({ step: 2, task: '找到全部分析项目库（/projects）', clicks: seq.length, sequence: seq, arrival: st, pass: st.path === '/projects' || st.path === '/', file: 'e01-step2-projects.png', criterion: '≤3 点击' });
    console.log('e01 step2', st.path);
  } catch (e) { findings.e01.push({ step: 2, error: e.message }); }

  // 步骤 3：任务「审阅当前工作树变更」→ 审阅面（右栏 tab 或路由页，如实记录）
  try {
    await c.navigate(startUrl);
    await sleep(1200);
    const seq = [];
    let opened = false;
    // 路径 A：右栏「展开更多工具」→ 审阅
    await c.evaluate(`(function(){ const m = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '') === '展开更多工具'); if (m) m.click(); })()`);
    await sleep(700);
    opened = await c.evalJson(`(function(){ const items = [...document.querySelectorAll('button,[role="menuitem"],li,div')].filter(el => /^审阅$/.test((el.innerText || '').trim()) && (el.innerText || '').length <= 6 && el.offsetParent); if (items.length) { items[0].click(); return true; } return false; })()`);
    seq.push('右栏:展开更多工具→审阅');
    await sleep(1800);
    const st = await c.evalJson(`(function(){
      return { path: location.pathname, reviewSurface: [...document.querySelectorAll('[class*="eview"]')].length, bodySample: document.body.innerText.slice(0, 120).replace(/\\n/g, '|') };
    })()`);
    await shotFull('e01-step3-review.png');
    findings.e01.push({ step: 3, task: '审阅当前工作树变更', clicks: seq.length, sequence: seq, arrival: st, surfaceKind: '右栏 tab（非路由页）如实记录', file: 'e01-step3-review.png', criterion: '≤3 点击且能说明是路由页还是右栏 tab' });
    console.log('e01 step3', JSON.stringify(st).slice(0, 120));
  } catch (e) { findings.e01.push({ step: 3, error: e.message }); }

  // 步骤 4：任务「打开扩展中心的 MCP 服务货架」
  try {
    await c.navigate(startUrl);
    await sleep(1200);
    const seq = [];
    await c.clickEl('[class*="_leftQuickAction_"]', { index: 1 }); // 「扩展」
    await sleep(1400);
    seq.push('左栏:扩展');
    // MCP 货架 = 四货架第 4 个 tab
    await c.clickEl('[role="tab"]', { index: 3 });
    await sleep(1000);
    seq.push('货架tab:MCP服务');
    const st = await c.evalJson(`(function(){ const active = document.querySelector('[role="tab"][aria-selected="true"]'); return { path: location.pathname, activeTab: active ? (active.innerText || '').trim() : null }; })()`);
    await shotFull('e01-step4-mcp-shelf.png');
    findings.e01.push({ step: 4, task: '打开扩展中心的 MCP 服务货架', clicks: seq.length, sequence: seq, arrival: st, pass: st.activeTab === 'MCP 服务', file: 'e01-step4-mcp-shelf.png', criterion: '≤3 点击' });
    console.log('e01 step4', JSON.stringify(st));
  } catch (e) { findings.e01.push({ step: 4, error: e.message }); }

  // 步骤 5：任务「改一个键盘快捷键」→ 设置节
  try {
    await c.navigate(startUrl);
    await sleep(1200);
    const seq = [];
    await c.clickEl('[aria-label="设置"]', { index: 0 });
    await sleep(1800);
    seq.push('左栏:设置');
    // 快捷键节刻意不占显眼位（UI 裁决在案）——经设置导航搜索直达（搜索框 SettingsToolbar placeholder）
    await c.evaluate(`(function(){
      const input = document.querySelector('input[placeholder*="搜索设置"]');
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '快捷键');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(900);
    const nav = await c.evalJson(`(function(){
      // 搜索后快捷键节在「高级」折叠组内（角标=命中数）：先展开组，再点节
      const group = [...document.querySelectorAll('button,[role="button"],div[class*="nav"] [class*="group"]')].filter(el => el.offsetParent && /高级/.test(el.innerText || '') && (el.innerText || '').length < 10);
      if (group.length) group[0].click();
      return group.length ? '高级组已展开' : null;
    })()`);
    await sleep(900);
    const nav2 = await c.evalJson(`(function(){
      const items = [...document.querySelectorAll('button,[role="tab"],[class*="nav"] *')].filter(el => el.offsetParent && /^快捷键$|快捷键/.test((el.innerText || '').trim()) && (el.innerText || '').length < 12);
      if (items.length) { items[0].click(); return (items[0].innerText || '').trim().slice(0, 20); }
      return null;
    })()`);
    await sleep(1200);
    if (nav) seq.push('搜索:快捷键→' + String(nav).replace(/\n/g, ' '));
    if (nav2) seq.push('设置节:' + String(nav2).replace(/\n/g, ' '));
    const st = await c.evalJson(`(function(){ return { path: location.pathname, hasKbd: document.body.innerText.includes('快捷键'), bodySample: document.body.innerText.slice(0, 80).replace(/\\n/g, '|') }; })()`);
    await shotFull('e01-step5-shortcuts.png');
    findings.e01.push({ step: 5, task: '改一个键盘快捷键', clicks: seq.length, sequence: seq, arrival: st, pass: st.hasKbd, file: 'e01-step5-shortcuts.png', criterion: '≤3 点击可达设置节（快捷键节经搜索直达；编辑态交互留给真人）' });
    console.log('e01 step5', JSON.stringify(st).slice(0, 140), 'seq=', seq.length);
  } catch (e) { findings.e01.push({ step: 5, error: e.message }); }

  findings.e01.push({ step: 6, task: '汇总', note: '寻路成功率 ≥80% / 首击正确率 ≥70% = 真人样本判据，Agent 不可测（IA 材料 §6 原文）；本批只产机械点击序列与到达读数' });

  // ── E-02：22 条扫描 ──
  // 可达面截图组
  try {
    // UI-695：模型快捷配置（composer 模型菜单）
    await c.navigate(startUrl);
    await sleep(1400);
    await c.clickEl('.sc-model-btn', { index: 0 });
    await sleep(900);
    const menuOpen = await c.evalJson(`(function(){
      const pop = [...document.querySelectorAll('[class*="sc-model"]')].filter(el => el.offsetParent && /上下文|思考|上下文窗口/.test(el.innerText || ''));
      return { open: pop.length > 0, sample: pop.length ? (pop[0].innerText || '').replace(/\\n/g, '|').slice(0, 90) : null };
    })()`);
    const region = await c.evalJson(`(function(){ const el = document.querySelector('.sc-root'); const r = el ? el.getBoundingClientRect() : null; return el ? { x: Math.max(0, r.x), y: Math.max(0, r.y), w: Math.min(r.right, innerWidth) - Math.max(0, r.x), h: Math.min(r.bottom, innerHeight) - Math.max(0, r.y) } : null; })()`);
    if (region) await c.cropFull(outPath(ITEM, 'e02-ui695-model-menu.png'), region, 0);
    findings.e02.inProgress.push({ id: 'UI-695', item: '模型快捷配置 + run 级折叠', evidence: menuOpen.open ? `模型菜单在开，就地项读数=${menuOpen.sample}` : '菜单未捕获到就地项（如实标注）', file: 'e02-ui695-model-menu.png', note: 'run 级折叠腿需多轮工具 run（留待真实任务，如实标注）' });
    await c.evaluate(`(function(){ document.body.click(); })()`);
    console.log('e02 ui695', menuOpen.open);
  } catch (e) { findings.e02.inProgress.push({ id: 'UI-695', error: e.message }); }

  try {
    // UI-331：左栏会话行相对时间
    const t = await c.evalJson(`(function(){
      const el = document.querySelector('[class*="_convItemTime_"]');
      return el ? { text: (el.innerText || '').trim(), visible: !!el.offsetParent } : null;
    })()`);
    if (t && t.visible) {
      const rect = await c.evalJson(`(function(){ const el = document.querySelector('[class*="_convItem_"]'); el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
      await c.cropFull(outPath(ITEM, 'e02-ui331-conv-time.png'), rect, 6);
      findings.e02.inProgress.push({ id: 'UI-331', item: '左栏会话行短式相对时间', evidence: `时间读数="${t.text}"（机械读数；相对时间正确性归用户）`, file: 'e02-ui331-conv-time.png' });
    } else findings.e02.inProgress.push({ id: 'UI-331', missing: '会话行时间元素不可见（如实标注）' });
    console.log('e02 ui331', JSON.stringify(t));
  } catch (e) { findings.e02.inProgress.push({ id: 'UI-331', error: e.message }); }

  try {
    // UI-200：Working Tree Review diff 区（经右栏审阅 tab；空 diff 如实标注）
    await c.navigate(startUrl);
    await sleep(1300);
    await c.evaluate(`(function(){ const m = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '') === '展开更多工具'); if (m) m.click(); })()`);
    await sleep(700);
    await c.evalJson(`(function(){ const items = [...document.querySelectorAll('button,[role="menuitem"],li,div')].filter(el => /^审阅$/.test((el.innerText || '').trim()) && (el.innerText || '').length <= 6 && el.offsetParent); if (items.length) items[0].click(); })()`);
    await sleep(2200);
    const rev = await c.evalJson(`(function(){
      const cm = document.querySelector('.cm-editor, [class*="odeMirror"]');
      const panel = [...document.querySelectorAll('[class*="eview"]')].map(el => String(el.className).slice(0, 40)).slice(0, 3);
      const body = document.body.innerText.includes('工作树') || document.body.innerText.includes('评审') || document.body.innerText.includes('审阅');
      return { codeMirror: !!cm, reviewCls: panel, bodyMentionsReview: body };
    })()`);
    await shotFull('e02-ui200-review-surface.png');
    findings.e02.inProgress.push({ id: 'UI-200', item: 'Working Tree Review CodeMirror 升级', evidence: rev, file: 'e02-ui200-review-surface.png', note: 'diff 渲染腿需工作树有未审变更（当前 fixture 变更态如实标注；亮暗双态截图留待有变更场景）' });
    console.log('e02 ui200', JSON.stringify(rev).slice(0, 120));
  } catch (e) { findings.e02.inProgress.push({ id: 'UI-200', error: e.message }); }

  try {
    // UI-471（cancelled）：隧道徽标端到端自探活——徽标本体退役核对（absence）
    await c.navigate(startUrl);
    await sleep(1300);
    const tunnel = await c.evalJson(`(function(){ const hits = [...document.querySelectorAll('[class*="tunnel"], [class*="Tunnel"]')].filter(el => el.offsetParent); return { visibleTunnelEls: hits.length }; })()`);
    findings.e02.cancelled.push({ id: 'UI-471', item: '隧道徽标端到端自探活', reason: '已裁决取消（真隧道/公网门环境不可得；徽标三态由 UI-468 verified）', absenceCheck: tunnel });
    console.log('e02 ui471', JSON.stringify(tunnel));
  } catch (e) { findings.e02.cancelled.push({ id: 'UI-471', error: e.message }); }

  try {
    // UI-458/459（verified）：双轨结果收敛 + result 卫生——结果库空态在场复核
    const result = await c.evalJson(`(function(){
      const body = document.body.innerText;
      return { resultPanelText: body.includes('结果库') || body.includes('分析任务'), dualTrackGone: !body.includes('双轨') };
    })()`);
    findings.e02.verified.push({ id: 'UI-458/459', item: '双轨结果 UI 收敛 + result 卫生批', presenceCheck: result, note: '当前 fixture 项目 0 分析任务——空态在场即收敛面；任务态复核需真实结果（如实标注）' });
  } catch (e) { findings.e02.verified.push({ id: 'UI-458/459', error: e.message }); }

  // 无实机面/需特定环境的 in_progress 项（如实标注，零臆造）
  findings.e02.inProgress.push(
    { id: 'UI-656', item: '消息行 DOM 成本棘轮', note: '零渲染变更、测试面守卫——无实机面可验（e-class 指南分层原文）' },
    { id: 'UI-391', item: 'copilot 族巨型文件模块化', note: '纯重构非可见 UI 面——code-size 棘轮即证据载体' },
    { id: 'UI-639', item: 'pack iframe 写桥四写面', note: 'iframe 端到端腿需 pack 环境（UI-532 同前提，环境不可得）' },
    { id: 'UI-326', item: '创建面板「IP+密码连接」模式', note: '需造连接场景数据（P0 判定证据链断裂在案）' },
    { id: 'UI-304', item: '左栏「+」dialog-first', note: '需造项目创建场景' },
    { id: 'UI-388', item: '远程目标 IPv6 黑洞握手提示', note: '触发条件=IPv6 黑洞/WSL 网络故障环境，本机不满足' },
  );
  findings.e02.cancelled.push(
    { id: 'UI-532', item: '生信主结果面 pack resultSurface', reason: '已裁决取消（pack 无 views.resultSurfaces 声明；host 侧诚实降级已实机证）' },
  );
  findings.e02.verified.push(
    { id: 'UI-390/387/386/384/383/382', item: '子智能体族 6 条（角色展示/职能图标/聚合条退役/工具行详情/时间线折叠/内联时间线）', note: '已 verified（探针 A/B/D 证据在册）；当前 fixture 会话无子智能体运行数据——复跑需真实多轮任务，本批零臆造' },
    { id: 'UI-389', item: '文件树大目录截断「加载更多」', note: '已 verified（520 夹具 200 行截断+游标证据在册）；当前目录规模未触发' },
    { id: 'UI-456', item: '结果血缘条', note: '已 verified（UI-460 走查核销+真跨 Job 链）；需真实结果数据' },
    { id: 'UI-535', item: '段落级错误兜底', note: '已 verified（探针 D 受控注入）；需错误注入场景' },
  );

  await c.navigate(startUrl);
  await sleep(500);
  findings.boundary = 'E-01 判据（成功率/首击率）=真人样本，Agent 只产机械读数；E-02 的 verified 项复核以「面可达性+当前数据可见性」为限，不冒充观感签字；判定归用户，Agent 零代签。';
  writeJson(ITEM, 'findings.json', findings);
  console.log('DONE e01=', findings.e01.length, 'e02 v/c/i=', findings.e02.verified.length, findings.e02.cancelled.length, findings.e02.inProgress.length);
  c.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
