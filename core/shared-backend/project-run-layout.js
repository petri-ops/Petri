/**
 * shared-backend/project-run-layout.js
 *
 * 唯一项目运行目录解析器 — 从 projectId 解析到项目结果沙盒的物理路径。
 *
 * 职责：
 * - 从数据库读取 project.workspace_path
 * - 校验项目存在、active、有权限、目录可写
 * - 返回规范化的目录结构：workspace → results → jobs/<toolJobId>
 * - 防止路径遍历、symlink escape
 *
 * 不变量：
 * - 客户端只提交 projectId，不能提交可信的输出绝对路径
 * - 物理目录主键统一使用 tool_job.id
 * - 每个 job 只能写入自己的 jobRoot
 * - 系统任务必须显式声明 system scope，不能静默回退全局目录
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { assertProjectG0Compatible } = require('./g0-baseline');

/**
 * 解析项目运行目录布局
 *
 * @param {Object} options
 * @param {string} options.projectId - 项目 ID（必需）
 * @param {string} options.toolJobId - 工具任务 ID（必需）
 * @param {Object} options.db - 数据库实例（必需，需要 getProject 方法）
 * @param {string|null} [options.userId] - 用户 ID，用于权限检查
 * @param {boolean} [options.skipPermissionCheck] - 跳过权限检查（仅用于系统任务）
 * @param {boolean} [options.ensureDirs] - 是否自动创建目录（默认 true）
 *
 * @returns {Object} 布局对象
 * @returns {string} return.workspaceRoot - 项目工作目录根
 * @returns {string} return.resultsRoot - 结果根目录
 * @returns {string} return.jobRoot - 当前任务根目录
 * @returns {string} return.inputsDir - 输入文件目录
 * @returns {string} return.workDir - 工作目录（脚本和临时文件）
 * @returns {string} return.outputDir - 输出目录（正式 artifacts）
 * @returns {string} return.logsDir - 日志目录
 *
 * @throws {Error} 项目不存在、已归档、无权限、workspace 不可写
 */
