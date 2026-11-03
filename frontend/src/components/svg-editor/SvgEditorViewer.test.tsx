/**
 * BLOCK-342 W1 — 编辑器宿主三态与保存入口（组件级，后端与文件读取全桩）。
 *
 * 只钉机制：载入成功渲染画布/图层/保存禁用；载入失败三态如实 + 重试；危险面脱敏提示；
 * 保存按钮随 pendingOps 解锁（保存链路本身由后端契约测试与实机 flow 覆盖）。
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const inspectSvgFile = vi.fn((..._args: unknown[]): Promise<unknown> => Promise.resolve(undefined as unknown));
const editSvgFile = vi.fn((..._args: unknown[]): Promise<unknown> => Promise.resolve(undefined as unknown));

vi.mock('@/lib/svgEditClient', () => ({
  inspectSvgFile: (...args: unknown[]): Promise<unknown> => inspectSvgFile(...args),
  editSvgFile: (...args: unknown[]): Promise<unknown> => editSvgFile(...args),
  inkscapeStatus: (): Promise<unknown> => Promise.resolve({ available: false, bin: null, source: null, hint: '未检测到 Inkscape（测试）' }),
  inkscapeAction: (): Promise<unknown> => Promise.resolve({ ok: true, action: 'union' }),
  SvgEditError: class SvgEditError extends Error {
    code: string;

    requireAck: boolean;

    constructor(code: string, message: string, requireAck = false) {
      super(message);
      this.code = code;
      this.requireAck = requireAck;
    }
  },
}));

import { SvgEditorViewer } from './SvgEditorViewer';

const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg"><g id="plot"><text id="t">x</text></g></svg>';

const INSPECT = {
  ok: true as const,
  filePath: 'figures/plot.svg',
  sha256: 'a'.repeat(64),
  sizeBytes: SVG_TEXT.length,
  rootTag: 'svg',
  total: 3,
  returned: 3,
  truncated: false,
  elements: [
    { path: [], tag: 'svg', attrCount: 1 },
    { path: [0], tag: 'g', id: 'plot', attrCount: 1 },
    { path: [0, 0], tag: 'text', id: 't', attrCount: 1, textPreview: 'x' },
  ],
  unsafe: { script: false, foreignObject: false, eventAttrs: 0, dangerousHref: 0, any: false },
  description: 'plot.svg：<svg> 共 3 个元素',
};

function stubFetch(body: string, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  }));
}

describe('BLOCK-342 W1 SvgEditorViewer', () => {
  beforeEach(() => {
    inspectSvgFile.mockReset();
    editSvgFile.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('载入成功：渲染画布/图层树，保存按钮初始禁用（零操作零 diff）', async () => {
    inspectSvgFile.mockResolvedValue(INSPECT);
    stubFetch(SVG_TEXT);
    render(<SvgEditorViewer projectId="p1" filePath="figures/plot.svg" name="plot.svg" />);

    await waitFor(() => expect(screen.getByTestId('svg-editor-canvas')).toBeTruthy());
    // 收起态只渲染图标按钮（用户裁决：不要竖排文字）
    const expandLayersBtn = document.querySelector('[data-action="expand-layers"]');
    expect(expandLayersBtn?.getAttribute('title')).toContain('展开图层');
    const save = screen.getByTestId<HTMLButtonElement>("svg-editor-save");
    expect(save.disabled).toBe(true);
    expect(screen.getByTestId('svg-editor-zoom').textContent).toBe('100%');
    expect(inspectSvgFile).toHaveBeenCalledWith({ projectId: 'p1', path: 'figures/plot.svg' });
  });

  it('载入失败：三态如实 + 重试入口', async () => {
    inspectSvgFile.mockRejectedValue(new Error('项目不存在'));
    render(<SvgEditorViewer projectId="p1" filePath="ghost.svg" />);

    await waitFor(() => expect(screen.getByTestId('svg-editor-state').textContent).toContain('项目不存在'));
    expect(screen.getByTestId('svg-editor-state').textContent).toContain('SVG 编辑器不可用');
    expect(screen.queryByTestId('svg-editor-canvas')).toBeNull();
  });

  it('危险面：视图脱敏提示可见，真值不删（提示文案明确边界）', async () => {
    inspectSvgFile.mockResolvedValue({
      ...INSPECT,
      unsafe: { script: true, foreignObject: false, eventAttrs: 1, dangerousHref: 0, any: true },
    });
    stubFetch('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect id="r" onclick="x()"/></svg>');
    render(<SvgEditorViewer projectId="p1" filePath="dirty.svg" />);

    // 图层栏（含脱敏提示）默认收起：先展开再断言
    await waitFor(() => expect(screen.getByTestId('svg-editor-canvas')).toBeTruthy());
    const expandLayers = document.querySelector<HTMLButtonElement>("[data-action=\"expand-layers\"]");
    expect(expandLayers).toBeTruthy();
    expandLayers?.click();
    await waitFor(() => expect(screen.getByTestId('svg-editor-sanitized')).toBeTruthy());
    expect(screen.getByTestId('svg-editor-sanitized').textContent).toContain('视图已脱敏');
    expect(screen.getByTestId('svg-editor-canvas').innerHTML.toLowerCase()).not.toContain('<script');
  });
});
