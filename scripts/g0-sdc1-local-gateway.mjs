#!/usr/bin/env node

import { createServer } from 'node:http';

export const SDC1_GATEWAY_CLASSIFICATION =
  'development_deterministic_local_adapter_no_provider_claim';

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(new Error('request_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function text(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((part) => part && typeof part.text === 'string' ? part.text : '').join('');
}

function lastUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return text(messages[index].content).trim();
  }
  return '';
}

function parsedToolResults(messages, name) {
  return messages.flatMap((message) => {
    if (message?.role !== 'tool' || message.name !== name || typeof message.content !== 'string') return [];
    try { return [JSON.parse(message.content)]; } catch { return []; }
  });
}

function projectedToolJobId(result) {
  const direct = result?.toolJobId
    || result?.data?.toolJobId
    || result?.data?.result?.toolJobId;
  if (typeof direct === 'string' && direct.startsWith('tj_')) return direct;
  for (const value of [result?.dataSummary, result?.data?.preview]) {
    if (typeof value !== 'string') continue;
    const match = value.match(/"toolJobId"\s*:\s*"(tj_[A-Za-z0-9._-]+)"/);
    if (match) return match[1];
  }
  return '';
}

function calledRunToolOperation(messages, operation, toolId = null) {
  return messages.some((message) => Array.isArray(message?.tool_calls)
    && message.tool_calls.some((call) => {
      if (call?.function?.name !== 'run_tool') return false;
      try {
        const args = JSON.parse(call.function.arguments || '{}');
        return args.op === operation && (toolId === null || args.toolId === toolId);
      } catch { return false; }
    }));
}

function response(message, finishReason = 'stop') {
  return {
    id: 'sdc1-local-gateway',
    object: 'chat.completion',
    created: 0,
    model: 'sdc1-scripted',
    choices: [{ index: 0, finish_reason: finishReason, message }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function toolCall(args, index) {
  return response({
    role: 'assistant',
    content: '',
    tool_calls: [{
      id: `sdc1_call_${index}`,
      type: 'function',
      function: { name: 'run_tool', arguments: JSON.stringify(args) },
    }],
  }, 'tool_calls');
}

export function buildSdc1GatewayResponse(body, { countsPath, metadataPath, requestIndex }) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const userText = lastUserText(messages);
  const runResults = parsedToolResults(messages, 'run_tool');
  const latestRunResult = runResults.at(-1);
  const runData = latestRunResult?.data;
  const completedToolJobId = projectedToolJobId(latestRunResult);
  const runSucceeded = latestRunResult?.status === 'success'
    && latestRunResult?.terminationReason !== 'error'
    && runData?.ok !== false;

  if (/Data Profiler/.test(userText) && !/design\s*=\s*condition/i.test(userText)) {
    return {
      phase: 'scientific_confirmation',
      response: response({
        role: 'assistant',
        content: '文件结构与样本 ID 已匹配。请确认：design 使用 condition，对照组 WT，实验组 KO；确认后我再执行 DESeq2。',
      }),
    };
  }

  if (!calledRunToolOperation(messages, 'list')) {
    return { phase: 'catalog', response: toolCall({ op: 'list' }, requestIndex) };
  }
  if (!calledRunToolOperation(messages, 'list', 'deseq2')) {
    return { phase: 'contract', response: toolCall({ op: 'list', toolId: 'deseq2' }, requestIndex) };
  }
  if (!calledRunToolOperation(messages, 'run', 'deseq2')) {
    return {
      phase: 'execute',
      response: toolCall({
        op: 'run',
        toolId: 'deseq2',
        params: {
          counts: countsPath,
          coldata: metadataPath,
          design: 'condition',
          contrast_ref: 'WT',
          contrast_treat: 'KO',
          padj_cutoff: 0.05,
          lfc_cutoff: 1,
        },
      }, requestIndex),
    };
  }
  if (completedToolJobId && runSucceeded) {
    return {
      phase: 'final',
      response: response({ role: 'assistant', content: 'DESeq2 已完成，正式结果已打开。' }),
    };
  }
  return {
    phase: 'blocked',
    errorCode: String(runData?.error || latestRunResult?.terminationReason || 'run_tool_failed').slice(0, 80),
    response: response({ role: 'assistant', content: '分析未通过工具或产物校验，已停止。' }),
  };
}

export async function startSdc1LocalGateway({ countsPath, metadataPath, host = '127.0.0.1', port = 0 }) {
  const trace = [];
  const inputPaths = { countsPath: countsPath || '', metadataPath: metadataPath || '' };
  let requestIndex = 0;
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url || '/', `http://${host}`).pathname;
    if (req.method === 'GET' && pathname === '/v1/models') {
      json(res, 200, { object: 'list', data: [{ id: 'sdc1-scripted', object: 'model' }] });
      return;
    }
    if (req.method !== 'POST' || pathname !== '/v1/chat/completions') {
      json(res, 404, { error: { message: 'not_found' } });
      return;
    }
    try {
      const body = await readBody(req);
      requestIndex += 1;
      if (!inputPaths.countsPath || !inputPaths.metadataPath) throw new Error('sdc1_gateway_input_paths_unavailable');
      const next = buildSdc1GatewayResponse(body, { ...inputPaths, requestIndex });
      trace.push({ requestIndex, phase: next.phase, errorCode: next.errorCode || null });
      json(res, 200, next.response);
    } catch (error) {
      json(res, 400, { error: { message: error instanceof Error ? error.message : 'invalid_request' } });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('sdc1_gateway_address_unavailable');
  return {
    classification: SDC1_GATEWAY_CLASSIFICATION,
    baseUrl: `http://${host}:${address.port}/v1`,
    trace,
    setInputPaths(next) {
      if (!pathIsAbsolute(next?.countsPath) || !pathIsAbsolute(next?.metadataPath)) {
        throw new Error('sdc1_gateway_input_paths_must_be_absolute');
      }
      inputPaths.countsPath = next.countsPath;
      inputPaths.metadataPath = next.metadataPath;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function pathIsAbsolute(value) {
  return typeof value === 'string' && (/^\//.test(value) || /^[A-Za-z]:[\\/]/.test(value));
}
