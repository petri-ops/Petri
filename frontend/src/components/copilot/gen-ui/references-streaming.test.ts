import { describe, expect, it } from 'vitest';
import { projectStreamingCompose, type StreamingComposeProjection } from './referencesStreaming';

// BLOCK-466 (W11 P3 流式首切片) — HK-01 红绿先行。
// 契约：流式期 ::compose 指令在 spec 完整合法前只出稳定占位（不泄漏原始 JSON/不闪烁），
// 完整后才升级 compose；投影为 content 纯函数，断线续传（afterSeq 重放累积 content）一致。

const VALID = '::compose {"version":1,"root":"card1","nodes":{"card1":{"kind":"card","title":"概览"}}}';

describe('::compose 流式投影（BLOCK-466 P3）', () => {
  it('纯文本（无 compose 指令）：streaming=false 快路径，原样渲染', () => {
    const p = projectStreamingCompose('你好世界', false);
    expect(p.streaming).toBe(false);
    expect(p.parts).toEqual([{ kind: 'text', text: '你好世界' }]);
  });

  it('partial spec（截断前缀）：出 pending 占位，原始 JSON 不泄漏到 text 段', () => {
    for (const partial of [
      '::compose {"version":1,"root":"card1"',
      '::compose {"version":1,"root":"card1","nodes":{"card1":{"kind":',
      '::compose {"version":1,"root":"card1","nodes":{"card1":{"kind":"card","title":"概',
    ]) {
      const p = projectStreamingCompose(partial, true);
      expect(p.streaming).toBe(true);
      expect(p.parts.some((part) => part.kind === 'pending')).toBe(true);
      expect(p.parts.some((part) => part.kind === 'compose')).toBe(false);
      // 防原始 JSON 泄漏：任何 text 段不得含指令起始符与花括号内容
      for (const part of p.parts) {
        if (part.kind === 'text') expect(part.text).not.toMatch(/::compose\s*\{/);
      }
    }
  });

  it('防闪烁：逐 delta 增长前缀期间占位态稳定（pending 恒在、compose 恒不在）', () => {
    const prefixes = [
      '::compose {',
      '::compose {"version":1',
      '::compose {"version":1,',
      '::compose {"version":1,"root":"card1"',
      '::compose {"version":1,"root":"card1","nodes":{}',
    ];
    const kinds = prefixes.map((text) => projectStreamingCompose(text, true).parts.map((p) => p.kind));
    for (const k of kinds) {
      expect(k).toContain('pending');
      expect(k).not.toContain('compose');
    }
  });

  it('完整合法 spec：流式期仍保持占位，不抢渲染（completed 才升级）', () => {
    const streaming = projectStreamingCompose(VALID, true);
    expect(streaming.parts.some((part) => part.kind === 'compose')).toBe(false);
    const completed = projectStreamingCompose(VALID, false);
    expect(completed.parts.some((part) => part.kind === 'compose')).toBe(true);
  });

  it('invalid spec（schema 失败）：completed 后降级 invalid，不炸穿投影', () => {
    const p = projectStreamingCompose('::compose {"version":999}', false);
    expect(p.parts.some((part) => part.kind === 'invalid')).toBe(true);
  });

  it('代码围栏内的 ::compose 不命中（防注入，沿既有区间豁免）', () => {
    const p = projectStreamingCompose('```\n::compose {"version":1}\n```', true);
    expect(p.parts.every((part) => part.kind === 'text')).toBe(true);
  });

  it('断线续传兼容：投影为 content 纯函数，与重连历史无关', () => {
    const accumulated = '前文\n' + VALID;
    const first: StreamingComposeProjection = projectStreamingCompose(accumulated, false);
    // 模拟：流式中断→afterSeq 重放→累积 content 重建（同 content）→投影必须逐等
    const afterResume = projectStreamingCompose(accumulated, false);
    expect(afterResume.parts).toEqual(first.parts);
    expect(afterResume.streaming).toBe(first.streaming);
    // 半截 content 重连后继续累积到同一文本，投影同样一致（无隐藏状态）
    expect(projectStreamingCompose(accumulated, false).parts).toEqual(first.parts);
  });

  it('流式→完成升级：同 content 的 streaming/completed 两态可区分（占位→卡片）', () => {
    const s = projectStreamingCompose(VALID, true);
    const c = projectStreamingCompose(VALID, false);
    expect(s.parts.map((p) => p.kind)).not.toEqual(c.parts.map((p) => p.kind));
  });
});
