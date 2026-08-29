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
const MAX_DIFF_CHARS = 60_000;

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
/**
 * Precompute the diff under review so the reviewer does not have to discover
 * it by trial and error. DeepSeek-class models wander the repository when
 * left to find the diff themselves; embedding it makes convergence the
 * default. Tools remain available for context beyond the diff.
 */
async function collectDiffContext(workspacePath, target) {
  const sections = [];
  if (target.type === 'uncommitted_changes') {
    const status = await execReviewCommand('git status --short', workspacePath);
    if (status.ok && status.stdout.trim()) {
      sections.push(`git status --short:\n${status.stdout.trim()}`);
    }
    const diff = await execReviewCommand('git diff HEAD', workspacePath);
    if (diff.ok && diff.stdout.trim()) sections.push(`git diff HEAD:\n${diff.stdout}`);
  } else if (target.type === 'base_branch') {
    const mergeBaseSha = await resolveMergeBaseSha(workspacePath, target.branch);
    const range = mergeBaseSha || target.branch;
    const diff = await execReviewCommand(`git diff ${range}`, workspacePath);
    if (diff.ok && diff.stdout.trim()) sections.push(`git diff ${range}:\n${diff.stdout}`);
  } else if (target.type === 'commit') {
    const show = await execReviewCommand(`git show ${target.sha}`, workspacePath);
    if (show.ok && show.stdout.trim()) sections.push(`git show ${target.sha}:\n${show.stdout}`);
  }
  if (sections.length === 0) return null;
  const joined = sections.join('\n\n');
  if (joined.length <= MAX_DIFF_CHARS) return joined;
  return `${joined.slice(0, MAX_DIFF_CHARS)}\n...[diff truncated at ${MAX_DIFF_CHARS} chars]`;
}

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
    // The reviewer needs the workspace root to resolve absolute paths for
    // review_read_file (code_location uses absolute_file_path).
    userPrompt += `\n\nProject workspace root: ${cwd}`;
    const diffContext = await collectDiffContext(cwd, target);
    if (diffContext) {
      userPrompt += `\n\n=== Diff under review (precomputed) ===\n${diffContext}`;
      userPrompt +=
        '\n\nThe diff above IS the change under review. Review it directly; use review_git / review_read_file only when you genuinely need surrounding context, then output the final JSON. Do not explore the repository at large — findings must come from the diff.';
    } else if (target.type === 'uncommitted_changes') {
      userPrompt +=
        '\n\nNo working-tree diff was found. Verify with review_git (git status --short); if the tree is genuinely clean, output the final JSON with zero findings.';
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

    // Streaming mode: the final message.content can be empty while the text
    // arrives as content_delta events (same contract as loop-orchestrator's
    // streamedText), so accumulate and prefer whichever is non-empty.
    let streamedText = '';
    const onStreamEvent = (event) => {
      if (event && event.type === 'content_delta' && event.content) {
        streamedText += event.content;
        emit({ event: 'delta', choices: [{ delta: { content: event.content } }] });
      }
    };
    const reqBody = {
      messages,
      temperature: 0.2,
      max_tokens: 8192,
      tools: REVIEW_TOOLS,
      tool_choice: 'auto',
    };
    const telemetry = { userId: userId || null, kind: 'review_iter' };
    const callOpts = { baseUrl, profileId, modelOverride: modelName, signal: undefined };
    let upJson = await callChatProvider(providerName, apiKey, reqBody, telemetry, onStreamEvent, callOpts);
    // One bounded retry for transient transport kills (TLS disconnect /
    // ECONNRESET class) that produced no streamed content — a flaky proxy
    // must not abort an otherwise healthy review run. Retries only while
    // nothing has streamed and no tool call was consumed this iteration.
    if (
      upJson && upJson.error
      && streamedText.length === 0
      && /socket disconnected|tls|econnreset|etimedout|fetch failed|network|epipe/i.test(String(upJson.error))
    ) {
      emit({ event: 'agent_status', phase: 'review_retry', reason: 'transient_network_error' });
      await new Promise((r) => setTimeout(r, 1500));
      upJson = await callChatProvider(providerName, apiKey, reqBody, telemetry, onStreamEvent, callOpts);
    }

    if (!upJson || upJson.error || !upJson.choices || !upJson.choices[0]) {
      const reason = String((upJson && (upJson.message || upJson.error)) || 'provider returned no choices');
      return { ok: false, error: `review provider error: ${reason.slice(0, 300)}` };
    }

    const msg = upJson.choices[0].message || {};
    const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    const contentText = (typeof msg.content === 'string' && msg.content.trim())
      ? msg.content
      : streamedText;

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
      let argsPreview = '';
      try {
        const parsed = JSON.parse((call.function && call.function.arguments) || '{}');
        argsPreview = String(parsed.command || parsed.path || '').slice(0, 140);
      } catch {}
      emit({
        event: 'agent_status',
        phase: 'review_tool',
        iteration,
        name: call.function && call.function.name,
        detail: argsPreview,
      });
      const result = await executeReviewToolCall(call, cwd);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result.output,
      });
    }
    // Nudge AFTER the tool results — tool_calls messages must be followed
    // immediately by their tool responses (OpenAI-compatible protocol).
    if (MAX_ITERATIONS - iteration <= 3) {
      messages.push({
        role: 'user',
        content:
          `Inspection budget nearly exhausted (${iteration}/${MAX_ITERATIONS} iterations used). ` +
          'Stop exploring. Based on what you have already seen, output ONLY the final JSON verdict now.',
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
