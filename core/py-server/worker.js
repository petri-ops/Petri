#!/usr/bin/env node
/**
 * BioF3 Python compute worker — claims pending tasks (engine=Python) from PostgreSQL and runs Docker.
 *
 * Usage:
 *   BIOF3_RUN_MODE=worker BIOF3_WORKER_ID=py-dell node worker.js
 *
 * Pair with py-server in api mode (enqueue only). Same DATABASE_URL as r-server.
 */

const fs = require('fs');
const path = require('path');
for (const envFile of [path.join(__dirname, '.env'), '/etc/biof3.env']) {
  if (!fs.existsSync(envFile)) continue;
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (k && v && process.env[k] === undefined) process.env[k] = v;
  }
}

const config = require('./config');
const logger = require('./logger');
const taskStore = require('./task-store');
const taskQueue = require('./task-queue');
const {generatePyScript} = require('./task-scripts');

const POLL_MS = parseInt(process.env.BIOF3_WORKER_POLL_MS || process.env.PY_WORKER_POLL_MS || '2000', 10);

if (config.runMode !== 'worker') {
  console.warn('[py-worker] BIOF3_RUN_MODE is not "worker" (current: %s). Continuing anyway.', config.runMode);
}

taskQueue.setScriptGenerator(generatePyScript);

logger.info('BioF3 py-worker started', {
  workerId: config.workerId,
  maxConcurrent: config.maxConcurrentTasks,
  pollMs: POLL_MS,
});

let busy = false;

async function claimOne() {
  const usePg = !!(process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim());
  if (usePg) {
    const pg = require('./task-store-pg');
    return pg.asyncClaimPendingTask(config.workerId);
  }
  return taskStore.claimPendingTask(config.workerId);
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const task = await Promise.race([
      claimOne(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('claimTimeout')), 12_000)),
    ]).catch((e) => {
      if (e.message === 'claimTimeout') return null;
      throw e;
    });
    if (task) {
      await taskQueue.runTaskRow(task);
    }
  } catch (e) {
    logger.error('Py worker tick error', {error: e && e.message});
  } finally {
    busy = false;
  }
}

setInterval(() => { void tick(); }, POLL_MS);
void tick();

process.on('SIGTERM', () => {
  logger.info('Py worker SIGTERM');
  process.exit(0);
});
