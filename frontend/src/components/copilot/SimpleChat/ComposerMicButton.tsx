/**
 * ComposerMicButton — BLOCK-519 阶段二：composer 麦克风入口。
 *
 * 点击开始录音，再点停止 → 转写文本经 onTranscript 插入输入框（不自动发送）。
 * 不支持/禁用/失败均有可见状态（aria-label/title 承载语义，图标承载形态）。
 */
import React from 'react';
import { Icon } from '@/components/icons/Icon';
import { useComposerMic } from './useComposerMic';

export interface ComposerMicButtonProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

export function ComposerMicButton({ onTranscript, disabled = false }: ComposerMicButtonProps): React.ReactElement | null {
  const mic = useComposerMic({ onTranscript, disabled });
  if (!mic.supported) return null;

  const label = mic.recording
    ? '停止录音并转写'
    : mic.busy
      ? '正在转写麦克风音频'
      : disabled
        ? '麦克风输入不可用'
        : '麦克风输入（录音转写插入输入框，不自动发送）';

  return (
    <>
      <button
        type="button"
        className={`sc-knowledge-toggle${mic.recording ? ' sc-knowledge-toggle-on' : ''}`}
        data-testid="composer-mic-toggle"
        onClick={mic.toggle}
        disabled={disabled || mic.busy}
        title={mic.error ? `麦克风失败：${mic.error}` : label}
        aria-label="麦克风输入"
        aria-pressed={mic.recording}
      >
        <Icon name={mic.recording ? 'square' : 'play'} size={14} />
      </button>
      {mic.error && (
        <span className="sc-mic-error" role="status" data-testid="composer-mic-error">{mic.error}</span>
      )}
    </>
  );
}
