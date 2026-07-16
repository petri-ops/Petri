/**
 * Task Queue — Async polling queue for Python tasks.
 * drainQueue is fully async so task execution does not block queue polling.
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

try {
  fs.mkdirSync(config.cacheDir, { recursive: true });
} catch {}

let generatePyScript = null;
function setScriptGenerator(fn) {
  generatePyScript = fn;
}

const activeTasks = new Map();

function submitTask({ type, params, ossInputUrl, parentTaskId }) {
  const taskId = uuidv4();
  const workDir = path.join(config.tempDir, `task-${taskId}`);
  const containerWorkDir = workDir;
  fs.mkdirSync(workDir, { recursive: true });

  const allParams = parentTaskId ? { ...(params || {}), parentTaskId } : params || {};
  taskStore.insertTask({ taskId, type, params: allParams, ossInputUrl, workDir, containerWorkDir });
  const execution = createTaskExecutionContext(
    { taskId, type, workDir, containerWorkDir },
    config,
    'python'
  );
  logger.info('Task submitted', { taskId, type, parentTaskId: parentTaskId || null, execution });

  setImmediate(() => {
    void drainQueue();
  });
  return { taskId, status: 'pending', execution };
}

// Fully async polling loop — does NOT block, so promises (including executeTask)
// resolve normally. Each iteration: try to claim up to (maxConcurrent - running) tasks.
const POLL_MS = parseInt(process.env.PY_WORKER_POLL_MS || '2000', 10);
let drainRunning = false;

async function drainQueue() {
  if (drainRunning) return;
  drainRunning = true;
  try {
    let running;
    try {
      running = taskStore.getRunningCount();
    } catch (e) {
      logger.error('getRunningCount error', { error: e.message });
      return;
    }
    const available = config.maxConcurrentTasks - running;
    if (available <= 0) return;

    for (let i = 0; i < available; i++) {
      let task;
      try {
        task = taskStore.claimPendingTask(config.workerId);
      } catch (e) {
        logger.error('claimPendingTask error', { error: e.message });
        break;
      }
      if (!task) break;

      // Fire-and-forget: executeTask runs async, leaving the queue loop available.
      void executeTask(task).then(() => {
        void drainQueue();
      });
    }
  } finally {
    drainRunning = false;
  }
}

async function runTaskRow(task) {
  const taskId = task.taskId;
  const workDir = task.workDir || path.join(config.tempDir, `task-${taskId}`);
  const containerWorkDir = task.containerWorkDir || workDir;
  if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });
  return executeTask({ ...task, workDir, containerWorkDir });
}

async function executeTask(task) {
  const { taskId, type, params, ossInputUrl } = task;
  const workDir = task.workDir;
  const containerWorkDir = task.containerWorkDir;
  const execution = createTaskExecutionContext(task, config, 'python');

  activeTasks.set(taskId, { status: 'running' });
  taskStore.markRunning(taskId);
  logger.info('Task started', { taskId, type, execution });

  try {
    if (!generatePyScript) throw new Error('Script generator not initialized');

    let parentCachePath = null;
    const parentTaskId = (params && params.parentTaskId) || null;
    if (parentTaskId) {
      const cacheFile = path.join(config.cacheDir, `task-${parentTaskId}.h5ad`);
      if (fs.existsSync(cacheFile)) {
        parentCachePath = cacheFile;
        logger.info('Using parent cache', { taskId, parentTaskId, parentCachePath });
      }
    }

    const pyScript = generatePyScript({
      type,
      params,
      ossInputUrl,
      containerWorkDir,
      parentCachePath,
    });
    const scriptPath = path.join(workDir, 'run_task.py');
    fs.writeFileSync(scriptPath, pyScript);

    const progressInterval = setInterval(() => pollProgress(taskId, workDir), 2000);

    const execOpts = {
      maxBuffer: 1024 * 1024 * 20,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    };
    if (config.taskTimeoutMs > 0) execOpts.timeout = config.taskTimeoutMs;

    await new Promise((resolve, reject) => {
      // 本地执行：直接调内嵌 python
      const { getExecutor } = require('../shared-backend/executors');
      const executor = getExecutor('python');
      const spawnCmd = executor.buildSpawnCommand(`${containerWorkDir}/run_task.py`, workDir, {});
      const execCmd = spawnCmd.cmd;
      const execArgs = spawnCmd.args;
      if (spawnCmd.env) execOpts.env = { ...execOpts.env, ...spawnCmd.env };
      const proc = execFile(execCmd, execArgs, execOpts, (error, stdout, stderr) => {
        activeTasks.delete(taskId);
        clearInterval(progressInterval);
        if (error) {
          if (error.killed && config.taskTimeoutMs > 0)
            reject(new Error(`分析超时（最大 ${config.taskTimeoutMs / 60000} 分钟）`));
          else if (error.killed) reject(new Error('任务被中止（可能是内存超限或用户取消）'));
          else reject(new Error(stderr || error.message));
        } else resolve({ stdout, stderr });
      });
      activeTasks.set(taskId, { process: proc });
    });

    const results = attachExecutionMetadata(await collectTaskResults(taskId, workDir), execution);
    taskStore.markDone(taskId, { results });
    logger.info('Task completed', { taskId, type });

    if (type === 'spatial_standard' || type === 'spatial' || type === 'spatial_recluster') {
      try {
        const resultH5ad = path.join(workDir, 'result_spatial.h5ad');
        const cacheDest = path.join(config.cacheDir, `task-${taskId}.h5ad`);
        if (fs.existsSync(resultH5ad) && !fs.existsSync(cacheDest)) {
          fs.copyFileSync(resultH5ad, cacheDest);
          logger.info('Cache saved', { taskId, cacheDest });
        }
      } catch (cErr) {
        logger.warn('Cache save failed', { taskId, error: cErr.message });
      }
    }

    if (type === 'spatial_standard' || type === 'spatial' || type === 'spatial_recluster') {
      try {
        const metaUrl = (results.files || []).find((f) => f.name === 'metadata.csv')?.url;
        const featUrl = (results.files || []).find((f) => f.name === 'features.csv')?.url;
        if (metaUrl || featUrl) {
          const { updateDatasetMetaUrlsByTaskId } = require('./r-server-db');
          if (updateDatasetMetaUrlsByTaskId)
            updateDatasetMetaUrlsByTaskId(taskId, { metaUrl, featuresUrl: featUrl });
        }
      } catch (e) {
        logger.warn('Cross-server bridge error', { taskId, error: e.message });
      }
    }
  } catch (err) {
    taskStore.markFailed(taskId, err.message);
    logger.error('Task failed', { taskId, type, error: err.message });
  }

  setTimeout(
    () => {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {}
    },
    5 * 60 * 1000
  );
}

function pollProgress(taskId, workDir) {
  const progressFile = path.join(workDir, 'progress.json');
  try {
    if (fs.existsSync(progressFile)) {
      const prog = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
      if (prog.progress && prog.message)
        taskStore.updateProgress(taskId, prog.progress, prog.message);
    }
  } catch {}
}

async function collectTaskResults(taskId, workDir) {
  const { getActiveStorage } = require('../shared-backend/storage');
  let storage = null;
  try {
    storage = getActiveStorage();
  } catch {}
  const results = { plots: [], files: [], summary: null };

  try {
    const files = fs.readdirSync(workDir);
    const keyPrefix = `results/py-task-${taskId}`;

    const plotFiles = files.filter((f) => f.match(/\.(png|svg|pdf)$/) && !f.startsWith('input'));
    plotFiles.sort();
    for (const f of plotFiles) {
      const localPath = path.join(workDir, f);
      const key = `${keyPrefix}/${f}`;
      try {
        if (!storage) throw new Error('storage adapter unavailable');
        const url = await storage.upload(localPath, key);
        results.plots.push({
          name: f.replace(/\.[^.]+$/, '').replace(/_/g, ' '),
          url,
          filename: f,
        });
      } catch (e) {
        logger.warn('Plot upload failed, falling back to base64', {
          taskId,
          file: f,
          error: e.message,
        });
        const imgData = fs.readFileSync(localPath);
        results.plots.push({
          name: f,
          url: `data:image/png;base64,${imgData.toString('base64')}`,
          filename: f,
        });
      }
    }

    const dataFiles = files.filter((f) => f.match(/\.(csv|tsv|h5ad)$/) && !f.startsWith('input'));
    for (const f of dataFiles) {
      const localPath = path.join(workDir, f);
      const key = `${keyPrefix}/${f}`;
      try {
        if (!storage) throw new Error('storage adapter unavailable');
        const url = await storage.upload(localPath, key);
        results.files.push({ name: f, url });
      } catch (e) {
        logger.error('Data file upload failed, file dropped from results', {
          taskId,
          file: f,
          error: e.message,
        });
      }
    }

    const summaryFile = path.join(workDir, 'summary.json');
    if (fs.existsSync(summaryFile))
      results.summary = JSON.parse(fs.readFileSync(summaryFile, 'utf-8'));
  } catch (e) {
    logger.error('Error collecting task results', { taskId, error: e.message });
  }
  return results;
}

function cancelTask(taskId) {
  const active = activeTasks.get(taskId);
  if (active && active.process) {
    active.process.kill('SIGTERM');
    activeTasks.delete(taskId);
    taskStore.markFailed(taskId, '用户取消');
    return true;
  }
  const task = taskStore.getTask(taskId);
  if (task && task.status === 'pending') {
    taskStore.markFailed(taskId, '用户取消');
    return true;
  }
  return false;
}

function getQueueStatus() {
  const stats = taskStore.getStats();
  const active = [...activeTasks.entries()].map(([id]) => id);
  return { stats, activeTasks: active };
}

function getActiveTasks() {
  return activeTasks;
}

function scheduleDrain() {
  setImmediate(() => {
    void drainQueue();
  });
}

setInterval(() => {
  void drainQueue();
}, POLL_MS);

module.exports = {
  submitTask,
  cancelTask,
  getQueueStatus,
  getActiveTasks,
  setScriptGenerator,
  drainQueue,
  scheduleDrain,
  runTaskRow,
};
