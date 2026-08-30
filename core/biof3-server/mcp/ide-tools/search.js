/**
 * core/biof3-server/mcp/ide-tools/search.js
 *
 * Phase 2：IDE 文本搜索 MCP 工具实现（1 个工具）。
 * 暴露工具：ide_file_search_text
 *
 * 设计依据：G0-IDE-MCP-TOOLS Phase 2（docs/g0-ide-mcp-tools-plan.md §3 搜索工具）
 * 实现：基于系统 rg（ripgrep 15.x）`--json` 子命令做正则 / 文本搜索。
 *
 * 安全约束：
 * - 搜索根路径必须 resolveAllowlisted 通过（cwd / tmpdir / ~/.biof3/logs）
 * - 拒绝空 pattern（避免扫描全部行造成上下文爆炸）
 * - maxResults 硬上限 1000（即便用户传更大，也截断并标 truncated）
 * - 30 秒超时；超时或非零退出码返回 isError=true + 错误描述
 */

'use strict';

const { spawnSync } = require('node:child_process');
const { resolveAllowlisted } = require('./path-allowlist');

const HARD_MAX_RESULTS = 1000;
const DEFAULT_MAX_RESULTS = 100;
const RG_TIMEOUT_MS = 30_000;

/**
 * 寻找 rg 可执行文件路径。
 * 顺序：RIPGREP_BIN 环境变量 → /opt/homebrew/bin/rg → /usr/local/bin/rg → PATH 中的 rg
 */
function resolveRgBinary() {
  if (process.env.RIPGREP_BIN && process.env.RIPGREP_BIN.trim()) {
    return process.env.RIPGREP_BIN.trim();
  }
  const candidates = ['/opt/homebrew/bin/rg', '/usr/local/bin/rg', '/usr/bin/rg'];
  const fs = require('node:fs');
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch (_e) { /* missing */ }
  }
  return 'rg';
}

// ─── 工具定义（MCP inputSchema） ───────────────────────────────

function searchToolDefinitions() {
  return [
    {
      name: 'ide_file_search_text',
      description:
        'Search text patterns in files using ripgrep (rg --json). ' +
        'Returns { ok, matches: [{file,line,column,text,context}], count, truncated }. ' +
        'Hard cap: maxResults ≤ 1000. Timeout: 30s.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Search root directory (absolute or relative to cwd). Must be in allowlist.',
          },
          pattern: {
            type: 'string',
            description: 'Pattern to search. Treated as regex by default.',
          },
          regex: {
            type: 'boolean',
            default: true,
            description: 'When true (default) pattern is a regex; when false use --fixed-strings.',
          },
          filePattern: {
            type: 'string',
            description: 'Optional rg --glob pattern to restrict file names (e.g. "*.ts").',
          },
          maxResults: {
            type: 'number',
            default: DEFAULT_MAX_RESULTS,
            description: 'Maximum matches to return (hard cap = 1000).',
          },
          context: {
            type: 'number',
            default: 0,
            description: 'Number of context lines around each match (rg -C).',
          },
        },
        required: ['path', 'pattern'],
      },
    },
  ];
}

// ─── 实现 ─────────────────────────────────────────────────────

/**
 * 解析单条 rg JSON 事件为 matches 项。
 *
 * rg 在 -C N 时的输出顺序（每个文件）：
 *   begin
 *     context   (N 行 before)
 *     match
 *     context   (N 行 after)
 *     match
 *     context   (N 行 after)
 *     ...
 *   end
 *
 * 语义：每条 context 行都属于该文件内"相邻的"match。
 * - match 之前未消费的 context → 该 match 的 before-context
 * - match 之后未消费的 context → 该 match 的 after-context
 *
 * @param {Array<object>} events - 已按行解析的 JSON 事件
 * @param {number} effectiveMax - 有效上限
 * @returns {{matches: Array<object>, truncated: boolean}}
 */
