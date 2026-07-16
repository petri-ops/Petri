/**
 * Task Manager — Async task execution for long-running R analyses.
 *
 * Tasks go through: pending → running → done / failed
 * Progress is tracked via a JSON file written by the R script.
 *
 * Storage: in-memory Map (sufficient for single-server deployment).
 * For multi-server, swap to Redis.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const {
  createTaskExecutionContext,
  attachExecutionMetadata,
} = require('../shared-backend/execution-context');
const config = require('./config');

const IS_LOCAL = config.execMode === 'local';
const TEMP_DIR = IS_LOCAL ? (config.tempDir || '/tmp/biof3-tmp') : '/mnt/storage_16tb/omichub/biof3-tmp';
const CACHE_DIR = IS_LOCAL ? (config.tempDir || '/tmp/biof3-tmp') + '/_cache' : '/mnt/storage_16tb/omichub/biof3-cache';

const CONTAINER_TEMP_DIR = IS_LOCAL ? TEMP_DIR : '/app/data/biof3-tmp';
const CONTAINER_CACHE_DIR = IS_LOCAL ? CACHE_DIR : '/app/data/biof3-cache';
const _R_CONTAINER = 'omichub_react_backend_1';
const TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes for heavy analyses

// OSS client（桌面版 storageMode='local' 时跳过）
let ossClient = null;
if (config.storageMode !== 'local') {
  const OSS = require('ali-oss');
  ossClient = new OSS({
    region: 'oss-cn-hangzhou',
    accessKeyId: process.env.OSS_AK,
    accessKeySecret: process.env.OSS_SK,
    bucket: 'biof3-uploads',
  });
}

// In-memory task store
const tasks = new Map();

// Task statuses
const STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
  QUEUED: 'queued',
};

// Concurrency control
const MAX_CONCURRENT_TASKS = 2;
const taskQueue = []; // Array of taskIds waiting
let runningTaskCount = 0;

function tryStartNext() {
  while (runningTaskCount < MAX_CONCURRENT_TASKS && taskQueue.length > 0) {
    const nextId = taskQueue.shift();
    const task = tasks.get(nextId);
    if (!task) continue;
    runningTaskCount++;
    setImmediate(() => executeTask(nextId));
  }
  // Update queue positions for remaining waiting tasks
  taskQueue.forEach((tid, idx) => {
    const t = tasks.get(tid);
    if (t) t.queuePosition = idx + 1;
  });
}

/**
 * Create and enqueue a new task.
 * @param {object} opts - { type, params, ossInputUrl }
 * @returns {object} - { taskId, status }
 */
function createTask({ type, params, ossInputUrl, parentTaskId }) {
  const taskId = uuidv4();
  const workDir = path.join(TEMP_DIR, `task-${taskId}`);
  const containerWorkDir = `${CONTAINER_TEMP_DIR}/task-${taskId}`;

  config.mkdirSandbox(workDir);

  const task = {
    taskId,
    type,
    params: params || {},
    ossInputUrl: ossInputUrl || null,
    parentTaskId: parentTaskId || null,
    status: STATUS.PENDING,
    progress: 0,
    progressMessage: '排队中...',
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    results: null,
    error: null,
    workDir,
    containerWorkDir,
  };
  task.execution = createTaskExecutionContext(task, config, 'r');

  tasks.set(taskId, task);

  // Add to queue or run immediately
  if (runningTaskCount < MAX_CONCURRENT_TASKS) {
    runningTaskCount++;
    setImmediate(() => executeTask(taskId));
  } else {
    task.status = STATUS.QUEUED;
    task.progressMessage = '排队中...';
    taskQueue.push(taskId);
    task.queuePosition = taskQueue.length;
    console.log(`[Queue] Task ${taskId} queued (position ${task.queuePosition})`);
  }

  return {
    taskId,
    status: task.status,
    queuePosition: task.queuePosition || 0,
    execution: task.execution,
  };
}

/**
 * Get task status and results.
 */
function getTask(taskId) {
  const task = tasks.get(taskId);
  if (!task) return null;

  // Read progress file if task is running
  if (task.status === STATUS.RUNNING) {
    const progressFile = path.join(task.workDir, 'progress.json');
    try {
      if (fs.existsSync(progressFile)) {
        const prog = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
        task.progress = prog.progress || task.progress;
        task.progressMessage = prog.message || task.progressMessage;
      }
    } catch {
      /* ignore parse errors */
    }
  }

  // Return public-facing info (no internal paths)
  return {
    taskId: task.taskId,
    type: task.type,
    cachePath: task.cachePath || null,
    status: task.status,
    progress: task.progress,
    progressMessage: task.progressMessage,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    results: task.results,
    error: task.error,
  };
}

/**
 * List recent tasks (last 50).
 */
