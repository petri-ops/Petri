'use strict';

/**
 * BLOCK-76 P1 — SSH 直跑执行器（D1：mux 通道直跑，产物留服务器）。
 *
 * 与 remote-job-runner（BLOCK-57 作业机制，P5 拆除对象）的区别：
 *   - 不上传 bundle、不用 agent job-supervisor（start/status/log/manifest）；
 *   - 脚本/参数/输入经 workspace-gateway write 直写服务器项目内
 *     `results/jobs/<jobId>/`（与本地项目结果布局同构，R1 裁决）；
 *   - 执行用 agent `exec_bg`（setsid nohup 后台）+ `ps_pid` 存活轮询，
 *     终态以 jobDir/output/.exit 标记为准（进程退出后必已写入）；
 *   - 取消走进程组（setsid 会话首进程 → `kill -- -pid`，经 gateway exec，
 *     因为 agent kill_pid 不接受负 pid）；
 *   - 日志 tail 用 gateway read(offset)（服务器 run.log 为真值，R4）。
 *
 * 路径纪律：jobRel 恒为相对项目根的 posix 相对路径（result_json 语义面）；
 * 一切 gateway 调用经 safeRemoteJoin(root, rel) 转绝对路径——P1 首跑实测，
 * 相对路径会被 agent 解析到 $HOME（/root/results/jobs/…），绝不可直接传。
 */

const path = require('path');
const { safeRemoteJoin } = require('../workspace-gateway');

const STAGE_ROOT = 'results/jobs';
const EXIT_MARKER = 'output/.exit';
const PID_MARKER = 'output/.pid';
const LOG_REL = 'output/run.log';
// 单个 gateway write 的安全上限（协议硬上限 1MB，留余量给 base64 头部与 JSON 行）。
const DIRECT_WRITE_LIMIT = 768 * 1024;
// 分块追加通道：exec 命令参数上限 256KB，base64 膨胀 4/3 后取 160KB 原始块。
const CHUNK_SIZE = 160 * 1024;

function toPosixRel(...segs) {
  const joined = path.posix.join(...segs.map((s) => String(s).replace(/\\/g, '/')));
  if (joined.startsWith('/') || joined.split('/').includes('..')) {
    throw new Error('ssh_direct_bad_path: ' + joined);
  }
  return joined;
}

