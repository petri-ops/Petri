'use strict';

/**
 * BLOCK-360（NSO-W2-1）workspace 根反查——主进程不信任渲染层传入的 root。
 *
 * 真相源：projects 表的 workspace_path（后端创建项目时写入；与桌面侧同一 petri.db，
 * 经 _db-singleton 的同一连接读取，不新增连接源）。判定=renderer 传入路径 realpath 后
 * 与某个登记根 realpath **精确相等**（父目录、兄弟目录、软链指向别处一律不算）。
 * 登记根列举失败 → 调用方 fail-closed（不得回落为放行）。
 */

const fs = require('fs');

function realpathOrNull(value) {
  try {
    return fs.realpathSync(value);
  } catch {
    return null;
  }
}

/**
 * @param {string} realRoot           已 realpath 的候选根
 * @param {string[]} registeredRealRoots 已 realpath 的登记根集合
 */
function isRegisteredWorkspaceRoot(realRoot, registeredRealRoots) {
  if (typeof realRoot !== 'string' || !realRoot) return false;
  return Array.isArray(registeredRealRoots) && registeredRealRoots.includes(realRoot);
}

/** 读取 projects 表登记的本地 workspace 根（realpath 归一；不存在的路径跳过）。 */
function listRegisteredWorkspaceRoots() {
  const { openDb } = require('../database/_db-singleton');
  const db = openDb('branch');
  const rows = db
    .prepare("SELECT workspace_path FROM projects WHERE workspace_path IS NOT NULL AND workspace_path != ''")
    .all();
  const roots = new Set();
  for (const row of rows) {
    const real = realpathOrNull(row.workspace_path);
    if (real) roots.add(real);
  }
  return [...roots];
}

module.exports = {
  isRegisteredWorkspaceRoot,
  listRegisteredWorkspaceRoots,
  realpathOrNull,
};
