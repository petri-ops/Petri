/**
 * frontend/src/components/copilot/gen-ui/references.ts
 *
 * BLOCK-166 [A 层] `projectGenUiReferences`：把助手消息全文切分为有序
 * text / ui / pending / invalid 片段（ZCode references.ts 移植；PUA 旧标记
 * 形态按 plan §2 非范围剔除）。
 */

import {
  extractAssistantDirectives,
  findAssistantDirectivePrefixStart,
  findMarkdownCodeRanges,
  findUnclosedAssistantDirectiveStart,
} from './assistantDirectiveParser';
import { GenUiReference, normalizeGenUiPath, parseGenUiReference } from './schema';
import { parseComposeSpec, type ComposeSpec } from './compose/spec';

export type GenUiPart =
  | { kind: 'text'; text: string }
  | { kind: 'ui'; reference: GenUiReference; offset: number }
  | { kind: 'compose'; spec: ComposeSpec | null; offset: number }
  | { kind: 'pending' | 'invalid' };

interface ReferenceCandidate {
  start: number;
  end: number;
  /** 指令名（visualize | compose）：分派到各自严格 schema 的判别字段。 */
  name: string;
  decode(): unknown;
}

// 完整 JSON 串之后可能停在 key、冒号、value 或逗号处；仅识别 JSON 参数前缀，
// 不能把缺失右括号后出现的普通正文一起隐藏。
const jsonString = String.raw`"(?:[^"\\\r\n]|\\.)*"`;
const jsonParameterPrefix = new RegExp(
  String.raw`^\s*(?:${jsonString}\s*:\s*${jsonString}\s*,\s*)*(?:${jsonString}(?:\s*:\s*(?:${jsonString})?)?)?\s*$`,
);

/**
 * BLOCK-466（W11 P3）：compose spec 是嵌套 JSON（含 number/bool/null/对象/数组，如
 * `"version":1,"nodes":{...}`），上面的 jsonParameterPrefix 只认 string:value 前缀，
 * 会把流式半截 compose spec 误判为普通正文 → 原始 JSON 泄漏/闪烁。
 * 本判据仅用于"未闭合 compose 指令"的流式前缀识别：只要内容可被补全为合法 JSON
 * （按未闭合引号/括号补尾后尝试 JSON.parse），即视为合法前缀 → 出 pending 占位。
 * 语义保守：连补全也失败的前缀不隐藏（保留原文，沿既有"不能把普通正文一起隐藏"纪律）。
 */
function isComposeJsonPrefix(source: string): boolean {
  let quote: '"' | null = null;
  let escaped = false;
  const closers: string[] = [];
  for (const character of source) {
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quote = null;
      continue;
    }
    if (character === '"') quote = '"';
    else if (character === '{' || character === '[') closers.push(character === '{' ? '}' : ']');
    else if (character === '}' || character === ']') closers.pop();
  }
  let body = `${source}${quote !== null ? '"' : ''}`;
  // 流式可停在结构边界：冒号后（待 value）/逗号后（待下一 key）——补占位使前缀可解析。
  const trimmed = body.replace(/\s+$/, '');
  if (trimmed.endsWith(':')) body = `${trimmed}null`;
  else if (trimmed.endsWith(',')) body = trimmed.slice(0, -1);
  // source 是指令 `{` 之后的对象体（不含外层花括号），补尾后须包一层 `{}` 再解析。
  const completed = `{${body}${closers.reverse().join('')}}`;
  try {
    const parsed: unknown = JSON.parse(completed);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

export function projectGenUiReferences(text: string, completed: boolean): GenUiPart[] {
  const ranges = findMarkdownCodeRanges(text);
  const parts: GenUiPart[] = [];
  // BLOCK-461（W11 双形态并存）：::visualize（HTML 沙箱）+ ::compose（JSON spec 受控渲染）
  // 两条指令同投影管线；compose 的 spec 校验走 compose/spec.ts（fail-closed）。
  const makeDecode = (directive: { parameters: Readonly<Record<string, string>> | null; raw: string }) => () => {
    if (directive.parameters !== null && directive.parameters !== undefined) return directive.parameters;
    try {
      return JSON.parse(directive.raw.slice(directive.raw.indexOf('{'))) as unknown;
    } catch {
      return null;
    }
  };
  const candidates: ReferenceCandidate[] = [
    ...extractAssistantDirectives(text, 'visualize').map((directive) => ({
      start: directive.start,
      end: directive.end,
      name: 'visualize',
      // 通用 directive 只解析 key=value；JSON 参数形态在此解码后统一走严格 schema。
      // 坏 JSON（模型截断/嵌套超出提取器形态）→ null → invalid 占位，不炸穿消息投影。
      decode: makeDecode(directive),
    })),
    ...extractAssistantDirectives(text, 'compose').map((directive) => ({
      start: directive.start,
      end: directive.end,
      name: 'compose',
      decode: makeDecode(directive),
    })),
  ];

  const unclosedCandidates = (['visualize', 'compose'] as const)
    .map((name) => findUnclosedAssistantDirectiveStart(text, name, ranges, {
      // compose 是嵌套 JSON（number/对象值），补 json 前缀判据；visualize 仍走原 string:value 口径。
      isParameterPrefix: (source) => jsonParameterPrefix.test(source)
        || (name === 'compose' && isComposeJsonPrefix(source)),
    }))
    .filter((start): start is number => start !== null);
  const unclosed = unclosedCandidates.length > 0 ? Math.min(...unclosedCandidates) : null;
  if (unclosed !== null) candidates.push({ start: unclosed, end: text.length, name: 'unclosed', decode: () => null });

  let cursor = 0;
  for (const candidate of candidates.sort((left, right) => left.start - right.start)) {
    const { start, end } = candidate;
    if (ranges.some(([from, to]) => start >= from && start < to) || start < cursor) continue;
    if (start > cursor) parts.push({ kind: 'text', text: text.slice(cursor, start) });
    cursor = end;
    if (!completed) {
      parts.push({ kind: 'pending' });
      continue;
    }
    if (candidate.name === 'compose') {
      // compose：走 ComposeSpec 严格 schema；校验失败 → invalid 占位（与 visualize 降级语义一致）
      const composeSpec = parseComposeSpec(candidate.decode());
      if (composeSpec) parts.push({ kind: 'compose', spec: composeSpec, offset: start });
      else parts.push({ kind: 'invalid' });
      continue;
    }
    const decoded = candidate.decode();
    const reference = parseGenUiReference(decoded);
    if (reference) parts.push({ kind: 'ui', reference, offset: start });
    else parts.push({ kind: 'invalid' });
  }

  let tailEnd = text.length;
  if (!completed) {
    const prefix = findAssistantDirectivePrefixStart(text, ['visualize', 'compose'], ranges);
    if (prefix !== null && prefix >= cursor) tailEnd = prefix;
  }
  const tail = text.slice(cursor, tailEnd);
  if (tail) parts.push({ kind: 'text', text: tail });
  return parts;
}

/** 同一消息内按归一化路径去重 ui 引用（重复指令只渲染首张卡）。 */
export function dedupeGenUiParts(parts: GenUiPart[]): GenUiPart[] {
  const seen = new Set<string>();
  const result: GenUiPart[] = [];
  for (const part of parts) {
    if (part.kind !== 'ui') {
      result.push(part);
      continue;
    }
    const key = normalizeGenUiPath(part.reference.path).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(part);
  }
  return result;
}
