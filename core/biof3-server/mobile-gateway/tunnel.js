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
 *
 * BLOCK-145 D1（BK-08 根因修复）：冷启动链全部异步化——原实现 remotePortSweep 用
 * 同步 spawn 跑 ssh（ConnectTimeout=10，25s 超时）、killStale 用同步 exec 列进程，
 * 启动路径在 event loop 上同步等待网络往返，卡死桌面冷启动。现改为异步 spawn +
 * 超时；清场顺序（孤儿清场 → 在册孩子清场 → 远端端口清场 → spawn 正式 ssh）、
 * ssh 参数、远端命令与超时上限逐项保持不变，只把「等待」从阻塞改为异步。
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn: cpSpawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileP = promisify(execFile);

const TUNNEL_CONFIG_VERSION = 1;
const RECONNECT_BACKOFF_MS = Object.freeze([1000, 2000, 5000, 10000, 30000]);
const STABLE_CONNECTED_MS = 10 * 1000;
const HOST_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;
// 清场超时上限（与旧同步实现逐值一致：远端清场 25s、win 进程清单 10s、posix 5s）
const REMOTE_SWEEP_TIMEOUT_MS = 25_000;
const LIST_SSH_PIDS_WIN_TIMEOUT_MS = 10_000;
const LIST_SSH_PIDS_POSIX_TIMEOUT_MS = 5_000;

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

/** 远端清场的 ssh 参数（独立导出便于契约锚定；argv 数组，无 shell）。 */
function buildRemoteSweepArgs(host, remotePort) {
  return [
    'ssh',
    '-o', 'ConnectTimeout=10',
    '-o', 'BatchMode=yes',
    host,
    'pid=$(ss -tlnp "sport = :' + remotePort + '" 2>/dev/null | grep -oP "pid=\\K[0-9]+" | head -1); if [ -n "$pid" ]; then kill "$pid"; fi; sleep 1; true',
  ];
}

/**
 * 远端清场（BLOCK-145 D1 异步化）：spawn ssh 执行远端单条清理命令。
 * ConnectTimeout=10 限连接、REMOTE_SWEEP_TIMEOUT_MS 硬超时（SIGTERM，与旧同步
 * 实现的 timeout 语义一致），结果尽力而为。返回 { done, cancel }：
 * cancel 供 stop()/apply() 撤销在途清场（撤销只影响本次尽力而为清场，不改语义）。
 */
function startRemoteSweep(host, remotePort) {
  const args = buildRemoteSweepArgs(host, remotePort);
  let child = null;
  const done = new Promise((resolve) => {
    try {
      child = cpSpawn(args[0], args.slice(1), { stdio: 'ignore' });
      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* 已退即目标达成 */ }
        resolve();
      }, REMOTE_SWEEP_TIMEOUT_MS);
      child.on('error', () => { clearTimeout(timer); resolve(); });
      child.on('close', () => { clearTimeout(timer); resolve(); });
    } catch {
      resolve();
    }
  });
  return {
    done,
    cancel() { try { if (child) child.kill(); } catch { /* 已退 */ } },
  };
}

/**
 * 跨代清场：历史服务进程被树杀逃逸后遗留的孤儿 ssh 会一直占用远端端口，
 * 新隧道永远 bind 失败互抖——spawn 前按「-R 签名」把所有孤儿清光。
 * 只按精确签名匹配（remote:local 端口对），绝不误伤别的 ssh 用途。
 * （BLOCK-145 D1：进程清单改异步获取；来源命令/签名/信号与旧实现一致。）
 */
async function killStaleTunnelProcesses(dataDir, config, excludePids = []) {
  const signature = `127.0.0.1:${config.remotePort}:127.0.0.1:${config.localPort}`;
  try {
    let entries = [];
    if (process.platform === 'win32') {
      // 随包 .ps1：免 EncodedCommand/引号转义（BLOCK-76 教训：内联 PS 必炸）
      const psPath = path.join(__dirname, 'list-ssh-pids.ps1');
      const out = await execFileP('powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psPath, signature],
        { encoding: 'utf8', timeout: LIST_SSH_PIDS_WIN_TIMEOUT_MS });
      entries = String(out.stdout).split(/\r?\n/).filter(Boolean).map((line) => ({
        pid: Number(line.trim()),
        commandline: signature,
      }));
    } else {
      const out = await execFileP('ps', ['-eo', 'pid=,args='], { encoding: 'utf8', timeout: LIST_SSH_PIDS_POSIX_TIMEOUT_MS });
      entries = String(out.stdout).split(/\r?\n/).filter(Boolean).map((line) => {
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
 * spawnProcess / killStale / remoteSweep 可注入（测试用假进程/假清场）。
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
  remoteSweep = null, // (host, remotePort) => Promise；注入点（测试）。null → startRemoteSweep 默认实现
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
  // BLOCK-145 D1：在途远端清场句柄（stop 可撤销）与冷启动链代际号（旧链自弃）。
  let inFlightSweep = null;
  let bootEpoch = 0;

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

  // 远端清场（保留原函数名，供源码守卫锚定冷启动链）：host 为空即跳过（与旧实现
  // 一致）；默认走 startRemoteSweep（可撤销），注入件走简单 await。
  async function remotePortSweep() {
    if (!config.host) return;
    if (remoteSweep) {
      await remoteSweep(config.host, config.remotePort);
      return;
    }
    const sweep = startRemoteSweep(config.host, config.remotePort);
    inFlightSweep = sweep;
    try {
      await sweep.done;
    } finally {
      if (inFlightSweep === sweep) inFlightSweep = null;
    }
  }

  // BLOCK-145 D1：冷启动链异步化。清场顺序与旧同步实现一致：
  // killStale(孤儿) → killAllTracked(在册孩子) → remotePortSweep(远端端口) → spawn，
  // 清场完成前绝不 spawn 正式 ssh（端口抢跑竞态被顺序排除，与旧行为相同）。
  // 唯一变化：等待不再阻塞 event loop。bootEpoch 使 stop()/apply() 期间在途的旧链
  // 自弃（旧同步实现不可中断，此守卫只收敛异步化引入的新交错，不改稳态语义）；
  // 清场链自身异常如实记入 lastError，不终止隧道生命周期。
  function spawnTunnel() {
    const args = buildSshArgs(config);
    const epoch = ++bootEpoch;
    const excludePids = [...liveChildren].map((proc) => proc.pid);
    setState('connecting');
    void Promise.resolve()
      .then(() => killStale(dataDir, config, excludePids))
      .then(() => {
        if (epoch !== bootEpoch) return;
        killAllTracked();
      })
      .then(() => remotePortSweep())
      .then(() => {
        if (epoch !== bootEpoch || stopped || !config.enabled) return;
        const proc = spawnProcess(args);
        child = proc;
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
      })
      .catch((error) => {
        lastError = `tunnel boot chain failed: ${String(error && error.message).slice(0, 180)}`;
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

    /** 应用新配置：写盘 + 原子切换（先停旧进程再按新配置拉起；spawn 走异步清场链）。 */
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

    /** boot 恢复：按已持久化配置拉起（不重写盘；立即返回，清场链在后台完成）。 */
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
      bootEpoch += 1; // 在途冷启动链自弃
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (inFlightSweep) { inFlightSweep.cancel(); inFlightSweep = null; }
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
