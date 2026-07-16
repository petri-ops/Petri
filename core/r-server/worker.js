#!/usr/bin/env node
/**
 * BioF3 compute worker — claims pending tasks from SQLite and runs R via Docker.
 *
 * Usage:
 *   BIOF3_RUN_MODE=worker node worker.js
 *
 * Multiple workers: same BIOF3_DB_PATH (NFS or shared disk), unique BIOF3_WORKER_ID each.
 * API nodes: BIOF3_RUN_MODE=api node server.js (enqueue only).
 */

require('dotenv').config({path: require('path').join(__dirname, '.env')});

const config = require('./config');
const logger = require('./logger');
const taskStore = require('./task-store');
const taskQueue = require('./task-queue');
const {generateRScript} = require('./task-manager');

const POLL_MS = parseInt(process.env.BIOF3_WORKER_POLL_MS || '2000', 10);

if (config.runMode !== 'worker') {
  console.warn('[worker] BIOF3_RUN_MODE is not "worker" (current: %s). Continuing anyway.', config.runMode);
}

taskQueue.setScriptGenerator(generateRScript);

logger.info('BioF3 worker started', {
  workerId: config.workerId,
  dbPath: config.dbPath,
  maxConcurrent: config.maxConcurrentTasks,
  pollMs: POLL_MS,
});

let busy = false;

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const task = await Promise.race([
      Promise.resolve(taskStore.claimPendingTask(config.workerId)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('claimTimeout')), 12_000)),
    ]).catch((e) => {
      if (e.message === 'claimTimeout') return null;
      throw e;
    });
    if (task) {
      await taskQueue.runTaskRow(task);
    }
  } catch (e) {
    logger.error('Worker tick error', {error: e && e.message});
  } finally {
    busy = false;
  }
}

setInterval(() => { void tick(); }, POLL_MS);
void tick();

process.on('SIGTERM', () => {
  logger.info('Worker SIGTERM');
  process.exit(0);
});