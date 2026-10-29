'use strict';

/**
 * helpers/task-spec.js — NEXT-03 结构化任务规格草稿。
 *
 * 只生成 optimizedPrompt + task-spec/v1 草稿；不发送、不替换、不 dryRun、不执行。
 * 模型调用复用当前 chat provider（与 assistant-suggestions 同源）。
 */

const { modelGateway, getCredential } = require('./model-gateway');
const { getAiSettings, getChatProviderName } = require('./ai-settings');

const MAX_PROMPT_CHARS = 6000;
const MAX_ITEMS = 12;
const MAX_ITEM_CHARS = 400;
const MAX_SUMMARY_ITEMS = 8;
const TIMEOUT_MS = 20000;
const TASK_TYPES = new Set(['general', 'coding', 'analysis', 'result', 'workflow', 'modeling']);

function cleanText(value, max) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function cleanList(value, maxItems = MAX_ITEMS) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item, MAX_ITEM_CHARS))
    .filter(Boolean)
    .slice(0, maxItems);
}

function readJsonCandidate(raw) {
  const text = String(raw || '');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function parseRawTaskSpec(raw) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!value) return { ok: false, error: 'task_spec_invalid' };
  const optimizedPrompt = cleanText(value.optimizedPrompt, MAX_PROMPT_CHARS);
  const inputSpec = value.taskSpec && typeof value.taskSpec === 'object' && !Array.isArray(value.taskSpec)
    ? value.taskSpec
    : null;
  if (!optimizedPrompt || !inputSpec) return { ok: false, error: 'task_spec_invalid' };
  const goal = cleanText(inputSpec.goal, 1000);
  if (!goal) return { ok: false, error: 'task_spec_invalid' };
  const taskType = TASK_TYPES.has(inputSpec.taskType) ? inputSpec.taskType : 'general';
  return {
    ok: true,
    value: {
      optimizedPrompt,
      taskSpec: {
        version: 'task-spec/v1',
        taskType,
        goal,
        deliverables: cleanList(inputSpec.deliverables),
        constraints: cleanList(inputSpec.constraints),
        assumptions: cleanList(inputSpec.assumptions),
        acceptance: cleanList(inputSpec.acceptance),
        missingInfo: cleanList(inputSpec.missingInfo),
      },
      changeSummary: cleanList(value.changeSummary, MAX_SUMMARY_ITEMS),
      contextUsed: [],
    },
  };
}

function parseTaskSpecResponse(raw) {
  const parsed = readJsonCandidate(raw);
  if (!parsed) return { ok: false, error: 'task_spec_output_unparsable' };
  return parseRawTaskSpec(parsed);
}

function normalizeContext(context) {
  const input = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
  const items = Array.isArray(input.items)
    ? input.items
      .map((item) => ({
        kind: cleanText(item && item.kind, 40) || 'context',
        label: cleanText(item && item.label, 160),
        source: cleanText(item && item.source, 80),
      }))
      .filter((item) => item.label)
      .slice(0, MAX_ITEMS)
    : [];
  return {
    projectName: cleanText(input.projectName, 120),
    projectType: cleanText(input.projectType, 60),
    workspaceLabel: cleanText(input.workspaceLabel, 240),
    surface: cleanText(input.surface, 80),
    taskTypeHint: TASK_TYPES.has(input.taskTypeHint) ? input.taskTypeHint : 'general',
    items,
  };
}

function contextLabels(context) {
  const used = [];
  if (context.projectName) used.push(`project:${context.projectName}`);
  if (context.surface) used.push(`surface:${context.surface}`);
  if (context.workspaceLabel) used.push(`workspace:${context.workspaceLabel}`);
  for (const item of context.items) used.push(`context:${item.kind}:${item.label}`);
  return used.slice(0, MAX_ITEMS + 3);
}

