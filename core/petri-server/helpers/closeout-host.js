'use strict';

/**
 * helpers/closeout-host.js — BLOCK-337 P4/P5 closeout 宿主原语的生产 deps 实现。
 *
 * 复用 closeout-gates.mjs（BLOCK-71 收口聚合器，纯 CLI）经子进程执行——不抽函数、
 * 不另建第二套门禁判定，completed 判定与 `npm run closeout` 走同一入口（同一真相）。
 * 退出码 0 → verdict 'ready'（可宣称 completed）；非 0 → 'blocked'（不可宣称）。
 * P5：ledger 载荷只在全绿时渲染三块草稿（closeout-ledger 纯函数）——不绿即 blocked，
 * 落账无从谈起。
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const { renderCloseoutLedgerDraft } = require('../../shared-backend/governance/closeout-ledger');

const CLOSEOUT_SCRIPT = path.join('.agents', 'skills', 'petri-dev-infra', 'scripts', 'closeout-gates.mjs');
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_LEDGER_BLOCK_CHARS = 4 * 1024;

function sanitizeGates(value) {
  if (!Array.isArray(value)) return null;
  return value
    .filter((gate) => typeof gate === 'string' && gate.trim())
    .map((gate) => gate.trim())
    .slice(0, 16);
}

/**
 * @param {{cwd?: string, timeoutMs?: number}} options
 * @returns {(payload: {gates?: string[], noTests?: boolean, forceFull?: boolean,
 *   ledger?: object, signal?: AbortSignal}) => Promise<object>}
 */
function createCloseoutHost({ cwd = path.resolve(__dirname, '..', '..', '..'), timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return async function closeout(options = {}) {
    if (options.signal && options.signal.aborted) {
      return { ok: false, verdict: 'cancelled', error: 'closeout_cancelled' };
    }
    const gates = sanitizeGates(options.gates);
    const args = [path.join(cwd, CLOSEOUT_SCRIPT)];
    for (const gate of gates || []) args.push('--gate', gate);
    if (options.noTests === true) args.push('--no_tests');
    if (options.forceFull === true) args.push('--force-full');

    const startedAt = Date.now();
    const finished = await new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const child = spawn(process.execPath, args, { cwd, env: { ...process.env } });
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already dead */ }
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (stdout.length > 256 * 1024) stdout = stdout.slice(-131072);
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
        if (stderr.length > 65536) stderr = stderr.slice(-32768);
      });
      child.on('error', (error) => {
        if (!settled) { settled = true; clearTimeout(timer); resolve({ exitCode: null, error: String((error && error.message) || error) }); }
      });
      child.on('close', (code, signal) => {
        if (!settled) { settled = true; clearTimeout(timer); resolve({ exitCode: code, signal, stdout, stderr }); }
      });
    });
    const durationMs = Date.now() - startedAt;
    if (finished.error) return { ok: false, verdict: 'failed', error: finished.error, durationMs };

    const ok = finished.exitCode === 0;
    const result = {
      ok,
      verdict: ok ? 'ready' : 'blocked',
      exitCode: finished.exitCode,
      gates: gates || 'default-full-chain',
      noTests: options.noTests === true,
      forceFull: options.forceFull === true,
      durationMs,
    };
    if (finished.signal) result.signal = finished.signal;
    if (!ok) {
      result.tail = String(finished.stderr || finished.stdout || '').slice(-800);
      return result;
    }
    if (options.ledger && typeof options.ledger === 'object') {
      try {
        const draft = renderCloseoutLedgerDraft(options.ledger);
        result.ledgerDraft = {
          nextStepBrief: draft.nextStepBrief.slice(0, MAX_LEDGER_BLOCK_CHARS),
          auditLogRow: draft.auditLogRow.slice(0, MAX_LEDGER_BLOCK_CHARS),
          handoffResume: draft.handoffResume.slice(0, MAX_LEDGER_BLOCK_CHARS),
        };
      } catch (error) {
        result.ledgerDraftError = String((error && error.message) || error).slice(0, 200);
      }
    }
    return result;
  };
}

module.exports = { createCloseoutHost, CLOSEOUT_SCRIPT };
