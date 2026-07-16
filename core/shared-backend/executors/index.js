/**
 * Language Executor Registry — 执行器注册表
 *
 * 所有语言（R / Python / 未来 Java/Julia）遵守同一接口。
 * 加新语言 = 新建一个实现 + registerExecutor()，不改核心逻辑。
 *
 * 接口规范（LanguageExecutor）：
 *   name           — 语言标识 'r' | 'python' | 'java' | ...
 *   binPath        — 可执行文件绝对路径（getter）
 *   buildRunArgs(scriptPath, workDir, params) → string[]
 *   buildPoolWorker() → ChildProcess | null   （可选，进程池）
 *   checkPackageInstalled(pkgName) → boolean
 *   installPackages(pkgDir, targetDir) → void
 *   checkRuntimeVersion(requiredVersion) → boolean
 *   checkBuiltAgainst(builtAgainst) → {ok, current, required}  // major.minor ABI 兼容校验
 */

const logger = require('../logger');

const _executors = new Map();

function registerExecutor(executor) {
  if (!executor || !executor.name) {
    throw new Error('registerExecutor: executor.name is required');
  }
  _executors.set(executor.name, executor);
  logger.info(`[executors] registered: ${executor.name}`);
}

function getExecutor(language) {
  const exec = _executors.get(language);
  if (!exec) {
    throw new Error(`不支持的语言: ${language}（未注册执行器）`);
  }
  return exec;
}

function hasExecutor(language) {
  return _executors.has(language);
}

function listExecutors() {
  return Array.from(_executors.keys());
}

module.exports = {
  registerExecutor,
  getExecutor,
  hasExecutor,
  listExecutors,
};
