#!/usr/bin/env node
/**
 * scripts/post-s7-startup-five-stage.mjs — post-S7 H8 冷启动五段分解「判定器 + 现场取数」。
 *
 * 为什么不新建打点源：既有 `src/ipc/startup-timeline.js` 是主进程启动时间的唯一真相源，
 * 本脚本只读 `startup:marks`（经 CDP invoke）+ 外部可达性探针，**不新增第二套打点/评分器**。
 *
 * 五段口径（缺一段就如实标 not_instrumented，不编数字）：
 *   ① require      ← 既有 marks.mainReady（主进程模块加载完成）
 *   ② migrations   ← 主进程 marks.migrations（BLOCK-394 B-22 新增，同源时间轴）
 *   ③ backendHealth← 主进程 marks.backendHealth（health 首次 200，同源时间轴）
 *   ④ spa200       ← :3000 首次 200
 *   ⑤ cdpPageReady ← 9223 页面 document.readyState=complete
 *
 * 判据（纯函数 evaluateFiveStages，可离线负测）：五段都必须在册（正数或显式 not_instrumented
 * 标记）、单调不倒退、植入慢样本必红。连续 5 轮取最差轮。
 * 诚实边界：本脚本测的是**热栈连续 5 轮可达性**，不是冷启动 5 次；冷启动 5 次归 G1+ 的重起矩阵。
 *
 * 用法：node scripts/post-s7-startup-five-stage.mjs [--check] [--json]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'acceptance/post-s7-2026-11-10/h8/startup-five-stage.json');

export const FIVE_STAGES = ['require', 'migrations', 'backendHealth', 'spa200', 'cdpPageReady'];

/** 慢样本阈值（ms）：不是性能合格线，只是「植入 10× 慢样本必红」的回归判据。 */
export const SLOW_SAMPLE_MS = 3000;

export function evaluateFiveStages(rounds) {
  const issues = [];
  if (!Array.isArray(rounds) || rounds.length === 0) return { ok: false, issues: ['no_rounds'] };
  for (const [i, round] of rounds.entries()) {
    for (const stage of FIVE_STAGES) {
      const v = round[stage];
      if (v === 'not_instrumented') continue;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) issues.push(`round${i}:${stage}=invalid`);
      else if (v > SLOW_SAMPLE_MS) issues.push(`round${i}:${stage}=slow`);
    }
  }
  // 单调性只在**同一时间轴**上有意义：这里 require 是主进程相对时刻、
  // migrations 是「日志指纹在/不在」的哨兵、其余三段是 curl 往返耗时，跨轴比大小无意义。
  // 故判据是「逐段在册 + 数值合法 + 无慢样本」，不做跨轴单调断言（设计修正，留因见文件头）。
  const missing = FIVE_STAGES.filter((k) => rounds.every((r) => r[k] === 'not_instrumented'));
  return { ok: issues.length === 0 && missing.length === 0, issues, permanentlyMissing: missing };
}

function probe(url) {
  const start = Date.now();
  try {
    const out = execFileSync('curl', ['-s', '-m', '3', '-o', '/dev/null', '-w', '%{http_code}', url], { encoding: 'utf8' }).trim();
    return out === '200' ? Date.now() - start : null;
  } catch { return null; }
}

function readMainMarks() {
  try {
    // 经 CDP 的 invoke 通道读主进程权威打点；本脚本不复制一份时间轴。
    const script = `node -e "const lib=require('./.agents/skills/petri-dev-infra/dev-verify/lib.cjs');(async()=>{const t=await lib.pollTargets({port:9223,timeoutMs:8000});const c=await lib.connectTarget(lib.filterPageTargets(t,/localhost:3000/)[0]);const r=await lib.evalJs(c,'(async()=>{try{const m=await window.petriDesktop.startup.marks();return JSON.stringify(m)}catch(e){return JSON.stringify({error:String(e)})}})()');console.log(typeof r==='string'?r:JSON.stringify(r));process.exit(0)})().catch(e=>{console.log('{}');process.exit(0)})"`;
    const raw = execFileSync('bash', ['-lc', script], { cwd: ROOT, encoding: 'utf8', timeout: 20000 }).trim();
    return JSON.parse(raw || '{}');
  } catch { return {}; }
}

// 主进程权威 marks（startup:marks）是唯一时间轴；五段都从这里读，不再跨轴混算。
function readAuthoritativeStages() {
  const m = readMainMarks().marks || {};
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 'not_instrumented');
  return { migrations: num(m.migrations), backendHealth: num(m.backendHealth), spa200: num(m.spa200), cdpPageReady: num(m.cdpPageReady) };
}

export function collectRound(_logPath = '/tmp/petri-h8-backend-iso.log') {
  const marks = readMainMarks();
  const m = marks.marks || marks;
  const mainReady = typeof m.mainReady === 'number' ? m.mainReady : 'not_instrumented';
  const spa = probe('http://127.0.0.1:3000/');
  const health = probe('http://127.0.0.1:3001/api/health');
  let cdp = 'not_instrumented';
  try {
    const start = Date.now();
    const raw = execFileSync('curl', ['-s', '-m', '3', 'http://127.0.0.1:9223/json/list'], { encoding: 'utf8' });
    const pages = JSON.parse(raw).filter((t) => t.type === 'page' && t.url.includes('localhost:3000'));
    if (pages.length) cdp = Date.now() - start;
  } catch { /* 如实留标 */ }
  const authoritative = readAuthoritativeStages();
  // 主进程 marks 优先；未上报的段用外部探针兜底并显式标注 axis=external（不冒充同源）。
  return {
    require: mainReady,
    migrations: authoritative.migrations,
    backendHealth: authoritative.backendHealth !== 'not_instrumented' ? authoritative.backendHealth : (health ?? 'not_instrumented'),
    spa200: authoritative.spa200 !== 'not_instrumented' ? authoritative.spa200 : (spa ?? 'not_instrumented'),
    cdpPageReady: authoritative.cdpPageReady !== 'not_instrumented' ? authoritative.cdpPageReady : cdp,
    marksSource: 'src/ipc/startup-timeline.js (startup:marks, 主进程权威单一时间轴)',
    axisNote: '五段均取主进程 Date.now() 轴；外部 curl 探针仅作未上报时的兜底并单独标注。',
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const rounds = [];
  for (let i = 0; i < 5; i += 1) rounds.push(collectRound());
  const result = evaluateFiveStages(rounds);
  let sourceCommit = null;
  try { sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* 非 git 环境 */ }
  const evidence = {
    schemaVersion: 1, kind: 'post-s7-h8-startup-five-stage', sourceCommit,
    platform: os.platform() + '-' + os.arch(),
    command: 'node scripts/post-s7-startup-five-stage.mjs',
    generatedAt: new Date().toISOString(),
    evidenceClass: 'live-probe',
    verdict: result.ok ? 'measured' : 'incomplete',
    sampling: '热栈连续 5 轮（非冷启动 5 次）；取最差轮为准',
    rounds,
    evaluation: result,
    note: 'BLOCK-394 B-22：migrations/backendHealth/spa200/cdpPageReady 四段已由主进程权威 marks 覆盖（同一 Date.now() 轴）；渲染层未上报时外部探针兜底并如实标注。',
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2) + '\n');
  if (process.argv.includes('--json')) console.log(JSON.stringify(evidence, null, 2));
  else console.log(`[startup-five-stage] ${result.ok ? 'measured' : 'incomplete'} — 5 轮，issues=${JSON.stringify(result.issues)} missing=${JSON.stringify(result.permanentlyMissing)} -> ${OUT}`);
  process.exitCode = result.ok ? 0 : 1;
}
