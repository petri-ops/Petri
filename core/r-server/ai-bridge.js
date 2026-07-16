/**
 * r-server/ai-bridge.js — AI Copilot helper requires + globalThis bridge.
 *
 * Extracted from server.js (lines 355-563). Loads the AI/Copilot helpers that
 * are actually consumed (locally or via globalThis bridge) and exposes them on
 * globalThis._biof3 so modular routes in routes/ can consume without
 * importing r-server by name.
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
(function setupPlanTables() {
  const dbMod = require('./db');
  const sqlite = dbMod.getSqliteForLegacyModules();
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS copilot_plans (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      goal TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_copilot_plans_user ON copilot_plans(user_id, status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS copilot_plan_steps (
      plan_id TEXT NOT NULL,
      n INTEGER NOT NULL,
      title TEXT NOT NULL,
      hint TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT,
      ts TEXT NOT NULL,
      PRIMARY KEY (plan_id, n)
    );
  `);
})();

// PLAN_CHAT_LINK_v1
(function migratePlansAddChatContext() {
  const dbMod = require('./db');
  const sqlite = dbMod.getSqliteForLegacyModules();
  try {
    sqlite.exec('ALTER TABLE copilot_plans ADD COLUMN chat_context_excerpt TEXT');
  } catch {
    /* exists */
  }
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
 * Expose AI helpers on globalThis._biof3 for modular routes.
 * @param {object} opts — {tempDir} bridged from caller
 */
function setupAiBridge({ tempDir } = {}) {
  globalThis._biof3RecordAiUsage = recordAiUsage;

  globalThis._biof3 = globalThis._biof3 || {};
  try {
    globalThis._biof3.recordAiUsage = recordAiUsage;
  } catch {}
  try {
    globalThis._biof3.saveMemoryVector = saveMemoryVector;
  } catch {}
  try {
    globalThis._biof3.cosineSim = cosineSim;
  } catch {}
  try {
    globalThis._biof3.dashscopeEmbed = dashscopeEmbed;
  } catch {}
  try {
    globalThis._biof3.isAgentGloballyPaused = isAgentGloballyPaused;
  } catch {}
  try {
    globalThis._biof3.setAgentGlobalPause = setAgentGlobalPause;
  } catch {}
  try {
    globalThis._biof3.estimateCostCNY = _estimateCostCNY;
  } catch {}
  try {
    globalThis._biof3.AI_PRICING = _AI_PRICING;
  } catch {}
  try {
    globalThis._biof3.undoAgentAct = undoAgentAct;
  } catch {}
  try {
    globalThis._biof3.buildSiteSnapshot = buildSiteSnapshot;
  } catch {}
  try {
    globalThis._biof3.fetchDocsIndex = fetchDocsIndex;
  } catch {}
  try {
    globalThis._biof3.docsIndexCache = getCachedDocsIndex;
  } catch {}

  // METHODS_EXPORT — bridge TEMP_DIR so the helper can use it.
  if (tempDir !== undefined) globalThis._biof3.TEMP_DIR = tempDir;

  try {
    globalThis._biof3.gatherAnalysisContextForMethods = _gatherAnalysisContextForMethods;
  } catch {}
  try {
    globalThis._biof3.renderMethodsParagraph = _renderMethodsParagraph;
  } catch {}
  try {
    globalThis._biof3.renderReportPdf = _renderReportPdf;
  } catch {}
  try {
    globalThis._biof3.cleanRScriptForExport = _cleanRScriptForExport;
  } catch {}
  try {
    globalThis._biof3.scriptHeader = _scriptHeader;
  } catch {}
  try {
    globalThis._biof3.pythonEquivalent = _pythonEquivalent;
  } catch {}
}

module.exports = { setupAiBridge };
