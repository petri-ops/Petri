/**
 * Python Process Pool — warm embedded Python workers.
 *
 * Each worker is a persistent `python -u` session with scanpy/numpy/pandas
 * pre-imported. Reads script paths from stdin.
 *
 * BLOCK-30 P1: salvaged from core/py-server/py-pool.js (git mv) when the
 * py-server HTTP surface was removed. Config now resolves through
 * shared-backend config-helper (env fallback) instead of py-server/config.
 * Not wired into any execution path yet — BLOCK-30 P3 wires it into the
 * tools-executor Python path (lazy start + idle recycle + per-runtime keys).
 */

const {spawn} = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const configHelper = require('../config-helper');
const {
  getPythonRuntimeExecutable,
  getPythonSitePackagesDir,
} = require('../runtime-paths');
const { getExecutor } = require('./index');

// Pool-local defaults mirror the former py-server/config.js semantics.
// PY_POOL_SIZE / PY_RUN_TIMEOUT_MS stay the tuning knobs.
function _poolConfig() {
  const cfg = configHelper.getConfig();
  return {
    pyHome: cfg.pyHome || process.env.BIOF3_PY_HOME || '',
    localDataDir:
      process.env.BIOF3_LOCAL_DATA_DIR ||
      path.dirname(cfg.tempDir || '/tmp/biof3-tmp'),
    poolSize: parseInt(process.env.PY_POOL_SIZE || '2', 10),
    runTimeoutMs: parseInt(process.env.PY_RUN_TIMEOUT_MS || '30000', 10),
  };
}

// Packages to pre-import in each Python worker
const PREIMPORT = [
  'import numpy as np',
  'import pandas as pd',
  'import matplotlib; matplotlib.use("Agg")',
  'import matplotlib.pyplot as plt',
  'import scanpy as sc',
  'import json, os, sys',
];

const WORKER_TIMEOUT_MS = _poolConfig().runTimeoutMs;

class PyWorker {
  constructor(id) {
    this.id = id;
    this.busy = false;
    this.proc = null;
    this.ready = false;
    this.requestCount = 0;
    this.lastUsed = Date.now();
    this._restartCount = 0;
    this._maxRestarts = 10;
    this._start();
  }

  _start() {
    if (this._restartCount >= this._maxRestarts) {
      logger.error(`PyWorker ${this.id} exceeded max restarts`);
      return;
    }

    // Python worker script: pre-import packages, then loop reading script paths
    const workerScript = `
import sys, os, traceback
${PREIMPORT.join('\n')}
print("__READY__", flush=True)
for line in sys.stdin:
    script_path = line.strip()
    if not script_path:
        continue
    try:
        exec(open(script_path).read(), {"__name__": "__main__"})
    except Exception as e:
        print(f"Error: {e}", flush=True)
        traceback.print_exc()
    finally:
        plt.close("all")
    print("__DONE__", flush=True)
`;

    // 本地执行：直接 spawn 内嵌 python
    const pyHome = _poolConfig().pyHome;
    const pyBin =
      getPythonRuntimeExecutable(pyHome) ||
      getExecutor('python').binPath;
    const siteDir = getPythonSitePackagesDir(pyHome);
    const env = { ...process.env, PYTHONUNBUFFERED: '1' };
    if (require('fs').existsSync(siteDir)) {
      env.PYTHONPATH = siteDir + (env.PYTHONPATH ? path.delimiter + env.PYTHONPATH : '');
    }
    this.proc = spawn(pyBin, ['-u', '-c', workerScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    this._stdout = '';
    this._stderr = '';
    this._resolve = null;
    this._reject = null;

    this.proc.stdout.on('data', (data) => {
      const text = data.toString();
      if (text.includes('__READY__') && !this.ready) {
        this.ready = true;
        this._stdout = '';
        this._restartCount = 0;
        logger.debug(`PyWorker ${this.id} ready`);
        return;
      }
      if (text.includes('__DONE__')) {
        const parts = text.split('__DONE__');
        const output = this._stdout + parts[0];
        this._stdout = parts.slice(1).join('');
        if (this._resolve) {
          const resolve = this._resolve;
          this._resolve = null;
          this._reject = null;
          this.busy = false;
          this.lastUsed = Date.now();
          resolve({stdout: output.trim(), stderr: this._stderr.trim()});
          this._stderr = '';
        }
      } else {
        this._stdout += text;
      }
    });

    this.proc.stderr.on('data', (data) => {
      const text = data.toString();
      this._stderr += text;
      // Report fatal early-stage failures (no __READY__ yet) so the main log
      // surfaces the actual Python error instead of repeating "exited (code=1)
      // restarting" indefinitely. Without this, an environment without
      // numpy/scanpy crashes in <1s, drops stderr to /dev/null, and the user
      // sees only silent agent chat failures downstream.
      if (!this.ready) {
        logger.warn(`PyWorker ${this.id} startup stderr: ${text.trim()}`);
      }
    });

    this.proc.on('exit', (code) => {
      this.ready = false;
      this.busy = false;
      logger.warn(`PyWorker ${this.id} exited (code=${code}), restarting...`);
      if (this._reject) { this._reject(new Error('Python worker crashed')); this._resolve = null; this._reject = null; }
      this._restartCount++;
      const delay = Math.min(1000 * this._restartCount, 10000);
      setTimeout(() => this._start(), delay);
    });
  }

  execute(scriptPath) {
    if (!this.ready || this.busy) return Promise.reject(new Error('Worker not available'));
    this.busy = true;
    this.requestCount++;
    this._stdout = '';
    this._stderr = '';

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._resolve = null; this._reject = null; this.busy = false;
        reject(new Error(`执行超时（${WORKER_TIMEOUT_MS / 1000}秒）`));
        this.proc.kill('SIGTERM');
      }, WORKER_TIMEOUT_MS);

      this._resolve = (result) => { clearTimeout(timer); this.busy = false; this.lastUsed = Date.now(); resolve(result); };
      this._reject = (err) => { clearTimeout(timer); this.busy = false; reject(err); };

      this.proc.stdin.write(scriptPath + '\n');
    });
  }

  isAvailable() { return this.ready && !this.busy; }
  destroy() { this._maxRestarts = 0; if (this.proc) { this.proc.kill('SIGTERM'); this.proc = null; } }
  getStatus() { return {id: this.id, ready: this.ready, busy: this.busy, requestCount: this.requestCount, lastUsed: this.lastUsed}; }
}

