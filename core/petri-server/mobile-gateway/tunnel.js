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
// BLOCK-159 P0-2 — 退避抖动：±30%（rng 注入，测试确定性）。多设备/多窗口
// 同时断线时避免同步重连踩同一清场窗口。
const BACKOFF_JITTER_RATIO = 0.3;
const STABLE_CONNECTED_MS = 10 * 1000;
// BLOCK-159 P0-2 — 探活连败自愈阈值：连续 N 次 fail 才强杀重连（单次抖动
// ——公网门 DNS 抖一下——不触发）。阈值 2 = 首轮 fail 后给一轮复测机会。
const PROBE_FAIL_RECONNECT_THRESHOLD = 2;
const HOST_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;
// 清场超时上限（与旧同步实现逐值一致：远端清场 25s、win 进程清单 10s、posix 5s）
const REMOTE_SWEEP_TIMEOUT_MS = 25_000;
const LIST_SSH_PIDS_WIN_TIMEOUT_MS = 10_000;
const LIST_SSH_PIDS_POSIX_TIMEOUT_MS = 5_000;
// BLOCK-152 T — publicUrl 周期自探活（BLOCK-149 #468 留的方向）：connected 后每
// PROBE_INTERVAL_MS 经公网门 GET 一次 /api/mobile/status，期待 401（网关会话门活，
// mobile-gateway D4 门）= 端到端通。频率保守（60s 起步，plan §6）；自签 CA 走既有
// NODE_EXTRA_CA_CERTS 链路（后端进程已设），不新增证书处理。
const PROBE_INTERVAL_MS = 60 * 1000;
const PROBE_TIMEOUT_MS = 5 * 1000;

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
    // BLOCK-159 P0-2 — 判死窗口 45s→30s（15s×3→10s×3）：半开隧道期间手机端
    // 全部请求在黑洞里超时，「易断」观感的主源之一；CountMax=3 保持。
    '-o', 'ServerAliveInterval=10',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ConnectTimeout=10',
    '-R', `127.0.0.1:${config.remotePort}:127.0.0.1:${config.localPort}`,
    config.host,
  ];
}

