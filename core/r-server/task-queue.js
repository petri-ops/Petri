/**
 * Task Queue — Concurrency-controlled task execution.
 *
 * Manages how many R tasks run in parallel. When a task finishes,
 * the next pending task is automatically dequeued and started.
 *
 * Designed for multi-user scenarios where many tasks may be submitted
 * simultaneously but the server has limited R execution capacity.
 */

const config = require('./config');
const logger = require('./logger');
const taskStore = require('./task-store');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const {
  createTaskExecutionContext,
  attachExecutionMetadata,
} = require('../shared-backend/execution-context');
const {
  syncStepToolRunning,
  syncStepToolCompleted,
  syncStepToolFailed,
} = require('./helpers/step-tool-job');

// Import script generators from the existing task-manager
// (we'll refactor these into a separate module)
let generateRScript = null;

/**
 * Set the R script generator function.
 * Called during initialization to avoid circular deps.
 */
function setScriptGenerator(fn) {
  generateRScript = fn;
}

// Active task tracking
const activeTasks = new Map(); // taskId → {process, abortController}

/**
 * Submit a new task to the queue.
 * Returns immediately with taskId. Execution happens asynchronously.
 */
function submitTask({ type, params, ossInputUrl, parentTaskId }) {
  const taskId = uuidv4();
  const workDir = path.join(config.tempDir, `task-${taskId}`);
  const containerWorkDir = `${config.containerTempDir}/task-${taskId}`;

  // Platform enqueue runs on ECS — work dirs must be created on Dell worker only.
  if (config.runMode !== 'platform') {
    config.mkdirSandbox(workDir);
  }

  taskStore.insertTask({
    taskId,
    type,
    params,
    ossInputUrl,
    workDir,
    containerWorkDir,
    parentTaskId,
  });

  const execution = createTaskExecutionContext(
    { taskId, type, workDir, containerWorkDir },
    config,
    'r'
  );

  logger.info('Task submitted', { taskId, type, parentTaskId: parentTaskId || null, execution });

  if (config.runMode === 'all') {
    setImmediate(() => drainQueue());
  }
  // platform / api: enqueue only — Dell worker claims from PostgreSQL

  return { taskId, status: 'pending', execution };
}

/**
 * Drain the queue: start pending tasks up to concurrency limit.
 */
function drainQueue() {
  for (let i = 0; i < config.maxConcurrentTasks; i++) {
    const task = taskStore.claimPendingTask(config.workerId);
    if (!task) break;
    void runTaskRow(task);
  }
}

/**
 * Execute a single task.
 */
const CACHE_DIR = process.env.BIOF3_CACHE_DIR || '/mnt/storage_16tb/omichub/biof3-cache';
const CONTAINER_CACHE_DIR = process.env.CONTAINER_CACHE_DIR || '/app/data/biof3-cache';

function resolveTaskPaths(task) {
  const taskId = task.taskId;
  const workDir = task.workDir || path.join(config.tempDir, `task-${taskId}`);
  const containerWorkDir = task.containerWorkDir || `${config.containerTempDir}/task-${taskId}`;
  return { workDir, containerWorkDir };
}

async function executeTask(task, opts = {}) {
  const { taskId, type, params, ossInputUrl, parentTaskId } = task;
  const { workDir, containerWorkDir } = resolveTaskPaths(task);
  const execution = createTaskExecutionContext({ ...task, workDir, containerWorkDir }, config, 'r');
  config.mkdirSandbox(workDir);

  if (!opts.skipMarkRunning) {
    taskStore.markRunning(taskId);
  }
  logger.info('Task started', {
    taskId,
    type,
    workerId: task.workerId || config.workerId,
    execution,
  });
  try {
    syncStepToolRunning({ ...task, workDir, containerWorkDir }, execution);
  } catch (error) {
    logger.warn('Step tool job running sync failed', { taskId, error: error.message });
  }

  try {
    if (!generateRScript) {
      throw new Error('Script generator not initialized');
    }

    const scriptTask = {
      type,
      params,
      ossInputUrl,
      containerWorkDir,
      parentTaskId: parentTaskId || null,
      workDir,
      taskId,
    };
    if (parentTaskId) {
      const parentCachePath = path.join(CACHE_DIR, `task-${parentTaskId}.rds`);
      if (fs.existsSync(parentCachePath)) {
        scriptTask.parentCachePath = `${CONTAINER_CACHE_DIR}/task-${parentTaskId}.rds`;
      }
    }

    const rScript = generateRScript(scriptTask);
    const scriptPath = path.join(workDir, 'run_task.R');
    fs.writeFileSync(scriptPath, rScript);

    // Start progress polling
    const progressInterval = setInterval(() => {
      pollProgress(taskId, workDir);
    }, 2000);

    // Execute: local 模式直接调 Rscript；docker 模式走 docker exec
    const _result = await new Promise((resolve, reject) => {
      let execCmd, execArgs;
      if (config.execMode === 'local') {
        const { getExecutor } = require('../shared-backend/executors');
        const executor = getExecutor('r');
        const spawnCmd = executor.buildSpawnCommand(`${containerWorkDir}/run_task.R`, workDir, {});
        execCmd = spawnCmd.cmd;
        execArgs = spawnCmd.args;
      } else {
        execCmd = 'docker';
        execArgs = [
          ...config.dockerExecArgs(),
          'Rscript',
          '--vanilla',
          `${containerWorkDir}/run_task.R`,
        ];
      }
      const proc = execFile(
        execCmd,
        execArgs,
        {
          timeout: config.taskTimeoutMs,
          maxBuffer: 1024 * 1024 * 20,
          env: { ...process.env, LC_ALL: 'en_US.UTF-8' },
        },
        (error, stdout, stderr) => {
          activeTasks.delete(taskId);
          if (error) {
            if (error.killed) {
              reject(new Error(`分析超时（最大 ${config.taskTimeoutMs / 60000} 分钟）`));
            } else {
              reject(new Error(stderr || error.message));
            }
          } else {
            resolve({ stdout, stderr });
          }
        }
      );

      activeTasks.set(taskId, { process: proc });
    });

    clearInterval(progressInterval);

    // Collect and upload results
    const results = attachExecutionMetadata(await collectTaskResults(taskId, workDir), execution);

    taskStore.markDone(taskId, { results });
    try {
      syncStepToolCompleted({ ...task, workDir, containerWorkDir }, results, execution);
    } catch (error) {
      logger.warn('Step tool job completion sync failed', { taskId, error: error.message });
    }
    logger.info('Task completed', { taskId, type });
  } catch (err) {
    taskStore.markFailed(taskId, err.message);
    try {
      syncStepToolFailed({ ...task, workDir, containerWorkDir }, err.message, execution);
    } catch (error) {
      logger.warn('Step tool job failure sync failed', { taskId, error: error.message });
    }
    logger.error('Task failed', { taskId, type, error: err.message });
  }

  // Cleanup work directory after delay
  setTimeout(
    () => {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {}
    },
    5 * 60 * 1000
  );

  // Try to start next pending task
  setImmediate(() => drainQueue());
}

