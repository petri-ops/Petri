/**
 * tools-router.js (W2-A, 2026-05-28)
 *
 * py-server 上的 /api/tools/* 端点 — 与 r-server 的 /api/tools/* 接口对齐，
 * 让前端 `getApiPrefix('python')` + `Authorization: Bearer <JWT>` 工作。
 *
 * 关键设计：
 * - JWT 共用 r-server 的 JWT_SECRET（来自 /etc/biof3.env）
 * - tool_jobs 表写入 r-server 的 biof3.db（跨进程，better-sqlite3 + WAL 安全）
 * - 输出文件路径与 r-server 完全一致：/mnt/storage_16tb/omichub/biof3-tool-jobs/{jobId}/output/
 * - 容器内访问路径：/app/data/biof3-tool-jobs/{jobId}（共享 volume mount）
 *
 * 与 r-server `routes/tools.js` 的差异：
 * - 只处理 `lang: 'python'` 的工具
 * - tool_id → task type 映射通过 toolRegistry 提供
 * - 容器是 biof3_python_1（不是 omichub_react_backend_1）
 */

const _express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const config = require('./config');
const logger = require('./logger');
const rdb = require('./r-server-db');
const { jwtAuthRequired, jwtAuthOptional } = require('./jwt-auth');
const {
  resolveProjectRunLayout,
  isPathContained,
} = require('../shared-backend/project-run-layout');

// 本地路径（可配）：结果落 BioF3-Local/results/tool-jobs
const JOBS_DIR = config.localResultsDir
  ? require('path').join(config.localResultsDir, 'tool-jobs')
  : require('path').join(require('os').homedir(), 'Documents', 'BioF3-Local', 'results', 'tool-jobs');
// W4-B (2026-05-29): 取消 hard wall-clock timeout（与 task-queue / r-server task-manager 的
// W4-A "取消 task hard timeout" 决策对齐）。科学计算（Tangram CPU 训练 / cell2location /
// LIANA permutation）合理时长不该被 10 分钟墙钟倒逼妥协 —— 之前 spatial-deconv 在 epoch ~100
// 被 10min timeout 砍断，产出空结果却被误标 completed。容器自身的 8g/4cpu/2000pids 限制 +
// pm2 已防失控进程。保留 PY_TOOL_TIMEOUT_MS env override 给 CI / 特殊场景。
const TOOL_TIMEOUT_MS = parseInt(process.env.PY_TOOL_TIMEOUT_MS || '0', 10) || undefined;

try {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
} catch {}

// Published demo assets are immutable job output directories on the Dell
// compute volume. They remain available even if tool_jobs loses is_public rows.
const PUBLIC_DEMO_ASSETS = Object.freeze({
  'spatial-deconv': 'job_a9701b22bc144c34',
  'spatial-lr': 'job_b53a8136d7584d5d',
  'spatial-standard': 'job_1d8b2aff0ddd46cd',
  'spatial-svg': 'job_bfa695b75eff4663',
});
const PUBLIC_DEMO_JOB_IDS = new Set(Object.values(PUBLIC_DEMO_ASSETS));

// Path-traversal guard: join user-supplied segments under baseDir and verify the
// resolved path stays inside baseDir. Returns null if it escapes (e.g. '../').
function safeJoinUnder(baseDir, ...segments) {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, ...segments);
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

// Phase 2 (project-result-sandbox): resolve the physical run layout for a NEW job.
//   - With projectId: results land in <workspace>/results/jobs/<jobId> (the project
//     sandbox). The client only submits projectId; the path is resolved server-side.
//   - Without projectId: fall back to the global JOBS_DIR (legacy / back-compat).
// 本地执行：容器路径即宿主路径，解析出的目录直接使用。
function resolveRunLayout({ jobId, projectId, userId }) {
  if (projectId) {
    const layout = resolveProjectRunLayout({
      projectId,
      toolJobId: jobId,
      db: rdb,
      userId: userId || null,
      skipPermissionCheck: false,
      ensureDirs: true,
    });
    return {
      jobDir: layout.jobRoot,
      outputDir: layout.outputDir,
      containerJobDir: layout.jobRoot,
      containerOutputDir: `${layout.jobRoot}/output`,
    };
  }
  const jobDir = path.join(JOBS_DIR, jobId);
  return {
    jobDir,
    outputDir: path.join(jobDir, 'output'),
    containerJobDir: jobDir,
    containerOutputDir: `${jobDir}/output`,
  };
}

