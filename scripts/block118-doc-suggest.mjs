#!/usr/bin/env node
/**
 * BLOCK-118 P1 — doc-suggest 文档回写建议（决策原语 dev-time 接点；谨慎档，与 block115 同构）。
 *
 * 用法：
 *   node scripts/block118-doc-suggest.mjs <changed.json> [-o out.json]
 * 输入 JSON：{ changedFiles: ["path/a.js", ...] }
 *
 * 契约红线（plan docs/block-118-dev-decision-tooling-plan.md §2）：
 *  - 建议是独立附加输出：不改变任何既有门禁/流程语义，只提示「可能漏回写的 canonical 文档」；
 *  - 确定性前置层（A 型）：空输入/改动全为 docs/**、acceptance/** → 零建议零出站；
 *  - frontend/src/** 硬规则（AGENTS.md「每个 UI 增量必须同一提交更新 ui-productization-audit」）：
 *    uiAudit 确定性命中，不依赖模型；模型只裁语义残差（roadmap/handoff/auditLog/planDoc）；
 *  - 决策失败/低置信 → 该文档零建议（安全默认），永不 throw；
 *  - 门控经 configForPoint('doc-suggest', outcome.model) 每模型解析（BLOCK-118 P0 契约）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const decisionApi = require('../core/petri-server/helpers/decision-api.js');
const { configForPoint } = require('../core/petri-server/helpers/decision-thresholds.js');
const { docsOrEvidenceOnly } = require('../scripts/block115-test-suggest.mjs');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const SEPARATOR = String.fromCharCode(10);

/** 五个 canonical 回写目标（与 AGENTS.md 治理纪律一一对应）。
 * instructions 必须逐文档专属（D-修订三，2026-09-23 校准抓真）：共用 instructions 时五道
 * noul 答案近乎常数（0.78~0.81 同带，排序≈随机，四文档最优精度=基础正例率）——违反
 * 「原子化窄判断」心法（typesafe-jev-system-one-research.md §1）；专属化后 planDoc 即过门。 */
export const DOC_TARGETS = {
  roadmap: {
    file: 'docs/next-steps-roadmap.md',
    description: '当前优先级 / active 工作包 / 阶段进度变化',
    question: '这次改动是否改变了项目当前优先级、active 工作包或阶段进度（如工作包立项/收口/阶段完成/排队变化），从而需要更新 roadmap？',
  },
  handoff: {
    file: 'docs/project-workspace-handoff.md',
    description: '可恢复状态 / 收口事实 / 会话交接要点变化',
    question: '这次改动是否产生了需要跨会话交接的可恢复状态或收口事实（如新完成的功能、环境变化、待续事项），从而需要更新 handoff？',
  },
  uiAudit: {
    file: 'docs/ui-productization-audit.md',
    description: 'UI 增量（页面/组件/样式/交互）台账',
    question: '这次改动是否包含用户可见的 UI 增量（页面/组件/样式/交互/文案变化），从而需要登记 UI 台账？',
  },
  auditLog: {
    file: 'docs/AUDIT-LOG.md',
    description: '审计发现 / 阻塞 / 广播事项',
    question: '这次改动是否产生或处理了需要向其他 agent 广播的事项（阻塞、契约不一致、待合并、待评估发现），从而需要更新审计台账？',
  },
  planDoc: {
    file: 'docs/*plan*.md',
    description: '对应工作包计划文档的阶段进展 / 状态变化',
    question: '这次改动是否推进了某个工作包计划文档中的阶段或改变其状态（如 P0/P1 完成、门禁结果、收口写回），从而需要更新对应 plan 文档？',
  },
};

/** 确定性硬规则（A 型，永不模型化）：frontend/src 下的 UI 面文件 → uiAudit 必建议。 */
export function deterministicHits(changedFiles) {
  const hits = new Set();
  for (const f of changedFiles || []) {
    const norm = String(f).split('\\').join('/');
    if (norm.startsWith('frontend/src/') && /\.(tsx|ts|css|module\.css)$/i.test(norm)) {
      hits.add('uiAudit');
      break;
    }
  }
  return hits;
}

/** 单源请求组装：state=改动说明（context，意图主信号）+ 代码文件清单（≤600 字符），
 * questions=五道并行 noul（逐文档专属 question——原子化窄判断）。 */
