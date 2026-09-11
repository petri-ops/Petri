/**
 * BLOCK-67 加映（D1.1 性能优化）— SSH 单连接多路复用（Windows ControlMaster 替代）。
 *
 * Windows OpenSSH 不支持 ControlMaster，且 spawn ssh.exe 每次都要完整握手 +
 * 进程创建（实测每操作 ~1.1s）。本模块对每个 alias 维持**一条**长连接：
 *   ssh <alias> 'bash "$AGENT_BIN" __mux'
 * __mux 循环从 stdin 逐行读取 base64(完整 agent 命令)，执行后回送
 *   R \t <exit> \t <base64 stdout>
 * 每操作成本从 ~1.1s 降到 ~1 RTT。
 *
 * 语义与安全性：
 * - 命令仍由 remoteAgentCommand 构造（argv 白名单 + 引号），mux 仅做转发；
 * - BatchMode + ServerAliveInterval 保活；会话死亡 → 丢弃，下次操作懒重建；
 * - 空闲 5 分钟自动关闭；app 退出时 stdin EOF 使远端循环自然结束；
 * - BIOF3_SSH_MUX=0 可整体禁用（回退 thin per-call）。
 */

const { spawn } = require('child_process');
const { AGENT_BIN } = require('./node-agent');

const IDLE_CLOSE_MS = 5 * 60 * 1000;
const DEFAULT_RUN_TIMEOUT_MS = 30000;

// BIOF3_SSH_MUX_DEBUG=1 时逐事件打 stderr（写/收/解析/超时/断开），P4 实机排插桩。
const MUX_DEBUG = process.env.BIOF3_SSH_MUX_DEBUG === '1';
const dbg = (session, msg) => {
  if (MUX_DEBUG) process.stderr.write(`[mux-dbg ${new Date().toISOString()} ${session.alias}#${session.id}] ${msg}\n`);
};

const sessions = new Map(); // alias → session
let sessionSeq = 0;

function muxEnabled() {
  return process.env.BIOF3_SSH_MUX !== '0';
}

