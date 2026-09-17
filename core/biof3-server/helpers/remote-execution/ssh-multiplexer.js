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
 * - BatchMode + ServerAliveInterval 保活（15s 心跳）；会话死亡 → 丢弃，下次操作懒重建；
 * - UI-397（用户反馈「闲置回来总要重连」）：移除空闲 5 分钟主动关闭——保活维持长连接，
 *   不主动断连；app 退出时 stdin EOF 使远端循环自然结束；
 * - BIOF3_SSH_MUX=0 可整体禁用（回退 thin per-call）。
 */

const { spawn } = require('child_process');
const { AGENT_BIN } = require('./node-agent');

const DEFAULT_RUN_TIMEOUT_MS = 30000;

// BIOF3_SSH_MUX_DEBUG=1 时逐事件打 stderr（写/收/解析/超时/断开），P4 实机排插桩。
const MUX_DEBUG = process.env.BIOF3_SSH_MUX_DEBUG === '1';
const dbg = (session, msg) => {
  if (MUX_DEBUG) process.stderr.write(`[mux-dbg ${new Date().toISOString()} ${session.alias}#${session.id}] ${msg}\n`);
};

const sessions = new Map(); // sessionKey → session
let sessionSeq = 0;

function muxEnabled() {
  return process.env.BIOF3_SSH_MUX !== '0';
}

// BLOCK-96 F1 — 会话按 别名+地址族 键控：同一别名不同 AddressFamily 注入
// 各自独立会话，互不串扰。
function sessionKey({ alias, addressFamily }) {
  return `${addressFamily || 'auto'}|${alias}`;
}

function createMuxSession({ alias, addressFamily, spawnFn }) {
  const doSpawn = spawnFn || ((args) => {
    const sshBin = process.platform === 'win32' ? 'ssh.exe' : 'ssh';
    return spawn(sshBin, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  });
  const child = doSpawn([
    ...(addressFamily === 'inet' || addressFamily === 'inet6'
      ? ['-o', `AddressFamily=${addressFamily}`]
      : []),
    '-o', 'BatchMode=yes',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=4',
    '-o', 'ConnectTimeout=10',
    '--', alias,
    `bash "${AGENT_BIN}" __mux`,
  ]);

  const session = {
    alias,
    key: sessionKey({ alias, addressFamily }),
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
        resolve: ({ code, stdout, stderr }) => { dbg(session, `resolve code=${code} stdout=${String(stdout).length}B`); session.pending = null; resolve({ ok: true, code, stdout: String(stdout), stderr: String(stderr || '') }); },
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
        // BLOCK-96 F3 — envelope R\t<code>\t<b64 stdout>\t<b64 stderr>；
        // 旧 3 字段形态（无 stderr）兼容解析。
        let stdoutB64;
        let stderrB64 = '';
        if (parts.length >= 4) {
          stdoutB64 = parts[2];
          stderrB64 = parts[3];
        } else {
          stdoutB64 = parts.slice(2).join('\t');
        }
        if (session.pending.timer) clearTimeout(session.pending.timer);
        const stdout = Buffer.from(stdoutB64 || '', 'base64').toString('utf8');
        const stderr = stderrB64 ? Buffer.from(stderrB64, 'base64').toString('utf8') : '';
        session.pending.resolve({ code, stdout, stderr });
      } else {
        dbg(session, `line discarded pending=${!!session.pending} startsR=${line.startsWith('R\t')} len=${line.length}`);
      }
    }
  });

  const die = () => {
    dbg(session, `died alive=${session.alive}`);
    session.alive = false;
    if (sessions.get(session.key) === session) sessions.delete(session.key);
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

  sessions.set(session.key, session);
  return session;
}

function muxError(message) {
  return Object.assign(new Error(`ssh_mux: ${message}`), {
    classified: { kind: 'transport.network', retryable: true },
  });
}

function killSession(session) {
  session.alive = false;
  if (sessions.get(session.key) === session) sessions.delete(session.key);
  try { session.child.kill(); } catch {}
}

/** 取（或建）alias 的会话。 */
function getMuxSession({ alias, addressFamily, spawnFn }) {
  const key = sessionKey({ alias, addressFamily });
  const existing = sessions.get(key);
  if (existing && existing.alive) return existing;
  return createMuxSession({ alias, addressFamily, spawnFn });
}

/**
 * 在复用连接上执行一条 agent 命令。
 * 返回 { ok, code, stdout, stderr }；失败抛 { classified } 形状错误（与 runSshOp 对齐）。
 * stderr 为 BLOCK-96 F3 envelope 第 4 字段（die 原因回传；旧 agent 无此字段时为空）。
 */
async function runOnMux({ alias, command, timeoutMs = DEFAULT_RUN_TIMEOUT_MS, spawnFn, addressFamily }) {
  const session = getMuxSession({ alias, addressFamily, spawnFn });
  const r = await session.run(command, timeoutMs);
  if (r.code !== 0) {
    // 远端 agent die（exit 64 等）——非 transport 错误，语义交由调用方解析 stdout/stderr
    return { ok: true, code: r.code, stdout: r.stdout, stderr: r.stderr };
  }
  return { ok: true, code: 0, stdout: r.stdout, stderr: r.stderr };
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
};
