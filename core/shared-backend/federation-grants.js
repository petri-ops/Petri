'use strict';

/**
 * BLOCK-88 P3（D4/D5）— 联邦项目授权清单（被访端单一真相）。
 *
 * grants.json 落 <dataDir>/federation/grants.json：宿主按「工程师署名 × 项目」
 * 逐条授权（D4 默认零授权、可随时吊销）；委托/分派请求越界时诚实 403。
 * 键=工程师声明署名（D1-A 轻量声明身份——同署名跨重配对保持授权，换署名
 * 即另一工程师，信任模型=配对 token + 熟人网络，面板诚实标注）。
 *
 * 与 peers.json/sessions.json 同构：文件制 + 原子写；DB 零新业务表。
 * 授权操作只发生在宿主桌面面（federation-admin REST），读面含网关会话门
 * （访客列自己的被授权项目）。
 */

const fs = require('fs');
const path = require('node:path');

const GRANTS_VERSION = 1;
const FIELD_MAX = 40;

function grantsFile(dataDir) {
  return path.join(dataDir, 'federation', 'grants.json');
}

function cleanKey(value) {
  return typeof value === 'string' ? value.trim().slice(0, FIELD_MAX) : '';
}

function loadGrants(dataDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(grantsFile(dataDir), 'utf8'));
    if (raw && Array.isArray(raw.grants)) {
      return { version: GRANTS_VERSION, grants: raw.grants };
    }
  } catch { /* first run */ }
  return { version: GRANTS_VERSION, grants: [] };
}

function persistGrants(dataDir, data) {
  fs.mkdirSync(path.dirname(grantsFile(dataDir)), { recursive: true });
  const tmp = `${grantsFile(dataDir)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, grantsFile(dataDir));
}

/** 授权（幂等）：返回该工程师授权后的完整清单。 */
function grantProject(dataDir, engineer, projectId) {
  const name = cleanKey(engineer);
  const pid = cleanKey(projectId);
  if (!name || !pid) return { ok: false, error: 'engineer_and_project_required' };
  const data = loadGrants(dataDir);
  if (!data.grants.some((g) => g.engineer === name && g.projectId === pid)) {
    data.grants.push({ engineer: name, projectId: pid, grantedAt: new Date().toISOString() });
    persistGrants(dataDir, data);
  }
  return { ok: true, grants: data.grants.filter((g) => g.engineer === name) };
}

/** 吊销：返回是否确有删除。 */
function revokeProject(dataDir, engineer, projectId) {
  const name = cleanKey(engineer);
  const pid = cleanKey(projectId);
  if (!name || !pid) return { ok: false, error: 'engineer_and_project_required' };
  const data = loadGrants(dataDir);
  const before = data.grants.length;
  data.grants = data.grants.filter((g) => !(g.engineer === name && g.projectId === pid));
  if (data.grants.length === before) return { ok: false, error: 'grant_not_found' };
  persistGrants(dataDir, data);
  return { ok: true, grants: data.grants.filter((g) => g.engineer === name) };
}

function listGrants(dataDir) {
  return loadGrants(dataDir).grants;
}

function isProjectGranted(dataDir, engineer, projectId) {
  const name = cleanKey(engineer);
  const pid = cleanKey(projectId);
  if (!name || !pid) return false;
  return loadGrants(dataDir).grants.some((g) => g.engineer === name && g.projectId === pid);
}

/** 访客侧投影：某工程师被授权的项目清单（不含时间等宿主内部信息）。 */
function grantedProjectsFor(dataDir, engineer) {
  const name = cleanKey(engineer);
  return loadGrants(dataDir).grants
    .filter((g) => g.engineer === name)
    .map((g) => ({ projectId: g.projectId }));
}

module.exports = {
  GRANTS_VERSION,
  grantsFile,
  loadGrants,
  grantProject,
  revokeProject,
  listGrants,
  isProjectGranted,
  grantedProjectsFor,
};
