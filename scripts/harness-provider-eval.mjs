#!/usr/bin/env node
/**
 * Stage 3 M3 — multi-provider Harness evaluation matrix.
 *
 * Drives the REAL ModelGateway + registered Provider adapters against REAL
 * endpoints and scores each provider across the Harness decision chain for a
 * standard analysis workflow (GO/KEGG enrichment as the first sample):
 *
 *   1. intent        — does the model route a natural-language request to the
 *                      right task pack / tool (go-kegg)?
 *   2. tool_select   — given several candidate tools, does it pick go-kegg?
 *   3. param_fill    — does it produce a parameter object valid against the
 *                      go-kegg input contract (respecting select option sets)?
 *   4. tool_calling  — does a tool schema round-trip to a structured tool_call?
 *   5. failure_recovery — given a real failure mode (gene_id_mapping_failed),
 *                      does it propose the contract's recovery direction?
 *   6. result_interpret — given a small enrichment result table, does it
 *                      produce a grounded interpretation (no hallucinated terms)?
 *
 * This is NOT a unit test and is never run by CI: it needs real credentials
 * and live network. The pure scoring/report functions are unit-tested in
 * test/harness-provider-eval.test.mjs with an injected fake gateway.
 *
 * It does NOT run R. Provisioned r-enrichment bundles / real Rscript are not
 * required — this measures LLM decision quality in the Harness loop, mirroring
 * the (removed) acceptance/stage2/live-provider-check.mjs approach.
 *
 * Secrets: read only from environment variables (source .biof3-secrets first).
 * Never hardcoded, never printed.
 *
 * Usage:
 *   source .biof3-secrets && npm run harness:provider-eval
 *   # optional: EVAL_TARGETS=deepseek,anthropic,openai-compatible
 *               EVAL_REPORT_DIR=eval-reports
 *
 * Exit code: 0 when at least two providers each clear the required-probe bar;
 *            1 otherwise (so it can gate a manual acceptance run).
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const providers = require(resolve(REPO_ROOT, 'core/shared-backend/llm-providers/index.js'));
const { ModelGateway, getProvider } = providers;
const aiUsageHelper = require(resolve(REPO_ROOT, 'core/shared-backend/ai-usage-helper.js'));
// Keep eval runs from touching the usage DB.
aiUsageHelper.configure({ recordAiUsage: () => {} });

const CHECK = '\u2713';
const CROSS = '\u2717';
const DASH = '\u2013';

// ── environment / target resolution ──────────────────────────────────────────

function env(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Resolve evaluation targets from environment. Reuses the credential field
 * names established by the (removed) Stage 2 live-provider-check so an existing
 * .biof3-secrets keeps working.
 */
export function resolveTargets(getEnv = env) {
  const selected = (getEnv('EVAL_TARGETS') || 'deepseek,anthropic,openai-compatible')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const targets = [];

  if (selected.includes('deepseek') && getEnv('DEEPSEEK_API_KEY')) {
    targets.push({
      name: 'deepseek',
      provider: 'deepseek',
      model: getEnv('DEEPSEEK_MODEL') || 'deepseek-chat',
      baseUrl: getEnv('DEEPSEEK_BASE_URL'),
      apiKey: getEnv('DEEPSEEK_API_KEY'),
    });
  }
  if (selected.includes('anthropic') && getEnv('ANTHROPIC_API_KEY')) {
    targets.push({
      name: 'anthropic',
      provider: 'anthropic',
      model: getEnv('ANTHROPIC_MODEL'),
      baseUrl: getEnv('ANTHROPIC_BASE_URL'),
      apiKey: getEnv('ANTHROPIC_API_KEY'),
    });
  }
  if (
    selected.includes('openai-compatible') &&
    getEnv('OPENAI_COMPATIBLE_API_KEY') &&
    getEnv('OPENAI_COMPATIBLE_BASE_URL') &&
    getEnv('OPENAI_COMPATIBLE_MODEL')
  ) {
    targets.push({
      name: 'openai-compatible',
      provider: 'openai-compatible',
      model: getEnv('OPENAI_COMPATIBLE_MODEL'),
      baseUrl: getEnv('OPENAI_COMPATIBLE_BASE_URL'),
      apiKey: getEnv('OPENAI_COMPATIBLE_API_KEY'),
    });
  }
  return targets;
}

export function formatTargetLabel(target) {
  return `评测中：${target.name} (provider=${target.provider})`;
}

