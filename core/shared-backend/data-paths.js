'use strict';

/**
 * shared-backend/data-paths.js — 落点目录的**唯一解析实现**（BLOCK-203 W4b P1）。
 *
 * 为什么需要它：P0 测绘出四条手写回落链，同一个「数据目录」在不同模块里可以是四个不同位置：
 *
 *   | 模块 | 原回落链 |
 *   | --- | --- |
 *   | `routes/user-prefs.js` | PETRI_LOCAL_DATA_DIR → LOCAL_DATA_DIR → **cwd/data** |
 *   | `helpers/mcp-settings.js` | PETRI_LOCAL_DATA_DIR → ~/Documents/Petri-Local（**不认 LOCAL_DATA_DIR / USER_DATA_DIR**） |
 *   | `helpers/agent-user-rules.js` | PETRI_LOCAL_DATA_DIR → **PETRI_USER_DATA_DIR** → ~/Documents/Petri-Local |
 *   | `shared-backend/skill-prefs.js` | **只认 PETRI_USER_DATA_DIR** → ~/.petri |
 *
 * 本模块把它们收成**两个有名字的根**（不是硬合成一个目录——那会把用户已有文件搬走）：
 *
 *  · `resolveDataDir()`      —— 应用数据根（DB / 结果 / 设置落点）：桌面端 env-coordinator 设为
 *                               `~/Documents/<产品目录>`；这是绝大多数配置落点该待的地方。
 *  · `resolveUserStateDir()` —— 用户态根（技能治理账本这类"跟机器/账号绑定"的状态）：
 *                               桌面端 backend-proc-manager 把它设成 app.getPath('userData')。
 *
 * **语义一致性规则**：同一份文件只能由这两个函数之一拼出来，不许模块自己再写一遍 env 优先序。
 * 谁该用哪个根，登记在 `docs/block-203-...-plan.md` §10 的落点表里；改根=用户数据迁移，
 * 必须单独裁决（本模块只统一"怎么算"，不擅自改"算到哪"）。
 */

const os = require('node:os');
const path = require('node:path');

/** 应用数据根的 env 优先序（顺序即优先级，逐字对齐 BLOCK-203 P0 实测的现状并集）。 */
const DATA_DIR_ENV_ORDER = Object.freeze([
  'PETRI_LOCAL_DATA_DIR',
  'LOCAL_DATA_DIR',
  'PETRI_USER_DATA_DIR',
]);

/** 用户态根的 env 优先序（技能治理账本的历史口径）。 */
const USER_STATE_ENV_ORDER = Object.freeze(['PETRI_USER_DATA_DIR']);

const DEFAULT_DATA_DIR_NAME = 'Petri-Local';

function firstEnv(env, keys) {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

/**
 * 应用数据根。
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{homedir?:string}} [options] 测试注入
 */
function resolveDataDir(env = process.env, options = {}) {
  const fromEnv = firstEnv(env, DATA_DIR_ENV_ORDER);
  if (fromEnv) return fromEnv;
  const home = options.homedir || os.homedir();
  return path.join(home, 'Documents', DEFAULT_DATA_DIR_NAME);
}

/**
 * 用户态根。
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{homedir?:string}} [options]
 */
function resolveUserStateDir(env = process.env, options = {}) {
  const fromEnv = firstEnv(env, USER_STATE_ENV_ORDER);
  if (fromEnv) return fromEnv;
  const home = options.homedir || os.homedir();
  return path.join(home, '.petri');
}

/** 应用数据根下的文件路径。 */
function dataFile(name, env = process.env, options = {}) {
  return path.join(resolveDataDir(env, options), name);
}

/** 用户态根下的文件路径。 */
function userStateFile(name, env = process.env, options = {}) {
  return path.join(resolveUserStateDir(env, options), name);
}

/**
 * 历史落点（只读兼容用）：BLOCK-203 W4b 之前某些模块把文件写在别处。
 * 目前只有 `user-prefs`：它在"两个 env 都没设"时会写 `cwd/data`。
 * 调用方应当"读旧、写新"，且**不删除**旧文件（用户可能回退版本）。
 */
function legacyDataDirs(env = process.env, cwd = process.cwd()) {
  if (firstEnv(env, DATA_DIR_ENV_ORDER)) return [];
  return [path.join(cwd, 'data')];
}

module.exports = {
  DATA_DIR_ENV_ORDER,
  USER_STATE_ENV_ORDER,
  resolveDataDir,
  resolveUserStateDir,
  dataFile,
  userStateFile,
  legacyDataDirs,
};
