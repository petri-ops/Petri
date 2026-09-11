/**
 * OpenAI-compatible <-> Anthropic Messages protocol conversion.
 * Adapted from api-failover-proxy (MIT), separated from Express dispatch.
 */

function parseArguments(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((part) => part && part.type === 'text').map((part) => part.text || '').join('');
}

function openAIContentToAnthropic(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const blocks = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text') blocks.push({ type: 'text', text: part.text || '' });
    if (part.type === 'image_url') {
      const url = typeof part.image_url === 'string' ? part.image_url : part.image_url && part.image_url.url;
      const match = String(url || '').match(/^data:(.+?);base64,(.+)$/);
      if (match) {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: match[1], data: match[2] },
        });
      }
    }
  }
  return blocks;
}

function openAIMessageToAnthropic(message) {
  if (message.role === 'tool') {
    return [{
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: message.tool_call_id,
        content: textFromContent(message.content),
      }],
    }];
  }
  if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length) {
    const blocks = [];
    const text = textFromContent(message.content);
    if (text) blocks.push({ type: 'text', text });
    for (const toolCall of message.tool_calls) {
      blocks.push({
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.function && toolCall.function.name,
        input: parseArguments(toolCall.function && toolCall.function.arguments),
      });
    }
    return [{ role: 'assistant', content: blocks }];
  }
  return [{
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: openAIContentToAnthropic(message.content),
  }];
}

function openAIToAnthropicRequest(body) {
  const messages = [];
  const systemParts = [];
  for (const message of body.messages || []) {
    if (message.role === 'system') {
      const text = textFromContent(message.content);
      if (text) systemParts.push(text);
      continue;
    }
    messages.push(...openAIMessageToAnthropic(message));
  }
  const result = {
    model: body.model,
    messages,
    max_tokens: body.max_tokens || 4096,
    stream: body.stream === true,
  };
  if (systemParts.length) result.system = systemParts.join('\n');
  if (body.temperature !== undefined) result.temperature = body.temperature;
  if (body.top_p !== undefined) result.top_p = body.top_p;
  if (body.stop !== undefined) result.stop_sequences = Array.isArray(body.stop) ? body.stop : [body.stop];
  if (Array.isArray(body.tools) && body.tools.length) {
    result.tools = body.tools.map((tool) => ({
      name: (tool.function && tool.function.name) || tool.name,
      description: (tool.function && tool.function.description) || tool.description || '',
      input_schema: (tool.function && tool.function.parameters) || tool.input_schema || {},
    }));
  }
  // BLOCK-81 P1 — 思考档位：Anthropic 协议用 thinking:{type,budget_tokens}，本函数是
  // **白名单重建**（非展开透传），不显式搬运会被静默丢弃 → 档位在 anthropic 渠道失效。
  if (body.thinking && typeof body.thinking === 'object') {
    const type = body.thinking.type === 'enabled' ? 'enabled' : 'disabled';
    result.thinking = type === 'enabled'
      ? { type, budget_tokens: Number(body.thinking.budget_tokens) || 16000 }
      : { type };
  }
  if (body.tool_choice === 'auto') result.tool_choice = { type: 'auto' };
  else if (body.tool_choice === 'required') result.tool_choice = { type: 'any' };
  else if (body.tool_choice && body.tool_choice.function && body.tool_choice.function.name) {
    result.tool_choice = { type: 'tool', name: body.tool_choice.function.name };
  }
  return result;
}

