import { describe, expect, it } from 'vitest';
import { AGENT_CATEGORIES, inferAgentCategory } from './agentCategories';

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
