'use strict';

/**
 * routes/result-studio.js
 *
 * G0-RS3 — Artifact Interaction 与 Selection Context 的 HTTP 边界。
 *
 * 为什么交互清单必须由后端产出：
 * 浏览器侧只解析了 artifact 的前 40 行预览（project-workspace.tsx 的
 * `buildPreviewTable`），那个样本没有资格判定"哪一列是稳定实体 ID"。
 * 10 万行表格的 ID 唯一性只能在完整文件上验证，所以清单在这里构建，
 * 前端只消费，不自建第二套判定。
 *
 * 安全边界（与桌面版实际模型一致，不虚构鉴权层）：
 * - BioF3 Desktop 是 loopback-only 单本地管理员，`core/r-server/auth.js` 明确
 *   声明不存在登录边界；`localIdentityMiddleware` 在 bootstrap 里全局注入
 *   `req.user`。因此这里**没有** `requireAuth` 中间件——仓库里也不存在这个东西。
 * - 每个端点仍逐项做 `canAccessProject` 归属校验，与 routes/harness.js 同一模式；
 *   admin 与内部调用走 `isAdminOrInternal`。
 * - artifact 路径一律经 `resolveProjectRunLayout` + 包含性检查派生，
 *   不接受调用方传入的任意路径。
 * - 读取体积设上限，避免一次请求把整个大文件读进内存。
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');

// core/r-server/db.js 导出的是模块对象；真实 better-sqlite3 句柄在 `.db` 上。
// 直接对模块对象调用 prepare() 会在运行时抛错。
const sqlite = db.db;
const { resolveProjectRunLayout } = require('../../shared-backend/project-run-layout');
const {
  buildTableInteractionManifest,
  buildPlotInteractionManifest,
  buildQuerySelection,
  describeSelectionForAgent,
  resolveSelectedEntityIds,
} = require('../../shared-backend/artifact-interaction');
const {
  createResultStudioRepository,
} = require('../../shared-backend/result-studio-repository');
const { validateSelectionContext, summarizeSelection } = require('../../shared-backend/result-studio-contracts');

/** 用于 ID 推断的抽样上限。够判定唯一性，又不至于把大文件全读进内存。 */
const ID_INFERENCE_SAMPLE_ROWS = 500;

/** 单个 artifact 的读取上限（字节）。超过则只读前缀做抽样。 */
const MAX_READ_BYTES = 8 * 1024 * 1024;

const TABLE_EXTENSIONS = /\.(csv|tsv)$/i;
const PLOT_EXTENSIONS = /\.(png|jpe?g|gif|svg|webp)$/i;

function userId(req) {
  return (req.user && (req.user.id || req.user.userId)) || null;
}

function isAdminOrInternal(req) {
  return req.isInternal || (req.user && req.user.role === 'admin');
}

function canAccessProject(req, project) {
  if (!project) return false;
  if (isAdminOrInternal(req)) return true;
  const uid = userId(req);
  return !!(project.is_public || !project.user_id || project.user_id === uid);
}

function detectDelimiter(headerLine, fileName) {
  if (/\.tsv$/i.test(fileName)) return '\t';
  const tabs = (headerLine.match(/\t/g) || []).length;
  const commas = (headerLine.match(/,/g) || []).length;
  return tabs > commas ? '\t' : ',';
}

function splitCsvLine(line, delimiter) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      // 连续两个引号是转义的字面引号
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1; continue; }
      quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) { cells.push(current.trim()); current = ''; continue; }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

/**
 * 读取表格 artifact 并抽样。
 *
 * 返回真实总行数（在读全的前提下）与抽样行对象；文件被截断时明确标记，
 * 避免把"前缀里唯一"当成"整表唯一"。
 */
function readTableSample(absolutePath, fileName) {
  const stat = fs.statSync(absolutePath);
  const truncated = stat.size > MAX_READ_BYTES;
  let raw;
  if (truncated) {
    const handle = fs.openSync(absolutePath, 'r');
    try {
      const buffer = Buffer.alloc(MAX_READ_BYTES);
      const read = fs.readSync(handle, buffer, 0, MAX_READ_BYTES, 0);
      raw = buffer.slice(0, read).toString('utf8');
    } finally {
      fs.closeSync(handle);
    }
    // 丢弃末尾可能被截断的半行
    const lastBreak = raw.lastIndexOf('\n');
    if (lastBreak > 0) raw = raw.slice(0, lastBreak);
  } else {
    raw = fs.readFileSync(absolutePath, 'utf8');
  }

  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return { columns: [], rows: [], rowCount: 0, truncated };

  const delimiter = detectDelimiter(lines[0], fileName);
  const columns = splitCsvLine(lines[0], delimiter);
  const dataLines = lines.slice(1);
  const rows = dataLines.slice(0, ID_INFERENCE_SAMPLE_ROWS).map((line) => {
    const cells = splitCsvLine(line, delimiter);
    const row = {};
    columns.forEach((column, index) => { row[column] = cells[index]; });
    return row;
  });

  return {
    columns,
    rows,
    // 文件被截断时行数只是下界，不能当权威总数。
    rowCount: truncated ? null : dataLines.length,
    truncated,
  };
}

