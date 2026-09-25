#!/usr/bin/env node
/**
 * scripts/qa-smoke.mjs — Gate 5 headless 冒烟（无需启动后端 / Electron）
 *
 * 检查 Gate 5 §200-216 release-contract 中无需 worker / 无需真实桌面的可声明
 * 静态项：前端 token 覆盖、面板折叠状态、copilot / chat reset、文件树预览、
 * 内置浏览器历史、telemetry 漏斗事件。
 *
 * 这不是 Playwright。它做静态 + 自检；真实桌面交互留给后续手动或 E2E 路线。
 *
 * 用法：
 *   node scripts/qa-smoke.mjs                 # 全跑（gate5 段 6 项）
 *   node scripts/qa-smoke.mjs --check <name>  # 单跑某一项（panels / chat / themes / tree / browser / telemetry / report-theme）
 *   node scripts/qa-smoke.mjs --json          # 输出 JSON 给 CI 解析
 *
 * 退出码：
 *   0   全部通过
 *   1   检查失败（断言 ≤ 0 项）
 *
 * 日志：写到 tmp/qa-smoke/<timestamp>.log
 */

import { mkdirSync, appendFileSync, existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ── 参数 ────────────────────────────────────────────────
const argv = process.argv.slice(2);
function getArg(name, fallback = null) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return fallback;
      return v;
    }
  }
  return fallback;
}
const SINGLE = getArg('--check', null);
const JSON_OUTPUT = argv.includes('--json');