/** BLOCK-159 P0-2 — 退避延迟 ±30% 抖动（rng 注入；下限 1ms 防归零，注入测试的小档退避语义不变）。 */
function jitteredDelay(ms, rng = Math.random) {
  const jitter = 1 + (rng() * 2 - 1) * BACKOFF_JITTER_RATIO;
  return Math.max(1, Math.round(ms * jitter));
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
  probeIntervalMs = PROBE_INTERVAL_MS,
  probeTimeoutMs = PROBE_TIMEOUT_MS,
  probeFetch = null, // (url, init) => Promise<Response>；null → globalThis.fetch 迟绑定（注入点，测试用）
  rng = Math.random, // BLOCK-159 P0-2 — 退避抖动随机源（注入点，测试确定性）
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
  // BLOCK-152 T：探活证据与调度（单计时器串行链，绝不叠加）。
  let probeState = 'unknown';
  let probedAt = null;
  let probeTimer = null;
  let probeInFlight = false;
  // BLOCK-159 P0-2 — 探活连败计数（阈值触发自愈重连）。
  let probeFailStreak = 0;

  function killAllTracked() {
    for (const proc of liveChildren) {
      try { proc.kill(); } catch { /* 已死 */ }
    }
    liveChildren.clear();
  }

  function setState(next) {
    state = next;
    stateSinceTs = now();
    // BLOCK-152 T：状态转移即作废旧探活证据——证据只属于上一条转发，断连后
    // 绝不带进新连接（诚实边界；下一轮 probe 重新取证）。
    probeState = 'unknown';
    probedAt = null;
    probeFailStreak = 0; // BLOCK-159 P0-2：连败计数同样只属于上一条转发
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

  // BLOCK-145 D1：冷启动链异步化。清场顺序不变量保持「清场完成前绝不 spawn」；
  // BLOCK-159 P0-5 — killStale（本机孤儿）与 remotePortSweep（远端端口）互不
  // 依赖（不同机器），改并行：断线重连固有开销从两者之和降为两者之最大
  // （最坏 15-35s → 最坏 25s），「易断」恢复窗口直接收窄。killAllTracked 在
  // spawn 前单独执行（须在 killStale 的 excludePids 采样之后）。
  function spawnTunnel() {
    const args = buildSshArgs(config);
    const epoch = ++bootEpoch;
    const excludePids = [...liveChildren].map((proc) => proc.pid);
    setState('connecting');
    void Promise.resolve()
      .then(() => Promise.all([
        killStale(dataDir, config, excludePids),
        remotePortSweep(),
      ]))
      .then(() => {
        if (epoch !== bootEpoch) return;
        killAllTracked();
      })
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
          // BLOCK-159 P0-5 — 已有在途重连排程（探活自愈路径已接管）：不覆盖、
          // 不重复 setState（stateSinceTs 抖动会让徽标「公网可用」计时反复清零）。
          if (reconnectTimer) return;
          lastError = `ssh exited (code=${code == null ? 'signal' : code})`;
          setState('reconnecting');
          const delay = jitteredDelay(backoffSteps[Math.min(backoffIndex, backoffSteps.length - 1)], rng);
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
      scheduleProbe(); // BLOCK-152 T：进入连接态即起探活链（unref 计时器，不进关键路径）
    }
  }

  // ── BLOCK-152 T：publicUrl 周期自探活 ─────────────────────────────────
  // 只读公网门（fetch GET），不 spawn、不 kill、不碰端口——与 killStale /
  // remotePortSweep 异步清场链互不踩（plan §6 T 轨风险项）。单计时器 +
  // 在途守卫 + 完成后再排下一轮：调度绝不叠加；计时器 unref 不吊 event loop。
  function probeEligible() {
    return !stopped && config.enabled && state === 'connected' && Boolean(config.publicUrl);
  }

  function scheduleProbe() {
    if (probeTimer) { clearTimeout(probeTimer); probeTimer = null; }
    if (!probeEligible()) return;
    probeTimer = setTimeout(() => {
      probeTimer = null;
      void runProbe();
    }, probeIntervalMs);
    if (probeTimer.unref) probeTimer.unref();
  }

  // BLOCK-159 P0-2 — 探活连败自愈：连续 PROBE_FAIL_RECONNECT_THRESHOLD 次
  // fail（端到端不通而 ssh 进程可能还活着=假活）→ 强杀 tracked 孩子并走既有
  // 退避重连。此前 probe fail 只记证据不自愈（BLOCK-152 T 交付的诚实边界），
  // 半开隧道要挂到 ServerAlive 判死为止——自愈速度是「易断」的主根因之一。
  function forceReconnect(reason) {
    if (stopped || !config.enabled) return;
    if (reconnectTimer) return; // 已有重连在途（exit 路径或上一轮自愈）
    lastError = reason;
    setState('reconnecting');
    killAllTracked();
    child = null;
    const delay = jitteredDelay(backoffSteps[Math.min(backoffIndex, backoffSteps.length - 1)], rng);
    backoffIndex += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!stopped && config.enabled && liveChildren.size === 0) spawnTunnel();
    }, delay);
    if (reconnectTimer.unref) reconnectTimer.unref();
  }

  function recordProbeOutcome(ok) {
    probeState = ok ? 'ok' : 'fail';
    probedAt = now();
    if (ok) {
      probeFailStreak = 0;
      return;
    }
    probeFailStreak += 1;
    if (probeFailStreak >= PROBE_FAIL_RECONNECT_THRESHOLD) {
      forceReconnect(`probe failed ${probeFailStreak}x consecutively (publicUrl unreachable)`);
    }
  }

  async function runProbe() {
    if (probeInFlight || !probeEligible()) return;
    probeInFlight = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), probeTimeoutMs);
    if (timeout.unref) timeout.unref();
    try {
      const doFetch = probeFetch || ((url, init) => globalThis.fetch(url, init));
      const response = await doFetch(`${config.publicUrl.replace(/\/+$/, '')}/api/mobile/status`, {
        method: 'GET',
        redirect: 'manual', // 反代误配跳走时按 3xx 判 fail，绝不跟到别的源上取证
        signal: controller.signal,
      });
      // 消费 body 还连接（keep-alive 可复用），不阻塞判定；401 body 只有几字节。
      void Promise.resolve(response.arrayBuffer?.()).catch(() => {});
      if (probeEligible()) { // 在途期间断连：陈旧结论不回写（先经 setState 复位）
        recordProbeOutcome(response.status === 401);
      }
    } catch {
      if (probeEligible()) { // 超时 / 网络错 / DNS 失败 = 未确认
        recordProbeOutcome(false);
      }
    } finally {
      clearTimeout(timeout);
      probeInFlight = false;
      scheduleProbe(); // 完成后再排下一轮（串行链，天然不叠加）
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
        // BLOCK-152 T — publicUrl 自探活证据：ok=401 端到端通；fail=未确认；unknown=尚无结论
        probeState,
        probedAt,
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
      if (probeTimer) { clearTimeout(probeTimer); probeTimer = null; } // BLOCK-152 T：撤销探活调度
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
  BACKOFF_JITTER_RATIO,
  PROBE_FAIL_RECONNECT_THRESHOLD,
  STABLE_CONNECTED_MS,
  PROBE_INTERVAL_MS,
  PROBE_TIMEOUT_MS,
  HOST_PATTERN,
  tunnelConfigPath,
  normalizeTunnelConfig,
  readTunnelConfig,
  writeTunnelConfig,
  buildSshArgs,
  jitteredDelay,
  selectStaleSshPids,
  killStaleTunnelProcesses,
  getTunnelManager,
  resetTunnelManagersForTest,
  createTunnelManager,
};
