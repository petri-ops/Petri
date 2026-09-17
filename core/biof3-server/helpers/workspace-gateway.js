/**
 * BLOCK-67 P1 — Workspace Gateway（设计评审 §4 唯一新抽象）
 *
 * 一个文件面接口（list/read/write/stat/mkdir/mv/cp/rm）× 两个后端：
 *   local → 本地 fs（现路径语义平移，零回归红线：不开 ssh 项目时代码路径与现状同语义）
 *   ssh   → BLOCK-57 通道（runSshOp + node-agent fs verbs + ensureAgent 部署）
 *
 * 路径边界：所有相对路径在两后端统一走 safeRemoteJoin（.. / 绝对 / 空段拒绝），
 * 远程真值唯一（D3）；写操作 write-through，无本地暂存（D5）。
 * 树缓存（read-through）是调用方的投影层，本模块不缓存（单一真相红线）。
 */

const sshTransport = require('./remote-execution/ssh-transport');
const sshMux = require('./remote-execution/ssh-multiplexer');
const { remoteAgentCommand, AGENT_BIN, AGENT_ROOT } = require('./remote-execution/node-agent');

const b64 = (s) => Buffer.from(String(s), 'utf-8').toString('base64');

/** BLOCK-96 F2 — fs_list 载荷解析：agent 输出单行 base64(NUL 记录流)，记录 =
 *  `<type>\t<size>\t<mtime_s>\t<name>\0`。NUL 是文件名唯一不可能出现的字节，
 *  因此名称零转义、对引号/反斜杠/换行/非 UTF-8 字节二进制安全；旧 printf JSON
 *  「坏行静默丢文件」缺陷由此绝迹。base64 先行是因 __mux 经 bash $() 转发会剥
 *  NUL（agent 侧管道编码，不经 $()）。错误哨兵（{"error":...}，如 not_found）
 *  明文先行短路；排序契约=目录优先 + localeCompare（与 local 后端同构）。 */
function parseListEntries(text) {
  const raw = String(text || '');
  const trimmed = raw.trim();
  if (trimmed.startsWith('{"error"')) {
    let code = 'remote_error';
    try { code = JSON.parse(trimmed).error || code; } catch { /* 保持兜底码 */ }
    const e = new Error(code); e.remoteError = code; throw e;
  }
  const decoded = Buffer.from(trimmed.replace(/\s+/g, ''), 'base64').toString('utf8');
  return decoded.split('\0')
    .filter(Boolean)
    .map((record) => {
      const t1 = record.indexOf('\t');
      const t2 = t1 >= 0 ? record.indexOf('\t', t1 + 1) : -1;
      const t3 = t2 >= 0 ? record.indexOf('\t', t2 + 1) : -1;
      if (t3 < 0) return null;
      const type = record.slice(0, t1) === 'd' ? 'dir' : 'file';
      const size = Number(record.slice(t1 + 1, t2));
      const mtimeMs = Math.round(Number(record.slice(t2 + 1, t3)) * 1000);
      const name = record.slice(t3 + 1);
      if (!name || !Number.isFinite(size) || !Number.isFinite(mtimeMs)) return null;
      return type === 'dir'
        ? { name, type, mtimeMs, modifiedAt: mtimeMs }
        : { name, type, size, mtimeMs, modifiedAt: mtimeMs };
    })
    .filter((entry) => entry !== null)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/** BLOCK-96 F2 — 服务端分页切片：不传 limit = 全量（行为兼容）；limit>0 时
 *  返回 { entries, total, truncated }，truncated 显式标记而非静默截断。 */
function paginateEntries(entries, { limit = 0, offset = 0 } = {}) {
  const total = entries.length;
  const start = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
  const size = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  const sliced = size > 0 ? entries.slice(start, start + size) : entries.slice(start);
  return { entries: sliced, total, truncated: size > 0 && start + sliced.length < total };
}

/**
 * POSIX 风格相对路径拼接与边界校验（两后端共用；.. / 绝对路径 / 反斜杠拒绝）。
 * 返回以 '/' 连接的相对路径，或 null（非法）。
 */
function safeRemoteJoin(root, relativePath) {
  const rel = String(relativePath || '').replace(/\\/g, '/');
  if (rel.includes('\0')) return null;
  const segments = rel.split('/').filter((seg) => seg !== '' && seg !== '.');
  if (segments.some((seg) => seg === '..')) return null;
  const rootSegs = String(root || '').replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean);
  if (rootSegs.length === 0) return null;
  const prefix = String(root || '').replace(/\\/g, '/').startsWith('/') ? '/' : '';
  const rootPath = `${prefix}${rootSegs.join('/')}`;
  return segments.length === 0 ? rootPath : `${rootPath}/${segments.join('/')}`;
}

