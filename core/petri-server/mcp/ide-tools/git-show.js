/**
 * core/petri-server/mcp/ide-tools/git-show.js
 *
 * Phase 3: IDE Git show MCP tool — `ide_git_show`.
 * Wraps `git show --no-color --no-ext-diff` to fetch a commit's metadata
 * + unified diff. Uses `git rev-parse --verify` to validate the commit
 * reference before invoking the show (avoids shell-injection style misuse
 * and gives a clean error for unknown refs).
 *
 * 设计依据：G0-IDE-MCP-TOOLS Phase 3（docs/g0-ide-mcp-tools-plan.md §3）
 */

'use strict';

const { spawnSync } = require('node:child_process');
const { resolveAllowlisted } = require('./path-allowlist');
const { parseUnifiedHunks, summarize } = require('./diff-helpers');

const MAX_LINES_HARD_CAP = 5000;
const GIT_TIMEOUT_MS = 30_000;

// ─── 工具定义（MCP inputSchema） ───────────────────────────────

function gitShowToolDefinitions() {
  return [
    {
      name: 'ide_git_show',
      description:
        'Show a commit (metadata + unified diff). Returns { ok, commit, hunks, summary, truncated }. ' +
        'commit field = { sha, subject, author, isoDate }. Hard cap on returned lines via maxLines (default and max 5000).',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Repository root path (absolute or relative to cwd). Must be in allowlist.',
          },
          commit: {
            type: 'string',
            description: 'Commit-ish reference (SHA / short SHA / HEAD / branch / tag). Required.',
          },
          maxLines: {
            type: 'number',
            description: 'Hard cap on total returned lines (default 5000).',
          },
        },
        required: ['path', 'commit'],
      },
    },
  ];
}

// ─── 实现 ─────────────────────────────────────────────────────

function gitShow({ path: inputPath, commit, maxLines } = {}) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) {
    return { ok: false, error: 'path is required' };
  }
  if (typeof commit !== 'string' || !commit.trim()) {
    return { ok: false, error: 'commit is required' };
  }
  const resolved = resolveAllowlisted(inputPath);
  if (!resolved.ok) return { ok: false, error: resolved.reason };
  const abs = resolved.absolutePath;

  const repoCheck = validateGitRepo(abs);
  if (!repoCheck.ok) return repoCheck;

  // SHA 校验：避免上游 `:cmd` / `--upload-pack` 等 injection 形式
  const commitRef = commit.trim();
  if (commitRef.includes('\u0000')) {
    return { ok: false, error: 'commit contains null byte' };
  }
  const verifyRes = verifyCommit(abs, commitRef);
  if (!verifyRes.ok) return verifyRes;
  const fullSha = verifyRes.sha;

  // 截断上限
  const cap = clampMaxLines(maxLines);

  let proc;
  try {
    proc = spawnSync('git', ['-C', abs, 'show', '--no-color', '--no-ext-diff', fullSha], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: GIT_TIMEOUT_MS,
    });
  } catch (e) {
    return { ok: false, error: `git show spawn failed: ${e.message}` };
  }
  if (proc.error) {
    if (proc.error.code === 'ETIMEDOUT') {
      return { ok: false, error: `git show timed out after ${GIT_TIMEOUT_MS}ms` };
    }
    return { ok: false, error: `git show failed: ${proc.error.message}` };
  }
  if (typeof proc.status !== 'number' || proc.status !== 0) {
    return {
      ok: false,
      error: `git show exited ${proc.status}: ${(proc.stderr || '').trim() || 'unknown error'}`,
    };
  }

  const output = proc.stdout || '';
  const commitMeta = parseCommitHeader(output);
  const allHunks = parseUnifiedHunks(output);
  const { hunks, truncated } = truncateHunksByLines(allHunks, cap);

  return {
    ok: true,
    commit: {
      sha: commitMeta.sha || fullSha,
      shortSha: fullSha.slice(0, 7),
      author: commitMeta.author || '',
      isoDate: commitMeta.isoDate || '',
      subject: commitMeta.subject || '',
    },
    hunks,
    summary: summarize(hunks),
    truncated,
  };
}

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
  return { ok: true };
}

