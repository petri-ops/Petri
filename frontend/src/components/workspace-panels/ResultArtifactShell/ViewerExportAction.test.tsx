/**
 * ViewerExportAction 契约测试（BLOCK-151 B 轨·审视吸收二波，红绿先行）。
 *
 * 缺口来源（A4 面·viewer 能力声明一致性）：viewerRegistry 档案表对 markdown/pdf
 * 声明 canExport=true（BLOCK-142 定值「原文可导出」），但该声明位此前零消费——
 * Shell 挂载面（renderPreview markdown/spreadsheet/pdf 三分支）对这两类 adapter
 * 不提供任何打开/导出出口（兜底分支的「打开或下载原文件」只服务落兜底的
 * adapter）。本组件是声明位的唯一消费面：canExport=true 才渲染「打开原文件」
 * 出口，false 一律不渲染；取值必须来自注册表档案表（不复制布尔）。
 *
 * DOM 寻址面：role="link" name「打开原文件」；href=产物原文件 URL。
 */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ViewerExportAction } from './ViewerExportAction';

afterEach(cleanup);

describe('ViewerExportAction（BLOCK-151 B 轨：canExport 声明位接线）', () => {
  it('canExport=true 档案（markdown）渲染「打开原文件」出口，href=产物 URL', () => {
    render(
      <ViewerExportAction adapter="markdown" url="/api/r/tools/file/job-1/notes.md" />,
    );
    const link = screen.getByRole('link', { name: '打开原文件' });
    expect(link.getAttribute('href')).toBe('/api/r/tools/file/job-1/notes.md');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
  });

  it('pdf 同样出口；url 缺位不渲染（无出口可给）', () => {
    const withUrl = render(
      <ViewerExportAction adapter="pdf" url="/api/r/tools/file/job-1/paper.pdf" />,
    );
    expect(screen.getByRole('link', { name: '打开原文件' })).toBeTruthy();
    withUrl.unmount();

    render(<ViewerExportAction adapter="pdf" url="" />);
    expect(screen.queryByRole('link', { name: '打开原文件' })).toBeNull();
  });

  it('canExport=false 档案一律不渲染——注册表声明位是唯一闸门', () => {
    const nonExportable = ['report', 'image', 'table', 'json', 'text', 'binary', 'spreadsheet'] as const;
    for (const adapter of nonExportable) {
      const view = render(<ViewerExportAction adapter={adapter} url="/api/r/tools/file/job-1/x" />);
      expect(screen.queryByRole('link', { name: '打开原文件' })).toBeNull();
      view.unmount();
    }
  });
});
