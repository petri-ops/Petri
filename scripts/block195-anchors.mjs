#!/usr/bin/env node
/**
 * scripts/block195-anchors.mjs — 竞争力 8 维锚点复跑器（BLOCK-195）。
 *
 * 读 `evals/anchors/competitiveness-8d.json`（点位取自总纲 §1 判词 + §2 D1–D18），逐条复跑锚点命令，
 * 按**立项时先公布的映射**出分：`score = 5 × anchored_green 点位 ÷ 点位总数`，
 * 无机械锚的点位计入分母不计入分子（**无证据不给分**），失败=anchored-red，
 * live 层在 dev 栈不在场时判 `env`（不算绿也不算回归，且与"真失败"分开——预检决定归属，
 * 不用猜测把回归洗成环境）。
 *
 * 用法：
 *   node scripts/block195-anchors.mjs [--tier=unit,frontend,evals] [--dry] [--check] [--update]
 * - 默认：复跑全部锚点 → 出分 → 写 acceptance/block-195/anchors-latest.json（+时间戳副本）
 * - --check：与 evals/anchors/baseline.json 对账，锚点绿转红/点位缺锚=红（exit 非零）
 * - --update：把当前测量提升为棘轮基线（显式审计动作，同 BLOCK-191 口径）
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { derivePointState, scoreDimension, resolveCmd, auditList, compareAnchorBaseline, unmetPrecondition } from './lib/anchor-ratchet.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIST_FILE = path.join(ROOT, 'evals', 'anchors', 'competitiveness-8d.json');
const BASELINE_FILE = path.join(ROOT, 'evals', 'anchors', 'baseline.json');
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-195');

// ---------- 执行 ----------
function probeCdp(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/json/version', timeout: 1200 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/** dev 栈在场预检：dev-verify 默认连 9222，本包早前的实机探针另用 9223 测试实例——任一在答即视为在跑。 */
async function devStackEndpoint() {
  for (const port of [9222, 9223]) {
    if (await probeCdp(port)) return port;
  }
  return null;
}

function runCmd(cmd, timeoutMs) {
  try {
    execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024 });
    return { status: 'pass', tail: '' };
  } catch (err) {
    const blob = `${err.stdout || ''}${err.stderr || ''}${err.message || ''}`.replace(/\s+/g, ' ');
    const timedOut = /ETIMEDOUT|timed out/i.test(String(err.message || ''));
    return { status: 'fail', tail: `${timedOut ? 'TIMEOUT ' : ''}${blob.slice(-260)}` };
  }
}

const args = process.argv.slice(2);
const tierFilter = (args.find((a) => a.startsWith('--tier=')) || '').split('=')[1];
const wantedTiers = tierFilter ? tierFilter.split(',') : null;
const dry = args.includes('--dry');
const checkOnly = args.includes('--check');
const update = args.includes('--update');

const list = JSON.parse(fs.readFileSync(LIST_FILE, 'utf8'));
const issues = auditList(list, ROOT);if (issues.length) {
  for (const i of issues) console.error(`  [清单] ✖ ${i}`);
  console.error('[anchors] 清单自检失败——幽灵锚点/缺 derivesFrom 即缺陷，不出分。');
  process.exit(2);
}

const stackPort = await devStackEndpoint();
const stackUp = Boolean(stackPort);
if (!stackUp) console.log('[anchors] dev 栈（CDP 9222/9223）不在场 → live 层按环境档记录（不算绿也不算回归）');
else console.log(`[anchors] dev 栈在场（CDP ${stackPort}）→ live 层执行真 Chromium 抽样`);

// 唯一命令表：同一条命令只跑一次（点位共享）；全为前置未满足的锚点不执行（环境档）。
const unique = new Map();
for (const d of list.dimensions) {
  for (const p of d.points) {
    for (const a of p.anchors || []) {
      if (wantedTiers && !wantedTiers.includes(a.tier)) continue;
      const cmd = resolveCmd(a.cmd, list.sharedCommands);
      if (!unique.has(cmd)) unique.set(cmd, { tier: a.tier, anchors: [], result: null });
      unique.get(cmd).anchors.push(a);
    }
  }
}

