'use strict';

/**
 * agent-review/review-git.js — read-only command boundary for the review
 * sub-agent (BLOCK-25).
 *
 * The reviewer may only run a fixed allowlist of read-only inspection
 * commands inside the project workspace. Everything else — shell
 * metacharacters, writes, network, anything not on the list — is denied.
 * This module never spawns a shell: the command string is tokenized and
 * executed via execFile so redirects/pipes/subshells are impossible.
 */

const { execFile } = require('node:child_process');
const path = require('node:path');

const GIT_SUBCOMMANDS = new Set([
  'status',
  'diff',
  'log',
  'show',
  'merge-base',
  'rev-parse',
  'branch',
  'ls-files',
  'shortlog',
  'describe',
]);

const PLAIN_READ_COMMANDS = new Set(['cat', 'head', 'tail', 'wc', 'sed', 'grep', 'rg']);

const MAX_OUTPUT_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

/**
 * Tokenize a command line with single-quote / double-quote support.
 * Returns null when the input contains characters that cannot be safely
 * represented outside a shell (pipes, redirects, substitution, separators).
 */
function tokenizeCommand(command) {
  const raw = typeof command === 'string' ? command.trim() : '';
  if (!raw || raw.length > 4000) return null;
  if (/[`$;&|<>\n\r]/.test(raw)) return null;
  const tokens = [];
  let current = '';
  let quote = null;
  let hasToken = false;
  for (const ch of raw) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      if (current || hasToken) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }
    current += ch;
  }
  if (quote) return null;
  if (current || hasToken) tokens.push(current);
  return tokens.length ? tokens : null;
}

/**
 * Decide whether a tokenized command is within the read-only review boundary.
 */
function isAllowedReviewCommand(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) return false;
  if (!commandLooksSafe(tokens)) return false;
  const [bin, ...rest] = tokens;
  if (bin === 'git') {
    const sub = rest.find((arg) => !arg.startsWith('-'));
    if (!sub) return false;
    if (sub.includes('=')) return false; // -c key=value config overrides are denied
    return GIT_SUBCOMMANDS.has(sub);
  }
  if (PLAIN_READ_COMMANDS.has(bin)) {
    return true;
  }
  return false;
}

/**
 * Per-command flag denials for read-only tools that still have a
 * write/execute side. Pipes, redirects and separators are already
 * impossible (tokenize rejects them; execFile runs without a shell), so
 * this list only has to close per-tool escape hatches:
 *   - sed -i writes files in place
 *   - rg --pre / --pre-glob execute a preprocessor command per file
 */
function commandLooksSafe(tokens) {
  const [bin] = tokens;
  for (const token of tokens.slice(1)) {
    if (bin === 'sed' && (token === '-i' || token.startsWith('-i') || token === '--in-place')) return false;
    if (bin === 'rg' && (token === '--pre' || token === '--pre-glob')) return false;
  }
  return true;
}

/**
 * Execute an allowlisted read-only command in the workspace.
 * Resolves { ok: true, stdout } or { ok: false, error }.
 */
function execReviewCommand(command, workspacePath, { timeoutMs } = {}) {
  const tokens = tokenizeCommand(command);
  if (!tokens) return Promise.resolve({ ok: false, error: 'command_invalid_or_shell_metacharacters' });
  if (!commandLooksSafe(tokens)) return Promise.resolve({ ok: false, error: 'command_flag_denied' });
  if (!isAllowedReviewCommand(tokens)) return Promise.resolve({ ok: false, error: 'command_not_allowlisted' });

  const resolvedCwd = path.resolve(workspacePath);
  const timeout = Math.min(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  return new Promise((resolve) => {
    execFile(
      tokens[0],
      tokens.slice(1),
      {
        cwd: resolvedCwd,
        timeout,
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
        shell: false,
      },
      (error, stdout, stderr) => {
        if (error && !stdout) {
          const reason = String((error && (error.message || error.code)) || 'exec_failed');
          resolve({ ok: false, error: `exec_failed: ${reason.slice(0, 300)}` });
          return;
        }
        const combined = `${stdout || ''}${stderr && !stdout ? `\n[stderr]\n${stderr}` : ''}`;
        resolve({ ok: true, stdout: combined.slice(0, MAX_OUTPUT_BYTES) });
      }
    );
  });
}

/**
 * Read a text file from the workspace. Accepts workspace-relative AND
 * absolute paths (the review rubric's code_location contract uses absolute
 * paths); absolute paths must resolve inside the workspace. Hard size cap.
 */
function readWorkspaceFile(filePath, workspacePath, { maxBytes = 256 * 1024 } = {}) {
  return new Promise((resolve) => {
    const raw = typeof filePath === 'string' ? filePath.trim() : '';
    if (!raw || raw.includes('\0') || raw.includes('..')) {
      resolve({ ok: false, error: 'path_invalid' });
      return;
    }
    const workspaceRoot = path.resolve(workspacePath);
    const target = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(workspaceRoot, raw);
    if (target !== workspaceRoot && !target.startsWith(`${workspaceRoot}${path.sep}`)) {
      resolve({ ok: false, error: 'path_outside_workspace' });
      return;
    }
    const { readFile, stat } = require('node:fs');
    stat(target, (statError, stats) => {
      if (statError || !stats.isFile()) {
        resolve({ ok: false, error: 'file_not_found' });
        return;
      }
      if (stats.size > maxBytes) {
        resolve({ ok: false, error: `file_too_large (${stats.size} bytes, max ${maxBytes})` });
        return;
      }
      readFile(target, 'utf8', (readError, content) => {
        if (readError) {
          resolve({ ok: false, error: `read_failed: ${String(readError.code || readError.message).slice(0, 120)}` });
          return;
        }
        resolve({ ok: true, content });
      });
    });
  });
}

module.exports = {
  execReviewCommand,
  isAllowedReviewCommand,
  readWorkspaceFile,
  tokenizeCommand,
};
