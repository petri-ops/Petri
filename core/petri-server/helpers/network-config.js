'use strict';

/**
 * helpers/network-config.js — 网络代理与自签 CA（BLOCK-202 W3 / P0-4）。
 *
 * 与其它配置族的分工（刻意的）：
 *  · 本模块是**把配置写进进程 env 的源头**（`applyNetworkEnv`），不是 env 的消费者；
 *    代理由 Node 24 的内置 env-proxy（`NODE_USE_ENV_PROXY=1` + HTTP(S)_PROXY）生效，
 *    自签 CA 由 `NODE_EXTRA_CA_CERTS` 生效——两者都只在进程启动时被读取，所以设置面
 *    必须诚实提示「需重启后端生效」。
 *  · **本地回环永不走代理**：NO_PROXY 强制并入 localhost / 127.0.0.1 / ::1，
 *    否则网关与隧道自检会被代理劫持（验收门明确要求"与网关本地回环互不干扰"）。
 *  · 只存**路径**不存证书内容；CA 文件不存在时给结构化诊断且不设置 env（不静默失败）。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  commitGuard,
  findEntryByPath,
} = require('../../packages/shared-config/config-schema.js');

const FAMILY = 'network';
const STORE_FILENAME = 'network.json';
const LOOPBACK_NO_PROXY = ['localhost', '127.0.0.1', '::1'];

/** 进程启动时实际写入 env 的快照；`null`=尚未 apply（测试/独立进程）。 */
let appliedSnapshot = null;

function storePath() {
  const root = process.env.PETRI_LOCAL_DATA_DIR || path.join(os.homedir(), 'Documents', 'Petri-Local');
  return path.join(root, STORE_FILENAME);
}

function lookup(family, storagePath) {
  return findEntryByPath(family, storagePath);
}

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    for (const key of ['httpProxy', 'httpsProxy', 'noProxy', 'caFile']) {
      if (typeof parsed[key] === 'string') out[key] = parsed[key];
    }
    return out;
  } catch {
    return {};
  }
}

function writeStore(values) {
  const dir = path.dirname(storePath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    storePath(),
    JSON.stringify({ ...values, updatedAt: new Date().toISOString() }, null, 2) + '\n',
    'utf8',
  );
  return values;
}

function normalize(values) {
  return {
    httpProxy: typeof values.httpProxy === 'string' ? values.httpProxy.trim() : '',
    httpsProxy: typeof values.httpsProxy === 'string' ? values.httpsProxy.trim() : '',
    noProxy: typeof values.noProxy === 'string' ? values.noProxy.trim() : '',
    caFile: typeof values.caFile === 'string' ? values.caFile.trim() : '',
  };
}

/** 写侧：逐项过共享注册表守卫；未知键/非法形状 → 抛 config_value_rejected（路由映射 400）。 */
function saveNetworkConfig(patch) {
  // 整包过守卫（不先挑已知键）：未知键必须被拒，而不是被过滤后静默消失。
  const guard = commitGuard(FAMILY, patch && typeof patch === 'object' ? patch : {}, lookup);
  if (!guard.ok) {
    const error = new Error('config_value_rejected');
    error.diagnostics = guard.diagnostics;
    throw error;
  }
  const current = readStore();
  const next = { ...current, ...guard.normalized };
  writeStore(next);
  return getNetworkSnapshot();
}

/** 生效 NO_PROXY：用户项 + 强制回环项（去重保序）。 */
function effectiveNoProxy(noProxy) {
  const items = String(noProxy || '').split(',').map((item) => item.trim()).filter(Boolean);
  for (const loopback of LOOPBACK_NO_PROXY) {
    if (!items.includes(loopback)) items.push(loopback);
  }
  return items.join(',');
}

/**
 * 把持久化配置应用到进程 env（只在启动时调用一次）。
 * @returns {{applied:object, diagnostics:Array}}
 */
function applyNetworkEnv(env = process.env) {
  const stored = normalize(readStore());
  const diagnostics = [];
  const applied = { ...stored };

  const proxy = stored.httpsProxy || stored.httpProxy;
  if (stored.httpProxy) env.HTTP_PROXY = stored.httpProxy;
  else delete env.HTTP_PROXY;
  if (stored.httpsProxy) env.HTTPS_PROXY = stored.httpsProxy;
  else delete env.HTTPS_PROXY;
  if (proxy) env.NODE_USE_ENV_PROXY = '1';
  else delete env.NODE_USE_ENV_PROXY;
  env.NO_PROXY = effectiveNoProxy(stored.noProxy);

  if (stored.caFile) {
    if (fs.existsSync(stored.caFile)) {
      env.NODE_EXTRA_CA_CERTS = stored.caFile;
    } else {
      delete env.NODE_EXTRA_CA_CERTS;
      diagnostics.push({
        code: 'ca-file-missing',
        family: FAMILY,
        path: 'caFile',
        message: `CA 文件不存在：${stored.caFile}（未设置 NODE_EXTRA_CA_CERTS）`,
      });
    }
  } else {
    delete env.NODE_EXTRA_CA_CERTS;
  }

  appliedSnapshot = { ...applied, noProxyEffective: env.NO_PROXY, appliedAt: new Date().toISOString() };
  return { applied: appliedSnapshot, diagnostics };
}

/** 测试用：清掉模块内的"已应用"快照（不碰真实 env）。 */
function resetAppliedSnapshotForTest() {
  appliedSnapshot = null;
}

function getNetworkSnapshot() {
  const stored = normalize(readStore());
  const restartRequired = appliedSnapshot != null
    ? Object.entries(stored).some(([key, value]) => appliedSnapshot[key] !== value)
    : false;
  return {
    configured: stored,
    applied: appliedSnapshot,
    noProxyEffective: effectiveNoProxy(stored.noProxy),
    restartRequired,
    diagnostics: appliedSnapshot && stored.caFile && !fs.existsSync(stored.caFile)
      ? [{ code: 'ca-file-missing', family: FAMILY, path: 'caFile', message: `CA 文件不存在：${stored.caFile}` }]
      : [],
  };
}

module.exports = {
  FAMILY,
  STORE_FILENAME,
  LOOPBACK_NO_PROXY,
  storePath,
  readStore,
  writeStore,
  saveNetworkConfig,
  applyNetworkEnv,
  effectiveNoProxy,
  getNetworkSnapshot,
  resetAppliedSnapshotForTest,
};