function createSshDirectRunner({ project, gateway = null }) {
  if (!project || project.workspace_kind !== 'ssh' || !project.ssh_host || !project.remote_path) {
    throw new Error('ssh_direct_requires_ssh_project');
  }
  let gw = gateway;
  let rootAbs = project.remote_path;
  if (!gw) {
    const { resolveWorkspaceBackend } = require('../workspace-gateway');
    const resolved = resolveWorkspaceBackend(project);
    if (resolved.error || !resolved.backend || resolved.backend.kind !== 'ssh') {
      throw new Error('ssh_direct_backend_unavailable: ' + (resolved.error || 'not_ssh'));
    }
    gw = resolved.backend;
    rootAbs = resolved.root;
  }
  const abs = (rel) => {
    const p = safeRemoteJoin(rootAbs, rel);
    if (!p) throw new Error('ssh_direct_bad_path: ' + rel);
    return p;
  };

  function jobRel(jobId) {
    return toPosixRel(STAGE_ROOT, jobId);
  }

  /**
   * 把本地编排好的 jobDir（run-script.X/params.json/上传输入；排除 output/）
   * 写到服务器 `results/jobs/<jobId>/`。>DIRECT_WRITE_LIMIT 的文件走
   * base64 分块追加通道（exec | base64 -d >> file）。
   */
  async function stage({ jobId, localJobDir }) {
    const rel = jobRel(jobId);
    await gw.mkdir(abs(toPosixRel(rel, 'output')));
    const staged = [];
    const failed = [];
    walkLocal(localJobDir, (absPath, relName) => {
      staged.push({ absPath, relName });
    });
    for (const item of staged) {
      const target = abs(toPosixRel(rel, item.relName));
      const content = require('fs').readFileSync(item.absPath);
      try {
        if (content.length <= DIRECT_WRITE_LIMIT) {
          await gw.write(target, content);
        } else {
          await gw.write(target, content.subarray(0, 0)); // truncate/create
          for (let off = 0; off < content.length; off += CHUNK_SIZE) {
            const chunk = content.subarray(off, Math.min(off + CHUNK_SIZE, content.length));
            const b64 = chunk.toString('base64');
            await gw.exec(`printf %s ${shellQuote(b64)} | base64 -d >> ${shellQuote(target)}`, rootAbs, 60);
          }
        }
      } catch (e) {
        failed.push({ file: item.relName, error: e.message });
      }
    }
    if (failed.length > 0) {
      return { ok: false, stage: 'stage', error: { kind: 'ssh_direct_stage_failed', retryable: true, detail: failed.map((f) => `${f.file}: ${f.error}`).join('; ').slice(0, 300) } };
    }
    return { ok: true, jobRel: rel, stagedCount: staged.length };
  }

  /**
   * 后台直跑：`echo $$ > .pid; <runtimeBin> run-script.<ext> "$(pwd)"; echo $? > .exit`。
   * exec_bg 的 pgrep 在部分节点不可靠（竞态/procps 缺失），pid 以命令自写的
   * .pid 文件为准（exec_bg 的 subshell 实际已 setsid 启动，pid=null ≠ 启动失败）。
   */
  async function start({ jobId, lang, runtimeBin }) {
    const rel = jobRel(jobId);
    const ext = lang === 'r' ? 'R' : 'py';
    const command = `echo $$ > ${PID_MARKER}; ${runtimeBin} run-script.${ext} "$(pwd)"; echo $? > ${EXIT_MARKER}`;
    const started = await gw.execBackground(command, abs(rel), abs(toPosixRel(rel, LOG_REL)));
    let pid = Number.isInteger(started.pid) ? started.pid : null;
    if (!pid) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        pid = parseInt(String(await gw.read(abs(toPosixRel(rel, PID_MARKER)))).trim(), 10);
        if (!Number.isFinite(pid)) pid = null;
      } catch { pid = null; }
    }
    if (!pid) {
      return { ok: false, stage: 'start', error: { kind: 'ssh_direct_spawn_failed', retryable: true, detail: started.error || 'exec_bg 无 pid 且 .pid 标记缺失' } };
    }
    return { ok: true, pid, jobRel: rel };
  }

  /**
   * 轮询：pid 存活 → active；不存活 → 读 .exit 标记 → terminal(code)；
   * 标记缺失（写入窗口）→ unknown（调用方重试，连续 unknown 按诚实失败收敛）。
   */
  async function poll({ jobId, pid }) {
    const rel = jobRel(jobId);
    let alive = null;
    try {
      alive = (await gw.processAlive(pid)).alive;
    } catch {
      return { ok: true, kind: 'unknown' };
    }
    if (alive) return { ok: true, kind: 'active' };
    try {
      const buf = await gw.read(abs(toPosixRel(rel, EXIT_MARKER)));
      const code = parseInt(String(buf).trim(), 10);
      return { ok: true, kind: 'terminal', code: Number.isFinite(code) ? code : null };
    } catch {
      return { ok: true, kind: 'unknown' };
    }
  }

  /** 日志增量：stat 取 size，read(offset) 返回新增字节（服务器 run.log 为真值）。 */
  async function pullLog({ jobId, offset }) {
    const rel = jobRel(jobId);
    const logPath = abs(toPosixRel(rel, LOG_REL));
    let size = 0;
    try {
      size = Number((await gw.stat(logPath)).size || 0);
    } catch {
      return { ok: true, chunk: Buffer.alloc(0), size: 0 };
    }
    if (size <= offset) return { ok: true, chunk: Buffer.alloc(0), size };
    const buf = await gw.read(logPath, { offset });
    return { ok: true, chunk: buf, size };
  }

  /** 取消：setsid 会话组整体 TERM→KILL（agent kill_pid 不接受负 pid，走 gateway exec）。 */
  async function cancel({ pid }) {
    const groupKill = `kill -TERM -- -${Number(pid)} 2>/dev/null; kill -KILL -- -${Number(pid)} 2>/dev/null; true`;
    try { await gw.exec(groupKill, rootAbs, 15); } catch { /* 进程组可能已退出 */ }
    try { await gw.killPid(Number(pid), 'KILL'); } catch { /* 尽力而为 */ }
    return { ok: true };
  }

  /** 远端 output/ 产物清单（name/size，不含子目录展开）。 */
  async function listOutputs({ jobId }) {
    const rel = jobRel(jobId);
    try {
      const entries = await gw.list(abs(toPosixRel(rel, 'output')));
      return {
        ok: true,
        outputs: entries
          .filter((e) => e.type === 'file' && !e.name.startsWith('.'))
          .map((e) => ({ name: e.name, size: Number(e.size || 0) })),
      };
    } catch (e) {
      return { ok: false, error: { kind: 'ssh_direct_list_failed', detail: e.message } };
    }
  }

  return { stage, start, poll, pullLog, cancel, listOutputs, jobRel, kind: 'ssh-direct' };
}

function walkLocal(dir, cb, prefix = '') {
  const fs = require('fs');
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const relName = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === 'output' || entry.name === 'logs') continue; // 编排期产物不带上传面
      walkLocal(path.join(dir, entry.name), cb, relName);
    } else if (entry.isFile()) {
      cb(path.join(dir, entry.name), relName);
    }
  }
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

module.exports = { createSshDirectRunner, STAGE_ROOT, EXIT_MARKER, LOG_REL };
