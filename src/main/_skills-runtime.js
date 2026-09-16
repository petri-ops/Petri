// ============================================================
// Skills runtime helpers — SDK init, progress poller lifecycle
//
// Extracted from src/main.js by SUB-15.1 PHASE 2.
// Original locations:
//   L547-570 (_getSkillsSDK)
//   L572-582 (_publishSkillProgress)
//   L584-590 (_stopSkillsProgressPollerIfIdle)
//   L592-620 (_startSkillsProgressPoller)
//
// Shared mutable state (skillsSDK / _activeSkillRuntimes /
// _lastCheckpointCount / _skillsProgressTimer) stays in main.js
// as module-level variables. The 4 helper functions below receive
// refs to those variables via dependency injection.
//
// _mapSkillRuntimeStatus is loaded from src/_mapSkillRuntimeStatus.js
// (plain Node module, safe for node --check in non-Electron context).
// ============================================================
const CHANNELS = require('../ipc/channels');

const { _mapSkillRuntimeStatus } = require("../_mapSkillRuntimeStatus");

/**
 * Lazy-init the Skills SDK singleton.
 *
 * @param {object} ctx
 * @param {function} ctx.resolveCore  — resolveCore() from core-utils
 * @param {object} ctx.refs            — mutable refs owned by main.js
 * @param {object} ctx.refs.skillsSDKRef — { current: null|object }
 */
function _getSkillsSDK({ resolveCore, refs }) {
  if (refs.skillsSDKRef.current) return refs.skillsSDKRef.current;
  try {
    const sdkMod = require(resolveCore("shared-backend", "skills-sdk.js"));
    const engineMod = require(resolveCore("shared-backend", "workflow-engine.js"));
    // createDefaultSDK: high-level wrapper with registry defaults (verified in v1.0 PHASE 1).
    // createSkillsSDK: low-level factory — fallback only.
    const { createSkillsSDK, createDefaultSDK } = sdkMod;
    const { createWorkflowEngine } = engineMod;
    const base = createDefaultSDK ? createDefaultSDK() : createSkillsSDK();
    const sdk = base;
    sdk.workflowEngine = createWorkflowEngine({ sdk: base });
    refs.skillsSDKRef.current = sdk;
    console.log("[desktop] skills SDK initialized");
    return refs.skillsSDKRef.current;
  } catch (e) {
    console.warn("[desktop] skills SDK init failed:", e.message);
    return null;
  }
}

/**
 * Push a skills:progress IPC message to the renderer.
 *
 * @param {object} ctx
 * @param {function} ctx.getMainWindow — () => BrowserWindow|null
 * @param {string} executionId
 * @param {object} payload
 */
function _publishSkillProgress({ getMainWindow }, executionId, payload) {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  try {
    mainWindow.webContents.send(CHANNELS.skills.progress, { executionId, ...payload });
  } catch (e) {
    // webContents.send errors (e.g. main window closing) must not bubble to poller tick
    if (typeof console !== "undefined" && console.warn) {
      console.warn(`[desktop] skills progress publish failed for ${executionId}:`, e && e.message);
    }
  }
}

/**
 * Stop the progress poller timer when no active runtimes remain.
 *
 * @param {object} ctx
 * @param {object} ctx.refs
 * @param {object} ctx.refs.skillsProgressTimerRef — { current: null|Timeout }
 * @param {Map}    ctx.refs.activeRuntimesRef      — { current: Map }
 */
function _stopSkillsProgressPollerIfIdle({ refs }) {
  const { activeRuntimesRef, skillsProgressTimerRef } = refs;
  if (skillsProgressTimerRef.current && activeRuntimesRef.current.size === 0) {
    clearInterval(skillsProgressTimerRef.current);
    skillsProgressTimerRef.current = null;
  }
}

/**
 * Start (or no-op if already running) the progress poller interval.
 * Polls each active runtime every 1 s; emits skills:progress on
 * checkpoint count changes; stops automatically when all runtimes reach
 * a terminal state.
 *
 * @param {object} ctx
 * @param {function} ctx.getMainWindow
 * @param {object} ctx.refs
 */
function _startSkillsProgressPoller({ getMainWindow, refs }) {
  const { skillsProgressTimerRef, activeRuntimesRef, lastCheckpointCountRef } = refs;
  if (skillsProgressTimerRef.current) return;
  skillsProgressTimerRef.current = setInterval(() => {
    for (const [executionId, runtime] of activeRuntimesRef.current.entries()) {
      try {
        const execCtx = typeof runtime.getExecutionStatus === "function"
          ? runtime.getExecutionStatus(executionId)
          : null;
        if (!execCtx) continue;
        const checkpoints = Array.isArray(execCtx.checkpoints) ? execCtx.checkpoints : [];
        const lastCount = lastCheckpointCountRef.current.get(executionId) || 0;
        if (checkpoints.length !== lastCount) {
          lastCheckpointCountRef.current.set(executionId, checkpoints.length);
          _publishSkillProgress({ getMainWindow }, executionId, {
            status: _mapSkillRuntimeStatus(execCtx.status),
            checkpoints: checkpoints.slice(),
          });
        }
        // Terminal states: self-clean
        if (["complete", "failed", "cancelled"].includes(execCtx.status)) {
          activeRuntimesRef.current.delete(executionId);
          lastCheckpointCountRef.current.delete(executionId);
        }
      } catch {}
    }
    // BLOCK-3 P2 A2: check idle stop on every tick
    _stopSkillsProgressPollerIfIdle({ refs });
  }, 1000);
}

module.exports = {
  _getSkillsSDK,
  _publishSkillProgress,
  _stopSkillsProgressPollerIfIdle,
  _startSkillsProgressPoller,
};
