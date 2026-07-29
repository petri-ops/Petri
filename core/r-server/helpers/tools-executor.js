const fs = require('fs');
const path = require('path');
const { createResultArchive } = require('./result-archive');
const { v4: uuidv4 } = require('uuid');
const { execFile } = require('child_process');
const {
  captureStagedInputSnapshots,
  isInternalArtifactName,
  reconcileArtifactTruth,
} = require('./artifact-truth');
const { sendThemedHtmlFile, injectReportTheme, normalizeReportTheme } = require('./report-theme');
const { materializeFinalReport } = require('./final-report');
const {
  createExecutionContext: createCanonicalExecutionContext,
} = require('../../shared-backend/execution-context');
const {
  resolveProjectRunLayout,
} = require('../../shared-backend/project-run-layout');
const { resolveRLibsForPlugin } = require('../../shared-backend/r-libs-resolver');
const { ensureBundlesForPlugin } = require('../../shared-backend/capability-bundles');
const { createExecutionProvenance, attachProvenanceToResult } = require('../../shared-backend/execution-provenance');
const { collectExecutionInputs, writeArtifactManifest } = require('../../shared-backend/artifact-manifest');
const { createRuntimeResourceSnapshot } = require('../../shared-backend/runtime-resource-snapshot');
const {
  markUnownedStaleJobs,
  recoverStaleActiveJobs,
  refreshVerifiedHeartbeat,
  resolveLifecycleDurations,
  scheduleHardTimeout,
  terminateChildProcess,
} = require('../helpers/process-lifecycle');

function isManagedResultDir(candidate, jobsDir) {
  if (!candidate || !jobsDir) return false;
  const resolved = path.resolve(String(candidate));
  const roots = [path.resolve(jobsDir), path.resolve(path.dirname(jobsDir), 'mcp-tool-jobs')];
  return roots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

/**
 * The tools HTTP contract accepts a flat `filename -> base64` map. Tool
 * scripts resolve their inputs directly from the job root; directory uploads
 * are not part of that contract. Resolve every key before writing so a bad
 * key cannot escape the job sandbox or leave a partial upload behind.
 */
function resolveUploadedFilePath(jobDir, key) {
  if (typeof jobDir !== 'string' || !jobDir || jobDir.includes('\0')) {
    return { ok: false, error: '上传目录无效。' };
  }
  if (typeof key !== 'string' || !key || key.includes('\0')) {
    return { ok: false, error: '上传文件名无效。' };
  }

  // Reject both platform separator syntaxes. This is deliberately stricter
  // than a containment-only check because nested upload paths are unsupported.
  if (
    key.includes('/') ||
    key.includes('\\') ||
    key === '.' ||
    key === '..' ||
    path.isAbsolute(key) ||
    path.win32.isAbsolute(key) ||
    /^[A-Za-z]:/.test(key)
  ) {
    return { ok: false, error: '上传文件名不能包含路径。' };
  }
  if (isInternalArtifactName(key)) {
    return { ok: false, error: '上传文件名与任务内部控制文件冲突。' };
  }

  const root = path.resolve(jobDir);
  const filePath = path.resolve(root, key);
  if (path.dirname(filePath) !== root) {
    return { ok: false, error: '上传文件路径超出任务目录。' };
  }
  return { ok: true, filePath, key };
}

function resolveUploadedFiles(jobDir, files) {
  if (files === undefined || files === null) return { ok: true, entries: [] };
  if (typeof files !== 'object' || Array.isArray(files) || Buffer.isBuffer(files)) {
    return { ok: false, error: '上传文件必须是文件名到 Base64 内容的映射。' };
  }
  const prototype = Object.getPrototypeOf(files);
  if (prototype !== Object.prototype && prototype !== null) {
    return { ok: false, error: '上传文件必须是文件名到 Base64 内容的映射。' };
  }

  const entries = [];
  for (const [key, fileData] of Object.entries(files)) {
    const resolved = resolveUploadedFilePath(jobDir, key);
    if (!resolved.ok) return resolved;
    if (typeof fileData !== 'string') {
      return { ok: false, error: `文件 "${key}" 的上传内容无效。` };
    }
    entries.push({ ...resolved, fileData });
  }
  return { ok: true, entries };
}

function writeUploadedFiles(jobDir, files) {
  const resolved = resolveUploadedFiles(jobDir, files);
  if (!resolved.ok) return resolved;

  for (const entry of resolved.entries) {
    fs.writeFileSync(entry.filePath, Buffer.from(entry.fileData, 'base64'));
  }
  return resolved;
}

function validateUploadedFiles(toolId, jobDir, files) {
  const resolvedFiles = resolveUploadedFiles(jobDir, files);
  if (!resolvedFiles.ok) return resolvedFiles.error;
  const csvTools = [
    'deseq2',
    'go-kegg',
    'gsea',
    'km-survival',
    'lasso-cox',
    'bindea-immune',
    'wgcna',
    'complexheatmap',
  ];

  for (const { key, filePath } of resolvedFiles.entries) {
    if (!fs.existsSync(filePath)) continue;

    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);
    const head = buf.slice(0, bytesRead).toString('utf-8');

    if (csvTools.includes(toolId) && head.includes('\0')) {
      return `文件 "${key}" 似乎是二进制文件（如 Excel .xlsx），请转换为 CSV 或 TSV 格式后重新上传。提示：在 Excel 中"另存为" → 选择 CSV (UTF-8) 格式。`;
    }

    if (csvTools.includes(toolId)) {
      const lines = head.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) {
        return `文件 "${key}" 内容为空或只有表头，需要至少包含 1 行数据。`;
      }
      const firstLine = lines[0];
      const sep = firstLine.includes('\t') ? '\t' : ',';
      const headerCols = firstLine.split(sep).length;
      // GO/KEGG explicitly accepts a one-column gene list (`gene` header);
      // the other CSV tools require at least two columns.
      const acceptsSingleColumnGeneList = toolId === 'go-kegg';
      if (headerCols < 2 && !acceptsSingleColumnGeneList) {
        return `文件 "${key}" 只检测到 1 列。请确认分隔符是逗号(CSV)或制表符(TSV)，不是分号或空格。`;
      }
      const dataCols = lines[1].split(sep).length;
      if (Math.abs(dataCols - headerCols) > 1) {
        return `文件 "${key}" 格式异常：表头有 ${headerCols} 列，但第一行数据有 ${dataCols} 列。请检查 CSV 格式是否正确。`;
      }
    }

    const stat = fs.statSync(filePath);
    if (
      stat.size > 100 * 1024 * 1024 &&
      toolId !== 'seurat-standard' &&
      toolId !== 'cellchat'
    ) {
      return `文件 "${key}" 大小为 ${Math.round(stat.size / 1024 / 1024)}MB，超过推荐上限(100MB)。大文件可能导致分析超时。建议：筛选基因或样本后重试。`;
    }
  }
  return null;
}

