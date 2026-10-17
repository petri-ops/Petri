/**
 * BLOCK-198 — D18「分屏对照与比例可调」的比例面机械锚。
 *
 * 缘起：`7-split-compare` 点位自 BLOCK-195 起无锚。实码核实分屏与比例可调**早已落地**
 * （`ArtifactPinPane.tsx:45-90`：`clampRatio` 20–80、localStorage 持久化、pointer 拖拽、
 * 键盘 ±5），而 `ArtifactPinPane.test.tsx`（BLOCK-140 冻结的钉住/模式契约）只断钉住与可见性
 * ——**比例可调这条行为零断言**（=有实现无断言）。
 *
 * 本文件另册新增（不改 BLOCK-140 那份冻结契约），断四件可证事实：键盘步长、上下限钳制、
 * 持久化与恢复、栅格列宽随比例变。**如实登记两点残余**（写进清单 claim，不闷声得分）：
 *  ① 分隔件是 `role="separator"` + `aria-value*`，键盘可操作却不被读屏当滑杆播报（a11y 角色
 *     该是 slider）；② `viewerRegistry.ts:63` 的 `canCompare` 已不再全 false 但**钉住入口未消费
 *     它**（`ResultArtifactShell.tsx:1019` 只 `disabled={previewLoading}`）=「canCompare→分屏」门控未接线。
 */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactPinPane, type ArtifactPinSnapshot } from './ArtifactPinPane';

const RATIO_KEY = 'petri.pinSplitRatio';

const snapshot: ArtifactPinSnapshot = {
  jobId: 'job-ratio',
  artifactName: 'marker-table.csv',
  viewerAdapter: 'table',
  previewText: null,
  previewData: [['gene', 'score'], ['TP53', '2.4']],
  url: '/api/r/tools/file/job-ratio/marker-table.csv',
};

const renderSplit = () => render(
  <ArtifactPinPane mode="result" snapshot={snapshot}>
    <div data-testid="main-projection">主区投影</div>
  </ArtifactPinPane>,
);

const divider = () => screen.getByTestId('artifact-pin-divider');
const ratioNow = () => Number(divider().getAttribute('aria-valuenow'));
const columns = () => (divider().parentElement as HTMLElement).style.gridTemplateColumns;

describe('ArtifactPinPane 分屏比例可调（D18 锚）', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
  });

  it('未持久化时缺省 60/40，且分隔件暴露可核对的取值范围', () => {
    renderSplit();
    expect(ratioNow()).toBe(60);
    expect(divider().getAttribute('aria-valuemin')).toBe('20');
    expect(divider().getAttribute('aria-valuemax')).toBe('80');
    expect(columns()).toContain('60fr');
    expect(columns()).toContain('40fr');
  });

  it('键盘 ArrowRight/ArrowLeft 以 5 为步长调整，并同步栅格列宽', () => {
    renderSplit();
    fireEvent.keyDown(divider(), { key: 'ArrowRight' });
    expect(ratioNow()).toBe(65);
    expect(columns()).toContain('65fr');
    expect(columns()).toContain('35fr');
    fireEvent.keyDown(divider(), { key: 'ArrowLeft' });
    fireEvent.keyDown(divider(), { key: 'ArrowLeft' });
    expect(ratioNow()).toBe(55);
  });

  it('比例钳在 20–80：连按不会把主区或副栏压到不可用', () => {
    renderSplit();
    for (let i = 0; i < 20; i += 1) fireEvent.keyDown(divider(), { key: 'ArrowLeft' });
    expect(ratioNow()).toBe(20);
    for (let i = 0; i < 40; i += 1) fireEvent.keyDown(divider(), { key: 'ArrowRight' });
    expect(ratioNow()).toBe(80);
    expect(columns()).toContain('80fr');
  });

  it('调整后写持久化槽，下次挂载从上次比例恢复（不是每次回到缺省）', () => {
    renderSplit();
    fireEvent.keyDown(divider(), { key: 'ArrowLeft' });
    expect(ratioNow()).toBe(55);
    expect(localStorage.getItem(RATIO_KEY)).toBe('55');
    cleanup();

    localStorage.setItem(RATIO_KEY, '34');
    renderSplit();
    expect(ratioNow()).toBe(34);
    expect(columns()).toContain('34fr');
  });

  it('持久化槽被写坏（越界/非数）时回落缺省，不把 NaN 塞进栅格', () => {
    localStorage.setItem(RATIO_KEY, '999');
    renderSplit();
    expect(ratioNow()).toBe(60);
    localStorage.setItem(RATIO_KEY, 'not-a-number');
    cleanup();
    renderSplit();
    expect(ratioNow()).toBe(60);
    expect(columns()).not.toContain('NaN');
  });
});