/**
 * Poll progress.json written by R script.
 */
function pollProgress(taskId, workDir) {
  const progressFile = path.join(workDir, 'progress.json');
  try {
    if (fs.existsSync(progressFile)) {
      const prog = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
      if (prog.progress && prog.message) {
        taskStore.updateProgress(taskId, prog.progress, prog.message);
      }
    }
  } catch {
    /* ignore parse errors from partial writes */
  }
}

/**
 * Collect result files and upload to OSS.
 */
async function collectTaskResults(taskId, workDir) {
  const IS_LOCAL = config.storageMode === 'local';
  let ossClient = null;
  let storage = null;
  if (IS_LOCAL) {
    const { getActiveStorage } = require('../shared-backend/storage');
    storage = getActiveStorage();
  } else {
    const OSS = require('ali-oss');
    ossClient = new OSS({
      region: config.oss.region,
      accessKeyId: config.oss.accessKeyId,
      accessKeySecret: config.oss.accessKeySecret,
      bucket: config.oss.bucket,
    });
  }

  const results = { plots: [], files: [], summary: null };

  try {
    const files = fs.readdirSync(workDir);
    const ossPrefix = `results/task-${taskId}`;

    // Upload plots
    const plotFiles = files.filter((f) => f.startsWith('plot_') && f.endsWith('.png'));
    plotFiles.sort();
    for (const f of plotFiles) {
      const localPath = path.join(workDir, f);
      const ossKey = `${ossPrefix}/${f}`;
      try {
        let url;
        if (storage) {
          url = await storage.upload(localPath, ossKey);
        } else {
          await ossClient.put(ossKey, localPath);
          url = `${config.ossHost}/${ossKey}`;
        }
        const name = f
          .replace(/^plot_\d+_/, '')
          .replace('.png', '')
          .replace(/_/g, ' ');
        results.plots.push({ name, url, filename: f });
      } catch {
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
        let url;
        if (storage) {
          url = await storage.upload(localPath, ossKey);
        } else {
          await ossClient.put(ossKey, localPath);
          url = `${config.ossHost}/${ossKey}`;
        }
        results.files.push({ name: f, url });
      } catch {}
    }

    // Upload RDS results
    const rdsFiles = files.filter((f) => f.endsWith('.rds') && f.startsWith('result'));
    for (const f of rdsFiles) {
      const localPath = path.join(workDir, f);
      const ossKey = `${ossPrefix}/${f}`;
      try {
        let url;
        if (storage) {
          url = await storage.upload(localPath, ossKey);
        } else {
          await ossClient.put(ossKey, localPath);
          url = `${config.ossHost}/${ossKey}`;
        }
        results.files.push({
          name: f,
          url,
          description: 'R 对象（可下载继续分析）',
        });
      } catch {}
    }

    // Read summary
    const summaryFile = path.join(workDir, 'summary.json');
    if (fs.existsSync(summaryFile)) {
      results.summary = JSON.parse(fs.readFileSync(summaryFile, 'utf-8'));
    }
  } catch (e) {
    logger.error('Error collecting task results', { taskId, error: e.message });
  }

  return results;
}

/**
 * Cancel a running task.
 */
function cancelTask(taskId) {
  const active = activeTasks.get(taskId);
  if (active && active.process) {
    active.process.kill('SIGTERM');
    activeTasks.delete(taskId);
    taskStore.markFailed(taskId, '用户取消');
    logger.info('Task cancelled', { taskId });
    return true;
  }
  // If pending, just mark failed
  const task = taskStore.getTask(taskId);
  if (task && task.status === 'pending') {
    taskStore.markFailed(taskId, '用户取消');
    return true;
  }
  return false;
}

/**
 * Get queue status for monitoring.
 */
function getQueueStatus() {
  const stats = taskStore.getStats();
  return {
    ...stats,
    maxConcurrent: config.maxConcurrentTasks,
    activeProcesses: activeTasks.size,
  };
}

/** Worker: run a row already claimed (status=running). */
async function runTaskRow(task) {
  return executeTask(task, { skipMarkRunning: true });
}

module.exports = {
  submitTask,
  cancelTask,
  getQueueStatus,
  drainQueue,
  setScriptGenerator,
  runTaskRow,
};
