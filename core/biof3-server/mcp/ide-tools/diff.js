/**
 * core/biof3-server/mcp/ide-tools/diff.js
 *
 * IDE 差异比对 MCP 工具实现：ide_file_diff。
 * 封装系统 `diff`（POSIX /usr/bin/diff；Windows 解析 Git for Windows 自带 usr/bin/diff.exe）。
 *
 * 设计依据：G0-IDE-MCP-TOOLS 工作包（docs/g0-ide-mcp-tools-plan.md）。
 * 安全约束：pathA / pathB 必须均在路径白名单内，复用 resolveAllowlistedPair。
 */

'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// BLOCK-104 增量 — diff 二进制解析：原硬编码 /usr/bin/diff 在 Windows 上
// ENOENT（Git for Windows 自带 usr/bin/diff.exe）。解析顺序：环境变量显式指定
// > win32 探测 Git 安装目录（git -C 推导 + 常见路径）> POSIX 固定路径。
function resolveDiffBinary() {
  if (process.env.GEWU_DIFF_BIN && fs.existsSync(process.env.GEWU_DIFF_BIN)) {
    return process.env.GEWU_DIFF_BIN;
  }
  if (process.platform === 'win32') {
    const candidates = [];
    try {
      const gitRoot = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
      if (gitRoot.status === 0 && gitRoot.stdout) {
        // <git>/libexec/git-core → <git>/../usr/bin/diff.exe
        candidates.push(path.resolve(gitRoot.stdout.trim(), '..', '..', 'usr', 'bin', 'diff.exe'));
      }
    } catch {}
    for (const base of ['C:\Program Files\Git', 'C:\Program Files (x86)\Git']) {
      candidates.push(path.join(base, 'usr', 'bin', 'diff.exe'));
    }
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return 'diff.exe';
  }
  return '/usr/bin/diff';
}
const { resolveAllowlistedPair } = require('./path-allowlist');

const MAX_LINES_HARD_CAP = 5000;

// ─── 工具定义（MCP inputSchema） ───────────────────────────────

function diffToolDefinitions() {
  return [
    {
      name: 'ide_file_diff',
      description:
        'Compute a diff between two files (Apple/FreeBSD diff). Returns structured hunks with type=add|remove|change, line ranges and the original lines. Hard cap on returned lines via maxLines (default and max 5000).',
      inputSchema: {
        type: 'object',
        properties: {
          pathA: { type: 'string', description: 'First file path (absolute or relative to cwd).' },
          pathB: { type: 'string', description: 'Second file path (absolute or relative to cwd).' },
          unified: {
            type: 'boolean',
            default: false,
            description: 'Use unified diff format (-u). Default false uses normal diff.',
          },
          maxLines: {
            type: 'number',
            description: 'Hard cap on total returned lines (default 5000).',
          },
        },
        required: ['pathA', 'pathB'],
      },
    },
  ];
}

// ─── Diff 输出解析 ────────────────────────────────────────────

/**
 * 解析 unified diff 输出（`diff -u` 格式）。
 * 顶层结构：
 *   --- <path1> <ts>
 *   +++ <path2> <ts>
 *   @@ -oldStart,oldLines +newStart,newLines @@
 *     context
 *   -removed
 *   +added
 */
function parseUnifiedHunks(output) {
  const lines = output.split('\n');
  const hunks = [];
  let i = 0;
  // 跳过文件头（--- / +++）
  while (i < lines.length && !lines[i].startsWith('@@')) i++;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.startsWith('@@')) {
      i++;
      continue;
    }
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const hunk = {
      type: 'change',
      oldStart: Number(m[1]),
      oldLines: m[2] ? Number(m[2]) : 1,
      newStart: Number(m[3]),
      newLines: m[4] ? Number(m[4]) : 1,
      lines: [],
    };
    i++;
    while (i < lines.length) {
      const h = lines[i];
      // hunk 内容以 ' '、'-' 或 '+' 开头；空行表示上下文行
      if (h.startsWith(' ') || h.startsWith('-') || h.startsWith('+') || h === '') {
        hunk.lines.push(h);
        i++;
      } else {
        break;
      }
    }
    classifyHunk(hunk);
    hunks.push(hunk);
  }
  return hunks;
}

/**
 * 解析 normal diff 输出（`diff` 默认格式）。
 * 行首可能形式：
 *   NcM     — change: N 替换为 M（旧 N 行 → 新 M 行）
 *   N,MdK   — delete: N..M 删除，新 K 行开始
 *   NaK     — add: 在 N 行后新增 K
 *   N,M a K,L — add: 在 N..M 行后新增 K..L
 * 接下来是
 *   < old
 *   ---
 *   > new
 */
