#!/usr/bin/env node
/**
 * BLOCK-119 P1 — output:judge CLI（多轮会话/限定提示词输出的评判门 + 稳定性探针）。
 *
 * 用法（三模式）：
 *   npm run output:judge -- --request "请求" --output "输出" [--reference "材料"] [--goals "a;b"]
 *   npm run output:judge -- --transcript <conv.jsonl> [--record N] [--probe 3]
 *   npm run output:judge -- --file <output.txt> --request-file <request.txt>
 *
 * transcript 模式：从 llm-transcripts 抽取第 N 条 agent_iter（默认最后一条 stop 终态轮），
 * 请求=该轮最后用户消息、输出=该轮回复；--probe k 附带稳定性探针（k 次重放 fit 一致率）。
 * 隐私：报告 stdout/证据文件不含 transcript 原文，只含维度分数与判词元数据。
 * 供给固定 cloud（BLOCK-118 选型结论：dev 工具唯一有校准证据的供给）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);
const { judgeOutput, buildJudgeRequest } = require('./lib/harness/judge-core.mjs');
const { probeStability } = require('./lib/harness/stability-core.mjs');
const decisionApi = require('../core/petri-server/helpers/decision-api.js');

const SEPARATOR = String.fromCharCode(10);
const TRANSCRIPT_DIR = path.join(root, '.petri-dev-user-data', 'data', 'llm-transcripts');

/** 锚定决策台账 DB（BLOCK-118 加映 1 同款：裸 shell 下防 best-effort 记账静默丢失）。 */
function anchorDecisionDbPath() {
  if (process.env.PETRI_DB_PATH) return;
  const candidate = path.join(root, '.petri-dev-user-data', 'data', 'petri.db');
  if (fs.existsSync(candidate)) process.env.PETRI_DB_PATH = candidate;
}

function cloudOverrides() {
  const envFile = path.join(root, '.petri-dev-user-data', 'jev.env.bak-by-user-request');
  let apiKey = null;
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*TYPESAFE_API_KEY\s*=\s*(.+)\s*$/);
    if (m) apiKey = m[1].replace(/^['"]|['"]$/g, '');
  }
  if (!apiKey) {
    console.error('cloud 供给不可用：备份 env 无 TYPESAFE_API_KEY');
    process.exit(3);
  }
  return { apiKey, baseUrl: 'https://api.typesafe.ai', model: 'jev-1.13.0' };
}

function readTranscriptTurn(file, wanted) {
  const records = fs.readFileSync(path.join(TRANSCRIPT_DIR, path.basename(file)), 'utf8')
    .split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  const iters = records
    .map((r, idx) => ({ r, idx }))
    .filter(({ r }) => r.kind === 'agent_iter' && r.response && typeof r.response.content === 'string');
  const stopTurns = iters.filter(({ r }) => r.response.finishReason === 'stop' && !(r.response.toolCalls || []).length);
  const pool = stopTurns.length ? stopTurns : iters;
  if (!pool.length) throw new Error('transcript 无可用 agent_iter 轮');
  const chosen = wanted != null ? pool[wanted] : pool[pool.length - 1];
  if (!chosen) throw new Error(`--record ${wanted} 越界（可用 ${pool.length} 轮）`);
  const lastUser = [...(chosen.r.request.messages || [])].reverse().find((m) => m.role === 'user');
  return { request: String(lastUser.content || ''), output: String(chosen.r.response.content || ''), turn: pool.indexOf(chosen), turns: pool.length };
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : null;
  };
  const probeIdx = args.indexOf('--probe');
  const probeK = probeIdx !== -1 ? Number(args[probeIdx + 1]) : null;
  const outPath = get('-o');

  let request = get('--request');
  let output = get('--output');
  const reference = get('--reference') || '';
  const goals = (get('--goals') || '').split(';').map((s) => s.trim()).filter(Boolean);
  let meta = { mode: 'inline' };

  const transcript = get('--transcript');
  if (transcript) {
    const wantedRaw = get('--record');
    const turn = readTranscriptTurn(transcript, wantedRaw != null ? Number(wantedRaw) : null);
    request = turn.request;
    output = turn.output;
    meta = { mode: 'transcript', file: path.basename(transcript), turn: turn.turn, turns: turn.turns, chars: { request: request.length, output: output.length } };
  }
  if (!request && get('--request-file')) request = fs.readFileSync(get('--request-file'), 'utf8');
  if (!output && get('--file')) output = fs.readFileSync(get('--file'), 'utf8');
  if (!request || !output) {
    console.error('用法：npm run output:judge -- --request "…" --output "…" [--reference …] [--goals "a;b"] | --transcript <conv.jsonl> [--record N] [--probe k] | --file <out> --request-file <req>');
    process.exit(2);
  }

  anchorDecisionDbPath();
  const overrides = cloudOverrides();
  const r = await judgeOutput({ output, request, reference, goals, overrides });

  const report = {
    kind: 'block119-output-judge',
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    meta,
    verdict: r.verdict,
    degraded: r.degraded,
    reason: r.reason,
    model: r.model ?? null,
    statuses: r.statuses,
    hints: r.hints,
    note: '三态语义：PASS=推进；RETRY=带判词重试 1 次；ESCALATE=升级推理或转人工。降级=fail-open 放行。judge 决策已落 decision_log（output-judge 接点）。',
  };
  if (probeK) {
    const { state, questions } = buildJudgeRequest({ output, request, reference, goals });
    const probe = await probeStability(async () => {
      const outcome = await decisionApi.askDecision({ state, questions: { fit: questions.fit }, overrides });
      return outcome.ok ? { fitScore: outcome.answers.fit.score } : { degraded: outcome.reason };
    }, probeK);
    report.stabilityProbe = probe;
  }

  const text = JSON.stringify(report, null, 2) + SEPARATOR;
  if (outPath) {
    const abs = path.resolve(outPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, 'utf8');
    console.log(`报告已写入 ${path.relative(root, abs)}`);
  } else process.stdout.write(text);

  const head = `[output:judge] ${meta.mode === 'transcript' ? `transcript ${meta.file} 第 ${meta.turn}/${meta.turns} 轮` : 'inline 输出'}`;
  const fit = r.statuses && r.statuses.fit ? `fit=${r.statuses.fit.value}(${r.statuses.fit.status})` : '';
  const tail = r.degraded ? `降级放行（${r.reason}）` : `${fit} → ${r.verdict}`;
  console.log(`${head}：${tail}${report.stabilityProbe ? ` · 稳定性=${report.stabilityProbe.verdict}（一致率 ${report.stabilityProbe.agreementRate}）` : ''}`);
  if (r.hints && r.hints.length) {
    console.log('判词：');
    for (const h of r.hints) console.log('  - ' + h);
  }
}

main().catch((err) => { console.error('output:judge 失败（内核永不 throw，此为包装层异常）:', err && err.message); process.exit(1); });
