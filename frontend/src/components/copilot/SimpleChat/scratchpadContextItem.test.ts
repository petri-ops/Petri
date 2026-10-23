// BLOCK-246 C13 — 速记条目 → 上下文引用块（唯一通道）的形状与上限。
import { describe, expect, it } from 'vitest';
import {
  MAX_SCRATCHPAD_BLOCK_CHARS,
  appendContextItem,
  composeContextMessage,
  scratchpadContextItem,
} from './contextItems';

function input(overrides: Partial<Parameters<typeof scratchpadContextItem>[0]> = {}) {
  return {
    entryId: 'scr_1',
    kind: 'text' as const,
    title: 'PCA 笔记',
    body: '先 scale 再 subset',
    sourceKind: 'conversation',
    sourceRef: 'conv_1',
    createdAt: '2026-10-23T00:00:00.000Z',
    ...overrides,
  };
}

describe('scratchpadContextItem', () => {
  it('renders a full-width reference block with source line and quoted body', () => {
    const item = scratchpadContextItem(input());
    expect(item.group).toBe('reference');
    expect(item.kind).toBe('scratchpad');
    expect(item.label).toBe('PCA 笔记');
    expect(item.lines[0]).toBe('【引用速记 PCA 笔记】');
    expect(item.lines[1]).toBe('> 来源：会话 · conv_1');
    expect(item.lines[2]).toBe('> 先 scale 再 subset');
    expect(item.dedupeKey).toBe('scratchpad|scr_1');
  });

  it('falls back to the first body line when the entry has no title', () => {
    const item = scratchpadContextItem(input({ title: null, body: '\n\n  第一行要点\n第二行' }));
    expect(item.label).toBe('第一行要点');
  });

  it('never inlines an image data url into the prompt', () => {
    const item = scratchpadContextItem(input({ kind: 'image', title: '结果图', body: 'data:image/png;base64,AAAA' }));
    expect(item.lines.join('\n')).not.toContain('base64');
    expect(item.lines.join('\n')).toContain('图片速记');
  });

  it('clips over-long bodies with an honest marker instead of silently truncating', () => {
    const item = scratchpadContextItem(input({ body: 'x'.repeat(MAX_SCRATCHPAD_BLOCK_CHARS + 500) }));
    const text = item.lines.join('\n');
    expect(text).toContain(`已截断前 ${MAX_SCRATCHPAD_BLOCK_CHARS} 字`);
    expect(text.length).toBeLessThan(MAX_SCRATCHPAD_BLOCK_CHARS + 200);
  });

  it('travels the single list channel and composes above the user text', () => {
    const { items, dropped, deduped } = appendContextItem([], scratchpadContextItem(input()));
    expect(dropped).toBe(0);
    expect(deduped).toBe(false);
    const composed = composeContextMessage('帮我看看这段', items);
    expect(composed.startsWith('【引用速记 PCA 笔记】')).toBe(true);
    expect(composed.endsWith('帮我看看这段')).toBe(true);
  });

  it('re-quoting the same entry is deduped rather than duplicated', () => {
    const item = scratchpadContextItem(input());
    const first = appendContextItem([], item);
    const second = appendContextItem(first.items, scratchpadContextItem(input()));
    expect(second.deduped).toBe(true);
    expect(second.items.length).toBe(1);
  });
});
