/**
 * Python Process Pool — warm embedded Python workers.
 *
 * Each worker is a persistent `python -u` session with scanpy/numpy/pandas
 * pre-imported. Reads script paths from stdin.
 */

const {spawn} = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./logger');
const {
  getPythonRuntimeExecutable,
  getPythonSitePackagesDir,
} = require('../shared-backend/runtime-paths');

// Packages to pre-import in each Python worker
const PREIMPORT = [
  'import numpy as np',
  'import pandas as pd',
  'import matplotlib; matplotlib.use("Agg")',
  'import matplotlib.pyplot as plt',
  'import scanpy as sc',
  'import json, os, sys',
];

const WORKER_TIMEOUT_MS = config.runTimeoutMs;
const { getExecutor } = require('../shared-backend/executors');

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
    const pyBin =
      getPythonRuntimeExecutable(config.pyHome || process.env.BIOF3_PY_HOME || '') ||
      getExecutor('python').binPath;
    const siteDir = getPythonSitePackagesDir(config.pyHome || process.env.BIOF3_PY_HOME || '');
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

    this.proc.stderr.on('data', (data) => { this._stderr += data.toString(); });

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
  constructor(size = config.poolSize) {
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
    // 本地执行：containerWorkDir = workDir（无容器路径转换）
    const containerWorkDir = workDir;
    const scriptPath = path.join(workDir, 'run.py');
    const containerScriptPath = `${containerWorkDir}/run.py`;

    const pyScript = `
import os, sys, json
os.chdir("${containerWorkDir}")
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt

# W4-B (2026-05-30): 把 scanpy/squidpy 数据集缓存指到共享目录，避免 FigCode 卡每次
# 在 per-session cwd 重下 ~80MB Visium 数据集（之前导致 spatial 卡 30s fast-path 超时）。
try:
    import scanpy as _sc
    _ds = "/app/data/biof3-py-tmp/_datasets"
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
    if (worker) return worker.execute(containerScriptPath);

    // Queue
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._requestQueue.findIndex(r => r.resolve === resolve);
        if (idx >= 0) this._requestQueue.splice(idx, 1);
        reject(new Error('所有 Python 工作进程繁忙，请稍后重试'));
      }, WORKER_TIMEOUT_MS);
      this._requestQueue.push({
        scriptPath: containerScriptPath,
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
  const pool = new PyPool(config.poolSize);
  setInterval(() => pool._drainRequestQueue(), 500);
  return pool;
}

module.exports = {PyPool, createPool};
