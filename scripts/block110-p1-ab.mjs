#!/usr/bin/env node
/**
 * BLOCK-110 P1 — A/B 对账 harness（plan §3 P1 验收）。
 *
 * 同批 ≥100 条中文样本上对跑两条话题切换判定路径：
 *   Jev 路径     = decision-api noul + 双阈值（YES≥0.85 / NO≤0.50，中间带=undecided）
 *   现大模型路径 = callModelTask JSON 分类（生产现行为）
 * 指标：一致率（双方均 decided）、各自 vs 标签 accuracy、延迟 P50/P95、成本（token/估算）。
 * 证据：acceptance/block-110/p1-ab.json。
 *
 * 前置：PETRI_DB_PATH 指向 dev 库（大模型路径读 ai-settings）+ jev.env 已 source（Jev key）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

process.env.PETRI_DB_PATH = process.env.PETRI_DB_PATH
  || path.join(root, '.petri-dev-user-data', 'data', 'petri.db');

const decisionApi = require(path.join(root, 'core', 'petri-server', 'helpers', 'decision-api.js'));
const modelTasks = require(path.join(root, 'core', 'petri-server', 'helpers', 'model-tasks.js'));

const SAMPLES_N = Number(process.env.BLOCK110_AB_N || 100);
const CONCURRENCY = Number(process.env.BLOCK110_AB_CONCURRENCY || 4);
const JEV_YES = 0.85;
const JEV_NO = 0.5;
const TIMEOUT_MS = 30_000;

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor((s.length * p) / 100))] ) : null;
};

// 语料 turn 形状 = [role, content] 元组（与 calibrate composeTurns 同构）
const fmtTurn = (t) => Array.isArray(t)
  ? `${t[0]}: ${String(t[1] || '').slice(0, 200)}`
  : `${t.role}: ${String(t.content || '').slice(0, 200)}`;

function composeLegacy(turnsBefore, turnsJustNow) {
  const all = [...(turnsBefore || []), ...(turnsJustNow || [])];
  const earlier = all.slice(0, Math.max(0, all.length - 4)).map(fmtTurn).join('\n');
  const latest = all.slice(-4).map(fmtTurn).join('\n');
  return { earlier, latest };
}

async function jevPath(sample) {
  const t0 = Date.now();
  const state = `之前的对话：\n${(sample[1] || []).map((t) => fmtTurn(t)).join('\n')}`
    + `\n\n刚刚的对话：\n${(sample[2] || []).map((t) => fmtTurn(t)).join('\n')}`;
  const outcome = await decisionApi.askDecision({
    state,
    questions: {
      topic_shift: {
        type: 'noul',
        instructions: '「刚刚的对话」是否明显切换到了与「之前的对话」完全不同的新话题？同一话题的延续、追问或细节扩展不算切换。模糊不清按否。',
      },
    },
    options: { timeoutMs: TIMEOUT_MS },
  });
  const ms = Date.now() - t0;
  if (!outcome.ok) return { decided: false, shifted: null, ms, reason: outcome.reason, tokens: outcome.usage?.input_tokens ?? 0 };
  const noul = outcome.answers.topic_shift && outcome.answers.topic_shift.noul;
  const tokens = outcome.usage?.input_tokens ?? 0;
  if (typeof noul !== 'number') return { decided: false, shifted: null, ms, reason: 'bad_shape', tokens };
  if (noul >= JEV_YES) return { decided: true, shifted: true, ms, noul, tokens };
  if (noul <= JEV_NO) return { decided: true, shifted: false, ms, noul, tokens };
  return { decided: false, shifted: null, ms, noul, tokens };
}

async function legacyPath(sample) {
  const t0 = Date.now();
  const { earlier, latest } = composeLegacy(sample[1], sample[2]);
  let shifted = null;
  let error = null;
  try {
    const result = await modelTasks.callModelTask({
      role: 'summary',
      messages: [
        { role: 'system', content: '你判断对话是否换了主题。只回答 JSON：{"shifted":true|false,"reason":"≤30字"}。如果近期对话明显在讨论一个**与之前完全不同**的新话题（不是同主题的延伸），shifted=true；否则 false。模糊不清就 false。' },
        { role: 'user', content: '之前的对话：\n' + earlier + '\n\n刚刚的对话：\n' + latest },
      ],
      temperature: 0.1,
      maxTokens: 100,
      responseFormat: { type: 'json_object' },
      telemetry: { kind: 'p1_ab' },
    });
    let parsed = null;
    try { parsed = JSON.parse(result.text); } catch {
      const m = (result.text || '').match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
    }
    if (parsed && typeof parsed.shifted === 'boolean') shifted = parsed.shifted;
    else error = 'unparseable';
  } catch (err) {
    error = String((err && err.message) || err);
  }
  return { shifted, ms: Date.now() - t0, error, chars: (sample[1] || []).length };
}

async function mapWithConcurrency(items, n, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const lanes = Array.from({ length: n }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(lanes);
  return results;
}

const corpusAll = JSON.parse(fs.readFileSync(
  path.join(root, 'acceptance', 'block-110', 'corpus-topic-shift.json'), 'utf8'
));
const all = Array.isArray(corpusAll) ? corpusAll : corpusAll.samples;
// 取平衡子集（前 50 true + 前 50 false），保持标签均衡
const trueSamples = all.filter((s) => s[3] === true).slice(0, SAMPLES_N / 2);
const falseSamples = all.filter((s) => s[3] === false).slice(0, SAMPLES_N / 2);
const samples = [...trueSamples, ...falseSamples];
if (samples.length < 100) {
  console.error(`样本不足：${samples.length}（需 ≥100）`);
  process.exit(1);
}
console.log(`A/B 样本：${samples.length} 条（true=${trueSamples.length} false=${falseSamples.length}）`);

const rows = await mapWithConcurrency(samples, CONCURRENCY, async (s) => {
  const jev = await jevPath(s);
  const legacy = await legacyPath(s);
  return {
    id: s[0], label: s[3] === true,
    jev: { decided: jev.decided, shifted: jev.shifted, ms: jev.ms, tokens: jev.tokens || 0, reason: jev.reason || null },
    legacy: { decided: legacy.shifted !== null, shifted: legacy.shifted, ms: legacy.ms, error: legacy.error || null },
  };
});

const both = rows.filter((r) => r.jev.decided && r.legacy.decided);
const agreement = both.filter((r) => r.jev.shifted === r.legacy.shifted).length;
const jevDecided = rows.filter((r) => r.jev.decided);
const jevCorrect = jevDecided.filter((r) => r.jev.shifted === r.label).length;
const legacyDecided = rows.filter((r) => r.legacy.decided);
const legacyCorrect = legacyDecided.filter((r) => r.legacy.shifted === r.label).length;

const summary = {
  schema: 'petri/block110-p1-ab.v1',
  generatedAt: new Date().toISOString(),
  model: decisionApi.DEFAULT_MODEL || 'jev-1.13.0',
  samples: rows.length,
  jev: {
    decided: jevDecided.length,
    coverage: Number((jevDecided.length / rows.length).toFixed(3)),
    accuracyVsLabel: jevDecided.length ? Number((jevCorrect / jevDecided.length).toFixed(3)) : null,
    p50Ms: pct(rows.map((r) => r.jev.ms), 50),
    p95Ms: pct(rows.map((r) => r.jev.ms), 95),
    inputTokens: rows.reduce((s, r) => s + (r.jev.tokens || 0), 0),
  },
  legacy: {
    decided: legacyDecided.length,
    accuracyVsLabel: legacyDecided.length ? Number((legacyCorrect / legacyDecided.length).toFixed(3)) : null,
    p50Ms: pct(rows.map((r) => r.legacy.ms), 50),
    p95Ms: pct(rows.map((r) => r.legacy.ms), 95),
  },
  agreementOnBothDecided: both.length ? Number((agreement / both.length).toFixed(3)) : null,
  bothDecidedCount: both.length,
};

fs.mkdirSync(path.join(root, 'acceptance', 'block-110'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'acceptance', 'block-110', 'p1-ab.json'),
  JSON.stringify({ ...summary, perSample: rows }, null, 2) + '\n'
);
console.log(JSON.stringify(summary, null, 2));