// Phase 2: resolve an EXISTING job's physical dir for read/cleanup, with three-tier
// fallback: (1) project sandbox, (2) global JOBS_DIR, (3) legacy result_json paths.
// Never migrates data — legacy jobs keep reading from their persisted location.
function resolveExistingJobDir(job) {
  // 1. Project sandbox
  if (job && job.project_id) {
    try {
      const layout = resolveProjectRunLayout({
        projectId: job.project_id,
        toolJobId: job.id,
        db: rdb,
        skipPermissionCheck: true,
        ensureDirs: false,
      });
      if (fs.existsSync(layout.jobRoot)) return layout.jobRoot;
    } catch (e) {
      logger.warn(`[tools] project layout resolution failed for job ${job && job.id}: ${e.message}`);
    }
  }
  // 2. Global JOBS_DIR
  const globalDir = safeJoinUnder(JOBS_DIR, job.id);
  if (globalDir && fs.existsSync(globalDir)) return globalDir;
  // 3. Legacy result_json outputDir/resultDir (parent is the jobDir)
  try {
    const result = job && job.result_json
      ? (typeof job.result_json === 'string' ? JSON.parse(job.result_json) : job.result_json)
      : null;
    const legacyOutput = result && (result.outputDir || result.resultDir);
    if (legacyOutput && fs.existsSync(legacyOutput)) return path.dirname(legacyOutput);
  } catch {}
  return globalDir || null;
}

// Phase 2: resolve an existing job's output dir (where served files live), with the
// same three-tier fallback used by resolveExistingJobDir.
function resolveExistingJobOutputDir(job) {
  if (job && job.project_id) {
    try {
      const layout = resolveProjectRunLayout({
        projectId: job.project_id,
        toolJobId: job.id,
        db: rdb,
        skipPermissionCheck: true,
        ensureDirs: false,
      });
      if (fs.existsSync(layout.outputDir)) return layout.outputDir;
    } catch (e) {
      logger.warn(`[tools] project output resolution failed for job ${job && job.id}: ${e.message}`);
    }
  }
  const globalOutput = safeJoinUnder(JOBS_DIR, job.id, 'output');
  if (globalOutput && fs.existsSync(globalOutput)) return globalOutput;
  try {
    const result = job && job.result_json
      ? (typeof job.result_json === 'string' ? JSON.parse(job.result_json) : job.result_json)
      : null;
    const legacyOutput = result && (result.outputDir || result.resultDir);
    if (legacyOutput && fs.existsSync(legacyOutput)) return legacyOutput;
  } catch {}
  return globalOutput || null;
}

// Phase 2: safely resolve a served file inside a job's output dir, verifying the
// resolved path stays contained within that output dir (path-traversal guard).
function resolveJobFilePath(job, filename) {
  const outputDir = resolveExistingJobOutputDir(job);
  if (!outputDir) return null;
  const target = path.resolve(outputDir, filename);
  return isPathContained(outputDir, target) ? target : null;
}

function detectOutputType(name) {
  if (/\.(png|jpg|jpeg|gif|svg)$/i.test(name)) return 'plot';
  if (/\.(csv|tsv)$/i.test(name)) return 'table';
  if (/\.txt$/i.test(name)) return 'text';
  return 'file';
}

function filesForPublicJob(jobId, result) {
  return (result.files || []).map((f) => ({
    ...f,
    url: '/tools/public-file/' + jobId + '/' + f.name,
  }));
}

function readPublicDemoAsset(toolId) {
  const jobId = PUBLIC_DEMO_ASSETS[toolId];
  if (!jobId) return null;
  const outputDir = safeJoinUnder(JOBS_DIR, jobId, 'output');
  if (!outputDir || !fs.existsSync(outputDir)) return null;

  let result = null;
  const manifestPath = path.join(outputDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      result = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {}
  }
  if (!result || !Array.isArray(result.files)) {
    const files = fs.readdirSync(outputDir).filter((name) => name !== 'manifest.json');
    result = { files: files.map((name) => ({ name, type: detectOutputType(name) })) };
  }
  return { jobId, result, files: filesForPublicJob(jobId, result) };
}