export function buildDocSuggestDecisionRequest(changedFiles, context = '') {
  const ctxLine = context ? `本次改动说明：${String(context).slice(0, 300)}${SEPARATOR}` : '';
  return {
    state: `${ctxLine}本次改动的代码文件清单：
${changedFiles.map((f) => String(f)).join(SEPARATOR).slice(0, 600)}`,
    questions: Object.fromEntries(Object.keys(DOC_TARGETS).map((key) => [key, {
      type: 'noul',
      instructions: DOC_TARGETS[key].question
        + '（治理建议语境：误报代价=多看一眼文档，漏报代价=治理台账缺账；拿不准答 no。）',
    }])),
  };
}

/** 解析每文档生效门控（per-model 覆盖优先，回落 Jev 校准 gates；缺键回落 1=永不采纳=安全默认）。 */
export function resolveGates(model) {
  const config = configForPoint('doc-suggest', model);
  const gates = (config && config.gates) || {};
  const resolved = {};
  for (const key of Object.keys(DOC_TARGETS)) {
    resolved[key] = typeof gates[key] === 'number' ? gates[key] : 1;
  }
  return resolved;
}

/** 决策失败/低置信/前置层命中 → 该文档零建议（安全默认）；永不 throw。 */
export async function resolveDocSuggestions(changedFiles, overrides = {}, context = '') {
  if (!changedFiles || changedFiles.length === 0) return { suggest: false, reason: 'no_input', suggestions: [] };
  if (docsOrEvidenceOnly(changedFiles)) return { suggest: false, reason: 'docs_or_evidence_only', suggestions: [] };
  const forced = deterministicHits(changedFiles);

  let answers = null;
  let model = null;
  let degradedReason = null;
  {
    // forced 至多含 uiAudit（deterministicHits 唯一产出），其余四道始终问模型
    const { state, questions } = buildDocSuggestDecisionRequest(changedFiles, context);
    const gatesForLog = resolveGates(null);
    const minGate = Math.min(...Object.values(gatesForLog));
    const outcome = await decisionApi.askDecision({ state, questions, overrides, meta: { point: 'doc-suggest', threshold: minGate } });
    if (!outcome.ok) {
      degradedReason = outcome.reason;
    } else {
      answers = outcome.answers;
      model = outcome.model;
    }
  }

  const gates = resolveGates(model);
  const perDoc = {};
  const suggestions = [];
  for (const [key, gate] of Object.entries(gates)) {
    if (forced.has(key)) {
      perDoc[key] = { suggested: true, source: 'deterministic', gate, value: null };
      suggestions.push(key);
      continue;
    }
    const answer = answers && answers[key];
    const value = answer && typeof answer.noul === 'number' ? answer.noul : null;
    const suggested = value !== null && value >= gate;
    perDoc[key] = { suggested, source: 'model', gate, value, confidence: answer?.confidence ?? null };
    if (suggested) suggestions.push(key);
  }

  if (!suggestions.length) {
    return { suggest: false, reason: degradedReason || 'below_threshold', perDoc, model, suggestions: [] };
  }
  return { suggest: true, reason: degradedReason ? `partial_degraded:${degradedReason}` : 'adopted', perDoc, model, suggestions };
}

const NEWLINE = String.fromCharCode(10);

async function main() {
  const args = process.argv.slice(2);
  const inputPath = args.find((a) => !a.startsWith('-'));
  const outIdx = args.indexOf('-o');
  const outPath = outIdx !== -1 ? args[outIdx + 1] : null;
  const ctxIdx = args.indexOf('--context');
  const ctxArg = ctxIdx !== -1 ? args[ctxIdx + 1] : null;
  if (!inputPath) {
    console.error('用法：node scripts/block118-doc-suggest.mjs <changed.json> [--context "改动说明"] [-o out.json]');
    process.exit(2);
  }
  const input = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
  const r = await resolveDocSuggestions(input.changedFiles || [], {}, ctxArg ?? input.context ?? '');
  const report = {
    kind: 'block118-doc-suggestions',
    version: '1.1.0',
    generatedAt: new Date().toISOString(),
    changedFiles: input.changedFiles || [],
    context: ctxArg ?? input.context ?? null,
    suggested: r.suggest,
    reason: r.reason,
    model: r.model ?? null,
    suggestions: r.suggestions,
    perDoc: r.perDoc || null,
    note: '建议为增量附加（不替代任何既有门禁/流程语义）；frontend/src 硬规则命中独立于模型；执行与否由人/流程决定。',
  };
  const text = JSON.stringify(report, null, 2) + NEWLINE;
  if (outPath) {
    const abs = path.resolve(outPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, 'utf8');
    console.log(`报告已写入 ${path.relative(root, abs)}`);
  } else process.stdout.write(text);
  console.log(`doc:suggest：${r.suggest ? '建议回写 ' + r.suggestions.join(', ') : '无建议（' + r.reason + '）'}`);
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop());
if (isMain) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
