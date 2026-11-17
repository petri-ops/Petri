import { describe, expect, it } from 'vitest';
import { projectGenUiReferences } from '../references';
import { findUnclosedAssistantDirectiveStart } from '../assistantDirectiveParser';

// BLOCK-461 P1 — ::compose 指令投影契约（HK-01 红绿先行）。
// 既有 ::visualize 链零回归；compose 片段独立 kind（completed 后渲染、流式 pending 防闪烁沿既有语义）。

const composeJson = JSON.stringify({
  version: 1,
  root: 'card1',
  nodes: { card1: { kind: 'card', title: '概览' } },
});

describe('::compose 投影（P1）', () => {
  it('completed 消息：::compose{合法 JSON} → compose 片段', () => {
    const parts = projectGenUiReferences(`前言\n::compose ${composeJson}\n后记`, true);
    const kinds = parts.map((p) => p.kind);
    expect(kinds).toContain('compose');
    const composePart = parts.find((p) => p.kind === 'compose') as { kind: 'compose'; spec: { root: string } } | undefined;
    expect(composePart?.spec.root).toBe('card1');
  });

  it('流式未完成：字符串值截断前缀 → pending（防闪烁；沿 jsonParameterPrefix 既有字符串值口径）', () => {
    const parts = projectGenUiReferences('::compose {"root":"card1"', false);
    expect(parts.some((p) => p.kind === 'pending')).toBe(true);
    expect(parts.some((p) => p.kind === 'compose')).toBe(false);
  });

  it('坏 JSON / schema 不合法 → invalid（不炸穿投影）', () => {
    const parts = projectGenUiReferences('::compose {"version": 999}', true);
    expect(parts.some((p) => p.kind === 'invalid')).toBe(true);
    // 无花括号形态不进指令态（parser 严格 ::name{ 形态）→ 原文走 text
    const parts2 = projectGenUiReferences('::compose not-json', true);
    expect(parts2.some((p) => p.kind === 'text' && p.text.includes('::compose not-json'))).toBe(true);
  });

  it('::visualize 与 ::compose 混排按位置有序（双形态并存零回归）', () => {
    const text = `::visualize{"path":"/tmp/x.html"}\n中\n::compose ${composeJson}`;
    const parts = projectGenUiReferences(text, true);
    const kinds = parts.filter((p) => p.kind !== 'text').map((p) => p.kind);
    expect(kinds).toEqual(['ui', 'compose']);
  });

  it('Markdown 代码块里的 ::compose 不命中（沿既有区间豁免契约）', () => {
    const text = '```\n::compose {"version":1}\n```';
    const parts = projectGenUiReferences(text, true);
    expect(parts.some((p) => p.kind === 'compose')).toBe(false);
  });
});

describe('compose 未闭合前缀检测（流式防闪烁）', () => {
  it('未闭合 ::compose 前缀可检出（沿既有 parser 契约）', () => {
    const start = findUnclosedAssistantDirectiveStart(`::compose {"version":1`, 'compose', [], {
      isParameterPrefix: () => true,
    });
    expect(start).toBe(0);
  });
});
