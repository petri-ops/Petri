import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HtmlViewer } from './HtmlViewer';

afterEach(cleanup);

describe('BLOCK-334 P2 HtmlViewer（两宿主唯一 HTML viewer）', () => {
  it('宿主声明的 sandbox 与类名逐字透传（壳=allow-same-origin / 工作区文件=allow-scripts 且 opaque origin）', () => {
    const { rerender } = render(
      <HtmlViewer src="http://mock/report.html" title="报告" sandbox="allow-same-origin" className="shell-c" testId="html-c" />,
    );
    let frame = document.querySelector('iframe[data-testid="html-c"]') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
    expect(frame.className).toBe('shell-c');
    // 工作区文件：静态 html 与交互式 html（3D/WebGL）共用，需脚本权限；
    // 只放行 allow-scripts，无 allow-same-origin → opaque origin 隔离。
    rerender(
      <HtmlViewer src="http://mock/page.html?theme=dark" title="页面" sandbox="allow-scripts" testId="html-c" />,
    );
    frame = document.querySelector('iframe[data-testid="html-c"]') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(frame.getAttribute('src')).toContain('theme=dark');
  });
});
