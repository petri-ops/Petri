import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface BridgeProps {
  value: string;
  language?: string;
  readonly?: boolean;
  filePath: string;
  className?: string;
  onChange?: (next: string) => void;
  editorRef?: unknown;
}
const bridgeSpy = vi.fn<(props: BridgeProps) => void>();
vi.mock('@/components/editor', () => ({
  WorkspaceFilePreviewBridge: (props: BridgeProps) => {
    bridgeSpy(props);
    return <div data-testid="mock-bridge" data-readonly={String(props.readonly)} data-language={props.language ?? ''} />;
  },
}));

import { TextViewer } from './TextViewer';

afterEach(() => { cleanup(); bridgeSpy.mockClear(); });

describe('BLOCK-334 P2 Slice B TextViewer（两宿主唯一文本引擎=CodeMirror）', () => {
  it('结果壳只读形态：value/language/filePath/className/editorRef 逐项透传，readonly 标记在壳层可见', () => {
    const editorRef = { current: null };
    render(
      <TextViewer value='{"a":1}' language="json" readonly filePath="deg.json" className="host-c" editorRef={editorRef} testId="result-text-viewer" />,
    );
    expect(screen.getByTestId('result-text-viewer').getAttribute('data-readonly')).toBe('true');
    const props = bridgeSpy.mock.calls[0][0];
    expect(props.value).toBe('{"a":1}');
    expect(props.language).toBe('json');
    expect(props.readonly).toBe(true);
    expect(props.filePath).toBe('deg.json');
    expect(props.className).toBe('host-c');
    expect(props.editorRef).toBe(editorRef);
    expect(props.onChange).toBeUndefined();
  });

  it('文件宿主可写形态：readonly=false 且 onChange 透传（自动保存链不变）', () => {
    const onChange = vi.fn();
    render(<TextViewer value="hello" filePath="notes.txt" onChange={onChange} />);
    expect(screen.getByTestId('text-viewer').getAttribute('data-readonly')).toBe('false');
    const props = bridgeSpy.mock.calls[0][0];
    expect(props.readonly).toBe(false);
    expect(props.onChange).toBe(onChange);
    expect(props.language).toBeUndefined();
  });
});
