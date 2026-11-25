/**
 * useComposerMic — BLOCK-519 阶段二：composer 麦克风输入 hook。
 *
 * MediaRecorder 录音 → WAV Blob → POST /api/speech/transcribe（复用现有 ASR
 * provider 链）→ 转写文本经 onTranscript 插入输入框。动作语义：只插文本，
 * **不自动发送**（加入上下文 ≠ 立即执行）。失败经 error 诚实上报，不插入伪文本。
 *
 * 零新依赖：浏览器原生 MediaRecorder；后端 REST 走既有 getPlatformApiPrefix/authHeader。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

export interface UseComposerMicOptions {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

export interface ComposerMicState {
  recording: boolean;
  busy: boolean;
  error: string | null;
  supported: boolean;
  toggle: () => void;
  stop: () => void;
}

export function useComposerMic({ onTranscript, disabled = false }: UseComposerMicOptions): ComposerMicState {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);

  const supported = typeof navigator !== 'undefined'
    && typeof navigator.mediaDevices?.getUserMedia === 'function'
    && typeof MediaRecorder !== 'undefined';

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    recorderRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (disabled || busy || !supported) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        if (blob.size === 0) { setRecording(false); return; }
        setBusy(true);
        try {
          const token = getToken();
          const res = await fetch(`${getPlatformApiPrefix()}/speech/transcribe?filename=mic.webm`, {
            method: 'POST',
            headers: {
              'Content-Type': rec.mimeType || 'audio/webm',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: blob,
          });
          const data = await res.json().catch(() => ({})) as { status?: string; text?: string; message?: string; error?: string };
          if (!res.ok || !data || data.status !== 'ok' || typeof data.text !== 'string' || data.text.length === 0) {
            setError(data?.message || data?.error || '转写失败（未获得文本）');
            return;
          }
          onTranscriptRef.current(data.text);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
          setRecording(false);
        }
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '麦克风不可用');
      setRecording(false);
    }
  }, [busy, disabled, supported]);

  const toggle = useCallback(() => {
    if (recording || recorderRef.current) stop();
    else void start();
  }, [recording, start, stop]);

  useEffect(() => () => stop(), [stop]);

  return { recording, busy, error, supported, toggle, stop };
}
