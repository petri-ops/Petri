/**
 * BLOCK-67 P2 — workspace_* 工具的 SSH 远程面。
 *
 * 项目 workspace_kind === 'ssh' 时，8 个 workspace_* 工具 + 后台进程三件套路由到这里：
 * 文件操作走 Workspace Gateway（node-agent fs verbs），命令执行走 exec/exec_bg verbs。
 * 返回契约与本地实现逐字段对齐（模型可见面同构）；语义差异（无流式 yield / exec 同步）
 * 在返回体里诚实标注，不冒充本地行为。
 *
 * 校验回调由 workspace-tools 闭包注入（authorize / G0 baseline / 命令黑名单单源，
 * 不在本文件复制第二套裁决）。
 */

const crypto = require('crypto');

const workspaceGateway = require('../helpers/workspace-gateway');
// BLOCK-77 P1 — 驻留创建链传输重试（dell 嵌套 ProxyJump 半死隧道实测：mux 首写 30s
// 超时 → killSession 重建 → 重试即通；与直跑 runner 的 withTransportRetry 同款纪律）
const { withTransportRetry } = require('../helpers/remote-execution/ssh-direct-runner');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_MAX_READ_LINES = 2000;
const MAX_READ_LINES = 5000;
const DEFAULT_COMMAND_TIMEOUT_MS = 120000;
const MAX_COMMAND_TIMEOUT_MS = 600000;

