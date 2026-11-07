'use strict';

// BLOCK-92 Wave C-5 — workspace-tools 顶层 helpers 外迁（原 67-370 行，
// 纯搬运零行为变化）：哈希/整数收敛/错误结果/子进程封装/路径规范与敏感段/
// 包含判定/最近存在祖先/工作区目标解析/项目授权/后台进程与日志尾读。

const crypto = require('crypto');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');

const SENSITIVE_SEGMENTS = new Set([
  '.git',
  '.ssh',
  '.env',
  '.env.local',
  '.env.production',
  '.petri-secrets',
  '.netrc',
  '.npmrc',
  'credentials',
  'id_rsa',
  'id_ed25519',
  'keychain',
]);

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function clampInteger(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function errorResult(error, message, extra = {}) {
  return { ok: false, error, message, ...extra };
}

// ── BLOCK-360（NSO-W2-3）→ BLOCK-377（S2 / G-06+§8.9）命令判定单源 + 风险可见 ─────────
// 迁自 workspace-tools.js 的 commandVerdict（纯函数，集中一处便于负测）。
// S2 裁决（蓝图 §8.9）：特权令牌通道**删除**——per-call execToken 全仓无签发者（不可达
// 假安全面），进程级 env 令牌已被红测实证可被 `printenv` 读回绕过。删除后命令判定只剩
// 「默认放行 + 风险可见 + 严格模式开关」，默认放行裁决（2026-11-05）不变。
// 一次性执行凭据的正路 = execution-admission 内核（拦截器策略点签发、执行边界校验消耗，
// 见 shared-backend/execution-admission.js），不再走「令牌文本嵌命令」形态。
const MAX_COMMAND_BYTES = 64 * 1024;
const EXEC_TOKEN_ENV = 'PETRI_WORKSPACE_EXEC_TOKEN'; // 已停用（检测到即告警，恒忽略）
const STRICT_MODE_HINT = '严格模式可一键恢复硬拦：设环境变量 PETRI_EXEC_STRICT_DENYLIST=1';
const NON_NEGOTIABLE_RISKS = Object.freeze([
  { pattern: /(^|[;&|]\s*)(sudo|doas)(\s|$)/i, reason: '禁止通过命令行发起交互式提权' },
  { pattern: /(^|[;&|]\s*)rm(\s|$)/i, reason: '禁止通过命令行执行不可恢复删除；请使用受控文件操作' },
  { pattern: /(^|[;&|]\s*)git(?:\s+-C\s+\S+)?\s+push(\s|$)/i, reason: '禁止由工作区命令静默推送远端' },
  { pattern: /\b(curl|wget)\b[^|]*\|\s*(sh|bash|zsh|fish|python(?:3)?|perl|ruby)\b/i, reason: '禁止下载远程内容后直接管道执行' },
]);
let envTokenDeprecationWarned = false;

function commandVerdict(command, { env = process.env } = {}) {
  const normalized = String(command || '').trim();
  if (!normalized) return { ok: false, reason: 'command 不能为空' };
  if (Buffer.byteLength(normalized) > MAX_COMMAND_BYTES) return { ok: false, reason: 'command 过长' };
  if (normalized.includes('\0')) return { ok: false, reason: 'command 不能包含空字节' };
  if (env[EXEC_TOKEN_ENV] && !envTokenDeprecationWarned) {
    envTokenDeprecationWarned = true;
    try {
      console.warn(`[workspace-exec] ${EXEC_TOKEN_ENV} 已停用并被忽略（进程级令牌会下沉子进程）；特权通道已删除（S2/§8.9），风险命令走默认放行+可见`);
    } catch { /* 日志失败不影响判定 */ }
  }
  const strictDenylist = env.PETRI_EXEC_STRICT_DENYLIST === '1';
  const hits = NON_NEGOTIABLE_RISKS.filter(({ pattern }) => pattern.test(normalized));
  if (strictDenylist && hits[0]) return { ok: false, reason: hits[0].reason };
  if (hits.length > 0) {
    const warnings = hits.map((hit) => hit.reason);
    try {
      console.warn(`[workspace-exec] 风险提示（已放行；${STRICT_MODE_HINT}）：${warnings.join(' / ')}`);
    } catch { /* 日志失败不影响执行 */ }
    return { ok: true, riskWarnings: warnings, strictModeHint: STRICT_MODE_HINT };
  }
  return { ok: true };
}

/** 判定附带的风险/审计字段并入工具结果（结果非对象时原样返回）。 */
function withRiskVisibility(result, verdict) {
  if (!result || typeof result !== 'object' || !verdict) return result;
  const extra = {};
  if (Array.isArray(verdict.riskWarnings) && verdict.riskWarnings.length > 0) extra.riskWarnings = verdict.riskWarnings;
  if (verdict.strictModeHint) extra.strictModeHint = verdict.strictModeHint;
  // S2/§8.9：privilegedBypass 通道已删除（不再产生该字段；调用方为兼容旧审计日志保留读取无害）
  return Object.keys(extra).length ? { ...result, ...extra } : result;
}

/** 子进程 env：剥除特权令牌（防 printenv 读回复用）。 */
function childProcessEnv(base = process.env) {
  const env = { ...base };
  delete env[EXEC_TOKEN_ENV];
  return env;
}

// BLOCK-33 P3 — spawn 执行命令：stdout/stderr 增量通过 onOutput({ stream, text })
// 外抛供 SSE 流式转发，同时保留 execFile 的超时/maxBuffer 截断语义。
// 返回统一形状：{ ok, code, signal, timedOut, stdout, stderr, truncated, errorMessage }
function spawnCommand(invocation, { cwd, timeout, maxBuffer, onOutput }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(invocation.executable, invocation.args, {
        cwd,
        env: childProcessEnv(),
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      resolve({
        ok: false, code: 1, signal: null, timedOut: false,
        stdout: '', stderr: error.message, truncated: false, errorMessage: error.message,
      });
      return;
    }

    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let stdoutBuf = Buffer.alloc(0);
    let stderrBuf = Buffer.alloc(0);
    let truncated = false;
    let timedOut = false;
    let settled = false;
    let killTimer = null;
    let forceKillTimer = null;

    const clearTimers = () => {
      if (killTimer) clearTimeout(killTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
    };

    const killChild = () => {
      try { child.kill('SIGTERM'); } catch {}
      forceKillTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
      }, 5000);
    };

    // 返回 false 表示该流已超限，调用方应终止进程（对齐 execFile maxBuffer 行为）
    const collect = (chunk, isStdout) => {
      const target = isStdout ? stdoutBuf : stderrBuf;
      if (target.length >= maxBuffer) {
        truncated = true;
        return false;
      }
      const room = maxBuffer - target.length;
      const sliced = chunk.length > room ? chunk.subarray(0, room) : chunk;
      if (isStdout) stdoutBuf = Buffer.concat([stdoutBuf, sliced]);
      else stderrBuf = Buffer.concat([stderrBuf, sliced]);
      if (chunk.length > room) {
        truncated = true;
        return false;
      }
      return true;
    };

    const attach = (stream, isStdout, decoder) => {
      if (!stream) return;
      stream.on('data', (chunk) => {
        const text = decoder.write(chunk);
        if (onOutput && text) {
          try { onOutput({ stream: isStdout ? 'stdout' : 'stderr', text }); } catch {}
        }
        if (!collect(chunk, isStdout)) killChild();
      });
    };
    attach(child.stdout, true, stdoutDecoder);
    attach(child.stderr, false, stderrDecoder);

    if (Number.isFinite(timeout) && timeout > 0) {
      killTimer = setTimeout(() => {
        timedOut = true;
        killChild();
      }, timeout);
    }

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve({
        ok: false, code: 1, signal: null, timedOut,
        stdout: stdoutBuf.toString('utf8'),
        stderr: (stderrBuf.toString('utf8') + (stderrBuf.length ? '\n' : '') + error.message),
        truncated, errorMessage: error.message,
      });
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve({
        ok: code === 0,
        code,
        signal: signal || null,
        timedOut,
        stdout: stdoutBuf.toString('utf8') + stdoutDecoder.end(),
        stderr: stderrBuf.toString('utf8') + stderrDecoder.end(),
        truncated,
        errorMessage: null,
      });
    });
  });
}