function resolveProjectRunLayout(options) {
  const {
    projectId,
    toolJobId,
    db,
    userId = null,
    skipPermissionCheck = false,
    ensureDirs = true,
  } = options;

  // 1. 参数校验
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('[project-run-layout] projectId is required and must be a string');
  }
  if (!toolJobId || typeof toolJobId !== 'string') {
    throw new Error('[project-run-layout] toolJobId is required and must be a string');
  }
  if (!db || typeof db.getProject !== 'function') {
    throw new Error('[project-run-layout] db instance with getProject method is required');
  }

  // 2. 读取项目
  let project;
  try {
    project = db.getProject(projectId);
  } catch (error) {
    throw new Error(`[project-run-layout] Failed to read project: ${error.message}`);
  }

  if (!project) {
    throw new Error(`[project-run-layout] Project not found: ${projectId}`);
  }

  // 3. 检查项目状态
  if (project.status === 'archived') {
    throw new Error(`[project-run-layout] Project is archived: ${projectId}`);
  }

  // G0-LF0: legacy projects are explicitly adopted; future, unsupported or
  // identity-conflicting baselines remain readable but cannot create a formal
  // Job/Artifact layout until an explicit migration is available.
  try {
    assertProjectG0Compatible(project);
  } catch (error) {
    const wrapped = new Error(`[project-run-layout] ${error.message}`);
    wrapped.code = error.code || 'project_g0_baseline_incompatible';
    wrapped.compatibility = error.compatibility || null;
    throw wrapped;
  }

  // 4. 权限检查
  if (!skipPermissionCheck && userId) {
    const isOwner = project.user_id === userId;
    // 管理员放行：与 api-data.js / feedback.js 一致，从 users.role 派生（role === 'admin'）。
    // 防御性：db 未提供 getUserById（如单元测试的 mock）或用户不存在时，安全回退为非管理员。
    let isAdmin = false;
    if (!isOwner && typeof db.getUserById === 'function') {
      try {
        const user = db.getUserById(userId);
        isAdmin = !!user && user.role === 'admin';
      } catch {
        isAdmin = false;
      }
    }
    if (!isOwner && !isAdmin) {
      throw new Error(`[project-run-layout] Permission denied for project: ${projectId}`);
    }
  }

  // 5. 解析 workspace_path
  // BLOCK-67 D7/D8：SSH 远程项目 workspace_path 为 NULL（远程唯一真值）——作业用
  // 本地 staging 根（仅承载 jobDir：脚本/参数上传源 + 产物拉回落点；Artifact Truth
  // 依规留本地），不建第二套工作区真相。本地项目语义不变。
  let workspaceRoot = project.workspace_path;
  if (!workspaceRoot && project.workspace_kind === 'ssh') {
    const localDataRoot = process.env.PETRI_LOCAL_DATA_DIR
      || path.join(require('os').homedir(), 'Documents', 'Petri-Local');
    workspaceRoot = path.join(localDataRoot, 'remote-projects', String(projectId));
  }
  if (!workspaceRoot) {
    throw new Error(`[project-run-layout] Project workspace_path not set: ${projectId}`);
  }

  // 6. 规范化路径并检查安全性
  const normalizedWorkspace = path.resolve(workspaceRoot);

  // 防止路径遍历和相对路径注入
  if (normalizedWorkspace !== workspaceRoot && !path.isAbsolute(workspaceRoot)) {
    throw new Error(`[project-run-layout] workspace_path must be absolute: ${workspaceRoot}`);
  }

  // 7. 检查 workspace 是否可写
  if (ensureDirs) {
    try {
      fs.mkdirSync(normalizedWorkspace, { recursive: true });
      // 测试写入权限
      const testFile = path.join(normalizedWorkspace, '.petri-write-test');
      fs.writeFileSync(testFile, '');
      fs.unlinkSync(testFile);
    } catch (error) {
      throw new Error(
        `[project-run-layout] Workspace not writable: ${normalizedWorkspace} (${error.message})`
      );
    }
  }

  // 8. 构建目录布局
  const resultsRoot = path.join(normalizedWorkspace, 'results');
  const jobsRoot = path.join(resultsRoot, 'jobs');
  // exports 是结果根级共享目录（跨 job），存放用户主动导出的报告/汇总副本。
  const exportsDir = path.join(resultsRoot, 'exports');
  const jobRoot = path.join(jobsRoot, toolJobId);
  const inputsDir = path.join(jobRoot, 'inputs');
  const workDir = path.join(jobRoot, 'work');
  const outputDir = path.join(jobRoot, 'output');
  const logsDir = path.join(jobRoot, 'logs');

  // 9. 创建目录（如果需要）
  if (ensureDirs) {
    try {
      fs.mkdirSync(jobRoot, { recursive: true });
      fs.mkdirSync(inputsDir, { recursive: true });
      fs.mkdirSync(workDir, { recursive: true });
      fs.mkdirSync(outputDir, { recursive: true });
      fs.mkdirSync(logsDir, { recursive: true });
    } catch (error) {
      throw new Error(`[project-run-layout] Failed to create job directories: ${error.message}`);
    }
  }

  // 10. 返回布局
  return {
    workspaceRoot: normalizedWorkspace,
    resultsRoot,
    jobsRoot,
    exportsDir,
    jobRoot,
    inputsDir,
    workDir,
    outputDir,
    logsDir,
  };
}

/**
 * 解析系统任务目录布局（非项目任务）
 *
 * 用于更新、诊断、缓存清理等应用级任务。
 *
 * @param {Object} options
 * @param {string} options.toolJobId - 工具任务 ID
 * @param {string} [options.systemScope] - 系统作用域（如 'updates', 'diagnostics'）
 *
 * @returns {Object} 布局对象（同 resolveProjectRunLayout）
 */
