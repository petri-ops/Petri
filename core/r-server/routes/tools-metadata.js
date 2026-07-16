const express = require('express');
const fs = require('fs');
const path = require('path');
const { reconcileArtifactTruth } = require('../helpers/artifact-truth');
const { publicRecoveryParams } = require('../helpers/harness-workflow-recovery');

function selectArtifactResultDir({ job, result, jobsDir = '' } = {}) {
  const bases = [
    result && result.resultDir,
    result && result.outputDir,
    jobsDir && job && path.join(jobsDir, job.id),
  ].filter(Boolean);
  const candidates = Array.from(new Set(
    bases.flatMap((base) => [path.join(base, 'output'), base]).map((value) => path.resolve(value))
  ));
  const ranked = candidates.map((candidate) => {
    try {
      if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) return null;
      const files = fs.readdirSync(candidate, { withFileTypes: true }).filter((entry) => entry.isFile());
      const score = (files.some((entry) => entry.name === 'manifest.json') ? 1000 : 0) + files.length;
      return { candidate, score, fileCount: files.length };
    } catch {
      return null;
    }
  }).filter(Boolean).sort((a, b) => b.score - a.score);
  return ranked.length > 0 && ranked[0].fileCount > 0 ? ranked[0].candidate : '';
}

function parseJsonMaybe(value, fallback = null) {
  if (!value) return fallback;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}

function expectedArtifactsFor(toolId) {
  try {
    const pluginLoader = require('../plugin-loader');
    const definition = pluginLoader.getToolDefinition(toolId);
    return Array.isArray(definition && definition.outputs) ? definition.outputs : [];
  } catch {
    return [];
  }
}

async function reconcileToolJobArtifacts({ job, db, jobsDir = '' }) {
  const stored = parseJsonMaybe(job && (job.result_json || job.result), null);
  if (!stored || !job) return { result: stored, status: job && job.status, error: job && job.error };
  const resultDir = selectArtifactResultDir({ job, result: stored, jobsDir });
  if (!resultDir) return { result: stored, status: job.status, error: job.error };
  let diskManifest = null;
  try {
    const manifestPath = path.join(resultDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) diskManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {}
  const hydrated = diskManifest
    ? { ...diskManifest, ...stored, manifest: diskManifest }
    : stored;
  const truth = reconcileArtifactTruth({
    result: hydrated,
    resultDir,
    expectedArtifacts: expectedArtifactsFor(job.tool_id),
  });
  const nextStatus = truth.blocking && job.status === 'completed' ? 'failed' : job.status;
  const nextError = truth.blocking
    ? truth.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message).join('; ')
    : job.error;
  const previousSignature = JSON.stringify({
    status: stored.artifactTruth && stored.artifactTruth.status,
    validCount: stored.artifactTruth && stored.artifactTruth.validCount,
    issues: stored.artifactDiagnostics || [],
    artifacts: (stored.artifacts || stored.files || []).map((item) => item && (item.name || item.filename)),
  });
  const nextSignature = JSON.stringify({
    status: truth.artifactTruth.status,
    validCount: truth.artifactTruth.validCount,
    issues: truth.issues,
    artifacts: truth.artifacts.map((item) => item.name),
  });
  if (previousSignature !== nextSignature || nextStatus !== job.status) {
    try {
      if (typeof db.updateToolJob === 'function') {
        await db.updateToolJob(job.id, {
          status: nextStatus,
          error: nextError || null,
          resultJson: truth.result,
        });
      } else {
        await db.prepare('UPDATE tool_jobs SET status=?, error=?, result_json=? WHERE id=?')
          .run(nextStatus, nextError || null, JSON.stringify(truth.result), job.id);
      }
    } catch (error) {
      console.warn('[tools-metadata] artifact truth self-heal failed:', error.message);
    }
  }
  return { result: truth.result, status: nextStatus, error: nextError };
}

