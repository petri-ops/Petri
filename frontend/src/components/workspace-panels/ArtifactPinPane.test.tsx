/**
 * ArtifactPinPane 组件契约测试（BLOCK-140 P0 分屏骨架，HK-01 红绿先行）。
 *
 * 契约来源：docs/block-140-artifact-plane-split-plan.md §2 P0 + §5 D1/D2。
 *   钉住=视图级快照（D1）：pin 时刻捕获「产物名+渲染内容」（renderPreview 同一
 *   渲染路径的载荷），副栏只渲染这份快照——主区自由切换产物/版本副栏保持不变，
 *   且副栏自身零取数（不是第二数据通道）；解除钉住恢复单栏（§2 P0 ③）；
 *   副栏为 result 模式专属，mode 切到 code/compare/history 时副栏随 result 模式
 *   投影清理、不渲染（§2 P0 ④，主区投影照常在场）。
 *
 * 本文件先于组件落地（组件尚不存在 → 整文件红）；由实现步骤转绿，本文件不改。
 *
 * 契约面（./ArtifactPinPane 导出，与 ResultArtifactShell stateBlock/shellBody
 * 两个渲染分支的 mode 门控一致——副栏挂载点在 result 模式投影内）：
 *   export type ArtifactPinSnapshot = {
 *     jobId: string;
 *     artifactName: string;               // 钉住时刻的产物名（副栏识别牌）
 *     label?: string | null;
 *     viewerAdapter: ResultViewerAdapter; // 'report'|'image'|'table'|'json'|'text'|'binary'
 *     previewText: string | null;         // 钉住时刻的文本/JSON 载荷
 *     previewData: string[][] | null;     // 钉住时刻的表格载荷
 *     url: string;                        // 钉住时刻的 image/report 源地址
 *   };
 *   <ArtifactPinPane
 *     mode={ResultSurfaceMode}            // 副栏仅 'result' 在场
 *     snapshot={ArtifactPinSnapshot|null} // null = 未钉住（单栏）
 *     onUnpin?: () => void                // 「解除钉住」回调
 *   >{主区投影（children，全 mode 在场）}</ArtifactPinPane>
 * DOM 寻址面：副栏容器 data-testid="artifact-pin-pane"；解除钉住按钮 name「解除钉住」。
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ResultSurfaceMode } from '@/components/result-studio/resultSurface';

// 组件尚不存在：本 import 即红（Failed to resolve import）。实现落地后此文件转绿。
import { ArtifactPinPane, type ArtifactPinSnapshot } from './ArtifactPinPane';

const PINNED_TEXT_BODY = '钉住时刻的摘要正文：3 个群体，残差 0.02';

const textSnapshot: ArtifactPinSnapshot = {
  jobId: 'job-1',
  artifactName: 'deconvolution-summary.txt',
  label: '反卷积摘要',
  viewerAdapter: 'text',
  previewText: PINNED_TEXT_BODY,
  previewData: null,
  url: '/api/r/tools/file/job-1/deconvolution-summary.txt',
};

const tableSnapshot: ArtifactPinSnapshot = {
  jobId: 'job-1',
  artifactName: 'marker-table.csv',
  viewerAdapter: 'table',
  previewText: null,
  previewData: [
    ['gene', 'log2fc'],
    ['TP53', '2.4'],
  ],
  url: '/api/r/tools/file/job-1/marker-table.csv',
};

const imageSnapshot: ArtifactPinSnapshot = {
  jobId: 'job-1',
  artifactName: 'volcano.png',
  viewerAdapter: 'image',
  previewText: null,
  previewData: null,
  url: '/api/r/tools/file/job-1/volcano.png',
};

describe('ArtifactPinPane（BLOCK-140 P0 分屏骨架）', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let onUnpin: Mock<() => void>;

  beforeEach(() => {
    // D1：钉住=视图级快照，副栏渲染不得发起任何取数（非第二数据通道）。
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    onUnpin = vi.fn(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('①钉住态：副栏渲染快照产物名+文本内容；主区切换产物副栏不变；零取数', () => {
    const view = render(
      <ArtifactPinPane mode="result" snapshot={textSnapshot} onUnpin={onUnpin}>
        <div data-testid="main-projection">主区产物 A</div>
      </ArtifactPinPane>,
    );

    // 副栏在场，渲染的是钉住时刻捕获的产物名与内容
    const pane = screen.getByTestId('artifact-pin-pane');
    expect(within(pane).getByText('deconvolution-summary.txt')).toBeTruthy();
    expect(within(pane).getByText(PINNED_TEXT_BODY)).toBeTruthy();
    expect(screen.getByTestId('main-projection').textContent).toContain('主区产物 A');

    // 主区自由切换产物/版本：主区投影换 B，快照不变 → 副栏保持 A 的快照
    view.rerender(
      <ArtifactPinPane mode="result" snapshot={textSnapshot} onUnpin={onUnpin}>
        <div data-testid="main-projection">主区产物 B</div>
      </ArtifactPinPane>,
    );
    const paneAfterSwitch = screen.getByTestId('artifact-pin-pane');
    expect(within(paneAfterSwitch).getByText('deconvolution-summary.txt')).toBeTruthy();
    expect(within(paneAfterSwitch).getByText(PINNED_TEXT_BODY)).toBeTruthy();
    expect(screen.getByTestId('main-projection').textContent).toContain('主区产物 B');

    // 非第二数据通道：副栏渲染全程零 fetch
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('①表格快照：previewData 钉住时刻单元格渲染于副栏，不重取', () => {
    render(
      <ArtifactPinPane mode="result" snapshot={tableSnapshot} onUnpin={onUnpin}>
        <div data-testid="main-projection" />
      </ArtifactPinPane>,
    );

    const pane = screen.getByTestId('artifact-pin-pane');
    expect(within(pane).getByText('marker-table.csv')).toBeTruthy();
    expect(within(pane).getByText('log2fc')).toBeTruthy();
    expect(within(pane).getByText('TP53')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('①图片快照：钉住时刻 url 作为副栏图像源，产物名在场', () => {
    render(
      <ArtifactPinPane mode="result" snapshot={imageSnapshot} onUnpin={onUnpin}>
        <div data-testid="main-projection" />
      </ArtifactPinPane>,
    );

    const pane = screen.getByTestId('artifact-pin-pane');
    expect(within(pane).getByText('volcano.png')).toBeTruthy();
    const img = within(pane).getByRole('img');
    expect(img.getAttribute('src')).toBe(imageSnapshot.url);
  });

  it('②解除钉住：按钮回调 onUnpin；snapshot 置空恢复单栏（副栏离场、主区保留）', () => {
    const view = render(
      <ArtifactPinPane mode="result" snapshot={textSnapshot} onUnpin={onUnpin}>
        <div data-testid="main-projection">主区产物 A</div>
      </ArtifactPinPane>,
    );
    expect(screen.getByTestId('artifact-pin-pane')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '解除钉住' }));
    expect(onUnpin).toHaveBeenCalledTimes(1);

    // 宿主随 onUnpin 置空快照 → 单栏：副栏离场，主区投影照常
    view.rerender(
      <ArtifactPinPane mode="result" snapshot={null} onUnpin={onUnpin}>
        <div data-testid="main-projection">主区产物 A</div>
      </ArtifactPinPane>,
    );
    expect(screen.queryByTestId('artifact-pin-pane')).toBeNull();
    expect(screen.getByTestId('main-projection')).toBeTruthy();
  });

  it('③mode 专属：code/compare/history 副栏不渲染（主区投影照常、零取数）；result 模式在场', () => {
    const renderWith = (mode: ResultSurfaceMode) => (
      <ArtifactPinPane mode={mode} snapshot={textSnapshot} onUnpin={onUnpin}>
        <div data-testid="main-projection">主区投影（{mode}）</div>
      </ArtifactPinPane>
    );

    const view = render(renderWith('code'));
    expect(screen.queryByTestId('artifact-pin-pane')).toBeNull();
    expect(screen.getByTestId('main-projection').textContent).toContain('code');

    view.rerender(renderWith('compare'));
    expect(screen.queryByTestId('artifact-pin-pane')).toBeNull();

    view.rerender(renderWith('history'));
    expect(screen.queryByTestId('artifact-pin-pane')).toBeNull();
    // 非 result 模式副栏彻底离场，不悄悄取数
    expect(fetchSpy).not.toHaveBeenCalled();

    // mode 门控非粘性（快照清理裁决归宿主）：回到 result 且快照仍在 → 副栏在场
    view.rerender(renderWith('result'));
    expect(screen.getByTestId('artifact-pin-pane')).toBeTruthy();
  });
});