function anthropicContentToOpenAI(message) {
  if (typeof message.content === 'string') return [{ role: message.role, content: message.content }];
  const blocks = Array.isArray(message.content) ? message.content : [];
  const textParts = [];
  const imageParts = [];
  const toolCalls = [];
  const toolResults = [];
  for (const block of blocks) {
    if (block.type === 'text') textParts.push(block.text || '');
    if (block.type === 'image') {
      const source = block.source || {};
      const url = source.type === 'base64'
        ? `data:${source.media_type};base64,${source.data}`
        : source.url || '';
      imageParts.push({ type: 'image_url', image_url: { url } });
    }
    if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input || {}) },
      });
    }
    if (block.type === 'tool_result') {
      toolResults.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content: textFromContent(block.content),
      });
    }
  }
  if (toolResults.length) {
    const leading = textParts.length ? [{ role: 'user', content: textParts.join('') }] : [];
    return [...leading, ...toolResults];
  }
  if (toolCalls.length) {
    return [{ role: 'assistant', content: textParts.join('') || null, tool_calls: toolCalls }];
  }
  if (imageParts.length) {
    const content = [...textParts.map((text) => ({ type: 'text', text })), ...imageParts];
    return [{ role: message.role === 'assistant' ? 'assistant' : 'user', content }];
  }
  return [{ role: message.role === 'assistant' ? 'assistant' : 'user', content: textParts.join('') }];
}

function anthropicToOpenAIRequest(body) {
  const messages = [];
  const system = typeof body.system === 'string'
    ? body.system
    : Array.isArray(body.system)
      ? body.system.map((block) => block.text || '').join('\n')
      : '';
  if (system) messages.push({ role: 'system', content: system });
  for (const message of body.messages || []) messages.push(...anthropicContentToOpenAI(message));
  const result = {
    model: body.model,
    messages,
    max_tokens: body.max_tokens || 4096,
    stream: body.stream === true,
  };
  if (body.temperature !== undefined) result.temperature = body.temperature;
  if (body.top_p !== undefined) result.top_p = body.top_p;
  if (body.stop_sequences !== undefined) result.stop = body.stop_sequences;
  if (Array.isArray(body.tools) && body.tools.length) {
    result.tools = body.tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description || '', parameters: tool.input_schema || {} },
    }));
  }
  if (body.tool_choice && body.tool_choice.type === 'auto') result.tool_choice = 'auto';
  else if (body.tool_choice && body.tool_choice.type === 'any') result.tool_choice = 'required';
  else if (body.tool_choice && body.tool_choice.type === 'tool') {
    result.tool_choice = { type: 'function', function: { name: body.tool_choice.name } };
  }
  return result;
}

function openAIToAnthropicResponse(json, requestModel) {
  const choice = json && json.choices && json.choices[0];
  if (!choice) return { type: 'error', error: { type: 'api_error', message: 'no choices in response' } };
  const message = choice.message || {};
  const content = [];
  if (message.content) content.push({ type: 'text', text: message.content });
  for (const toolCall of message.tool_calls || []) {
    content.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.function && toolCall.function.name,
      input: parseArguments(toolCall.function && toolCall.function.arguments),
    });
  }
  const stopReasons = { stop: 'end_turn', length: 'max_tokens', tool_calls: 'tool_use' };
  return {
    id: `msg_${json.id || Date.now()}`,
    type: 'message',
    role: 'assistant',
    content,
    model: requestModel,
    stop_reason: stopReasons[choice.finish_reason] || 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: (json.usage && json.usage.prompt_tokens) || 0,
      output_tokens: (json.usage && json.usage.completion_tokens) || 0,
    },
  };
}

function anthropicToOpenAIResponse(json, requestModel) {
  let content = '';
  const toolCalls = [];
  for (const block of (json && json.content) || []) {
    if (block.type === 'text') content += block.text || '';
    if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input || {}) },
      });
    }
  }
  const finishReasons = { end_turn: 'stop', max_tokens: 'length', tool_use: 'tool_calls', stop_sequence: 'stop' };
  const message = { role: 'assistant', content: content || null };
  if (toolCalls.length) message.tool_calls = toolCalls;
  if (!content && !toolCalls.length) message.content = '';
  const input = (json.usage && json.usage.input_tokens) || 0;
  const output = (json.usage && json.usage.output_tokens) || 0;
  return {
    id: `chatcmpl-${json.id || Date.now()}`,
    object: 'chat.completion',
    choices: [{ index: 0, message, finish_reason: finishReasons[json.stop_reason] || 'stop' }],
    model: requestModel,
    usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output },
  };
}

module.exports = {
  openAIToAnthropicRequest,
  anthropicToOpenAIRequest,
  openAIToAnthropicResponse,
  anthropicToOpenAIResponse,
};