// ============================================================
// Tool registry — toolId → task type + display name
// 与 r-server tool-registry.js 中 lang='python' 的工具对应
// ============================================================
const PY_TOOL_REGISTRY = {
  'spatial-standard': {
    taskType: 'spatial_standard',
    displayName: 'Spatial Standard',
    sizeLimitMB: 500,
  },
  // 占位（Wave 4 实现）
  'spatial-svg': { taskType: 'spatial_svg', displayName: 'Spatial SVG', sizeLimitMB: 500 },
  'spatial-deconv': { taskType: 'spatial_deconv', displayName: 'Spatial Deconv', sizeLimitMB: 500 },
  'spatial-lr': { taskType: 'spatial_lr', displayName: 'Spatial LR', sizeLimitMB: 500 },
  // 多组学 placeholder（与 r-server tool-registry.js 对齐）
  'mo-multivi': { taskType: 'mo_multivi', displayName: 'MultiVI', sizeLimitMB: 500 },
  'mo-citeseq': { taskType: 'mo_citeseq', displayName: 'CITE-seq WNN', sizeLimitMB: 500 },
  // ML 已有 task type
  'ml-autoencoder': {
    taskType: 'ml_autoencoder',
    displayName: 'Autoencoder 表征',
    sizeLimitMB: 200,
  },
  'ml-scvi-annotate': {
    taskType: 'scvi_annotation',
    displayName: 'scVI 自动注释',
    sizeLimitMB: 500,
  },
};

function getToolMeta(toolId) {
  return PY_TOOL_REGISTRY[toolId] || null;
}

// ============================================================
// Job execution
// Mirrors r-server/routes/tools.js executeJob, but:
// - container = biof3_python_1
// - script generated dynamically by task-scripts.js (passes via stdin)
// - manifest.json output expected (same as r-server convention)
// ============================================================