function buildCapabilitySnapshot({ workflowEnabled = false, visionAvailable = false, mcpConnected = 0 } = {}) {
  return [
    {
      id: 'task_spec',
      status: 'ready',
      note: '生成草稿；不会自动发送或执行',
    },
    {
      id: 'workflow',
      status: workflowEnabled ? 'ready' : 'disabled',
      reason: workflowEnabled ? null : 'workflow_not_enabled',
    },
    {
      id: 'vision',
      status: visionAvailable ? 'ready' : 'unavailable',
      reason: visionAvailable ? null : 'vision_not_configured',
    },
    {
      id: 'mcp',
      status: mcpConnected > 0 ? 'ready' : 'disabled',
      connectedServers: Math.max(0, Number(mcpConnected) || 0),
    },
    {
      id: 'blender',
      status: 'unavailable',
      reason: 'not_configured',
    },
  ];
}

async function generateTaskSpecDraft({ prompt, userId, context, capabilitySnapshot } = {}) {
  const text = String(prompt || '').trim();
  if (!text) return { ok: false, error: 'prompt_required' };
  if (text.length > MAX_PROMPT_CHARS) return { ok: false, error: 'prompt_too_large' };

  const settings = getAiSettings();
  const providerName = getChatProviderName();
  const profiles = Array.isArray(settings.model_profiles) ? settings.model_profiles : [];
  const activeProfile = profiles.find((profile) => profile.id === settings.active_chat_model_id)
    || profiles.find((profile) => Array.isArray(profile.roles) && profile.roles.includes('chat'))
    || null;
  let apiKey = null;
  try {
    apiKey = activeProfile
      ? getCredential(activeProfile.credentialRef, activeProfile)
      : (providerName ? getCredential(providerName) : null);
  } catch {
    apiKey = null;
  }
  if (!apiKey) return { ok: false, error: 'no_credential' };

  const boundedContext = normalizeContext(context);
  const system = [
    '你是结构化任务规格生成器。只输出一个 JSON 对象，不要 markdown 围栏或解释。',
    '字段：optimizedPrompt（字符串，保留用户原意并补足可执行性）、taskSpec（对象：',
    'goal 字符串；taskType 枚举 general/coding/analysis/result/workflow/modeling；',
    'deliverables/constraints/assumptions/acceptance/missingInfo 均为字符串数组）、',
    'changeSummary（字符串数组）。',
    '不得声称环境具备未列出的能力；capabilities 中非 ready 的能力必须进入 assumptions 或 missingInfo。',
    '每个数组最多 6 项，每项不超过 200 字；输出必须完整可解析。',
    '不得自动执行、自动发送、自动替换；不得读取未提供的文件或凭据。',
  ].join('');
  const userPayload = {
    prompt: text.slice(0, MAX_PROMPT_CHARS),
    context: boundedContext,
    capabilities: Array.isArray(capabilitySnapshot) ? capabilitySnapshot : [],
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const result = await modelGateway.chat({
      role: 'chat',
      body: {
        model: activeProfile?.model || undefined,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(userPayload) },
        ],
        temperature: 0.2,
        max_tokens: 5000,
      },
      telemetry: { userId: userId || null, kind: 'task-spec-enhance' },
      signal: controller.signal,
    });
    const raw = result && result.choices && result.choices[0] && result.choices[0].message
      ? result.choices[0].message.content
      : (result && result.content) || '';
    const parsed = parseTaskSpecResponse(raw);
    if (!parsed.ok) return parsed;
    return {
      ok: true,
      ...parsed.value,
      contextUsed: contextLabels(boundedContext),
      capabilitySnapshot: Array.isArray(capabilitySnapshot) ? capabilitySnapshot : [],
      model: providerName,
    };
  } catch (error) {
    return {
      ok: false,
      error: error && error.name === 'AbortError' ? 'timeout' : (error && error.message) || 'model_call_failed',
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  MAX_PROMPT_CHARS,
  parseRawTaskSpec,
  parseTaskSpecResponse,
  buildCapabilitySnapshot,
  generateTaskSpecDraft,
};