function listTasks(limit = 50) {
  const all = Array.from(tasks.values())
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
  return all.map((t) => getTask(t.taskId));
}

/**
 * Execute a task in the background.
 */
async function executeTask(taskId) {
  const task = tasks.get(taskId);
  if (!task) return;

  task.status = STATUS.RUNNING;
  task.startedAt = new Date().toISOString();
  task.progressMessage = '正在启动分析...';

  try {
    // Resolve parent cache path if available
    if (task.parentTaskId) {
      const parentCachePath = path.join(CACHE_DIR, `task-${task.parentTaskId}.rds`);
      if (fs.existsSync(parentCachePath)) {
        task.parentCachePath = `${CONTAINER_CACHE_DIR}/task-${task.parentTaskId}.rds`;
        console.log(`[Cache] Using parent cache: ${task.parentCachePath}`);
      } else {
        console.log(`[Cache] Parent cache not found: ${parentCachePath}, will download from OSS`);
      }
    }

    // Generate R script based on task type
    const rScript = generateRScript(task);
    const scriptPath = path.join(task.workDir, 'run_task.R');
    fs.writeFileSync(scriptPath, rScript);

    // Execute: local 模式直接调 Rscript；docker 模式走 docker exec
    const _result = await new Promise((resolve, reject) => {
      let execCmd, execArgs;
      if (config.execMode === 'local') {
        const { getExecutor } = require('../shared-backend/executors');
        const executor = getExecutor('r');
        const spawnCmd = executor.buildSpawnCommand(`${task.workDir}/run_task.R`, task.workDir, {});
        execCmd = spawnCmd.cmd;
        execArgs = spawnCmd.args;
      } else {
        execCmd = 'docker';
        execArgs = [...config.dockerExecArgs(), 'Rscript', '--vanilla', `${task.containerWorkDir}/run_task.R`];
      }
      execFile(
        execCmd,
        execArgs,
        {
          timeout: TASK_TIMEOUT_MS,
          maxBuffer: 1024 * 1024 * 20, // 20MB buffer for heavy output
          env: { ...process.env, LC_ALL: 'en_US.UTF-8' },
        },
        (error, stdout, stderr) => {
          if (error) {
            if (error.killed) {
              reject(new Error(`分析超时（最大 ${TASK_TIMEOUT_MS / 60000} 分钟）`));
            } else {
              reject(new Error(stderr || error.message));
            }
          } else {
            resolve({ stdout, stderr });
          }
        }
      );
    });

    // Collect and upload result files
    const results = attachExecutionMetadata(await collectTaskResults(task), task.execution);

    task.status = STATUS.DONE;
    task.progress = 100;
    task.progressMessage = '分析完成';
    task.finishedAt = new Date().toISOString();
    task.results = results;

    // === Auto-cache result.rds ===
    try {
      const _resultRds = path.join(task.workDir, 'result.rds');
      const _cacheDest = path.join(CACHE_DIR, 'task-' + task.taskId + '.rds');
      if (fs.existsSync(_resultRds) && !fs.existsSync(_cacheDest)) {
        fs.copyFileSync(_resultRds, _cacheDest);
        task.cachePath = CONTAINER_CACHE_DIR + '/task-' + task.taskId + '.rds';
        console.log('[Cache] Saved: task-' + task.taskId + '.rds');
      }
    } catch (_cErr) {
      console.warn('[Cache] ' + _cErr.message);
    }

    // === Auto-export metadata.csv + features.csv for standard/recluster ===
    if (task.type === 'scrna_standard' || task.type === 'recluster') {
      (async () => {
        try {
          const _metaCsv = path.join(task.workDir, 'metadata.csv');
          const _featCsv = path.join(task.workDir, 'features.csv');
          if (!fs.existsSync(_metaCsv)) {
            const _lines = [
              'library(Seurat)',
              'setwd("' + task.containerWorkDir + '")',
              'obj <- readRDS("result.rds")',
              'meta <- obj@meta.data',
              'meta$cell_id <- rownames(meta)',
              'meta <- meta[, c("cell_id", setdiff(names(meta), "cell_id"))]',
              'write.csv(meta, "metadata.csv", row.names = FALSE)',
              'genes <- rownames(obj)',
              'data_mat <- tryCatch(GetAssayData(obj, layer = "data"), error = function(e) GetAssayData(obj, slot = "data"))',
              'features_df <- data.frame(gene_symbol = genes, mean_expression = round(Matrix::rowMeans(data_mat), 4), pct_cells = round(Matrix::rowMeans(data_mat > 0) * 100, 2))',
              'write.csv(features_df, "features.csv", row.names = FALSE)',
              'cat("OK\\n")',
            ];
            fs.writeFileSync(path.join(task.workDir, '_export.R'), _lines.join('\n'));
            const { execFileSync } = require('child_process');
            execFileSync(
              'docker',
              [
                ...config.dockerExecArgs(),
                'Rscript',
                '--vanilla',
                task.containerWorkDir + '/_export.R',
              ],
              { timeout: 120000 }
            );
            console.log('[Meta] Exported for task ' + task.taskId);
          }
          if (fs.existsSync(_metaCsv) && fs.existsSync(_featCsv)) {
            const _mKey = 'results/task-' + task.taskId + '/metadata.csv';
            const _fKey = 'results/task-' + task.taskId + '/features.csv';
            await ossClient.put(_mKey, _metaCsv);
            await ossClient.put(_fKey, _featCsv);
            const _mUrl = 'https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/' + _mKey;
            const _fUrl = 'https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/' + _fKey;
            const _dbMod = require('./db');
            const _aRow = _dbMod.getAnalysisByTaskId(task.taskId);
            if (_aRow) {
              _dbMod.setDatasetMetaUrls(_aRow.dataset_id, { metaUrl: _mUrl, featuresUrl: _fUrl });
              console.log('[Meta] DB updated for dataset ' + _aRow.dataset_id);
            }
          }
        } catch (_mErr) {
          console.warn('[Meta] ' + _mErr.message);
        }
      })();
    }

    // Persist results to SQLite so they survive restart
    try {
      const db = require('./db');
      db.updateAnalysisByTaskId(task.taskId, {
        status: 'done',
        summary: results.summary,
        results: results,
        finishedAt: task.finishedAt,
      });
      console.log(`[DB] Results persisted for task ${task.taskId}`);
    } catch (dbErr) {
      console.error('[DB] Failed to persist results:', dbErr.message);
    }
  } catch (err) {
    task.status = STATUS.FAILED;
    task.progress = 0;
    task.progressMessage = '分析失败';
    task.finishedAt = new Date().toISOString();
    task.error = err.message;

    // Persist failure to SQLite
    try {
      const db = require('./db');
      db.updateAnalysisByTaskId(task.taskId, {
        status: 'failed',
        error: err.message,
        finishedAt: task.finishedAt,
      });
    } catch (dbErr) {
      console.error('[DB] Failed to persist error:', dbErr.message);
    }
  }

  // Cleanup work directory after a delay (keep for debugging)
  setTimeout(
    () => {
      try {
        fs.rmSync(task.workDir, { recursive: true, force: true });
      } catch {}
    },
    5 * 60 * 1000
  ); // Keep for 5 min

  // Free slot and start next queued task
  runningTaskCount = Math.max(0, runningTaskCount - 1);
  tryStartNext();
}