// cdp 类前置要异步探测（测试实例 9223 与主实例 9222 是两个窗口，缺了属环境档不属回归）
const cdpUp = new Map();
for (const d of list.dimensions) {
  for (const p of d.points) {
    for (const a of p.anchors || []) {
      const port = a.precondition && a.precondition.cdp;
      if (port && !cdpUp.has(port)) cdpUp.set(port, await probeCdp(port));
    }
  }
}
const preReason = (a) => {
  const fsMiss = unmetPrecondition(a, ROOT);
  if (fsMiss) return fsMiss;
  const port = a.precondition && a.precondition.cdp;
  if (port && cdpUp.get(port) === false) return `前置缺失：CDP :${port} 未在答（${a.precondition.note || '该腿需对应实例'}）`;
  return null;
};

if (checkOnly && wantedTiers) {
  console.error('[anchors] --check 必须跑全层级：带 --tier 过滤会让被过滤掉的锚点看似"被移除"，对账会造出假回归。');
  process.exit(2);
}

const envBlocked = new Map();
for (const [cmd, slot] of unique) {
  const blocked = slot.anchors.every((a) => preReason(a));
  if (blocked) {
    slot.result = { status: 'env', tail: preReason(slot.anchors[0]) || '前置未满足' };
    envBlocked.set(cmd, slot.result.tail);
  }
}
if (envBlocked.size) console.log(`[anchors] ${envBlocked.size} 条锚点因前置条件未满足记为环境档（不算绿，也不算产品回归）：\n${[...envBlocked].map(([c, r]) => `   · ${c.slice(0, 70)} — ${r}`).join('\n')}`);

if (dry) {
  console.log(`[anchors] dry：点位 ${[...list.dimensions].reduce((n, d) => n + d.points.length, 0)} · 锚点 ${[...list.dimensions].reduce((n, d) => n + (d.points || []).reduce((m, p) => m + (p.anchors || []).length, 0), 0)} · 唯一命令 ${unique.size} · 清单自检 OK`);
  process.exit(0);
}

const t0 = Date.now();
for (const [cmd, slot] of unique) {
  if (slot.result && slot.result.status === 'env') continue; // 前置未满足：不执行
  if (slot.tier === 'live' && !stackUp) continue; // 环境档：不执行
  const timeoutMs = slot.tier === 'evals' || slot.tier === 'live' ? 420_000 : 240_000;
  process.stdout.write(`  ▶ ${cmd.slice(0, 92)} … `);
  const started = Date.now();
  slot.result = runCmd(cmd, timeoutMs);
  console.log(`${slot.result.status === 'pass' ? '✔' : '✖'}（${((Date.now() - started) / 1000).toFixed(1)}s）`);
  if (slot.result.status === 'fail') console.log(`      └ ${slot.result.tail}`);
}

const dimReports = [];
for (const d of list.dimensions) {
  const points = [];
  for (const p of d.points) {
    const anchors = [];
    for (const a of p.anchors || []) {
      if (wantedTiers && !wantedTiers.includes(a.tier)) continue;
      const cmd = resolveCmd(a.cmd, list.sharedCommands);
      const slot = unique.get(cmd);
      const pre = preReason(a);
      let status;
      if (pre) status = 'env';
      else if (!slot) status = 'filtered';
      else if (slot.tier === 'live' && !stackUp) status = 'env';
      else if (!slot.result) status = 'env';
      else status = slot.result.status;
      anchors.push({ tier: a.tier, path: a.path, cmd, status, tail: pre || slot?.result?.tail || null });
    }
    points.push({ id: p.id, claim: p.claim, derivesFrom: p.derivesFrom, anchors, envBlockedCount: anchors.filter((a) => a.status === 'env').length, ...derivePointState(anchors) });
  }
  const green = points.filter((x) => x.state === 'anchored-green').length;
  const red = points.filter((x) => x.state === 'anchored-red').length;
  const unanchored = points.filter((x) => x.state === 'unanchored').length;
  dimReports.push({
    id: d.id,
    name: d.name,
    inferred20261012: d.inferred20261012,
    measured: scoreDimension(points),
    delta: Math.round((scoreDimension(points) - d.inferred20261012) * 10) / 10,
    points,
    summary: { total: points.length, green, red, unanchored },
  });
}

const measuredAll = dimReports.map((d) => d.measured);
const overall = Math.round((measuredAll.reduce((a, b) => a + b, 0) / measuredAll.length) * 10) / 10;
const belowBar = dimReports.filter((d) => d.measured < 3);

const report = {
  schema: list.schema,
  scoring: list.scoring.formula,
  at: new Date().toISOString(),
  elapsedMs: Date.now() - t0,
  tiers: wantedTiers || 'all',
  devStack: stackPort || 'absent',
  dimensions: dimReports,
  average: overall,
  belowBar: belowBar.map((d) => `${d.id} ${d.name}=${d.measured}`),
};