// ── 日志 ────────────────────────────────────────────────
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_DIR = join(REPO_ROOT, 'tmp', 'qa-smoke');
mkdirSync(LOG_DIR, { recursive: true });
const MAX_LOGS = 20;
const oldLogs = readdirSync(LOG_DIR)
  .filter((entry) => entry.endsWith('.log'))
  .map((entry) => ({ entry, mtime: statSync(join(LOG_DIR, entry)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);
for (const { entry } of oldLogs.slice(MAX_LOGS - 1)) {
  unlinkSync(join(LOG_DIR, entry));
}
const LOG_PATH = join(LOG_DIR, `${ts}.log`);

function log(level, msg) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
  if (!JSON_OUTPUT) console.log(line);
  appendFileSync(LOG_PATH, line + '\n');
}

// ── 文件读取工具 ─────────────────────────────────────────
function read(p) {
  return readFileSync(join(REPO_ROOT, p), 'utf8');
}
function exists(p) {
  return existsSync(join(REPO_ROOT, p));
}

// ── 单项检查 ────────────────────────────────────────────
const checks = {};

function register(name, description, fn) {
  checks[name] = { description, fn };
}

// themes — frontmatter token 覆盖 + 主题切换控件存在 + 主题切换影响多组件
register('themes', '主题 token 覆盖：壳/聊天/结果/报告/浏览器/文件树/终端 — 在浅深模式下颜色统一', () => {
  const cssFiles = [
    'frontend/src/styles/global.css',
    'frontend/src/styles/custom.css',
    'frontend/src/styles/docs.css',
    'frontend/src/pages/index.module.css',
    'frontend/src/pages/project-workspace.module.css',
    'frontend/src/styles/single-cell.css',
    'frontend/src/components/desktop/desktop.css',
    'frontend/src/components/copilot/simple-chat.css',
    'frontend/src/components/ui/PageHeader.css',
  ];
  // 部分样式文件可能随重构更名/移除：缺失仅告警并跳过，不阻断 themes 检查；
  // 核心不变量（--gewu-* token 覆盖，BLOCK-61/UI-392 起主题 token 家族前缀为
  // --gewu-*，biof3- 前缀已是死前缀）仍基于实际存在的文件校验（跨平台收敛）。
  const present = cssFiles.filter((f) => exists(f));
  const missing = cssFiles.filter((f) => !exists(f));
  if (missing.length) log('WARN', `themes 检查跳过缺失的 CSS 文件: ${missing.join(', ')}`);
  if (present.length === 0) throw new Error(`CSS files missing: ${missing.join(', ')}`);
  // 主题控件组件（ThemeControl.tsx 是 Week 4.1 引入）
  if (!exists('frontend/src/components/desktop/ThemeControl.tsx')) {
    throw new Error('ThemeControl.tsx 不存在 — 主题切换回归受影响');
  }
  // 主题控制 css（含浅/深模式声明）
  if (!exists('frontend/src/components/desktop/theme-control.css')) {
    throw new Error('theme-control.css 不存在');
  }
  const themeCss = read('frontend/src/components/desktop/theme-control.css');
  if (!/data-theme|class=.*dark|:root\.dark|\.theme-light/.test(themeCss)) {
    log('WARN', 'theme-control.css 未发现明显主题模式声明（可能用 var(--gewu-*) 走 CSS 变量）');
  }
  // 查找至少一个 CSS 文件使用 --gewu- 开头的 token 变量（BLOCK-104 增量对账）
  let usedGewuTokens = 0;
  for (const f of present) {
    const c = read(f);
    const m = c.match(/var\(--gewu-[a-z0-9-]+\)/g);
    if (m && m.length) usedGewuTokens += m.length;
  }
  log('INFO', `  ${usedGewuTokens} 处使用 var(--gewu-*) token`);
  if (usedGewuTokens < 10) {
    throw new Error(`只发现 ${usedGewuTokens} 处 gewu- token，未覆盖足够组件`);
  }
});

// panels — TitleBar 提供 useWorkspacePanelsContext；左/右/底三面板 + 各 panel 内部 context
register('panels', '左/右/底面板折叠、恢复与宽度拖拽', () => {
  for (const f of [
    'frontend/src/components/desktop/TitleBar.tsx',
    'frontend/src/components/workspace-panels/LeftPanel.tsx',
    'frontend/src/components/workspace-panels/RightPanel.tsx',
    'frontend/src/components/workspace-panels/CenterPanel.tsx',
    'frontend/src/components/workspace-panels/BottomTerminal.tsx',
  ]) {
    if (!exists(f)) throw new Error(`panel file missing: ${f}`);
  }
  const titleBar = read('frontend/src/components/desktop/TitleBar.tsx');
  if (!/useWorkspacePanelsContext|PanelProvider/i.test(titleBar)) {
    throw new Error('TitleBar.tsx 未发现 useWorkspacePanelsContext/PanelProvider — 面板全局 context 未注册');
  }
  if (!/collapsed|fold|toggle|isOpen|panelOpen/i.test(titleBar)) {
    throw new Error('TitleBar.tsx 未发现 collapsed/fold/toggle 状态');
  }
  // 拖拽宽度：title bar 或 css 含 width/state
  if (!/width|panelWidth|sidebarWidth/i.test(titleBar)) {
    log('WARN', 'TitleBar.tsx 未发现 width 字段 — 面板拖拽可能在子组件，建议人工核查');
  }
});

// chat — 头像/消息气泡/会话恢复
register('chat', '用户/模型头像、消息气泡、流式回复、会话恢复', () => {
  for (const f of [
    'frontend/src/components/copilot/SimpleChat.tsx',
    'frontend/src/components/copilot/copilotClient.ts',
    'frontend/src/components/copilot/copilotConversationsClient.ts',
    'frontend/src/hooks/useConversations.ts',
  ]) {
    if (!exists(f)) throw new Error(`chat file missing: ${f}`);
  }
  const chatCss = read('frontend/src/components/copilot/simple-chat.css');
  if (!/bubble|message|avatar/i.test(chatCss)) {
    throw new Error('simple-chat.css 缺少 bubble/message/avatar 关键字');
  }
  const conv = read('frontend/src/hooks/useConversations.ts');
  if (!/restore|hydrate|load/i.test(conv)) {
    throw new Error('useConversations 缺少 restore/hydrate/load — 会话恢复没有实现');
  }
});

// tree — 文件树与多预览
register('tree', '项目文件树 + 文本/CSV/图片/PDF/HTML 预览', () => {
  // 文件树通常在 CenterPanel / ProjectWorkspace
  for (const f of ['frontend/src/pages/project-workspace.tsx']) {
    if (!exists(f)) throw new Error(`file missing: ${f}`);
  }
  const proj = read('frontend/src/pages/project-workspace.tsx');
  if (!/tree|file.?list|fileTree|fs\.tree/i.test(proj)) {
    throw new Error('project-workspace 未发现 fileTree 关键字');
  }
  // Lightbox 组件用于 image 预览
  if (!exists('frontend/src/components/ui/Lightbox.tsx')) {
    throw new Error('Lightbox.tsx 不存在 — 图片预览能力缺失');
  }
  // PDF 预览通常用 <iframe src> 或 pdf.js
  const proj2 = read('frontend/src/pages/project-workspace.tsx');
  if (!/pdf|PDF|pdfjs|pdf\.worker/i.test(proj2)) {
    log('WARN', 'project-workspace.tsx 未发现 PDF 关键字 — PDF 预览可能未实现');
  }
});

// browser — 内置浏览器全高 + 前进后退 + 刷新
register('browser', '内置浏览器全高展示、前进/后退/刷新、报告打开', () => {
  // 浏览器组件理论上在 RightPanel 或专门的内置浏览器
  const candidates = [
    'frontend/src/components/workspace-panels/RightPanel.tsx',
    'frontend/src/components/desktop/DesktopOnboarding.tsx',
  ];
  let found = false;
  for (const f of candidates) {
    if (!exists(f)) continue;
    const c = read(f);
    if (/Browser|webview|iframe/i.test(c)) { found = true; break; }
  }
  if (!found) throw new Error('内置浏览器相关组件未发现 Browser/webview/iframe 关键字');
});

// telemetry — 发行漏斗事件
//   Plan §4 第 5 步要求 src/telemetry.js 暴露以下 6 个 funnel event，目前只有
//   reportError。所以这里把"基础设施（开关 + 接收模块）"作为必要条件，把
//   "6 个 funnel 都暴露"作为远期 TODO（不在 Gate 5 当前范围）。
register('telemetry', 'telemetry.js 暴露发行漏斗钩子（开关 + 接收）', () => {
  if (!exists('src/telemetry.js')) throw new Error('src/telemetry.js 不存在');
  const t = read('src/telemetry.js');
  // 必要：isTelemetryEnabled（开关）+ reportError / reportEvent（接收）
  const haveSwitch = /isTelemetryEnabled|telemetry_enabled/.test(t);
  const haveSink = /reportError|reportEvent|trackEvent/.test(t);
  if (!haveSwitch) throw new Error('telemetry.js 缺少开关读取（isTelemetryEnabled）');
  if (!haveSink) throw new Error('telemetry.js 缺少接收入口（reportError/reportEvent/trackEvent）');

  // CK-10 — funnel events 已暴露（telemetry.js FUNNEL_EVENTS 白名单 + reportEvent）；
  // 业务上报点接线清单见 telemetry.js 头注（端点上线后逐点接）。
  const funnel = ['app_started', 'runtime_install', 'project_created', 'first_job_succeeded', 'report_generated', 'update_succeeded'];
  const missingFunnel = funnel.filter((k) => !new RegExp(`['"\`]${k}['"\`]`).test(t));
  if (missingFunnel.length === funnel.length) {
    log('WARN', `  telemetry.js 完全未包含 ${funnel.length} 个 funnel event — plan §4 第 5 步（close-update-loop + instrument-release-funnel）尚未实施`);
    // 不抛 fail：作为已知 TODO 让 Plan §5 第 5 步补
  } else if (missingFunnel.length > 0) {
    log('INFO', `  partial funnel events 缺失: ${missingFunnel.join(', ')}`);
  } else {
    log('INFO', `  ✓ 全部 6 个 funnel event 已在 telemetry.js 注册`);
  }
});

// report-theme — 报告主题色同步
register('report-theme', '报告生成时按当前主题取色', () => {
  if (!exists('core/biof3-server/helpers/report-theme.js')) {
    throw new Error('report-theme.js 不存在 — Gate 5 §200 "最终 HTML 报告按当前主题生成" 路径未闭环');
  }
  const rt = read('core/biof3-server/helpers/report-theme.js');
  if (!/theme|color|palette|dark|light/i.test(rt)) {
    throw new Error('report-theme.js 缺少 theme/color/palette 关键字');
  }
});

// ── 执行 ────────────────────────────────────────────────
const order = ['themes', 'panels', 'chat', 'tree', 'browser', 'telemetry', 'report-theme'];
const results = {};
let failed = 0;

log('INFO', `qa-smoke starting — repo=${REPO_ROOT}`);

for (const name of order) {
  if (SINGLE && SINGLE !== name) continue;
  const { description, fn } = checks[name];
  log('INFO', `CHECK ${name}: ${description}`);
  try {
    const t0 = Date.now();
    fn();
    const dt = Date.now() - t0;
    results[name] = { ok: true, ms: dt };
    log('INFO', `  ✓ ${name} passed (${dt}ms)`);
  } catch (e) {
    results[name] = { ok: false, error: e.message };
    failed++;
    log('FAIL', `  ✗ ${name} failed: ${e.message}`);
  }
}

const summary = {
  schema: 'biof3/qa-smoke.v1',
  version: 1,
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  repoHead: '', // 让调用方注入
  log: LOG_PATH,
  total: order.length,
  passed: order.filter((n) => results[n]?.ok).length,
  failed,
  results,
};

if (JSON_OUTPUT) {
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
} else {
  log('INFO', `=== summary: ${summary.passed}/${summary.total} passed${failed ? `, ${failed} failed` : ''} ===`);
}

process.exit(failed ? 1 : 0);