function normalizeRelativePath(value) {
  const raw = String(value == null ? '.' : value).trim();
  if (!raw || raw === '.') return '.';
  if (path.isAbsolute(raw)) {
    throw Object.assign(new Error('只接受项目工作区内的相对路径'), { code: 'absolute_path_not_allowed' });
  }
  return raw.replace(/\\/g, '/').replace(/^\.\//, '');
}

function containsSensitiveSegment(relativePath) {
  return String(relativePath)
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((segment) => SENSITIVE_SEGMENTS.has(segment.toLowerCase()));
}

function isContained(root, target) {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + path.sep);
}

async function nearestExistingAncestor(target) {
  let current = target;
  while (true) {
    try {
      await fsp.lstat(current);
      return current;
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

async function resolveWorkspaceTarget(workspaceRoot, relativePath, options = {}) {
  const normalizedRelative = normalizeRelativePath(relativePath);
  if (containsSensitiveSegment(normalizedRelative)) {
    throw Object.assign(new Error('该路径属于敏感文件或元数据目录'), { code: 'sensitive_path' });
  }

  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, normalizedRelative);
  if (!isContained(root, target)) {
    throw Object.assign(new Error('路径逃逸出当前项目工作区'), { code: 'path_escape' });
  }

  if (options.createRoot !== false) {
    await fsp.mkdir(root, { recursive: true });
  }
  let realRoot;
  try {
    realRoot = await fsp.realpath(root);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw Object.assign(new Error('项目工作区尚不存在，无法执行只读预演'), {
        code: 'workspace_unavailable',
      });
    }
    throw error;
  }
  const existingAncestor = await nearestExistingAncestor(target);
  const realAncestor = await fsp.realpath(existingAncestor);
  if (!isContained(realRoot, realAncestor)) {
    throw Object.assign(new Error('符号链接指向项目工作区外部'), { code: 'symlink_escape' });
  }

  if (options.rejectSymlink !== false) {
    try {
      const stat = await fsp.lstat(target);
      if (stat.isSymbolicLink()) {
        throw Object.assign(new Error('不允许直接操作符号链接'), { code: 'symlink_not_allowed' });
      }
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
  }

  return { root: realRoot, target, relativePath: normalizedRelative };
}

function authorizeProject(project, userId, db) {
  if (!userId) {
    throw Object.assign(new Error('需要登录后才能访问项目工作区'), { code: 'unauthorized' });
  }
  if (project.status === 'archived') {
    throw Object.assign(new Error('项目已归档'), { code: 'project_archived' });
  }
  if (project.user_id && project.user_id !== userId) {
    let isAdmin = false;
    try {
      isAdmin = typeof db.getUserById === 'function' && db.getUserById(userId)?.role === 'admin';
    } catch {}
    if (!isAdmin) {
      throw Object.assign(new Error('无权访问该项目工作区'), { code: 'permission_denied' });
    }
  }
}

// ===== BLOCK-33 P4 — 后台进程（workspace_exec_background / process_status / process_stop） =====
// 进程表为内存态、per conversation（应用重启自然失效——诚实边界，日志文件仍在工作区内可手工查看）。
const BACKGROUND_LOG_DIR = '.petri-agent-tmp';
const BACKGROUND_MAX_RUNNING_PER_SESSION = 16;
const BACKGROUND_MAX_RECORDS = 256;
const BACKGROUND_LOG_TAIL_DEFAULT = 4096;
const BACKGROUND_LOG_TAIL_MAX = 65536;
const PROCESS_STOP_GRACE_MS = 3000;

const backgroundProcesses = new Map();

function backgroundSessionKey(ctx = {}) {
  if (ctx.conversationId) return `conv:${ctx.conversationId}`;
  return `project:${ctx.projectId || 'unknown'}:${ctx.userId || 'unknown'}`;
}

async function readLogTail(logPath, bytes) {
  const handle = await fsp.open(logPath, 'r');
  try {
    const stat = await handle.stat();
    const size = Math.min(stat.size, bytes);
    if (size <= 0) return { text: '', truncated: false, size: stat.size };
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, stat.size - size);
    return {
      text: buffer.toString('utf8'),
      truncated: stat.size > bytes,
      size: stat.size,
    };
  } finally {
    await handle.close();
  }
}

function killBackgroundProcess(record, signal) {
  const isWindows = process.platform === 'win32';
  try {
    if (isWindows) {
      // Windows：taskkill /T 结束整棵进程树
      spawn('taskkill', ['/pid', String(record.pid), '/T', '/F'], { windowsHide: true }).unref();
      return;
    }
    if (record.detachedGroup) {
      // posix：detached 使子进程成为进程组长，负 pid 可杀整组（shell 及其后代）
      try {
        process.kill(-record.pid, signal);
        return;
      } catch {
        // 进程组已消失，退回直接杀
      }
    }
    record.child.kill(signal);
  } catch {
    // 进程已退出：close 回调负责收敛状态
  }
}

function terminateBackgroundProcess(record) {
  if (record.status !== 'running') return;
  killBackgroundProcess(record, 'SIGTERM');
  setTimeout(() => {
    if (record.status !== 'running') return;
    killBackgroundProcess(record, 'SIGKILL');
  }, PROCESS_STOP_GRACE_MS);
}

function pruneBackgroundRecords() {
  if (backgroundProcesses.size <= BACKGROUND_MAX_RECORDS) return;
  const removable = [...backgroundProcesses.values()]
    .filter((record) => record.status !== 'running')
    .sort((a, b) => a.startedAt - b.startedAt);
  let overflow = backgroundProcesses.size - BACKGROUND_MAX_RECORDS;
  for (const record of removable) {
    if (overflow <= 0) break;
    backgroundProcesses.delete(record.id);
    overflow -= 1;
  }
}

/** BLOCK-223 — 退出摘要只读面：当前仍在运行的后台进程数（不含已退出记录）。 */
function countRunningBackgroundProcesses() {
  let running = 0;
  for (const record of backgroundProcesses.values()) {
    if (record && record.status === 'running') running += 1;
  }
  return running;
}

module.exports = {
  childProcessEnv,
  commandVerdict,
  withRiskVisibility,
  backgroundProcesses,
  countRunningBackgroundProcesses,
  BACKGROUND_LOG_DIR,
  BACKGROUND_LOG_TAIL_DEFAULT,
  BACKGROUND_LOG_TAIL_MAX,
  BACKGROUND_MAX_RUNNING_PER_SESSION,
  PROCESS_STOP_GRACE_MS,
  sha256,
  clampInteger,
  errorResult,
  spawnCommand,
  normalizeRelativePath,
  containsSensitiveSegment,
  isContained,
  nearestExistingAncestor,
  resolveWorkspaceTarget,
  authorizeProject,
  backgroundSessionKey,
  readLogTail,
  killBackgroundProcess,
  terminateBackgroundProcess,
  pruneBackgroundRecords,
};
