'use strict';

/**
 * BLOCK-70 mobile-gateway — 配置与 LAN 地址。
 *
 * 配置文件制 <dataDir>/mobile/gateway.json（additive，默认关闭）。
 * 改动生效需重启（与 BLOCK-84「重启生效」先例一致，UI 诚实提示）。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_CONFIG = Object.freeze({ enabled: false, port: 3005, bind: '0.0.0.0' });

function configPath(dataDir) {
  return path.join(dataDir, 'mobile', 'gateway.json');
}

function readConfig(dataDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(dataDir), 'utf8'));
    return {
      enabled: raw.enabled === true,
      port: Number.isInteger(raw.port) && raw.port > 0 && raw.port < 65536 ? raw.port : DEFAULT_CONFIG.port,
      bind: raw.bind === '127.0.0.1' ? '127.0.0.1' : DEFAULT_CONFIG.bind,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfig(dataDir, patch = {}) {
  const next = { ...readConfig(dataDir) };
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
  if (Number.isInteger(patch.port) && patch.port > 0 && patch.port < 65536) next.port = patch.port;
  if (patch.bind === '0.0.0.0' || patch.bind === '127.0.0.1') next.bind = patch.bind;
  fs.mkdirSync(path.dirname(configPath(dataDir)), { recursive: true });
  const tmp = `${configPath(dataDir)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, configPath(dataDir));
  return next;
}

/** 本机局域网 IPv4 地址（非回环），供二维码 URL 列表。 */
function lanAddresses() {
  const result = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net && net.family === 'IPv4' && !net.internal) result.push(net.address);
    }
  }
  return result;
}

function resolveEnabled({ dataDir, env = process.env } = {}) {
  if (env.PETRI_MOBILE_ENABLED === '1' || env.PETRI_MOBILE_ENABLED === 'true') return true;
  return readConfig(dataDir).enabled;
}

function resolvePort({ dataDir, env = process.env } = {}) {
  const fromEnv = Number(env.PETRI_MOBILE_PORT);
  if (Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv < 65536) return fromEnv;
  return readConfig(dataDir).port;
}

module.exports = { DEFAULT_CONFIG, configPath, readConfig, writeConfig, lanAddresses, resolveEnabled, resolvePort };