function hydrateExecutionJob(row) {
  if (!row || typeof row !== 'object') return null;
  let params = {};
  try {
    params = row.params_json
      ? (typeof row.params_json === 'string' ? JSON.parse(row.params_json) : row.params_json)
      : {};
  } catch {
    params = {};
  }
  return { ...row, params };
}

/**
 * Plugin scripts historically use either `<job>/output` or the isolated Job
 * root as their result directory. Both locations are server-owned; select one
 * only from a produced manifest or an exact declared artifact filename.
 */
function resolveProducedResultDirectory({ jobDir, outputDir, expectedArtifacts = [] }) {
  const resultRoots = [path.resolve(outputDir), path.resolve(jobDir)];
  const manifestNames = ['manifest.json', 'artifact-manifest.json'];
  for (const root of resultRoots) {
    for (const name of manifestNames) {
      const candidate = path.join(root, name);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return { resultDir: root, manifestPath: candidate, reason: 'manifest' };
      }
    }
  }
  const declaredNames = expectedArtifacts
    .map((artifact) => artifact && (artifact.filename || artifact.name))
    .filter((name) => typeof name === 'string' && name === path.basename(name) && !name.includes('\0'));
  for (const root of resultRoots) {
    if (declaredNames.some((name) => {
      const candidate = path.join(root, name);
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    })) {
      return { resultDir: root, manifestPath: path.join(root, 'manifest.json'), reason: 'declared_artifact' };
    }
  }
  return {
    resultDir: path.resolve(outputDir),
    manifestPath: path.join(path.resolve(outputDir), 'manifest.json'),
    reason: 'standard_default',
  };
}