function createMuxSession({ alias, spawnFn }) {
  const doSpawn = spawnFn || ((args) => {
    const sshBin = process.platform === 'win32' ? 'ssh.exe' : 'ssh';
    return spawn(sshBin, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  });
  const child = doSpawn([
    '-o', 'BatchMode=yes',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=4',
    '-o', 'ConnectTimeout=10',
    '--', alias,
    `bash "${AGENT_BIN}" __mux`,
  ]);

  const session = {
    alias,
    id: ++sessionSeq,
    child,
    alive: true,
    lastActivity: Date.now(),
    buffer: '',
    inflight: Promise.resolve(),
    pending: null, // { resolve, timer }
  };
  dbg(session, `spawned pid=${child.pid}`);
  child.on('error', (e) => dbg(session, `child error: ${e.message}`));

  session.run = (command, timeoutMs = DEFAULT_RUN_TIMEOUT_MS) => {
    session.lastActivity = Date.now();
    const exec = () => new Promise((resolve, reject) => {
      if (!session.alive) {
        dbg(session, `run rejected (dead) cmd=${String(command).slice(0, 60)}...`);
        reject(muxError('会话已断开，正在重建连接'));
        return;
      }
      dbg(session, `write ${Buffer.byteLength(command)}B cmd=${String(command).slice(0, 80)}`);
      session.pending = {
        resolve: ({ code, stdout }) => { dbg(session, `resolve code=${code} stdout=${String(stdout).length}B`); session.pending = null; resolve({ ok: true, code, stdout: String(stdout) }); },
        reject: (err) => { dbg(session, `reject: ${err.message}`); session.pending = null; reject(err); },
        timer: setTimeout(() => {
          dbg(session, `TIMEOUT ${timeoutMs}ms pendingDiscarded`);
          session.pending = null;
          killSession(session);
          reject(muxError('连接超时（会话已重建，可重试）'));
        }, timeoutMs),
      };
      const line = Buffer.from(command, 'utf8').toString('base64');
      session.child.stdin.write(`${line}\n`, () => dbg(session, 'write flushed to ssh stdin'));
    });
    // 串行化：同一会话上的请求按序执行（协议无请求 id）
    const run = session.inflight.then(exec, exec);
    session.inflight = run.catch(() => {});
    return run;
  };

  session.close = () => killSession(session);

  child.stdout.on('data', (chunk) => {
    dbg(session, `stdout +${chunk.length}B head=${JSON.stringify(chunk.toString('utf8').slice(0, 60))}`);
    session.buffer += chunk.toString('utf8');
    let idx;
    while ((idx = session.buffer.indexOf('\n')) >= 0) {
      const line = session.buffer.slice(0, idx);
      session.buffer = session.buffer.slice(idx + 1);
      if (session.pending && line.startsWith('R\t')) {
        const parts = line.split('\t');
        const code = Number(parts[1]);
        const b64 = parts.slice(2).join('\t');
        if (session.pending.timer) clearTimeout(session.pending.timer);
        const stdout = Buffer.from(b64 || '', 'base64').toString('utf8');
        session.pending.resolve({ code, stdout });
      } else {
        dbg(session, `line discarded pending=${!!session.pending} startsR=${line.startsWith('R\t')} len=${line.length}`);
      }
    }
  });

  const die = () => {
    dbg(session, `died alive=${session.alive}`);
    session.alive = false;
    if (sessions.get(alias) === session) sessions.delete(alias);
    if (session.pending) {
      if (session.pending.timer) clearTimeout(session.pending.timer);
      const p = session.pending;
      session.pending = null;
      p.reject(muxError('连接已断开（可重试）'));
    }
  };
  child.on('close', (code, signal) => { dbg(session, `close code=${code} signal=${signal}`); die(); });
  child.on('exit', (code) => { dbg(session, `exit code=${code}`); die(); });
  child.stderr.on('data', (c) => { dbg(session, `stderr: ${String(c).trim().slice(0, 200)}`); });

  scheduleIdleClose(session);
  sessions.set(alias, session);
  return session;
}

function muxError(message) {
  return Object.assign(new Error(`ssh_mux: ${message}`), {
    classified: { kind: 'transport.network', retryable: true },
  });
}

function killSession(session) {
  session.alive = false;
  if (sessions.get(session.alias) === session) sessions.delete(session.alias);
  try { session.child.kill(); } catch {}
}

function scheduleIdleClose(session) {
  const t = setInterval(() => {
    if (!session.alive) { clearInterval(t); return; }
    if (Date.now() - session.lastActivity > IDLE_CLOSE_MS) {
      clearInterval(t);
      killSession(session);
    }
  }, 60 * 1000);
  if (typeof t.unref === 'function') t.unref();
}

/** 取（或建）alias 的会话。 */
function getMuxSession({ alias, spawnFn, openTimeoutMs = 20000 }) {
  const existing = sessions.get(alias);
  if (existing && existing.alive) return existing;
  return createMuxSession({ alias, spawnFn, openTimeoutMs });
}

/**
 * 在复用连接上执行一条 agent 命令。
 * 返回 { ok: true, code, stdout }；失败抛 { classified } 形状错误（与 runSshOp 对齐）。
 */
async function runOnMux({ alias, command, timeoutMs = DEFAULT_RUN_TIMEOUT_MS, spawnFn }) {
  const session = getMuxSession({ alias, spawnFn });
  const r = await session.run(command, timeoutMs);
  if (r.code !== 0) {
    // 远端 agent die（exit 64 等）——非 transport 错误，语义交由调用方解析 stdout
    return { ok: true, code: r.code, stdout: r.stdout };
  }
  return { ok: true, code: 0, stdout: r.stdout };
}

function closeAll() {
  for (const session of sessions.values()) killSession(session);
  sessions.clear();
}

process.on('exit', closeAll);

module.exports = {
  muxEnabled,
  getMuxSession,
  createMuxSession,
  runOnMux,
  closeAll,
  IDLE_CLOSE_MS,
};