function parseNormalHunks(output) {
  const hunks = [];
  const trimmed = output.replace(/\n$/, '');
  if (!trimmed) return hunks;
  const lines = trimmed.split('\n');
  let i = 0;
  while (i < lines.length) {
    const header = lines[i];
    i++;
    let type, oldStart, oldLines, newStart, newLines;
    let m;
    if ((m = /^(\d+)(?:,(\d+))?c(\d+)(?:,(\d+))?$/.exec(header))) {
      type = 'change';
      oldStart = Number(m[1]);
      oldLines = m[2] ? Number(m[2]) : 1;
      newStart = Number(m[3]);
      newLines = m[4] ? Number(m[4]) : 1;
    } else if ((m = /^(\d+)(?:,(\d+))?d(\d+)(?:,(\d+))?$/.exec(header))) {
      type = 'remove';
      oldStart = Number(m[1]);
      oldLines = m[2] ? Number(m[2]) : 1;
      newStart = Number(m[3]);
      newLines = 0;
    } else if ((m = /^(\d+)(?:,(\d+))?a(\d+)(?:,(\d+))?$/.exec(header))) {
      type = 'add';
      oldStart = Number(m[1]);
      oldLines = 0;
      newStart = Number(m[3]);
      newLines = m[4] ? Number(m[4]) : 1;
    } else {
      // 未知行首，跳过
      continue;
    }
    const hunk = { type, oldStart, oldLines, newStart, newLines, lines: [] };
    // 解析内容行。diff normal 格式下，`<` 行直接以 `< ` 开头（同一行）。
    while (i < lines.length) {
      const h = lines[i];
      if (h.startsWith('<')) {
        hunk.lines.push('-' + h.slice(1));
        i++;
      } else if (h === '---') {
        // 分隔旧段/新段
        i++;
      } else if (h.startsWith('>')) {
        hunk.lines.push('+' + h.slice(1));
        i++;
      } else if (/^(\d+(?:,\d+)?[adc]\d+(?:,\d+)?)$/.test(h)) {
        // 下一个 hunk header
        break;
      } else {
        // 不可识别，跳过
        i++;
      }
    }
    hunks.push(hunk);
  }
  return hunks;
}

function classifyHunk(hunk) {
  let adds = 0;
  let dels = 0;
  for (const l of hunk.lines) {
    if (l.startsWith('+') && !l.startsWith('+++')) adds++;
    else if (l.startsWith('-') && !l.startsWith('---')) dels++;
  }
  if (adds > 0 && dels === 0) hunk.type = 'add';
  else if (dels > 0 && adds === 0) hunk.type = 'remove';
  else hunk.type = 'change';
}

function summarize(hunks) {
  let added = 0;
  let removed = 0;
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.startsWith('+') && !l.startsWith('+++')) added++;
      else if (l.startsWith('-') && !l.startsWith('---')) removed++;
    }
  }
  return { added, removed };
}

// ─── 实现 ─────────────────────────────────────────────────────

function fileDiff({ pathA, pathB, unified = false, maxLines } = {}) {
  if (typeof pathA !== 'string' || !pathA.trim()) {
    return { ok: false, error: 'pathA is required' };
  }
  if (typeof pathB !== 'string' || !pathB.trim()) {
    return { ok: false, error: 'pathB is required' };
  }
  const resolved = resolveAllowlistedPair(pathA, pathB);
  if (!resolved.ok) return { ok: false, error: resolved.reason };

  const cap = Math.min(
    typeof maxLines === 'number' && maxLines > 0 ? Math.floor(maxLines) : MAX_LINES_HARD_CAP,
    MAX_LINES_HARD_CAP
  );

  const args = unified
    ? ['-u', resolved.oldPath, resolved.newPath]
    : [resolved.oldPath, resolved.newPath];

  let result;
  try {
    result = spawnSync(resolveDiffBinary(), args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    return { ok: false, isError: true, error: `diff spawn failed: ${e.message}` };
  }
  if (result.error) {
    return { ok: false, isError: true, error: `diff spawn failed: ${result.error.message}` };
  }
  // exit code 2 = diff 进程级错误（ENOENT 等）
  if (result.status === 2) {
    return {
      ok: false,
      isError: true,
      error: `diff exited 2: ${(result.stderr || '').trim() || 'unknown error'}`,
    };
  }
  // exit code 1 = 有差异；exit code 0 = 完全相同；其他非 0 = 异常
  if (typeof result.status === 'number' && result.status !== 0 && result.status !== 1) {
    return {
      ok: false,
      isError: true,
      error: `diff exited ${result.status}: ${(result.stderr || '').trim() || 'unknown'}`,
    };
  }

  const output = result.stdout || '';
  const allHunks = unified ? parseUnifiedHunks(output) : parseNormalHunks(output);

  // 应用 maxLines 上限（按总输出行数截断）
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
      // 调整 oldLines / newLines 以匹配实际返回的 lines
      sliced.oldLines = countLinesInSlice(sliced.lines, '-');
      sliced.newLines = countLinesInSlice(sliced.lines, '+');
      hunks.push(sliced);
      truncated = true;
      break;
    }
  }

  return {
    ok: true,
    hunks,
    summary: summarize(hunks),
    truncated,
  };
}

function countLinesInSlice(lines, prefix) {
  let n = 0;
  for (const l of lines) {
    if (l.startsWith(prefix)) n++;
  }
  return n;
}

const HANDLERS = {
  ide_file_diff: fileDiff,
};

module.exports = {
  diffToolDefinitions,
  HANDLERS,
  // 暴露给测试
  _parseUnifiedHunks: parseUnifiedHunks,
  _parseNormalHunks: parseNormalHunks,
};
