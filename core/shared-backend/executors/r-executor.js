/**
 * R Executor — R 语言执行器实现
 *
 * 桌面版（execMode='local'）：直接调内嵌 Rscript，不走 docker。
 * Web 版（execMode='docker'）：走 docker exec，保持原有行为。
 *
 * 加新语言时参照此文件新建一个 Executor 即可，不改核心。
 */

const path = require('path');
const fs = require('fs');
const { execFileSync, spawn } = require('child_process');
const logger = require('../logger');

// 从 config-helper 读取配置（断点1：斩断对 r-server/config 的反向 require）
// 调用方启动时通过 require('shared-backend').configure({getConfig}) 注入；
// 未注入时 config-helper 走 env fallback，仍能独立跑。
const configHelper = require('../config-helper');
function getRConfig() {
  return configHelper.getConfig();
}

class RExecutor {
  get name() {
    return 'r';
  }

  /**
   * Rscript 可执行文件路径。
   * local 模式用内嵌 R；docker 模式返回 'Rscript'（由调用方拼 docker args）。
   */
  get binPath() {
    const cfg = getRConfig();
    if (cfg.execMode === 'local') {
      return path.join(cfg.rHome || path.join(__dirname, '../../r-server/R'), 'bin', 'Rscript');
    }
    return 'Rscript';
  }

  /**
   * 构造运行 R 脚本的完整命令参数。
   * @param {string} scriptPath - R 脚本绝对路径
   * @param {string} workDir - 工作目录
   * @param {object} params - 工具参数（写入 params.json 供 R 读取）
   * @returns {string[]} spawn 参数数组（不含可执行文件本身）
   */
  buildRunArgs(scriptPath, workDir, params) {
    const paramFile = path.join(workDir, 'params.json');
    fs.writeFileSync(paramFile, JSON.stringify(params));

    const cfg = getRConfig();
    if (cfg.execMode === 'local') {
      return [scriptPath, '--args', paramFile];
    }
    // docker 模式：调用方需用 ['docker', ...cfg.dockerExecArgs(), 'Rscript', ...args]
    return [scriptPath, '--args', paramFile];
  }

  /**
   * 构造完整的 spawn 命令（含可执行文件）。
   * local 模式：['/path/to/Rscript', script.R, --args, params.json]
   * docker 模式：['docker', 'exec', '<container>', 'Rscript', script.R, --args, params.json]
   * @returns {{cmd: string, args: string[]}}
   */
  buildSpawnCommand(scriptPath, workDir, params) {
    const cfg = getRConfig();
    const scriptArgs = this.buildRunArgs(scriptPath, workDir, params);

    if (cfg.execMode === 'local') {
      return { cmd: this.binPath, args: scriptArgs };
    }
    // docker 模式
    const dockerArgs =
      typeof cfg.dockerExecArgs === 'function'
        ? cfg.dockerExecArgs()
        : ['exec', cfg.rContainer || 'omichub_react_backend_1'];
    return { cmd: 'docker', args: [...dockerArgs, 'Rscript', ...scriptArgs] };
  }

  /**
   * 创建进程池 worker（常驻 R 进程）。
   * local 模式：spawn 本地 Rscript --interactive
   * docker 模式：返回 null（由 r-pool.js 原有逻辑处理）
   */
  buildPoolWorker() {
    const cfg = getRConfig();
    if (cfg.execMode === 'local') {
      const rBin = path.join(cfg.rHome || '', 'bin', 'R');
      return spawn(rBin, ['--no-save', '--no-restore', '--interactive'], {
        env: { ...process.env, R_HOME: cfg.rHome },
      });
    }
    return null; // docker 模式走 r-pool.js 原有逻辑
  }

  /**
   * 检查 R 包是否已安装。
   * local 模式：检查 R_HOME/library/<pkg> 目录是否存在。
   * docker 模式：用 docker exec 查询。
   */
  checkPackageInstalled(pkgName) {
    const cfg = getRConfig();
    if (cfg.execMode === 'local') {
      const libDir = path.join(cfg.rHome || '', 'library');
      return fs.existsSync(path.join(libDir, pkgName));
    }
    // docker 模式：查询容器内
    try {
      const dockerArgs =
        typeof cfg.dockerExecArgs === 'function'
          ? cfg.dockerExecArgs()
          : ['exec', cfg.rContainer || 'omichub_react_backend_1'];
      const out = execFileSync(
        'docker',
        [...dockerArgs, 'Rscript', '-e', `cat("${pkgName}" %in% rownames(installed.packages()))`],
        { timeout: 10000, encoding: 'utf8' }
      );
      return out.trim() === 'TRUE';
    } catch {
      return false;
    }
  }

  /**
   * 安装插件带来的预编译 R 包。
   * R 包是解压即用，直接复制目录到 R_HOME/library/。
   */
  installPackages(pkgDir, targetDir) {
    const cfg = getRConfig();
    const libDir = targetDir || path.join(cfg.rHome || '', 'library');
    if (!fs.existsSync(pkgDir)) {
      logger.warn(`[r-executor] 包目录不存在: ${pkgDir}`);
      return;
    }
    fs.mkdirSync(libDir, { recursive: true });
    const entries = fs.readdirSync(pkgDir);
    for (const entry of entries) {
      const src = path.join(pkgDir, entry);
      const dst = path.join(libDir, entry);
      if (fs.existsSync(dst)) {
        fs.rmSync(dst, { recursive: true, force: true });
      }
      copyDirRecursive(src, dst);
      logger.info(`[r-executor] 安装包: ${entry}`);
    }
  }

  /**
   * 校验 R 版本是否满足要求。
   * @param {string} required - 如 ">=4.4.0"
   */
  checkRuntimeVersion(required) {
    const current = this._getRVersion();
    return satisfiesVersion(current, required);
  }

  /**
   * 校验插件包的 builtAgainst 与当前 R 的 major.minor 是否兼容。
   * R 包在 X.Y 编译，加载到 X.Z（不同 minor）会报 "package built under R X.Y" 警告/错误。
   * @param {string} builtAgainst - 如 "4.5" 或 "4.5.x"
   * @returns {{ok: boolean, current: string, required: string}}
   */
  checkBuiltAgainst(builtAgainst) {
    const current = this._getRVersion();
    const curMM = current.split('.').slice(0, 2).join('.');
    const reqMM = String(builtAgainst).split('.').slice(0, 2).join('.');
    return { ok: curMM === reqMM, current, required: builtAgainst };
  }

  _getRVersion() {
    const cfg = getRConfig();
    try {
      if (cfg.execMode === 'local') {
        const rBin = path.join(cfg.rHome || '', 'bin', 'R');
        const out = execFileSync(rBin, ['--version'], { encoding: 'utf8', timeout: 5000 });
        return out.match(/R version (\d+\.\d+\.\d+)/)?.[1] || '0.0.0';
      }
      const dockerArgs =
        typeof cfg.dockerExecArgs === 'function'
          ? cfg.dockerExecArgs()
          : ['exec', cfg.rContainer || 'omichub_react_backend_1'];
      const out = execFileSync('docker', [...dockerArgs, 'R', '--version'], {
        encoding: 'utf8',
        timeout: 10000,
      });
      return out.match(/R version (\d+\.\d+\.\d+)/)?.[1] || '0.0.0';
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
  // requirement: ">=4.4.0" 或 "4.4.0"
  const match = requirement.match(/^(>=|>|<=|<|==)?\s*(\d+\.\d+\.\d+)$/);
  if (!match) return true; // 格式不对就放行
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

module.exports = { RExecutor };
