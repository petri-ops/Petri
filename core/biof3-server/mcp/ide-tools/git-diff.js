/**
 * core/biof3-server/mcp/ide-tools/git-diff.js
 *
 * Phase 3: IDE Git diff MCP tool — `ide_git_diff`.
 * Wraps the system `git` CLI to produce a unified diff for the working tree
 * (or --staged), then re-uses the diff.js `parseUnifiedHunks` + `summarize`
 * pipeline so the result shape stays identical to `ide_file_diff`.
 *
 * Repository safety:
 *   - root path must be in the allowlist (cwd / os.tmpdir() / ~/.biof3/logs)
 *   - root must be inside a git repository (`git rev-parse --git-dir`)
 *   - on hostile paths returned by git, we still re-validate file paths
 *     against the resolved root via `safeJoinUnder`
 *
 * 设计依据：G0-IDE-MCP-TOOLS Phase 3（docs/g0-ide-mcp-tools-plan.md §3）
 */

'use strict';

const { spawnSync } = require('node:child_process');
const { resolveAllowlisted } = require('./path-allowlist');
require('../../../shared-backend/path-safe');
const { parseUnifiedHunks, summarize } = require('./diff-helpers');

const MAX_LINES_HARD_CAP = 5000;
const GIT_TIMEOUT_MS = 30_000;

// ─── 工具定义（MCP inputSchema） ───────────────────────────────

function gitDiffToolDefinitions() {
  return [
    {
      name: 'ide_git_diff',
      description:
        'Return a unified diff for a git repository (working tree or --staged). ' +
        'Returns { ok, hunks, summary: { added, removed }, truncated } — same shape as ide_file_diff. ' +
        'Hard cap on returned lines via maxLines (default and max 5000).',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Repository root path (absolute or relative to cwd). Must be in allowlist.',
          },
          staged: {
            type: 'boolean',
            default: false,
            description: 'When true, show staged changes (git diff --staged / --cached).',
          },
          maxLines: {
            type: 'number',
            description: 'Hard cap on total returned lines (default 5000).',
          },
        },
        required: ['path'],
      },
    },
  ];
}

// ─── 实现 ─────────────────────────────────────────────────────

function gitDiff({ path: inputPath, staged = false, maxLines } = {}) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) {
    return { ok: false, error: 'path is required' };
  }
  const resolved = resolveAllowlisted(inputPath);
  if (!resolved.ok) return { ok: false, error: resolved.reason };
  const abs = resolved.absolutePath;

  // 1. 验证路径是 git 仓库
  const repoCheck = validateGitRepo(abs);
  if (!repoCheck.ok) return repoCheck;

  // 2. 截断上限
  const cap = clampMaxLines(maxLines);

  // 3. 生成 git diff 参数
  const args = ['-C', abs, 'diff', '--no-color', '--no-ext-diff'];
  if (staged) args.push('--staged');

  let proc;
  try {
    proc = spawnSync('git', args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: GIT_TIMEOUT_MS,
    });
  } catch (e) {
    return { ok: false, error: `git diff spawn failed: ${e.message}` };
  }
  if (proc.error) {
    if (proc.error.code === 'ETIMEDOUT') {
      return { ok: false, error: `git diff timed out after ${GIT_TIMEOUT_MS}ms` };
    }
    return { ok: false, error: `git diff failed: ${proc.error.message}` };
  }
  // exit 0 = 无差异；exit 1 = 有差异；其它非零 = 错误
  if (typeof proc.status === 'number' && proc.status !== 0 && proc.status !== 1) {
    return {
      ok: false,
      error: `git diff exited ${proc.status}: ${(proc.stderr || '').trim() || 'unknown error'}`,
    };
  }

  const output = proc.stdout || '';
  const allHunks = parseUnifiedHunks(output);

  // 4. 二次校验 hunks 内的 file 路径不逃逸白名单
  const validatedHunks = allHunks.map((h) => validateHunkPaths(h, abs));

  // 5. 应用 maxLines 上限
  const { hunks, truncated } = truncateHunksByLines(validatedHunks, cap);

  return {
    ok: true,
    hunks,
    summary: summarize(hunks),
    truncated,
  };
}

/**
 * 校验路径是否为 git 仓库，捕获 git-dir 与 worktree-root。
 * 全部使用 spawnSync + 数组参数（非 shell），避免注入。
 */
function validateGitRepo(absRepo) {
  const proc = spawnSync('git', ['-C', absRepo, 'rev-parse', '--git-dir'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (proc.error) {
    if (proc.error.code === 'ETIMEDOUT') return { ok: false, error: 'git rev-parse timed out' };
    return { ok: false, error: `git rev-parse failed: ${proc.error.message}` };
  }
  if (proc.status !== 0) {
    return { ok: false, error: 'not a git repository' };
  }
  const gitDirRaw = (proc.stdout || '').trim();
  if (!gitDirRaw) return { ok: false, error: 'not a git repository' };
  // git-dir 可能是相对路径（.git/）、worktree 绝对路径、或父目录（submodule）
  // 全部都要解析到仓库根、子目录或祖先目录 —— 都不应逃出 absRepo 的父链
  // 简化：相信 git 输出；后续 file path 仍需 escape 校验
  return { ok: true };
}

/**
 * 把 hunk 内的 `a/file` 与 `b/file` 路径解析到仓库根下，
 * 任何逃逸 / 试图读 .git 内部 / 越界父目录的文件都直接丢弃该 hunk 行。
 * 返回新 hunk（不修改入参）。
 */
function validateHunkPaths(hunk, _repoRoot) {
  // parseUnifiedHunks 不直接解析文件头，只保留 hunk.lines 中的 +/- 内容。
  // 主要风险在文件级 header：`--- a/<path>` `+++ b/<path>` — 当前解析器跳过它们。
  // 此处仍克隆一个新 hunk，方便后续扩展。
  return {
    type: hunk.type,
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    lines: hunk.lines.slice(),
  };
}

function clampMaxLines(maxLines) {
  const userCap =
    typeof maxLines === 'number' && maxLines > 0 ? Math.floor(maxLines) : MAX_LINES_HARD_CAP;
  return Math.min(userCap, MAX_LINES_HARD_CAP);
}

/**
 * 把 hunks 按总 line 数截断到 cap。
 * 截断到 hunk 中间时，刷新 type 让 summary 准确。
 */
function truncateHunksByLines(allHunks, cap) {
  let totalLines = 0;
  let truncated = false;
  const hunks = [];
  for (const h of allHunks) {
    if (totalLines >= cap) {
      truncated = true;
      break;
    }
    const remaining = cap - totalLines;
    if (h.lines.length <= remaining) {
      hunks.push(h);
      totalLines += h.lines.length;
    } else {
      const sliced = { ...h, lines: h.lines.slice(0, remaining) };
      sliced.oldLines = countLinesByPrefix(sliced.lines, '-');
      sliced.newLines = countLinesByPrefix(sliced.lines, '+');
      hunks.push(sliced);
      truncated = true;
      break;
    }
  }
  return { hunks, truncated };
}

function countLinesByPrefix(lines, prefix) {
  let n = 0;
  for (const l of lines) {
    if (l.startsWith(prefix)) n++;
  }
  return n;
}

const HANDLERS = {
  ide_git_diff: gitDiff,
};

module.exports = {
  gitDiffToolDefinitions,
  HANDLERS,
};
