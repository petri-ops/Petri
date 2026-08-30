'use strict';

/**
 * BLOCK-10 S-003 minimal fix: the natural-language regex inferrer was an
 * attack surface (a prompt-injection line containing "ackToken = ack_xxx"
 * + "已确认" could flip execution on). The decision source now belongs
 * to the frontend chat-mode UI which sends `accessMode` explicitly via
 * the per-request context.
 *
 * This module retains the public surface so the call sites
 * (agent-runner.js, routes/ai-agent.js, agent-tools/index.js) keep
 * working without modification, but the function is now an explicit
 * no-op that simply mirrors the ctx-derived decision and records the
 * `executionPolicyReason` so existing trace logging stays informative.
 */
function inferExecutionPolicy(messages, ctx = {}) {
  // Decision authority is `ctx.accessMode` — the UI is the source of
  // truth for whether the chat is in full-access / read-only mode.
  // The historical message-text inference is intentionally not
  // reproduced here (see docs/agent-harness-security-audit-2026-08-17.md
  // §2 S-003 for the prompt-injection vector).
  const accessMode = ctx && typeof ctx.accessMode === 'string' ? ctx.accessMode : 'read';
  const allowExecution = accessMode === 'full';
  return {
    allowExecution,
    reason: allowExecution ? 'explicit_full_access_mode' : 'explicit_read_only_access_mode',
  };
}

module.exports = { inferExecutionPolicy };