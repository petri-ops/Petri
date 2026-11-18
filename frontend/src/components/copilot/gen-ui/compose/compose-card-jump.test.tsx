/**
 * BLOCK-463 — ::compose ↔ Result Studio 双形态互达契约（HK-01 红绿先行）。
 *
 * mesh-reference 节点（.glb）→ 「在 Result Studio 打开」跳转（沿 UI-654 先例
 * dispatch petriEvents.model3dOpen；scenePath 取 model3d/runs 的 scene.json 配对惯例）；
 * selectComposePresentation 判定矩阵钉住三面选择语义（inline-render / open-workbench）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { parseComposeSpec } from './spec';
import { selectComposePresentation } from './scenePolicy';

const dispatchSpy = vi.hoisted(() => vi.fn());

vi.mock('@/lib/events', () => ({
  petriEvents: { model3dOpen: 'petri:model3d-open' },
  dispatchPetriEvent: dispatchSpy,
}));

import { ComposeCard } from './ComposeCard';

afterEach(() => {
  cleanup();
  dispatchSpy.mockClear();
});

describe('selectComposePresentation（三面选择判定矩阵）', () => {
  it('mesh-reference .glb 节点 → open-workbench（3D viewer 面）', () => {
    expect(selectComposePresentation({ kind: 'mesh-reference', source: { path: 'model3d/runs/r1/model.glb', sourceSha256: 'a'.repeat(64) } })).toBe('open-workbench');
  });
  it('mesh-reference 非 .glb → inline-render', () => {
    expect(selectComposePresentation({ kind: 'mesh-reference', source: { path: 'assets/thing.stl', sourceSha256: 'a'.repeat(64) } })).toBe('inline-render');
  });
  it('metric/table/chart/card → inline-render', () => {
    expect(selectComposePresentation({ kind: 'metric' })).toBe('inline-render');
    expect(selectComposePresentation({ kind: 'table' })).toBe('inline-render');
    expect(selectComposePresentation({ kind: 'chart' })).toBe('inline-render');
    expect(selectComposePresentation({ kind: 'card' })).toBe('inline-render');
  });
});

describe('::compose → Result Studio 跳转（双形态互达）', () => {
  it('glb mesh 卡呈现跳转按钮，点击 dispatch model3dOpen（scenePath=同目录 scene.json）', () => {
    const spec = parseComposeSpec({
      version: 1,
      root: 'card1',
      nodes: { card1: { kind: 'card', title: '装配' } },
    });
    // mesh-reference 节点由归一器产出；这里直接构造含 glb 引用的 spec
    const glbSpec = parseComposeSpec({
      version: 1,
      root: 'asm',
      nodes: { asm: { kind: 'mesh-reference', source: { path: 'model3d/runs/r1/model.glb', sourceSha256: 'b'.repeat(64) } } },
    });
    expect(glbSpec).not.toBeNull();
    render(<ComposeCard spec={glbSpec} conversationId="c1" projectId="p1" />);
    const button = screen.getByTestId('compose-open-workbench');
    expect(button).toBeTruthy();
    fireEvent.click(button);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const call = dispatchSpy.mock.calls[0];
    expect(call[0]).toBe('petri:model3d-open');
    expect(call[1].scenePath).toBe('model3d/runs/r1/scene.json');
    expect(call[1].meshPath).toBe('model3d/runs/r1/model.glb');
    expect(call[1].projectId).toBe('p1');
    expect(call[1].label).toContain('model.glb');
    void spec;
  });

  it('纯数据卡（metric）无跳转按钮（零行为变化）', () => {
    const spec = parseComposeSpec({
      version: 1,
      root: 'm1',
      nodes: { m1: { kind: 'metric', title: '行数', value: '42' } },
    });
    render(<ComposeCard spec={spec} conversationId="c1" />);
    expect(screen.queryByTestId('compose-open-workbench')).toBeNull();
  });
});
