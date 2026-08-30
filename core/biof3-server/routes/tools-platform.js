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
