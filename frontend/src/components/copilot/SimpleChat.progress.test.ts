import { describe, expect, it } from 'vitest';
import { compactStageConclusion } from './SimpleChat';

describe('compactStageConclusion', () => {
  it('keeps only the first public conclusion sentence', () => {
    expect(compactStageConclusion(
      '好，计划已确认，5 个步骤全部待执行。现在开始第 1 步：表达矩阵质控。'
    )).toBe('计划已确认，5 个步骤全部待执行。');
  });

  it('removes conversational acknowledgement prefixes', () => {
    expect(compactStageConclusion('好的，文件确认就绪。接下来运行质控。'))
      .toBe('文件确认就绪。');
  });

  it('bounds unusually long conclusions', () => {
    expect(compactStageConclusion('结论' + '很长'.repeat(200), 20)).toHaveLength(20);
    expect(compactStageConclusion('结论' + '很长'.repeat(200), 20)).toMatch(/…$/u);
  });
});
