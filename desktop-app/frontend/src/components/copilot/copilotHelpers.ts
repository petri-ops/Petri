/**
 * copilotHelpers.ts — Pure utility functions for Copilot.
 * No React, no side effects (except localStorage).
 */

import type { CopilotContext } from './copilotContext';
import type { UIMessage } from './copilotTypes';
import { THREAD_KEY, LEGACY_PREFIX, MAX_HISTORY_MESSAGES } from './copilotTypes';

/**
 * One-time migration: if any legacy per-page history exists, merge into single thread.
 */
export function migrateLegacyHistory(): void {
  if (typeof window === 'undefined') return;
  try {
    if (localStorage.getItem(THREAD_KEY)) return;
    const merged: UIMessage[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(LEGACY_PREFIX)) continue;
      try {
        const arr = JSON.parse(localStorage.getItem(key) || '[]');
        if (Array.isArray(arr)) {
          for (const m of arr) {
            if (
              m &&
              (m.role === 'user' || m.role === 'assistant') &&
              typeof m.content === 'string'
            ) {
              merged.push({
                role: m.role,
                content: m.content,
                meta: m.meta,
                autoActionsFired: true,
              });
            }
          }
        }
      } catch {}
    }
    if (merged.length > 0) {
      localStorage.setItem(THREAD_KEY, JSON.stringify(merged.slice(-MAX_HISTORY_MESSAGES)));
    }
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LEGACY_PREFIX)) toRemove.push(key);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {}
}

export function loadHistory(): UIMessage[] {
  try {
    const raw = localStorage.getItem(THREAD_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .slice(-MAX_HISTORY_MESSAGES)
      .map((m: Record<string, unknown>) => ({ ...m, autoActionsFired: true }));
  } catch {
    return [];
  }
}

export function saveHistory(messages: UIMessage[]): void {
  try {
    const clean = messages
      .filter((m) => !m.pending && !m.error)
      .slice(-MAX_HISTORY_MESSAGES)
      .map((m) => ({
        role: m.role,
        content: m.content,
        meta: m.meta,
        autoActionsFired: true,
        // MULTIMODAL_v1: persist attached image URLs so they survive a reload.
        ...(m.images && m.images.length ? { images: m.images } : {}),
      }));
    localStorage.setItem(THREAD_KEY, JSON.stringify(clean));
  } catch {}
}

/** Build a metadata snippet for a message (page + entity refs) to feed to LLM. */
export function buildMessageMetaTag(meta: UIMessage['meta']): string {
  if (!meta || !meta.page) return '';
  const parts: string[] = [];
  parts.push(meta.page);
  if (meta.analysisName) parts.push(`分析:${meta.analysisName}`);
  else if (meta.datasetName) parts.push(`数据集:${meta.datasetName}`);
  else if (meta.plotName) parts.push(`工具:${meta.plotName}`);
  else if (meta.pageTitle) parts.push(meta.pageTitle);
  return `[${parts.join(' · ')}]`;
}

export function welcomeFor(ctx: CopilotContext): string {
  switch (ctx.page) {
    case 'single-cell-result':
      return '我可以帮你解读这个分析结果、推断细胞类型、给出后续分析建议。我会记住我们之前聊过什么。';
    case 'single-cell-dataset':
      return '关于这个数据集，我可以帮你选择分析参数、解释 QC 指标，或推荐分析路径。';
    case 'single-cell-projects':
    case 'single-cell-project':
      return '我是单细胞分析助手。问我数据集组织、分析流程或参数选择。';
    case 'figcode':
      return '我可以帮你修改这段 R 绘图代码、调整美学参数，或解释每一步。';
    case 'tools':
      return ctx.toolResult
        ? `${ctx.toolName || '分析'}已完成。我可以帮你解读结果、推荐下游分析，或调整绘图参数。`
        : `我可以帮你选择合适的分析工具、解释参数含义，或推荐分析流程。当前可用工具：${ctx.availableTools?.join('、') || '加载中'}`;
    case 'docs':
      return '看到不懂的概念？让我换个角度解释，或给出可运行的代码示例。我也记得你之前问过的内容。';
    case 'blog':
      return '想深入这篇博客的话题？我可以补充背景、给出延伸阅读或代码示例。';
    case 'home':
    default:
      return '我是 BioF3 Copilot — 你的全栈生信助手。我会跨页面记住我们的对话。';
  }
}

export const QUICK_PROMPTS: Record<string, string[]> = {
  'single-cell-result': ['帮我解读这个分析结果', '推断细胞类型并给出依据', '下一步建议做什么分析'],
  'single-cell-dataset': ['推荐 QC 阈值', '我应该用多少 PCs', '常见的批次效应来源'],
  'single-cell-projects': [
    '单细胞分析的标准流程是什么',
    '怎么选择 cluster 分辨率',
    'Seurat vs Scanpy 怎么选',
  ],
  figcode: ['解释当前这段代码', '把这张图改成横向条形图', '把配色换成 Nature 风格'],
  tools: [
    '帮我解读当前分析结果',
    '下一步应该做什么分析',
    '这些参数怎么选择',
    '帮我跑一次 DESeq2 分析',
  ],
  docs: ['一句话总结当前这一页', '给我一个可运行的最小示例', '相关的进阶教程有哪些'],
  blog: ['总结这篇文章的核心观点', '给一个上手实践的方向', '相关的延伸阅读'],
  home: ['BioF3 能做什么', '从哪里开始入门', '推荐一个单细胞教程'],
};

export function contextLabel(ctx: CopilotContext): string {
  if (!ctx.page || ctx.page === 'home') return '全站助手';
  if (ctx.page === 'single-cell-result') return ctx.analysisName || '分析结果';
  if (ctx.page === 'single-cell-dataset') return ctx.datasetName || '数据集';
  if (ctx.page === 'single-cell-projects' || ctx.page === 'single-cell-project')
    return '单细胞 · 项目列表';
  if (ctx.page === 'figcode') return ctx.plotName || 'FigCode';
  if (ctx.page === 'tools') return ctx.toolName || '分析工具';
  if (ctx.page === 'docs') return ctx.pageTitle || '教程';
  if (ctx.page === 'blog') return ctx.pageTitle || '博客';
  return ctx.page;
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function pageBadgeLabel(meta: NonNullable<UIMessage['meta']>): string {
  const parts: string[] = [];
  if (meta.page) parts.push(meta.page.replace('single-cell-', 'sc-'));
  if (meta.analysisName) parts.push(meta.analysisName);
  else if (meta.datasetName) parts.push(meta.datasetName);
  else if (meta.plotName) parts.push(meta.plotName);
  else if (meta.pageTitle) parts.push(meta.pageTitle);
  return parts.join(' · ') || '?';
}
