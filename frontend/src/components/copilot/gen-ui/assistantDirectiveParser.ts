/**
 * frontend/src/components/copilot/gen-ui/assistantDirectiveParser.ts
 *
 * BLOCK-166 [A 层] 通用 `::指令{...}` 解析器（自 ZCode 参考实现移植，BLOCK-166 D3 petri 化）：
 * 仅支持严格 `::name{...}` 形态（不做单/三冒号与智能引号兼容——plan §2 非范围），
 * key=value 参数解析 + Markdown 代码区间计算 + 未闭合前缀检测（流式防闪烁）。
 * 零依赖、纯函数，供 references.ts 消费。
 */

export interface ParsedAssistantDirective {
  start: number;
  end: number;
  name: string;
  /** key=value 形态解析出的参数；JSON 形态为 null（由上层 JSON.parse raw）。 */
  parameters: Readonly<Record<string, string>> | null;
  raw: string;
}

export type AssistantTextRange = readonly [start: number, end: number];

interface QuoteState {
  open: string;
  close: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function directiveStartPattern(directiveName: string): RegExp {
  // 严格双冒号；负向后顾防从连续冒号中段起匹配（:::x 不命中 ::x）。
  return new RegExp(`(?<!:)::${escapeRegExp(directiveName)}\\s*\\{`, 'g');
}

function findClosingBrace(content: string, openBraceIndex: number): number {
  let quote: QuoteState | null = null;
  let escaped = false;
  for (let index = openBraceIndex + 1; index < content.length; index += 1) {
    const character = content[index];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote.close) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = { open: character, close: character };
    else if (character === '}') return index;
  }
  return -1;
}

function parseQuotedValue(source: string, start: number, quote: QuoteState): { nextIndex: number; value: string } | null {
  let value = '';
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === quote.close) return { nextIndex: index + 1, value };
    if (character !== '\\' || index + 1 >= source.length) {
      value += character;
      continue;
    }
    const escapedCharacter = source[index + 1];
    if (escapedCharacter === quote.open || escapedCharacter === quote.close || escapedCharacter === '\\') {
      value += escapedCharacter;
    } else {
      // 指令参数不是 JSON：未知转义保留反斜杠，防改坏 Windows 路径。
      value += `\\${escapedCharacter}`;
    }
    index += 1;
  }
  return null;
}

function parseParameters(source: string): Record<string, string> | null {
  const parameters: Record<string, string> = {};
  let index = 0;
  while (index < source.length) {
    while (index < source.length && /[\s,]/.test(source[index] ?? '')) index += 1;
    if (index >= source.length) return parameters;
    const nameMatch = /^[a-zA-Z_][a-zA-Z\d_-]*/.exec(source.slice(index));
    if (!nameMatch) return null;
    const name = nameMatch[0];
    index += name.length;
    while (index < source.length && /\s/.test(source[index] ?? '')) index += 1;
    if (source[index] !== '=') return null;
    index += 1;
    while (index < source.length && /\s/.test(source[index] ?? '')) index += 1;
    if (index >= source.length) return null;

    let value: string;
    const character = source[index];
    if (character === '"' || character === "'") {
      const quote = { open: character, close: character };
      const parsed = parseQuotedValue(source, index, quote);
      if (!parsed) return null;
      value = parsed.value;
      index = parsed.nextIndex;
    } else {
      const valueStart = index;
      while (index < source.length && !/[\s,]/.test(source[index] ?? '')) index += 1;
      value = source.slice(valueStart, index);
      if (!value) return null;
    }
    if (index < source.length && !/[\s,]/.test(source[index] ?? '')) return null;
    parameters[name] = value;
  }
  return parameters;
}

/** 提取全文中所有已闭合的 `::<name>{...}` 指令（key=value 参数）。 */
export function extractAssistantDirectives(content: string, directiveName: string): ParsedAssistantDirective[] {
  if (!content.trim() || !directiveName.trim()) return [];
  const directives: ParsedAssistantDirective[] = [];
  let consumedUntil = 0;
  for (const match of content.matchAll(directiveStartPattern(directiveName))) {
    const start = match.index ?? 0;
    if (start < consumedUntil) continue;
    const openBraceIndex = start + (match[0]?.lastIndexOf('{') ?? -1);
    if (openBraceIndex < start) continue;
    const closingBraceIndex = findClosingBrace(content, openBraceIndex);
    if (closingBraceIndex < 0) continue;
    const end = closingBraceIndex + 1;
    consumedUntil = end;
    directives.push({
      start,
      end,
      name: directiveName,
      raw: content.slice(start, end),
      parameters: parseParameters(content.slice(openBraceIndex + 1, closingBraceIndex)),
    });
  }
  return directives;
}

