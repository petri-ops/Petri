/**
 * Python Executor — Python 语言执行器实现
 *
 * 桌面版（execMode='local'）：直接调内嵌 Python，不走 docker。
 * Web 版（execMode='docker'）：走 docker exec，保持原有行为。
 *
 * 与 RExecutor 对称，实现同一 LanguageExecutor 接口。
 */

const path = require('path');
const fs = require('fs');
const { execFileSync, spawn } = require('child_process');
const logger = require('../logger');
const {
  getPythonRuntimeExecutable,
  getPythonSitePackagesDir,
} = require('../runtime-paths');

// 从 config-helper 读取配置（断点1：斩断对 py-server/config 的反向 require）
// 调用方启动时通过 require('shared-backend').configure({getConfig}) 注入；
// 未注入时 config-helper 走 env fallback，仍能独立跑。
const configHelper = require('../config-helper');
function getPyConfig() {
  return configHelper.getConfig();
}

class PythonExecutor {
  get name() {
    return 'python';
  }

  /**
   * Python 可执行文件路径。
   * local 模式用内嵌 Python；docker 模式返回 'python3'。
   */
  get binPath() {
    const cfg = getPyConfig();
    if (cfg.execMode === 'local') {
      const runtimeHome = cfg.pyHome || path.join(__dirname, '../../py-server/Python');
      return getPythonRuntimeExecutable(runtimeHome) || path.join(runtimeHome, 'python.exe');
    }
    return 'python3';
  }

  /**
   * 构造运行 Python 脚本的完整命令参数。
   * @param {string} scriptPath - Python 脚本绝对路径
   * @param {string} workDir - 工作目录
   * @param {object} params - 工具参数（写入 params.json 供 Python 读取）
   * @returns {string[]} spawn 参数数组（不含可执行文件本身）
   */
  buildRunArgs(scriptPath, workDir, params) {
    const paramFile = path.join(workDir, 'params.json');
    fs.writeFileSync(paramFile, JSON.stringify(params));
    return [scriptPath, '--params', paramFile];
  }

  /**
   * 构造完整的 spawn 命令（含可执行文件）。
   * local 模式：['/path/to/python3', script.py, --params, params.json]
   * docker 模式：['docker', 'exec', '<container>', 'python3', script.py, ...]
   * @returns {{cmd: string, args: string[]}}
   */
  buildSpawnCommand(scriptPath, workDir, params) {
    const cfg = getPyConfig();
    const scriptArgs = this.buildRunArgs(scriptPath, workDir, params);

    if (cfg.execMode === 'local') {
      const env = { ...process.env };
      // 确保 site-packages 在 PYTHONPATH 里
      const siteDir = getPythonSitePackagesDir(cfg.pyHome || '');
      if (fs.existsSync(siteDir)) {
        env.PYTHONPATH = siteDir + (env.PYTHONPATH ? path.delimiter + env.PYTHONPATH : '');
      }
      return { cmd: this.binPath, args: scriptArgs, env };
    }
    // docker 模式
    const container = cfg.pyContainer || 'biof3_python_1';
    return { cmd: 'docker', args: ['exec', container, 'python3', ...scriptArgs] };
  }

  /**
   * 创建进程池 worker（常驻 Python 进程）。
   * local 模式：spawn 本地 python -u -i
   * docker 模式：返回 null（由 py-pool.js 原有逻辑处理）
   */
  buildPoolWorker() {
    const cfg = getPyConfig();
    if (cfg.execMode === 'local') {
      const pyBin = this.binPath;
      const siteDir = getPythonSitePackagesDir(cfg.pyHome || '');
      const env = { ...process.env };
      if (fs.existsSync(siteDir)) {
        env.PYTHONPATH = siteDir + (env.PYTHONPATH ? path.delimiter + env.PYTHONPATH : '');
      }
      return spawn(pyBin, ['-u', '-i'], { env });
    }
    return null; // docker 模式走 py-pool.js 原有逻辑
  }

