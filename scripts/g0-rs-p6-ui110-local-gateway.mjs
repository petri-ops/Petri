#!/usr/bin/env node

/**
 * Disposable OpenAI-compatible scripted gateway for the P6 UI-110 trace.
 *
 * It deliberately does not emulate model reasoning or make network calls.
 * It recognizes a small set of normal Result Studio requests and returns the
 * same tool-call protocol a real provider would return.  The backend still
 * executes every Result Studio tool, validates Artifact Truth, and streams
 * progress through its normal agent route.  This is product-flow evidence,
 * not real-provider qualification evidence.
 */

import { createServer } from 'node:http';

export const P6_UI110_GATEWAY_CLASSIFICATION =
  'deterministic_local_adapter_no_real_provider_claim';

function asText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((part) => {
    if (!part || typeof part !== 'object') return '';
    return typeof part.text === 'string' ? part.text : '';
  }).join('');
  return '';
}

function lastUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') return asText(message.content).trim();
  }
  return '';
}

export function classifyP6Ui110Request(messages = []) {
  const text = lastUserText(messages).toLowerCase();
  if (/spearman|相关性方法|相关方法/.test(text)) return 'heatmap_scientific';
  if (/热图|heatmap/.test(text)) return 'heatmap_presentation';
  if (/lfc|阈值|显著性/.test(text)) return 'deg_scientific';
  if (/\bgo\b|\bkegg\b|富集/.test(text)) return 'enrichment';
  if (/火山|volcano/.test(text)) return 'volcano_presentation';
  return 'unknown';
}

function parseToolContent(message) {
  if (!message || message.role !== 'tool' || typeof message.content !== 'string') return null;
  try { return JSON.parse(message.content); } catch { return null; }
}

function successfulNamedToolResult(messages, name) {
  for (const message of [...messages].reverse()) {
    if (message?.role !== 'tool' || message.name !== name) continue;
    const parsed = parseToolContent(message);
    if (parsed?.tool === name && parsed.status === 'success' && parsed.data?.ok !== false) return parsed;
  }
  return null;
}

function hasAttemptedToolResult(messages, name) {
  return messages.some((message) => message?.role === 'tool' && message.name === name);
}

function failedNamedToolCode(messages, name) {
  for (const message of [...messages].reverse()) {
    if (message?.role !== 'tool' || message.name !== name) continue;
    const parsed = parseToolContent(message);
    const candidate = String(parsed?.data?.error || parsed?.terminationReason || '').trim();
    return /^[a-z][a-z0-9_]{0,79}$/.test(candidate) ? candidate : 'tool_failed_without_safe_code';
  }
  return null;
}

function validIntent(value) {
  return value && typeof value === 'object'
    && typeof value.intentId === 'string' && value.intentId.length > 0
    && value.artifactRef && typeof value.artifactRef === 'object'
    && typeof value.artifactRef.artifactId === 'string'
    && typeof value.artifactRef.revisionId === 'string';
}

function intentFrom(messages) {
  const plan = successfulNamedToolResult(messages, 'result_edit_plan_in_context');
  return validIntent(plan?.data?.intent) ? plan.data.intent : null;
}

function lfcCutoffFrom(text) {
  const match = String(text || '').match(/(?:lfc|log2fc)\s*(?:阈值)?\s*(?:改为|为|=|:)?\s*([0-9]+(?:\.[0-9]+)?)/i);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : 1.5;
}

function planArguments(kind, userText) {
  const common = {
    requestedOutcome: userText || '调整当前结果',
  };
  if (kind === 'volcano_presentation') {
    return {
      ...common,
      proposedParameterPatch: {
        point_size: 2.6,
        color_up: '#b91c1c',
        color_down: '#1d4ed8',
      },
      useCurrentSelectionForLabels: true,
      editOrigin: 'agent',
    };
  }
  if (kind === 'heatmap_presentation') {
    return {
      ...common,
      proposedParameterPatch: {
        color_low: '#0f766e',
        color_high: '#be123c',
        show_correlation_values: true,
      },
      editOrigin: 'agent',
    };
  }
  if (kind === 'heatmap_scientific') {
    return {
      ...common,
      proposedParameterPatch: { method: 'spearman' },
      editOrigin: 'manual',
    };
  }
  if (kind === 'deg_scientific') {
    return {
      ...common,
      proposedParameterPatch: { lfc_cutoff: lfcCutoffFrom(userText) },
      editOrigin: 'manual',
    };
  }
  return null;
}

function toolCall(name, args, callId) {
  return {
    role: 'assistant',
    content: '',
    tool_calls: [{
      id: callId,
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    }],
  };
}