function createToolsMetadataRoutes({db, getUserId, jobsDir = ''}) {
  const reconcileStoredResult = (job) => reconcileToolJobArtifacts({ job, db, jobsDir });

  function registerToolsMetadata(app) {
    app.get('/api/tools/status/:id', async (req, res) => {
      const uid = getUserId(req);
      try {
        const job = await db.prepare('SELECT * FROM tool_jobs WHERE id = ?').get(req.params.id);
        if (!job) return res.status(404).json({error: 'not_found'});
        if (job.user_id !== uid && req.user && req.user.role !== 'admin') return res.status(403).json({error: 'forbidden'});
        const reconciled = await reconcileStoredResult(job);
        res.json({
          ok: true,
          id: job.id,
          toolId: job.tool_id,
          status: reconciled.status,
          error: reconciled.error,
          name: job.name,
          projectId: job.project_id,
          params: publicRecoveryParams(parseJsonMaybe(job.params_json, {})),
          recoveryHistory: parseJsonMaybe(job.params_json, {}).__harnessRecovery || [],
          ackStatus: job.ack_status || null,
          createdAt: job.created_at,
          completedAt: job.completed_at,
          result: reconciled.result,
        });
      } catch (e) {
        res.status(500).json({error: e.message});
      }
    });

    // SSE endpoint for real-time job status updates
    app.get('/api/tools/stream/:id', async (req, res) => {
      const uid = getUserId(req);
      try {
        const job = await db.prepare('SELECT * FROM tool_jobs WHERE id = ?').get(req.params.id);
        if (!job) return res.status(404).json({error: 'not_found'});
        if (job.user_id !== uid && req.user && req.user.role !== 'admin') return res.status(403).json({error: 'forbidden'});

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders && res.flushHeaders();

        const initial = await reconcileStoredResult(job);
        res.write('data: ' + JSON.stringify({
          status: initial.status,
          error: initial.error,
          result: initial.result,
        }) + '\n\n');

        if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
          return res.end();
        }

        const interval = setInterval(async () => {
          try {
            const j = await db.prepare('SELECT status, error, result_json FROM tool_jobs WHERE id = ?').get(req.params.id);
            if (!j) {
              res.write('data: ' + JSON.stringify({error: 'not_found'}) + '\n\n');
              clearInterval(interval);
              res.end();
              return;
            }
            const reconciled = await reconcileStoredResult({ ...j, id: req.params.id, tool_id: job.tool_id });
            res.write('data: ' + JSON.stringify({
              status: reconciled.status,
              error: reconciled.error,
              result: reconciled.result,
            }) + '\n\n');
            if (j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled') {
              clearInterval(interval);
              res.end();
            }
          } catch (e) {
            res.write('data: ' + JSON.stringify({error: e.message}) + '\n\n');
            clearInterval(interval);
            res.end();
          }
        }, 1000);

        req.on('close', () => clearInterval(interval));
      } catch (e) {
        res.status(500).json({error: e.message});
      }
    });

    app.get('/api/tools/history', async (req, res) => {
      const uid = getUserId(req);
      if (!uid) return res.status(401).json({error: 'login_required'});
      try {
        const jobs = await db.prepare('SELECT id, tool_id, status, created_at, completed_at, error, name FROM tool_jobs WHERE user_id = ? AND is_test_run = 0 ORDER BY created_at DESC LIMIT 50').all(uid);
        res.json({ok: true, jobs});
      } catch (e) {
        res.status(500).json({error: e.message});
      }
    });

    // 桌面版：返回已装插件的工具定义列表（供前端动态渲染工具卡片）
    // web 版不调用此端点（继续用静态 _data.ts）
    app.get('/api/tools/manifest', async (req, res) => {
      try {
        const pluginLoader = require('../plugin-loader');
        // 每次请求都重新扫盘：插件可能在 r-server 启动后才安装，
        // r-server 是独立子进程，不共享 Electron 主进程的 globalThis._biof3Plugins
        pluginLoader.loadPluginsFromDisk();
        const pluginDefs = pluginLoader.getAllToolDefinitions();
        res.json({ ok: true, tools: pluginDefs, source: 'desktop' });
      } catch (e) {
        // plugin-loader 在 web 版/未启用时可能不可用，返回空列表而非 500
        res.json({ ok: true, tools: [], source: 'desktop', note: 'plugin-loader unavailable' });
      }
    });

    app.put('/api/tools/job/:id/name', express.json(), async (req, res) => {
      const uid = getUserId(req);
      try {
        const job = await db.prepare('SELECT * FROM tool_jobs WHERE id = ?').get(req.params.id);
        if (!job) return res.status(404).json({error: 'not_found'});
        if (job.user_id !== uid && req.user && req.user.role !== 'admin') return res.status(403).json({error: 'forbidden'});
        const newName = (req.body && req.body.name) || '';
        if (!newName.trim()) return res.status(400).json({error: 'empty_name'});
        await db.prepare('UPDATE tool_jobs SET name = ? WHERE id = ?').run(newName.trim(), req.params.id);
        res.json({ok: true, name: newName.trim()});
      } catch (e) {
        res.status(500).json({error: e.message});
      }
    });

    app.put('/api/tools/job/:id/public', express.json(), async (req, res) => {
      if (!req.user || req.user.role !== 'admin') return res.status(403).json({error: 'admin_only'});
      try {
        const job = await db.prepare('SELECT * FROM tool_jobs WHERE id = ?').get(req.params.id);
        if (!job) return res.status(404).json({error: 'not_found'});
        if (job.status !== 'completed') return res.status(400).json({error: 'job_not_completed'});
        const isPublic = req.body && req.body.is_public ? 1 : 0;
        if (isPublic) {
          await db.prepare('UPDATE tool_jobs SET is_public = 0 WHERE tool_id = ? AND is_public = 1').run(job.tool_id);
        }
        await db.prepare('UPDATE tool_jobs SET is_public = ? WHERE id = ?').run(isPublic, req.params.id);
        res.json({ok: true, is_public: isPublic});
      } catch (e) {
        res.status(500).json({error: e.message});
      }
    });
  }

  return registerToolsMetadata;
}

module.exports = {
  createToolsMetadataRoutes,
  reconcileToolJobArtifacts,
  _test: { selectArtifactResultDir },
};
