const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  STAGED_INPUT_EXCLUSION_POLICY,
  reconcileArtifactTruth,
} = require('../helpers/artifact-truth');
const { publicRecoveryParams } = require('../helpers/harness-workflow-recovery');
const { resolveProjectRunLayout } = require('../../shared-backend/project-run-layout');

function selectArtifactResultDir({ job, result, jobsDir = '' } = {}) {
  const persistedResultDir = result?.artifactTruth?.resultDir;
  if (persistedResultDir) {
    try {
      const persisted = path.resolve(persistedResultDir);
      if (fs.existsSync(persisted) && fs.statSync(persisted).isDirectory()) return persisted;
    } catch {}
  }
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
      const score = (files.some((entry) =>
        entry.name === 'manifest.json' || entry.name === 'artifact-manifest.json'
      ) ? 1000 : 0) + files.length;
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
  const hasPersistedInputExclusions =
    stored.artifactTruth?.exclusionPolicy === STAGED_INPUT_EXCLUSION_POLICY
      && Array.isArray(stored.artifactTruth.excludedInputNames);
  const exclusionRootMatches = hasPersistedInputExclusions
    && typeof stored.artifactTruth.resultDir === 'string'
    && path.resolve(stored.artifactTruth.resultDir) === path.resolve(resultDir);
  const trustedExcludedArtifactNames = exclusionRootMatches
      ? stored.artifactTruth.excludedInputNames
      : [];
  const integrityRootMatches = typeof stored.artifactTruth?.resultDir === 'string'
    && path.resolve(stored.artifactTruth.resultDir) === path.resolve(resultDir)
    && ['verified', 'mutated'].includes(stored.artifactTruth.stagedInputIntegrity)
    && Number.isInteger(stored.artifactTruth.stagedInputSnapshotCount)
    && stored.artifactTruth.stagedInputSnapshotCount >= 0;
  let truth = reconcileArtifactTruth({
    result: hydrated,
    resultDir,
    expectedArtifacts: expectedArtifactsFor(job.tool_id),
    trustedExcludedArtifactNames,
    trustedStagedInputVerification: integrityRootMatches
      ? {
          integrity: stored.artifactTruth.stagedInputIntegrity,
          snapshotCount: stored.artifactTruth.stagedInputSnapshotCount,
        }
      : null,
  });
  if (hasPersistedInputExclusions && !exclusionRootMatches) {
    const driftIssue = {
      code: 'artifact_truth_result_dir_drift',
      severity: 'error',
      recoverable: true,
      required: true,
      artifactId: null,
      artifactName: null,
      message: 'Artifact Truth result directory changed; staged-input exclusions cannot be reused across roots.',
      suggestedFix: '恢复原结果目录，或从受信执行路径重新运行该任务。',
    };
    const issues = [...truth.issues, driftIssue];
    const artifactTruth = {
      ...truth.artifactTruth,
      status: 'blocked',
      blocking: true,
      issueCount: issues.length,
    };
    truth = {
      ...truth,
      blocking: true,
      issues,
      artifactTruth,
      result: { ...truth.result, artifactTruth, artifactDiagnostics: issues },
    };
  }
  const nextStatus = truth.blocking && job.status === 'completed' ? 'failed' : job.status;
  const nextError = truth.blocking
    ? truth.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message).join('; ')
    : job.error;
  const previousSignature = JSON.stringify({
    status: stored.artifactTruth && stored.artifactTruth.status,
    validCount: stored.artifactTruth && stored.artifactTruth.validCount,
    resultDir: stored.artifactTruth && stored.artifactTruth.resultDir,
    exclusionPolicy: stored.artifactTruth && stored.artifactTruth.exclusionPolicy,
    excludedInputNames: stored.artifactTruth && stored.artifactTruth.excludedInputNames,
    stagedInputIntegrity: stored.artifactTruth && stored.artifactTruth.stagedInputIntegrity,
    stagedInputSnapshotCount: stored.artifactTruth && stored.artifactTruth.stagedInputSnapshotCount,
    issues: stored.artifactDiagnostics || [],
    artifacts: (stored.artifacts || stored.files || []).map((item) => item && (item.name || item.filename)),
  });
  const nextSignature = JSON.stringify({
    status: truth.artifactTruth.status,
    validCount: truth.artifactTruth.validCount,
    resultDir: truth.artifactTruth.resultDir,
    exclusionPolicy: truth.artifactTruth.exclusionPolicy,
    excludedInputNames: truth.artifactTruth.excludedInputNames,
    stagedInputIntegrity: truth.artifactTruth.stagedInputIntegrity,
    stagedInputSnapshotCount: truth.artifactTruth.stagedInputSnapshotCount,
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
        // BLOCK-57：远程目标徽章数据源（alias 便于直接上屏）
        let executionTarget = null;
        if (job.execution_target_id) {
          try {
            const targetRow = await db.prepare('SELECT id, alias FROM execution_targets WHERE id = ?').get(job.execution_target_id);
            executionTarget = targetRow ? { id: targetRow.id, alias: targetRow.alias } : null;
          } catch { executionTarget = null; }
        }
        res.json({
          ok: true,
          id: job.id,
          toolId: job.tool_id,
          status: reconciled.status,
          error: reconciled.error,
          name: job.name,
          projectId: job.project_id || null,
          conversationId: job.conversation_id || null,
          executionTarget,
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

    // BLOCK-64 P1-b：作业日志只读端点（指挥中心「查日志」动作数据源）。
    // 真相分层：remote-runner.log = 远程作业实时镜像（run 中即存在）；
    // run.log = finalize 时统一落盘的 STDOUT/STDERR/EXIT 汇总（本地作业
    // 运行中不存在 → 诚实返回 no_log_yet，不虚构内容）。
    app.get('/api/tools/log/:id', async (req, res) => {
      const uid = getUserId(req);
      try {
        const job = await db.prepare('SELECT * FROM tool_jobs WHERE id = ?').get(req.params.id);
        if (!job) return res.status(404).json({error: 'not_found'});
        if (job.user_id !== uid && req.user && req.user.role !== 'admin') return res.status(403).json({error: 'forbidden'});
        const dirs = [];
        if (job.project_id) {
          try {
            const layout = resolveProjectRunLayout({ projectId: job.project_id, toolJobId: job.id, db, skipPermissionCheck: true, ensureDirs: false });
            if (layout && layout.outputDir) dirs.push(layout.outputDir);
          } catch { /* 布局解析失败时继续走全局目录 */ }
        }
        dirs.push(path.join(jobsDir, job.id, 'output'));
        const LOG_TAIL_BYTES = 32 * 1024;
        const pick = (name) => {
          for (const dir of dirs) {
            const p = path.join(dir, name);
            try {
              if (!fs.existsSync(p)) continue;
              const buf = fs.readFileSync(p);
              const truncated = buf.length > LOG_TAIL_BYTES;
              return { source: name, live: name === 'remote-runner.log', truncated, log: (truncated ? '…（仅显示末尾 32KB）\n' : '') + buf.subarray(Math.max(0, buf.length - LOG_TAIL_BYTES)).toString('utf8') };
            } catch { continue; }
          }
          return null;
        };
        const found = pick('remote-runner.log') || pick('run.log');
        if (!found) {
          const running = job.status === 'running' || job.status === 'pending';
          return res.json({ ok: true, source: null, live: false, log: '', note: running ? '作业运行中，日志将在结束时写入 run.log' : '该作业没有可用日志文件' });
        }
        res.json({ ok: true, ...found });
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
        const jobs = await db.prepare('SELECT id, tool_id, status, created_at, completed_at, error, name, project_id, conversation_id, execution_target_id FROM tool_jobs WHERE user_id = ? AND is_test_run = 0 ORDER BY created_at DESC LIMIT 50').all(uid);
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
        // 每次请求都重新扫盘：插件可能在 biof3-server 启动后才安装，
        // biof3-server 是独立子进程，不共享 Electron 主进程的 globalThis._biof3Plugins
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
