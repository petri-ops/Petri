'use strict';

/**
 * helpers/command-risk-spans.js — 命令风险片段分析（BLOCK-180 P2，纯函数）。
 *
 * 为审批请求与 deny 信封提供 span（原始命令串上的字符偏移区间），前端据此
 * 高亮「用户到底在批什么片段」。规则单源 = helpers/command-risk-rules.js
 * （与 policy 动态防护同一份判据，拦截与高亮不漂移）。
 *
 * 维度：
 * - destructive-token：命中 DANGEROUS_FIRST_TOKENS 的 token（含命令中段，
 *   display 维度；拦截判定仍只看首 token，语义零变化）；
 * - sensitive-path：敏感系统/凭证路径子串（大小写不敏感，偏移映射回原串）；
 * - pipe-exec：下载/远端内容直通解释执行（curl|sh 等，仅 display 维度——
 *   拦截判定不新增维度，控制审批面变化；当审批因其他维度发生时仍高亮示警）。
 *
 * 输出按 start 升序、区间不重叠（重叠片段合并保留首个 kind）；空命令/无命中
 * 返回 []。前端不重复实现风险规则（单一真相在服务端）。
 */

const {
  DANGEROUS_FIRST_TOKENS,
  SENSITIVE_PATH_PATTERNS,
  firstToken,
} = require('./command-risk-rules');

const PIPE_EXEC_PATTERNS = [
  /\b(?:curl|wget|fetch|iwr|invoke-webrequest|invoke-restmethod)\b[^|;&]*\|\s*(?:\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b|\s*bash\b|\s*powershell\b|\s*iex\b|invoke-expression\b)/i,
];

function findAllCaseInsensitive(haystack, needle) {
  const spans = [];
  const lower = haystack.toLowerCase();
  const target = needle.toLowerCase();
  let from = 0;
  for (;;) {
    const at = lower.indexOf(target, from);
    if (at < 0) break;
    spans.push({ start: at, end: at + needle.length });
    from = at + Math.max(1, needle.length);
  }
  return spans;
}

function findTokenSpans(command) {
  const spans = [];
  const tokenRe = /[^\s|;&<>]+/g;
  let match;
  while ((match = tokenRe.exec(command)) !== null) {
    const raw = match[0];
    const base = raw.toLowerCase().replace(/\.(exe|com|cmd|bat)$/, '');
    const name = base.includes('.') ? base.split('.')[0] : base;
    if (DANGEROUS_FIRST_TOKENS.has(name)) {
      spans.push({ start: match.index, end: match.index + raw.length, kind: 'destructive-token' });
    }
  }
  return spans;
}

function findSensitivePathSpans(command) {
  const spans = [];
  for (const pattern of SENSITIVE_PATH_PATTERNS) {
    const probe = pattern.replaceAll('\\', '/');
    for (const raw of new Set([pattern, probe])) {
      for (const { start, end } of findAllCaseInsensitive(command, raw)) {
        spans.push({ start, end, kind: 'sensitive-path' });
      }
    }
  }
  return spans;
}

function findPipeExecSpans(command) {
  const spans = [];
  for (const pattern of PIPE_EXEC_PATTERNS) {
    const re = new RegExp(pattern.source, 'gi');
    let match;
    while ((match = re.exec(command)) !== null) {
      spans.push({ start: match.index, end: match.index + match[0].length, kind: 'pipe-exec' });
      if (match[0].length === 0) re.lastIndex += 1;
    }
  }
  return spans;
}

/** 合并重叠区间（保留首个命中的 kind），按 start 升序。 */
function mergeSpans(spans) {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start < last.end) {
      last.end = Math.max(last.end, span.end);
      continue;
    }
    merged.push({ ...span });
  }
  return merged;
}

/**
 * 分析命令的风险片段。kind 取值 destructive-token | sensitive-path | pipe-exec。
 * @returns {Array<{start:number, end:number, kind:string}>}
 */
function analyzeCommandRiskSpans(command) {
  const text = String(command || '');
  if (!text.trim()) return [];
  const raw = [
    ...findTokenSpans(text),
    ...findSensitivePathSpans(text),
    ...findPipeExecSpans(text),
  ].map((span) => ({ start: span.start, end: span.end, kind: span.kind }));
  return mergeSpans(raw);
}

/** 首风险维度的展示判定（与 policy 动态防护拦截判据同源：首 token/敏感路径）。 */
function primaryRiskKind(command) {
  const token = firstToken(command);
  if (token && DANGEROUS_FIRST_TOKENS.has(token)) return 'destructive-token';
  const spans = analyzeCommandRiskSpans(command);
  if (spans.length > 0) return spans[0].kind;
  return null;
}

module.exports = {
  analyzeCommandRiskSpans,
  primaryRiskKind,
};
