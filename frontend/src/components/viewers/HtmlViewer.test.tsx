import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HtmlViewer } from './HtmlViewer';

afterEach(cleanup);

describe('BLOCK-334 P2 HtmlViewer（两宿主唯一 HTML viewer）', () => {
  it('宿主声明的 sandbox 与类名逐字透传（壳=allow-same-origin / 文件=全封）', () => {
    const { rerender } = render(
      <HtmlViewer src="http://mock/report.html" title="报告" sandbox="allow-same-origin" className="shell-c" testId="html-c" />,
    );
    let frame = document.querySelector('iframe[data-testid="html-c"]') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
    expect(frame.className).toBe('shell-c');
    rerender(
      <HtmlViewer src="http://mock/page.html?theme=dark" title="页面" sandbox="" testId="html-c" />,
    );
    frame = document.querySelector('iframe[data-testid="html-c"]') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('src')).toContain('theme=dark');
  });
});
