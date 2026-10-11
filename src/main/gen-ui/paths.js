/**
 * src/main/gen-ui/paths.js
 *
 * BLOCK-166 [C 层] 可视化输出根与路径包含校验（纵深防御——模型输出 path 不可信）。
 * 输出根（D1）：<workspace>/.petri/gen-ui/<conversationId>/。
 */

const path = require('path');
const crypto = require('crypto');

const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** D4 scope key：sha256(workspacePath + conversationId) 十六进制（widgetState 持久化键）。 */
function computeScopeKey(workspacePath, conversationId) {
  return crypto.createHash('sha256').update(`${workspacePath}${conversationId}`).digest('hex');
}

/** 会话 id 形状校验（防 scope 根构造穿越）。 */
function isValidConversationId(conversationId) {
  return typeof conversationId === 'string' && CONVERSATION_ID_PATTERN.test(conversationId);
}

/** 计算会话 scope 根（纯函数；不创建目录——模型经文件工具写入时自建）。 */
function computeScopeRoot(workspacePath, conversationId) {
  if (!workspacePath || !path.isAbsolute(workspacePath)) {
    throw Object.assign(new Error('workspace path must be absolute'), { code: 'invalid-workspace' });
  }
  if (!isValidConversationId(conversationId)) {
    throw Object.assign(new Error('invalid conversation id'), { code: 'invalid-conversation' });
  }
  return path.join(workspacePath, '.petri', 'gen-ui', conversationId);
}

/**
 * realpath 包含校验：filePath 解析后必须严格落在 scopeRoot 内。
 * 调用方保证 scopeRoot 已 realpath；本函数只校验 filePath。
 * 返回归一化后的绝对路径；不符合抛 {code:'outside-scope'}。
 */
function assertInsideScope(scopeRootReal, filePath) {
  const fs = require('fs');
  let real;
  try {
    real = fs.realpathSync(filePath);
  } catch {
    throw Object.assign(new Error('fragment file not found'), { code: 'file-not-found' });
  }
  const rootWithSep = scopeRootReal.endsWith(path.sep) ? scopeRootReal : scopeRootReal + path.sep;
  if (real !== scopeRootReal && !real.startsWith(rootWithSep)) {
    throw Object.assign(new Error('fragment path escapes session gen-ui scope'), { code: 'outside-scope' });
  }
  return real;
}

/** scope 根 realpath（目录必须已存在——模型写入 fragment 时创建）。 */
function realpathScopeRoot(scopeRoot) {
  const fs = require('fs');
  try {
    return fs.realpathSync(scopeRoot);
  } catch {
    throw Object.assign(new Error('gen-ui scope root not found'), { code: 'file-not-found' });
  }
}

module.exports = {
  isValidConversationId,
  computeScopeRoot,
  computeScopeKey,
  realpathScopeRoot,
  assertInsideScope,
};
