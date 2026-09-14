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
const { spawn: cpSpawn, spawnSync: cpSpawnSync } = require('node:child_process');

const TUNNEL_CONFIG_VERSION = 1;
const RECONNECT_BACKOFF_MS = Object.freeze([1000, 2000, 5000, 10000, 30000]);
const STABLE_CONNECTED_MS = 10 * 1000;
const HOST_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;

function tunnelConfigPath(dataDir) {
  return path.join(dataDir, 'mobile', 'tunnel.json');
}

/**
 * 纯函数：从进程清单里挑出「命令行含本隧道签名」的孤儿 ssh pid。
 * entries = [{pid, commandline}]；excludePids = 当前管理器在册孩子，绝杀不得。
 */
function selectStaleSshPids(entries, signature, excludePids = []) {
  const exclude = new Set(excludePids);
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry
      && Number.isInteger(entry.pid) && entry.pid > 0
      && !exclude.has(entry.pid)
      && typeof entry.commandline === 'string'
      && entry.commandline.includes(signature))
    .map((entry) => entry.pid);
}

/**
 * 跨代清场：历史服务进程被树杀逃逸后遗留的孤儿 ssh 会一直占用远端端口，
 * 新隧道永远 bind 失败互抖——spawn 前按「-R 签名」把所有孤儿清光。
 * 只按精确签名匹配（remote:local 端口对），绝不误伤别的 ssh 用途。
 */
function killStaleTunnelProcesses(dataDir, config, excludePids = []) {
  const signature = `127.0.0.1:${config.remotePort}:127.0.0.1:${config.localPort}`;
  try {
    let entries = [];
    if (process.platform === 'win32') {
      // 随包 .ps1：免 EncodedCommand/引号转义（BLOCK-76 教训：内联 PS 必炸）
      const psPath = path.join(__dirname, 'list-ssh-pids.ps1');
      const out = require('node:child_process').execSync(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}" "${signature}"`,
        { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] });
      entries = String(out).split(/\r?\n/).filter(Boolean).map((line) => ({
        pid: Number(line.trim()),
        commandline: signature,
      }));
    } else {
      const out = require('node:child_process').execSync(
        'ps -eo pid=,args=', { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
      entries = out.split(/\r?\n/).filter(Boolean).map((line) => {
        const match = line.match(/^\s*(\d+)\s+(.*)$/);
        return match ? { pid: Number(match[1]), commandline: match[2] } : null;
      }).filter(Boolean);
    }
    const stalePids = selectStaleSshPids(entries, signature, excludePids);
    for (const pid of stalePids) {
      try { process.kill(pid); } catch { /* 已死即目标达成 */ }
    }
    return stalePids;
  } catch {
    return [];
  }
}

function normalizeTunnelConfig(raw) {
  const host = typeof raw?.host === 'string' ? raw.host.trim() : '';
  const remotePort = Number.isInteger(raw?.remotePort) && raw.remotePort > 0 && raw.remotePort < 65536
    ? raw.remotePort : 2233;
  const localPort = Number.isInteger(raw?.localPort) && raw.localPort > 0 && raw.localPort < 65536
    ? raw.localPort : 3005;
  let publicUrl = typeof raw?.publicUrl === 'string' ? raw.publicUrl.trim() : '';
  if (publicUrl && !/^https:\/\/[A-Za-z0-9.:_-]+$/.test(publicUrl)) publicUrl = '';
  // BLOCK-87 — 中转服务器档案：配过的服务器存档，切换免重填。
  let profiles = Array.isArray(raw?.profiles) ? raw.profiles : [];
  profiles = profiles
    .map((p) => ({
      name: typeof p?.name === 'string' ? p.name.trim().slice(0, 40) : '',
      host: typeof p?.host === 'string' && HOST_PATTERN.test(p.host) ? p.host : '',
      publicUrl: typeof p?.publicUrl === 'string' && /^https:\/\/[A-Za-z0-9.:_-]+$/.test(p.publicUrl.trim()) ? p.publicUrl.trim() : '',
      remotePort: Number.isInteger(p?.remotePort) && p.remotePort > 0 && p.remotePort < 65536 ? p.remotePort : 2233,
    }))
    .filter((p) => p.name && p.host);
  const seen = new Set();
  profiles = profiles.filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true)));
  return {
    enabled: raw?.enabled === true,
    host: HOST_PATTERN.test(host) ? host : '',
    remotePort,
    localPort,
    publicUrl,
    profiles,
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
  killStale = killStaleTunnelProcesses,
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
  // 全量跟踪：Windows 上 exit 事件偶发丢失会留下活孤儿，只杀「最后一个孩子」
  // 不够——新孩子出生前必须杀光所有旧孩子，保证任一时刻至多一条隧道。
  const liveChildren = new Set();

  function killAllTracked() {
    for (const proc of liveChildren) {
      try { proc.kill(); } catch { /* 已死 */ }
    }
    liveChildren.clear();
  }

  function setState(next) {
    state = next;
    stateSinceTs = now();
  }

  // 独立同步清场（不走可注入的 spawnProcess——那是隧道 ssh 专用 mock 点）。
  // 必须阻塞等待完成：异步清场会与正式 ssh 竞态（清场未完成新连接已抢跑绑
  // 端口失败 → 255 循环）。
  function remotePortSweep() {
    if (!config.host) return;
    try {
      cpSpawnSync('ssh', [
        '-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', config.host,
        'pid=$(ss -tlnp "sport = :' + config.remotePort + '" 2>/dev/null | grep -oP "pid=\\K[0-9]+" | head -1); if [ -n "$pid" ]; then kill "$pid"; fi; sleep 1; true',
      ], { timeout: 25_000, stdio: 'ignore' });
    } catch { /* 尽力而为 */ }
  }

  function spawnTunnel() {
    const args = buildSshArgs(config);
    setState('connecting');
    killStale(dataDir, config, [...liveChildren].map((proc) => proc.pid));
    killAllTracked();
    remotePortSweep();
    const proc = spawnProcess(args);
    child = proc;
    const startedAt = now();
    liveChildren.add(proc);
    proc.on('error', (error) => {
      lastError = String(error && error.message).slice(0, 200);
    });
    proc.on('exit', (code) => {
      liveChildren.delete(proc);
      if (child === proc) child = null;
      if (stopped || !config.enabled) return;
      // Windows 上 exit 事件可能迟到/乱序：只要还有任一活孩子（哪怕不是当前
      // 指针指向的），说明隧道在它手里正常工作，绝不能触发重连去杀它。
      if (liveChildren.size > 0) return;
      lastError = `ssh exited (code=${code == null ? 'signal' : code})`;
      setState('reconnecting');
      const delay = backoffSteps[Math.min(backoffIndex, backoffSteps.length - 1)];
      backoffIndex += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!stopped && config.enabled && liveChildren.size === 0) spawnTunnel();
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
      killAllTracked();
      child = null;
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
  selectStaleSshPids,
  killStaleTunnelProcesses,
  getTunnelManager,
  resetTunnelManagersForTest,
  createTunnelManager,
};
