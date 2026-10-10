'use strict';

/**
 * routes/harness/project-storage.js — BLOCK-78 P2-③ 项目结果库占用（只读）
 *
 *   GET /api/harness/project-storage?projectId=X
 *     → { ok, projectId, workspaceKind, jobs, bytes, observedAt, stale? }
 *
 * 口径（诚实边界）：
 *   - jobs = 该项目 status='done' 的 tool_jobs 数（DB 真值）；
 *   - local：逐 job 读 result_json.outputPath 并递归求 size（限深限文件数，
 *     超限部分诚实不计入）；missing/非法路径静默跳过并计入 skipped；
 *   - ssh：服务器 `du -sb <remotePath>/results/jobs`（BLOCK-76 R1 results/jobs
 *     布局，单次 exec；目录缺失=0）；jobs 计数同 DB；
 *   - 60s TTL 合并缓存（du/遍历可能慢，多表面共用）；探测失败回 stale
 *     （stale:true）或诚实 500。
 *   - runtime 真值面（du/遍历）不实时——结果库占用非实时关键面。
 */

const fsp = require('fs/promises');
const db = require('../../db');
const workspaceGateway = require('../../helpers/workspace-gateway');
const { createStorageCache, walkSize, parseDuOutput } = require('../../helpers/project-storage');

const storageCache = createStorageCache({ ttlMs: 60000 });

module.exports = {
  register(app) {
    app.get('/api/harness/project-storage', async (req, res) => {
      try {
        const projectId = String((req.query && req.query.projectId) || '').trim();
        if (!projectId) {
          return res.status(400).json({ ok: false, error: 'projectId_required' });
        }
        const project = typeof db.getProject === 'function' ? db.getProject(projectId) : null;
        if (!project) {
          return res.status(404).json({ ok: false, error: 'project_not_found' });
        }

        const fresh = storageCache.getFresh(projectId);
        if (fresh) return res.json({ ok: true, ...fresh });

        const jobs = listDoneJobCount(projectId);
        const isSsh = project.workspace_kind === 'ssh';
        let observed;
        if (isSsh) {
          observed = await measureSsh(project);
        } else {
          observed = await measureLocal(projectId);
        }
        const payload = {
          projectId,
          workspaceKind: isSsh ? 'ssh' : 'local',
          jobs,
          bytes: observed.bytes,
          skipped: observed.skipped || 0,
          observedAt: new Date().toISOString(),
        };
        storageCache.put(projectId, payload);
        return res.json({ ok: true, ...payload });
      } catch (error) {
        const stale = storageCache.getStale(String((req.query && req.query.projectId) || ''));
        if (stale) {
          return res.json({ ok: true, ...stale, stale: true });
        }
        return res.status(500).json({ ok: false, error: 'project_storage_failed', message: error.message });
      }
    });
  },
};

function listDoneJobCount(projectId) {
  try {
    const row = db.getDatabase
      ? db.getDatabase().prepare("SELECT COUNT(*) AS n FROM tool_jobs WHERE project_id = ? AND status = 'done'").get(projectId)
      : null;
    return row ? Number(row.n) || 0 : 0;
  } catch {
    return 0;
  }
}

/** 本地：逐 done job 的 result_json.outputPath 递归求 size（限深限文件数）。 */
async function measureLocal(projectId) {
  let rows = [];
  try {
    rows = db.getDatabase().prepare("SELECT id, result_json FROM tool_jobs WHERE project_id = ? AND status = 'done'").all(projectId);
  } catch {
    return { bytes: 0, skipped: 0 };
  }
  let bytes = 0;
  let skipped = 0;
  for (const row of rows) {
    let outputPath = null;
    try {
      const parsed = row.result_json ? JSON.parse(row.result_json) : null;
      outputPath = parsed && typeof parsed.outputPath === 'string' ? parsed.outputPath : null;
    } catch {
      outputPath = null;
    }
    if (!outputPath) { skipped += 1; continue; }
    try {
      const st = await fsp.stat(outputPath);
      const total = st.isDirectory()
        ? await walkSize(outputPath, { maxDepth: 8, maxFiles: 5000 })
        : st.size;
      bytes += total.bytes;
      skipped += total.truncated ? 1 : 0;
    } catch {
      skipped += 1; // 产物缺失/不可读：诚实跳过，不计入
    }
  }
  return { bytes, skipped };
}

/** ssh：单次 `du -sb results/jobs`（目录缺失/为空 → 0，不计错）。 */
async function measureSsh(project) {
  const alias = project.ssh_host;
  if (!alias) throw new Error('ssh_project_misconfigured');
  const backend = workspaceGateway.createSshBackend({ alias });
  const root = project.remote_path || '';
  const target = workspaceGateway.safeRemoteJoin(root, 'results/jobs');
  if (!target) throw new Error('invalid_remote_path');
  const r = await backend.exec(`du -sb ${shQuote(target)} 2>/dev/null || printf '0  -\\n'`, root || target, 60);
  const bytes = parseDuOutput(r.stdout);
  return { bytes, skipped: 0 };
}

function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
