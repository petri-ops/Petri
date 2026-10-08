'use strict';

const fs = require('fs');
const path = require('path');
const { createResultArchive } = require('./result-archive');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const { StringDecoder } = require('node:string_decoder');
const { publishJobTerminalState } = require('./job-events');
const { decodeRDeparseManifest } = require('../../shared-backend/r-deparse-decode');
const {
  appendJobLiveLog,
  clearJobLiveLog,
  endJobLiveLog,
} = require('./job-live-log');
const {
  artifactContentTypeHint,
  captureStagedInputSnapshots,
  reconcileArtifactTruth,
} = require('./artifact-truth');
const {
  createVerifiedSnapshotReadStream,
  pipeVerifiedSnapshotToResponse,
  readVerifiedFileSnapshot,
} = require('./verified-file-snapshot');
const { injectReportTheme, isHtmlFile, normalizeReportTheme } = require('./report-theme');
const { materializeFinalReport } = require('./final-report');
const {
  createExecutionContext: createCanonicalExecutionContext,
} = require('../../shared-backend/execution-context');
const {
  resolveProjectRunLayout,
} = require('../../shared-backend/project-run-layout');
const { resolveRLibsForPlugin } = require('../../shared-backend/r-libs-resolver');
// BLOCK-83 D10：语言描述符 SPI——宿主按描述符取扩展名/标签/命令名，不再硬编码语言分支。
const {
  scriptExtensionFor,
} = require('../../shared-backend/script-host-languages');
const { ensureBundlesForPlugin, formatRequiredBundleFailure } = require('../../shared-backend/capability-bundles');
const { attachProvenanceToResult } = require('../../shared-backend/execution-provenance');
const { writeArtifactManifest } = require('../../shared-backend/artifact-manifest');
const { createRuntimeResourceSnapshot } = require('../../shared-backend/runtime-resource-snapshot');
const {
  createToolResourceSampler,
  directoryBytes,
  diskSnapshot,
} = require('../../shared-backend/tool-resource-sampler');
const {
  markUnownedStaleJobs,
  recoverStaleActiveJobs,
} = require('../helpers/process-lifecycle');
// BLOCK-135（PL-3 二刀）：分析级重试策略——纯函数分类 + env 门（默认关闭），见 tool-retry-policy.js
const {
  classifyToolJobFailure,
  getRetryMax,
  isRetryEnabled,
} = require('./tool-retry-policy');
const { createTargetRegistry } = require('./remote-execution/target-registry');
const { createRemoteJobRunner, AGENT_SCRIPT_HASH } = require('./remote-execution/remote-job-runner');
const { createSshDirectRunner, captureREnv } = require('./remote-execution/ssh-direct-runner');
const { createJobOutputReader } = require('./remote-execution/job-output-reader');
// BLOCK-92 Wave C-2：顶层 helpers 外迁 tools-executor/ 子模块（纯搬运）；
// createToolsExecutor 工厂闭包保留本文件（拆它需穿参重构闭包，超出纯搬运红线）。
const { buildJobProvenance } = require('./tools-executor/job-provenance');
const {
  buildCancelledToolResult,
  buildFailedToolResult,
  isManagedResultDir,
  mergeFinalOutputMeasurement,
  parseStoredToolResult,
} = require('./tools-executor/tool-result-misc');
const {
  armActiveToolJobLifecycle,
  persistVerifiedToolJobHeartbeat,
  canLaunchOwnedToolJob,
  claimActiveToolJob,
  clearActiveToolJobLifecycleTimers,
  handleActiveToolJobSetupFailure,
  releaseActiveToolJob,
  requestActiveToolJobCancellation,
  settleConfirmedToolCancellation,
  terminateOwnedToolJobProcess,
  transitionToolJobToCompleted,
  transitionToolJobToFailed,
} = require('./tools-executor/active-job');
const {
  hydrateExecutionJob,
  openVerifiedAuthorizedToolResultFile,
  resolveAuthorizedToolResultFile,
  resolveProducedResultDirectory,
  resolveStoredArtifactTruthBinding,
  resolveUploadedFiles,
  resolveUploadedFilePath,
  validateUploadedFiles,
  writeUploadedFiles,
} = require('./tools-executor/result-files');
const {
  evaluateRuntimePreflight,
  HEARTBEAT_INTERVAL_MS,
  R_ERROR_TRANSLATIONS,
  TOOL_LIFECYCLE,
  ZOMBIE_TIMEOUT_MS,
} = require('./tools-executor/preflight');

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
  // BLOCK-128：activeToolJobs 改用进程级共享登记表——agent/MCP 同步路径
  //（run-plugin-script）与 HTTP 异步路径共用同一 owner 装置（心跳/硬超时/
  // 僵尸扫描/取消链对两条路径同等生效）。生产单进程单 executor，语义等价。
  const { activeToolJobs, setSchedulerPump, notifyScheduler } = require('./tool-job-lifecycle-registry');
  // BLOCK-76 P5 — 直跑作业取消登记：jobId → { runner, pid }（killLocalToolJob 对账用）
  const activeDirectJobs = new Map();
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
    // BLOCK-76 P5 — 直跑作业取消：本地 durable 取消态照常落定；activeDirectJobs
    // 登记的节点侧进程组由直跑轮询循环对账收敛为 cancelled（节点真相胜出）。
    void (async () => {
      const direct = activeDirectJobs.get(jobId);
      if (direct) {
        await direct.runner.cancel({ pid: direct.pid }).catch(() => {});
      }
    })();
    return requestActiveToolJobCancellation(activeToolJobs, jobId);
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
    const job = req.toolJob;
    if (!job || String(job.id) !== String(req.params.jobId)) {
      return res.status(404).json({ error: 'job_not_found' });
    }

    // BLOCK-76 P2 — SSH 直跑作业产物读面走 Gateway（服务器 output 为真值，R3/R4）。
    // 非 ssh 作业 reader 返回 null，本地链逐字节不变（历史只读兼容）。
    const sshProjectRow = await dbMod.getAsyncDatabase()
      .prepare('SELECT id, workspace_kind, ssh_host, remote_path FROM projects WHERE id = ?')
      .get(job.project_id);
    const sshReader = createJobOutputReader({ job, project: sshProjectRow });
    const __diagMeta = (() => {
      try {
        const m = typeof job.result_json === 'string' ? JSON.parse(job.result_json) : job.result_json;
        return m ? 'ws=' + m.workspaceKind + ' op=' + (m.outputPath || '') + ' pid=' + job.project_id : 'no-meta';
      } catch { return 'parse-err'; }
    })();
    if (sshReader) {
      const filename = String(req.params.filename || '');
      try {
        const stat = await sshReader.statFile(filename);
        if (!stat) { if (process.env.BIOF3_B76_DEBUG) console.error('[b76-reader] file stat null for', filename); return res.status(404).json({ error: 'file_not_found' }); }
        const buf = await sshReader.readFile(filename);
        const theme = normalizeReportTheme(req?.query?.theme);
        if (theme && isHtmlFile(filename)) {
          return res.type('html').set('Cache-Control', 'private, no-store').send(injectReportTheme(buf.toString('utf8'), theme));
        }
        return res
          .type(artifactContentTypeHint(filename))
          .set('Cache-Control', 'private, no-store')
          .set('Content-Length', String(buf.length))
          .send(buf);
      } catch (e) {
        if (e.code === 'artifact_too_large') {
          return res.status(409).json({ error: 'artifact_too_large', size: e.size });
        }
        return res.status(404).json({ error: 'file_not_found' });
      }
    }

    let layout = null;
    if (job.project_id) {
      try {
        layout = resolveProjectRunLayout({
          projectId: job.project_id,
          toolJobId: job.id,
          db: dbMod,
          skipPermissionCheck: true,
          ensureDirs: false,
        });
      } catch (error) {
        console.warn('[tools] Project layout resolution failed for file read:', error.message);
        return res.status(404).json({ error: 'file_not_found' });
      }
    }

    const resolved = resolveAuthorizedToolResultFile({
      job,
      filename: req.params.filename,
      layout,
      jobsDir,
    });
    if (!resolved.ok) {
      const status = resolved.error === 'bad_path'
        ? 400
        : resolved.error.startsWith('artifact_')
          ? 409
          : 404;
      return res.status(status).json({ error: resolved.error });
    }
    const opened = await openVerifiedAuthorizedToolResultFile(resolved);
    if (!opened.ok) {
      return res.status(opened.error === 'artifact_truth_drift' ? 409 : 404).json({ error: opened.error });
    }

    const theme = normalizeReportTheme(req?.query?.theme);
    if (theme && isHtmlFile(resolved.filePath)) {
      try {
        const html = await readVerifiedFileSnapshot(opened, { encoding: 'utf8' });
        return res.type('html').set('Cache-Control', 'private, no-store').send(injectReportTheme(html, theme));
      } catch {
        return res.status(404).json({ error: 'file_not_found' });
      }
    }

    // Each fixed block is hashed before the exact Buffer read from the
    // unlinked descriptor is pushed. A retained writer can therefore abort a
    // response, but cannot make the route send bytes outside Snapshot Truth.
    const stream = createVerifiedSnapshotReadStream(opened);
    stream.once('error', (error) => {
      if (!res.headersSent) {
        res.status(404).json({ error: 'file_not_found' });
      } else {
        res.destroy(error);
      }
    });
    res
      .type(artifactContentTypeHint(resolved.filePath))
      .set('Cache-Control', 'private, no-store')
      .set('Content-Length', String(opened.stat.size));
    return pipeVerifiedSnapshotToResponse(stream, req, res);
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

      // BLOCK-76 P2 — SSH 直跑作业：远端产物镜像到临时目录复用本地组装器，
      // 生成的报告写回服务器 output/（真值在服务器），url 走 tools/file ssh 读面。
      {
        const meta = result && typeof result === 'object' ? result : null;
        if (meta && meta.workspaceKind === 'ssh') {
          const sshProjectRow = await dbMod.getAsyncDatabase()
            .prepare('SELECT id, workspace_kind, ssh_host, remote_path FROM projects WHERE id = ?')
            .get(job.project_id);
          const { createJobOutputReader } = require('./remote-execution/job-output-reader');
          const reader = createJobOutputReader({ job, project: sshProjectRow });
          if (reader) {
            const os = require('os');
            require('./workspace-gateway');
            const outputs = await reader.list();
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b76-report-'));
            try {
              for (const f of outputs) {
                if (f.size > 16 * 1024 * 1024) continue; // 超预算产物不进报告，诚实省略
                const buf = await reader.readFile(f.name);
                fs.writeFileSync(path.join(tmp, f.name), buf);
              }
              const theme = normalizeReportTheme(req.body?.theme);
              const report = materializeFinalReport({
                outputDir: tmp,
                transformHtml: theme ? (html) => injectReportTheme(html, theme) : undefined,
              });
              await reader.writeFile(report.fileName, fs.readFileSync(path.join(tmp, report.fileName)));
              return res.json({
                ok: true,
                ...report,
                theme,
                url: `/api/tools/file/${encodeURIComponent(req.params.jobId)}/${report.fileName}`,
              });
            } finally {
              try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
            }
          }
        }
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
      // BLOCK-57：远程作业无本地子进程，本地 stale-kill 语义不适用（D5.3 连不上≠作业死）。
      const locallyOwned = new Map([...activeToolJobs].filter(([, active]) => !active.remote));
      await recoverStaleActiveJobs({ activeJobs: locallyOwned, cutoff, db });
      const result = await markUnownedStaleJobs({
        db,
        cutoff,
        ownedJobIds: activeToolJobs.keys(),
        excludeRemoteTargets: true,
      });
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
      // BLOCK-57：远程作业对账恢复（D5.2）——running + 有目标 + 本进程无 owner
      // （重启遗留）→ re-attach；节点状态真相决定终态。
      try {
        const remoteRunning = await db
          .prepare("SELECT id FROM tool_jobs WHERE status='running' AND execution_target_id IS NOT NULL")
          .all();
        for (const row of remoteRunning) {
          if (!activeToolJobs.has(row.id)) {
            await adoptSshDirectJob(row.id);
          }
        }
      } catch (e) {
        console.warn('[tools] remote re-adopt scan failed:', e.message);
      }
    } catch (e) {
      console.warn(`[tools] recoverZombieJobs failed: ${e.message} — skipping startup scan`);
    }
  }

  function startZombieRecovery() {
    recoverZombieJobs({ startup: true });
    const timer = setInterval(
      () => {
        void recoverZombieJobs({ startup: false });
      },
      5 * 60 * 1000
    );
    // 后台清扫不拥有进程生命周期（与 event-bus.js:45 / federation-terminal.js:66 /
    // resident-revisit.js:233 同惯例）：server 进程存活由监听套接字决定，清扫定时器
    // unref 后不再独自吊住事件循环——否则构造本工厂的测试进程永不退出。
    if (typeof timer.unref === 'function') timer.unref();
  }

  // BLOCK-130（PL-3 队列化）：终态调度泵——槽位释放后按创建序拉起排队的
  // pending 作业。一次泵只拉一个（executeJob 的 CAS 起跑是异步的，连续
  // 拉起会基于陈旧计数超发；每个终态都会触发泵，多释放=多泵消化）。
  function resolveQueuedJobRoot(row) {
    if (row.project_id) {
      try {
        return resolveProjectRunLayout({
          projectId: row.project_id,
          toolJobId: row.id,
          db: dbMod,
          skipPermissionCheck: true,
          ensureDirs: false,
        }).jobRoot;
      } catch { return null; }
    }
    return path.join(jobsDir, row.id);
  }

  async function pumpQueuedToolJobs() {
    const maxConcurrent = Number(process.env.BIOF3_TOOL_MAX_CONCURRENT || 2);
    // db 是 async facade（db/connection.js）：all()/get() 返回 Promise，必须 await——
    // 漏 await 时 rows 是 Promise，for-of 直接 TypeError 且被注册处 .catch 静默吞掉，
    // 泵整体假死（BLOCK-135 复核发现：BLOCK-130 既有缺陷，重试闭环依赖此泵）。
    const rows = await db
      .prepare("SELECT id, user_id, tool_id, project_id FROM tool_jobs WHERE status = 'pending' AND is_test_run = 0 ORDER BY created_at ASC LIMIT 50")
      .all();
    for (const row of rows) {
      // C-23（BLOCK-144 行为测暴露，HK-01 红转绿）：占用计数只算 running。
      // 旧计数 `status IN ('pending','running')` 把候选行自身与其它排队行也算进
      // 并发占用：A/B 运行 + C/D 排队时，A 完成后 C 的计数=B+C+D=3≥max 跳过，
      // B 完成后仍=C+D=2≥max 跳过——队列永久搁浅（zombie 扫描只会把搁浅行标
      // failed，无重跑），违背本泵「槽位释放后按创建序拉起」的自述契约。
      // pending 是排队深度不是执行占用；超发防护仍由「一次泵只拉一个 +
      // executeJob 的 pending→running CAS」（本函数头注）承担。
      const active = await db
        .prepare("SELECT COUNT(*) AS n FROM tool_jobs WHERE user_id = ? AND status = 'running' AND is_test_run = 0")
        .get(row.user_id);
      if (!active || active.n >= maxConcurrent) continue;
      const jobRoot = resolveQueuedJobRoot(row);
      if (!jobRoot || !fs.existsSync(jobRoot)) continue;
      // staged 输入重建：入队时 jobDir 顶层只有上传件（脚本复制发生在
      // executeJob 内部），按文件枚举即恢复 staged 列表（重启安全）。
      const staged = fs.readdirSync(jobRoot)
        .filter((name) => { try { return fs.statSync(path.join(jobRoot, name)).isFile(); } catch { return false; } })
        .map((name) => path.join(jobRoot, name));
      console.log('[tools] Queue pump starting job ' + row.id + ' (user=' + row.user_id + ')');
      void executeJob(row.id, row.tool_id, jobRoot, staged)
        .catch((error) => handleActiveToolJobSetupFailure({ activeToolJobs, jobId: row.id, error, markFailed: markJobFailed }))
        .catch((error) => console.warn('[tools] Queue pump start failed for job ' + row.id + ':', error.message));
      return;
    }
  }

  setSchedulerPump(() => {
    void pumpQueuedToolJobs().catch((error) => {
      // 泵故障不阻断终态收敛（下一终态再触发），但不许静默——漏 await 的
      // TypeError 长期假死正是被这里的空 catch 吞掉（BLOCK-135 复核发现）。
      console.warn('[tools] queue pump failed:', error.message);
    });
  });

  async function markJobFailed(jobId, errorMsg, stage) {
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
    const failed = await transitionToolJobToFailed({ db, jobId, error: errStr });
    if (!failed || failed.changes < 1) {
      console.log('[tools] Job ' + jobId + ' reached another terminal state; skip failure overwrite');
      return;
    }
    const translated = translateRError(errStr);
    if (translated) {
      const combined = '💡 ' + translated + '\n\n--- 原始错误信息 ---\n' + errStr;
      await db
        .prepare('UPDATE tool_jobs SET error=? WHERE id=? AND status=?')
        .run(combined, jobId, 'failed');
    }
    try {
      const job = await db
        .prepare('SELECT user_id, tool_id, name, project_id, created_at, is_test_run FROM tool_jobs WHERE id=?')
        .get(jobId);
      if (!job) return;
      if (job.is_test_run) return;
      // BLOCK-78 P2-⑤：失败终态持久通知（best-effort，绝不阻断作业链路）
      if (job.project_id) {
        try {
          const { getProjectNoticeStore } = require('./project-notice-store');
          getProjectNoticeStore().insertNotice({
            projectId: job.project_id,
            kind: 'job_failed',
            title: `${job.name || job.tool_id} 失败`,
            detail: errStr.slice(0, 300),
          });
        } catch { /* 通知面故障不影响作业链 */ }
      }
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

    // Built-in registry is the local R-tool fallback. Python tools run locally via the executor registry.
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

  // BLOCK-57 —— 远程执行编排（daemonless：节点真相在 state/exit 文件，见设计评审 D1/D4/D5）
  const targetRegistry = createTargetRegistry({ db, ensureAgent: ({ alias }) => remoteRunner.ensureAgent({ alias }) });
  const remoteRunner = createRemoteJobRunner();

  const REMOTE_RUNNER_SAMPLES = {
    peak: {},
    sampling: { status: 'unavailable', sampleCount: null, reason: 'remote_execution' },
    peakStatus: 'unavailable',
  };
  const REMOTE_LOG_CAP_BYTES = 10 * 1024 * 1024;

  /**
   * 提交前解析执行目标：目标存在 → 节点探测 → 语言运行时解析（诚实失败）。
   * argmode 镜像本地 spawn 约定：R 一律 job_dir；Python 插件 job_dir / 内置 params。
   */
  async function resolveRemoteTargetForJob({ cfg, targetId }) {
    const target = await targetRegistry.getById({ id: targetId });
    if (!target) {
      return { error: true, stage: 'setup', message: '执行目标不存在或已被移除（' + String(targetId).slice(0, 40) + '）' };
    }
    const probe = await targetRegistry.probe({ id: target.id });
    if (!probe.ok) {
      return { error: true, stage: 'setup', message: '执行目标探测失败（' + probe.error + '）：' + (probe.detail || '') };
    }
    const runtime = remoteRunner.resolveRuntime(probe.info, cfg.lang);
    // 目标级运行时覆盖（module 系统 / 非 PATH 安装）优先于探测结果
    let override = null;
    try { override = target.runtime_json ? JSON.parse(target.runtime_json) : null; } catch { override = null; }
    const overrideBin = override && typeof override[cfg.lang] === 'string' ? override[cfg.lang] : null;
    if (overrideBin) {
      runtime.ready = true;
      runtime.runtimeBin = overrideBin;
      runtime.reason = null;
      runtime.overridden = true;
    }
    if (!runtime.ready) {
      return { error: true, stage: 'runtime', message: runtime.reason + '（目标 ' + target.alias + '）' };
    }
    const argmode = cfg.lang === 'r' || cfg._isPlugin ? 'jobdir' : 'params';
    return { target, probeInfo: probe.info, runtime, argmode, mode: 'submit' };
  }

  async function runSshDirectToolJob({
    owner,
    jobId,
    jobDir,
    cfg,
    sshContext,
    remoteDispatch,
    markFailed,
  }) {
    let runner;
    try {
      runner = createSshDirectRunner({ project: sshContext.project });
    } catch (e) {
      await markFailed(jobId, 'SSH 直跑初始化失败：' + e.message, 'setup');
      activeDirectJobs.delete(jobId);
      releaseActiveToolJob(activeToolJobs, jobId, owner);
      return;
    }
    const alias = sshContext.project.ssh_host;
    const outputRel = `results/jobs/${jobId}/output`;

    owner.phase = 'remote-submitting';
    const staged = await runner.stage({ jobId, localJobDir: jobDir }).catch((e) => ({
      ok: false,
      stage: 'stage',
      error: { kind: 'ssh_direct_transport', retryable: true, detail: e.message },
    }));
    if (!staged.ok) {
      await markFailed(jobId, 'SSH 直跑编排面上传失败（' + staged.stage + '/' + staged.error.kind + '）：' + (staged.error.detail || ''), 'setup');
      activeDirectJobs.delete(jobId);
      releaseActiveToolJob(activeToolJobs, jobId, owner);
      return;
    }
    const started = await runner.start({ jobId, lang: cfg.lang, runtimeBin: remoteDispatch.runtime.runtimeBin }).catch((e) => ({
      ok: false,
      stage: 'start',
      error: { kind: 'ssh_direct_transport', retryable: true, detail: e.message },
    }));
    if (!started.ok) {
      await markFailed(jobId, 'SSH 直跑启动失败（' + started.stage + '/' + started.error.kind + '）：' + (started.error.detail || ''), 'execute');
      activeDirectJobs.delete(jobId);
      releaseActiveToolJob(activeToolJobs, jobId, owner);
      return;
    }
    const pid = started.pid;
    activeDirectJobs.set(jobId, { runner, pid });

    owner.phase = 'remote-running';
    let stdoutText = '';
    const mirrorLogPath = path.join(jobDir, 'output', 'remote-runner.log');
    const appendLog = (text) => {
      stdoutText = (stdoutText + text).slice(-REMOTE_LOG_CAP_BYTES);
      try { fs.appendFileSync(mirrorLogPath, text); } catch {}
    };

    let logOffset = 0;
    let unknownCount = 0;
    let cancelSent = false;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_INTERVAL_MS));
      // 日志增量：服务器 run.log 为真值，本地 output/remote-runner.log 仅为运行期镜像缓存（R4）。
      try {
        const log = await runner.pullLog({ jobId, offset: logOffset });
        if (log.chunk && log.chunk.length > 0) {
          logOffset += log.chunk.length;
          appendLog(log.chunk.toString('utf8'));
        }
      } catch { /* 日志传输失败不影响状态轮询 */ }
      if (owner.cancelRequested && !cancelSent) {
        cancelSent = true;
        await runner.cancel({ pid }).catch(() => {});
      }
      let status;
      try {
        status = await runner.poll({ jobId, pid });
      } catch {
        status = { ok: true, kind: 'unknown' };
      }
      if (!status.ok || status.kind === 'unknown') {
        unknownCount += 1;
        if (unknownCount >= 3 && !owner.cancelRequested) {
          await markFailed(jobId, 'SSH 直跑：节点侧连续无应答（进程与退出标记均不可见），诚实失败', 'execute');
          activeDirectJobs.delete(jobId);
      releaseActiveToolJob(activeToolJobs, jobId, owner);
          return;
        }
        if (owner.cancelRequested && unknownCount >= 2) break; // 取消后进程组已死且无 .exit——按取消收敛
        continue;
      }
      if (status.kind === 'active') {
        unknownCount = 0;
        try {
          await db.prepare("UPDATE tool_jobs SET heartbeat_at=? WHERE id=? AND status='running'").run(Date.now(), jobId);
        } catch {}
        owner.lastHeartbeatAt = Date.now();
        continue;
      }
      break; // terminal —— .exit 标记真值
    }

    // ── 终态收敛（独立于本地 finalizeJobRun：产物面在服务器，本地文件副作用仅日志镜像）──
    if (owner.cancelRequested) {
      const cancelledResult = buildCancelledToolResult({
        existingResult: null,
        jobId,
        resourceUsage: REMOTE_RUNNER_SAMPLES,
        executionProvenance: null,
        provenanceRef: null,
      });
      try {
        await settleConfirmedToolCancellation({ db, jobId, result: cancelledResult });
      } catch (error) {
        console.warn('[tools] ssh-direct cancelled terminal persistence failed:', error.message);
      }
      activeDirectJobs.delete(jobId);
      releaseActiveToolJob(activeToolJobs, jobId, owner);
      return;
    }
    const exit = await runner.poll({ jobId, pid }).catch(() => ({ ok: true, kind: 'unknown' }));
    const code = exit.kind === 'terminal' ? exit.code : null;
    if (!Number.isFinite(code) || code !== 0) {
      const failedResult = buildFailedToolResult({
        existingResult: null,
        jobId,
        reason: Number.isFinite(code) ? 'nonzero_exit' : 'node_unknown_terminal',
        exitCode: Number.isFinite(code) ? code : null,
        resourceUsage: REMOTE_RUNNER_SAMPLES,
        executionProvenance: null,
        provenanceRef: null,
      });
      try {
        await db
          .prepare('UPDATE tool_jobs SET result_json=? WHERE id=? AND status IN (?,?,?)')
          .run(JSON.stringify(failedResult), jobId, 'pending', 'running', 'failed');
      } catch (error) {
        console.warn('[tools] ssh-direct failed terminal persistence failed:', error.message);
      }
      await markFailed(jobId, `SSH 直跑脚本退出码 ${Number.isFinite(code) ? code : '未知'}（详见服务器 results/jobs/${jobId}/output/run.log）`, 'execute');
      activeDirectJobs.delete(jobId);
      releaseActiveToolJob(activeToolJobs, jobId, owner);
      return;
    }
    const outputs = await runner.listOutputs({ jobId });
    // BLOCK-76 P3 — provenance 环境留痕平移：服务器 R 包清单（D4，沿用 BLOCK-57 P3 语义）
    let environment = null;
    if (cfg.lang === 'r') {
      try {
        const { resolveWorkspaceBackend } = require('./workspace-gateway');
        const rres = resolveWorkspaceBackend(sshContext.project);
        if (rres.backend) environment = await captureREnv(rres.backend, rres.root);
      } catch (e) {
        console.warn('[tools] ssh-direct R env capture failed:', e.message);
      }
    }
    const result = {
      workspaceKind: 'ssh',
      ssh: { alias, path: sshContext.project.remote_path },
      outputPath: outputRel,
      transport: 'gateway-ssh-direct',
      runtime: { name: cfg.lang || null, version: remoteDispatch.runtime.version, command: remoteDispatch.runtime.runtimeBin },
      environment,
      files: outputs.ok
        ? outputs.outputs.map((f) => ({
          name: f.name,
          type: f.name.endsWith('.png') ? 'plot' : f.name.endsWith('.csv') ? 'table' : 'file',
          url: '/api/tools/file/' + jobId + '/' + f.name,
          size: f.size,
        }))
        : [],
    };
    try {
      await transitionToolJobToCompleted({ db, jobId, result });
    } catch (error) {
      console.warn('[tools] ssh-direct completed terminal persistence failed:', error.message);
    }
    activeDirectJobs.delete(jobId);
      releaseActiveToolJob(activeToolJobs, jobId, owner);
  }
  /**
   * 重启恢复（D5.2 启动扫描）：re-attach 节点侧仍在运行的远程作业，走同一
   * 收尾工厂。节点探测失败不标败（连不上≠作业死），留待下次扫描。
   */
  /**
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
      const outputBase = `results/jobs/${jobId}/output`;
      let exitCode = null;
      try {
        const exitBuf = await (require('./workspace-gateway').resolveWorkspaceBackend(sshProjectRow).backend).read(`${outputBase}/.exit`);
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

  function createJobRunFinalizer(deps) {
    const {
      owner,
      jobId,
      toolId,
      cfg,
      jobDir,
      outputDir,
      stagedInputFiles,
      stagedInputSnapshots,
      buildProvenance,
      resourceStart,
      runtimeCommand,
      runtimeReady,
      hardTimeoutMs,
    } = deps;
    return async function finalizeJobRun({ err, stdout, stderr, sampledResources }) {
      try {
        const active = owner;
        clearActiveToolJobLifecycleTimers(active);
        const resourceEnd = createRuntimeResourceSnapshot({
          disk: diskSnapshot(outputDir),
          runtime: { r: cfg.lang === 'r' && runtimeReady?.ready, python: cfg.lang === 'python' && runtimeReady?.ready },
          activeJobs: Math.max(
            0,
            activeToolJobs.size - (activeToolJobs.get(jobId) === owner ? 1 : 0),
          ),
          observedAt: new Date().toISOString(),
        });
        const resourceUsage = { start: resourceStart, end: resourceEnd, ...sampledResources };
        try {
          const log = `=== STDOUT ===\n${stdout || ''}\n\n=== STDERR ===\n${stderr || ''}\n\n=== EXIT ===\n${err ? 'ERROR: ' + err.message : 'OK'}\nTimestamp: ${new Date().toISOString()}\n`;
          fs.writeFileSync(path.join(outputDir, 'run.log'), log);
        } catch {}

        let currentJob = null;
        try {
          currentJob = await db
            .prepare('SELECT status, is_test_run, result_json FROM tool_jobs WHERE id=?')
            .get(jobId);
        } catch {}
        const finalizeCancellation = async (recorded = null) => {
          try {
            const finalOutput = await directoryBytes(outputDir);
            mergeFinalOutputMeasurement(resourceUsage, finalOutput);
          } catch {
            // Periodic samples remain truthful when the final directory scan is unavailable.
          }
          let cancellationProvenance = recorded;
          if (!cancellationProvenance) {
            try { cancellationProvenance = buildProvenance(); } catch {}
          }
          const cancelledResult = buildCancelledToolResult({
            existingResult: parseStoredToolResult(currentJob),
            jobId,
            resourceUsage,
            executionProvenance: cancellationProvenance?.provenance || null,
            provenanceRef: cancellationProvenance ? {
              provenanceHash: cancellationProvenance.provenance.provenanceHash,
              path: cancellationProvenance.provenancePath,
              toolJobId: jobId,
            } : null,
          });
          try {
            await settleConfirmedToolCancellation({ db, jobId, result: cancelledResult });
          } catch (error) {
            console.warn('[tools] cancelled Job terminal persistence failed:', error.message);
          }
          console.log('[tools] Job ' + jobId + ' cancellation confirmed by process exit');
        };
        if (active && active.cancelRequested) {
          await finalizeCancellation();
          return;
        }
        if (currentJob && currentJob.status === 'cancelled') {
          await finalizeCancellation();
          return;
        }

        const executionFailure = err || active.setupFailure;
        if (executionFailure) {
          // BLOCK-135（PL-3 二刀）：重试计数读取（列由 db/schema.js additive 迁移保证；
          // db 是 async facade（db/connection.js createAsyncDatabaseFacade），get 返回
          // Promise——漏 await 时 Promise?.retry_count 恒 undefined，retryCount 恒 0，
          // 重试预算永不耗尽。await 后查询失败才真正落 catch 按 0 处理=不重试，
          // 不阻断既有失败收敛。
          let retryCount = 0;
          try {
            retryCount =
              (await db.prepare('SELECT retry_count FROM tool_jobs WHERE id=?').get(jobId))?.retry_count ?? 0;
          } catch {}
          // BLOCK-135：分析级重试——默认关闭（BIOF3_TOOL_RETRY_MAX>0 才启用），加法式接入。
          // 取消与 executor setup 失败不接（确定性路径语义不变）；仅「外部 SIGKILL 且非取消
          // 请求」判瞬态（系统 OOM/资源挤占）。分类判定见 helpers/tool-retry-policy.js。
          if (!active?.setupFailure && !active?.cancelRequested && isRetryEnabled()) {
            const retryClassification = classifyToolJobFailure({
              exitCode: err?.code ?? null,
              signal: err?.signal ?? null,
              timedOut: Boolean(active?.timedOut),
              setupFailure: Boolean(active?.setupFailure),
              cancelRequested: Boolean(active?.cancelRequested),
              recoveryRequested: Boolean(active?.recoveryRequested),
            });
            const retryMax = getRetryMax();
            let retried = null;
            if (retryClassification.transient && retryCount < retryMax) {
              try {
                // is_test_run = 0：泵的候选 SELECT 同滤测试作业——测试作业重排会
                // 被泵永久忽略、搁浅在 pending 直到僵尸扫描误标 failed（并发槽
                // 同被占用）。测试作业不重排，随既有失败语义收敛。
                retried = await db
                  .prepare(
                    "UPDATE tool_jobs SET status='pending', retry_count=retry_count+1, error=NULL, heartbeat_at=NULL WHERE id=? AND status='running' AND is_test_run = 0",
                  )
                  .run(jobId);
              } catch (error) {
                console.warn('[tools] Job ' + jobId + ' retry requeue failed:', error.message);
              }
            }
            if (retried && retried.changes >= 1) {
              console.log('[tools] Job ' + jobId + ' 进入重试 (' + (retryCount + 1) + '/' + retryMax + ')：瞬态原因 ' + retryClassification.reason);
              // owner 必须先于泵释放：notifyScheduler 同步直达 claimActiveToolJob，
              // 迟释放会让重跑被「already has an active execution owner」吞掉
              //（finally 的幂等 release 不受影响）。
              releaseActiveToolJob(activeToolJobs, jobId, owner);
              notifyScheduler();
              return;
            }
          }
          let failed = null;
          try {
            failed = buildProvenance();
          } catch (error) {
            console.warn('[tools] failed Job provenance persistence failed:', error.message);
          }
          const failedResult = buildFailedToolResult({
            existingResult: parseStoredToolResult(currentJob),
            jobId,
            reason: active.setupFailure
              ? 'executor_setup_failure'
              : active?.timedOut
                ? 'hard_timeout'
                : err.killed
                  ? 'terminated'
                  : 'nonzero_exit',
            exitCode: err?.code ?? null,
            resourceUsage,
            executionProvenance: failed?.provenance || null,
            provenanceRef: failed ? {
              provenanceHash: failed.provenance.provenanceHash,
              path: failed.provenancePath,
              toolJobId: jobId,
            } : null,
          });
          try {
            await db
              .prepare('UPDATE tool_jobs SET result_json=? WHERE id=? AND status IN (?,?,?)')
              .run(JSON.stringify(failedResult), jobId, 'pending', 'running', 'failed');
          } catch (error) {
            console.warn('[tools] failed Job resource summary persistence failed:', error.message);
          }
          if (active.cancelRequested) {
            await finalizeCancellation(failed);
            return;
          }
          const baseFailureMessage = active?.timedOut
            ? `任务超过最大运行预算 ${hardTimeoutMs}ms；子进程退出已确认`
            : active.setupFailure?.message || stderr || err?.message || '';
          // BLOCK-135：重试额度耗尽才走到终态收敛；经历过重试的失败消息如实注明次数。
          const failureMessage = retryCount > 0
            ? baseFailureMessage + `（已重试 ${retryCount} 次后仍失败）`
            : baseFailureMessage;
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
            if (active.cancelRequested) {
              await finalizeCancellation();
              return;
            }
            await markJobFailed(jobId, `Result archive failed: ${archiveError.message}`, 'postprocess');
            return;
          }
        }

        let result = {};
        if (fs.existsSync(manifestPath)) {
          try {
            const manifest = decodeRDeparseManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))); // BLOCK-133：R deparse <U+XXXX> 解码
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
        try {
          const finalOutput = await directoryBytes(resultDir);
          mergeFinalOutputMeasurement(resourceUsage, finalOutput);
        } catch {
          // Process/system samples remain valid when final output accounting is unavailable.
        }
        result.resourceUsage = resourceUsage;
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
        if (active.cancelRequested) {
          await finalizeCancellation(recorded);
          return;
        }
        if (truth.blocking) {
          const truthError =
            truth.issues
              .filter((issue) => issue.severity === 'error')
              .map((issue) => issue.message)
              .join('; ') || 'Required result artifacts are missing.';
          await markJobFailed(jobId, truthError, 'artifact_validation');
          await db
            .prepare('UPDATE tool_jobs SET result_json=? WHERE id=? AND status=?')
            .run(JSON.stringify(result), jobId, 'failed');
          return;
        }
        const completed = await transitionToolJobToCompleted({ db, jobId, result });
        if (!completed || completed.changes < 1) {
          if (active.cancelRequested) await finalizeCancellation(recorded);
          return;
        }
        console.log('[tools] Job ' + jobId + ' completed');

        try {
          if (currentJob && currentJob.is_test_run) {
            fs.rmSync(jobDir, { recursive: true, force: true });
            console.log('[tools] Cleaned up test job dir: ' + jobId);
          }
        } catch (e) {
          console.warn('[tools] cleanup error:', e.message);
        }
        } catch (callbackError) {
          console.warn('[tools] Job ' + jobId + ' finalization failed:', callbackError.message);
          try {
            await markJobFailed(jobId, `Job finalization failed: ${callbackError.message}`, 'finalize');
          } catch (persistenceError) {
            console.warn('[tools] Job finalization failure persistence failed:', persistenceError.message);
          }
        } finally {
          releaseActiveToolJob(activeToolJobs, jobId, owner);
        }
      };
    }

  async function executeJob(jobId, toolId, jobDir, stagedInputFiles = [], sshContext = null) {
    const owner = claimActiveToolJob(activeToolJobs, { jobId, toolId });
    if (!owner) {
      console.warn('[tools] Job ' + jobId + ' already has an active execution owner');
      return;
    }
    const started = await db
      .prepare('UPDATE tool_jobs SET status = ? WHERE id = ? AND status = ?')
      .run('running', jobId, 'pending');
    if (!started || started.changes < 1) {
      releaseActiveToolJob(activeToolJobs, jobId, owner);
      console.log('[tools] Job ' + jobId + ' not started because it is no longer pending');
      return;
    }
    const job = hydrateExecutionJob(
      await db.prepare('SELECT * FROM tool_jobs WHERE id = ?').get(jobId)
    );
    if (!job) {
      await markJobFailed(jobId, 'Tool job disappeared before execution.', 'setup');
      releaseActiveToolJob(activeToolJobs, jobId, owner);
      return;
    }
    let stagedInputSnapshots;
    try {
      stagedInputSnapshots = captureStagedInputSnapshots(stagedInputFiles);
    } catch (error) {
      await markJobFailed(jobId, `Staged input snapshot failed: ${error.message}`, 'setup');
      releaseActiveToolJob(activeToolJobs, jobId, owner);
      return;
    }
    const outputDir = path.join(jobDir, 'output');
    config.mkdirSandbox(outputDir);

    const cfg = getToolConfig(toolId);
    if (!cfg) {
      await markJobFailed(jobId, 'Unknown tool: ' + toolId, 'config');
      releaseActiveToolJob(activeToolJobs, jobId, owner);
      return;
    }

    // 插件脚本：cfg.script 已是绝对路径；内置工具：拼 scriptsDir
    const scriptSrc = cfg._isPlugin ? cfg.script : path.join(scriptsDir, cfg.script);
    if (!fs.existsSync(scriptSrc)) {
      await markJobFailed(jobId, 'Script not found: ' + cfg.script, 'config');
      releaseActiveToolJob(activeToolJobs, jobId, owner);
      return;
    }

    const scriptPath = path.join(jobDir, 'run-script.' + scriptExtensionFor(cfg.lang));

    try {
      fs.copyFileSync(
        scriptSrc,
        path.join(jobDir, 'run-script.' + scriptExtensionFor(cfg.lang))
      );
      // 报告模板：插件自带模板优先；内置插件可复用 biof3-server 旧模板。
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
      releaseActiveToolJob(activeToolJobs, jobId, owner);
      return;
    }

    // 本地执行：直接调内嵌 Rscript/python3。
    let runCmd;
    let runEnv = undefined;
    let runtimeReady = null;
    let runtimeCommand = null;
    let runtimeVersion = null;

    // BLOCK-57：作业级 ExecutionTarget 分派。execution_target_id 为 NULL 走
    // 本地路径（逐字节不变）；非 NULL 走远程（节点探测 → 语言运行时解析）。
    // 远程作业不做本地 BLOCK-58 依赖检查与本地 binPath 检查——节点侧运行时
    // 以 agent probe 为准，缺失走 stage=runtime 诚实失败。
    let remoteDispatch = null;
    if (job.execution_target_id) {
      remoteDispatch = await resolveRemoteTargetForJob({ jobId, cfg, targetId: job.execution_target_id });
      if (remoteDispatch.error) {
        await markJobFailed(jobId, remoteDispatch.message, remoteDispatch.stage);
        releaseActiveToolJob(activeToolJobs, jobId, owner);
        return;
      }
      runtimeReady = { runtime: cfg.lang || null, ready: true, command: remoteDispatch.runtime.runtimeBin, reason: null };
      runtimeCommand = remoteDispatch.runtime.runtimeBin;
      runtimeVersion = remoteDispatch.runtime.version;
      const remoteScriptBase = 'run-script.' + scriptExtensionFor(cfg.lang);
      // BLOCK-76 P5 — 旧作业链 runCmd（remoteJobDirPath 参数形态）随机制拆除退役；
      // 直跑链由 ssh-direct-runner 自行构造服务器侧命令。
      runCmd = [remoteDispatch.runtime.runtimeBin, remoteScriptBase];
    }
    if (!remoteDispatch) {
      const { getExecutor } = require('../../shared-backend/executors');
      const executor = getExecutor(cfg.lang);
      runtimeCommand = executor && executor.binPath;
      // BLOCK-66 P1 — runtime preflight：binPath 是路径字符串（executor 解析
      // 失败会回退 PATH 搜索仍返回字符串），必须 existsSync 校验；R/Python
      // 运行时未安装时诚实失败 + 商店指引（而非裸 spawn ENOENT）。
      runtimeReady = evaluateRuntimePreflight(executor, cfg.lang);
      runtimeVersion = runtimeReady.ready && typeof executor.getRuntimeVersion === 'function'
        ? executor.getRuntimeVersion()
        : null;
      if (!runtimeReady.ready) {
        await markJobFailed(jobId, runtimeReady.reason, 'runtime');
        releaseActiveToolJob(activeToolJobs, jobId, owner);
        return;
      }
      if (cfg.lang === 'r') {
        // BLOCK-58 — 内置 R 工具脚本执行前毫秒级依赖检查（读 _dependencies.json，
        // executor.checkPackageInstalled 查 R_HOME/library 目录存在性）：缺包直接
        // fail-fast 拒绝派生进程（脚本内亦有 MISSING_R_PACKAGES 兜底，分析路径零联网安装）。
        // 插件脚本（_isPlugin）走 manifest packages + 预编译包通道，不在此管。
        if (!cfg._isPlugin) {
          const { checkToolDependencies, missingPackagesMessage } = require('./tool-dependencies');
          const depCheck = checkToolDependencies(executor, cfg.script);
          if (depCheck.checked && depCheck.missing.length > 0) {
            await markJobFailed(jobId, missingPackagesMessage(toolId, depCheck.missing), 'dependencies');
            releaseActiveToolJob(activeToolJobs, jobId, owner);
            return;
          }
        }
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
          // bundle 已就绪（缺则按需下载）。await 确保已下载的 bundle 能被随后的
          // resolveRLibsForPlugin → checkCapabilityReady 命中。
          // BLOCK-146 #9：requiresBundle 声明即插件必需依赖（ensureBundlesForPlugin
          // 语义——声明列表全量视作 required，当前无 optional 形态）。必需 bundle
          // 未就绪不再 warn 后裸跑 base runtime（审视发现 #9：最终以晦涩的 R
          // library 报错收场、无归因），改为 markJobFailed('dependencies') 携带
          // {bundleId, status, error} + 可行动中文指引（对照 tool-dependencies.js
          // missingPackagesMessage 范式；文案单源 formatRequiredBundleFailure）。
          // 预检抛错（装置层意外）同样按从紧原则失败，不静默回退。
          if (cfg.requiresBundle) {
            let ensured = null;
            try {
              ensured = await ensureBundlesForPlugin(cfg);
            } catch (e) {
              await markJobFailed(jobId, `执行失败: capability bundle 预检异常: ${e.message}`, 'dependencies');
              releaseActiveToolJob(activeToolJobs, jobId, owner);
              return;
            }
            if (ensured && !ensured.ok) {
              console.warn(
                '[tools] capability bundle(s) not ready for',
                toolId,
                '— failing the job:',
                JSON.stringify(ensured.results)
              );
              await markJobFailed(jobId, formatRequiredBundleFailure(toolId, ensured), 'dependencies');
              releaseActiveToolJob(activeToolJobs, jobId, owner);
              return;
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

    if (!await canLaunchOwnedToolJob({ activeToolJobs, db, jobId, owner })) {
      releaseActiveToolJob(activeToolJobs, jobId, owner);
      console.log('[tools] Job ' + jobId + ' launch suppressed by durable cancellation state');
      // BLOCK-57：远程分派窗口长（探测+上传需数秒），durable cancel 抑制启动后
      // 必须行级收敛为 cancelled——与 cancel 路由的行级 UPDATE 同语义，防作业行滞留 running。
      try {
        const settledCancel = await db
          .prepare(
            'UPDATE tool_jobs SET status=?, error=NULL, completed_at=?, process_pid=NULL, heartbeat_at=NULL '
            + 'WHERE id=? AND status IN (?,?,?)'
          )
          .run('cancelled', Date.now(), jobId, 'pending', 'running', 'cancelled');
        if (settledCancel && settledCancel.changes >= 1) {
          publishJobTerminalState(jobId, 'cancelled');
        }
      } catch (error) {
        console.warn('[tools] suppressed-launch cancellation convergence failed:', error.message);
      }
      return;
    }

    const startedAt = new Date().toISOString();
    const resourceStart = createRuntimeResourceSnapshot({
      disk: diskSnapshot(outputDir),
      runtime: { r: cfg.lang === 'r' && runtimeReady?.ready, python: cfg.lang === 'python' && runtimeReady?.ready },
      activeJobs: activeToolJobs.size,
      observedAt: startedAt,
    });
    const buildProvenance = (artifacts = []) => buildJobProvenance({
      jobId,
      job,
      toolId,
      cfg,
      jobDir,
      runtimeCommand,
      runtimeReady,
      runtimeVersion,
      runCmd,
      startedAt,
      artifacts,
      executionTarget: remoteDispatch ? {
        kind: sshContext ? 'ssh-native' : 'ssh-direct',
        targetId: remoteDispatch.target.id,
        alias: remoteDispatch.target.alias,
        nodeOs: remoteDispatch.probeInfo.os || null,
        runtime: { name: cfg.lang || null, version: runtimeVersion, command: runtimeCommand },
        remoteJobDir: sshContext ? `results/jobs/${jobId}` : null,
        argmode: remoteDispatch.argmode,
        agentVersion: AGENT_SCRIPT_HASH,
        transport: sshContext ? 'gateway-ssh-direct' : 'tar-over-ssh',
      } : null,
    });
    const hardTimeoutMs = TOOL_LIFECYCLE.hardTimeoutMs;
    let resourceSampler = null;
    const collectSampledResources = async () => {
      try {
        return resourceSampler
          ? await resourceSampler.stop()
          : {
            peak: {},
            sampling: { status: 'unavailable', sampleCount: null, reason: 'process_sampler_unavailable' },
            peakStatus: 'unavailable',
          };
      } catch {
        return {
          peak: {},
          sampling: { status: 'unavailable', sampleCount: null, reason: 'process_sampler_failed' },
          peakStatus: 'unavailable',
        };
      }
    };
    // BLOCK-57：终态收尾统一入口（工厂实现见 createJobRunFinalizer）——本地 execFile
    // 回调与远程执行路径共用，保证 provenance/校验/落库链路与 Artifact Truth 同构。
    const finalizeJobRun = createJobRunFinalizer({
      owner,
      jobId,
      toolId,
      cfg,
      jobDir,
      outputDir,
      stagedInputFiles,
      stagedInputSnapshots,
      buildProvenance,
      resourceStart,
      runtimeCommand,
      runtimeReady,
      hardTimeoutMs,
    });

    // BLOCK-57：远程执行路径——提交 + 日志流 + 节点真相轮询 + 产物拉回对账，
    // 终态后与本地路径共用同一条 finalizeJobRun 链。
    // BLOCK-76 P1：SSH 项目的直跑分支优先——产物留服务器、不走作业上传/拉回。
    if (remoteDispatch && sshContext) {
      await runSshDirectToolJob({
        owner,
        jobId,
        jobDir,
        cfg,
        sshContext,
        remoteDispatch,
        markFailed: markJobFailed,
      });
      return;
    }
    if (remoteDispatch) {
      // BLOCK-76 P5 — BLOCK-57 作业上传/拉回机制已拆除：执行目标仅服务 SSH 项目钉定（D7）。
      await markJobFailed(jobId, '本地项目的远程执行目标已退役（BLOCK-76）：远程算力请创建 SSH 项目，执行面自动钉定节点', 'dispatch');
      releaseActiveToolJob(activeToolJobs, jobId, owner);
      return;
    }

    // BLOCK-126 P2：execFile → spawn——stdout/stderr 逐块收集（全量供 finalize 原
    // API）并喂运行期日志行缓冲（日志端点运行中返回 live 尾部）。行为等价钉住：
    // maxBuffer 10MB 超限同语义失败、err.code/err.killed 契约保持、
    // owner.process/child.pid/生命周期链零适配（ChildProcess 同接口）。
    const child = spawn(
      runCmd[0],
      runCmd.slice(1),
      { env: runEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const MAX_SPAWN_BUFFER = 10 * 1024 * 1024;
    const outDecoder = new StringDecoder('utf8');
    const errDecoder = new StringDecoder('utf8');
    let stdoutAll = '';
    let stderrAll = '';
    let spawnSettled = false;
    const settleSpawn = (err) => {
      if (spawnSettled) return;
      spawnSettled = true;
      stdoutAll += outDecoder.end();
      stderrAll += errDecoder.end();
      endJobLiveLog(jobId);
      void (async () => {
        try {
          await finalizeJobRun({ err, stdout: stdoutAll, stderr: stderrAll, sampledResources: await collectSampledResources() });
        } catch (finalizeError) {
          console.warn('[tools] Job ' + jobId + ' finalize after spawn failed:', finalizeError.message);
        } finally {
          clearJobLiveLog(jobId);
        }
      })();
    };
    const enforceSpawnBuffer = (stream) => {
      if (stdoutAll.length <= MAX_SPAWN_BUFFER && stderrAll.length <= MAX_SPAWN_BUFFER) return;
      const exceeded = new Error(`spawn ${stream}/maxBuffer exceeded`);
      exceeded.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
      try { child.kill('SIGKILL'); } catch { /* close 事件兜底 */ }
      settleSpawn(exceeded);
    };
    child.stdout.on('data', (chunk) => {
      stdoutAll += outDecoder.write(chunk);
      appendJobLiveLog(jobId, 'stdout', chunk);
      enforceSpawnBuffer('stdout');
    });
    child.stderr.on('data', (chunk) => {
      stderrAll += errDecoder.write(chunk);
      appendJobLiveLog(jobId, 'stderr', chunk);
      enforceSpawnBuffer('stderr');
    });
    child.on('error', (err) => settleSpawn(err));
    child.on('close', (code, signal) => {
      if (code === 0) return settleSpawn(null);
      const exitError = new Error(`Process exited with ${signal ? `signal ${signal}` : `code ${code}`}`);
      exitError.code = code ?? null;
      exitError.signal = signal ?? null;
      exitError.killed = Boolean(signal);
      settleSpawn(exitError);
    });
    owner.process = child;
    owner.phase = 'running';
    owner.lastHeartbeatAt = Date.now();
    armActiveToolJobLifecycle({
      active: owner,
      jobId,
      db,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      hardTimeoutMs,
    });
    resourceSampler = createToolResourceSampler({
      pid: child.pid,
      jobDir: outputDir,
      activeJobs: () => activeToolJobs.size,
    });
    resourceSampler.start();
    const ownership = await db
      .prepare('UPDATE tool_jobs SET process_pid=?, heartbeat_at=? WHERE id=? AND status=?')
      .run(child.pid || null, Date.now(), jobId, 'running');
    if (!ownership || ownership.changes < 1) {
      throw new Error('tool_job_process_ownership_persistence_rejected');
    }
    if (activeToolJobs.get(jobId) !== owner) {
      throw new Error('active_tool_job_owner_lost_after_spawn');
    }
  }

  function translateRError(rawError) {
    if (!rawError) return null;
    for (const { pattern, msg } of R_ERROR_TRANSLATIONS) {
      const m = rawError.match(pattern);
      if (m) return typeof msg === 'function' ? msg(m) : msg;
    }
    return null;
  }

  // BLOCK-85 P2.5 — 格物联邦作业分派（executionTargetId=`fed:<peerId>`）。
  // 对端以它自己的本地身份跑（它的 LOCAL_USER、它的执行器、它的 Artifact 真值）；
  // 本端返回对端 job 投影（federated:true + peerId/peerName），真值不在本端。
  function resolveFederationDataDir() {
    return process.env.BIOF3_LOCAL_DATA_DIR
      || process.env.LOCAL_DATA_DIR
      || path.join(require('os').homedir(), 'Documents', 'BioF3-Local');
  }

  async function federatedToolRun(req, res, { toolId, files, projectId, params, peerId }) {
    const federation = require('../../shared-backend/federation-peers');
    const peer = federation.getPeer(resolveFederationDataDir(), peerId);
    if (!peer) {
      return res.status(400).json({
        ok: false,
        error: 'unknown_federation_peer',
        message: '协作节点不存在或已移除：' + peerId,
      });
    }
    const token = federation.getPeerToken(resolveFederationDataDir(), peerId) || '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const upstream = await fetch(`${peer.baseUrl}/api/tools/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ toolId, files, projectId, params }),
        signal: controller.signal,
      });
      const data = await upstream.json().catch(() => ({}));
      if (upstream.status === 401) {
        return res.status(409).json({
          ok: false,
          error: 'federation_session_invalid',
          message: `协作节点「${peer.name}」的会话已失效，请重新配对`,
          peerId,
        });
      }
      if (upstream.status !== 200) {
        return res.status(502).json({
          ok: false,
          error: 'federation_run_failed',
          message: `协作节点「${peer.name}」执行失败（${upstream.status}）`,
          peerError: data,
        });
      }
      return res.json({ ok: true, federated: true, peerId, peerName: peer.name, job: data });
    } catch (error) {
      const offline = error.name === 'AbortError';
      return res.status(504).json({
        ok: false,
        error: offline ? 'federation_timeout' : 'federation_unreachable',
        message: offline ? `协作节点「${peer.name}」作业提交超时` : `无法连接协作节点「${peer.name}」`,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function handleToolRun(req, res) {
    const uid = forwardedToolRunUserId(req);
    if (!uid) return res.status(401).json({ error: 'login_required' });
    const { toolId, files, projectId } = req.body || {};
    if (!toolId) return res.status(400).json({ error: 'missing_tool_id' });
    const isTest = isSmokeTestRequest(req);
    // BLOCK-130：满载入队标志（准入分支置位；入队=建行 pending 不立即执行）。
    let shouldQueue = false;

    // BLOCK-57：executionTargetId 为 params 保留键——作业级 ExecutionTarget，
    // 服务端剥离后不入 params.json（脚本参数面零污染）；未知目标 fail-closed。
    let executionTargetId = null;
    let params = (req.body && req.body.params) || {};
    if (params && typeof params === 'object' && 'executionTargetId' in params) {
      const raw = params.executionTargetId;
      const rest = { ...params };
      delete rest.executionTargetId;
      params = rest;
      executionTargetId = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
    }
    // BLOCK-85 P2.5：`fed:<peerId>` 前缀 = 格物联邦节点——作业转发对端，
    // 对端以它自己的本地身份跑（D3：真值在对端，指挥席拿到对端 job 投影）。
    if (executionTargetId && executionTargetId.startsWith('fed:')) {
      const peerId = executionTargetId.slice(4);
      return federatedToolRun(req, res, { toolId, files, projectId, params, peerId });
    }
    if (executionTargetId && !(await targetRegistry.getById({ id: executionTargetId }))) {
      return res.status(400).json({
        ok: false,
        error: 'unknown_execution_target',
        message: '执行目标不存在：' + executionTargetId,
      });
    }

    // BLOCK-67 D7：SSH 远程项目的作业默认执行面 = 项目自身 host（防 BLOCK-30 双模式
    // 回潮：显式传了别的目标也一律钉回项目 host，不叠加 composer 分派）。
    // 目标别名未注册时按 alias 注册（unprobed，探测随首次作业引导）。
    let sshContext = null;
    if (projectId) {
      let sshProjectRow = null;
      try {
        const sshProject = await dbMod.getAsyncDatabase()
          .prepare('SELECT id, workspace_kind, ssh_host, remote_path FROM projects WHERE id = ?')
          .get(projectId);
        if (sshProject && sshProject.workspace_kind === 'ssh' && sshProject.ssh_host) {
          sshProjectRow = sshProject;
          let hostTarget = await targetRegistry.getByAlias({ alias: sshProject.ssh_host });
          if (!hostTarget) {
            const registered = await targetRegistry.register({
              alias: sshProject.ssh_host,
              label: `BLOCK-67 SSH 项目默认目标（${projectId}）`,
            });
            if (registered.ok) hostTarget = await targetRegistry.getById({ id: registered.id });
          }
          if (hostTarget) {
            executionTargetId = hostTarget.id;
          } else {
            return res.status(400).json({
              ok: false,
              error: 'ssh_project_target_unavailable',
              message: `远程项目默认执行目标（${sshProject.ssh_host}）注册失败`,
            });
          }
        }
      } catch (e) {
        console.warn('[tools] BLOCK-67 ssh default target resolution failed:', e.message);
      }
      // BLOCK-76 P1：SSH 项目的作业执行链 = SSH 直跑（gateway 写编排面 + exec_bg 后台直跑，
      // 产物留服务器 results/jobs/<jobId>/），不再走 BLOCK-57 作业上传/拉回链。
      if (sshProjectRow) {
        sshContext = { project: sshProjectRow };
      }
    }

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

    // BLOCK-131（BIO-5 P1）：域级校验执行化——counts 矩阵/样本元数据的
    // 值级规则（非负整数/唯一标识/样本对齐）在提交前 fail-closed，消息
    // 可操作（点名重复值/违规值/未对齐样本）。
    const { validateDomainUploads } = require('./upload-domain-validation');
    const domain = validateDomainUploads(jobDir, Object.keys(files || {}));
    if (domain.findings.length > 0) {
      try {
        fs.rmSync(jobDir, { recursive: true, force: true });
      } catch {}
      return res.status(400).json({
        ok: false,
        error: 'domain_validation_failed',
        findings: domain.findings,
        message: domain.findings.map((f) => f.message).join('；'),
      });
    }

    if (!isTest) {
      const running = await db
        .prepare(
          "SELECT COUNT(*) as cnt FROM tool_jobs WHERE user_id = ? AND status IN ('pending','running') AND is_test_run = 0"
        )
        .get(uid);
      if (running && running.cnt >= 2) {
        // BLOCK-130（PL-3 队列化）：满载不再直接拒绝——入队（建行 pending、
        // 不立即执行，终态泵拉起）。只有排队深度也达上限才 429（防无界）。
        const queuedCount = await db
          .prepare(
            "SELECT COUNT(*) as cnt FROM tool_jobs WHERE user_id = ? AND status = 'pending' AND is_test_run = 0"
          )
          .get(uid);
        const depthLimit = Number(process.env.BIOF3_TOOL_QUEUE_DEPTH_LIMIT || 50);
        if (queuedCount && queuedCount.cnt >= depthLimit)
          return res.status(429).json({
            error: 'max_concurrent',
            message: `并发与排队均已满（在途 2 + 排队 ${depthLimit}），请等待队列消化后再试`,
          });
        shouldQueue = true;
      }
    }

    // 静态白名单查表用 Map：get() 无计算成员访问面（security/detect-object-injection 干净），
    // toolId 是请求侧输入，查不到时原样回退。
    const toolNames = new Map([
      ['deseq2', 'DESeq2'],
      ['go-kegg', 'GO/KEGG ORA'],
      ['km-survival', 'KM生存'],
      ['gsea', 'GSEA'],
      ['bindea-immune', '免疫浸润'],
      ['wgcna', 'WGCNA'],
      ['lasso-cox', 'LASSO Cox'],
      ['seurat-standard', 'Seurat'],
      ['complexheatmap', 'ComplexHeatmap'],
      ['maftools-mutation', 'maftools'],
      ['cellchat', 'CellChat'],
      ['ml-feature-select', 'ML特征选择'],
      ['ml-classifier', 'ML分类器'],
      ['rsf-survival', 'RSF生存森林'],
      ['shap-explain', 'SHAP'],
      ['consensus-cluster', '一致性聚类'],
      ['ml-scvi-annotate', 'scVI'],
      ['mo-mofa', 'MOFA2'],
      ['mo-snf', 'SNF'],
    ]);
    const existCount = await db
      .prepare('SELECT COUNT(*) as cnt FROM tool_jobs WHERE user_id = ? AND tool_id = ?')
      .get(uid, toolId);
    const labelPrefix = isTest ? '🧪 ' : '';
    const jobName =
      labelPrefix + (toolNames.get(toolId) || toolId) + ' #' + ((existCount ? existCount.cnt : 0) + 1);

    await db
      .prepare(
        'INSERT INTO tool_jobs (id,user_id,tool_id,params_json,status,created_at,name,is_test_run,project_id,execution_target_id) VALUES (?,?,?,?,?,?,?,?,?,?)'
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
        projectId || null,
        executionTargetId
      );
    if (shouldQueue) {
      // BLOCK-130（PL-3）：入队——不启动，等终态泵；返回队列位置（同用户
      // 在我之前排队的数量+1）。staged 文件路径不依赖内存：jobDir 顶层
      // 上传件即 staged 输入（泵拉起时按此重建）。
      const ahead = await db
        .prepare(
          "SELECT COUNT(*) as cnt FROM tool_jobs WHERE user_id = ? AND status = 'pending' AND is_test_run = 0 AND created_at < ?"
        )
        .get(uid, Date.now());
      const queuePosition = (ahead && ahead.cnt ? ahead.cnt : 0) + 1;
      console.log(
        `[tools] Job ${jobId} queued (tool=${toolId} rid=${req.requestId} user=${uid} position=${queuePosition})`
      );
      return res.json({ ok: true, jobId, status: 'pending', queued: true, queuePosition, isTestRun: isTest, requestId: req.requestId });
    }
    void executeJob(jobId, toolId, jobDir, uploadResult.entries.map((entry) => entry.filePath), sshContext)
      .catch((error) => handleActiveToolJobSetupFailure({
        activeToolJobs,
        jobId,
        error,
        markFailed: markJobFailed,
      }))
      .catch((error) => {
        console.warn('[tools] Job ' + jobId + ' setup failure handling failed:', error.message);
      });
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


module.exports = {
  createToolsExecutor,
  _test: {
    isManagedResultDir,
    evaluateRuntimePreflight,
    resolveUploadedFilePath,
    resolveUploadedFiles,
    writeUploadedFiles,
    validateUploadedFiles,
    hydrateExecutionJob,
    resolveProducedResultDirectory,
    resolveAuthorizedToolResultFile,
    resolveStoredArtifactTruthBinding,
    openVerifiedAuthorizedToolResultFile,
    mergeFinalOutputMeasurement,
    buildCancelledToolResult,
    buildFailedToolResult,
    claimActiveToolJob,
    releaseActiveToolJob,
    terminateOwnedToolJobProcess,
    requestActiveToolJobCancellation,
    canLaunchOwnedToolJob,
    persistVerifiedToolJobHeartbeat,
    armActiveToolJobLifecycle,
    clearActiveToolJobLifecycleTimers,
    transitionToolJobToFailed,
    transitionToolJobToCompleted,
    settleConfirmedToolCancellation,
    handleActiveToolJobSetupFailure,
  },
};
