'use strict';

/**
 * agent-review/review-runner.js — BLOCK-25 read-only review sub-agent.
 *
 * Runs a Codex-parity review conversation: rubric system prompt + target
 * prompt, a minimal read-only toolset (git inspection + file reading), and a
 * bounded tool loop that ends with a sanitized ReviewOutputEvent. The main
 * agent loop (agent-runner.js) is intentionally not reused: the review run
 * must not inherit chat persona, plan/action tooling, or write capabilities.
 *
 * Event contract: identical channel to chat agent tasks — the route persists
 * every emitted event into agent_task_store, so the renderer subscribes via
 * the existing GET /api/ai/agent/task/:taskId SSE.
 */

const path = require('node:path');

const { callChatProvider } = require('../helpers/llm-client');
const { buildReviewPrompt, REVIEW_RUBRIC } = require('./review-prompts');
const { execReviewCommand, readWorkspaceFile } = require('./review-git');
const { parseReviewOutputEvent } = require('./review-output');

const MAX_ITERATIONS = 12;
const MAX_TOOL_CALLS = 24;
const MAX_TOOL_OUTPUT_CHARS = 16_000;

const REVIEW_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'review_git',
      description:
        'Run a read-only repository inspection command in the project workspace. ' +
        'Allowed: git (status/diff/log/show/merge-base/rev-parse/branch/ls-files/shortlog/describe) ' +
        'and read-only text tools (cat/head/tail/wc/sed -n/grep/rg). ' +
        'No pipes, redirects, or writes; anything else is rejected.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '例如 "git diff HEAD" 或 "git status --short"' },
          timeoutMs: { type: 'integer', description: '可选超时毫秒（最大 120000）' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'review_read_file',
      description:
        'Read a workspace-relative text file (up to 256 KB) to inspect context around the diff. ' +
        'Read-only; paths outside the workspace are rejected.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对项目根目录的文件路径' },
        },
        required: ['path'],
      },
    },
  },
];

function truncateToolOutput(text) {
  const str = String(text ?? '');
  return str.length > MAX_TOOL_OUTPUT_CHARS
    ? `${str.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n...[truncated ${str.length - MAX_TOOL_OUTPUT_CHARS} chars]`
    : str;
}

/**
 * Resolve the merge base for a base_branch target. Resolves a SHA string or
 * null (the prompt template then falls back to the discover-it-yourself
 * variant, mirroring Codex).
 */
async function resolveMergeBaseSha(workspacePath, branch) {
  const upstream = await execReviewCommand(
    `git rev-parse --abbrev-ref ${branch}@{upstream}`,
    workspacePath
  ).catch(() => ({ ok: false }));
  const upstreamRef = upstream.ok ? upstream.stdout.trim() : '';
  if (upstreamRef) {
    const merged = await execReviewCommand(`git merge-base HEAD ${upstreamRef}`, workspacePath);
    if (merged.ok) return merged.stdout.trim().split(/\s+/)[0] || null;
  }
  const direct = await execReviewCommand(`git merge-base HEAD ${branch}`, workspacePath);
  if (direct.ok) return direct.stdout.trim().split(/\s+/)[0] || null;
  return null;
}

async function executeReviewToolCall(call, workspacePath) {
  const name = call && call.function && call.function.name;
  let args = {};
  try {
    args = JSON.parse((call.function && call.function.arguments) || '{}');
  } catch {
    return { ok: false, output: 'error: tool arguments are not valid JSON' };
  }
  if (name === 'review_git') {
    const result = await execReviewCommand(String(args.command || ''), workspacePath, {
      timeoutMs: Number(args.timeoutMs) || undefined,
    });
    return result.ok
      ? { ok: true, output: truncateToolOutput(result.stdout) }
      : { ok: false, output: `error: ${result.error}` };
  }
  if (name === 'review_read_file') {
    const result = await readWorkspaceFile(String(args.path || ''), workspacePath);
    return result.ok
      ? { ok: true, output: truncateToolOutput(result.content) }
      : { ok: false, output: `error: ${result.error}` };
  }
  return { ok: false, output: `error: unknown review tool ${String(name)}` };
}