function mergeRanges(ranges: AssistantTextRange[]): AssistantTextRange[] {
  const sorted = [...ranges].sort((left, right) => left[0] - right[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** Markdown 代码区间（围栏 + 行内 code + <code>/<pre>），指令命中其间一律忽略（防注入）。 */
export function findMarkdownCodeRanges(content: string): AssistantTextRange[] {
  const ranges: Array<[number, number]> = [];
  const fencedRanges: Array<[number, number]> = [];
  let fence: { character: '`' | '~'; length: number; start: number } | null = null;
  let lineStart = 0;

  while (lineStart < content.length) {
    const newlineIndex = content.indexOf('\n', lineStart);
    const lineEnd = newlineIndex < 0 ? content.length : newlineIndex + 1;
    const line = content.slice(lineStart, newlineIndex < 0 ? content.length : newlineIndex);
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = { character: marker[0] as '`' | '~', length: marker.length, start: lineStart };
      else if (marker[0] === fence.character && marker.length >= fence.length) {
        fencedRanges.push([fence.start, lineEnd]);
        fence = null;
      }
    }
    lineStart = lineEnd;
  }
  if (fence) fencedRanges.push([fence.start, content.length]);
  ranges.push(...fencedRanges);

  for (const match of content.matchAll(/<(code|pre)(?:\s[^>]*)?>[\s\S]*?<\/\1\s*>/gi)) {
    const start = match.index ?? 0;
    ranges.push([start, start + (match[0]?.length ?? 0)]);
  }

  const isFenced = (index: number) => fencedRanges.some(([start, end]) => index >= start && index < end);
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== '`' || isFenced(index)) continue;
    let markerLength = 1;
    while (content[index + markerLength] === '`') markerLength += 1;
    const marker = '`'.repeat(markerLength);
    const closingIndex = content.indexOf(marker, index + markerLength);
    if (closingIndex < 0 || isFenced(closingIndex)) {
      index += markerLength - 1;
      continue;
    }
    ranges.push([index, closingIndex + markerLength]);
    index = closingIndex + markerLength - 1;
  }
  return mergeRanges(ranges);
}

function overlaps(start: number, end: number, ranges: readonly AssistantTextRange[]): boolean {
  return ranges.some(([rangeStart, rangeEnd]) => start < rangeEnd && end > rangeStart);
}

/**
 * 检测未闭合指令起点（流式半截）：仅当 `{` 之后的内容仍符合参数前缀
 * （key=value 可解析 / 引号未闭 / JSON 参数前缀由 isParameterPrefix 判定）时返回起点。
 */
export function findUnclosedAssistantDirectiveStart(
  content: string,
  directiveName: string,
  protectedRanges: readonly AssistantTextRange[] = [],
  options: { isParameterPrefix?: (source: string) => boolean } = {},
): number | null {
  let unclosedStart: number | null = null;
  for (const match of content.matchAll(directiveStartPattern(directiveName))) {
    const start = match.index ?? 0;
    const openBraceIndex = start + (match[0]?.lastIndexOf('{') ?? -1);
    if (openBraceIndex < start || overlaps(start, openBraceIndex + 1, protectedRanges)) continue;
    if (findClosingBrace(content, openBraceIndex) < 0) {
      const parameterPrefix = content.slice(openBraceIndex + 1);
      let quote: QuoteState | null = null;
      let escaped = false;
      for (const character of parameterPrefix) {
        if (quote !== null) {
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === quote.close) quote = null;
        } else if (character === '"' || character === "'") quote = { open: character, close: character };
      }
      const isParameterPrefix =
        options.isParameterPrefix?.(parameterPrefix) === true ||
        parseParameters(parameterPrefix) !== null ||
        quote !== null ||
        /(?:^|[\s,])[a-zA-Z_][a-zA-Z\d_-]*\s*(?:=\s*)?$/.test(parameterPrefix);
      if (isParameterPrefix) unclosedStart = start;
    }
  }
  return unclosedStart;
}

/**
 * 流式尾部刚开始输出指令前缀（如 `::vis`）时返回其起点，供隐藏防闪烁；
 * 只检查文末连续尾部且跳过代码区间，前缀分叉即返回 null。
 */
export function findAssistantDirectivePrefixStart(
  content: string,
  directiveNames: readonly string[],
  protectedRanges: readonly AssistantTextRange[] = [],
): number | null {
  for (let index = content.length - 1; index >= 0; index -= 1) {
    if (content[index] !== ':') continue;
    if (content[index - 1] === ':') continue;
    if (overlaps(index, index + 1, protectedRanges)) continue;
    const suffix = content.slice(index);
    const isPrefix = directiveNames.some((directiveName) => {
      const canonicalName = `::${directiveName}`;
      return (
        canonicalName.startsWith(suffix) ||
        (suffix.startsWith(canonicalName) && /^\s*$/.test(suffix.slice(canonicalName.length)))
      );
    });
    if (isPrefix) return index;
  }
  return null;
}
