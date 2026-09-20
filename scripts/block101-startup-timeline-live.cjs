#!/usr/bin/env node
// platform-note: dual — powershell 进程枚举仅用于 Windows 分支（darwin 走 ps/git 对应路径）。（BLOCK-104 P4 门禁标注）
'use strict';
/**
 * block101-startup-timeline-live.cjs — BLOCK-101 P0 启动 timeline 采样（D1 四段口径）
 *
 * 前置：主 dev 栈（后端 :3001）+ 本脚本自管测试实例生命周期（独立 userData 离屏
 * 窗口，start-test-instance.sh 同源杀/启，绝不触碰用户主实例）。
 * 方法：杀 9223 旧测试实例 → 冷启动新实例 → CDP 连 9223 → 轮询 startup:marks
 * （渲染层 invoke 拉主进程权威打点）+ paintTiming → N 次采样 → 中位数/极值落盘
 * acceptance/block-101/block101-startup-timeline.json。
 * 诚实边界：dev 态数字（Vite dev 模块转换在链上）；打包态 profile 为 P4 评估项。
 */
const path = require('node:path');
const fs = require('node:fs');
const { spawn, execSync } = require('node:child_process');
const perfBudget = require('./lib/startup-perf-budget.cjs');

const ROOT = path.join(__dirname, '..');
const CDP_PORT = 9223;
const SAMPLES = Number(process.env.BLOCK101_SAMPLES || 5);
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-101');
const BUDGET_PATH = path.join(ROOT, 'test', 'startup-perf-budget.json');