function clampInteger(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function errorResult(code, message, extra) {
  return { ok: false, code, error: message, ...(extra || {}) };
}

function globToRegExp(pattern) {
  const source = String(pattern || '*')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${source}$`, 'i');
}

function createSshWorkspaceSurface({
  getProject,
  authorizeProject,
  assertProjectG0Compatible,
  commandVerdict,
  sensitiveSegments,
  dbProvider,
}) {
  async function getRemoteWorkspace(ctx, { requireCompatible = false } = {}) {
    const projectId = String((ctx && ctx.projectId) || '').trim();
    if (!projectId) {
      throw Object.assign(new Error('基础文件工具只能在有效项目中使用'), { code: 'project_required' });
    }
    const db = dbProvider();
    const project = getProject(projectId);
    if (!project) throw Object.assign(new Error('项目不存在'), { code: 'project_not_found' });
    authorizeProject(project, ctx && ctx.userId, db);
    if (requireCompatible) assertProjectG0Compatible(project);
    if (project.workspace_kind !== 'ssh') {
      throw Object.assign(new Error('非 SSH 项目不走远程工具面'), { code: 'not_ssh_project' });
    }
    const resolved = workspaceGateway.resolveWorkspaceBackend(project);
    if (resolved.error || !resolved.backend || resolved.backend.kind !== 'ssh') {
      throw Object.assign(new Error('远程项目配置不完整'), { code: 'workspace_unavailable' });
    }
    return { project, root: resolved.root, backend: resolved.backend, sshHost: project.ssh_host };
  }

  function remoteErrorToResult(error, fallback = 'remote_unavailable') {
    if (error && error.classified) {
      return errorResult('remote_unreachable', `远程连接失败（${error.classified.kind}）`, {
        retryable: error.classified.retryable === true,
      });
    }
    return errorResult(error && error.code ? error.code : fallback, (error && error.message) || '远程操作失败');
  }

  async function resolveRemote(root, backend, relativePath) {
    const rel = String(relativePath || '.').replace(/\\/g, '/');
    const abs = workspaceGateway.safeRemoteJoin(root, rel === '.' || rel === '' ? '' : rel);
    if (!abs) throw Object.assign(new Error('非法路径'), { code: 'invalid_path' });
    return { abs, relativePath: rel === '.' || rel === '' ? '.' : rel };
  }

  // ── workspace_list ──
  async function listDirectory(args = {}, ctx = {}) {
    let ws;
    try { ws = await getRemoteWorkspace(ctx); } catch (e) { return errorResult(e.code || 'workspace_unavailable', e.message); }
    try {
      const resolved = await resolveRemote(ws.root, ws.backend, args.path || '.');
      const stat = await ws.backend.stat(resolved.abs);
      if (stat.type !== 'dir') return errorResult('not_a_directory', '目标不是目录');
      const includeHidden = args.includeHidden === true;
      const limit = clampInteger(args.limit, DEFAULT_MAX_ENTRIES, 1, 500);
      const raw = await ws.backend.list(resolved.abs);
      const entries = [];
      for (const entry of raw) {
        const nameLower = entry.name.toLowerCase();
        if (sensitiveSegments.has(nameLower)) continue;
        if (!includeHidden && entry.name.startsWith('.')) continue;
        entries.push({
          name: entry.name,
          path: resolved.relativePath === '.' ? entry.name : `${resolved.relativePath}/${entry.name}`,
          type: entry.type === 'dir' ? 'directory' : 'file',
          ...(entry.type === 'file' ? { sizeBytes: entry.size } : {}),
          modifiedAt: new Date(entry.mtimeMs).toISOString(),
        });
      }
      entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return { ok: true, path: resolved.relativePath, entries: entries.slice(0, limit), truncated: entries.length > limit };
    } catch (e) {
      if (e.remoteError === 'not_found') return errorResult('not_found', '路径不存在');
      return remoteErrorToResult(e);
    }
  }

  // ── workspace_read ──
  async function readFile(args = {}, ctx = {}) {
    let ws;
    try { ws = await getRemoteWorkspace(ctx); } catch (e) { return errorResult(e.code || 'workspace_unavailable', e.message); }
    try {
      const resolved = await resolveRemote(ws.root, ws.backend, args.path);
      const stat = await ws.backend.stat(resolved.abs);
      if (stat.type !== 'file') return errorResult('not_a_file', '目标不是文件');
      if (stat.size > MAX_TEXT_FILE_BYTES) {
        return errorResult('file_too_large', `文本读取上限为 ${MAX_TEXT_FILE_BYTES} 字节`, { sizeBytes: stat.size });
      }
      const buffer = await ws.backend.read(resolved.abs);
      if (buffer.includes(0)) return errorResult('binary_file', '二进制文件不能作为文本读取');
      const content = buffer.toString('utf8');
      const lines = content.split(/\r?\n/);
      const startLine = clampInteger(args.startLine, 1, 1, Math.max(1, lines.length));
      const maxLines = clampInteger(args.maxLines, DEFAULT_MAX_READ_LINES, 1, MAX_READ_LINES);
      const selected = lines.slice(startLine - 1, startLine - 1 + maxLines);
      return {
        ok: true,
        path: resolved.relativePath,
        content: selected.join('\n'),
        startLine,
        endLine: startLine + Math.max(0, selected.length - 1),
        totalLines: lines.length,
        sizeBytes: stat.size,
        sha256: sha256(buffer),
        truncated: startLine - 1 + selected.length < lines.length,
      };
    } catch (e) {
      if (e.remoteError === 'not_found') return errorResult('not_found', '文件不存在');
      return remoteErrorToResult(e);
    }
  }

  // ── workspace_write ──
  async function writeFile(args = {}, ctx = {}, _handlerOptions = {}, helpers = {}) {
    const content = String(args.content == null ? '' : args.content);
    if (Buffer.byteLength(content) > MAX_WRITE_BYTES) {
      return errorResult('content_too_large', `单次写入上限为 ${MAX_WRITE_BYTES} 字节`);
    }
    let ws;
    try { ws = await getRemoteWorkspace(ctx, { requireCompatible: true }); } catch (e) { return errorResult(e.code || 'workspace_unavailable', e.message); }
    try {
      const resolved = await resolveRemote(ws.root, ws.backend, args.path);
      let existing = null;
      try { existing = await ws.backend.read(resolved.abs); } catch (e) { if (e.remoteError !== 'not_found') throw e; }
      const change = (helpers.buildChange || (() => ({ summary: null, diff: null })))(resolved.relativePath, existing ? existing.toString('utf8') : null, content);
      if (args.dryRun !== true) {
        await ws.backend.write(resolved.abs, content);
      }
      return {
        ok: true,
        path: resolved.relativePath,
        created: !existing,
        sizeBytes: Buffer.byteLength(content),
        previousSha256: existing ? sha256(existing) : null,
        sha256: sha256(content),
        dryRun: args.dryRun === true,
        changeSummary: change.summary,
        changeDiff: change.diff,
        remote: { host: ws.sshHost, semantics: 'ssh write-through' },
      };
    } catch (e) {
      if (e.remoteError === 'not_found' && args.dryRun === true) {
        // dryRun 读不存在 = 新建预演，与本地 createRoot 缺省语义对齐
        const change = (helpers.buildChange || (() => ({ summary: null, diff: null })))(String(args.path || ''), null, content);
        return {
          ok: true, path: String(args.path || ''), created: true, sizeBytes: Buffer.byteLength(content),
          previousSha256: null, sha256: sha256(content), dryRun: true,
          changeSummary: change.summary, changeDiff: change.diff, remote: { host: ws.sshHost, semantics: 'ssh write-through' },
        };
      }
      return remoteErrorToResult(e);
    }
  }

  // ── workspace_replace ──
  async function replaceText(args = {}, ctx = {}, _handlerOptions = {}, helpers = {}) {
    const oldText = String(args.oldText == null ? '' : args.oldText);
    const newText = String(args.newText == null ? '' : args.newText);
    if (!oldText) return errorResult('old_text_required', 'oldText 不能为空');
    if (!args.expectedSha256) return errorResult('expected_sha256_required', '文本替换必须提供 expectedSha256');
    let ws;
    try { ws = await getRemoteWorkspace(ctx, { requireCompatible: true }); } catch (e) { return errorResult(e.code || 'workspace_unavailable', e.message); }
    try {
      const resolved = await resolveRemote(ws.root, ws.backend, args.path);
      const stat = await ws.backend.stat(resolved.abs);
      if (stat.type !== 'file') return errorResult('not_a_file', '目标不是文件');
      if (stat.size > MAX_TEXT_FILE_BYTES) return errorResult('file_too_large', '文件过大，拒绝文本替换');
      const beforeBuf = await ws.backend.read(resolved.abs);
      const before = beforeBuf.toString('utf8');
      if (sha256(beforeBuf) !== String(args.expectedSha256)) {
        return errorResult('content_conflict', '文件已发生变化，expectedSha256 不匹配');
      }
      let count = 0;
      let position = before.indexOf(oldText);
      while (position !== -1) {
        count += 1;
        position = before.indexOf(oldText, position + oldText.length);
      }
      if (count === 0) return errorResult('text_not_found', 'oldText 未找到');
      if (count !== 1) return errorResult('text_not_unique', `oldText 匹配 ${count} 次；必须提供唯一片段`);
      const after = before.replace(oldText, newText);
      if (Buffer.byteLength(after) > MAX_WRITE_BYTES) {
        return errorResult('content_too_large', `替换后的文件超过 ${MAX_WRITE_BYTES} 字节`);
      }
      const change = (helpers.buildChange || (() => ({ summary: null, diff: null })))(resolved.relativePath, before, after);
      if (args.dryRun !== true) {
        await ws.backend.write(resolved.abs, after);
      }
      return {
        ok: true,
        path: resolved.relativePath,
        replacements: 1,
        previousSha256: sha256(beforeBuf),
        sha256: sha256(Buffer.from(after, 'utf8')),
        dryRun: args.dryRun === true,
        changeSummary: change.summary,
        changeDiff: change.diff,
        remote: { host: ws.sshHost, semantics: 'ssh write-through' },
      };
    } catch (e) {
      if (e.remoteError === 'not_found') return errorResult('not_found', '文件不存在');
      return remoteErrorToResult(e);
    }
  }

  // ── workspace_find ──
  async function findFiles(args = {}, ctx = {}) {
    let ws;
    try { ws = await getRemoteWorkspace(ctx); } catch (e) { return errorResult(e.code || 'workspace_unavailable', e.message); }
    try {
      const resolved = await resolveRemote(ws.root, ws.backend, args.path || '.');
      const stat = await ws.backend.stat(resolved.abs);
      if (stat.type !== 'dir') return errorResult('not_a_directory', '查找起点不是目录');
      const pattern = String(args.pattern || '*').trim() || '*';
      const matcher = globToRegExp(pattern);
      const limit = clampInteger(args.limit, DEFAULT_MAX_ENTRIES, 1, 500);
      const maxDepth = clampInteger(args.maxDepth, 8, 0, 20);
      const maxFiles = clampInteger(args.maxFiles, 5000, 1, 20000);
      const findOut = await ws.backend.find(resolved.abs, maxDepth);
      const lines = String(findOut).split('\n').filter(Boolean).slice(0, maxFiles);
      const matches = [];
      let filesScanned = 0;
      for (const rel of lines) {
        filesScanned += 1;
        if (matches.length >= limit) continue;
        const base = rel.split('/').pop();
        if (matcher.test(rel) || matcher.test(base)) {
          const abs = workspaceGateway.safeRemoteJoin(resolved.abs, rel);
          if (!abs) continue;
          try {
            const st = await ws.backend.stat(abs);
            if (st.type === 'file') {
              matches.push({ path: rel, sizeBytes: st.size, modifiedAt: new Date(st.mtimeMs).toISOString() });
            }
          } catch { /* 竞态删除：跳过 */ }
        }
      }
      return {
        ok: true, pattern, matches, filesScanned,
        truncated: matches.length >= limit || lines.length >= maxFiles,
      };
    } catch (e) {
      if (e.remoteError === 'not_found') return errorResult('not_found', '路径不存在');
      return remoteErrorToResult(e);
    }
  }

  // ── workspace_search ──
  async function searchText(args = {}, ctx = {}) {
    const query = String(args.query || '');
    if (!query) return errorResult('query_required', 'query 不能为空');
    let ws;
    try { ws = await getRemoteWorkspace(ctx); } catch (e) { return errorResult(e.code || 'workspace_unavailable', e.message); }
    try {
      const resolved = await resolveRemote(ws.root, ws.backend, args.path || '.');
      const limit = clampInteger(args.limit, 80, 1, 300);
      const fileMatcher = args.filePattern ? globToRegExp(args.filePattern) : null;
      const caseSensitive = args.caseSensitive === true;
      const raw = await ws.backend.grep(caseSensitive ? query : query.toLowerCase(), resolved.abs, limit * 3);
      const lines = String(raw).split('\n').filter(Boolean);
      const matches = [];
      let filesScanned = new Set();
      for (const line of lines) {
        const colon = line.indexOf(':');
        if (colon <= 0) continue;
        const filePath = line.slice(0, colon);
        const rest = line.slice(colon + 1);
        const secondColon = rest.indexOf(':');
        if (secondColon < 0) continue;
        const lineNo = Number.parseInt(rest.slice(0, secondColon), 10);
        const text = rest.slice(secondColon + 1);
        if (!Number.isFinite(lineNo)) continue;
        filesScanned.add(filePath);
        if (matches.length >= limit) continue;
        if (fileMatcher && !fileMatcher.test(filePath) && !fileMatcher.test(filePath.split('/').pop())) continue;
        let display = text;
        if (!caseSensitive) {
          const hay = text.toLowerCase();
          const idx = hay.indexOf(query.toLowerCase());
          if (idx >= 0) display = text;
        }
        matches.push({ path: filePath, line: lineNo, text: display.slice(0, 500) });
      }
      return {
        ok: true, query, matches,
        filesScanned: filesScanned.size, skippedBinaryOrLarge: 0,
        truncated: matches.length >= limit,
        remote: { host: ws.sshHost, semantics: 'remote grep -rnI（二进制自动跳过）' },
      };
    } catch (e) {
      if (e.remoteError === 'not_found') return errorResult('not_found', '路径不存在');
      return remoteErrorToResult(e);
    }
  }

  // ── workspace_exec（同步远程执行；v1 无流式 yield，返回体诚实标注） ──
  async function executeCommand(args = {}, ctx = {}) {
    if (ctx.accessMode !== 'full' && ctx.accessMode !== 'workspace-write') {
      return errorResult('access_mode_read_only', '聊天当前处于只读模式，禁止执行命令');
    }
    const command = String(args.command || '').trim();
    const verdict = commandVerdict(command);
    if (!verdict.ok) return errorResult('command_blocked', verdict.reason);
    let ws;
    try { ws = await getRemoteWorkspace(ctx, { requireCompatible: true }); } catch (e) { return errorResult(e.code || 'workspace_unavailable', e.message); }
    try {
      let cwdAbs = ws.root;
      let cwdLabel = '.';
      if (args.cwd != null && String(args.cwd).trim() !== '' && String(args.cwd).trim() !== '.') {
        const resolved = await resolveRemote(ws.root, ws.backend, String(args.cwd).trim());
        const st = await ws.backend.stat(resolved.abs);
        if (st.type !== 'dir') return errorResult('invalid_arguments', `cwd 不是工作区内已存在的目录: ${resolved.relativePath}`);
        cwdAbs = resolved.abs;
        cwdLabel = resolved.relativePath;
      }
      const timeoutMs = clampInteger(args.timeoutMs, DEFAULT_COMMAND_TIMEOUT_MS, 100, MAX_COMMAND_TIMEOUT_MS);
      const startedAt = Date.now();
      const result = await ws.backend.exec(command, cwdAbs, Math.ceil(timeoutMs / 1000));
      const durationMs = Date.now() - startedAt;
      return {
        ok: result.code === 0,
        command,
        cwd: cwdLabel,
        shell: `ssh:${ws.sshHost}/bash`,
        exitCode: result.code,
        signal: null,
        timedOut: result.timedOut === true,
        durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
        truncated: result.truncated === true,
        remote: { host: ws.sshHost, semantics: 'ssh 同步执行（无流式 yield）' },
      };
    } catch (e) {
      return remoteErrorToResult(e);
    }
  }

  // ── 后台进程三件套（远端 detached + 节点侧日志，进程表为内存态与本地同语义） ──
  const remoteBackgrounds = new Map();
  const BG_LOG_DIR = '.biof3-agent-tmp';

  function bgKey(ctx = {}) {
    if (ctx.conversationId) return `conv:${ctx.conversationId}`;
    return `project:${ctx.projectId || 'unknown'}:${ctx.userId || 'unknown'}`;
  }

  // BLOCK-78 P2-④：会话级后台进程清单（REST 浮窗/摘要卡读面）。
  // 状态为注册表懒探针语义——running 表示「已登记且未观测到退出」，精确
  // 存活以 process_status 单查（ps_pid 实探）为准；列表不做逐 pid 探测，
  // 避免浮窗 1s 轮询打满 mux 串行队列。服务重启注册表清空与本地表同语义。
  function processList(_args = {}, ctx = {}) {
    const sessionId = bgKey(ctx);
    const now = Date.now();
    const processes = [...remoteBackgrounds.values()]
      .filter((r) => r.session === sessionId)
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((r) => ({
        processId: r.id,
        pid: r.pid,
        status: r.status,
        command: r.command,
        host: r.host,
        startedAtIso: new Date(r.startedAt).toISOString(),
        durationMs: Math.max(0, now - r.startedAt),
        logPath: r.logRel,
        source: 'ssh-registry',
      }));
    return { ok: true, count: processes.length, processes, source: 'ssh-registry' };
  }

  async function execBackground(args = {}, ctx = {}) {
    if (ctx.accessMode !== 'full' && ctx.accessMode !== 'workspace-write') {
      return errorResult('access_mode_read_only', '聊天当前处于只读模式，禁止执行命令');
    }
    const command = String(args.command || '').trim();
    const verdict = commandVerdict(command);
    if (!verdict.ok) return errorResult('command_blocked', verdict.reason);
    let ws;
    try { ws = await getRemoteWorkspace(ctx, { requireCompatible: true }); } catch (e) { return errorResult(e.code || 'workspace_unavailable', e.message); }
    try {
      const sessionId = bgKey(ctx);
      const running = [...remoteBackgrounds.values()].filter((r) => r.session === sessionId && r.status === 'running');
      if (running.length >= 16) return errorResult('too_many_processes', '本会话后台进程已达上限（16）');
      const id = `rbg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const logRel = args.logFile || `${BG_LOG_DIR}/${id}.log`;
      const logAbs = workspaceGateway.safeRemoteJoin(ws.root, logRel);
      if (!logAbs) return errorResult('invalid_arguments', 'logFile 非法');
      const cwdAbs = ws.root;
      const spawn = await ws.backend.execBackground(command, cwdAbs, logAbs);
      if (!spawn.pid) return errorResult('spawn_failed', '远程后台启动失败');
      const record = {
        id, session: sessionId, command, pid: spawn.pid, host: ws.sshHost,
        status: 'running', startedAt: Date.now(),
        logAbs, logRel, backend: ws.backend,
      };
      remoteBackgrounds.set(id, record);
      if (remoteBackgrounds.size > 256) {
        const removable = [...remoteBackgrounds.values()]
          .filter((r) => r.status !== 'running')
          .sort((a, b) => a.startedAt - b.startedAt);
        for (const r of removable.slice(0, remoteBackgrounds.size - 256)) remoteBackgrounds.delete(r.id);
      }
      return { ok: true, id, pid: spawn.pid, status: 'running', logFile: logRel, host: ws.sshHost };
    } catch (e) {
      return remoteErrorToResult(e);
    }
  }

  async function processStatus(args = {}, _ctx = {}) {
    const id = String(args.id || '');
    const record = remoteBackgrounds.get(id);
    if (!record) return errorResult('process_not_found', `后台进程不存在: ${id}`);
    if (record.status === 'running') {
      try {
        const ps = await record.backend.processAlive(record.pid);
        if (!ps.alive) {
          record.status = 'exited';
          record.finishedAt = Date.now();
        }
      } catch (e) {
        return remoteErrorToResult(e);
      }
    }
    const result = {
      ok: true, id, status: record.status, pid: record.pid, host: record.host,
      command: record.command, logFile: record.logRel,
      startedAt: record.startedAt, ...(record.status !== 'running' ? { finishedAt: record.finishedAt } : {}),
    };
    if (args.tail !== 'none') {
      const bytes = clampInteger(args.tailBytes, 4096, 256, 65536);
      try {
        const st = await record.backend.stat(record.logAbs);
        const offset = Math.max(0, st.size - bytes);
        const buf = await record.backend.read(record.logAbs, { offset });
        result.logTail = buf.toString('utf8');
        result.logSizeBytes = st.size;
      } catch (e) {
        if (e.remoteError !== 'not_found') throw e;
        result.logTail = '';
        result.logSizeBytes = 0;
      }
    }
    return result;
  }

  async function processStop(args = {}, _ctx = {}) {
    const id = String(args.id || '');
    const record = remoteBackgrounds.get(id);
    if (!record) return errorResult('process_not_found', `后台进程不存在: ${id}`);
    if (record.status !== 'running') return { ok: true, id, status: record.status, note: 'already_finished' };
    try {
      const killed = await record.backend.killPid(record.pid, 'TERM');
      // 与本地同款收敛语义：TERM 后由 processStatus 对账收敛
      return { ok: killed.signaled, id, status: killed.signaled ? 'stopping' : record.status, note: killed.signaled ? 'TERM sent' : 'signal failed（可能已退出）' };
    } catch (e) {
      return remoteErrorToResult(e);
    }
  }

  // ── preflight（interceptor 在 handler 前的门：ssh 项目用远程语义，返回形状与本地对齐） ──
  async function preflight(name, args = {}, ctx = {}) {
    let ws;
    try { ws = await getRemoteWorkspace(ctx, { requireCompatible: ['workspace_write', 'workspace_replace', 'workspace_exec', 'workspace_exec_background'].includes(name) }); }
    catch (e) { return errorResult(e.code || 'workspace_unavailable', e.message); }
    try {
      if (name === 'workspace_exec' || name === 'workspace_exec_background') {
        const execAllowed = ctx.accessMode === 'full'
          || (ctx.accessMode === 'workspace-write' && name === 'workspace_exec');
        if (!execAllowed) {
          return errorResult(
            ctx.accessMode === 'workspace-write' ? 'access_mode_workspace_write' : 'access_mode_read_only',
            ctx.accessMode === 'workspace-write'
              ? '项目写模式仅允许前台命令执行；后台进程需要完全访问模式'
              : '聊天当前处于只读模式，禁止执行命令'
          );
        }
        const command = String(args.command || '').trim();
        const verdict = commandVerdict(command);
        if (!verdict.ok) return errorResult('command_blocked', verdict.reason);
        if (args.cwd != null && String(args.cwd).trim() !== '' && String(args.cwd).trim() !== '.') {
          const resolved = await resolveRemote(ws.root, ws.backend, String(args.cwd).trim());
          const st = await ws.backend.stat(resolved.abs);
          if (st.type !== 'dir') return errorResult('invalid_arguments', `cwd 不是工作区内已存在的目录: ${resolved.relativePath}`);
        }
        return { ok: true, commandRisk: 'full_access' };
      }
      if (name === 'process_status' || name === 'process_stop') {
        return { ok: true, commandRisk: 'process_control' };
      }
      // BLOCK-77 P1 — 驻留任务创建：后台长驻进程 + 意图卡，需完全访问模式（R5）
      if (name === 'resident_task_create') {
        if (ctx.accessMode !== 'full') {
          return errorResult(
            ctx.accessMode === 'workspace-write' ? 'access_mode_workspace_write' : 'access_mode_read_only',
            '驻留任务为长驻后台进程，需要完全访问模式'
          );
        }
        const command = String(args.command || '').trim();
        const verdict = commandVerdict(command);
        if (!verdict.ok) return errorResult('command_blocked', verdict.reason);
        if (!String(args.intent || '').trim()) {
          return errorResult('invalid_arguments', 'intent 不能为空（意图卡核心字段）');
        }
        return { ok: true, commandRisk: 'full_access' };
      }
      const resolved = await resolveRemote(ws.root, ws.backend, args.path || '.');
      let exists = true;
      try { await ws.backend.stat(resolved.abs); } catch (e) { if (e.remoteError !== 'not_found') throw e; exists = false; }
      return { ok: true, exists, relativePath: resolved.relativePath };
    } catch (e) {
      if (e.remoteError === 'not_found') return { ok: true, exists: false, relativePath: String(args.path || '.') };
      return remoteErrorToResult(e);
    }
  }

  // ── BLOCK-77 P1 — 驻留任务（意图卡 .gewu/resident/<taskId>.json，服务器真值）──
  // 卡片只描述「意图与归属」；执行真相仍在 exec_bg 进程 + ps_pid 实探（单一真值红线）。
  async function createResidentTask(args = {}, ctx = {}) {
    if (ctx.accessMode !== 'full') {
      return errorResult('access_mode_read_only', '驻留任务为长驻后台进程，需要完全访问模式');
    }
    const intent = String(args.intent || '').trim();
    if (!intent) return errorResult('invalid_arguments', 'intent 不能为空（意图卡核心字段）');
    const command = String(args.command || '').trim();
    if (!command) return errorResult('invalid_arguments', 'command 不能为空');

    const taskId = `res_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    let ws;
    try { ws = await getRemoteWorkspace(ctx, { requireCompatible: true }); } catch (e) { return errorResult(e.code || 'workspace_unavailable', e.message); }
    const root = ws.root.replace(/\/+$/, '');
    
    // ① 起进程：复用既有 exec_bg 通道（注册表/日志语义不变）；命令包 .exit
    //    标记（回访循环读退出码），日志固定进 .gewu/resident/<taskId>.log。
    const wrapped = `( ${command} ) ; echo $? > .gewu/resident/${taskId}.exit`;
    const bg = await withTransportRetry(() => execBackground({ command: wrapped, cwd: args.cwd, logFile: `.gewu/resident/${taskId}.log` }, ctx));
    if (!bg || bg.ok !== true) return bg;

    // ② 意图卡一次成型（跨会话交接班凭据）
    const dirAbs = `${root}/.gewu/resident`;
    const card = {
      taskId,
      intent,
      successCriteria: String(args.successCriteria || ''),
      failureHandling: String(args.failureHandling || 'notify-only'),
      command,
      backingProcess: { processId: bg.id, pid: bg.pid, logPath: bg.logFile, host: ws.sshHost },
      projectRoot: root,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'running',
      lastCheckAt: null,
      lastCheckNote: null,
    };
    try {
      await withTransportRetry(async () => {
        await ws.backend.mkdir(dirAbs);
        await ws.backend.write(`${dirAbs}/${taskId}.json`, Buffer.from(JSON.stringify(card, null, 2), 'utf8'));
      });
    } catch (e) {
      return { ok: true, taskId, pid: bg.pid, logPath: bg.logFile, cardError: `意图卡写入失败: ${e.message}` };
    }
    return { ok: true, taskId, pid: bg.pid, logPath: bg.logFile, cardPath: `.gewu/resident/${taskId}.json`, card };
  }

  async function listResidentTasks(_args = {}, ctx = {}) {
    let ws;
    try { ws = await getRemoteWorkspace(ctx, {}); } catch (e) { return errorResult(e.code || 'workspace_unavailable', e.message); }
    const dir = `${ws.root.replace(/\/+$/, '')}/.gewu/resident`;
    const entries = await ws.backend.list(dir).catch(() => []);
    const tasks = [];
    for (const entry of entries.filter((x) => x.type === 'file' && x.name.endsWith('.json'))) {
      try {
        const buf = await ws.backend.read(`${dir}/${entry.name}`);
        tasks.push(JSON.parse(buf.toString('utf8')));
      } catch { /* 单卡损坏跳过，不拖垮清单 */ }
    }
    tasks.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return { ok: true, count: tasks.length, tasks };
  }

  async function readResidentTask(args = {}, ctx = {}) {
    let ws;
    try { ws = await getRemoteWorkspace(ctx, {}); } catch (e) { return errorResult(e.code || 'workspace_unavailable', e.message); }
    const clean = String(args.taskId || '').replace(/[^A-Za-z0-9._-]/g, '');
    if (!clean || clean.includes('..')) return errorResult('invalid_arguments', 'taskId 非法');
    try {
      const buf = await ws.backend.read(`${ws.root.replace(/\/+$/, '')}/.gewu/resident/${clean}.json`);
      return { ok: true, card: JSON.parse(buf.toString('utf8')) };
    } catch {
      return errorResult('resident_task_not_found', `驻留任务不存在: ${clean}`);
    }
  }

  return {
    kind: 'ssh',
    preflight,
    listDirectory,
    readFile,
    writeFile,
    replaceText,
    findFiles,
    searchText,
    executeCommand,
    execBackground,
    processList,
    processStatus,
    processStop,
    createResidentTask,
    listResidentTasks,
    readResidentTask,
  };
}

module.exports = { createSshWorkspaceSurface };
