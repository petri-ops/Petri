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

export type GenUiPart =
  | { kind: 'text'; text: string }
  | { kind: 'ui'; reference: GenUiReference; offset: number }
  | { kind: 'pending' | 'invalid' };

interface ReferenceCandidate {
  start: number;
  end: number;
  decode(): unknown;
}

// 完整 JSON 串之后可能停在 key、冒号、value 或逗号处；仅识别 JSON 参数前缀，
// 不能把缺失右括号后出现的普通正文一起隐藏。
const jsonString = String.raw`"(?:[^"\\\r\n]|\\.)*"`;
const jsonParameterPrefix = new RegExp(
  String.raw`^\s*(?:${jsonString}\s*:\s*${jsonString}\s*,\s*)*(?:${jsonString}(?:\s*:\s*(?:${jsonString})?)?)?\s*$`,
);

export function projectGenUiReferences(text: string, completed: boolean): GenUiPart[] {
  const ranges = findMarkdownCodeRanges(text);
  const parts: GenUiPart[] = [];
  const candidates: ReferenceCandidate[] = extractAssistantDirectives(text, 'visualize').map((directive) => ({
    start: directive.start,
    end: directive.end,
    // 通用 directive 只解析 key=value；JSON 参数形态在此解码后统一走严格 schema。
    // 坏 JSON（模型截断/嵌套超出提取器形态）→ null → invalid 占位，不炸穿消息投影。
    decode: () => {
      if (directive.parameters !== null && directive.parameters !== undefined) return directive.parameters;
      try {
        return JSON.parse(directive.raw.slice(directive.raw.indexOf('{'))) as unknown;
      } catch {
        return null;
      }
    },
  }));

  const unclosed = findUnclosedAssistantDirectiveStart(text, 'visualize', ranges, {
    isParameterPrefix: (source) => jsonParameterPrefix.test(source),
  });
  if (unclosed !== null) candidates.push({ start: unclosed, end: text.length, decode: () => null });

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
    const reference = parseGenUiReference(candidate.decode());
    if (reference) parts.push({ kind: 'ui', reference, offset: start });
    else parts.push({ kind: 'invalid' });
  }

  let tailEnd = text.length;
  if (!completed) {
    const prefix = findAssistantDirectivePrefixStart(text, ['visualize'], ranges);
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
