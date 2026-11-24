'use strict';

/**
 * BLOCK-511 S3.1c — 子进程环境剥离（单源）。
 *
 * 按「变量名」剥除凭据类变量（不做白名单，避免打断用户 MCP 服务器的环境依赖）：
 *   - 精确：PETRI_LOCAL_REQUEST_TOKEN
 *   - 名称含：TOKEN / SECRET / PASSWORD / PASSWD / API_KEY / PRIVATE_KEY /
 *     CREDENTIAL / ACCESS_KEY / SESSION_KEY（大小写不敏感）
 * 其余环境原样透传；返回 { env, stripped }，stripped 只含被剥除的「变量名」
 * （不写值），供连接日志使用。
 */
const SENSITIVE_EXACT = new Set(['PETRI_LOCAL_REQUEST_TOKEN']);
const SENSITIVE_PATTERN = /TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CREDENTIAL|ACCESS_KEY|SESSION_KEY/i;

function sanitizeChildEnv(base = process.env) {
  const env = {};
  const stripped = [];
  for (const [key, value] of Object.entries(base || {})) {
    if (SENSITIVE_EXACT.has(key) || SENSITIVE_PATTERN.test(key)) {
      stripped.push(key);
      continue;
    }
    Object.defineProperty(env, key, { value, enumerable: true, configurable: true, writable: true });
  }
  return { env, stripped };
}

/** 仅取剥离后的环境（调用点薄接线用）。 */
function childEnv(base = process.env) {
  return sanitizeChildEnv(base).env;
}

module.exports = { sanitizeChildEnv, childEnv, SENSITIVE_EXACT, SENSITIVE_PATTERN };
