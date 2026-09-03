import { describe, expect, it } from 'vitest';

// BLOCK-52 P1 — 选中即引用纯函数助手测试。
// 被测模块对 '@/lib/events' 仅 import type（编译期擦除），运行时零额外依赖。
import {
  MAX_SELECTION_REFERENCE_CHARS,
  MAX_SELECTION_REFERENCES,
  makeSelectionReference,
  appendSelectionReference,
  selectionReferenceLocation,
  composeMessageWithSelectionReferences,
  selectionReferenceChipLabel,
} from './selectionReferences';
import type { SelectionQuoteDetail } from '@/lib/events';

function detail(overrides: Partial<SelectionQuoteDetail> = {}): SelectionQuoteDetail {
  return {
    projectId: 'p1',
    path: 'analysis/plots.R',
    startLine: 42,
    endLine: 48,
    text: 'ggplot(...) 等 7 行',
    ...overrides,
  };
}

describe('selectionReferences (BLOCK-52 P1)', () => {
  it('makeSelectionReference: 正常载荷 → 带 id/name 的引用块；空 path/空文本 → null', () => {
    const ref = makeSelectionReference(detail());
    expect(ref).not.toBeNull();
    expect(ref!.id.startsWith('selref-')).toBe(true);
    expect(ref!.name).toBe('plots.R');
    expect(ref!.path).toBe('analysis/plots.R');
    expect(ref!.startLine).toBe(42);
    expect(ref!.endLine).toBe(48);
    expect(ref!.text).toBe('ggplot(...) 等 7 行');

    expect(makeSelectionReference(detail({ path: '  ' }))).toBeNull();
    expect(makeSelectionReference(detail({ text: '   ' }))).toBeNull();
    expect(makeSelectionReference(detail({ path: undefined as unknown as string }))).toBeNull();
  });

  it('makeSelectionReference: name 缺省由 path 尾段推导；超长文本截断并标注', () => {
    const ref = makeSelectionReference(detail({ name: undefined, endLine: undefined }));
    expect(ref).not.toBeNull();
    expect(ref!.name).toBe('plots.R');
    expect(ref!.endLine).toBeUndefined();

    const long = 'x'.repeat(MAX_SELECTION_REFERENCE_CHARS + 100);
    const truncated = makeSelectionReference(detail({ text: long }));
    expect(truncated).not.toBeNull();
    expect(truncated!.text.length).toBeLessThan(long.length);
    expect(truncated!.text.includes('已截断')).toBe(true);
  });

  it('appendSelectionReference: 追加 / 同源去重 / 上限截断', () => {
    const first = appendSelectionReference([], detail());
    expect(first).toHaveLength(1);

    // 完全同源（同路径同行同文）→ 去重
    const deduped = appendSelectionReference(first, detail());
    expect(deduped).toHaveLength(1);

    // 不同行 → 追加
    const two = appendSelectionReference(first, detail({ startLine: 100, endLine: 100 }));
    expect(two).toHaveLength(2);

    // 上限截断：保留最近 MAX 条
    let refs = first;
    for (let i = 0; i < MAX_SELECTION_REFERENCES + 3; i++) {
      refs = appendSelectionReference(refs, detail({ startLine: 10 + i, endLine: 10 + i }));
    }
    expect(refs).toHaveLength(MAX_SELECTION_REFERENCES);
    expect(refs[refs.length - 1].startLine).toBe(10 + MAX_SELECTION_REFERENCES + 2);

    // 无效载荷 → 原样返回（同一数组引用）
    const same = appendSelectionReference(refs, detail({ text: ' ' }));
    expect(same).toBe(refs);
  });

  it('selectionReferenceLocation: 单行 / 多行 / 无行号三种形态', () => {
    expect(selectionReferenceLocation({ path: 'a.R', startLine: 42, endLine: 42 })).toBe('a.R:L42');
    expect(selectionReferenceLocation({ path: 'a.R', startLine: 42, endLine: 48 })).toBe('a.R:L42-L48');
    expect(selectionReferenceLocation({ path: 'report.md' })).toBe('report.md');
  });

  it('composeMessageWithSelectionReferences: 无引用原样返回；有引用时引用块前缀 + blockquote', () => {
    expect(composeMessageWithSelectionReferences('帮我改图', [])).toBe('帮我改图');

    const refs = [
      makeSelectionReference(detail()),
      makeSelectionReference(detail({ path: 'b.py', startLine: 3, endLine: undefined, text: 'line3' })),
    ].filter((r): r is NonNullable<typeof r> => r !== null);
    const composed = composeMessageWithSelectionReferences('把点调大', refs);

    expect(composed.startsWith('[引用 analysis/plots.R:L42-L48]\n> ggplot(...) 等 7 行')).toBe(true);
    expect(composed.includes('[引用 b.py:L3]\n> line3')).toBe(true);
    expect(composed.endsWith('\n\n把点调大')).toBe(true);
  });

  it('selectionReferenceChipLabel: 空白折叠 + 超长省略', () => {
    const ref = makeSelectionReference(detail({ text: 'a\n  b\t c' }));
    expect(ref).not.toBeNull();
    expect(selectionReferenceChipLabel(ref!)).toBe('「a b c」');

    const longRef = makeSelectionReference(detail({ text: 'z'.repeat(40) }));
    expect(longRef).not.toBeNull();
    const label = selectionReferenceChipLabel(longRef!);
    expect(label.startsWith('「zzzz')).toBe(true);
    expect(label.endsWith('…」')).toBe(true);
    expect(label.length).toBeLessThan(40);
  });
});
