import { describe, expect, it } from 'vitest';
import { normalizePackExamplePrompts } from './helpers';

describe('normalizePackExamplePrompts', () => {
  it('reads pack-declared examples and trims fields', () => {
    const prompts = normalizePackExamplePrompts([
      {
        examples: [
          { icon: 'bar-chart', title: ' 示例 ', description: ' 说明 ', prompt: ' 帮我分析 ' },
        ],
      },
    ]);
    expect(prompts).toEqual([
      { icon: 'bar-chart', title: '示例', description: '说明', prompt: '帮我分析' },
    ]);
  });

  it('filters malformed entries, falls back to the default icon, and caps at six', () => {
    const examples = [
      { title: '', prompt: 'x' },
      { title: 'ok', prompt: '' },
      { title: 'no icon', prompt: 'p' },
      ...Array.from({ length: 8 }, (_, index) => ({
        icon: 'zap',
        title: `card-${index}`,
        description: '',
        prompt: `prompt-${index}`,
      })),
    ];
    const prompts = normalizePackExamplePrompts([{ examples }]);
    expect(prompts).toHaveLength(6);
    expect(prompts[0]).toMatchObject({ icon: 'zap', title: 'no icon', prompt: 'p' });
  });

  it('returns an empty list for non-array pack payloads', () => {
    expect(normalizePackExamplePrompts(null)).toEqual([]);
    expect(normalizePackExamplePrompts({ packs: [] })).toEqual([]);
  });
});