function executeJob({ jobId, toolId, taskType, params, layout }) {
  rdb.updateToolJobStatus(jobId, { status: 'running' });

  // Phase 2: use the pre-resolved run layout (project sandbox or legacy global).
  // Fall back to the global JOBS_DIR layout if none was provided (defensive).
  const runLayout = layout || resolveRunLayout({ jobId });
  const jobDir = runLayout.jobDir;
  const outputDir = runLayout.outputDir;
  try {
    fs.mkdirSync(outputDir, { recursive: true, mode: 0o1777 });
  } catch {}

  // W2 (2026-05-28): 复制报告模板到 jobDir（与 r-server routes/tools.js 行为一致）
  // 模板路径：/opt/biof3-r-server/tool-scripts/{toolId}-report-template.html
  // 容器内 mount 路径：模板放在 jobDir，Python 脚本读 ../report-template.html
  const reportTemplateSrc = `/opt/biof3-r-server/tool-scripts/${toolId}-report-template.html`;
  if (fs.existsSync(reportTemplateSrc)) {
    try {
      fs.copyFileSync(reportTemplateSrc, path.join(jobDir, 'report-template.html'));
    } catch (e) {
      logger.warn(`[tools] Failed to copy report template for ${toolId}: ${e.message}`);
    }
  }

  const containerJobDir = runLayout.containerJobDir;
  const containerOutputDir = runLayout.containerOutputDir;

  let pyScript;
  try {
    const { generatePyScript } = require('./task-scripts');
    pyScript = generatePyScript({
      type: taskType,
      params: params || {},
      ossInputUrl: null, // tools 是 base64 上传，不走 OSS
      containerWorkDir: containerOutputDir, // 输出直接写到 jobDir/output
    });
  } catch (e) {
    return markJobFailed(jobId, 'Script generation failed: ' + e.message);
  }

  // Write script to host-side path (visible inside container at containerJobDir/run-script.py)
  const scriptHostPath = path.join(jobDir, 'run-script.py');
  try {
    fs.writeFileSync(scriptHostPath, pyScript);
  } catch (e) {
    return markJobFailed(jobId, 'Script write failed: ' + e.message);
  }

  const containerScriptPath = `${containerJobDir}/run-script.py`;

  logger.info(`[tools] Executing python job`, { jobId, toolId, taskType });

  // 本地执行：直接调内嵌 python
  const { getExecutor } = require('../shared-backend/executors');
  const executor = getExecutor('python');
  const spawnCmd = executor.buildSpawnCommand(containerScriptPath, jobDir, {});
  const execCmd = spawnCmd.cmd;
  const execArgs = spawnCmd.args;

  execFile(
    execCmd,
    execArgs,
    {
      timeout: TOOL_TIMEOUT_MS,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    },
    (err, stdout, stderr) => {
      // Always save run.log for forensics
      try {
        const log = `=== STDOUT ===\n${stdout || ''}\n\n=== STDERR ===\n${stderr || ''}\n\n=== EXIT ===\n${err ? 'ERROR: ' + err.message : 'OK'}\nTimestamp: ${new Date().toISOString()}\n`;
        fs.writeFileSync(path.join(outputDir, 'run.log'), log);
      } catch {}

      if (err) {
        const msg = err.killed
          ? `执行超时或被终止（${TOOL_TIMEOUT_MS ? TOOL_TIMEOUT_MS / 60000 + ' 分钟' : '进程被杀，可能 OOM / 资源超限'}）`
          : stderr || err.message;
        return markJobFailed(jobId, msg);
      }

      // Read manifest.json or auto-detect
      const manifestPath = path.join(outputDir, 'manifest.json');
      let result = {};
      if (fs.existsSync(manifestPath)) {
        try {
          result = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        } catch {}
      } else {
        // Auto-detect: scan outputDir, classify by extension
        const files = fs.readdirSync(outputDir);
        result.files = files.map((f) => ({
          name: f,
          type:
            f.endsWith('.png') || f.endsWith('.svg') || f.endsWith('.pdf')
              ? 'plot'
              : f.endsWith('.csv') || f.endsWith('.tsv')
                ? 'table'
                : 'file',
          // W2.1 (2026-05-28): URL 不带 /api/ 前缀（与 r-server routes/tools.js 行为一致），
          // 前端的 getApiPrefix('python') 会拼上 /api/py
          url: '/tools/file/' + jobId + '/' + f,
        }));
      }

      // W4-B (2026-05-29): 完整性守卫 —— 脚本必须输出 TASK_COMPLETE 哨兵 + 至少 1 张图。
      // 防止"进程 exit 0 但脚本中途静默退出（无 manifest / 无图）却被误标 completed"
      // （spatial-deconv 被 10min timeout 砍断时就是这样：output 只剩 input.h5ad + progress.json）。
      const sawComplete = typeof stdout === 'string' && stdout.includes('TASK_COMPLETE');
      const hasPlot = Array.isArray(result.files) && result.files.some((f) => f.type === 'plot');
      if (!sawComplete || !hasPlot) {
        const tailErr = (stderr || stdout || '').slice(-1500);
        return markJobFailed(
          jobId,
          `脚本未正常完成（缺 TASK_COMPLETE 哨兵或无图输出）。可能中途崩溃 / 被资源限制终止。\n--- 输出尾部 ---\n${tailErr}`
        );
      }

      // 规范 manifest 里的 file URLs（与 r-server 一致：不带 /api/ 前缀）
      if (Array.isArray(result.files)) {
        result.files = result.files.map((f) => {
          let url = f.url;
          if (!url) {
            url = `/tools/file/${jobId}/${f.name}`;
          } else if (url.startsWith('/api/tools/')) {
            // 兼容老 manifest 格式（带 /api/ 前缀），strip 之
            url = url.replace(/^\/api\//, '/');
          }
          return { ...f, url };
        });
      }

      rdb.updateToolJobStatus(jobId, {
        status: 'completed',
        resultJson: result,
        completedAt: Date.now(),
      });
      logger.info(`[tools] Job ${jobId} completed`);
    }
  );
}

function markJobFailed(jobId, errorMsg) {
  const raw = String(errorMsg || '');
  const errStr =
    raw.length <= 3000
      ? raw
      : raw.slice(0, 1200) +
        '\n\n... [truncated ' +
        (raw.length - 2400) +
        ' chars] ...\n\n' +
        raw.slice(-1200);
  rdb.updateToolJobStatus(jobId, {
    status: 'failed',
    error: errStr,
    completedAt: Date.now(),
  });
  logger.warn(`[tools] Job ${jobId} failed: ${errStr.slice(0, 200)}`);
}

// ============================================================
// Routes
// ============================================================

function registerToolsRoutes(app) {
  // POST /api/tools/run — submit a Python tool job
  app.post('/api/tools/run', jwtAuthRequired, (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ ok: false, error: 'login_required' });
    const { toolId, params, files, projectId } = req.body || {};
    if (!toolId) return res.status(400).json({ ok: false, error: 'missing_tool_id' });
    const meta = getToolMeta(toolId);
    if (!meta)
      return res
        .status(400)
        .json({ ok: false, error: 'unknown_tool', message: `Unknown python tool: ${toolId}` });

    // Concurrency check: max 2 running jobs per user (matches r-server policy)
    const running = rdb.countRunningJobsByUser(userId);
    if (running >= 2) {
      return res
        .status(429)
        .json({
          ok: false,
          error: 'max_concurrent',
          message: '最多同时运行 2 个分析任务，请等待当前任务完成',
        });
    }

    const jobId = 'job_' + uuidv4().replace(/-/g, '').slice(0, 16);

    // Phase 2 (project-result-sandbox): resolve the run layout. With projectId the
    // results land in the project workspace sandbox; without it we fall back to the
    // global JOBS_DIR. The client only submits projectId — never a trusted path.
    let runLayout;
    try {
      runLayout = resolveRunLayout({ jobId, projectId, userId });
    } catch (e) {
      logger.warn(`[tools] Failed to resolve project layout: ${e.message}`);
      return res.status(400).json({ ok: false, error: 'project_layout_failed', message: e.message });
    }
    const jobDir = runLayout.jobDir;
    try {
      fs.mkdirSync(jobDir, { recursive: true, mode: 0o1777 });
    } catch {}
    try {
      fs.writeFileSync(path.join(jobDir, 'params.json'), JSON.stringify(params || {}));
    } catch {}

    // Save uploaded files (base64 from frontend) into job dir
    if (files && typeof files === 'object') {
      for (const [key, fileData] of Object.entries(files)) {
        if (fileData && typeof fileData === 'string') {
          try {
            fs.writeFileSync(path.join(jobDir, key), Buffer.from(fileData, 'base64'));
          } catch (e) {
            logger.warn(`[tools] Failed to save file ${key}: ${e.message}`);
          }
        }
      }
    }

    // Auto-name: 工具名 #N
    const _existCount = require('./r-server-db'); // already imported as rdb
    const cnt = (function () {
      try {
        const r = rdb.listToolJobsByUser(userId, { limit: 200, includeTestRuns: true });
        return (r || []).filter((j) => j.tool_id === toolId).length;
      } catch {
        return 0;
      }
    })();
    const jobName = `${meta.displayName} #${cnt + 1}`;

    rdb.insertToolJob({
      jobId,
      userId,
      toolId,
      params: params || {},
      name: jobName,
      isTestRun: false,
      projectId: projectId || null,
    });

    // Async exec
    setImmediate(() => executeJob({ jobId, toolId, taskType: meta.taskType, params, layout: runLayout }));

    logger.info(`[tools] Job submitted`, { jobId, toolId, userId });
    res.json({ ok: true, jobId, status: 'pending' });
  });

  // GET /api/tools/status/:id
  app.get('/api/tools/status/:id', jwtAuthRequired, (req, res) => {
    const userId = req.user && req.user.id;
    const job = rdb.getToolJob(req.params.id);
    if (!job) return res.status(404).json({ ok: false, error: 'not_found' });
    if (job.user_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    res.json({
      ok: true,
      id: job.id,
      toolId: job.tool_id,
      status: job.status,
      error: job.error,
      createdAt: job.created_at,
      completedAt: job.completed_at,
      result: job.result_json ? JSON.parse(job.result_json) : null,
    });
  });

  // GET /api/tools/file/:jobId/:filename — serve user's output files
  app.get('/api/tools/file/:jobId/:filename', jwtAuthOptional, (req, res) => {
    const job = rdb.getToolJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'not_found' });
    const userId = req.user && req.user.id;
    // Allow: owner / admin / public demo
    const isOwner = userId && job.user_id === userId;
    const isAdmin = req.user && req.user.role === 'admin';
    const isPublic = job.is_public === 1;
    if (!isOwner && !isAdmin && !isPublic) return res.status(403).json({ error: 'forbidden' });
    // Phase 2: resolve via project sandbox → global → legacy fallback.
    const filePath = resolveJobFilePath(job, req.params.filename);
    if (!filePath) return res.status(400).json({ error: 'bad_path' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file_not_found' });
    res.sendFile(filePath);
  });

  // GET /api/tools/history — user's recent jobs
  app.get('/api/tools/history', jwtAuthRequired, (req, res) => {
    const userId = req.user && req.user.id;
    const jobs = rdb.listToolJobsByUser(userId, { limit: 50 });
    res.json({ ok: true, jobs });
  });

  // DELETE /api/tools/job/:id
  app.delete('/api/tools/job/:id', jwtAuthRequired, (req, res) => {
    const userId = req.user && req.user.id;
    const job = rdb.getToolJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'not_found' });
    if (job.user_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' });
    }
    if (job.is_public && req.query.force !== 'true') {
      return res.status(400).json({ error: 'cannot_delete_public_demo' });
    }
    rdb.deleteToolJob(req.params.id);
    // Phase 2: remove the physical job dir from wherever it actually lives
    // (project sandbox → global → legacy). Never touches sibling jobs/projects.
    try {
      const jobDir = resolveExistingJobDir(job);
      if (jobDir) fs.rmSync(jobDir, { recursive: true, force: true });
    } catch {}
    res.json({ ok: true });
  });

  // GET /api/tools/public-demo/:toolId — anonymous-OK
  app.get('/api/tools/public-demo/:toolId', (req, res) => {
    const job = rdb.getPublicDemo(req.params.toolId);
    if (!job) {
      const demoAsset = readPublicDemoAsset(req.params.toolId);
      if (demoAsset) {
        return res.json({
          ok: true,
          toolId: req.params.toolId,
          jobId: demoAsset.jobId,
          files: demoAsset.files,
          summary: demoAsset.result.summary,
          source: 'asset',
        });
      }
      return res.json({ ok: true, files: [], source: 'none' });
    }
    const result = job.result_json ? JSON.parse(job.result_json) : { files: [] };
    // W2.1 (2026-05-28): URL 不带 /api/ 前缀（与 r-server 行为一致），前端 getApiPrefix 自动拼
    const files = filesForPublicJob(job.id, result);
    res.json({
      ok: true,
      toolId: req.params.toolId,
      jobId: job.id,
      files,
      summary: result.summary,
      source: 'job',
    });
  });

  // GET /api/tools/public-file/:jobId/:filename — anonymous read of public demo files
  app.get('/api/tools/public-file/:jobId/:filename', (req, res) => {
    const job = rdb.getToolJob(req.params.jobId);
    if ((!job || job.is_public !== 1) && !PUBLIC_DEMO_JOB_IDS.has(req.params.jobId)) {
      return res.status(404).json({ error: 'not_found' });
    }
    const filePath = safeJoinUnder(JOBS_DIR, req.params.jobId, 'output', req.params.filename);
    if (!filePath) return res.status(400).json({ error: 'bad_path' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file_not_found' });
    res.sendFile(filePath);
  });
}

module.exports = {
  registerToolsRoutes,
  getToolMeta,
  PY_TOOL_REGISTRY,
  _test: {
    resolveRunLayout,
    resolveExistingJobDir,
    resolveExistingJobOutputDir,
    resolveJobFilePath,
    JOBS_DIR,
  },
};