function createToolsExecutor({
  db,
  dbMod,
  config,
  notify,
  jobsDir,
  scriptsDir,
  publicDemoJobIds,
  safeJoinUnder,
  getUserId,
  isSmokeTestRequest,
}) {
  const activeToolJobs = new Map();
  const defaultLocalRoot =
    process.env.BIOF3_HARNESS_LOCAL_ROOT ||
    process.env.BIOF3_LOCAL_ROOT ||
    config.localResultsDir ||
    path.dirname(jobsDir);
  const defaultCanonicalRoot =
    process.env.BIOF3_HARNESS_CANONICAL_ROOT || process.env.BIOF3_CANONICAL_ROOT || '/work/biof3';

  function canonicalizePath(localPath) {
    return createCanonicalExecutionContext({
      workDir: localPath,
      localRoot: defaultLocalRoot,
      canonicalRoot: defaultCanonicalRoot,
    }).canonicalizePath(localPath);
  }

  function createExecutionContext({
    jobDir,
    outputDir,
    resultDir,
    runtime,
    runtimeCommand,
    runtimeReady,
  }) {
    return createCanonicalExecutionContext({
      workDir: jobDir,
      outputDir,
      resultDir,
      runtime,
      runtimeCommand,
      runtimeReady,
      localRoot: defaultLocalRoot,
      canonicalRoot: defaultCanonicalRoot,
    }).context;
  }

  function forwardedToolRunUserId(req) {
    if (!req.isInternal) return getUserId(req);
    const raw = req.headers['x-biof3-user-id'];
    const uid = Array.isArray(raw) ? raw[0] : raw;
    return uid ? String(uid).trim() : null;
  }

  function killLocalToolJob(jobId) {
    const active = activeToolJobs.get(jobId);
    if (!active || !active.process) return { active: false, killed: false };
    active.cancelRequested = true;
    const result = { active: true, killed: false };
    result.termination = terminateChildProcess(active.process).then((termination) => {
      result.killed = termination.terminated;
      result.signal = termination.signal || (termination.escalated ? 'SIGKILL' : 'SIGTERM');
      return termination;
    });
    return result;
  }

  async function cleanupLocalToolJobDir(jobId) {
    if (publicDemoJobIds.has(jobId)) {
      return { removed: false, protected: true, reason: 'public_demo_asset' };
    }

    // Phase 2: 尝试从数据库读取 job 的项目关联
    let jobDir = null;
    try {
      const job = await db.prepare('SELECT project_id FROM tool_jobs WHERE id=?').get(jobId);
      if (job && job.project_id) {
        const layout = resolveProjectRunLayout({
          projectId: job.project_id,
          toolJobId: jobId,
          db: dbMod,
          skipPermissionCheck: true,
          ensureDirs: false,
        });
        jobDir = layout.jobRoot;
      }
    } catch (error) {
      console.warn('[tools] Failed to resolve project layout for cleanup:', error.message);
    }

    // 回退到全局目录
    if (!jobDir) {
      jobDir = safeJoinUnder(jobsDir, jobId);
    }

    if (!jobDir) return { removed: false, error: 'bad_path' };
    const existed = fs.existsSync(jobDir);
    try {
      fs.rmSync(jobDir, { recursive: true, force: true });
      return { removed: existed, existed };
    } catch (e) {
      return { removed: false, existed, error: e.message };
    }
  }

  async function handlePrivateFileRead(req, res) {
    const job =
      req.toolJob ||
      (await db.prepare('SELECT * FROM tool_jobs WHERE id=?').get(req.params.jobId));

    if (!job) {
      return res.status(404).json({ error: 'job_not_found' });
    }

    let filePath = null;

    // Phase 2/4: 尝试从项目目录读取（safeJoinUnder 强制 containment，防路径遍历）
    if (job.project_id) {
      try {
        const layout = resolveProjectRunLayout({
          projectId: job.project_id,
          toolJobId: job.id,
          db: dbMod,
          skipPermissionCheck: true,
          ensureDirs: false,
        });
        filePath = safeJoinUnder(layout.outputDir, req.params.filename);
      } catch (error) {
        console.warn('[tools] Project layout resolution failed for file read:', error.message);
      }
    }

    // 回退：尝试全局目录
    if (!filePath || !fs.existsSync(filePath)) {
      filePath = safeJoinUnder(jobsDir, req.params.jobId, 'output', req.params.filename);
    }

    // 回退：尝试历史 result_json 路径
    if (!filePath || !fs.existsSync(filePath)) {
      try {
        const result =
          job && job.result_json
            ? typeof job.result_json === 'string'
              ? JSON.parse(job.result_json)
              : job.result_json
            : null;
        const resultDir = result && (result.resultDir || result.outputDir);
        if (isManagedResultDir(resultDir, jobsDir)) {
          const managedPath = safeJoinUnder(resultDir, req.params.filename);
          if (managedPath) filePath = managedPath;
        }
      } catch (error) {
        console.warn('[tools] Legacy result path lookup failed:', error.message);
      }
    }

    if (!filePath) return res.status(400).json({ error: 'bad_path' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file_not_found' });
    if (sendThemedHtmlFile(req, res, filePath)) return;
    return res.sendFile(filePath);
  }

  function regenerateReportForImage(jobId, toolId, filename, outputDirOverride) {
    if (!filename.endsWith('.png') || !toolId) return;
    try {
      // Phase 4: 优先用调用方解析出的 outputDir（项目沙盒），回退全局目录
      const outputDir = outputDirOverride || path.join(jobsDir, jobId, 'output');
      const templatePath = path.join(scriptsDir, toolId + '-report-template.html');
      if (!fs.existsSync(templatePath)) return;
      let html = fs.readFileSync(templatePath, 'utf-8');
      const pngs = fs.readdirSync(outputDir).filter((f) => f.endsWith('.png'));
      for (const png of pngs) {
        const pngPath = path.join(outputDir, png);
        const b64 = fs.readFileSync(pngPath).toString('base64');
        const dataUri = 'data:image/png;base64,' + b64;
        html = html.split('https://biof3.com/api/r/tools/demo/' + toolId + '/' + png).join(dataUri);
        html = html
          .split('https://biof3.com/api/platform/tools/demo/' + toolId + '/' + png)
          .join(dataUri);
        if (png === 'heatmap.png') {
          html = html
            .split('https://biof3.com/api/r/tools/demo/' + toolId + '/heatmap_top50.png')
            .join(dataUri);
          html = html
            .split('https://biof3.com/api/platform/tools/demo/' + toolId + '/heatmap_top50.png')
            .join(dataUri);
        }
      }
      fs.writeFileSync(path.join(outputDir, 'report.html'), html);
    } catch (e) {
      console.warn('[tools] Report regen failed:', e.message);
    }
  }

  async function handlePrivateFileWrite(req, res, toolId) {
    try {
      const job =
        req.toolJob ||
        (await db.prepare('SELECT * FROM tool_jobs WHERE id=?').get(req.params.jobId));

      let filePath = null;
      let outputDir = null;

      // Phase 4: 写入项目沙盒的 output/（safeJoinUnder 强制 containment）
      if (job && job.project_id) {
        try {
          const layout = resolveProjectRunLayout({
            projectId: job.project_id,
            toolJobId: job.id,
            db: dbMod,
            skipPermissionCheck: true,
            ensureDirs: false,
          });
          outputDir = layout.outputDir;
          filePath = safeJoinUnder(outputDir, req.params.filename);
        } catch (error) {
          console.warn('[tools] Project layout resolution failed for file write:', error.message);
        }
      }

      // 回退：全局目录（历史兼容）。仅当项目目录不存在时才回退。
      if (!filePath || !fs.existsSync(path.dirname(filePath))) {
        const globalPath = safeJoinUnder(jobsDir, req.params.jobId, 'output', req.params.filename);
        if (globalPath && fs.existsSync(path.dirname(globalPath))) {
          filePath = globalPath;
          outputDir = path.join(jobsDir, req.params.jobId, 'output');
        }
      }

      if (!filePath) return res.status(400).json({ error: 'bad_path' });
      if (!fs.existsSync(path.dirname(filePath)))
        return res.status(404).json({ error: 'job_dir_not_found' });
      fs.writeFileSync(filePath, req.body || Buffer.alloc(0));
      regenerateReportForImage(req.params.jobId, toolId, req.params.filename, outputDir);
      return res.json({ ok: true, replaced: req.params.filename });
    } catch (error) {
      return res.status(500).json({ error: 'file_write_failed', message: error.message });
    }
  }

  async function handleGenerateFinalReport(req, res) {
    try {
      const job = req.toolJob || (await db.prepare('SELECT * FROM tool_jobs WHERE id=?').get(req.params.jobId));
      if (!job) {
        return res.status(404).json({error: 'job_not_found'});
      }

      let outputDir = null;
      let projectExportsDir = null;

      // Phase 2: 尝试从项目目录读取
      if (job.project_id) {
        try {
          const layout = resolveProjectRunLayout({
            projectId: job.project_id,
            toolJobId: job.id,
            db: dbMod,
            skipPermissionCheck: true,
            ensureDirs: false,
          });
          outputDir = layout.outputDir;
          projectExportsDir = layout.exportsDir;
        } catch (error) {
          console.warn('[tools] Project layout resolution failed for report:', error.message);
        }
      }

      // 回退：尝试全局目录
      if (!outputDir || !fs.existsSync(outputDir)) {
        outputDir = safeJoinUnder(jobsDir, req.params.jobId, 'output');
      }

      // 回退：尝试历史 result_json 路径
      const result = job && job.result_json
        ? (typeof job.result_json === 'string' ? JSON.parse(job.result_json) : job.result_json)
        : null;
      const resultDir = result && (result.resultDir || result.outputDir);
      if ((!outputDir || !fs.existsSync(outputDir)) && isManagedResultDir(resultDir, jobsDir)) {
        outputDir = path.resolve(resultDir);
      }

      if (!outputDir || !fs.existsSync(outputDir)) {
        return res.status(404).json({error: 'job_output_not_found'});
      }

      const theme = normalizeReportTheme(req.body?.theme);
      const report = materializeFinalReport({
        outputDir,
        transformHtml: theme ? (html) => injectReportTheme(html, theme) : undefined,
      });

      // Phase 4: 最终报告在 job 的 output/ 生成（上面已完成）；用户主动导出时，
      // 把一份自包含副本落到项目沙盒的 results/exports/，使其在项目文件树可发现。
      // 副本命名带 jobId，避免不同 job 覆盖；导出不改变 artifact truth。
      let exportRelPath = null;
      if (projectExportsDir) {
        try {
          fs.mkdirSync(projectExportsDir, { recursive: true });
          const exportName = `${req.params.jobId}-${report.fileName}`;
          const exportTarget = safeJoinUnder(projectExportsDir, exportName);
          if (exportTarget) {
            fs.copyFileSync(path.join(outputDir, report.fileName), exportTarget);
            exportRelPath = path.join('results', 'exports', exportName);
          }
        } catch (error) {
          console.warn('[tools] Final report export copy failed:', error.message);
        }
      }

      return res.json({
        ok: true,
        ...report,
        theme,
        url: `/api/tools/file/${encodeURIComponent(req.params.jobId)}/${report.fileName}`,
        ...(exportRelPath ? { exportPath: exportRelPath } : {}),
      });
    } catch (error) {
      const code = error && error.code === 'report_source_not_found' ? 'report_source_not_found' : 'report_generation_failed';
      return res.status(code === 'report_source_not_found' ? 404 : 500).json({error: code, message: error.message});
    }
  }

  async function recoverZombieJobs({ startup = false } = {}) {
    try {
      const cutoff = Date.now() - ZOMBIE_TIMEOUT_MS;
      await recoverStaleActiveJobs({ activeJobs: activeToolJobs, cutoff, db });
      const result = await markUnownedStaleJobs({ db, cutoff });
      if (result.changes > 0) {
        console.log(`[tools] Recovered ${result.changes} unowned zombie job(s)`);
        try {
          notify.custom({
            title: `⚠️ ${startup ? '启动恢复' : '周期扫描'}：${result.changes} 个无主 zombie 任务标 failed`,
            template: 'orange',
            dedupeKey: `zombie_${startup ? 'startup' : 'periodic'}:${result.changes}`,
            lines: [
              '发现超过活性窗口且没有本次进程句柄的 running/pending 任务。',
              '因无法证明 PID 归属，未发送信号；已如实标记 failed。',
            ],
          });
        } catch {}
      }
    } catch (e) {
      console.warn(`[tools] recoverZombieJobs failed: ${e.message} — skipping startup scan`);
    }
  }

  function startZombieRecovery() {
    recoverZombieJobs({ startup: true });
    setInterval(
      () => {
        void recoverZombieJobs({ startup: false });
      },
      5 * 60 * 1000
    );
  }

  async function markJobFailed(jobId, errorMsg, stage) {
    try {
      const current = await db.prepare('SELECT status FROM tool_jobs WHERE id=?').get(jobId);
      if (current && current.status === 'cancelled') {
        console.log('[tools] Job ' + jobId + ' cancelled; skip failure overwrite');
        return;
      }
    } catch {}
    const raw = String(errorMsg || '');
    let errStr;
    if (raw.length <= 3000) {
      errStr = raw;
    } else {
      errStr =
        raw.slice(0, 1200) +
        '\n\n... [truncated ' +
        (raw.length - 2400) +
        ' chars] ...\n\n' +
        raw.slice(-1200);
    }
    await db
      .prepare('UPDATE tool_jobs SET status=?, error=?, completed_at=? WHERE id=?')
      .run('failed', errStr, Date.now(), jobId);
    const translated = translateRError(errStr);
    if (translated) {
      const combined = '💡 ' + translated + '\n\n--- 原始错误信息 ---\n' + errStr;
      await db.prepare('UPDATE tool_jobs SET error=? WHERE id=?').run(combined, jobId);
    }
    try {
      const job = await db
        .prepare('SELECT user_id, tool_id, created_at, is_test_run FROM tool_jobs WHERE id=?')
        .get(jobId);
      if (!job) return;
      if (job.is_test_run) return;
      let username = null;
      try {
        const u = await db.prepare('SELECT username FROM users WHERE id=?').get(job.user_id);
        username = u && u.username;
      } catch {}
      notify.toolJobFailed({
        jobId,
        toolId: job.tool_id,
        username,
        error: errStr,
        durationMs: job.created_at ? Date.now() - job.created_at : null,
        stage,
      });
    } catch (e) {
      console.warn('[tools] notify on failure error:', e.message);
    }
  }

  function getToolConfig(toolId) {
    // Installed plugins take precedence and carry absolute local script paths.
    try {
      const { getScriptForTool, getPlugin } = require('../plugin-loader');
      const plugin = getPlugin(toolId);
      if (plugin) {
        const scriptPath = getScriptForTool(toolId);
        if (scriptPath && fs.existsSync(scriptPath)) {
          return {
            script: scriptPath,
            lang: plugin.language,
            _isPlugin: true,
            pluginDir: plugin.pluginDir,
            // Carry bundle declarations so the run path can (a) auto-provision
            // required capability bundles and (b) mount them via R_LIBS_USER.
            requiresBundle: plugin.requiresBundle,
            requiresBundleVersion: plugin.requiresBundleVersion,
          };
        }
      }
    } catch (e) {
      console.warn('[tools] plugin-loader lookup failed for', toolId, ':', e.message);
    }

    // Built-in registry is the local R-tool fallback. Python tools run in py-server.
    try {
      const { getToolConfig: getRegistryConfig } = require('../tool-registry');
      const cfg = getRegistryConfig(toolId);
      if (cfg && cfg.lang === 'r' && cfg.pluginOnly !== true) {
        return {
          script: cfg.script,
          lang: cfg.lang,
        };
      }
    } catch (e) {
      console.warn('[tools] tool-registry lookup failed for', toolId, ':', e.message);
    }

    return null;
  }

  async function executeJob(jobId, toolId, jobDir, stagedInputFiles = []) {
    const started = await db
      .prepare('UPDATE tool_jobs SET status = ? WHERE id = ? AND status = ?')
      .run('running', jobId, 'pending');
    if (!started || started.changes < 1) {
      console.log('[tools] Job ' + jobId + ' not started because it is no longer pending');
      return;
    }
    const job = hydrateExecutionJob(
      await db.prepare('SELECT * FROM tool_jobs WHERE id = ?').get(jobId)
    );
    if (!job) {
      await markJobFailed(jobId, 'Tool job disappeared before execution.', 'setup');
      return;
    }
    let stagedInputSnapshots;
    try {
      stagedInputSnapshots = captureStagedInputSnapshots(stagedInputFiles);
    } catch (error) {
      await markJobFailed(jobId, `Staged input snapshot failed: ${error.message}`, 'setup');
      return;
    }
    const outputDir = path.join(jobDir, 'output');
    config.mkdirSandbox(outputDir);

    const cfg = getToolConfig(toolId);
    if (!cfg) {
      await markJobFailed(jobId, 'Unknown tool: ' + toolId, 'config');
      return;
    }

    // 插件脚本：cfg.script 已是绝对路径；内置工具：拼 scriptsDir
    const scriptSrc = cfg._isPlugin ? cfg.script : path.join(scriptsDir, cfg.script);
    if (!fs.existsSync(scriptSrc)) {
      await markJobFailed(jobId, 'Script not found: ' + cfg.script, 'config');
      return;
    }

    const scriptPath = path.join(jobDir, 'run-script.' + (cfg.lang === 'r' ? 'R' : 'py'));

    try {
      fs.copyFileSync(
        scriptSrc,
        path.join(jobDir, 'run-script.' + (cfg.lang === 'r' ? 'R' : 'py'))
      );
      // 报告模板：插件自带模板优先；内置插件可复用 r-server 旧模板。
      const templateCandidates = cfg._isPlugin
        ? [
            path.join(cfg.pluginDir, toolId + '-report-template.html'),
            path.join(scriptsDir, toolId + '-report-template.html'),
          ]
        : [path.join(scriptsDir, toolId + '-report-template.html')];
      const templateSrc = templateCandidates.find((candidate) => fs.existsSync(candidate));
      if (templateSrc) {
        fs.copyFileSync(templateSrc, path.join(jobDir, 'report-template.html'));
      }
      if (cfg.lang === 'r') {
        const sharedHelpers = ['_biof3-theme.R'];
        // 插件脚本目录优先（build-plugin.sh 已把 _biof3-theme.R 复制进去），其次 scriptsDir
        const helperSearchDirs = cfg._isPlugin
          ? [path.dirname(scriptSrc), scriptsDir]
          : [scriptsDir];
        for (const h of sharedHelpers) {
          for (const dir of helperSearchDirs) {
            const src = path.join(dir, h);
            if (fs.existsSync(src)) {
              fs.copyFileSync(src, path.join(jobDir, h));
              break;
            }
          }
        }
      }
    } catch (e) {
      await markJobFailed(jobId, 'Copy failed: ' + e.message, 'setup');
      return;
    }

    // 本地执行：直接调内嵌 Rscript/python3。
    let runCmd;
    let runEnv = undefined;
    let runtimeReady = null;
    let runtimeCommand = null;
    let runtimeVersion = null;
    {
      const { getExecutor } = require('../../shared-backend/executors');
      const executor = getExecutor(cfg.lang);
      runtimeCommand = executor && executor.binPath;
      runtimeReady =
        executor && executor.binPath
          ? { runtime: cfg.lang || null, ready: true, command: executor.binPath, reason: null }
          : {
              runtime: cfg.lang || null,
              ready: false,
              command: null,
              reason: `未找到 ${cfg.lang || 'unknown'} 执行器`,
            };
      runtimeVersion = runtimeReady.ready && typeof executor.getRuntimeVersion === 'function'
        ? executor.getRuntimeVersion()
        : null;
      if (!runtimeReady.ready) {
        await markJobFailed(jobId, runtimeReady.reason, 'runtime');
        return;
      }
      if (cfg.lang === 'r') {
        // R 工具脚本约定：commandArgs(trailingOnly=TRUE)[1] = job_dir
        //（deseq2.R: `args <- commandArgs(trailingOnly=TRUE); job_dir <- args[1]`）
        // 不能用 buildSpawnCommand（它加 --args params.json，是 figcode 脚本约定，
        // 会让 args[1]="--args"，R 脚本 source(file.path("--args",...)) 找不到文件）
        runCmd = [executor.binPath, scriptPath, jobDir];
        // 插件脚本：注入插件自带的预编译包目录到 R 库搜索路径，
        // 让 library(DESeq2) 等从 pluginDir/packages/r 加载，不污染基础 runtime library。
        // R_LIBS_USER 会被追加到默认 .libPaths() 之后，runtime 基础包仍可用。
        // 三段式组装逻辑抽到 shared-backend/r-libs-resolver.js（与 mcp/registry.js 共用）。
        if (cfg._isPlugin) {
          // Stage 3 B2 part2：在组装 R_LIBS_USER 之前，先确保插件声明的 capability
          // bundle 已就绪（缺则按需下载）。ensureBundlesForPlugin 对 unpublished /
          // unknown bundle 不下载、不抛错；任何非 ok 结果只 warn，随后照常继续用基础
          // runtime 跑（与接线前行为完全一致——resolveRLibsForPlugin 找不到即返回 null）。
          // 绝不因 bundle 未就绪而中断 job。await 确保已下载的 bundle 能被随后的
          // resolveRLibsForPlugin → checkCapabilityReady 命中。
          if (cfg.requiresBundle) {
            try {
              const ensured = await ensureBundlesForPlugin(cfg);
              if (ensured && !ensured.ok) {
                console.warn(
                  '[tools] capability bundle not fully ready for',
                  toolId,
                  '— continuing with base runtime:',
                  JSON.stringify(ensured.results)
                );
              }
            } catch (e) {
              console.warn('[tools] ensureBundlesForPlugin failed for', toolId, ':', e.message);
            }
          }
          const resolvedEnv = resolveRLibsForPlugin(cfg);
          if (resolvedEnv) runEnv = resolvedEnv;
        }
      } else {
        const spawnCmd = executor.buildSpawnCommand(scriptPath, jobDir, {});
        if (cfg._isPlugin) {
          runCmd = [executor.binPath, scriptPath, jobDir];
        } else {
          runCmd = [spawnCmd.cmd, ...spawnCmd.args];
        }
        if (spawnCmd.env) runEnv = spawnCmd.env;
      }
    }

    const startedAt = new Date().toISOString();
    const resourceStart = createRuntimeResourceSnapshot({
      runtime: { r: cfg.lang === 'r' && runtimeReady?.ready, python: cfg.lang === 'python' && runtimeReady?.ready },
      activeJobs: activeToolJobs.size + 1,
      observedAt: startedAt,
    });
    const buildProvenance = (artifacts = []) => {
      const dbMod = require('../db');
      const pluginLoader = require('../plugin-loader');
      const toolDefinition = pluginLoader.getToolDefinition(toolId) || {};
      const pluginManifest = pluginLoader.getPluginManifest(toolId) || cfg;
      const scientificTask = typeof dbMod.getScientificTaskByToolJob === 'function' ? dbMod.getScientificTaskByToolJob(jobId) : null;
      const provenance = createExecutionProvenance({
        toolJobId: jobId,
        projectId: job.project_id || null,
        scientificTask,
        plugin: pluginManifest,
        params: job.params || {},
        inputs: collectExecutionInputs({
          inputDefinitions: Array.isArray(toolDefinition.inputs) ? toolDefinition.inputs : [],
          params: job.params || {},
          jobDir,
        }),
        runtime: { name: cfg.lang || null, command: runtimeCommand, version: runtimeVersion, ready: runtimeReady?.ready },
        runScriptPath: scriptPath,
        command: { executable: runCmd[0], args: runCmd.slice(1), cwd: jobDir },
        artifacts,
        startedAt,
        completedAt: new Date().toISOString(),
      });
      const provenancePath = path.join(jobDir, 'provenance.json');
      fs.writeFileSync(provenancePath, JSON.stringify(provenance, null, 2));
      return { provenance, provenancePath, pluginManifest };
    };
    const hardTimeoutMs = TOOL_LIFECYCLE.hardTimeoutMs;
    let hardTimeoutTimer = null;
    const child = execFile(
      runCmd[0],
      runCmd.slice(1),
      { timeout: 0, maxBuffer: 10 * 1024 * 1024, env: runEnv },
      async (err, stdout, stderr) => {
        if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);
        const active = activeToolJobs.get(jobId);
        if (active && active.heartbeatTimer) clearInterval(active.heartbeatTimer);
        activeToolJobs.delete(jobId);
        try {
          const log = `=== STDOUT ===\n${stdout || ''}\n\n=== STDERR ===\n${stderr || ''}\n\n=== EXIT ===\n${err ? 'ERROR: ' + err.message : 'OK'}\nTimestamp: ${new Date().toISOString()}\n`;
          fs.writeFileSync(path.join(outputDir, 'run.log'), log);
        } catch {}

        let currentJob = null;
        try {
          currentJob = await db
            .prepare('SELECT status, is_test_run FROM tool_jobs WHERE id=?')
            .get(jobId);
        } catch {}
        if (active && active.cancelRequested) {
          console.log('[tools] Job ' + jobId + ' cancellation requested; cancel route owns terminal status');
          return;
        }
        if (currentJob && currentJob.status === 'cancelled') {
          console.log('[tools] Job ' + jobId + ' cancelled; skip terminal status overwrite');
          return;
        }

        if (err) {
          try {
            const failed = buildProvenance();
            await db.prepare('UPDATE tool_jobs SET result_json=? WHERE id=?').run(JSON.stringify({
              toolJobId: jobId,
              failure: {
                phase: 'execute',
                reason: active?.timedOut ? 'hard_timeout' : err.killed ? 'terminated' : 'nonzero_exit',
                exitCode: err.code ?? null,
              },
              resourceUsage: { start: resourceStart, end: createRuntimeResourceSnapshot({ observedAt: new Date().toISOString() }), peakStatus: 'unavailable_without_process_sampler' },
              executionProvenance: failed.provenance,
              provenanceRef: { provenanceHash: failed.provenance.provenanceHash, path: failed.provenancePath, toolJobId: jobId },
            }), jobId);
          } catch {}
          const failureMessage = active?.timedOut
            ? `任务超过最大运行预算 ${hardTimeoutMs}ms；子进程退出已确认`
            : stderr || err.message || '';
          await markJobFailed(jobId, failureMessage, 'execute');
          return;
        }

        let expectedArtifacts = [];
        try {
          const pluginLoader = require('../plugin-loader');
          const definition = pluginLoader.getToolDefinition(toolId);
          expectedArtifacts = Array.isArray(definition && definition.outputs)
            ? definition.outputs.map((item) =>
                item && item.id === 'zip' && !item.filename && !item.name
                  ? { ...item, filename: 'all_results.zip' }
                  : item
              )
            : [];
        } catch {}
        const produced = resolveProducedResultDirectory({ jobDir, outputDir, expectedArtifacts });
        const resultDir = produced.resultDir;
        const manifestPath = produced.manifestPath;
        const archiveArtifact = expectedArtifacts.find(
          (item) => item && item.id === 'zip' && item.required !== false
        );
        if (archiveArtifact) {
          try {
            await createResultArchive(
              resultDir,
              archiveArtifact.filename || archiveArtifact.name || 'all_results.zip'
            );
          } catch (archiveError) {
            await markJobFailed(jobId, `Result archive failed: ${archiveError.message}`, 'postprocess');
            return;
          }
        }

        let result = {};
        if (fs.existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            result = { ...manifest, manifest };
          } catch {}
        } else {
          const files = fs.existsSync(resultDir) ? fs.readdirSync(resultDir) : [];
          result.files = files.map((f) => ({
            name: f,
            type: f.endsWith('.png') ? 'plot' : f.endsWith('.csv') ? 'table' : 'file',
            url: '/api/tools/file/' + jobId + '/' + f,
          }));
        }
        const executionContext = createExecutionContext({
          jobDir,
          outputDir,
          resultDir,
          runtime: cfg.lang || null,
          runtimeCommand,
          runtimeReady,
        });
        result.toolJobId = jobId;
        result.jobDir = jobDir;
        result.outputDir = outputDir;
        result.resultDir = resultDir;
        result.canonicalJobDir = canonicalizePath(jobDir);
        result.canonicalOutputDir = canonicalizePath(outputDir);
        result.canonicalResultDir = canonicalizePath(resultDir);
        result.execution = executionContext;
        result.resourceUsage = {
          start: resourceStart,
          end: createRuntimeResourceSnapshot({
            runtime: { r: cfg.lang === 'r' && runtimeReady?.ready, python: cfg.lang === 'python' && runtimeReady?.ready },
            activeJobs: activeToolJobs.size,
            observedAt: new Date().toISOString(),
          }),
          peakStatus: 'unavailable_without_process_sampler',
        };
        result.artifactSchemaVersion = result.artifactSchemaVersion || 1;
        if (Array.isArray(result.outputs)) {
          result.outputs = result.outputs.map((item) => {
            const name = item && (item.filename || item.name || item.path);
            if (!name) return item;
            const itemPath = item.path || path.join(resultDir, path.basename(String(name)));
            return {
              ...item,
              path: itemPath,
              canonicalPath: item.canonicalPath || canonicalizePath(itemPath),
            };
          });
        }
        if (Array.isArray(result.files)) {
          result.files = result.files.map((item) => {
            const name = item && (item.filename || item.name || item.path);
            if (!name) return item;
            const itemPath = item.path || path.join(resultDir, path.basename(String(name)));
            return {
              ...item,
              path: itemPath,
              canonicalPath: item.canonicalPath || canonicalizePath(itemPath),
            };
          });
        }
        const truth = reconcileArtifactTruth({
          result,
          resultDir,
          expectedArtifacts,
          canonicalizePath,
          excludedArtifactPaths: stagedInputFiles,
          stagedInputSnapshots,
        });
        const recorded = buildProvenance(truth.artifacts);
        result = attachProvenanceToResult(truth.result, recorded.provenance, recorded.provenancePath);
        writeArtifactManifest({
          outputDir: resultDir,
          result,
          provenance: recorded.provenance,
          plugin: recorded.pluginManifest,
        });
        if (truth.blocking) {
          const truthError =
            truth.issues
              .filter((issue) => issue.severity === 'error')
              .map((issue) => issue.message)
              .join('; ') || 'Required result artifacts are missing.';
          await markJobFailed(jobId, truthError, 'artifact_validation');
          await db
            .prepare('UPDATE tool_jobs SET result_json=? WHERE id=?')
            .run(JSON.stringify(result), jobId);
          return;
        }
        await db
          .prepare('UPDATE tool_jobs SET status=?, result_json=?, completed_at=? WHERE id=?')
          .run('completed', JSON.stringify(result), Date.now(), jobId);
        console.log('[tools] Job ' + jobId + ' completed');

        try {
          if (currentJob && currentJob.is_test_run) {
            fs.rmSync(jobDir, { recursive: true, force: true });
            console.log('[tools] Cleaned up test job dir: ' + jobId);
          }
        } catch (e) {
          console.warn('[tools] cleanup error:', e.message);
        }
      }
    );
    activeToolJobs.set(jobId, {
      process: child,
      startedAt: Date.now(),
      lastHeartbeatAt: Date.now(),
      toolId,
    });
    await db.prepare('UPDATE tool_jobs SET process_pid=?, heartbeat_at=? WHERE id=?').run(child.pid || null, Date.now(), jobId);
    const active = activeToolJobs.get(jobId);
    active.heartbeatTimer = setInterval(() => {
      try {
        refreshVerifiedHeartbeat({ active, jobId, db });
      } catch (error) {
        console.warn('[tools] heartbeat update failed:', error.message);
      }
    }, HEARTBEAT_INTERVAL_MS);
    active.heartbeatTimer.unref?.();
    hardTimeoutTimer = scheduleHardTimeout({ active, jobId, db, hardTimeoutMs });
  }

  function translateRError(rawError) {
    if (!rawError) return null;
    for (const { pattern, msg } of R_ERROR_TRANSLATIONS) {
      const m = rawError.match(pattern);
      if (m) return typeof msg === 'function' ? msg(m) : msg;
    }
    return null;
  }

  async function handleToolRun(req, res) {
    const uid = forwardedToolRunUserId(req);
    if (!uid) return res.status(401).json({ error: 'login_required' });
    const { toolId, params, files, projectId } = req.body || {};
    if (!toolId) return res.status(400).json({ error: 'missing_tool_id' });
    const isTest = isSmokeTestRequest(req);

    const jobId = 'job_' + uuidv4().replace(/-/g, '').slice(0, 16);

    // Phase 2: 使用项目目录解析器，或兜底到全局目录（历史兼容）
    let jobDir;
    let layout = null;
    if (projectId) {
      try {
        layout = resolveProjectRunLayout({
          projectId,
          toolJobId: jobId,
          db: dbMod,
          userId: uid,
          skipPermissionCheck: false,
          ensureDirs: true,
        });
        jobDir = layout.jobRoot;
      } catch (error) {
        console.warn('[tools] Failed to resolve project layout:', error.message);
        return res.status(400).json({
          error: 'project_layout_failed',
          message: error.message
        });
      }
    } else {
      // 兜底到全局目录（历史兼容，未来可移除）
      console.warn('[tools] No projectId provided, using legacy global directory');
      jobDir = path.join(jobsDir, jobId);
      config.mkdirSandbox(jobDir);
    }

    const uploadResult = writeUploadedFiles(jobDir, files);
    if (!uploadResult.ok) {
      try {
        fs.rmSync(jobDir, { recursive: true, force: true });
      } catch {}
      return res.status(400).json({ ok: false, error: uploadResult.error });
    }

    fs.writeFileSync(path.join(jobDir, 'params.json'), JSON.stringify(params || {}));

    const validationError = validateUploadedFiles(toolId, jobDir, files);
    if (validationError) {
      try {
        fs.rmSync(jobDir, { recursive: true, force: true });
      } catch {}
      return res.status(400).json({ ok: false, error: validationError });
    }

    if (!isTest) {
      const running = await db
        .prepare(
          "SELECT COUNT(*) as cnt FROM tool_jobs WHERE user_id = ? AND status IN ('pending','running') AND is_test_run = 0"
        )
        .get(uid);
      if (running && running.cnt >= 2)
        return res.status(429).json({
          error: 'max_concurrent',
          message: '最多同时运行 2 个分析任务，请等待当前任务完成',
        });
    }

    const toolNames = {
      deseq2: 'DESeq2',
      'go-kegg': 'GO/KEGG ORA',
      'km-survival': 'KM生存',
      gsea: 'GSEA',
      'bindea-immune': '免疫浸润',
      wgcna: 'WGCNA',
      'lasso-cox': 'LASSO Cox',
      'seurat-standard': 'Seurat',
      complexheatmap: 'ComplexHeatmap',
      'maftools-mutation': 'maftools',
      cellchat: 'CellChat',
      'ml-feature-select': 'ML特征选择',
      'ml-classifier': 'ML分类器',
      'rsf-survival': 'RSF生存森林',
      'shap-explain': 'SHAP',
      'consensus-cluster': '一致性聚类',
      'ml-scvi-annotate': 'scVI',
      'mo-mofa': 'MOFA2',
      'mo-snf': 'SNF',
    };
    const existCount = await db
      .prepare('SELECT COUNT(*) as cnt FROM tool_jobs WHERE user_id = ? AND tool_id = ?')
      .get(uid, toolId);
    const labelPrefix = isTest ? '🧪 ' : '';
    const jobName =
      labelPrefix + (toolNames[toolId] || toolId) + ' #' + ((existCount ? existCount.cnt : 0) + 1);

    await db
      .prepare(
        'INSERT INTO tool_jobs (id,user_id,tool_id,params_json,status,created_at,name,is_test_run,project_id) VALUES (?,?,?,?,?,?,?,?,?)'
      )
      .run(
        jobId,
        uid,
        toolId,
        JSON.stringify(params || {}),
        'pending',
        Date.now(),
        jobName,
        isTest ? 1 : 0,
        projectId || null
      );
    executeJob(jobId, toolId, jobDir, uploadResult.entries.map((entry) => entry.filePath));
    console.log(
      `[tools] Job ${jobId} submitted (tool=${toolId} rid=${req.requestId} user=${uid} test=${isTest})`
    );
    res.json({ ok: true, jobId, status: 'pending', isTestRun: isTest, requestId: req.requestId });
  }

  startZombieRecovery();

  return {
    handleToolRun,
    handlePrivateFileRead,
    handlePrivateFileWrite,
    handleGenerateFinalReport,
    killLocalToolJob,
    cleanupLocalToolJobDir,
  };
}