function response(message, finishReason = 'stop') {
  return {
    id: 'p6-ui110-local-gateway',
    object: 'chat.completion',
    created: 0,
    model: 'p6-ui110-scripted',
    choices: [{ index: 0, finish_reason: finishReason, message }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

/**
 * Build one protocol-valid response without retaining user content.  The
 * returned `trace` contains only a bounded route class and tool name so the
 * parent trace can prove the local adapter was actually used without
 * serializing prompt text or Result Studio coordinates.
 */
export function buildP6Ui110GatewayResponse(body = {}, requestIndex = 1) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const kind = classifyP6Ui110Request(messages);
  const callId = `p6_ui110_call_${requestIndex}`;
  const userText = lastUserText(messages);
  const context = successfulNamedToolResult(messages, 'result_studio_context');

  if (!context) {
    if (hasAttemptedToolResult(messages, 'result_studio_context')) {
      return {
        trace: {
          kind, phase: 'blocked_context', toolName: null,
          errorCode: failedNamedToolCode(messages, 'result_studio_context'),
        },
        response: response({ role: 'assistant', content: '当前结果上下文未能通过校验，不能继续生成候选版本。' }),
      };
    }
    return {
      trace: { kind, phase: 'context', toolName: 'result_studio_context' },
      response: response(toolCall('result_studio_context', {}, callId), 'tool_calls'),
    };
  }

  if (kind === 'enrichment') {
    if (successfulNamedToolResult(messages, 'result_enrichment_from_context')) {
      return {
        trace: { kind, phase: 'final', toolName: null },
        response: response({ role: 'assistant', content: '富集任务已经提交，结果会显示在当前项目的结果历史中。' }),
      };
    }
    if (hasAttemptedToolResult(messages, 'result_enrichment_from_context')) {
      return {
        trace: {
          kind, phase: 'blocked_enrichment', toolName: null,
          errorCode: failedNamedToolCode(messages, 'result_enrichment_from_context'),
        },
        response: response({ role: 'assistant', content: '当前结果的富集派生未通过校验，未重复提交。' }),
      };
    }
    return {
      trace: { kind, phase: 'enrichment', toolName: 'result_enrichment_from_context' },
      response: response(toolCall('result_enrichment_from_context', {
        // The click-time token remains private tool context. The server injects
        // it before schema validation and rejects stale UI state fail-closed.
        species: 'human',
        geneIdType: 'SYMBOL',
        analysisType: 'all',
        padjCutoff: 0.05,
        lfcCutoff: 0.25,
      }, callId), 'tool_calls'),
    };
  }

  const intent = intentFrom(messages);
  if (!intent) {
    if (hasAttemptedToolResult(messages, 'result_edit_plan_in_context')) {
      return {
        trace: {
          kind, phase: 'blocked_plan', toolName: null,
          errorCode: failedNamedToolCode(messages, 'result_edit_plan_in_context'),
        },
        response: response({ role: 'assistant', content: '当前结果的修改计划未通过校验，未创建候选版本。' }),
      };
    }
    const args = planArguments(kind, userText);
    if (!args) {
      return {
        trace: { kind, phase: 'unsupported', toolName: null },
        response: response({ role: 'assistant', content: '该本地验收适配器不支持这类结果编辑请求。' }),
      };
    }
    return {
      trace: { kind, phase: 'plan', toolName: 'result_edit_plan_in_context' },
      response: response(toolCall('result_edit_plan_in_context', args, callId), 'tool_calls'),
    };
  }

  if (!successfulNamedToolResult(messages, 'result_changeset_create_in_context')) {
    if (hasAttemptedToolResult(messages, 'result_changeset_create_in_context')) {
      return {
        trace: {
          kind, phase: 'blocked_create', toolName: null,
          errorCode: failedNamedToolCode(messages, 'result_changeset_create_in_context'),
        },
        response: response({ role: 'assistant', content: '候选版本未通过校验，未重复创建。' }),
      };
    }
    return {
      trace: { kind, phase: 'create', toolName: 'result_changeset_create_in_context' },
      response: response(toolCall('result_changeset_create_in_context', {
        intent,
        // The P6 server-side binding independently clamps this to the actual
        // advanced-drawer acknowledgement for scientific edits.
        scientificConfirmed: true,
      }, callId), 'tool_calls'),
    };
  }

  return {
    trace: { kind, phase: 'final', toolName: null },
    response: response({
      role: 'assistant',
      content: '候选版本已经生成，请在审查修改中核对差异后决定是否采用。',
    }),
  };
}

function readBody(request, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(new Error('request_too_large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

function json(responseObject, status, payload) {
  const body = JSON.stringify(payload);
  responseObject.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  responseObject.end(body);
}

export async function startP6Ui110LocalGateway({ host = '127.0.0.1', port = 0 } = {}) {
  const trace = [];
  let requestIndex = 0;
  const server = createServer(async (request, responseObject) => {
    const pathname = new URL(request.url || '/', `http://${host}`).pathname;
    if (request.method === 'GET' && pathname === '/v1/models') {
      json(responseObject, 200, { object: 'list', data: [{ id: 'p6-ui110-scripted', object: 'model' }] });
      return;
    }
    if (request.method !== 'POST' || pathname !== '/v1/chat/completions') {
      json(responseObject, 404, { error: { message: 'not_found' } });
      return;
    }
    try {
      const body = await readBody(request);
      requestIndex += 1;
      const next = buildP6Ui110GatewayResponse(body, requestIndex);
      trace.push({ requestIndex, ...next.trace });
      json(responseObject, 200, next.response);
    } catch (error) {
      json(responseObject, 400, { error: { message: error?.message || 'invalid_request' } });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise((resolve) => server.close(resolve));
    throw new Error('gateway_address_unavailable');
  }
  let closed = false;
  return {
    classification: P6_UI110_GATEWAY_CLASSIFICATION,
    baseUrl: `http://${host}:${address.port}/v1`,
    trace,
    get closed() { return closed; },
    async close() {
      if (closed) return;
      closed = true;
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
