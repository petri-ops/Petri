'use strict';

/**
 * dev-verify/local-token.cjs — L1-3（蓝图 L-52 / BLOCK-405）无 Origin 本地变更请求的
 * token 读取 helper（零依赖，flow 独立引用）。
 *
 * 后端在 PETRI_LOCAL_REQUEST_TOKEN 在场时对「无 Origin + POST/PUT/DELETE/PATCH」要求
 * `x-petri-local-request-token` 头（token 由 main 每 boot 随机生成，落
 * <dataDir>/local-request-token 0600）。flow/dev 脚本经本 helper 读取；找不到 token 时
 * 返回 {}（token 门未激活的栈兼容）。
 */
const fs = require('fs');
const path = require('path');

function readTokenFile(p) {
  try {
    const value = fs.readFileSync(p, 'utf8').trim();
    return value || null;
  } catch {
    return null;
  }
}

function resolveLocalRequestToken() {
  if (process.env.PETRI_LOCAL_REQUEST_TOKEN) return process.env.PETRI_LOCAL_REQUEST_TOKEN;
  const candidates = [];
  if (process.env.PETRI_LOCAL_DATA_DIR) candidates.push(path.join(process.env.PETRI_LOCAL_DATA_DIR, 'local-request-token'));
  const repoRoot = findRepoRoot();
  if (repoRoot) candidates.push(path.join(repoRoot, '.petri-dev-user-data', 'local-request-token'));
  if (process.env.HOME) candidates.push(path.join(process.env.HOME, 'Documents', 'Petri-Local', 'local-request-token'));
  for (const candidate of candidates) {
    const token = readTokenFile(candidate);
    if (token) return token;
  }
  return null;
}

function findRepoRoot() {
  let dir = __dirname;
  for (let i = 0; i < 10; i += 1) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

module.exports = function localRequestTokenHeaders() {
  const token = resolveLocalRequestToken();
  return token ? { 'x-petri-local-request-token': token } : {};
};
