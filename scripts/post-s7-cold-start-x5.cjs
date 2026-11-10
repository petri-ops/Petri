#!/usr/bin/env node
/**
 * B-22 冷启动 ×5（不是热栈可达性轮询）。
 *
 * 每一轮：kill 9223 旧测试实例 → start-test-instance.sh 冷启动新实例（默认离屏，
 * 禁 --onscreen）→ 等 CDP target → 读主进程权威 startup:marks（五段同一时间轴）
 * → 记录。取最差轮。不改产品代码、不改用户主实例。
 */
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'acceptance/post-s7-2026-11-10/h10/cold-start-x5.json');
const ROUNDS = Number(process.env.H10_COLD_ROUNDS || 5);

async function readMarks(client) {
  const raw = await lib.evalJs(client, `(async () => {
    try { const r = await window.petriDesktop.startup.marks(); return JSON.stringify(r); }
    catch (e) { return JSON.stringify({ error: String(e) }); }
  })()`);
  const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return obj.marks || obj;
}

(async () => {
  const rounds = [];
  for (let i = 1; i <= ROUNDS; i += 1) {
    // 冷启动：启动器自带「只杀 9223 监听者」的幂等清场（lsof -sTCP:LISTEN），
    // 这里不再自行 kill——避免误杀 CDP 连接者（本采集脚本自己）。默认离屏，禁 --onscreen。
    const startedAt = Date.now();
    const up = spawnSync('bash', ['scripts/start-test-instance.sh'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
    const bootLog = String(up.stdout || '').trim().split('\n').slice(-3).join(' | ');
    let marks = {};
    let ready = false;
    try {
      const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 20000 });
      const page = lib.filterPageTargets(targets, /localhost:3000/)[0];
      const client = await lib.connectTarget(page);
      marks = await readMarks(client);
      ready = true;
    } catch (e) { marks = { error: e.message }; }
    const elapsedMs = Date.now() - startedAt;
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    rounds.push({
      round: i,
      coldStartWallMs: elapsedMs,
      ready,
      require: num(marks.mainReady),
      migrations: num(marks.migrations),
      backendHealth: num(marks.backendHealth),
      spa200: num(marks.spa200),
      cdpPageReady: num(marks.cdpPageReady),
      reportedPresent: Boolean(marks.reported),
      bootLog,
    });
    console.log(`[cold-x5] round ${i}/${ROUNDS} ready=${ready} wall=${elapsedMs}ms`);
  }
  const readyRounds = rounds.filter((r) => r.ready);
  const worst = readyRounds.reduce((a, r) => (r.coldStartWallMs > (a?.coldStartWallMs || 0) ? r : a), null);
  const allFiveStages = ['require', 'migrations', 'backendHealth', 'spa200', 'cdpPageReady'];
  const stageCoverage = Object.fromEntries(allFiveStages.map((k) => [k, readyRounds.filter((r) => r[k] !== null).length]));
  const evidence = {
    schemaVersion: 1, kind: 'b22-cold-start-x5', generatedAt: new Date().toISOString(),
    platform: require('node:os').platform() + '-' + require('node:os').arch(),
    evidenceClass: 'live-probe', rounds: ROUNDS, readyCount: readyRounds.length,
    worstRound: worst, stageCoverage, roundsDetail: rounds,
    verdict: readyRounds.length === ROUNDS ? 'measured' : 'incomplete',
    note: '冷启动 5 次非热栈轮询；五段均取主进程 startup:marks 同一时间轴。未上报的段如实记 null，不编数字。离屏窗口不影响主实例。',
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2) + '\n');
  console.log('[cold-x5]', JSON.stringify({ verdict: evidence.verdict, readyCount: evidence.readyCount, stageCoverage, worstWallMs: worst?.coldStartWallMs }));
  process.exit(evidence.verdict === 'measured' ? 0 : 1);
})().catch((e) => { console.error('[cold-x5] FATAL', e.stack || e.message); process.exit(1); });
