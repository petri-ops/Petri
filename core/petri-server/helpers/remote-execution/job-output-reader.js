'use strict';

/**
 * BLOCK-76 P2 — 作业产物统一读取器（D3：SSH 作业产物读面走 Gateway）。
 *
 * 给定 tool_jobs 行：result_json.workspaceKind==='ssh' 时返回 Gateway 读取器
 * （服务器 results/jobs/<jobId>/output 为真值，R4）；否则返回 null——调用方
 * 继续走既有本地链（历史绝对路径作业只读兼容，零迁移）。
 *
 * 预算纪律：远端读取整文件入内存（base64 over mux），DEFAULT_MAX_READ_BYTES
 * 诚实降级（超限抛 artifact_too_large，与本地 MAX_PREVIEW_BYTES 预算同哲学）。
 */

const { safeRemoteJoin, resolveWorkspaceBackend } = require('../workspace-gateway');
const { withTransportRetry, isRetryableError } = require('./ssh-direct-runner');

const DEFAULT_MAX_READ_BYTES = 16 * 1024 * 1024;

function parseResultJson(job) {
  if (!job || !job.result_json) return null;
  if (typeof job.result_json === 'object') return job.result_json;
  try {
    return JSON.parse(job.result_json);
  } catch {
    return null;
  }
}

/**
 * @param {object} opts
 * @param {object} opts.job  tool_jobs 行（含 result_json / project_id）
 * @param {object} opts.project  projects 行（调用方先取好；含 workspace_kind/ssh_host/remote_path）
 * @param {number} [opts.maxReadBytes]
 * @returns {null | {kind:'ssh', outputPath:string, project, list, readFile, statFile, readLogTail}}
 */
function createJobOutputReader({ job, project, maxReadBytes = DEFAULT_MAX_READ_BYTES }) {
  const meta = parseResultJson(job);
  if (!meta || meta.workspaceKind !== 'ssh' || !meta.outputPath || !job.project_id) return null;
  if (!project || project.workspace_kind !== 'ssh' || !project.ssh_host || !project.remote_path) return null;

  const resolved = resolveWorkspaceBackend(project);
  if (resolved.error || !resolved.backend || resolved.backend.kind !== 'ssh') return null;
  const backend = resolved.backend;
  const outputRoot = safeRemoteJoin(resolved.root, meta.outputPath);
  if (!outputRoot) return null;

  const safeName = (name) => {
    if (typeof name !== 'string' || !name || name.includes('/') || name.includes('\\') || name.includes('..')) {
      return null;
    }
    const p = safeRemoteJoin(outputRoot, name);
    return p;
  };

  return {
    kind: 'ssh',
    outputPath: meta.outputPath,
    project,
    async list() {
      return withTransportRetry(async () => {
        try {
          return (await backend.list(outputRoot))
            .filter((e) => e.type === 'file' && !String(e.name).startsWith('.'))
            .map((e) => ({ name: e.name, size: Number(e.size || 0) }));
        } catch (e) {
          if (isRetryableError(e)) throw e;
          return [];
        }
      });
    },
    async statFile(name) {
      const p = safeName(name);
      if (!p) return null;
      try {
        const s = await backend.stat(p);
        return { size: Number(s.size || 0), mtimeMs: s.mtimeMs ?? null };
      } catch (e) {
        if (process.env.PETRI_B76_DEBUG) console.error('[b76-reader] stat failed:', e.message, 'classified:', JSON.stringify(e.classified || null));
        return null;
      }
    },
    /** 读产物文件；超预算抛 Error(code='artifact_too_large')。 */
    async readFile(name) {
      const p = safeName(name);
      if (!p) throw Object.assign(new Error('bad_path'), { code: 'bad_path' });
      return withTransportRetry(async () => {
        const st = await backend.stat(p).catch(() => null);
        if (st && Number(st.size || 0) > maxReadBytes) {
          throw Object.assign(new Error(`artifact exceeds ${maxReadBytes} bytes`), { code: 'artifact_too_large', size: Number(st.size), noRetry: true });
        }
        return backend.read(p);
      });
    },
    /** 写产物文件到服务器 output/（小文件直写；>768KB 走 base64 分块 exec 追加通道）。
     *  注意：不能对空内容调 backend.write——空 b64 参数会被 agent 白名单拒绝。 */
    async writeFile(name, content) {
      const p = safeName(name);
      if (!p) throw Object.assign(new Error('bad_path'), { code: 'bad_path' });
      const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
      // Linux MAX_ARG_STRLEN = 128KB/参数：直写 b64 参数与「exec 命令再 b64 一次」
      // 的双重膨胀都必须留余量——直写 ≤64KB 原始内容、分块 64KB（P2 实测 96KB 即 E2BIG）
      const LIMIT = 64 * 1024;
      const CHUNK = 64 * 1024;
      const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
      if (data.length === 0) {
        await backend.exec(`: > ${shq(p)}`, resolved.root, 15);
        return { ok: true };
      }
      if (data.length <= LIMIT) return backend.write(p, data);
      for (let off = 0; off < data.length; off += CHUNK) {
        const chunk = data.subarray(off, Math.min(off + CHUNK, data.length));
        const b64 = chunk.toString('base64');
        const op = off === 0 ? '>' : '>>';
        await backend.exec(`printf %s ${b64} | base64 -d ${op} ${shq(p)}`, resolved.root, 60);
      }
      return { ok: true };
    },
    /** 服务器 run.log 末尾 tail 字节（真值；本地 remote-runner.log 仅为镜像缓存）。 */
    async readLogTail(tailBytes = 32 * 1024) {
      const logPath = safeRemoteJoin(outputRoot, 'run.log');
      if (!logPath) return null;
      return withTransportRetry(async () => {
        let size = 0;
        try {
          size = Number((await backend.stat(logPath)).size || 0);
        } catch (e) {
          if (isRetryableError(e)) throw e;
          return null;
        }
        const offset = Math.max(0, size - tailBytes);
        const buf = await backend.read(logPath, { offset });
        return {
          source: 'run.log',
          live: true,
          truncated: size > tailBytes,
          log: (size > tailBytes ? '…（仅显示末尾 32KB）\n' : '') + buf.toString('utf8'),
        };
      });
    },
  };
}

module.exports = { createJobOutputReader, DEFAULT_MAX_READ_BYTES };
