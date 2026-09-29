const express = require('express');

/**
 * Public tool routes (desktop local execution).
 *
 * Authorize against local tool_jobs, then call execution/asset handlers directly.
 *
 * Routes: run, file GET/PUT, report, cancel, delete, public-demo, public-file,
 * demo, demo-data.
 */
function createToolsPlatformRoutes({
  db,
  jobsDir: jobsDirOverride,
  canAccessToolJob,
  isCancellableJob,
  handleToolRun,
  handlePrivateFileRead,
  handlePrivateFileWrite,
  handleGenerateFinalReport,
  killLocalToolJob,
  cleanupLocalToolJobDir,
  handlePublicDemo,
  handlePublicFile,
  handleDemoData,
  handleLegacyDemoFile,
  handleLegacyDemoList,
}) {
  function registerToolsPlatform(app) {
    app.post('/api/tools/run', express.json({ limit: '200mb' }), async (req, res) => {
      try {
        return await handleToolRun(req, res);
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    });

    app.get('/api/tools/file/:jobId/:filename', async (req, res) => {
      try {
        const job = await db.prepare('SELECT * FROM tool_jobs WHERE id = ?').get(req.params.jobId);
        if (!job) return res.status(404).json({ error: 'not_found' });
        if (!canAccessToolJob(req, job)) return res.status(403).json({ error: 'forbidden' });
        req.toolJob = job;
        return handlePrivateFileRead(req, res);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    app.post('/api/tools/report/:jobId', express.json({ limit: '16kb' }), async (req, res) => {
      try {
        const job = await db.prepare('SELECT * FROM tool_jobs WHERE id = ?').get(req.params.jobId);
        if (!job) return res.status(404).json({ error: 'not_found' });
        if (!canAccessToolJob(req, job)) return res.status(403).json({ error: 'forbidden' });
        req.toolJob = job;
        return handleGenerateFinalReport(req, res);
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    });

    app.post('/api/tools/cancel/:id', express.json(), async (req, res) => {
      try {
        const job = await db.prepare('SELECT * FROM tool_jobs WHERE id = ?').get(req.params.id);
        if (!job) return res.status(404).json({ error: 'not_found' });
        if (!canAccessToolJob(req, job)) return res.status(403).json({ error: 'forbidden' });
        if (!isCancellableJob(job)) return res.json({ ok: true, message: 'already_finished' });
        const local = killLocalToolJob(job.id);
        if (job.status === 'running' && (!local || local.active !== true)) {
          await db
            .prepare('UPDATE tool_jobs SET error=? WHERE id=? AND status=?')
            .run('cancel_owner_unavailable:process_ownership_unproven', job.id, 'running');
          return res.status(409).json({
            ok: false,
            status: job.status,
            error: 'execution_owner_unavailable',
            local,
          });
        }
        if (local && local.termination) {
          const termination = await local.termination;
          local.killed = termination.terminated === true;
          local.terminationResult = termination;
          delete local.termination;
        }
        if (local && local.active && local.processStarted !== false && !local.killed) {
          const reason = local.terminationResult?.reason || 'termination_unconfirmed';
          await db
            .prepare('UPDATE tool_jobs SET error=? WHERE id=? AND status IN (?,?)')
            .run(`cancel_termination_unconfirmed:${reason}`, job.id, 'pending', 'running');
          return res.status(409).json({
            ok: false,
            status: job.status,
            error: 'termination_unconfirmed',
            local,
          });
        }
        const cancelled = await db
          .prepare(
            'UPDATE tool_jobs SET status=?, error=?, completed_at=?, process_pid=?, heartbeat_at=? '
            + 'WHERE id=? AND status IN (?,?,?)',
          )
          .run(
            'cancelled',
            null,
            Date.now(),
            null,
            null,
            job.id,
            'pending',
            'running',
            'cancelled',
          );
        if (!cancelled || cancelled.changes < 1) {
          const current = await db.prepare('SELECT status FROM tool_jobs WHERE id = ?').get(job.id);
          return res.status(409).json({
            ok: false,
            status: current?.status || 'unknown',
            error: 'job_no_longer_cancellable',
            local,
          });
        }
        res.json({ ok: true, status: 'cancelled', local });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // Serve demo result files (legacy static — disabled unless BIOF3_TOOL_DEMO_*_DIR set)
    app.get('/api/tools/demo/:toolId/:filename', (req, res) => {
      return handleLegacyDemoFile(req, res);
    });

    // List demo results for a tool
    app.get('/api/tools/demo/:toolId', (req, res) => {
      return handleLegacyDemoList(req, res);
    });

    // Delete a job record
    app.delete('/api/tools/job/:id', async (req, res) => {
      try {
        const job = await db.prepare('SELECT * FROM tool_jobs WHERE id = ?').get(req.params.id);
        if (!job) return res.status(404).json({ error: 'not_found' });
        if (!canAccessToolJob(req, job)) return res.status(403).json({ error: 'forbidden' });
        // Prevent deleting public demo jobs (unless force=true from admin)
        if (job.is_public && req.query.force !== 'true') {
          return res.status(400).json({
            error: 'cannot_delete_public_demo',
            message:
              '该任务已设为公开 Demo，删除后该工具将失去 Demo 展示。如确认删除请传 ?force=true',
          });
        }
        const localCleanup = cleanupLocalToolJobDir(job.id);
        await db.prepare('DELETE FROM tool_jobs WHERE id = ?').run(req.params.id);
        res.json({ ok: true, localCleanup });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // ---- PL-4b（2026-09-29）结果治理三端点：批量删除 / 存储概览 / 聚合导出 ----

    // 批量删除：仅终态（completed/failed/cancelled/done）可删；公开 demo 拒删（同单删语义）；
    // 目录级联复用 cleanupLocalToolJobDir；逐条结果返回（部分失败不毒化整批）。
    app.post('/api/tools/jobs/batch-delete', express.json({ limit: '64kb' }), async (req, res) => {
      try {
        const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === 'string' && x) : [];
        if (ids.length === 0) return res.status(400).json({ error: 'missing_ids' });
        if (ids.length > 200) return res.status(400).json({ error: 'too_many_ids', message: '单批上限 200' });
        const results = [];
        for (const id of ids) {
          try {
            const job = await db.prepare('SELECT * FROM tool_jobs WHERE id = ?').get(id);
            if (!job) { results.push({ id, ok: false, error: 'not_found' }); continue; }
            if (!canAccessToolJob(req, job)) { results.push({ id, ok: false, error: 'forbidden' }); continue; }
            const { PUBLIC_DEMO_JOB_IDS } = require('../helpers/tools-assets');
            if (job.is_public || PUBLIC_DEMO_JOB_IDS.has(id)) { results.push({ id, ok: false, error: 'cannot_delete_public_demo' }); continue; }
            if (!['completed', 'failed', 'cancelled', 'done'].includes(job.status)) {
              results.push({ id, ok: false, error: 'job_not_terminal', status: job.status });
              continue;
            }
            const localCleanup = cleanupLocalToolJobDir(id);
            await db.prepare('DELETE FROM tool_jobs WHERE id = ?').run(id);
            results.push({ id, ok: true, localCleanup });
          } catch (e) {
            results.push({ id, ok: false, error: e.message });
          }
        }
        const deleted = results.filter((r) => r.ok).length;
        res.json({ ok: true, deleted, results });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // 存储概览：jobsDir 一次 walk（目录数/字节数，有界——目录数截 500）+ 行数统计
    app.get('/api/tools/storage-summary', async (req, res) => {
      try {
        const fsMod = require('node:fs');
        const pathMod = require('node:path');
        const osMod = require('node:os');
        // config-helper 导出 Proxy（字段访问直通 getConfig()，无 {config} 具名导出）
        const config = require('../../shared-backend/config-helper');
        const jobsDir = jobsDirOverride || pathMod.join(
          config.localResultsDir || pathMod.join(osMod.homedir(), 'Documents', 'BioF3-Local', 'results'),
          'tool-jobs',
        );
        let jobDirs = 0;
        let bytes = 0;
        let truncated = false;
        try {
          const entries = fsMod.readdirSync(jobsDir, { withFileTypes: true });
          for (const entry of entries.slice(0, 500)) {
            if (!entry.isDirectory()) continue;
            jobDirs += 1;
            try {
              const dirPath = pathMod.join(jobsDir, entry.name);
              for (const f of fsMod.readdirSync(dirPath)) {
                try { bytes += fsMod.statSync(pathMod.join(dirPath, f)).size; } catch { /* 单文件失败跳过 */ }
              }
            } catch { /* 单目录失败跳过 */ }
          }
          if (entries.length > 500) truncated = true;
        } catch { /* jobsDir 不存在=空概览 */ }
        const counts = await db.prepare(
          "SELECT status, COUNT(*) n FROM tool_jobs GROUP BY status",
        ).all();
        res.json({
          ok: true,
          jobsDir,
          disk: { jobDirs, bytes, truncated },
          rows: Object.fromEntries(counts.map((r) => [r.status, r.n])),
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // 聚合导出：所选终态 job 的 job 目录打包单 zip 流式下载（archiver 仓内既有依赖）。
    app.post('/api/tools/jobs/export', express.json({ limit: '64kb' }), async (req, res) => {
      try {
        const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === 'string' && x) : [];
        if (ids.length === 0) return res.status(400).json({ error: 'missing_ids' });
        if (ids.length > 50) return res.status(400).json({ error: 'too_many_ids', message: '导出单批上限 50' });
        const fsMod = require('node:fs');
        const pathMod = require('node:path');
        const osMod = require('node:os');
        // config-helper 导出 Proxy（字段访问直通 getConfig()，无 {config} 具名导出）
        const config = require('../../shared-backend/config-helper');
        const jobsDir = jobsDirOverride || pathMod.join(
          config.localResultsDir || pathMod.join(osMod.homedir(), 'Documents', 'BioF3-Local', 'results'),
          'tool-jobs',
        );
        const { ZipArchive } = await import('archiver');
        const archive = new ZipArchive({ zlib: { level: 6 } });
        res.setHeader('content-type', 'application/zip');
        res.setHeader('content-disposition', `attachment; filename="gewu-results-${Date.now()}.zip"`);
        archive.on('warning', () => { /* archiver 警告不中断 */ });
        archive.on('error', () => { if (!res.headersSent) res.status(500).end(); else res.end(); });
        archive.pipe(res);
        let packed = 0;
        for (const id of ids) {
          const job = await db.prepare('SELECT * FROM tool_jobs WHERE id = ?').get(id);
          if (!job || !canAccessToolJob(req, job)) continue;
          const dir = pathMod.join(jobsDir, id);
          if (!fsMod.existsSync(dir)) continue;
          for (const entry of fsMod.readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isFile()) continue;
            archive.file(pathMod.join(dir, entry.name), { name: `${id}/${entry.name}` });
            packed += 1;
          }
        }
        if (packed === 0 && !res.headersSent) {
          // 无可打包内容：以空 zip 正常收尾（诚实空导出而非 500）
        }
        await archive.finalize();
      } catch (e) {
        if (!res.headersSent) res.status(500).json({ error: e.message });
        else res.end();
      }
    });

    // Serve demo INPUT data (legacy static)
    app.get('/api/tools/demo-data/:toolId/:filename', (req, res) => {
      return handleDemoData(req, res);
    });

    app.get('/api/tools/public-demo/:toolId', async (req, res) => {
      return handlePublicDemo(req, res);
    });

    app.get('/api/tools/public-file/:jobId/:filename', (req, res) => {
      return handlePublicFile(req, res);
    });

    // Replace a job output file (e.g., after user edits a plot in FigCode)
    app.put(
      '/api/tools/file/:jobId/:filename',
      express.raw({ type: '*/*', limit: '10mb' }),
      async (req, res) => {
        try {
          const job = await db.prepare('SELECT * FROM tool_jobs WHERE id = ?').get(req.params.jobId);
          if (!job) return res.status(404).json({ error: 'not_found' });
          if (!canAccessToolJob(req, job)) return res.status(403).json({ error: 'forbidden' });
          return handlePrivateFileWrite(req, res, job.tool_id);
        } catch (e) {
          res.status(500).json({ error: e.message });
        }
      }
    );
  }

  return registerToolsPlatform;
}

module.exports = { createToolsPlatformRoutes };