function buildMatchesFromEvents(events, effectiveMax) {
  const matches = [];
  let truncated = false;
  let lastMatchIndex = -1;
  let pendingContext = [];

  function attachBeforeAndClear(idx) {
    if (idx < 0 || !matches[idx]) return;
    if (pendingContext.length) {
      matches[idx].context.push(...pendingContext);
      pendingContext = [];
    }
  }

  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    const t = ev.type;
    const d = ev.data || {};
    const filePath = d.path?.text || d.path?.file_name || null;

    if (t === 'begin') {
      pendingContext = [];
      lastMatchIndex = -1;
      continue;
    }
    if (t === 'end') {
      // 文件末尾：把尾巴上未消费的 context 挂到最后一个 match 上
      if (lastMatchIndex >= 0 && matches[lastMatchIndex] && pendingContext.length) {
        matches[lastMatchIndex].context.push(...pendingContext);
      }
      pendingContext = [];
      lastMatchIndex = -1;
      continue;
    }
    if (t === 'context') {
      const line = d.line_number;
      const text = d.lines?.text ?? '';
      pendingContext.push({ line, text });
      continue;
    }
    if (t === 'match') {
      if (matches.length >= effectiveMax) {
        truncated = true;
        // 超过上限的 match 不入栈，但仍要清掉它的 before-context
        // （保留尾巴 context 给后续 match 太复杂；这里直接清空）
        pendingContext = [];
        continue;
      }
      const submatches = Array.isArray(d.submatches) ? d.submatches : [];
      const primary = submatches[0] || {};
      const text = (d.lines?.text ?? '').replace(/\r?\n$/, '');
      const startOffset =
        typeof primary.start === 'number'
          ? primary.start
          : primary.match?.start;
      // 先把上一个 match 的 trailing-after 上下文清掉（已无新 match 来消费）
      // 它在 "previous match → context(s) → this match" 这段序列中已被
      // 上一个 match 创建时挂上了；这里无需动作。
      // 现在把当前悬挂的 context 作为"本 match 的 before-context"
      matches.push({
        file: filePath,
        line: d.line_number ?? null,
        column: typeof startOffset === 'number' ? startOffset + 1 : null,
        text,
        context: [],
      });
      const idx = matches.length - 1;
      attachBeforeAndClear(idx);
      lastMatchIndex = idx;
      continue;
    }
    // summary / 其他事件忽略
  }

  return { matches, truncated };
}

function fileSearchText({
  path: inputPath,
  pattern,
  regex = true,
  filePattern,
  maxResults = DEFAULT_MAX_RESULTS,
  context = 0,
} = {}) {
  if (typeof pattern !== 'string' || !pattern.trim()) {
    return { ok: false, error: 'pattern must be a non-empty string' };
  }
  const resolved = resolveAllowlisted(inputPath);
  if (!resolved.ok) return { ok: false, error: resolved.reason };

  // 计算有效上限：超过 HARD_MAX_RESULTS 则截断到硬上限（并标 truncated）
  const userMax = typeof maxResults === 'number' && maxResults > 0 ? maxResults : DEFAULT_MAX_RESULTS;
  const effectiveMax = Math.min(userMax, HARD_MAX_RESULTS);
  const wasCapped = userMax > HARD_MAX_RESULTS;

  // 组装 rg 参数
  const args = ['--json', '--no-heading', '--no-messages'];
  if (regex === false) {
    args.push('--fixed-strings');
  }
  if (typeof context === 'number' && context > 0) {
    args.push('-C', String(Math.min(Math.floor(context), 50)));
  }
  if (typeof filePattern === 'string' && filePattern.trim()) {
    args.push('--glob', filePattern.trim());
  }
  args.push('--', pattern, resolved.absolutePath);

  const rgBin = resolveRgBinary();
  let proc;
  try {
    proc = spawnSync(rgBin, args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024, // 64MB 上限，避免 json 输出爆内存
      timeout: RG_TIMEOUT_MS,
    });
  } catch (e) {
    return { ok: false, error: `rg spawn failed: ${e.message}` };
  }

  // 超时
  if (proc.error && proc.error.code === 'ETIMEDOUT') {
    return { ok: false, error: `rg timed out after ${RG_TIMEOUT_MS}ms` };
  }
  // ENOENT：rg 不在系统
  if (proc.error && proc.error.code === 'ENOENT') {
    return { ok: false, error: `rg binary not found at ${rgBin}` };
  }

  const stdout = proc.stdout || '';
  const stderr = proc.stderr || '';

  // rg 退出码约定：
  // 0 = 命中；1 = 无命中；2 = 错误
  // 我们在 pattern 非空情况下，0/1 都视作 ok；2 视作错误。
  if (proc.status === 2) {
    return {
      ok: false,
      error: `rg failed (exit 2): ${stderr.trim() || 'unknown error'}`,
    };
  }
  if (proc.status !== 0 && proc.status !== 1) {
    return {
      ok: false,
      error: `rg exited with status ${proc.status}: ${stderr.trim() || 'unknown error'}`,
    };
  }

  // 解析 JSON Lines
  const events = [];
  if (stdout.trim()) {
    for (const line of stdout.split('\n')) {
      if (!line) continue;
      try {
        events.push(JSON.parse(line));
      } catch (_e) {
        // 跳过无法解析的损坏行
      }
    }
  }

  const { matches, truncated } = buildMatchesFromEvents(events, effectiveMax);
  const finalTruncated = truncated || wasCapped;

  return {
    ok: true,
    matches,
    count: matches.length,
    truncated: finalTruncated,
  };
}

const HANDLERS = {
  ide_file_search_text: fileSearchText,
};

module.exports = {
  searchToolDefinitions,
  HANDLERS,
};