const TOOL_LIFECYCLE = resolveLifecycleDurations();
const ZOMBIE_TIMEOUT_MS = TOOL_LIFECYCLE.zombieTimeoutMs;
const HEARTBEAT_INTERVAL_MS = TOOL_LIFECYCLE.heartbeatIntervalMs;

const R_ERROR_TRANSLATIONS = [
  {
    pattern: /more columns than column names/i,
    msg: 'CSV 格式错误：列数不一致。请检查文件是否有多余的逗号，或者表头列数与数据列数不匹配。',
  },
  {
    pattern: /cannot open the connection|No such file or directory/i,
    msg: '文件读取失败：请确认上传的文件格式正确且未损坏。',
  },
  {
    pattern: /object '(\w+)' not found/i,
    msg: (m) => `数据中缺少必需的列或变量："${m[1]}"。请检查输入文件的列名是否正确。`,
  },
  {
    pattern: /cannot allocate vector of size/i,
    msg: '内存不足：数据太大，超出服务器内存限制(4GB)。建议：减少基因数或样本数后重试。',
  },
  {
    pattern: /there is no package called '(\w+)'/i,
    msg: (m) => `服务器缺少 R 包 "${m[1]}"，请联系管理员安装。`,
  },
  {
    pattern: /replacement has (\d+) rows, data has (\d+)/i,
    msg: '数据维度不匹配：行数不一致。请检查输入文件的样本数是否与实验设计一致。',
  },
  {
    pattern: /undefined columns selected/i,
    msg: '列名不存在：请检查参数中指定的列名是否在数据文件中存在（注意大小写）。',
  },
  {
    pattern: /duplicate 'row\.names'/i,
    msg: '行名重复：数据文件中有重复的基因名或样本名，请去重后重新上传。',
  },
  {
    pattern: /non-numeric argument to binary operator/i,
    msg: '数据类型错误：某些应该是数字的列包含了文本。请检查数据文件中是否有非数字字符（如 "NA" 文本、空格、特殊符号）。',
  },
  {
    pattern: /subscript out of bounds/i,
    msg: '数据索引越界：可能是筛选条件过严导致结果为空。请放宽筛选阈值（如降低 padj 或 log2FC 要求）后重试。',
  },
  {
    pattern: /Killed|exit code 137/i,
    msg: '任务被系统终止（内存超限）：数据量超出服务器容量。建议：减少输入数据量或联系管理员。',
  },
  {
    pattern: /timeout|timed out/i,
    msg: '分析超时（超过 5 分钟）：数据量可能过大。建议：减少基因数/样本数，或选择更快的分析参数。',
  },
  {
    pattern: /colData.*must have the same number/i,
    msg: 'coldata 与 counts 样本数不匹配：请确认 coldata 的行数等于 counts 的列数，且样本名一致。',
  },
  {
    pattern: /design matrix.*not full rank/i,
    msg: '实验设计矩阵不满秩：可能是某个分组只有 1 个样本，或分组变量有完全共线的列。请检查 coldata。',
  },
];

module.exports = {
  createToolsExecutor,
  _test: {
    isManagedResultDir,
    resolveUploadedFilePath,
    resolveUploadedFiles,
    writeUploadedFiles,
    validateUploadedFiles,
    hydrateExecutionJob,
    resolveProducedResultDirectory,
  },
};
