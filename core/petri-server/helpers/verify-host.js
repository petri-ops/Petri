'use strict';

/**
 * helpers/verify-host.js — BLOCK-335 P1 验证器宿主（verify 原语 + loop 决策验证器的生产实现）。
 *
 * 验证器 = 既有门禁的**结构化读取面**，不建第二验证器（红线）：
 *   - kind 'test-affected'：子进程跑 `node scripts/test-affected.mjs --run --report <tmp>`
 *     （在目标工作区内），消费 schema 校验过的 report JSON（test/impact-map 同源影响面）；
 *   - kind 'evals-gate'：子进程跑 `node scripts/evals-gate.mjs`（BLOCK-181 判据棘轮）。
 * 退出码映射：0 → 'ready'；1 → 'blocked'（红）；2 → 'blocked'（未映射≠fail-closed，
 * 但无法证明绿，按红处理）；崩溃/超时 → 'blocked' + errorHead（红即红，不伪装）。
 * 需重启面（P3）：report 的改动域触及 safe 前缀（scripts/test/frontend/docs/resources/
 * acceptance/evals）之外 → restartRequired=true，驾驶员判 block(needs_restart) 如实留人工。
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VERIFY_KINDS = Object.freeze(['test-affected', 'evals-gate']);
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_REPORT_CHARS = 256 * 1024;
/** 改动域 v1 安全前缀：不需重启即可验证的面（plan P3）。 */
const RESTART_SAFE_PREFIXES = Object.freeze([
  'scripts/',
  'test/',
  'frontend/',
  'docs/',
  'resources/',
  'acceptance/',
  'evals/',
  '.agents/',
]);

function sanitizeTimeout(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(n, DEFAULT_TIMEOUT_MS);
}

/** 改动域是否触及需重启面（第一个越界文件即答案）。 */
function detectRestartRequired(changedFiles) {
  for (const file of Array.isArray(changedFiles) ? changedFiles : []) {
    const rel = String(file || '').replace(/^\.\//, '');
    if (!RESTART_SAFE_PREFIXES.some((prefix) => rel.startsWith(prefix))) {
      return { restartRequired: true, restartReason: rel };
    }
  }
  return { restartRequired: false, restartReason: null };
}

function parseReportFile(reportPath) {
  try {
    const text = fs.readFileSync(reportPath, 'utf8').slice(0, MAX_REPORT_CHARS);
    const parsed = JSON.parse(text);
    return {
      changedFiles: Array.isArray(parsed && parsed.plan && parsed.plan.changedFiles) ? parsed.plan.changedFiles : [],
      testsCount: Array.isArray(parsed && parsed.tests) ? parsed.tests.length : 0,
      unknownCount: Array.isArray(parsed && parsed.unknown) ? parsed.unknown.length : 0,
    };
  } catch {
    return { changedFiles: [], testsCount: 0, unknownCount: 0 };
  }
}

function runChild(cwd, args, { timeoutMs, signal }) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(process.execPath, args, { cwd, windowsHide: true, env: { ...process.env } });
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    if (signal) {
      if (signal.aborted) { try { child.kill('SIGKILL'); } catch { /* dead */ } }
      else signal.addEventListener('abort', () => { try { child.kill('SIGKILL'); } catch { /* dead */ } }, { once: true });
    }
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > MAX_REPORT_CHARS) stdout = stdout.slice(-MAX_REPORT_CHARS / 2);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 65536) stderr = stderr.slice(-32768);
    });
    child.on('error', (error) => {
      if (!settled) { settled = true; clearTimeout(timer); resolve({ exitCode: null, error: String((error && error.message) || error), stdout: '', stderr: '' }); }
    });
    child.on('close', (code) => {
      if (!settled) { settled = true; clearTimeout(timer); resolve({ exitCode: code, error: null, stdout, stderr }); }
    });
  });
}

/**
 * @param {{getProject?: function}} options
 * @returns {(payload: {kind?: string, projectId?: string, timeoutMs?: number,
 *   signal?: AbortSignal}) => Promise<object>}
 */
