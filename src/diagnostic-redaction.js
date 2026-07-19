"use strict";

const SENSITIVE_VALUE = "[REDACTED]";

function redactSensitiveText(input) {
  return String(input || "")
    .replace(
      /(\b(?:authorization|x-api-key)\b\s*[:=]\s*)(?:bearer\s+)?[^\s"',}]+/gi,
      `$1${SENSITIVE_VALUE}`,
    )
    .replace(
      /((?:["']?)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|remoteComputeToken|password|secret)(?:["']?)\s*[:=]\s*["'])[^"']*(["'])/gi,
      `$1${SENSITIVE_VALUE}$2`,
    )
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|token)=)[^&#\s]+/gi,
      `$1${SENSITIVE_VALUE}`,
    )
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, SENSITIVE_VALUE);
}

module.exports = { redactSensitiveText, SENSITIVE_VALUE };