function loadJobAndProject(req, jobId) {
  const job = sqlite.prepare('SELECT * FROM tool_jobs WHERE id = ?').get(jobId);
  if (!job) return { error: { status: 404, code: 'job_not_found' } };
  const project = job.project_id
    ? sqlite.prepare('SELECT * FROM projects WHERE id = ?').get(job.project_id)
    : null;
  if (!project) return { error: { status: 404, code: 'project_not_found' } };
  if (!canAccessProject(req, project)) return { error: { status: 403, code: 'forbidden' } };
  return { job, project };
}

/**
 * 把 artifact 名解析为工作区内的真实路径。
 *
 * 只允许 output/ 下的文件名，不接受路径分隔符或 `..`，
 * 再用 layout 派生的绝对路径做包含性复核。
 */
function resolveArtifactPath({ req, job, project, artifactName }) {
  if (typeof artifactName !== 'string' || artifactName.trim() === '') {
    return { error: { status: 400, code: 'artifact_required' } };
  }
  const name = artifactName.trim();
  if (name.includes('\0') || name.includes('/') || name.includes('\\') || name.includes('..')) {
    return { error: { status: 400, code: 'artifact_name_invalid' } };
  }
  let layout;
  try {
    layout = resolveProjectRunLayout({
      projectId: project.id,
      toolJobId: job.id,
      db,
      userId: userId(req),
      skipPermissionCheck: isAdminOrInternal(req),
      ensureDirs: false,
    });
  } catch (error) {
    return { error: { status: 409, code: 'layout_unavailable', message: error && error.message } };
  }
  const outputDir = layout.outputDir || path.join(layout.jobDir, 'output');
  const absolute = path.resolve(outputDir, name);
  const resolvedOutput = path.resolve(outputDir);
  if (absolute !== resolvedOutput && !absolute.startsWith(resolvedOutput + path.sep)) {
    return { error: { status: 400, code: 'artifact_outside_output' } };
  }
  if (!fs.existsSync(absolute)) return { error: { status: 404, code: 'artifact_not_found' } };
  return { absolutePath: absolute, layout };
}

