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


/**
 * BLOCK-181 代行评估抓真 — fragment 路径自愈解析。
 * 模型手写 ::visualize 输出路径时可能截断 conversationId（实测 conv_…3c15-3c1），
 * 导致卡片按完整 id 寻址时「文件不存在」。本函数按 basename 在项目 gen-ui
 * 目录内回退定位；命中且目录名为截断 id 时自愈改名为规范会话目录（同
 * BLOCK-179 修复哲学：修复路径让下游全链可用）。包含校验仍然生效。
 *
 * @returns {{ path: string, repaired: boolean } | null} null=无候选
 */
function resolveFragmentPath({ workspacePath, conversationId, filePath }) {
  const fs = require("fs");
  const genUiRoot = path.join(workspacePath, ".petri", "gen-ui");
  const basename = path.basename(filePath.replaceAll("\\", "/"));
  if (!basename || basename.startsWith(".")) return null;
  const canonicalDir = path.join(genUiRoot, conversationId);
  // ① 规范位直查
  const canonicalFile = path.join(canonicalDir, basename);
  try {
    if (fs.statSync(canonicalFile).isFile()) return { path: canonicalFile, repaired: false };
  } catch { /* 落回退 */ }
  // ② 回退：扫各会话目录找同名 basename（mtime 最新优先）
  let genUiEntries = [];
  try { genUiEntries = fs.readdirSync(genUiRoot, { withFileTypes: true }); } catch { return null; }
  const candidates = [];
  for (const entry of genUiEntries) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(genUiRoot, entry.name);
    const hit = path.join(dirPath, basename);
    try {
      const st = fs.statSync(hit);
      if (st.isFile()) candidates.push({ path: hit, dir: dirPath, dirName: entry.name, mtime: st.mtimeMs });
    } catch { /* 无该文件 */ }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  const best = candidates[0];
  // ③ 自愈：目录名是规范 id 的截断/变形（非完全相等）时改名为规范目录
  if (best.dirName !== conversationId && !fs.existsSync(canonicalDir)) {
    try {
      fs.renameSync(best.dir, canonicalDir);
      return { path: path.join(canonicalDir, basename), repaired: true };
    } catch { /* 改名失败（占用等）→ 直接用原路径 */ }
    return { path: best.path, repaired: false };
  }
  return { path: best.path, repaired: false };
}

module.exports = {
  resolveFragmentPath,
  isValidConversationId,
  computeScopeRoot,
  computeScopeKey,
  realpathScopeRoot,
  assertInsideScope,
};
