/**
 * BLOCK-67 P1 — Workspace Gateway（设计评审 §4 唯一新抽象）
 *
 * 一个文件面接口（list/read/write/stat/mkdir/mv/rm）× 两个后端：
 *   local → 本地 fs（现路径语义平移，零回归红线：不开 ssh 项目时代码路径与现状同语义）
 *   ssh   → BLOCK-57 通道（runSshOp + node-agent fs verbs + ensureAgent 部署）
 *
 * 路径边界：所有相对路径在两后端统一走 safeRemoteJoin（.. / 绝对 / 空段拒绝），
 * 远程真值唯一（D3）；写操作 write-through，无本地暂存（D5）。
 * 树缓存（read-through）是调用方的投影层，本模块不缓存（单一真相红线）。
 */

const sshTransport = require('./remote-execution/ssh-transport');
const { remoteAgentCommand, AGENT_BIN, AGENT_ROOT } = require('./remote-execution/node-agent');

const b64 = (s) => Buffer.from(String(s), 'utf-8').toString('base64');

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
function createSshBackend({ alias }) {
  const ensured = new Set();
  async function ensureAgent() {
    if (ensured.has(alias)) return;
    const { createRemoteJobRunner } = require('./remote-execution/remote-job-runner');
    const runner = createRemoteJobRunner();
    const deployed = await runner.ensureAgent({ alias });
    if (!deployed.ok) {
      const error = new Error(`ssh_agent_deploy_failed: ${deployed.error?.kind || 'unknown'}`);
      error.classified = deployed.error;
      throw error;
    }
    ensured.add(alias);
  }

  async function fsOp(verbArgs, { timeoutMs = 30000, maxArgLen = 256 } = {}) {
    await ensureAgent();
    const op = await sshTransport.runSshOp({
      alias,
      remoteCommand: remoteAgentCommand(verbArgs, { maxArgLen }),
      timeoutMs,
    });
    if (op.classified.kind !== 'ok') {
      const error = new Error(`ssh_transport: ${op.classified.kind}`);
      error.classified = op.classified;
      throw error;
    }
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
      const lines = parseJsonLines(await fsOp(['fs_list', b64(dirPath)]));
      if (lines.length === 1 && lines[0].error) {
        const e = new Error(lines[0].error); e.remoteError = lines[0].error; throw e;
      }
      // 与本地树同构排序：目录在前、名称 localeCompare。
      return lines
        .filter((entry) => typeof entry.name === 'string')
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
    },
    async stat(filePath) {
      const [info] = parseJsonLines(await fsOp(['fs_stat', b64(filePath)]));
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
      return { pid: Number.isInteger(info?.pid) ? info.pid : null, error: info?.error };
    },
    async processAlive(pid) {
      const [info] = parseJsonLines(await fsOp(['ps_pid', String(pid)], { timeoutMs: 20000 }));
      return { alive: info?.alive === true };
    },
    async killPid(pid, signal = 'TERM') {
      const [info] = parseJsonLines(await fsOp(['kill_pid', String(pid), String(signal)], { timeoutMs: 20000 }));
      return { signaled: info?.signaled === true };
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
    return { backend: createSshBackend({ alias: project.ssh_host }), root: project.remote_path };
  }
  if (!project.workspace_path) return { error: 'workspace_missing' };
  return { backend: createLocalBackend(), root: project.workspace_path };
}

module.exports = {
  safeRemoteJoin,
  createSshBackend,
  createLocalBackend,
  resolveWorkspaceBackend,
  AGENT_BIN,
  AGENT_ROOT,
};
