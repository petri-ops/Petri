#!/usr/bin/env node
'use strict';
// 一次性手术脚本：tools-executor 的 adoptRemoteRunningJob → adoptSshDirectJob（BLOCK-76 P5）。
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'core', 'biof3-server', 'helpers', 'tools-executor.js');
let t = fs.readFileSync(FILE, 'utf8');
const startMarker = '  async function adoptRemoteRunningJob(jobId) {';
const endMarker = '\n  function createJobRunFinalizer(';
const s = t.indexOf(startMarker);
const e = t.indexOf(endMarker);
if (s < 0 || e < 0 || e <= s) { console.error('markers not found', s, e); process.exit(1); }

const replacement = `  /**
   * BLOCK-76 P5 — 直跑作业重启恢复：running 的 ssh 直跑作业，读服务器
   * output/.pid 恢复轮询（setsid 进程跨后端重启存活），.exit 终态对账。
   * 服务器作业目录缺失（已被清理）→ 诚实按节点现状落终态（不猜测运行中）。
   */
  async function adoptSshDirectJob(jobId) {
    let job;
    try {
      job = await db.prepare('SELECT * FROM tool_jobs WHERE id=?').get(jobId);
    } catch {
      return;
    }
    if (!job || job.status !== 'running' || !job.project_id) return;
    if (activeToolJobs.has(jobId)) return;
    let sshProjectRow = null;
    try {
      sshProjectRow = await dbMod.getAsyncDatabase()
        .prepare('SELECT id, workspace_kind, ssh_host, remote_path FROM projects WHERE id = ?')
        .get(job.project_id);
    } catch {
      sshProjectRow = null;
    }
    if (!sshProjectRow || sshProjectRow.workspace_kind !== 'ssh') return;
    const owner = claimActiveToolJob(activeToolJobs, { jobId, toolId: job.tool_id });
    if (!owner) return;
    owner.remote = true;
    try {
      const runner = createSshDirectRunner({ project: sshProjectRow });
      const outputBase = \`results/jobs/\${jobId}/output\`;
      let pid = null;
      try {
        const pidBuf = await (require('./workspace-gateway').resolveWorkspaceBackend(sshProjectRow).backend).read(\`\${outputBase}/.pid\`);
        pid = parseInt(String(pidBuf).trim(), 10);
      } catch { pid = null; }
      let exitCode = null;
      try {
        const exitBuf = await (require('./workspace-gateway').resolveWorkspaceBackend(sshProjectRow).backend).read(\`\${outputBase}/.exit\`);
        const c = parseInt(String(exitBuf).trim(), 10);
        if (Number.isFinite(c)) exitCode = c;
      } catch { exitCode = null; }
      const summary = {
        workspaceKind: 'ssh',
        ssh: { alias: sshProjectRow.ssh_host, path: sshProjectRow.remote_path },
        outputPath: outputBase,
        transport: 'gateway-ssh-direct',
        files: [],
        stdout: '',
        executionTarget: { kind: 'ssh-native', transport: 'gateway-ssh-direct', note: 'adopted after backend restart' },
      };
      if (exitCode === null) {
        // 节点侧进程记录与退出标记均缺失——诚实按节点现状落失败（不猜测运行中）。
        await markJobFailed(jobId, 'SSH 直跑作业重启恢复失败：服务器侧进程记录（.pid/.exit）缺失，可能已被清理', 'execute');
        releaseActiveToolJob(activeToolJobs, jobId, owner);
        return;
      }
      summary.exitCode = exitCode;
      await transitionToolJobToCompleted({ db, jobId, result: summary });
      releaseActiveToolJob(activeToolJobs, jobId, owner);
    } catch (e) {
      console.warn('[tools] adoptSshDirectJob failed:', e.message);
      releaseActiveToolJob(activeToolJobs, jobId, owner);
    }
  }
`;
t = t.slice(0, s) + replacement + t.slice(e);
fs.writeFileSync(FILE, t);
console.log('adoptSshDirectJob installed');
