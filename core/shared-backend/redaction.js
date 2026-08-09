'use strict';

const SENSITIVE_VALUE = '[REDACTED]';
const SENSITIVE_KEY = /(?:^|[_-])(?:authorization|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret|secret[_-]?access[_-]?key|private[_-]?key)$/i;
const CAMEL_CASE_SENSITIVE_KEY = /^(?:remoteComputeToken|contextToken)$/i;
const CREDENTIAL_NAME = String.raw`(?:remoteComputeToken|contextToken|(?:[A-Za-z][A-Za-z0-9]*[_-])*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret(?:[_-]?access[_-]?key)?|private[_-]?key))`;

function isSensitiveKey(key) {
  return SENSITIVE_KEY.test(key) || CAMEL_CASE_SENSITIVE_KEY.test(key);
}

function redactSensitiveText(input) {
  return String(input || '')
    .replace(
      /(\b(?:authorization|x-api-key)\b\s*[:=]\s*)(?:bearer\s+)?[^\s"',}]+/gi,
      `$1${SENSITIVE_VALUE}`,
    )
    .replace(
      new RegExp(`((?:["']?)\\b${CREDENTIAL_NAME}\\b(?:["']?)\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;}]+)`, 'gi'),
      `$1${SENSITIVE_VALUE}`,
    )
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret)=)[^&#\s]+/gi,
      `$1${SENSITIVE_VALUE}`,
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{16,}|rk_live_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[A-Z0-9]{16}|AIza[0-9A-Za-z_-]{20,})\b/g,
      SENSITIVE_VALUE,
    );
}

function redactSensitiveValue(value, ancestors = new WeakSet()) {
  if (typeof value === 'string') return redactSensitiveText(value);
  if (value == null || typeof value !== 'object') return value;
  if (ancestors.has(value)) return '[Circular]';

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactSensitiveValue(item, ancestors));
    }
    const output = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = isSensitiveKey(key)
        ? SENSITIVE_VALUE
        : redactSensitiveValue(child, ancestors);
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

module.exports = { redactSensitiveText, redactSensitiveValue, SENSITIVE_VALUE };