/**
 * Run the review conversation. Resolves { ok, reviewOutput?, error? } where
 * reviewOutput is the sanitized event from review-output.js.
 */
async function runReviewTask({
  taskId,
  userId,
  workspacePath,
  target,
  apiKey,
  providerName,
  modelName,
  baseUrl,
  profileId,
  shouldAbort,
  emit,
}) {
  const cancelled = () => (typeof shouldAbort === 'function' ? shouldAbort() : false);
  const cwd = path.resolve(workspacePath);

  let userPrompt;
  try {
    if (target.type === 'base_branch') {
      const mergeBaseSha = await resolveMergeBaseSha(cwd, target.branch);
      userPrompt = buildReviewPrompt(target, { mergeBaseSha });
    } else {
      userPrompt = buildReviewPrompt(target);
    }
  } catch (error) {
    return { ok: false, error: `review prompt build failed: ${String(error && error.message).slice(0, 200)}` };
  }

  emit({ event: 'agent_status', phase: 'review_started', target: target.type });

  const messages = [
    { role: 'system', content: REVIEW_RUBRIC },
    { role: 'user', content: userPrompt },
  ];
  let toolCallCount = 0;
  let finalText = '';

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
    if (cancelled()) return { ok: false, error: 'cancelled' };

    const upJson = await callChatProvider(
      providerName,
      apiKey,
      {
        messages,
        temperature: 0.2,
        max_tokens: 8192,
        tools: REVIEW_TOOLS,
        tool_choice: 'auto',
      },
      { userId: userId || null, kind: 'review_iter' },
      (event) => {
        if (event && event.type === 'content_delta' && event.content) {
          emit({ event: 'delta', choices: [{ delta: { content: event.content } }] });
        }
      },
      { baseUrl, profileId, modelOverride: modelName, signal: undefined }
    );

    if (!upJson || upJson.error || !upJson.choices || !upJson.choices[0]) {
      const reason = String((upJson && (upJson.message || upJson.error)) || 'provider returned no choices');
      return { ok: false, error: `review provider error: ${reason.slice(0, 300)}` };
    }

    const msg = upJson.choices[0].message || {};
    const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    const contentText = typeof msg.content === 'string' ? msg.content : '';

    if (toolCalls.length === 0) {
      finalText = contentText;
      break;
    }

    messages.push({
      role: 'assistant',
      content: contentText || '',
      tool_calls: toolCalls,
    });
    for (const call of toolCalls) {
      if (cancelled()) return { ok: false, error: 'cancelled' };
      toolCallCount += 1;
      if (toolCallCount > MAX_TOOL_CALLS) {
        return { ok: false, error: `review tool call budget exceeded (${MAX_TOOL_CALLS})` };
      }
      emit({ event: 'agent_status', phase: 'review_tool', iteration, name: call.function && call.function.name });
      const result = await executeReviewToolCall(call, cwd);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result.output,
      });
    }
  }

  if (!finalText) {
    if (cancelled()) return { ok: false, error: 'cancelled' };
    return { ok: false, error: `review did not converge within ${MAX_ITERATIONS} iterations` };
  }

  const parsed = parseReviewOutputEvent(finalText);
  emit({ event: 'review_output', ...parsed.event, parseLevel: parsed.level });
  emit({ event: 'agent_status', phase: 'review_finished', findings: parsed.event.findings.length });
  return { ok: true, reviewOutput: parsed.event, parseLevel: parsed.level, rawText: finalText };
}

module.exports = {
  MAX_ITERATIONS,
  MAX_TOOL_CALLS,
  REVIEW_TOOLS,
  runReviewTask,
};