function makeGateway(target) {
  const profileId = `${target.name}-profile`;
  const profile = {
    id: profileId,
    label: target.name,
    provider: target.provider,
    model: target.model,
    credentialRef: `provider:${target.provider}`,
    capabilities: ['chat', 'streaming', 'tools'],
    roles: ['chat', 'agent'],
  };
  if (target.baseUrl) profile.baseUrl = target.baseUrl;
  return new ModelGateway({
    getSettings: () => ({
      model_profiles: [profile],
      model_role_bindings: { chat: profileId, agent: profileId },
    }),
    getCredential: () => target.apiKey || '',
    getProvider,
  });
}

// ── probe fixtures grounded in the go-kegg contract ──────────────────────────

const GO_KEGG_TOOLS = ['deseq2', 'go-kegg', 'gsea', 'volcano-plot', 'pca-explorer'];
const GO_KEGG_SELECT_OPTIONS = {
  species: ['human', 'mouse'],
  analysis_type: ['all', 'GO', 'GO-BP', 'GO-MF', 'GO-CC', 'KEGG'],
  gene_id_type: ['SYMBOL', 'ENSEMBL', 'ENTREZID', 'auto'],
};

const ENRICH_TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'run_go_kegg',
    description: '对差异表达基因做 GO/KEGG 功能富集分析',
    parameters: {
      type: 'object',
      properties: {
        species: { type: 'string', enum: GO_KEGG_SELECT_OPTIONS.species },
        analysis_type: { type: 'string', enum: GO_KEGG_SELECT_OPTIONS.analysis_type },
        gene_id_type: { type: 'string', enum: GO_KEGG_SELECT_OPTIONS.gene_id_type },
      },
      required: ['species'],
    },
  },
};

// ── pure evaluators (unit-tested) ────────────────────────────────────────────

function messageContent(result) {
  const message = result && result.choices && result.choices[0] && result.choices[0].message;
  if (message && typeof message.content === 'string') return message.content;
  if (result && typeof result.content === 'string') return result.content;
  return '';
}

function toolCalls(result) {
  const message = result && result.choices && result.choices[0] && result.choices[0].message;
  return (message && message.tool_calls) || [];
}

