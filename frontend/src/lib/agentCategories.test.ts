import { describe, expect, it } from 'vitest';
import { AGENT_CATEGORIES, getAgentCategoryByKey, inferAgentCategory, resolveAgentCategory } from './agentCategories';

describe('agentCategories — 子智能体职能类别推断（UI-387）', () => {
  it('关键词首匹配：检索/搜集/整理/读取/分析 各归各类', () => {
    expect(inferAgentCategory('检索工作区里的数据文件').key).toBe('search');
    expect(inferAgentCategory('搜集三个来源的背景资料').key).toBe('collect');
    expect(inferAgentCategory('整理根目录下的历史文档').key).toBe('organize');
    expect(inferAgentCategory('读取 b.txt 并复述内容').key).toBe('read');
    expect(inferAgentCategory('统计并对比两份表格的差异').key).toBe('analysis');
  });

  it('优先级：文本命中多类时取靠前类别（search > collect > 整理…）', () => {
    // 「检索」在前序类别，即使同时出现「整理」也归检索
    expect(inferAgentCategory('检索并整理所有报告').key).toBe('search');
  });

  it('空文本 / 无命中 → 通用（bot）', () => {
    expect(inferAgentCategory('').key).toBe('general');
    expect(inferAgentCategory(null)).toBe(AGENT_CATEGORIES[AGENT_CATEGORIES.length - 1]);
    expect(inferAgentCategory('跑一遍 QC 流程').key).toBe('general');
    expect(inferAgentCategory('跑一遍 QC 流程').emoji).toBe('🤖');
  });

  it('类别表带 emoji 图标与中文标签，且通用类兜底唯一', () => {
    for (const c of AGENT_CATEGORIES) {
      expect(c.emoji).toBeTruthy();
      expect(c.label).toBeTruthy();
    }
    expect(AGENT_CATEGORIES[AGENT_CATEGORIES.length - 1].key).toBe('general');
  });
});

describe('agentCategories — BLOCK-93 扩展角色集与显式 role 解析', () => {
  it('十一类别：六基础 + 四扩展（test/write/plan/fix）+ investigator，general 唯一兜底在最后', () => {
    expect(AGENT_CATEGORIES.map((c) => c.key)).toEqual([
      'search', 'collect', 'organize', 'read', 'analysis', 'test', 'write', 'plan', 'fix', 'investigator', 'general',
    ]);
  });

  it('扩展角色关键词推断：测试/写作/规划/修复', () => {
    expect(inferAgentCategory('给导出函数补一组测试用例').key).toBe('test');
    expect(inferAgentCategory('撰写项目说明文档').key).toBe('write');
    expect(inferAgentCategory('把迁移工作拆解成可执行的方案').key).toBe('plan');
    expect(inferAgentCategory('修复导出 CSV 时的编码缺陷').key).toBe('fix');
  });

  it('getAgentCategoryByKey：显式 role 直查；未知/空 → null（交回推断兜底）', () => {
    expect(getAgentCategoryByKey('fix')?.emoji).toBe('🔧');
    expect(getAgentCategoryByKey(' test ')?.label).toBe('测试');
    expect(getAgentCategoryByKey('nope')).toBeNull();
    expect(getAgentCategoryByKey('')).toBeNull();
    expect(getAgentCategoryByKey(null)).toBeNull();
  });

  it('resolveAgentCategory：显式 role 第一优先，无 role 走文本推断，未知 role 兜底推断', () => {
    // 任务文本像检索，但显式 role=fix → 修复（显式 > 推断）
    expect(resolveAgentCategory('fix', '检索相关代码').key).toBe('fix');
    // 无 role → 推断
    expect(resolveAgentCategory(undefined, '检索相关代码').key).toBe('search');
    // 未知 role → 交回推断
    expect(resolveAgentCategory('hacker', '检索相关代码').key).toBe('search');
  });
});
