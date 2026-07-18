/**
 * test/harness-provider-eval.test.mjs
 *
 * Unit tests for the PURE parts of scripts/harness-provider-eval.mjs:
 * probe evaluators, scoring, and report rendering. No network, no real
 * providers — the live probe loop (runProbesForTarget) is intentionally not
 * exported and not exercised here.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveTargets,
  extractJsonObject,
  evalIntent,
  evalToolSelect,
  evalParamFill,
  evalToolCalling,
  evalFailureRecovery,
  evalResultInterpret,
  scoreTarget,
  renderMarkdown,
  renderJson,
} from '../scripts/harness-provider-eval.mjs';

// ── resolveTargets: env-driven, credential-gated ─────────────────────────────

test('resolveTargets: no credentials → no targets', () => {
  const getEnv = () => undefined;
  assert.deepEqual(resolveTargets(getEnv), []);
});

test('resolveTargets: deepseek key present → deepseek target with default model', () => {
  const env = { DEEPSEEK_API_KEY: 'sk-x' };
  const targets = resolveTargets((k) => env[k]);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].name, 'deepseek');
  assert.equal(targets[0].model, 'deepseek-chat');
  assert.equal(targets[0].apiKey, 'sk-x');
});

test('resolveTargets: anthropic requires key; picks up model + baseUrl', () => {
  const env = {
    ANTHROPIC_API_KEY: 'sk-a',
    ANTHROPIC_MODEL: 'claude-opus-4-8',
    ANTHROPIC_BASE_URL: 'https://api.example.test',
  };
  const targets = resolveTargets((k) => env[k]);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].name, 'anthropic');
  assert.equal(targets[0].model, 'claude-opus-4-8');
  assert.equal(targets[0].baseUrl, 'https://api.example.test');
});

test('resolveTargets: EVAL_TARGETS filters which targets are built', () => {
  const env = { EVAL_TARGETS: 'deepseek', DEEPSEEK_API_KEY: 'sk-x', ANTHROPIC_API_KEY: 'sk-a' };
  const targets = resolveTargets((k) => env[k]);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].name, 'deepseek');
});

// ── extractJsonObject ────────────────────────────────────────────��────────────

test('extractJsonObject: plain JSON', () => {
  assert.deepEqual(extractJsonObject('{"species":"human"}'), { species: 'human' });
});

test('extractJsonObject: fenced JSON with chatter', () => {
  const reply = 'Sure!\n```json\n{"species":"mouse","analysis_type":"GO"}\n```\nDone.';
  assert.deepEqual(extractJsonObject(reply), { species: 'mouse', analysis_type: 'GO' });
});

test('extractJsonObject: no JSON → null', () => {
  assert.equal(extractJsonObject('no json here'), null);
  assert.equal(extractJsonObject(''), null);
  assert.equal(extractJsonObject(null), null);
});

// ── evalIntent ────────────────────────────────────────────────────────────────

test('evalIntent: enrichment keyword passes', () => {
  assert.equal(evalIntent('你应该做 GO/KEGG 富集分析').ok, true);
  assert.equal(evalIntent('This is an enrichment analysis').ok, true);
});

test('evalIntent: unrelated reply fails with intent_misroute', () => {
  const r = evalIntent('你应该做主成分分析');
  assert.equal(r.ok, false);
  assert.equal(r.failure, 'intent_misroute');
});

// ── evalToolSelect ────────────────────────────────────────────────────────────

test('evalToolSelect: exactly go-kegg passes', () => {
  assert.equal(evalToolSelect('go-kegg').ok, true);
});

test('evalToolSelect: wrong tool fails', () => {
  const r = evalToolSelect('deseq2');
  assert.equal(r.ok, false);
  assert.equal(r.failure, 'wrong_tool');
});

test('evalToolSelect: naming multiple tools is ambiguous', () => {
  const r = evalToolSelect('可以用 go-kegg 或 gsea');
  assert.equal(r.ok, false);
  assert.equal(r.failure, 'ambiguous_tool');
});

// ── evalParamFill ─────────────────────────────────────────────────────────────

test('evalParamFill: valid params pass', () => {
  const r = evalParamFill('{"species":"human","analysis_type":"all","gene_id_type":"SYMBOL"}');
  assert.equal(r.ok, true);
});

test('evalParamFill: invalid enum value fails', () => {
  const r = evalParamFill('{"species":"zebrafish"}');
  assert.equal(r.ok, false);
  assert.equal(r.failure, 'invalid_param_value');
});

test('evalParamFill: missing species fails', () => {
  const r = evalParamFill('{"analysis_type":"GO"}');
  assert.equal(r.ok, false);
  assert.equal(r.failure, 'missing_required_param');
});

test('evalParamFill: unparseable fails', () => {
  const r = evalParamFill('no json');
  assert.equal(r.ok, false);
  assert.equal(r.failure, 'unparseable_params');
});

// ── evalToolCalling ───────────────────────────────────────────────────────────

function toolCallResult(name, args) {
  return {
    choices: [{ message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] } }],
  };
}

test('evalToolCalling: correct tool_call with valid args passes', () => {
  const r = evalToolCalling(toolCallResult('run_go_kegg', { species: 'human', analysis_type: 'all' }));
  assert.equal(r.ok, true);
});

test('evalToolCalling: no tool_calls fails', () => {
  const r = evalToolCalling({ choices: [{ message: { content: 'I would call it' } }] });
  assert.equal(r.ok, false);
  assert.equal(r.failure, 'no_tool_call');
});

test('evalToolCalling: wrong tool name fails', () => {
  const r = evalToolCalling(toolCallResult('some_other_tool', {}));
  assert.equal(r.ok, false);
  assert.equal(r.failure, 'wrong_tool_call');
});

test('evalToolCalling: invalid enum arg fails', () => {
  const r = evalToolCalling(toolCallResult('run_go_kegg', { species: 'dog' }));
  assert.equal(r.ok, false);
  assert.equal(r.failure, 'invalid_tool_arg');
});

// ── evalFailureRecovery ───────────────────────────────────────────────────────

test('evalFailureRecovery: id-mapping remedy passes', () => {
  assert.equal(evalFailureRecovery('把 gene_id_type 改成 auto 或 ENSEMBL').ok, true);
  assert.equal(evalFailureRecovery('try switching the mapping to ENTREZID').ok, true);
});

test('evalFailureRecovery: unrelated remedy fails', () => {
  const r = evalFailureRecovery('重启电脑再试一次');
  assert.equal(r.ok, false);
  assert.equal(r.failure, 'wrong_recovery');
});

// ── evalResultInterpret ───────────────────────────────────────────────────────

const PRESENT = ['apoptosis', 'cell cycle', 'p53 signaling'];
const FORBIDDEN = ['photosynthesis', 'nitrogen fixation'];

test('evalResultInterpret: grounded interpretation passes', () => {
  const r = evalResultInterpret('这些基因主要参与 apoptosis 和 cell cycle 调控', PRESENT, FORBIDDEN);
  assert.equal(r.ok, true);
});

test('evalResultInterpret: ungrounded interpretation fails', () => {
  const r = evalResultInterpret('这些基因与代谢有关', PRESENT, FORBIDDEN);
  assert.equal(r.ok, false);
  assert.equal(r.failure, 'ungrounded_interpretation');
});

test('evalResultInterpret: hallucinated terms fail even if partly grounded', () => {
  const r = evalResultInterpret('涉及 apoptosis 与 photosynthesis', PRESENT, FORBIDDEN);
  assert.equal(r.ok, false);
  assert.equal(r.failure, 'hallucinated_terms');
});

// ── scoreTarget ──────────────────────────────────────────────────────────────��

function allPass() {
  return {
    intent: { ok: true, detail: 'ok' },
    tool_select: { ok: true, detail: 'ok' },
    param_fill: { ok: true, detail: 'ok' },
    tool_calling: { ok: true, detail: 'ok' },
    failure_recovery: { ok: true, detail: 'ok' },
    result_interpret: { ok: true, detail: 'ok' },
  };
}

test('scoreTarget: all probes pass → passedBar true', () => {
  const row = scoreTarget('deepseek', allPass());
  assert.equal(row.passedBar, true);
  assert.equal(row.passed, 6);
  assert.equal(row.total, 6);
  assert.equal(row.failures.length, 0);
});

test('scoreTarget: a non-required probe failing does not fail the bar', () => {
  const probes = allPass();
  probes.result_interpret = { ok: false, failure: 'hallucinated_terms', detail: 'x' };
  const row = scoreTarget('deepseek', probes);
  assert.equal(row.passedBar, true, 'result_interpret is graded but not gate-blocking');
  assert.equal(row.requiredFailures.length, 0);
  assert.equal(row.failures.length, 1);
});

test('scoreTarget: a required probe failing fails the bar', () => {
  const probes = allPass();
  probes.tool_calling = { ok: false, failure: 'no_tool_call', detail: 'x' };
  const row = scoreTarget('weak-model', probes);
  assert.equal(row.passedBar, false);
  assert.deepEqual(row.requiredFailures, ['tool_calling']);
});

// ── report rendering ──────────────────────────────────────────────────────────

test('renderMarkdown: contains provider rows and failure classification', () => {
  const probes = allPass();
  probes.tool_calling = { ok: false, failure: 'no_tool_call', detail: 'model did not emit tool_calls' };
  const rows = [scoreTarget('deepseek', allPass()), scoreTarget('weak', probes)];
  const md = renderMarkdown(rows, { generatedAt: '2026-07-18T00:00:00Z' });
  assert.match(md, /Harness 多 Provider 评测报告/);
  assert.match(md, /\| deepseek \|/);
  assert.match(md, /\| weak \|/);
  assert.match(md, /失败分类/);
  assert.match(md, /no_tool_call/);
});

test('renderMarkdown: no failures → "无失败项"', () => {
  const md = renderMarkdown([scoreTarget('deepseek', allPass())], {});
  assert.match(md, /无失败项/);
});

test('renderJson: valid JSON with target probe details', () => {
  const rows = [scoreTarget('deepseek', allPass())];
  const parsed = JSON.parse(renderJson(rows, { generatedAt: '2026-07-18T00:00:00Z' }));
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.targets.length, 1);
  assert.equal(parsed.targets[0].name, 'deepseek');
  assert.equal(parsed.targets[0].passedBar, true);
  assert.equal(parsed.targets[0].probes.intent.ok, true);
});