  /**
   * 检查 Python 包是否已安装。
   * local 模式：检查 site-packages/<pkg> 目录。
   * docker 模式：用 docker exec 查询。
   */
  checkPackageInstalled(pkgName) {
    const cfg = getPyConfig();
    const normalized = pkgName.replace(/-/g, '_');

    if (cfg.execMode === 'local') {
      const siteDir = getPythonSitePackagesDir(cfg.pyHome || '');
      // Python 包目录可能是 pkg_name/ 或 pkg_name.egg-info/ 或 pkg.dist-info/
      return (
        fs.existsSync(path.join(siteDir, normalized)) ||
        fs.existsSync(path.join(siteDir, `${normalized}.egg-info`)) ||
        fs.existsSync(path.join(siteDir, `${normalized}.dist-info`))
      );
    }
    // docker 模式
    try {
      const container = cfg.pyContainer || 'biof3_python_1';
      const out = execFileSync(
        'docker',
        [
          'exec',
          container,
          'python3',
          '-c',
          `import importlib; print(importlib.util.find_spec("${pkgName}") is not None)`,
        ],
        { timeout: 10000, encoding: 'utf8' }
      );
      return out.trim() === 'True';
    } catch {
      return false;
    }
  }

  /**
   * 安装插件带来的预编译 Python 包。
   * Python 包（conda-pack 产出）解压到 site-packages/ 即可。
   */
  installPackages(pkgDir, targetDir) {
    const cfg = getPyConfig();
    const siteDir = targetDir || getPythonSitePackagesDir(cfg.pyHome || '');
    if (!fs.existsSync(pkgDir)) {
      logger.warn(`[py-executor] 包目录不存在: ${pkgDir}`);
      return;
    }
    fs.mkdirSync(siteDir, { recursive: true });
    const entries = fs.readdirSync(pkgDir);
    for (const entry of entries) {
      const src = path.join(pkgDir, entry);
      const dst = path.join(siteDir, entry);
      if (fs.existsSync(dst)) {
        fs.rmSync(dst, { recursive: true, force: true });
      }
      copyDirRecursive(src, dst);
      logger.info(`[py-executor] 安装包: ${entry}`);
    }
  }

  /**
   * 校验 Python 版本是否满足要求。
   * @param {string} required - 如 ">=3.11"
   */
  checkRuntimeVersion(required) {
    const current = this._getPyVersion();
    return satisfiesVersion(current, required);
  }

  /**
   * 校验插件包的 builtAgainst 与当前 Python 的 major.minor 是否兼容。
   * Python C 扩展在 X.Y 编译，加载到 X.Z（不同 minor）会 ABI 不兼容。
   * @param {string} builtAgainst - 如 "3.11" 或 "3.11.x"
   * @returns {{ok: boolean, current: string, required: string}}
   */
  checkBuiltAgainst(builtAgainst) {
    const current = this._getPyVersion();
    const curMM = current.split('.').slice(0, 2).join('.');
    const reqMM = String(builtAgainst).split('.').slice(0, 2).join('.');
    return { ok: curMM === reqMM, current, required: builtAgainst };
  }

  _getPyVersion() {
    const cfg = getPyConfig();
    try {
      if (cfg.execMode === 'local') {
        const pyBin = this.binPath;
        const out = execFileSync(pyBin, ['--version'], { encoding: 'utf8', timeout: 5000 });
        return out.match(/Python (\d+\.\d+\.\d+)/)?.[1] || '0.0.0';
      }
      const container = cfg.pyContainer || 'biof3_python_1';
      const out = execFileSync('docker', ['exec', container, 'python3', '--version'], {
        encoding: 'utf8',
        timeout: 10000,
      });
      return out.match(/Python (\d+\.\d+\.\d+)/)?.[1] || '0.0.0';
    } catch {
      return '0.0.0';
    }
  }
}

// ── helpers ──────────────────────────────────────────────────

function copyDirRecursive(src, dst) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyDirRecursive(path.join(src, entry), path.join(dst, entry));
    }
  } else {
    fs.copyFileSync(src, dst);
  }
}

function parseVersion(v) {
  return v.split('.').map((x) => parseInt(x, 10) || 0);
}

function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

function satisfiesVersion(current, requirement) {
  // requirement: ">=3.11" 或 "3.11.9" 或 ">=3.11.0"
  const match = requirement.match(/^(>=|>|<=|<|==)?\s*(\d+(?:\.\d+){0,2})$/);
  if (!match) return true;
  const [, op, required] = match;
  const cmp = compareVersions(current, required);
  switch (op) {
    case '>=':
      return cmp >= 0;
    case '>':
      return cmp > 0;
    case '<=':
      return cmp <= 0;
    case '<':
      return cmp < 0;
    case '==':
      return cmp === 0;
    default:
      return cmp >= 0;
  }
}

module.exports = { PythonExecutor };