/**
 * Generate R code to load input data — uses local cache if available.
 */

// Script generators — modularized into task-scripts-gen/
const {
  _generateLoadCode,
  generateScRNAScript,
  generateReclusterScript,
  generateDEGScript,
  generateEnrichmentScript,
  generateAnnotationScript,
  generateIntegrationScript,
  generateTrajectoryScript,
  generateCommunicationScript,
  generateCellCycleScript,
  generateDoubletScript,
} = require('./task-scripts-gen');

function generateRScript(task) {
  const { type, _params, _ossInputUrl, containerWorkDir } = task;

  // Helper: progress reporting function injected into all scripts
  const progressHelper = `
# Progress reporting helper
report_progress <- function(pct, msg) {
  jsonlite::write_json(
    list(progress = pct, message = msg),
    file.path("${containerWorkDir}", "progress.json"),
    auto_unbox = TRUE
  )
}
report_progress(5, "初始化环境...")
`;

  switch (type) {
    case 'recluster':
      return generateReclusterScript(task, progressHelper);
    case 'scrna_standard':
      return generateScRNAScript(task, progressHelper);
    case 'deg':
      return generateDEGScript(task, progressHelper);
    case 'enrichment':
      return generateEnrichmentScript(task, progressHelper);
    case 'cell_annotation':
      return generateAnnotationScript(task, progressHelper);
    case 'scrna_integration':
      return generateIntegrationScript(task, progressHelper);
    case 'trajectory':
      return generateTrajectoryScript(task, progressHelper);
    case 'communication':
      return generateCommunicationScript(task, progressHelper);
    case 'cell_cycle':
      return generateCellCycleScript(task, progressHelper);
    case 'doublet':
      return generateDoubletScript(task, progressHelper);
    default:
      return `${progressHelper}\nstop("未知任务类型: ${type}")`;
  }
}

/**
 * Generate scRNA-seq standard analysis R script.
 */

