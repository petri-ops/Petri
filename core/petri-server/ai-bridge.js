/**
 * petri-server/ai-bridge.js — AI Copilot helper requires + globalThis bridge.
 *
 * Extracted from server.js (lines 355-563). Loads the AI/Copilot helpers that
 * are actually consumed (locally or via globalThis bridge) and exposes them on
 * globalThis._petri so modular routes in routes/ can consume without
 * importing petri-server by name.
 *
 * Also bridges TEMP_DIR from the caller so methods-export can use it.
 */

// MEMORY_VECTORS_v1 — only the 3 used in globalThis bridge
const { dashscopeEmbed, saveMemoryVector, cosineSim } = require('./helpers/memory-vectors');

// SITE_SNAPSHOT_v1
const { buildSiteSnapshot } = require('./helpers/site-snapshot');

// DOCS_INDEX_v1
const { fetchDocsIndex, getCachedDocsIndex } = require('./helpers/docs-index');

// ACT_TOOL_v1
const { undoAgentAct } = require('./helpers/act-tool');

// PLAN_TOOL_v1 — persistent plan tables + helpers
// 基础表 DDL 单一事实源在 helpers/plan-lifecycle.js（测试库自举共用）
(function setupPlanTables() {
  const dbMod = require('./db');
  const sqlite = dbMod.getDatabase();
  require('./helpers/plan-lifecycle').ensurePlanBaseSchema(sqlite);
})();

// PLAN_CHAT_LINK_v1（chat_context_excerpt 列已并入 helpers/plan-lifecycle.js
// 的 ensurePlanBaseSchema，测试库自举共用同一事实源）

// BLOCK-55 P1/P2/P3 — Spec 门 + 步骤分派 + 修订历史（全部 additive）
// DDL 单一事实源在 helpers/plan-lifecycle.js（测试库自举共用）
(function migratePlansBlock55() {
  const dbMod = require('./db');
  const sqlite = dbMod.getDatabase();
  require('./helpers/plan-lifecycle').ensureBlock55PlanSchema(sqlite);
})();

const { isAgentGloballyPaused, setAgentGlobalPause } = require('./helpers/admin-gov');

const {
  recordAiUsage,
  estimateCostCNY: _estimateCostCNY,
  AI_PRICING: _AI_PRICING,
} = require('./helpers/ai-usage');

const {
  _gatherAnalysisContextForMethods,
  _renderMethodsParagraph,
  _renderReportPdf,
  _cleanRScriptForExport,
  _scriptHeader,
  _pythonEquivalent,
} = require('./helpers/methods-export');

/**
 * Expose AI helpers on globalThis._petri for modular routes.
 * @param {object} opts — {tempDir} bridged from caller
 */
function setupAiBridge({ tempDir } = {}) {
  globalThis._petriRecordAiUsage = recordAiUsage;

  globalThis._petri = globalThis._petri || {};
  try {
    globalThis._petri.recordAiUsage = recordAiUsage;
  } catch {}
  try {
    globalThis._petri.saveMemoryVector = saveMemoryVector;
  } catch {}
  try {
    globalThis._petri.cosineSim = cosineSim;
  } catch {}
  try {
    globalThis._petri.dashscopeEmbed = dashscopeEmbed;
  } catch {}
  try {
    globalThis._petri.isAgentGloballyPaused = isAgentGloballyPaused;
  } catch {}
  try {
    globalThis._petri.setAgentGlobalPause = setAgentGlobalPause;
  } catch {}
  try {
    globalThis._petri.estimateCostCNY = _estimateCostCNY;
  } catch {}
  try {
    globalThis._petri.AI_PRICING = _AI_PRICING;
  } catch {}
  try {
    globalThis._petri.undoAgentAct = undoAgentAct;
  } catch {}
  try {
    globalThis._petri.buildSiteSnapshot = buildSiteSnapshot;
  } catch {}
  try {
    globalThis._petri.fetchDocsIndex = fetchDocsIndex;
  } catch {}
  try {
    globalThis._petri.docsIndexCache = getCachedDocsIndex;
  } catch {}

  // METHODS_EXPORT — bridge TEMP_DIR so the helper can use it.
  if (tempDir !== undefined) globalThis._petri.TEMP_DIR = tempDir;

  try {
    globalThis._petri.gatherAnalysisContextForMethods = _gatherAnalysisContextForMethods;
  } catch {}
  try {
    globalThis._petri.renderMethodsParagraph = _renderMethodsParagraph;
  } catch {}
  try {
    globalThis._petri.renderReportPdf = _renderReportPdf;
  } catch {}
  try {
    globalThis._petri.cleanRScriptForExport = _cleanRScriptForExport;
  } catch {}
  try {
    globalThis._petri.scriptHeader = _scriptHeader;
  } catch {}
  try {
    globalThis._petri.pythonEquivalent = _pythonEquivalent;
  } catch {}
}

module.exports = { setupAiBridge };