/**
 * 用 `git rev-parse --verify` 校验 commit 引用，并把 short SHA / 分支名解析
 * 为完整 40-byte SHA。返回的 SHA 是受信任的（已通过 git 校验）。
 */
function verifyCommit(absRepo, commitRef) {
  const proc = spawnSync('git', ['-C', absRepo, 'rev-parse', '--verify', commitRef + '^{commit}'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (proc.error) {
    if (proc.error.code === 'ETIMEDOUT') {
      return { ok: false, error: 'git rev-parse verify timed out' };
    }
    return { ok: false, error: `git rev-parse verify failed: ${proc.error.message}` };
  }
  if (proc.status !== 0) {
    return { ok: false, error: `invalid commit reference: ${commitRef}` };
  }
  const sha = (proc.stdout || '').trim();
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    return { ok: false, error: 'git rev-parse produced unexpected SHA' };
  }
  return { ok: true, sha };
}

/**
 * 解析 git show / git log 输出开头 commit header 行：
 *   commit <sha>
 *   Author: <name> [<email>]
 *   Date:   <ISO date>
 *       <subject>
 *
 * 注意：author 全量形如 "Name <email>" — 我们只保留 Name 部分以避免
 * 在 agent 上下文里放大字符串体积（与 ide_git_log 的 %an 行为一致）。
 */
function parseCommitHeader(output) {
  const meta = { sha: '', author: '', isoDate: '', subject: '' };
  if (!output) return meta;
  const lines = output.split('\n');
  let i = 0;
  // 行 0：commit <sha>
  if (i < lines.length && lines[i].startsWith('commit ')) {
    meta.sha = lines[i].slice('commit '.length).trim();
    i++;
  }
  // Author: <name> [<email>]
  if (i < lines.length && lines[i].startsWith('Author:')) {
    meta.author = extractAuthorName(lines[i].slice('Author:'.length).trim());
    i++;
  }
  // Date:   <ISO date>
  if (i < lines.length && lines[i].startsWith('Date:')) {
    const raw = lines[i].slice('Date:'.length).trim();
    meta.isoDate = tryToIso(raw);
    i++;
  }
  // 空行
  while (i < lines.length && lines[i] === '') i++;
  // subject：到下一个空行 / diff 起始
  if (i < lines.length && !lines[i].startsWith('diff ')) {
    meta.subject = lines[i].trim();
  }
  return meta;
}

/**
 * 从 "Name <email>" 提取 Name。
 * 兼容裸 "Name" / "Name <email>" / "Name (extra) <email>"。
 */
function extractAuthorName(raw) {
  if (!raw) return '';
  // 优先：第一个 < 之前的部分
  const lt = raw.indexOf('<');
  if (lt > 0) return raw.slice(0, lt).trim();
  return raw.trim();
}

function tryToIso(raw) {
  if (!raw) return '';
  // 已经是 ISO 形式
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(raw)) return raw;
  // git 默认格式：Fri Aug 14 10:00:00 2026 +0800
  const m = /^([A-Za-z]+)\s+([A-Za-z]+)\s+(\d+)\s+(\d{2}:\d{2}:\d{2})\s+(\d{4})([+-]\d{4})?/.exec(raw);
  if (!m) return raw;
  const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const monthIdx = months[m[2]];
  if (monthIdx === undefined) return raw;
  const day = String(m[3]).padStart(2, '0');
  const month = String(monthIdx + 1).padStart(2, '0');
  const tz = m[6] ? m[6] : 'Z';
  const tzColon = tz.replace(/^([+-])(\d{2})(\d{2})$/, '$1$2:$3');
  return `${m[5]}-${month}-${day}T${m[4]}${tzColon}`;
}

function clampMaxLines(maxLines) {
  const userCap =
    typeof maxLines === 'number' && maxLines > 0 ? Math.floor(maxLines) : MAX_LINES_HARD_CAP;
  return Math.min(userCap, MAX_LINES_HARD_CAP);
}

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
  ide_git_show: gitShow,
};

module.exports = {
  gitShowToolDefinitions,
  HANDLERS,
};
