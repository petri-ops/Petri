import { describe, expect, it } from 'vitest';
import { assessComplexity, describeAutoDecisionWithComplexity, type AutoModelDecision } from '@/lib/auto-model';

// BLOCK-264（C-36）— Auto 定形：确定性复杂度分级（无模型参与，可审计可复现）

describe('assessComplexity（BLOCK-264 C-36）', () => {
  it('heavy：多图 / 超长上下文 / 多引用 任一命中（逐条给依据）', () => {
    const multi = assessComplexity({ contextChars: 100, imageCount: 2, referenceCount: 0 });
    expect(multi.level).toBe('heavy');
    expect(multi.factors[0]).toContain('图片 2 张');

    const long = assessComplexity({ contextChars: 25000, imageCount: 0, referenceCount: 0 });
    expect(long.level).toBe('heavy');
    expect(long.factors[0]).toContain('25000 字');

    const refs = assessComplexity({ contextChars: 100, imageCount: 0, referenceCount: 6 });
    expect(refs.level).toBe('heavy');
    expect(refs.factors[0]).toContain('引用 6 条');
  });

  it('light：无图 + 短上下文 + 无引用', () => {
    const light = assessComplexity({ contextChars: 150, imageCount: 0, referenceCount: 0 });
    expect(light.level).toBe('light');
    expect(light.factors[0]).toContain('轻任务');
  });

  it('standard：单图或中等上下文', () => {
    expect(assessComplexity({ contextChars: 800, imageCount: 0, referenceCount: 0 }).level).toBe('standard');
    expect(assessComplexity({ contextChars: 100, imageCount: 1, referenceCount: 0 }).level).toBe('standard');
    expect(assessComplexity({ contextChars: 100, imageCount: 0, referenceCount: 2 }).level).toBe('standard');
  });

  it('负数/缺省输入钳位（不抛错）', () => {
    expect(assessComplexity({ contextChars: -5, imageCount: -1, referenceCount: 0 }).level).toBe('light');
  });
});

describe('describeAutoDecisionWithComplexity（BLOCK-264 C-36）', () => {
  const decision: AutoModelDecision = {
    preset: { id: 'p1', label: 'P', provider: 'openai-compatible', model: 'm-1' } as AutoModelDecision['preset'],
    reason: 'Agent 角色绑定',
    role: 'agent',
  };
  it('决策依据 × 复杂度合并展示', () => {
    const text = describeAutoDecisionWithComplexity(decision, assessComplexity({ contextChars: 800, imageCount: 0, referenceCount: 0 }));
    expect(text).toContain('m-1');
    expect(text).toContain('Agent 角色绑定');
    expect(text).toContain('标准任务');
  });
  it('无复杂度时回落纯决策描述', () => {
    expect(describeAutoDecisionWithComplexity(decision, null)).toBe('m-1（Agent 角色绑定）');
  });
});
