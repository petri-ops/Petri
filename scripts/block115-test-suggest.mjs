#!/usr/bin/env node
/**
 * scripts/block115-test-suggest.mjs — BLOCK-115 W1-5 增量式测试选择建议 CLI（谨慎档）。
 *
 * 用法：
 *   node scripts/block115-test-suggest.mjs <changed.json> [-o suggestions.json]
 * 输入 JSON：{ changedFiles: ["path/a.js", ...] }
 * 输出：{ suggestions: [...], meta } —— 建议是**独立附加输出**：静态 impact-map 下限
 * （fail-closed）零改动、零依赖，本工具任何分支都不可能减少它（D-5 只加不减）。
 * 决策失败/低置信/none 弃权 → suggestions=[]（零建议=安全默认）。
 * 分类内核导出供契约测试与校准 harness 复用（单源）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const decisionApi = require('../core/biof3-server/helpers/decision-api.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/** D-1（P0 修正）：6 测试域粗粒度分类学（12 域两轮校准 overall 72-74% 平台、相邻域互串占主导——粒度超出路径清单信号；粗化换精度，建议档动作=多跑一个套件）。 */
export const TEST_AREAS = {
  'agent-backend': { description: '后端智能体与决策面（agent 循环/任务存储/子智能体/工具注册与策略/执行策略/decision-api 族）', tests: ['test/block109-p0-baseline.test.mjs', 'test/block49-multi-agent-spawn.test.mjs', 'test/agent-provider-boundary.test.mjs', 'test/block110-decision-api.test.mjs', 'test/block112-intent-routing.test.mjs', 'test/block113-tool-prerouting.test.mjs', 'test/block114-failure-triage.test.mjs'] },
  'conversation-copilot': { description: '会话组装/压缩/事件流与 copilot 客户端（SimpleChat/conversationRunStore 及其子模块）', tests: ['test/conversation-compaction.test.mjs', 'test/history-assembly.test.mjs', 'frontend/src/components/copilot/conversationRunStore.test.ts'] },
  'knowledge-result': { description: '知识空间与结果库（嵌入检索/文档摄取/changeset/修订/artifact/解读）', tests: ['test/block99-knowledge-multispace.test.mjs', 'test/result-ref-transaction.test.mjs'] },
  'ui-shell-frontend': { description: '窗口管理与 UI 壳（TitleBar/左栏/AppRail/主题/页面组件）', tests: ['test/window-manager.test.mjs'] },
  'ipc-preload': { description: 'IPC 通道/preload/desktopBridge/主进程装配与迁移', tests: ['test/ipc-channels-registry.test.mjs'] },
  'infra-platform': { description: 'dev-verify/测试脚本/平台冻结/打包版本/收口门禁脚本', tests: ['test/dev-verify.test.mjs', 'test/platform-branch-freeze.test.mjs'] },
  none: '弃权：仓库文档（docs/**）、验收证据（acceptance/**）、规划与语料文件变更，或无把握——零增量建议（安全默认）',
};

/** D-3（P0 校准证据 acceptance/block-115/calibration.json；调整必须先重校准）。 */
export const SUGGEST_THRESHOLD = 0.8;

export function isSuggestEnabled() {
  return process.env.BIOF3_JEV_TEST_SUGGEST !== '0'; // 注意：本工具默认开（纯建议无副作用，显式 0 关闭）
}

/**
 * 确定性前置层（A 型，P0 校准修正后新增）：改动全部为仓库文档/验收证据时零建议、
 * 零出站——与 D-1 none 语义一致（none 的确定性实现，镜像 BLOCK-114 L1/L2 先例）。
 */
export function docsOrEvidenceOnly(changedFiles) {
  const files = (changedFiles || []).map((f) => String(f).split(String.fromCharCode(92)).join('/'));
  if (files.length === 0) return false;
  return files.every((f) => f.startsWith('docs/') || f.startsWith('acceptance/'));
}

const SEP = String.fromCharCode(10);

export function buildSuggestDecisionRequest(changedFiles) {
  return {
    state: `本次改动的文件清单：
${changedFiles.map((f) => String(f)).join(SEP).slice(0, 600)}`,
    questions: {
      area: {
        type: 'choice',
        criteria: Object.fromEntries(Object.entries(TEST_AREAS).map(([k, v]) => [k, typeof v === 'string' ? v : v.description])),
        instructions:
          '判断这次改动语义上最可能波及哪个测试域（用于建议额外的定向测试）。'
          + '拿不准、纯文档/证据/数据文件变更时选 none（零建议）。',
      },
    },
  };
}

/** 决策失败/低置信/none → 零建议（安全默认）；永不 throw。 */
export async function resolveSuggestion(changedFiles, overrides = {}) {
  if (!changedFiles || changedFiles.length === 0) return { suggest: false, reason: 'no_input', suggestions: [] };
  if (!isSuggestEnabled()) return { suggest: false, reason: 'disabled', suggestions: [] };
  if (docsOrEvidenceOnly(changedFiles)) return { suggest: false, reason: 'docs_or_evidence_only', suggestions: [] };
  const { state, questions } = buildSuggestDecisionRequest(changedFiles);
  const outcome = await decisionApi.askDecision({ state, questions, overrides });
  if (!outcome.ok) return { suggest: false, reason: outcome.reason, suggestions: [] };
  const answer = outcome.answers.area;
  if (answer.choice === 'none') return { suggest: false, reason: 'area_none', area: 'none', confidence: answer.confidence, suggestions: [] };
  if (answer.confidence < SUGGEST_THRESHOLD) {
    return { suggest: false, reason: 'below_threshold', area: answer.choice, confidence: answer.confidence, suggestions: [] };
  }
  const area = TEST_AREAS[answer.choice];
  if (!area || !area.tests) return { suggest: false, reason: 'unknown_area', suggestions: [] };
  return { suggest: true, area: answer.choice, confidence: answer.confidence, suggestions: [...area.tests], reason: 'adopted' };
}

const NEWLINE = String.fromCharCode(10);

async function main() {
  const args = process.argv.slice(2);
  const inputPath = args.find((a) => !a.startsWith('-'));
  const outIdx = args.indexOf('-o');
  const outPath = outIdx !== -1 ? args[outIdx + 1] : null;
  if (!inputPath) {
    console.error('用法：node scripts/block115-test-suggest.mjs <changed.json> [-o suggestions.json]');
    process.exit(2);
  }
  const input = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
  const r = await resolveSuggestion(input.changedFiles || []);
  const report = {
    kind: 'block115-suggestions',
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    changedFiles: input.changedFiles || [],
    suggested: r.suggest,
    area: r.area || null,
    confidence: r.confidence ?? null,
    reason: r.reason,
    suggestions: r.suggestions,
    note: '建议为增量附加（静态 impact-map 下限不受影响）；执行与否由人/流程决定。',
  };
  const text = JSON.stringify(report, null, 2) + NEWLINE;
  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, text, 'utf8');
    console.log(`建议已写入 ${path.relative(root, path.resolve(outPath))}`);
  } else process.stdout.write(text);
  console.log(`建议：${r.suggest ? r.area + '（' + r.suggestions.length + ' 个测试）' : '无（' + r.reason + '）'}`);
}

// CLI 入口判定：被直接执行时运行 main；被 import（测试/校准）时不执行。
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop());
if (isMain) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