function resolveSystemRunLayout(options) {
  const { toolJobId, systemScope = 'system' } = options;

  if (!toolJobId || typeof toolJobId !== 'string') {
    throw new Error('[project-run-layout] toolJobId is required for system tasks');
  }

  // 系统任务使用应用数据目录
  const appDataDir =
    process.env.PETRI_LOCAL_DATA_DIR || path.join(os.homedir(), 'Documents', 'Petri-Local');

  const workspaceRoot = path.join(appDataDir, 'system-tasks', systemScope);
  const resultsRoot = path.join(workspaceRoot, 'results');
  const jobsRoot = path.join(resultsRoot, 'jobs');
  const jobRoot = path.join(jobsRoot, toolJobId);
  const inputsDir = path.join(jobRoot, 'inputs');
  const workDir = path.join(jobRoot, 'work');
  const outputDir = path.join(jobRoot, 'output');
  const logsDir = path.join(jobRoot, 'logs');

  // 创建目录
  try {
    fs.mkdirSync(jobRoot, { recursive: true });
    fs.mkdirSync(inputsDir, { recursive: true });
    fs.mkdirSync(workDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
  } catch (error) {
    throw new Error(
      `[project-run-layout] Failed to create system task directories: ${error.message}`
    );
  }

  return {
    workspaceRoot,
    resultsRoot,
    jobsRoot,
    jobRoot,
    inputsDir,
    workDir,
    outputDir,
    logsDir,
  };
}

/**
 * 检查路径是否在指定根目录内（防止路径遍历）
 *
 * @param {string} root - 根目录
 * @param {string} target - 目标路径
 * @returns {boolean} 是否安全
 */
function isPathContained(root, target) {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);

  if (normalizedTarget === normalizedRoot) {
    return true;
  }

  return normalizedTarget.startsWith(normalizedRoot + path.sep);
}

/**
 * 安全地在根目录下连接路径
 *
 * @param {string} root - 根目录
 * @param {...string} segments - 路径片段
 * @returns {string|null} 解析后的路径，如果逃逸则返回 null
 */
function safeJoinUnder(root, ...segments) {
  const target = path.resolve(root, ...segments);
  return isPathContained(root, target) ? target : null;
}

/**
 * 从历史 job 的 result_json 中恢复路径
 *
 * 用于读取旧路径体系的历史结果，不自动搬迁。
 *
 * @param {Object} job - tool_job 记录
 * @param {string} fallbackJobsDir - 全局 JOBS_DIR（兜底）
 * @returns {Object|null} 历史路径布局，如果无法恢复则返回 null
 */
function restoreLegacyJobLayout(job, fallbackJobsDir) {
  if (!job || !job.result_json) {
    return null;
  }

  const result =
    typeof job.result_json === 'string' ? JSON.parse(job.result_json) : job.result_json;

  // 尝试从 result_json 读取历史路径
  const legacyOutputDir = result.outputDir || result.resultDir;
  const legacyJobDir = result.jobDir;

  if (legacyOutputDir && fs.existsSync(legacyOutputDir)) {
    return {
      jobRoot: legacyJobDir || path.dirname(legacyOutputDir),
      outputDir: legacyOutputDir,
      logsDir: result.logsDir || path.join(path.dirname(legacyOutputDir), '..', 'logs'),
      isLegacy: true,
    };
  }

  // 兜底到全局目录
  if (fallbackJobsDir) {
    const fallbackJobRoot = path.join(fallbackJobsDir, job.id);
    const fallbackOutputDir = path.join(fallbackJobRoot, 'output');

    if (fs.existsSync(fallbackOutputDir)) {
      return {
        jobRoot: fallbackJobRoot,
        outputDir: fallbackOutputDir,
        logsDir: path.join(fallbackJobRoot, 'logs'),
        isLegacy: true,
      };
    }
  }

  return null;
}

module.exports = {
  resolveProjectRunLayout,
  resolveSystemRunLayout,
  isPathContained,
  safeJoinUnder,
  restoreLegacyJobLayout,
};
