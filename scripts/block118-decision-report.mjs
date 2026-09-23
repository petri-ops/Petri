#!/usr/bin/env node
/**
 * BLOCK-118 加映 1 — decision:report 决策台账会话报告（一条命令看「调了什么、花了多少」）。
 *
 * 用法：
 *   npm run decision:report [-- --since=2026-09-23] [--hours=24] [--point=test-suggest] [--json]
 *
 * 数据源=decision_log 台账（BLOCK-116 记账面 + 012 input_tokens 列）；只读查询零副作用。
 * DB 锚定与建议器包装同策略：缺 BIOF3_DB_PATH 时锚定 dev 数据面，无 dev 数据面则如实报错。
 * 成本估算按 Jev 云只收输入 token（$42/百万 token × 1e-6 = $42/Btok）计；Laya 本地=0。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

const SEPARATOR = String.fromCharCode(10);
const JEVDOLLARS_PER_TOKEN = 42 / 1e9;

function anchorDecisionDbPath() {
  if (process.env.BIOF3_DB_PATH) return;
  const candidate = path.join(root, '.biof3-dev-user-data', 'data', 'biof3.db');
  if (fs.existsSync(candidate)) process.env.BIOF3_DB_PATH = candidate;
}

function parseArgs(argv) {
  const get = (flag) => {
    const idx = argv.indexOf(flag);
    return idx !== -1 ? argv[idx + 1] : null;
  };
  const sinceArg = get('--since');
  const hoursArg = get('--hours');
  const pointArg = get('--point');
  let since;
  if (sinceArg) {
    since = sinceArg;
  } else if (hoursArg) {
    since = new Date(Date.now() - Number(hoursArg) * 3600_000).toISOString();
  } else {
    since = new Date().toISOString().slice(0, 10);
  }
  return { since, point: pointArg, json: argv.includes('--json') };
}

function main() {
  const { since, point, json } = parseArgs(process.argv.slice(2));
  anchorDecisionDbPath();
  const dbPath = process.env.BIOF3_DB_PATH;
  if (!dbPath || !fs.existsSync(dbPath)) {
    console.error('decision:report：找不到决策台账 DB（未设 BIOF3_DB_PATH 且无 dev 数据面）。');
    process.exit(3);
  }
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.prepare(
      `SELECT at, point, model, choice, confidence, threshold, degraded, reason, latency_ms, input_tokens
       FROM decision_log WHERE at >= ? ${point ? 'AND point = ?' : ''} ORDER BY at`
    ).all(...(point ? [since, point] : [since]));
    if (rows.length === 0) {
      console.log(`decision:report 自 ${since} 以来：零调用。`);
      return;
    }
    const byKey = new Map();
    for (const r of rows) {
      const key = `${r.point} × ${r.model ?? '?'}`;
      if (!byKey.has(key)) byKey.set(key, { point: r.point, model: r.model ?? '?', calls: 0, degraded: 0, tokens: 0, latencies: [], last: null });
      const a = byKey.get(key);
      a.calls += 1;
      a.degraded += r.degraded ? 1 : 0;
      a.tokens += r.input_tokens ?? 0;
      a.latencies.push(r.latency_ms ?? 0);
      a.last = r.at;
    }
    const report = {
      kind: 'block118-decision-report',
      since,
      dbPath: path.relative(root, dbPath),
      totalCalls: rows.length,
      totalInputTokens: rows.reduce((acc, r) => acc + (r.input_tokens ?? 0), 0),
      groups: [...byKey.values()].map((a) => {
        const sorted = a.latencies.slice().sort((x, y) => x - y);
        return {
          point: a.point,
          model: a.model,
          calls: a.calls,
          degraded: a.degraded,
          avgLatencyMs: Math.round(a.latencies.reduce((x, y) => x + y, 0) / a.latencies.length),
          p95LatencyMs: sorted[Math.floor(sorted.length * 0.95)],
          inputTokens: a.tokens,
          lastAt: a.last,
        };
      }),
    };
    report.estimatedCloudCostUSD = report.totalInputTokens * JEVDOLLARS_PER_TOKEN;
    if (json) {
      process.stdout.write(JSON.stringify(report, null, 2) + SEPARATOR);
      return;
    }
    console.log(`决策台账报告（自 ${since}，共 ${report.totalCalls} 次调用，DB=${report.dbPath}）`);
    console.log('─'.repeat(100));
    for (const g of report.groups) {
      console.log(
        g.point.padEnd(16), g.model.padEnd(24),
        `calls=${String(g.calls).padEnd(5)}`,
        `degraded=${String(g.degraded).padEnd(4)}`,
        `avgLat=${String(g.avgLatencyMs + 'ms').padEnd(9)}`,
        `p95=${String(g.p95LatencyMs + 'ms').padEnd(9)}`,
        `tokens=${String(g.inputTokens).padEnd(8)}`,
        `last=${g.lastAt ? g.lastAt.slice(0, 19) : '-'}`
      );
    }
    console.log('─'.repeat(100));
    console.log(`token 用量合计=${report.totalInputTokens}（云端成本估算≈$${report.estimatedCloudCostUSD.toFixed(4)}，按 Jev $42/Btok 只收输入；Laya 本地=0）`);
  } finally {
    db.close();
  }
}

main();
