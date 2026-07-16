/** Small task-oriented helpers on top of the Model Gateway. */

const { modelGateway } = require('./model-gateway');

function responseText(response) {
  if (!response || response.error) return '';
  const message = response.choices && response.choices[0] && response.choices[0].message;
  return String((message && message.content) || '').trim();
}

function parseJsonText(text) {
  const source = String(text || '').trim();
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch {}
  const objectMatch = source.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {}
  }
  const arrayMatch = source.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {}
  }
  return null;
}

async function callModelTask({
  role,
  messages,
  temperature,
  maxTokens,
  responseFormat,
  telemetry,
  profileId,
  parameters,
}) {
  const body = {
    ...(parameters || {}),
    messages: Array.isArray(messages) ? messages : [],
    stream: false,
  };
  if (temperature !== undefined) body.temperature = temperature;
  if (maxTokens !== undefined) body.max_tokens = maxTokens;
  if (responseFormat !== undefined) body.response_format = responseFormat;
  const response = await modelGateway.chat({ role, profileId, body, telemetry });
  return { response, text: responseText(response), error: response && response.error };
}

module.exports = { callModelTask, responseText, parseJsonText };
