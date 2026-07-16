/** SSE aggregators adapted from api-failover-proxy (MIT). */

const { normalizeUsage } = require('./protocol-usage');

function extractSseFrames(state, chunk) {
  state.buffer = (state.buffer + String(chunk || '')).replace(/\r\n/g, '\n');
  const frames = [];
  let index;
  while ((index = state.buffer.indexOf('\n\n')) !== -1) {
    const raw = state.buffer.slice(0, index);
    state.buffer = state.buffer.slice(index + 2);
    let eventType = 'data';
    const data = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) eventType = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!data.length) continue;
    const payload = data.join('\n');
    if (payload === '[DONE]') frames.push({ done: true, type: eventType });
    else {
      try {
        frames.push({ type: eventType, json: JSON.parse(payload) });
      } catch {}
    }
  }
  return frames;
}

class OpenAIStreamAggregator {
  constructor(model) {
    this.model = model || '';
    this.state = { buffer: '' };
    this.toolCalls = [];
    this.result = {
      id: '',
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: null }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }

  feed(chunk) {
    for (const frame of extractSseFrames(this.state, chunk)) {
      if (frame.done) continue;
      const json = frame.json;
      if (!this.result.id && json.id) this.result.id = json.id;
      if (!this.model && json.model) this.model = json.model;
      if (json.usage) {
        const usage = normalizeUsage(json.usage);
        this.result.usage.prompt_tokens = usage.input;
        this.result.usage.completion_tokens = usage.output;
        this.result.usage.cache_read_tokens = usage.cacheRead;
        this.result.usage.cache_creation_tokens = usage.cacheCreation;
      }
      const choice = json.choices && json.choices[0];
      if (!choice) continue;
      const delta = choice.delta || {};
      if (typeof delta.content === 'string') this.result.choices[0].message.content += delta.content;
      for (const toolDelta of delta.tool_calls || []) {
        const index = Number.isInteger(toolDelta.index) ? toolDelta.index : 0;
        if (!this.toolCalls[index]) {
          this.toolCalls[index] = { id: '', type: 'function', function: { name: '', arguments: '' } };
        }
        if (toolDelta.id) this.toolCalls[index].id += toolDelta.id;
        if (toolDelta.function && toolDelta.function.name) this.toolCalls[index].function.name += toolDelta.function.name;
        if (toolDelta.function && toolDelta.function.arguments) this.toolCalls[index].function.arguments += toolDelta.function.arguments;
      }
      if (choice.finish_reason) this.result.choices[0].finish_reason = choice.finish_reason;
    }
  }

  getResult() {
    this.result.model = this.model;
    if (this.toolCalls.length) this.result.choices[0].message.tool_calls = this.toolCalls.filter(Boolean);
    this.result.usage.total_tokens = this.result.usage.prompt_tokens + this.result.usage.completion_tokens;
    return this.result;
  }
}

class AnthropicStreamAggregator {
  constructor() {
    this.state = { buffer: '' };
    this.blocks = new Map();
    this.inputBuffers = new Map();
    this.result = {
      id: '', type: 'message', role: 'assistant', content: [], model: '',
      stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  feed(chunk) {
    for (const frame of extractSseFrames(this.state, chunk)) {
      if (frame.done || !frame.json) continue;
      const json = frame.json;
      const type = json.type || frame.type;
      if (type === 'message_start') {
        const message = json.message || {};
        this.result.id = message.id || '';
        this.result.model = message.model || '';
        this._setUsage(message.usage);
      }
      if (type === 'content_block_start') {
        const block = { ...(json.content_block || {}) };
        if (block.type === 'text') block.text = block.text || '';
        if (block.type === 'tool_use') this.inputBuffers.set(json.index, '');
        this.blocks.set(json.index, block);
      }
      if (type === 'content_block_delta') {
        const block = this.blocks.get(json.index);
        const delta = json.delta || {};
        if (block && delta.type === 'text_delta') block.text += delta.text || '';
        if (block && delta.type === 'input_json_delta') {
          this.inputBuffers.set(json.index, (this.inputBuffers.get(json.index) || '') + (delta.partial_json || ''));
        }
      }
      if (type === 'content_block_stop') {
        const block = this.blocks.get(json.index);
        if (block) {
          if (block.type === 'tool_use') {
            try { block.input = JSON.parse(this.inputBuffers.get(json.index) || '{}'); } catch { block.input = {}; }
          }
          this.result.content.push(block);
          this.blocks.delete(json.index);
          this.inputBuffers.delete(json.index);
        }
      }
      if (type === 'message_delta') {
        const delta = json.delta || {};
        if (delta.stop_reason) this.result.stop_reason = delta.stop_reason;
        if (delta.stop_sequence !== undefined) this.result.stop_sequence = delta.stop_sequence;
        this._setUsage(json.usage);
      }
    }
  }

  _setUsage(raw) {
    if (!raw) return;
    const usage = normalizeUsage(raw);
    if (usage.input) this.result.usage.input_tokens = usage.input;
    if (usage.output) this.result.usage.output_tokens = usage.output;
    if (usage.cacheRead) this.result.usage.cache_read_input_tokens = usage.cacheRead;
    if (usage.cacheCreation) this.result.usage.cache_creation_input_tokens = usage.cacheCreation;
  }

  getResult() {
    return this.result;
  }
}

module.exports = { extractSseFrames, OpenAIStreamAggregator, AnthropicStreamAggregator };