function createVerifyHost({ getProject } = {}) {
  return async function verify(options = {}) {
    const kind = VERIFY_KINDS.includes(options.kind) ? options.kind : 'test-affected';
    const timeoutMs = sanitizeTimeout(options.timeoutMs);
    if (options.signal && options.signal.aborted) {
      return { ok: false, verdict: 'blocked', errorHead: 'verify_cancelled', kind, exitCode: null };
    }
    // 工作区解析：显式 cwd 不开放给沙箱脚本（防伪造）；只认 projectId → projects 表
    let cwd = null;
    if (options.projectId) {
      try {
        // db 懒取且仅注入未提供时 require（测试进程不拉真库；require 失败=红，不伪装绿）
        const dbMod = typeof getProject === 'function' ? null : require('../db');
        const lookup = typeof getProject === 'function' ? getProject : dbMod.getProject;
        const project = typeof lookup === 'function' ? lookup(String(options.projectId)) : null;
        cwd = project && typeof project.workspace_path === 'string' ? project.workspace_path : null;
      } catch { /* db 故障 → workspace 缺失 → 红 */ }
    }
    if (!cwd || !fs.existsSync(cwd)) {
      return { ok: false, verdict: 'blocked', errorHead: 'workspace_required', kind, exitCode: null };
    }

    const script = path.join(cwd, 'scripts', kind === 'test-affected' ? 'test-affected.mjs' : 'evals-gate.mjs');
    if (!fs.existsSync(script)) {
      return { ok: false, verdict: 'blocked', errorHead: 'verifier_script_missing', kind, exitCode: null };
    }

    const startedAt = Date.now();
    // 两步形态（BLOCK-335 P4 实机抓真）：--report 分支只写报告**不跑门禁**，单跑它 =
    // 假绿。先 --report 取改动域（restartRequired 判据），再 --run 真跑门禁，**退出码以
    // --run 为准**（0 → ready；1/2 → blocked；崩溃/超时 → blocked）。
    let report = { changedFiles: [], testsCount: 0, unknownCount: 0 };
    let reportPath = null;
    if (kind === 'test-affected') {
      reportPath = path.join(os.tmpdir(), `petri-verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
      const planStep = await runChild(cwd, [script, '--report', reportPath], { timeoutMs, signal: options.signal });
      if (!planStep.error) {
        report = parseReportFile(reportPath);
      } else {
        return { ok: false, verdict: 'blocked', errorHead: planStep.error, kind, exitCode: null };
      }
      if (reportPath) { try { fs.unlinkSync(reportPath); } catch { /* best-effort */ } }
    }
    const runStep = await runChild(cwd, [script, '--run'], { timeoutMs, signal: options.signal });
    const durationMs = Date.now() - startedAt;
    if (runStep.error) {
      return { ok: false, verdict: 'blocked', errorHead: runStep.error, kind, exitCode: null, durationMs };
    }
    if (runStep.exitCode === 0) {
      const domain = detectRestartRequired(report.changedFiles);
      return {
        ok: true,
        verdict: 'ready',
        kind,
        exitCode: 0,
        durationMs,
        changedFiles: report.changedFiles.slice(0, 50),
        testsCount: report.testsCount,
        restartRequired: domain.restartRequired,
        restartReason: domain.restartReason,
      };
    }
    return {
      ok: false,
      verdict: 'blocked',
      kind,
      exitCode: runStep.exitCode,
      durationMs,
      errorHead: String(runStep.stderr || runStep.stdout || '').slice(-400),
    };
  };
}

/**
 * loop 决策验证器（BLOCK-335 P0）：按 spec 解析为 async (context) => { verdict, detail }。
 * 未知 kind / 工作区缺失 → 返回 null（无投票，零行为变化），不伪装成绿也不伪装成红。
 * @param {{kind?: string, projectId?: string}} spec
 * @param {{userId?: string}} deps
 */
function createDecisionVerifier(spec, { userId: _userId } = {}) {
  const kind = spec && VERIFY_KINDS.includes(spec.kind) ? spec.kind : null;
  if (!kind) return null;
  const verify = createVerifyHost({});
  return async function decisionVerifier(context = {}) {
    const result = await verify({
      kind,
      projectId: spec.projectId || (context && context.projectId) || null,
      signal: context && context.signal,
    });
    if (!result || result.verdict !== 'ready') {
      return {
        verdict: result && result.restartRequired ? 'needs_restart' : 'blocked',
        detail: result && result.errorHead
          ? String(result.errorHead).slice(0, 120)
          : `${kind} exit=${result && result.exitCode}${result && result.restartRequired ? ` 触及需重启面 ${result.restartReason}` : ''}`,
        runCount: 1,
      };
    }
    if (result.restartRequired) {
      return { verdict: 'needs_restart', detail: `触及需重启面 ${result.restartReason}`, runCount: 1 };
    }
    return { verdict: 'ready', detail: `${kind} exit=0`, runCount: 1 };
  };
}

module.exports = {
  VERIFY_KINDS,
  RESTART_SAFE_PREFIXES,
  createVerifyHost,
  createDecisionVerifier,
  detectRestartRequired,
};
