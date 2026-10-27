import { describe, it, expect } from 'vitest';
import { trackResizeGlow } from './resize-glow';
import type { PointerEvent as ReactPointerEvent } from 'react';

describe('trackResizeGlow（UI-591 指针跟随渐晕）', () => {
  it('把指针在把手内的 Y 写进 --petri-resize-glow-y', () => {
    const el = document.createElement('div');
    const event = { currentTarget: el, clientY: 240 } as unknown as ReactPointerEvent<HTMLElement>;
    trackResizeGlow(event);
    expect(el.style.getPropertyValue('--petri-resize-glow-y')).toBe('240px');
  });

  it('重复移动覆盖旧值（光晕连续跟手）', () => {
    const el = document.createElement('div');
    const make = (y: number) =>
      ({ currentTarget: el, clientY: y }) as unknown as ReactPointerEvent<HTMLElement>;
    trackResizeGlow(make(10));
    trackResizeGlow(make(500));
    expect(el.style.getPropertyValue('--petri-resize-glow-y')).toBe('500px');
  });
});