/** ssh 后端：一次性 ssh + fs verb；语义错误（not_found 等）以 payload error 呈现。 */
// D1.1 — agent 部署校验缓存提升到模块级（按 别名+agent版本 键控）：
// createSshBackend 每请求新建实例，实例级缓存会让每个请求都重跑一次
// ensureAgent 哈希校验（独立 SSH 连接 ~1s）——实测树延迟不降的真凶。
const ensuredAgents = new Set(); // `${alias}:${agentHash}`
// BLOCK-96 F1 — 幂等只读 verb 集合：mux 会话死亡/超时后可透明重建重试一次；
// 写类 verb 不自动重试（诚实失败优先，防重复写副作用）。
const IDEMPOTENT_READ_VERBS = new Set(['fs_stat', 'fs_list', 'fs_read', 'sys_resource']);
function createSshBackend({ alias, addressFamily } = {}) {
  // P0 裁决（2026-09-16）— 传输层参数化：仅接受显式枚举值，其余视为自动
  // （不注入，交由 ~/.ssh/config 与系统默认地址族序决定）。
  const af = addressFamily === 'inet' || addressFamily === 'inet6' ? addressFamily : undefined;

  async function ensureAgent() {
    const { agentVersionHash } = require('./remote-execution/node-agent');
    const key = `${alias}:${agentVersionHash()}`;
    if (ensuredAgents.has(key)) return;
    const { createRemoteJobRunner } = require('./remote-execution/remote-job-runner');
    const runner = createRemoteJobRunner();
    const deployed = await runner.ensureAgent({ alias });
    if (!deployed.ok) {
      const error = new Error(`ssh_agent_deploy_failed: ${deployed.error?.kind || 'unknown'}`);
      error.classified = deployed.error;
      throw error;
    }
    ensuredAgents.add(key);
  }

  // BLOCK-96 F3 — agent die（exit 64）经 stderr 回传显式错误码：
  // "agent_error: <code>" → e.remoteError，替代空 stdout + 硬编码兜底猜测。
  function dieError(r) {
    const m = /agent_error:\s*([A-Za-z0-9_.-]+)/.exec(String(r.stderr || ''));
    const code = m ? m[1] : 'agent_failed';
    const e = new Error(code);
    e.remoteError = code;
    e.agentExit = r.code;
    return e;
  }

  // BLOCK-96 F5 — verb 级结构化日志（BIOF3_SSH_VERB_LOG=1 开启，默认关）：
  // 每 verb 一行 JSON（channel/verb/ms/exit/bytes）——「感觉不稳定」从此可归因。
  function verbLog(verb, startedAt, code, stdout) {
    if (process.env.BIOF3_SSH_VERB_LOG !== '1') return;
    process.stderr.write(`${JSON.stringify({
      channel: 'ssh-verb',
      verb,
      ms: Date.now() - startedAt,
      exit: code,
      bytes: Buffer.byteLength(String(stdout)),
      ts: new Date().toISOString(),
    })}\n`);
  }

  async function fsOp(verbArgs, { timeoutMs = 30000, maxArgLen = 256 } = {}) {
    await ensureAgent();
    const command = remoteAgentCommand(verbArgs, { maxArgLen });
    const startedAt = Date.now();
    // D1.1 性能优化：默认走单连接多路复用（每操作 ~1 RTT）；BIOF3_SSH_MUX=0 回退 thin per-call
    if (sshMux.muxEnabled()) {
      let r;
      try {
        r = await sshMux.runOnMux({ alias, command, timeoutMs, addressFamily: af });
      } catch (e) {
        // BLOCK-96 F1 — 会话死亡/超时（transport.network）：幂等只读 verb 透明
        // 重建重试一次（runOnMux 内部懒重建会话）；其余原样上抛。
        if (!(e && e.classified && e.classified.kind === 'transport.network') || !IDEMPOTENT_READ_VERBS.has(verbArgs[0])) {
          throw e;
        }
        verbLog(verbArgs[0], startedAt, 'retry', '');
        r = await sshMux.runOnMux({ alias, command, timeoutMs, addressFamily: af });
      }
      verbLog(verbArgs[0], startedAt, r.code, r.stdout);
      if (r.code !== 0) throw dieError(r);
      return r.stdout;
    }
    const op = await sshTransport.runSshOp({
      alias,
      remoteCommand: command,
      timeoutMs,
      addressFamily: af,
    });
    // BLOCK-96 F3 — die（exit 64 → remote.command_failed）转显式 remoteError，
    // 不再误标为传输层失败。
    verbLog(verbArgs[0], startedAt, op.classified.kind === 'ok' ? op.code : op.classified.kind, op.stdout);
    if (op.classified.kind === 'remote.command_failed') throw dieError(op);
    if (op.classified.kind !== 'ok') {
      const error = new Error(`ssh_transport: ${op.classified.kind}`);
      error.classified = op.classified;
      throw error;
    }
    if (op.code !== 0) throw dieError(op);
    return op.stdout;
  }

  function parseJsonLines(text) {
    return String(text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  }

  return {
    kind: 'ssh',
    alias,
    async list(dirPath) {
      return parseListEntries(await fsOp(['fs_list', b64(dirPath)]));
    },
    // BLOCK-96 F2 — 分页列表（{ entries, total, truncated }）；不传 limit = 全量。
    async listPage(dirPath, opts) {
      return paginateEntries(await this.list(dirPath), opts);
    },
    async stat(filePath, opts) {
      // UI-397 — opts.timeoutMs：探活等短超时场景（默认仍 30s）
      const [info] = parseJsonLines(await fsOp(['fs_stat', b64(filePath)], { timeoutMs: (opts && opts.timeoutMs) || undefined }));
      if (!info || info.error) {
        const e = new Error(info?.error || 'not_found'); e.remoteError = info?.error || 'not_found'; throw e;
      }
      return info;
    },
    async read(filePath, { offset = 0, length = 0 } = {}) {
      const out = await fsOp(['fs_read', b64(filePath), String(offset), String(length)], { timeoutMs: 60000 });
      const firstLine = String(out).split('\n', 1)[0].trim();
      if (firstLine.startsWith('{')) {
        const info = JSON.parse(firstLine);
        if (info.error) { const e = new Error(info.error); e.remoteError = info.error; throw e; }
      }
      return Buffer.from(String(out).replace(/\s+/g, ''), 'base64');
    },
    async write(filePath, content, { expectedMtimeMs } = {}) {
      // D3 保存前 mtime 冲突检测：不匹配则拒绝，不静默覆盖。
      if (typeof expectedMtimeMs === 'number') {
        let current = null;
        try { current = (await this.stat(filePath)).mtimeMs; } catch { current = null; }
        if (current !== null && current !== expectedMtimeMs) {
          const e = new Error('remote_file_changed'); e.code = 'remote_file_changed'; throw e;
        }
      }
      const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf-8');
      if (data.length > 1024 * 1024) {
        const e = new Error('fs_write_too_large'); e.code = 'fs_write_too_large'; throw e;
      }
      const [info] = parseJsonLines(await fsOp(['fs_write', b64(filePath), data.toString('base64')], { timeoutMs: 120000, maxArgLen: 2 * 1024 * 1024 }));
      if (!info || info.error) {
        const e = new Error(info?.error || 'fs_write_failed'); e.remoteError = info?.error; throw e;
      }
      return info;
    },
    async mkdir(dirPath) {
      const [info] = parseJsonLines(await fsOp(['fs_mkdir', b64(dirPath)]));
      if (!info || info.error) { const e = new Error(info?.error || 'fs_mkdir_failed'); e.remoteError = info?.error; throw e; }
      return info;
    },
    async mv(srcPath, dstPath) {
      const [info] = parseJsonLines(await fsOp(['fs_mv', b64(srcPath), b64(dstPath)]));
      if (!info || info.error) { const e = new Error(info?.error || 'fs_mv_failed'); e.remoteError = info?.error; throw e; }
      return info;
    },
    // BLOCK-90：分片追加（fs_append）。dataB64 为单分片载荷（≤64KB 二进制，
    // b64 后 <128KB argv 上限，调用方显式放宽 maxArgLen）；offset 由 agent 前置校验。
    async append(filePath, dataB64, offset) {
      const [info] = parseJsonLines(await fsOp(
        ['fs_append', b64(filePath), dataB64, String(offset)],
        { maxArgLen: 100_000 },
      ));
      if (!info || info.error) { const e = new Error(info?.error || 'fs_append_failed'); e.remoteError = info?.error; throw e; }
      return info;
    },
    // BLOCK-89：复制（node-agent fs_cp = cp -R；目标已存在由 agent 显式 already_exists）
    async cp(srcPath, dstPath) {
      const [info] = parseJsonLines(await fsOp(['fs_cp', b64(srcPath), b64(dstPath)]));
      if (!info || info.error) { const e = new Error(info?.error || 'fs_cp_failed'); e.remoteError = info?.error; throw e; }
      return info;
    },
    async rm(targetPath) {
      const [info] = parseJsonLines(await fsOp(['fs_rm', b64(targetPath)]));
      if (!info || info.error) { const e = new Error(info?.error || 'fs_rm_failed'); e.remoteError = info?.error; throw e; }
      return info;
    },
    // ── BLOCK-67 P2：find / grep / exec / 进程面 ──
    async find(dirPath, maxDepth = 6) {
      return fsOp(['fs_find', b64(dirPath), String(maxDepth)], { timeoutMs: 60000 });
    },
    async grep(pattern, targetPath, maxLines = 200) {
      return fsOp(['fs_grep', b64(pattern), b64(targetPath), String(maxLines)], { timeoutMs: 60000 });
    },
    async exec(command, cwd, timeoutS = 120) {
      // 输出单行 JSON {code,stdout,stderr,truncated}（stdout/stderr 为 base64）
      const [info] = parseJsonLines(await fsOp(
        ['exec', b64(command), b64(cwd), String(timeoutS)],
        { timeoutMs: (timeoutS + 30) * 1000, maxArgLen: 256 * 1024 }
      ));
      if (!info || info.error) {
        const e = new Error(info?.error || 'exec_failed'); e.remoteError = info?.error; throw e;
      }
      return {
        code: info.code,
        stdout: Buffer.from(String(info.stdout || ''), 'base64').toString('utf8'),
        stderr: Buffer.from(String(info.stderr || ''), 'base64').toString('utf8'),
        truncated: info.truncated === true,
      };
    },
    async execBackground(command, cwd, logPath) {
      const [info] = parseJsonLines(await fsOp(
        ['exec_bg', b64(command), b64(cwd), b64(logPath)],
        { timeoutMs: 30000, maxArgLen: 256 * 1024 }
      ));
      // BLOCK-96 F4 — additive starttime（/proc stat 第 22 字段，PID 复用身份校验用）
      return {
        pid: Number.isInteger(info?.pid) ? info.pid : null,
        starttime: typeof info?.starttime === 'string' ? info.starttime : undefined,
        error: info?.error,
      };
    },
    async processAlive(pid, expectedStarttime) {
      // BLOCK-96 F4 — 带 expectedStarttime 时 agent 做 /proc starttime 身份校验
      // （PID 复用不再误判存活）；缺省保持 kill -0 语义（存量调用方零变化）。
      const args = ['ps_pid', String(pid)];
      if (expectedStarttime) args.push(String(expectedStarttime));
      const [info] = parseJsonLines(await fsOp(args, { timeoutMs: 20000 }));
      return {
        alive: info?.alive === true,
        reused: info?.reused === true,
        starttime: typeof info?.starttime === 'string' ? info.starttime : undefined,
      };
    },
    async killPid(pid, signal = 'TERM') {
      const [info] = parseJsonLines(await fsOp(['kill_pid', String(pid), String(signal)], { timeoutMs: 20000 }));
      return { signaled: info?.signaled === true };
    },
    // ── BLOCK-78 P2-①：远程资源快照（实时监测轮询面，只读零依赖） ──
    async sysResource(dirPath) {
      const args = dirPath ? ['sys_resource', b64(dirPath)] : ['sys_resource'];
      const [info] = parseJsonLines(await fsOp(args, { timeoutMs: 20000 }));
      if (!info || info.error) {
        const e = new Error(info?.error || 'sys_resource_failed'); e.remoteError = info?.error; throw e;
      }
      return info;
    },
  };
}

/** local 后端：fs.promises 平移（语义与 files.js / file-dialog.js 现状对齐）。 */
function createLocalBackend() {
  const fsp = require('fs').promises;
  const path = require('path');
  return {
    kind: 'local',
    async list(dirPath) {
      const dirents = await fsp.readdir(dirPath, { withFileTypes: true });
      const entries = [];
      for (const entry of dirents) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dirPath, entry.name);
        const stat = await fsp.stat(full);
        entries.push({
          name: entry.name,
          type: entry.isDirectory() ? 'dir' : 'file',
          size: entry.isFile() ? stat.size : undefined,
          modifiedAt: stat.mtimeMs,
        });
      }
      return entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    },
    // BLOCK-96 F2 — 分页列表（与 ssh 后端同契约；不传 limit = 全量）。
    async listPage(dirPath, opts) {
      return paginateEntries(await this.list(dirPath), opts);
    },
    async stat(filePath) {
      const stat = await fsp.stat(filePath);
      return {
        type: stat.isDirectory() ? 'dir' : 'file',
        size: stat.isFile() ? stat.size : 0,
        mtimeMs: stat.mtimeMs,
      };
    },
    async read(filePath, { offset = 0, length = 0 } = {}) {
      const handle = await fsp.open(filePath, 'r');
      try {
        const size = (await handle.stat()).size;
        const len = length > 0 ? Math.min(length, size - offset) : size - offset;
        if (len <= 0) return Buffer.alloc(0);
        const { buffer } = await handle.read(Buffer.alloc(len), 0, len, offset);
        return buffer;
      } finally {
        await handle.close();
      }
    },
    async write(filePath, content, { expectedMtimeMs } = {}) {
      if (typeof expectedMtimeMs === 'number') {
        let current = null;
        try { current = (await fsp.stat(filePath)).mtimeMs; } catch { current = null; }
        if (current !== null && current !== expectedMtimeMs) {
          const e = new Error('remote_file_changed'); e.code = 'remote_file_changed'; throw e;
        }
      }
      await fsp.mkdir(require('path').dirname(filePath), { recursive: true });
      await fsp.writeFile(filePath, content);
      return this.stat(filePath);
    },
    async mkdir(dirPath) {
      await fsp.mkdir(dirPath, { recursive: true });
      return this.stat(dirPath);
    },
    async mv(srcPath, dstPath) {
      await fsp.mkdir(require('path').dirname(dstPath), { recursive: true });
      await fsp.rename(srcPath, dstPath);
      return this.stat(dstPath);
    },
    // BLOCK-89：复制（force:false + errorOnExist → 目标已存在抛 EEXIST，与 ssh fs_cp already_exists 同语义）
    async cp(srcPath, dstPath) {
      await fsp.mkdir(require('path').dirname(dstPath), { recursive: true });
      await fsp.cp(srcPath, dstPath, { recursive: true, force: false, errorOnExist: true });
      return this.stat(dstPath);
    },
    // BLOCK-90：分片追加（与 ssh fs_append 同契约：offset===当前 size 才可追加）。
    async append(filePath, chunkBuffer, offset) {
      let current = 0;
      try { current = (await fsp.stat(filePath)).size; } catch { current = 0; }
      if (current !== offset) {
        const e = new Error('offset_mismatch'); e.remoteError = 'offset_mismatch'; throw e;
      }
      await fsp.mkdir(require('path').dirname(filePath), { recursive: true });
      await fsp.appendFile(filePath, chunkBuffer);
      return this.stat(filePath);
    },
    async rm(targetPath) {
      await fsp.rm(targetPath, { recursive: true, force: true });
      return { removed: true };
    },
  };
}

/**
 * 按项目 workspace 形态取后端 + 根路径。
 * local：现语义（workspace_path 绝对路径，缺目录补建）。
 * ssh：project.ssh_host + project.remote_path；根目录缺失不自动创建（远程真值，诚实失败）。
 */
function resolveWorkspaceBackend(project) {
  if (!project) return { error: 'project_not_found' };
  if (project.workspace_kind === 'ssh') {
    if (!project.ssh_host || !project.remote_path) return { error: 'ssh_project_misconfigured' };
    // BLOCK-96 F1 — 目标可选地址族（projects.ssh_address_family：inet|inet6，
    // 空值=自动）。传输层按目标注入，不全局注入以免破坏 IPv6-only 远端。
    return {
      backend: createSshBackend({ alias: project.ssh_host, addressFamily: project.ssh_address_family }),
      root: project.remote_path,
    };
  }
  if (!project.workspace_path) return { error: 'workspace_missing' };
  return { backend: createLocalBackend(), root: project.workspace_path };
}

module.exports = {
  safeRemoteJoin,
  createSshBackend,
  createLocalBackend,
  resolveWorkspaceBackend,
  parseListEntries,
  paginateEntries,
  AGENT_BIN,
  AGENT_ROOT,
};