async function collectTaskResults(task) {
  const results = {
    plots: [],
    files: [],
    summary: null,
  };

  const workDir = task.workDir;

  try {
    const files = fs.readdirSync(workDir);
    const ossPrefix = `results/task-${task.taskId}`;

    // Upload plots
    const plotFiles = files.filter((f) => f.startsWith('plot_') && f.endsWith('.png'));
    plotFiles.sort();
    for (const f of plotFiles) {
      const localPath = path.join(workDir, f);
      const ossKey = `${ossPrefix}/${f}`;
      try {
        await ossClient.put(ossKey, localPath);
        const url = `https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/${ossKey}`;
        // Extract a friendly name from filename
        const name = f
          .replace(/^plot_\d+_/, '')
          .replace('.png', '')
          .replace(/_/g, ' ');
        results.plots.push({ name, url, filename: f });
      } catch (e) {
        // Fallback: base64
        console.warn(
          `[task ${task.taskId}] OSS plot upload failed, using base64 fallback: ${f} — ${e.message}`
        );
        const imgData = fs.readFileSync(localPath);
        results.plots.push({
          name: f,
          url: `data:image/png;base64,${imgData.toString('base64')}`,
          filename: f,
        });
      }
    }

    // Upload CSV/data files
    const dataFiles = files.filter((f) => f.endsWith('.csv') && !f.startsWith('input'));
    for (const f of dataFiles) {
      const localPath = path.join(workDir, f);
      const ossKey = `${ossPrefix}/${f}`;
      try {
        await ossClient.put(ossKey, localPath);
        const url = `https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/${ossKey}`;
        results.files.push({ name: f, url });
      } catch (e) {
        console.error(
          `[task ${task.taskId}] OSS data file upload failed, dropped from results: ${f} — ${e.message}`
        );
      }
    }

    // Upload RDS result
    const rdsFile = files.find((f) => f === 'result.rds');
    if (rdsFile) {
      const localPath = path.join(workDir, rdsFile);
      const ossKey = `${ossPrefix}/result.rds`;
      try {
        await ossClient.put(ossKey, localPath);
        const url = `https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/${ossKey}`;
        results.files.push({
          name: 'result.rds',
          url,
          description: 'Seurat 对象（可下载继续分析）',
        });
      } catch (e) {
        console.error(
          `[task ${task.taskId}] OSS result.rds upload failed, dropped from results — ${e.message}`
        );
      }
    }

    // Read summary
    const summaryFile = path.join(workDir, 'summary.json');
    if (fs.existsSync(summaryFile)) {
      results.summary = JSON.parse(fs.readFileSync(summaryFile, 'utf-8'));
    }
  } catch (e) {
    console.error('Error collecting task results:', e.message);
  }

  // Auto-sync metadata/features to dataset (for data preview)
  if (task.type === 'scrna_standard' || task.type === 'recluster') {
    const metaCsv = path.join(workDir, 'metadata.csv');
    const featCsv = path.join(workDir, 'features.csv');
    if (fs.existsSync(metaCsv) && fs.existsSync(featCsv)) {
      try {
        const ossPrefix2 = 'results/' + task.taskId;
        await ossClient.put(ossPrefix2 + '/metadata.csv', metaCsv);
        await ossClient.put(ossPrefix2 + '/features.csv', featCsv);
        const metaUrl =
          'https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/' + ossPrefix2 + '/metadata.csv';
        const featUrl =
          'https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/' + ossPrefix2 + '/features.csv';
        const db = require('./db');
        const analysis = db.getAnalysisByTaskId(task.taskId);
        if (analysis) {
          db.setDatasetMetaUrls(analysis.dataset_id, { metaUrl, featuresUrl: featUrl });
          console.log('[Meta] Auto-synced for dataset', analysis.dataset_id);
        }
      } catch (e) {
        console.error('[Meta] Sync failed:', e.message);
      }
    }
  }

  return results;
}

/**
 * Cleanup old tasks (call periodically).
 */
function cleanupOldTasks(maxAgeMs = 24 * 60 * 60 * 1000) {
  const now = Date.now();
  for (const [id, task] of tasks) {
    const age = now - new Date(task.createdAt).getTime();
    if (age > maxAgeMs && (task.status === STATUS.DONE || task.status === STATUS.FAILED)) {
      tasks.delete(id);
    }
  }
}

// Cleanup every hour
setInterval(() => cleanupOldTasks(), 60 * 60 * 1000);

// Register a demo task (pre-completed, with cachePath for replot/subsequent analyses)
function registerDemoTask(taskId, cachePath) {
  tasks.set(taskId, {
    taskId,
    type: 'scrna_standard',
    status: 'completed',
    progress: 100,
    progressMessage: 'Demo 分析（预置结果）',
    results: { plots: [], files: [], summary: {} },
    cachePath: cachePath,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  });
  console.log('[TaskManager] Registered demo task:', taskId, '→', cachePath);
}

module.exports = { registerDemoTask, createTask, getTask, listTasks, STATUS, generateRScript };