// ---------- 打印 ----------
console.log('\n=== 竞争力 8 维锚点复测（测量值 vs 2026-10-12 静态推断）===');
for (const d of dimReports) {
  console.log(`dim${d.id} ${d.name}：测量 ${d.measured.toFixed(1)} / 推断 ${d.inferred20261012}（Δ${d.delta >= 0 ? '+' : ''}${d.delta}）｜绿 ${d.summary.green}·红 ${d.summary.red}·无锚 ${d.summary.unanchored}/${d.summary.total}`);
  for (const p of d.points.filter((x) => x.state !== 'anchored-green')) {
    const bad = p.anchors.find((a) => a.status === 'fail');
    console.log(`   ${p.state === 'anchored-red' ? '✖' : '○'} ${p.id} — ${p.claim}${bad ? `（${bad.tier} 锚失败：${(bad.tail || '').slice(0, 90)}）` : `（${p.note}）`}`);
  }
}
console.log(`\n八维均值 ${overall}（§2 合格线=无维 <3；${belowBar.length ? `低于线：${belowBar.map((d) => d.id).join('/')}` : '全部 ≥3'}）· 用时 ${(report.elapsedMs / 1000).toFixed(0)}s`);

// ---------- 棘轮 ----------
if (checkOnly || update) {
  const exists = fs.existsSync(BASELINE_FILE);
  const baseline = exists ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) : null;
  if (update) {
    fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
    const payload = { schema: 'petri-competitiveness-anchor-baseline/v1', updatedAt: report.at, tiers: report.tiers, points: dimReports.flatMap((d) => d.points.map((p) => ({ id: `${d.id}.${p.id}`, state: p.state, anchors: p.anchors.map((a) => ({ tier: a.tier, path: a.path, status: a.status })) }))) };
    fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`[anchors] 基线已提升：evals/anchors/baseline.json（点位 ${payload.points.length}）`);
  } else if (!exists) {
    console.error('[anchors] 基线不存在——首次建立请加 --update');
    process.exitCode = 2;
  } else {
    const flat = dimReports.flatMap((d) => d.points.map((p) => ({ id: `${d.id}.${p.id}`, state: p.state, anchorPaths: p.anchors.map((a) => a.path) })));
    // **环境等价性先判**：基线里靠 live/probe 锚拿到的绿，本次因前置未满足跑不了——
    // 这既不是"通过"也不是"产品后退"，对账必须拒绝（否则 --check 在没有 dev 栈的机器上恒红，
    // 破窗门；也不能悄悄降级成 unanchored 蒙过去，那等于把环境差异洗成"没测到而已"）。
    const baseState = new Map((baseline.points || []).map((p) => [p.id, p.state]));
    const envGap = dimReports
      .flatMap((d) => d.points.map((p) => ({ id: `${d.id}.${p.id}`, state: p.state, env: p.envBlockedCount })))
      .filter((c) => c.env > 0 && c.state !== 'anchored-green' && baseState.get(c.id) === 'anchored-green');
    if (envGap.length) {
      for (const g of envGap) console.log(`  ⚠ 环境不等价：${g.id} 基线为绿需 live/probe 锚，本次前置未满足`);
      console.error('[anchors] 拒绝对账——请先补齐环境（dev 主实例 9222 / `bash scripts/start-test-instance.sh` 起 9223 测试实例 / R 运行面），再跑全层级 `--check`。');
      process.exitCode = 2;
    } else {
      const verdict = compareAnchorBaseline(flat, baseline);
      for (const r of verdict.regressions) console.log(`  ✖ 棘轮回归：${r}`);
      for (const i of verdict.improvements) console.log(`  ↑ 棘轮改善：${i}`);
      if (!verdict.ok) {
        console.error(`[anchors] FAIL — ${verdict.regressions.length} 处相对基线后退`);
        process.exitCode = 1;
      } else {
        console.log(`[anchors] 棘轮对账通过（基线点位 ${baseline.points.length}·无后退·改善 ${verdict.improvements.length}）`);
      }
    }
  }
}

if (!checkOnly) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'anchors-latest.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(EVIDENCE_DIR, `anchors-${report.at.replace(/[:.]/g, '-')}.json`), JSON.stringify(report, null, 2));
  console.log(`[anchors] 证据：acceptance/block-195/anchors-latest.json`);
}
if (process.exitCode === undefined) process.exitCode = 0;