/** Extract the first {...} JSON object from a possibly chatty reply. */
export function extractJsonObject(text) {
  if (typeof text !== 'string') return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** intent: reply should name the enrichment/go-kegg route. */
export function evalIntent(reply) {
  const text = String(reply || '').toLowerCase();
  const hit = /go[\s/-]?kegg|kegg|富集|enrichment|go\b/.test(text);
  return hit
    ? { ok: true, detail: 'routed to enrichment/go-kegg' }
    : { ok: false, failure: 'intent_misroute', detail: `no enrichment keyword in reply: "${text.slice(0, 40)}"` };
}

/** tool_select: reply should choose exactly go-kegg from the candidate set. */
export function evalToolSelect(reply) {
  const text = String(reply || '').toLowerCase();
  if (!text.includes('go-kegg')) {
    return { ok: false, failure: 'wrong_tool', detail: 'did not name go-kegg' };
  }
  const otherHits = GO_KEGG_TOOLS.filter((t) => t !== 'go-kegg' && text.includes(t));
  if (otherHits.length > 0) {
    return { ok: false, failure: 'ambiguous_tool', detail: `also named: ${otherHits.join(',')}` };
  }
  return { ok: true, detail: 'selected go-kegg' };
}

/** param_fill: JSON params must respect the select option sets. */
export function evalParamFill(reply) {
  const obj = extractJsonObject(reply);
  if (!obj || typeof obj !== 'object') {
    return { ok: false, failure: 'unparseable_params', detail: 'no JSON object found' };
  }
  for (const [key, allowed] of Object.entries(GO_KEGG_SELECT_OPTIONS)) {
    if (obj[key] !== undefined && !allowed.includes(obj[key])) {
      return { ok: false, failure: 'invalid_param_value', detail: `${key}=${JSON.stringify(obj[key])} not in [${allowed.join(',')}]` };
    }
  }
  if (obj.species === undefined) {
    return { ok: false, failure: 'missing_required_param', detail: 'species missing' };
  }
  return { ok: true, detail: `params ok (species=${obj.species}${obj.analysis_type ? `, analysis_type=${obj.analysis_type}` : ''})` };
}

/** tool_calling: a structured tool_call must be emitted with valid enum args. */
export function evalToolCalling(result) {
  const calls = toolCalls(result);
  if (!calls.length) {
    return { ok: false, failure: 'no_tool_call', detail: 'model did not emit tool_calls (may be weak model)' };
  }
  const call = calls[0];
  const name = call.function && call.function.name;
  if (name !== 'run_go_kegg') {
    return { ok: false, failure: 'wrong_tool_call', detail: `called ${name}` };
  }
  let args = {};
  try {
    args = JSON.parse((call.function && call.function.arguments) || '{}');
  } catch {
    return { ok: false, failure: 'unparseable_tool_args', detail: 'arguments not valid JSON' };
  }
  for (const [key, allowed] of Object.entries(GO_KEGG_SELECT_OPTIONS)) {
    if (args[key] !== undefined && !allowed.includes(args[key])) {
      return { ok: false, failure: 'invalid_tool_arg', detail: `${key}=${args[key]}` };
    }
  }
  return { ok: true, detail: `tool_call run_go_kegg(${JSON.stringify(args).slice(0, 50)})` };
}

/** failure_recovery: reply must point at the contract's recovery direction
 *  for gene_id_mapping_failed (switch gene_id_type / try auto). */
export function evalFailureRecovery(reply) {
  const text = String(reply || '').toLowerCase();
  const mentionsId = /gene_id_type|id 类型|id类型|symbol|ensembl|entrezid|映射|mapping|auto/.test(text);
  return mentionsId
    ? { ok: true, detail: 'suggested gene_id_type switch / auto detection' }
    : { ok: false, failure: 'wrong_recovery', detail: `no id-mapping remedy: "${text.slice(0, 40)}"` };
}

/** result_interpret: interpretation must reference terms actually present in
 *  the given table and not invent unrelated pathways. */
export function evalResultInterpret(reply, presentTerms, forbiddenTerms) {
  const text = String(reply || '').toLowerCase();
  const grounded = presentTerms.some((t) => text.includes(t.toLowerCase()));
  const hallucinated = forbiddenTerms.filter((t) => text.includes(t.toLowerCase()));
  if (!grounded) {
    return { ok: false, failure: 'ungrounded_interpretation', detail: 'referenced none of the actual terms' };
  }
  if (hallucinated.length > 0) {
    return { ok: false, failure: 'hallucinated_terms', detail: `invented: ${hallucinated.join(',')}` };
  }
  return { ok: true, detail: 'grounded in actual enrichment terms' };
}

// ── probe definitions (required flag drives pass/fail bar) ────────────────────

const REQUIRED_PROBES = new Set(['intent', 'tool_select', 'param_fill', 'tool_calling']);

/**
 * Aggregate per-target probe results into a scored row. A target "passes" the
 * bar when every REQUIRED probe is ok (interpretation/recovery are graded but
 * not gate-blocking, matching how weak models may skip nuance).
 */
export function scoreTarget(name, probeResults) {
  const probes = { ...probeResults };
  const passed = Object.values(probes).filter((p) => p && p.ok).length;
  const total = Object.keys(probes).length;
  const requiredFailures = Object.entries(probes)
    .filter(([id, r]) => REQUIRED_PROBES.has(id) && !(r && r.ok))
    .map(([id]) => id);
  const failures = Object.entries(probes)
    .filter(([, r]) => r && !r.ok && r.failure)
    .map(([id, r]) => ({ probe: id, failure: r.failure, detail: r.detail }));
  return {
    name,
    passed,
    total,
    passedBar: requiredFailures.length === 0,
    requiredFailures,
    failures,
    probes,
  };
}

// ── report rendering (unit-tested) ───────────────────────────────────────────

const PROBE_ORDER = ['intent', 'tool_select', 'param_fill', 'tool_calling', 'failure_recovery', 'result_interpret'];
const PROBE_LABELS = {
  intent: 'Intent 识别',
  tool_select: '工具选型',
  param_fill: '参数填充',
  tool_calling: 'Tool Calling',
  failure_recovery: '失败恢复',
  result_interpret: '结果解释',
};

function mark(res) {
  if (!res) return DASH;
  return res.ok ? CHECK : CROSS;
}

export function renderMarkdown(rows, meta = {}) {
  const lines = [];
  lines.push('# Harness 多 Provider 评测报告 (Stage 3 M3)');
  lines.push('');
  lines.push(`- 生成时间：${meta.generatedAt || new Date().toISOString()}`);
  lines.push(`- 样板流程：${meta.workflow || 'GO/KEGG 富集'}`);
  lines.push(`- 说明：评测 LLM 在 Harness 决策链各环节的表现，不执行 R 分析。`);
  lines.push('');
  lines.push(`| Provider | ${PROBE_ORDER.map((p) => PROBE_LABELS[p]).join(' | ')} | 通过必需项 |`);
  lines.push(`| --- | ${PROBE_ORDER.map(() => '---').join(' | ')} | --- |`);
  for (const row of rows) {
    const cells = PROBE_ORDER.map((p) => mark(row.probes[p]));
    lines.push(`| ${row.name} | ${cells.join(' | ')} | ${row.passedBar ? CHECK : CROSS} |`);
  }
  lines.push('');

  // Failure classification section
  const anyFailures = rows.some((r) => r.failures.length > 0);
  lines.push('## 失败分类');
  lines.push('');
  if (!anyFailures) {
    lines.push('无失败项。');
  } else {
    lines.push('| Provider | 环节 | 失败分类 | 细节 |');
    lines.push('| --- | --- | --- | --- |');
    for (const row of rows) {
      for (const f of row.failures) {
        lines.push(`| ${row.name} | ${PROBE_LABELS[f.probe] || f.probe} | \`${f.failure}\` | ${(f.detail || '').replace(/\|/g, '\\|')} |`);
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function renderJson(rows, meta = {}) {
  return JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: meta.generatedAt || new Date().toISOString(),
      workflow: meta.workflow || 'GO/KEGG 富集',
      note: 'LLM decision-chain evaluation; does not execute R.',
      targets: rows.map((r) => ({
        name: r.name,
        passed: r.passed,
        total: r.total,
        passedBar: r.passedBar,
        requiredFailures: r.requiredFailures,
        failures: r.failures,
        probes: Object.fromEntries(
          Object.entries(r.probes).map(([id, res]) => [id, { ok: !!(res && res.ok), failure: res && res.failure, detail: res && res.detail }]),
        ),
      })),
    },
    null,
    2,
  );
}

// ── live probes (network; not unit-tested) ───────────────────────────────────

async function runProbesForTarget(target) {
  const gateway = makeGateway(target);
  const probes = {};

  // 1. intent
  {
    const r = await gateway.chat({
      role: 'chat',
      body: {
        messages: [{ role: 'user', content: '我有一份 DESeq2 差异表达结果，想知道这些基因参与了哪些生物学通路和功能。应该做哪种分析？只用一句话回答分析名称。' }],
        max_tokens: 120,
      },
      telemetry: { kind: 'eval_intent' },
    });
    probes.intent = r && r.error ? { ok: false, failure: 'api_error', detail: JSON.stringify(r.error).slice(0, 80) } : evalIntent(messageContent(r));
  }

  // 2. tool_select
  {
    const r = await gateway.chat({
      role: 'chat',
      body: {
        messages: [{
          role: 'user',
          content: `从以下工具中选出做功能富集分析最合适的一个，只回复工具 id：${GO_KEGG_TOOLS.join(', ')}`,
        }],
        max_tokens: 40,
      },
      telemetry: { kind: 'eval_tool_select' },
    });
    probes.tool_select = r && r.error ? { ok: false, failure: 'api_error', detail: JSON.stringify(r.error).slice(0, 80) } : evalToolSelect(messageContent(r));
  }

  // 3. param_fill
  {
    const r = await gateway.chat({
      role: 'chat',
      body: {
        messages: [{
          role: 'user',
          content: '为人类样本的 GO 和 KEGG 富集分析生成参数 JSON。可选字段：species(human|mouse)、analysis_type(all|GO|GO-BP|GO-MF|GO-CC|KEGG)、gene_id_type(SYMBOL|ENSEMBL|ENTREZID|auto)。基因名是标准 symbol。只输出 JSON。',
        }],
        max_tokens: 200,
      },
      telemetry: { kind: 'eval_param_fill' },
    });
    probes.param_fill = r && r.error ? { ok: false, failure: 'api_error', detail: JSON.stringify(r.error).slice(0, 80) } : evalParamFill(messageContent(r));
  }

  // 4. tool_calling
  {
    const r = await gateway.chat({
      role: 'agent',
      body: {
        messages: [{ role: 'user', content: '请对人类样本调用 run_go_kegg 工具做全部富集分析（GO+KEGG），基因名是标准 symbol。你必须调用该工具。' }],
        tools: [ENRICH_TOOL_SCHEMA],
        tool_choice: 'auto',
        max_tokens: 256,
      },
      telemetry: { kind: 'eval_tool_calling' },
    });
    probes.tool_calling = r && r.error ? { ok: false, failure: 'api_error', detail: JSON.stringify(r.error).slice(0, 80) } : evalToolCalling(r);
  }

  // 5. failure_recovery
  {
    const r = await gateway.chat({
      role: 'chat',
      body: {
        messages: [{
          role: 'user',
          content: 'GO/KEGG 富集分析报错：bitr 无法把基因名映射到 ENTREZID，"no gene can be mapped"。当前 gene_id_type=SYMBOL。应该怎么修复？简短回答。',
        }],
        max_tokens: 160,
      },
      telemetry: { kind: 'eval_failure_recovery' },
    });
    probes.failure_recovery = r && r.error ? { ok: false, failure: 'api_error', detail: JSON.stringify(r.error).slice(0, 80) } : evalFailureRecovery(messageContent(r));
  }

  // 6. result_interpret
  {
    const presentTerms = ['apoptosis', 'cell cycle', 'p53 signaling'];
    const forbiddenTerms = ['photosynthesis', 'nitrogen fixation'];
    const r = await gateway.chat({
      role: 'chat',
      body: {
        messages: [{
          role: 'user',
          content: 'GO/KEGG 富集结果 top 通路：apoptosis (p=0.001), cell cycle (p=0.003), p53 signaling (p=0.008)。请用两句话解读这些结果的生物学意义，只基于给出的通路。',
        }],
        max_tokens: 220,
      },
      telemetry: { kind: 'eval_result_interpret' },
    });
    probes.result_interpret = r && r.error
      ? { ok: false, failure: 'api_error', detail: JSON.stringify(r.error).slice(0, 80) }
      : evalResultInterpret(messageContent(r), presentTerms, forbiddenTerms);
  }

  return probes;
}

function printRow(row) {
  console.log(`\n- ${row.name}  [${row.passedBar ? 'PASS' : 'FAIL'}]  ${row.passed}/${row.total} probes`);
  for (const id of PROBE_ORDER) {
    const res = row.probes[id];
    if (!res) continue;
    console.log(`    ${mark(res)} ${PROBE_LABELS[id].padEnd(14)} ${res.detail || ''}`);
  }
}

async function main() {
  console.log('BioF3 Stage 3 M3 — Harness 多 Provider 评测（真实网络）\n');
  const targets = resolveTargets();
  if (targets.length === 0) {
    console.log('未配置任何评测目标。请先 source .biof3-secrets（需要 DEEPSEEK_API_KEY 和/或 ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL + ANTHROPIC_MODEL）。');
    console.log('可选：EVAL_TARGETS=deepseek,anthropic 控制评测哪些目标。');
    process.exit(0);
  }

  const rows = [];
  for (const target of targets) {
    // Keep live acceptance logs shareable: endpoint URLs, credentials and
    // deployment-specific model names are intentionally omitted.
    console.log(formatTargetLabel(target));
    let probes;
    try {
      probes = await runProbesForTarget(target);
    } catch (e) {
      probes = { intent: { ok: false, failure: 'exception', detail: e.message } };
    }
    const row = scoreTarget(target.name, probes);
    rows.push(row);
    printRow(row);
  }

  const meta = { generatedAt: new Date().toISOString(), workflow: 'GO/KEGG 富集' };
  const reportDir = env('EVAL_REPORT_DIR') || join(REPO_ROOT, 'eval-reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = meta.generatedAt.replace(/[:.]/g, '-');
  const mdPath = join(reportDir, `provider-eval-${stamp}.md`);
  const jsonPath = join(reportDir, `provider-eval-${stamp}.json`);
  fs.writeFileSync(mdPath, renderMarkdown(rows, meta));
  fs.writeFileSync(jsonPath, renderJson(rows, meta));

  console.log(`\n报告已写入：\n  ${mdPath}\n  ${jsonPath}`);

  const passedCount = rows.filter((r) => r.passedBar).length;
  console.log(`\n通过必需项的 Provider：${passedCount}/${rows.length}`);
  if (passedCount < 2) {
    console.log('未达 Stage 3 出口判据（需 ≥2 个 Provider 通过必需项）。');
    process.exit(1);
  }
  console.log('达到 Stage 3 M3 评测判据（≥2 个 Provider 通过必需项）。');
  process.exit(0);
}

// Only run when invoked directly, not when imported by tests.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error('eval run failed:', e);
    process.exit(1);
  });
}