class PyPool {
  constructor(size = _poolConfig().poolSize) {
    this.workers = [];
    this.size = size;
    this._requestQueue = [];
    for (let i = 0; i < size; i++) this.workers.push(new PyWorker(i));
    logger.info(`Python Pool: ${size} workers initializing`);
  }

  _getWorker() {
    return this.workers.filter(w => w.isAvailable()).sort((a, b) => a.lastUsed - b.lastUsed)[0] || null;
  }

  async execute(code, workDir) {
    const scriptPath = path.join(workDir, 'run.py');
    const datasetCacheDir = path.join(_poolConfig().localDataDir, 'cache', 'datasets');

    const pyScript = `
import os, sys, json
os.chdir(${JSON.stringify(workDir)})
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt

# 将 scanpy/squidpy 数据集缓存到本地 BioF3 数据目录，避免每个会话重复下载。
try:
    import scanpy as _sc
    _ds = ${JSON.stringify(datasetCacheDir)}
    os.makedirs(_ds, exist_ok=True)
    _sc.settings.datasetdir = _ds
except Exception:
    pass

_plot_counter = [0]
def _save_fig(fig=None):
    _plot_counter[0] += 1
    fname = f"plot_{_plot_counter[0]:03d}.png"
    if fig: fig.savefig(fname, dpi=150, bbox_inches="tight")
    else: plt.savefig(fname, dpi=150, bbox_inches="tight")
    plt.close("all")

try:
${code.split('\n').map(line => '    ' + line).join('\n')}
except Exception as e:
    print(f"Error: {e}")
    import traceback; traceback.print_exc()
finally:
    # Auto-save any open figure
    if plt.get_fignums():
        _save_fig()
`;
    fs.writeFileSync(scriptPath, pyScript);

    const worker = this._getWorker();
    if (worker) return worker.execute(scriptPath);

    // Queue
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._requestQueue.findIndex(r => r.resolve === resolve);
        if (idx >= 0) this._requestQueue.splice(idx, 1);
        reject(new Error('所有 Python 工作进程繁忙，请稍后重试'));
      }, WORKER_TIMEOUT_MS);
      this._requestQueue.push({
        scriptPath,
        resolve: (r) => { clearTimeout(timer); resolve(r); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
    });
  }

  _drainRequestQueue() {
    if (this._requestQueue.length === 0) return;
    const worker = this._getWorker();
    if (!worker) return;
    const req = this._requestQueue.shift();
    worker.execute(req.scriptPath).then(req.resolve).catch(req.reject);
  }

  getStatus() {
    return {size: this.size, workers: this.workers.map(w => w.getStatus()), queueLength: this._requestQueue.length, totalRequests: this.workers.reduce((s, w) => s + w.requestCount, 0)};
  }

  destroy() {
    for (const req of this._requestQueue) req.reject(new Error('Server shutting down'));
    this._requestQueue = [];
    this.workers.forEach(w => w.destroy());
  }
}

function createPool() {
  const pool = new PyPool(_poolConfig().poolSize);
  setInterval(() => pool._drainRequestQueue(), 500);
  return pool;
}

module.exports = {PyPool, createPool};
