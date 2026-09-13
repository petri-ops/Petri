'use strict';

/**
 * BLOCK-70 P3 — aliyun 反向隧道管理（A2 真远程段）。
 *
 * 桌面端主动发起出站 `ssh -N -R 127.0.0.1:<remote>:127.0.0.1:<local> <host>`，
 * 钉在远端回环（免 GatewayPorts、不开任何入站端口，D7/BLOCK-57 安全哲学同门）。
 * ssh 只用 ~/.ssh/config 的 Host 别名解析（key-only，BatchMode 失败即败）。
 *
 * 状态机：disabled → connecting → connected（进程存活超过 stableMs 视为已建立，
 * ExitOnForwardFailure 保证端口冲突会立刻退出而非假连）→ 进程退出 →
 * reconnecting（固定退避序列重试）。
 *
 * 诚实边界：connected 是「转发已建立」的强启发（ExitOnForwardFailure + 存活），
 * 不是端到端探活；端到端验证走 aliyun 回环 curl（见 block70-tunnel-live.mjs）。
 */

const fs = require('node:fs');
const path = require('node:path');

const TUNNEL_CONFIG_VERSION = 1;
const RECONNECT_BACKOFF_MS = Object.freeze([1000, 2000, 5000, 10000, 30000]);
const STABLE_CONNECTED_MS = 10 * 1000;
const HOST_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;

function tunnelConfigPath(dataDir) {
  return path.join(dataDir, 'mobile', 'tunnel.json');
}

function normalizeTunnelConfig(raw) {
  const host = typeof raw?.host === 'string' ? raw.host.trim() : '';
  const remotePort = Number.isInteger(raw?.remotePort) && raw.remotePort > 0 && raw.remotePort < 65536
    ? raw.remotePort : 2233;
  const localPort = Number.isInteger(raw?.localPort) && raw.localPort > 0 && raw.localPort < 65536
    ? raw.localPort : 3005;
  let publicUrl = typeof raw?.publicUrl === 'string' ? raw.publicUrl.trim() : '';
  if (publicUrl && !/^https:\/\/[A-Za-z0-9.:_-]+$/.test(publicUrl)) publicUrl = '';
  return {
    enabled: raw?.enabled === true,
    host: HOST_PATTERN.test(host) ? host : '',
    remotePort,
    localPort,
    publicUrl,
  };
}

function readTunnelConfig(dataDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(tunnelConfigPath(dataDir), 'utf8'));
    return normalizeTunnelConfig(raw);
  } catch {
    return normalizeTunnelConfig({});
  }
}

function writeTunnelConfig(dataDir, patch = {}) {
  const next = normalizeTunnelConfig({ ...readTunnelConfig(dataDir), ...patch });
  fs.mkdirSync(path.dirname(tunnelConfigPath(dataDir)), { recursive: true });
  const tmp = `${tunnelConfigPath(dataDir)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, tunnelConfigPath(dataDir));
  return next;
}

/** ssh 参数构造（独立导出便于契约测试；argv 数组，无 shell）。 */
function buildSshArgs(config) {
  return [
    'ssh', '-N', '-T',
    '-o', 'BatchMode=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ConnectTimeout=10',
    '-R', `127.0.0.1:${config.remotePort}:127.0.0.1:${config.localPort}`,
    config.host,
  ];
}

const managersByDataDir = new Map();

/**
 * 进程级单例：主后端的 admin REST 与 boot 钩子共享同一个隧道管理器。
 * spawnProcess 可注入（测试用假进程）。
 */
function getTunnelManager(dataDir, deps = {}) {
  const key = path.resolve(dataDir);
  let manager = managersByDataDir.get(key);
  if (!manager) {
    manager = createTunnelManager({ dataDir: key, ...deps });
    managersByDataDir.set(key, manager);
  }
  return manager;
}

function resetTunnelManagersForTest() {
  managersByDataDir.clear();
}

function createTunnelManager({
  dataDir,
  now = () => Date.now(),
  spawnProcess = (args) => require('node:child_process').spawn(args[0], args.slice(1), { stdio: 'ignore' }),
  backoffSteps = RECONNECT_BACKOFF_MS,
  stableConnectedMs = STABLE_CONNECTED_MS,
} = {}) {
  let config = readTunnelConfig(dataDir);
  let child = null;
  let state = config.enabled && config.host ? 'connecting' : 'disabled';
  let stateSinceTs = now();
  let lastError = '';
  let backoffIndex = 0;
  let reconnectTimer = null;
  let stopped = true;

  function setState(next) {
    state = next;
    stateSinceTs = now();
  }

  function spawnTunnel() {
    const args = buildSshArgs(config);
    setState('connecting');
    child = spawnProcess(args);
    const startedAt = now();
    child.on('error', (error) => {
      lastError = String(error && error.message).slice(0, 200);
    });
    child.on('exit', (code) => {
      child = null;
      if (stopped || !config.enabled) return;
      lastError = `ssh exited (code=${code == null ? 'signal' : code})`;
      setState('reconnecting');
      const delay = backoffSteps[Math.min(backoffIndex, backoffSteps.length - 1)];
      backoffIndex += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!stopped && config.enabled) spawnTunnel();
      }, delay);
      if (reconnectTimer.unref) reconnectTimer.unref();
    });
  }

  function tick() {
    // connected 判定：进程存活超过 stableConnectedMs（配合 ExitOnForwardFailure）。
    if (state === 'connecting' && child && now() - stateSinceTs >= stableConnectedMs) {
      setState('connected');
      backoffIndex = 0;
    }
  }

  const manager = {
    /** 读取状态（admin REST 读取时顺带推进状态机）。 */
    status() {
      tick();
      return {
        configured: Boolean(config.host),
        enabled: config.enabled,
        state,
        host: config.host,
        remotePort: config.remotePort,
        localPort: config.localPort,
        publicUrl: config.publicUrl,
        lastError,
        pid: child ? child.pid : null,
        stateSinceTs,
      };
    },

    getConfig() {
      return { ...config };
    },

    /** 应用新配置：写盘 + 原子切换（先停旧进程再按新配置拉起）。 */
    apply(nextPatch) {
      this.stop();
      config = writeTunnelConfig(dataDir, nextPatch);
      lastError = '';
      backoffIndex = 0;
      if (config.enabled && config.host) {
        stopped = false;
        setState('connecting');
        spawnTunnel();
      } else {
        stopped = true;
        setState('disabled');
      }
      return this.status();
    },

    /** boot 恢复：按已持久化配置拉起（不重写盘）。 */
    startIfEnabled() {
      config = readTunnelConfig(dataDir);
      if (!config.enabled || !config.host) {
        stopped = true;
        setState('disabled');
        return this.status();
      }
      stopped = false;
      setState('connecting');
      spawnTunnel();
      return this.status();
    },

    stop() {
      stopped = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (child) { try { child.kill(); } catch {} child = null; }
    },
  };

  if (config.enabled && config.host) {
    stopped = false;
    setState('connecting');
    spawnTunnel();
  } else {
    stopped = true;
    setState('disabled');
  }

  return manager;
}

module.exports = {
  TUNNEL_CONFIG_VERSION,
  RECONNECT_BACKOFF_MS,
  STABLE_CONNECTED_MS,
  HOST_PATTERN,
  tunnelConfigPath,
  normalizeTunnelConfig,
  readTunnelConfig,
  writeTunnelConfig,
  buildSshArgs,
  getTunnelManager,
  resetTunnelManagersForTest,
  createTunnelManager,
};
