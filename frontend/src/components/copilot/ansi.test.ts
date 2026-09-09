import { describe, expect, it } from 'vitest';
import { parseAnsiToSpans } from './ansi';

describe('parseAnsiToSpans（UI-315 优化：ANSI SGR 解析）', () => {
  it('纯文本返回单片段且无样式', () => {
    expect(parseAnsiToSpans('hello world')).toEqual([{ text: 'hello world', cls: '' }]);
  });

  it('解析前景色 SGR 为着色片段', () => {
    const spans = parseAnsiToSpans('\x1b[32mOK\x1b[0m done');
    expect(spans).toEqual([
      { text: 'OK', cls: 'term-c2' },
      { text: ' done', cls: '' },
    ]);
  });

  it('bold + 颜色组合为多 class', () => {
    const spans = parseAnsiToSpans('\x1b[1;31mERR\x1b[0m');
    expect(spans[0]).toEqual({ text: 'ERR', cls: 'term-bold term-c1' });
  });

  it('亮色系 90-97 折算到 c8-c15', () => {
    const spans = parseAnsiToSpans('\x1b[90mdim gray');
    expect(spans[0].cls).toBe('term-c8');
  });

  it('非 SGR 转义（光标移动/OSC）直接剥除', () => {
    const spans = parseAnsiToSpans('\x1b]0;title\x07\x1b[2J\x1b[1;1Hcleared');
    expect(spans).toEqual([{ text: 'cleared', cls: '' }]);
  });

  it('扩展色参数组（38;5;n）整组跳过不污染后续参数', () => {
    const spans = parseAnsiToSpans('\x1b[38;5;123mX\x1b[0m');
    expect(spans[0].cls).toBe(''); // 256 色不支持：无前景着色，但正常输出文本
    expect(spans[0].text).toBe('X');
  });
});
