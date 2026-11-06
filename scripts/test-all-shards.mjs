#!/usr/bin/env node
/**
 * scripts/test-all-shards.mjs — 全量测试三段分片有界执行（BLOCK-359 · 蓝图 W0-8）。
 *
 * 背景：`test:all:workspace`（Node + 前端一次性跑完）2026-11-05 实测 ~40 分钟后被
 * task-runner SIGTERM（exit 143），无完成证据、不可归因。本脚本把它拆成三段有界分片：
 *
 *   node-core   test/*.test.{mjs,cjs} 中非「长时/实机」全部文件（node --test，120s 用例超时）
 *   frontend    frontend `npm run test:all`（vitest 全量）
 *   node-long   名称命中 /live|e2e|soak|perf-probe|startup-perf/ 的 Node 测试
 *               （会 spawn 真实进程/后端/浏览器，单独一段便于定位与豁免）
 *
 * 有界语义（禁盲等）：
 *   - 每分片经 dev-task-runner（BLOCK-231）跑：`task:run` 启动 → `task:wait --timeout-ms`；
 *     wait 退出 124 = 超时（结论=「未知/未完成」，**不得写 PASS**）；125 = runner 丢失（未知）。
 *   - 汇总 JSON 落 acceptance/nso-2026-11-06/wave-0/full-test-shards/summary-<ts>.json：
 *     每分片 { id, label, exitCode, state, logPath, verdict }，verdict ∈ passed/failed/unknown。
 *
 * 用法：
 *   node scripts/test-all-shards.mjs --plan                 # 打印三段清单与计数（确定性）
 *   node scripts/test-all-shards.mjs --shard=node-core      # 单跑一段（前台，退出码=分片退出码）
 *   node scripts/test-all-shards.mjs --all [--timeout-ms N] # 三段串行经 task:run 有界执行并汇总
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'scripts', 'dev-task-runner.cjs');
const TEST_DIR = path.join(ROOT, 'test');
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'nso-2026-11-06', 'wave-0', 'full-test-shards');
const LONG_RE = /(^|[-.])(live|e2e|soak)([-.])|perf-probe|startup-perf/;

const SHARDS = ['node-core', 'frontend', 'node-long'];

function listNodeTests() {
  return fs.readdirSync(TEST_DIR)
    .filter((f) => f.endsWith('.test.mjs') || f.endsWith('.test.cjs'))
    .sort();
}

export function buildShardPlan() {
  const all = listNodeTests();
  const nodeLong = all.filter((f) => LONG_RE.test(f));
  const nodeLongSet = new Set(nodeLong);
  const nodeCore = all.filter((f) => !nodeLongSet.has(f));
  return {
    'node-core': { kind: 'node-batch', files: nodeCore, cmd: null },
    'frontend': { kind: 'vitest', files: [], cmd: 'npm --prefix frontend run test:all' },
    'node-long': { kind: 'node-batch', files: nodeLong, cmd: null },
  };
}

// BLOCK-359 实测注记：node --test 默认并行（~cores worker）在 627 文件单命令规模下三次确定性
// 挂起（父进程 100% CPU、零子进程、零文件句柄、输出停在同一点；run-1 完整跑完为唯一例外）。
// BLOCK-368 二分定位（2026-11-06）：同一 638 文件按 200/命令分四个象限并行跑全部完整完成——
// 挂起是调度层「单命令文件数 × 并行」规模形态，与具体测试无关。node-core 分片默认
// --test-concurrency=1（逐文件进程隔离，必然完成），--concurrency=N 可显式放宽；
// 若未来需要并行提速，按象限多命令形态即可（勿回退单命令大清单）。
function shardCommand(plan, shard, concurrency = 1) {
  const entry = plan[shard];
  if (entry.kind === 'vitest') return entry.cmd;
  const abs = entry.files.map((f) => path.join(TEST_DIR, f));
  return `node --test --test-force-exit --test-timeout=120000 --test-concurrency=${concurrency} ${abs.map((p) => JSON.stringify(p)).join(' ')}`;
}

function runner(args, { timeoutMs } = {}) {
  return execFileSync(process.execPath, [RUNNER, ...args], {
    encoding: 'utf8',
    timeout: timeoutMs,
    cwd: ROOT,
    maxBuffer: 256 * 1024 * 1024,
  });
}

async function runAll({ timeoutMsPerShard, concurrency }) {
  const plan = buildShardPlan();
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const results = [];
  for (const shard of SHARDS) {
    const cmd = shardCommand(plan, shard, concurrency);
    console.log(`[shards] 启动 ${shard}（${plan[shard].kind}，${plan[shard].files.length || 'vitest'} 项，并发=${concurrency}，有界 ${timeoutMsPerShard}ms）…`);
    // dev-task-runner 的 run 模式即阻塞语义：tee 子进程输出、子进程退出码=runner 退出码、
    // SIGTERM 级联杀子进程并落 status。因此直接以 execFileSync timeout 做有界等待，
    // 超时（killed）→ verdict=unknown（结论=未知，不得写 PASS）。
    let runErr = null;
    let runOut = '';
    try {
      runOut = runner(['run', '--label', `nso-w0-shard-${shard}`, '--cmd', cmd], { timeoutMs: timeoutMsPerShard });
    } catch (err) {
      runErr = err;
      runOut = String(err.stdout || '');
    }
    const id = (runOut.match(/\[task\] started (\S+)/) || [])[1];
    if (!id) throw new Error(`task:run 未返回 id：${runOut.slice(0, 200)}`);
    const status = JSON.parse(fs.readFileSync(path.join(ROOT, '.petri-dev-user-data', 'task-runs', `${id}.status.json`), 'utf8'));
    let verdict;
    if (runErr && runErr.killed) verdict = 'unknown';
    else if (status.state === 'ended' && status.exitCode === 0 && !status.signal) verdict = 'passed';
    else if (status.state === 'ended' && status.exitCode === 0 && status.signal) verdict = 'unknown';
    else if (status.state === 'ended') verdict = 'failed';
    else verdict = 'unknown';
    results.push({
      shard,
      id,
      state: status.state,
      exitCode: status.exitCode ?? null,
      signal: status.signal ?? null,
      logPath: status.logPath,
      timedOut: Boolean(runErr && runErr.killed),
      verdict,
    });
    console.log(`[shards] ${shard} → ${verdict}（state=${status.state} exit=${status.exitCode}${status.signal ? ` signal=${status.signal}` : ''}）`);
  }
  const summary = {
    schemaVersion: 1,
    kind: 'nso-wave0-full-test-shards',
    generatedAt: new Date().toISOString(),
    timeoutMsPerShard,
    shards: results,
    allPassed: results.every((r) => r.verdict === 'passed'),
    note: 'verdict=unknown 表示超时或 runner 丢失——结论为未知，不得写 PASS（BLOCK-359 有界语义）。',
  };
  const out = path.join(EVIDENCE_DIR, `summary-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify(summary, null, 2));
  console.log(`[shards] 汇总 → ${out}（allPassed=${summary.allPassed}）`);
  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--plan')) {
    const plan = buildShardPlan();
    for (const shard of SHARDS) {
      console.log(`${shard}: ${plan[shard].files.length || 'vitest 全量'} 项`);
    }
    console.log(`node-long 命中：${plan['node-long'].files.join(', ') || '（无）'}`);
    return;
  }
  const shardIdx = args.findIndex((a) => a.startsWith('--shard='));
  if (shardIdx !== -1) {
    const shard = args[shardIdx].split('=')[1];
    if (!SHARDS.includes(shard)) throw new Error(`未知分片 ${shard}（可选 ${SHARDS.join('/')}）`);
    const plan = buildShardPlan();
    const [, cmd] = [null, shardCommand(plan, shard)];
    const res = spawnSync(cmd, { shell: true, stdio: 'inherit', cwd: ROOT, timeout: 6 * 60 * 60 * 1000 });
    process.exitCode = res.status ?? (res.signal ? 124 : 1);
    return;
  }
  if (args.includes('--all')) {
    const tIdx = args.findIndex((a) => a.startsWith('--timeout-ms='));
    const timeoutMsPerShard = tIdx !== -1 ? Number(args[tIdx].split('=')[1]) : 45 * 60 * 1000;
    const cIdx = args.findIndex((a) => a.startsWith('--concurrency='));
    const concurrency = cIdx !== -1 ? Math.max(1, Number(args[cIdx].split('=')[1]) || 1) : 1;
    const summary = await runAll({ timeoutMsPerShard, concurrency });
    process.exitCode = summary.allPassed ? 0 : 1;
    return;
  }
  console.error('用法：--plan | --shard=<node-core|frontend|node-long> | --all [--timeout-ms=N]');
  process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