function log(msg) { console.log(`[block101] ${msg}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listPageTargets() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json());
  return res.filter((t) => t.type === 'page');
}

async function killTestInstance() {
  // 幂等杀测试实例（只杀 9223 身份进程——命令行含测试实例标记/userData；绝不碰主实例）。
  // wmic 在部分 Windows 镜像缺席，PowerShell CIM 为准。
  try {
    const out = execSync(
      "powershell -NoProfile -Command \"Get-CimInstance Win32_Process -Filter \\\"Name='electron.exe'\\\" | Select-Object ProcessId,CommandLine | ConvertTo-Json\"",
      { encoding: 'utf8' }
    );
    const parsed = JSON.parse(out || '[]');
    const procs = Array.isArray(parsed) ? parsed : [parsed];
    for (const p of procs) {
      if (!/biof3-test-user-data|gewu-test-instance/.test(p.CommandLine || '')) continue;
      try { process.kill(Number(p.ProcessId)); log(`killed test instance pid=${p.ProcessId}`); } catch {}
    }
  } catch (e) { log('kill probe skipped: ' + e.message.slice(0, 120)); }
  await sleep(2000);
}

async function startTestInstance() {
  const child = spawn('bash', [path.join(ROOT, 'scripts', 'start-test-instance.sh')], {
    cwd: ROOT, env: process.env, stdio: 'ignore',
  });
  for (let t = 0; t < 60; t++) {
    await sleep(1000);
    try {
      const pages = await listPageTargets();
      if (pages.length) return child;
    } catch {}
  }
  throw new Error('test_instance_not_ready');
}

async function sampleOnce(label, lib) {
  const targets = await listPageTargets();
  const marked = targets.find((t) => (t.url || '').includes('test=1')) || targets[0];
  const client = await lib.connectTarget(marked);
  const evalInPage = (expr) => lib.evalJs(client, expr);
  // 等 SPA 挂载 + 首批 API 到货（marks 上报需要 dataReady 链走完）
  for (let i = 0; i < 40; i++) {
    const desktop = await evalInPage('!!(window.gewu || window.biof3Desktop)').catch(() => false);
    if (desktop) break;
    await sleep(500);
  }
  await sleep(1500);
  const marks = await evalInPage(`(async () => {
    const desktop = window.gewu || window.biof3Desktop;
    if (!desktop || !desktop.startup) return { error: 'startup_bridge_missing' };
    const main = await desktop.startup.marks();
    const paints = performance.getEntriesByType('paint').map((e) => ({ name: e.name, startTime: Math.round(e.startTime) }));
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      main: main && main.marks,
      paints,
      domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
    };
  })()`);
  try { client.socket.close(); } catch {}
  if (!marks || marks.error || !marks.main) throw new Error('startup_marks_unavailable: ' + JSON.stringify(marks));
  const rep = marks.main.reported || {};
  log(`${label}: mainReady=${marks.main.mainReady}ms preload=${marks.main.preload}ms windowShown=${marks.main.windowShown}ms didLoad=${marks.main.didFinishLoad}ms firstPaint=${(marks.paints[0] || {}).startTime ?? 'n/a'}ms dataReady=${rep.dataReadyMs ?? 'n/a'}ms projects=${rep.projectCount ?? 'n/a'}`);
  return marks;
}

/** BLOCK-106 P0 归因上下文：没有它，涨幅无法区分「代码回退」与「环境/数据量变化」。 */
function collectContext() {
  let head = null;
  try {
    head = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch { /* 非 git 环境：诚实留 null */ }
  const assetsDir = path.join(ROOT, 'frontend', 'dist', 'assets');
  let frontendBundle = { available: false, reason: 'frontend/dist/assets 不存在（未构建）' };
  try {
    const chunks = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js')).map((f) => {
      const st = fs.statSync(path.join(assetsDir, f));
      return { file: f, bytes: st.size, mtimeMs: st.mtimeMs };
    });
    // 关键路径按「入口 chunk」算，不按最大 chunk 算：拆包后最大 chunk 往往是
    // 并行预取的第三方库（如 highlight.js），把它当入口会虚报启动负载。
    const htmlPath = path.join(ROOT, 'frontend', 'dist', 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    const entryMatch = html.match(/src="\/?(?:assets\/)?([\w.-]+\.js)"/);
    const entry = entryMatch ? chunks.find((c) => c.file === entryMatch[1]) : null;
    const largest = [...chunks].sort((a, b) => b.bytes - a.bytes)[0] || null;
    const css = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.css')).reduce((sum, f) => sum + fs.statSync(path.join(assetsDir, f)).size, 0);
    if (entry) {
      frontendBundle = {
        available: true,
        entryChunk: entry.file,
        entryChunkBytes: entry.bytes,
        largestChunk: largest ? largest.file : null,
        largestChunkBytes: largest ? largest.bytes : null,
        jsChunkCount: chunks.length,
        jsTotalBytes: chunks.reduce((s, c) => s + c.bytes, 0),
        cssTotalBytes: css,
        // dist 可能比当前源码旧：如实带构建时刻，比对时不得把它当真值
        builtAt: new Date(entry.mtimeMs).toISOString(),
      };
    } else {
      frontendBundle = { available: false, reason: 'dist/index.html 未引用可解析的入口 chunk' };
    }
  } catch (e) {
    frontendBundle = { available: false, reason: e.message.slice(0, 120) };
  }
  return {
    head,
    platform: process.platform,
    node: process.version,
    frontendBundle,
    budgetFile: path.relative(ROOT, BUDGET_PATH),
  };
}

async function main() {
  const libPath = path.join(ROOT, '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs');
  const lib = require(libPath);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const samples = [];
  for (let i = 0; i < SAMPLES; i++) {
    log(`sample ${i + 1}/${SAMPLES}: 冷启动测试实例`);
    await killTestInstance();
    const child = await startTestInstance();
    try {
      samples.push(await sampleOnce(`sample${i + 1}`, lib));
    } finally {
      try { child.kill(); } catch {}
    }
  }
  await killTestInstance();

  const med = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const pick = (fn) => samples.map(fn).filter((v) => typeof v === 'number');
  const stat = (arr) => arr.length ? { median: med(arr), min: Math.min(...arr), max: Math.max(...arr), n: arr.length } : null;
  const summary = {
    capturedAt: new Date().toISOString(),
    samples: SAMPLES,
    context: collectContext(),
    mainReady: stat(pick((s) => s.main.mainReady)),
    preload: stat(pick((s) => s.main.preload)),
    windowShown: stat(pick((s) => s.main.windowShown)),
    didFinishLoad: stat(pick((s) => s.main.didFinishLoad)),
    firstPaint: stat(pick((s) => (s.paints.find((p) => p.name === 'first-paint') || {}).startTime)),
    dataReady: stat(pick((s) => s.main.reported && s.main.reported.dataReadyMs)),
    domContentLoaded: stat(pick((s) => s.domContentLoaded)),
    projectCount: stat(pick((s) => s.main.reported && s.main.reported.projectCount)),
  };
  // BLOCK-106 P0 阈值棘轮：中位数超预算即红；预算缺该平台档 / 文件非法 → 抛错判红不降级。
  const ceilings = perfBudget.resolvePlatformBudget(
    JSON.parse(fs.readFileSync(BUDGET_PATH, 'utf8')),
    process.platform,
    BUDGET_PATH
  );
  const budget = perfBudget.evaluateBudget(summary, ceilings);
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'block101-startup-timeline.json'),
    JSON.stringify({ flow: 'block101-startup-timeline', summary, budget, raw: samples }, null, 2) + '\n');
  console.log('summary:', JSON.stringify(summary));
  console.log('budget:', JSON.stringify(budget.pass ? { pass: true, headroom: budget.checked.map((c) => `${c.stage}=${c.headroomMs}ms`) } : budget));
  const marksOk = !!(summary.mainReady && summary.windowShown && summary.didFinishLoad);
  const allGood = marksOk && budget.pass;
  console.log(`block101-startup-timeline: allPass=${allGood} (marks=${marksOk} budget=${budget.pass})`);
  process.exit(allGood ? 0 : 1);
}

main().catch((e) => { console.error('[block101] FAIL', e.message); process.exit(1); });
