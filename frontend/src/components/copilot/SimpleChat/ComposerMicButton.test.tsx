/**
 * 试用反馈⑨（owner msg_91d38f2e2664）HK-01：麦克风按钮图标语义与状态。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComposerMicButton } from './ComposerMicButton';

const micState = { supported: true, recording: false, busy: false, error: '', toggle: vi.fn() };
vi.mock('./useComposerMic', () => ({ useComposerMic: () => micState }));
afterEach(() => { cleanup(); micState.toggle.mockReset(); micState.recording = false; micState.busy = false; micState.error = ''; });

describe('ComposerMicButton（试用反馈⑨图标修正）', () => {
  it('空闲态渲染 mic 图标（不是 play 三角），aria 语义完整', () => {
    const { container } = render(<ComposerMicButton onTranscript={() => {}} />);
    const btn = screen.getByTestId('composer-mic-toggle');
    expect(btn.getAttribute('aria-label')).toBe('麦克风输入');
    expect(container.querySelector('[data-icon="mic"]') || container.querySelector('svg')).toBeTruthy();
    fireEvent.click(btn);
    expect(micState.toggle).toHaveBeenCalledTimes(1);
  });

  it('录音中切 square 停止图标且 aria-pressed=true', () => {
    micState.recording = true;
    render(<ComposerMicButton onTranscript={() => {}} />);
    expect(screen.getByTestId('composer-mic-toggle').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '麦克风输入' }).getAttribute('title')).toContain('停止录音');
  });
});