module.exports = function registerResultStudioRoutes(app) {
  // 鉴权说明：BioF3 Desktop 是 loopback-only 单本地管理员应用，
  // `bootstrap.js` 的 localIdentityMiddleware 已全局注入 req.user，
  // 仓库里**不存在** requireAuth 中间件（见 core/r-server/auth.js 注释）。
  // 因此这里沿用 harness.js 的既有模式：裸注册 + 每个端点内联 canAccessProject 校验。
  // 惰性创建：registerRoutes 对每个模块套了 try/catch，注册期抛错会让**整个**
  // result-studio 模块静默不注册（功能变死代码且没有报错）。改为首次请求时创建，
  // schema 有问题就返回 500 并带明确原因。
  let repositoryInstance = null;
  function repo() {
    if (!repositoryInstance) repositoryInstance = createResultStudioRepository(sqlite);
    return repositoryInstance;
  }

  /**
   * 交互清单：告诉前端这个 artifact 能怎么选、哪一列是稳定实体 ID。
   */
  app.get('/api/result-studio/interaction', (req, res) => {
    const jobId = String(req.query.jobId || '').trim();
    const artifactName = String(req.query.artifact || '').trim();
    if (!jobId) return res.status(400).json({ error: 'jobId_required' });

    const loaded = loadJobAndProject(req, jobId);
    if (loaded.error) return res.status(loaded.error.status).json({ error: loaded.error.code });

    const resolved = resolveArtifactPath({ req, job: loaded.job, project: loaded.project, artifactName });
    if (resolved.error) {
      return res.status(resolved.error.status).json({ error: resolved.error.code, message: resolved.error.message });
    }

    const revisionId = String(req.query.revisionId || '').trim() || null;

    try {
      if (TABLE_EXTENSIONS.test(artifactName)) {
        const sample = readTableSample(resolved.absolutePath, artifactName);
        const manifest = buildTableInteractionManifest({
          artifactId: artifactName,
          revisionId,
          columns: sample.columns,
          rows: sample.rows,
          rowCount: sample.rowCount === null ? undefined : sample.rowCount,
          declaredIdField: String(req.query.idField || '').trim() || null,
        });
        if (sample.truncated) {
          manifest.diagnostics = [
            ...manifest.diagnostics,
            {
              code: 'artifact_read_truncated',
              message: 'File exceeded the read limit; row count and uniqueness were assessed on a prefix only.',
            },
          ];
        }
        return res.json({ manifest, sampledRows: sample.rows.length, truncated: sample.truncated });
      }

      if (PLOT_EXTENSIONS.test(artifactName)) {
        const manifest = buildPlotInteractionManifest({
          artifactId: artifactName,
          revisionId,
          // 目前没有图形→实体的映射来源，诚实声明为不可持久选择。
          entityMapping: null,
        });
        return res.json({ manifest, sampledRows: 0, truncated: false });
      }

      return res.status(415).json({ error: 'artifact_kind_not_interactive' });
    } catch (error) {
      return res.status(500).json({ error: 'interaction_manifest_failed', message: error && error.message });
    }
  });

  /**
   * 持久化一个选择。大选择走 filter 权威表达，不把百万 ID 塞进库。
   */
  app.post('/api/result-studio/selection', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const projectId = String(body.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId_required' });

    const project = sqlite.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (!project) return res.status(404).json({ error: 'project_not_found' });
    if (!canAccessProject(req, project)) return res.status(403).json({ error: 'forbidden' });

    const validated = validateSelectionContext({
      selectionId: body.selectionId,
      projectId,
      conversationId: body.conversationId,
      artifactId: body.artifactId,
      revisionId: body.revisionId,
      entityType: body.entityType,
      entityIds: body.entityIds,
      filterExpression: body.filterExpression,
      sort: body.sort,
      viewport: body.viewport,
      displayState: body.displayState,
    });
    if (!validated.ok) {
      return res.status(400).json({ error: 'selection_invalid', details: validated.errors });
    }

    try {
      const saved = repo().saveSelection(validated.selection);
      return res.json({ selection: saved, summary: summarizeSelection(saved) });
    } catch (error) {
      return res.status(500).json({ error: 'selection_persist_failed', message: error && error.message });
    }
  });

  /** 按 id 恢复选择。 */
  app.get('/api/result-studio/selection/:selectionId', (req, res) => {
    const selection = repo().getSelection(String(req.params.selectionId || '').trim());
    if (!selection) return res.status(404).json({ error: 'selection_not_found' });
    const project = sqlite.prepare('SELECT * FROM projects WHERE id = ?').get(selection.projectId);
    if (!canAccessProject(req, project)) return res.status(403).json({ error: 'forbidden' });
    return res.json({
      selection,
      summary: summarizeSelection(selection),
      agentView: describeSelectionForAgent(selection),
    });
  });

  /** 删除选择（用户显式清空）。 */
  app.delete('/api/result-studio/selection/:selectionId', (req, res) => {
    const selectionId = String(req.params.selectionId || '').trim();
    const selection = repo().getSelection(selectionId);
    if (!selection) return res.status(404).json({ error: 'selection_not_found' });
    const project = sqlite.prepare('SELECT * FROM projects WHERE id = ?').get(selection.projectId);
    if (!canAccessProject(req, project)) return res.status(403).json({ error: 'forbidden' });
    repo().deleteSelection(selectionId);
    return res.json({ deleted: true, selectionId });
  });

  /**
   * 用 filter 表达一个大选择，并返回权威 hash。
   *
   * 用于 10 万行级表格：ID 列表不进上下文，filter + hash 才是选择本体。
   */
  app.post('/api/result-studio/selection/query', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const manifest = body.manifest;
    if (!manifest || typeof manifest !== 'object') {
      return res.status(400).json({ error: 'manifest_required' });
    }
    try {
      const selection = buildQuerySelection({
        manifest,
        filter: body.filter,
        matchedCount: body.matchedCount,
        sampleEntityIds: body.sampleEntityIds,
      });
      return res.json({ selection, agentView: describeSelectionForAgent(selection) });
    } catch (error) {
      return res.status(400).json({ error: error.code || 'query_selection_failed', message: error && error.message });
    }
  });

  /**
   * 把选中的行解析成稳定实体 ID。
   *
   * positional artifact 会返回 durable=false 与诊断，调用方不得把行号当身份。
   */
  app.post('/api/result-studio/selection/resolve', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (!body.manifest || typeof body.manifest !== 'object') {
      return res.status(400).json({ error: 'manifest_required' });
    }
    try {
      const resolved = resolveSelectedEntityIds({
        manifest: body.manifest,
        selectedRows: Array.isArray(body.selectedRows) ? body.selectedRows : [],
      });
      return res.json(resolved);
    } catch (error) {
      return res.status(400).json({ error: error.code || 'resolve_failed', message: error && error.message });
    }
  });
};
