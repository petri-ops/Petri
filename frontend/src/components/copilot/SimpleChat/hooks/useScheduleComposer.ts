import { useCallback, useState } from 'react';

export interface ScheduleComposerState {
  isOpen: boolean;
  prompt: string;
  open: (prompt: string) => void;
  close: () => void;
}

/** Q7 I2 — 保存 `/schedule` 的草稿 prompt，打开/关闭确认框。 */
export function useScheduleComposer(): ScheduleComposerState {
  const [prompt, setPrompt] = useState<string | null>(null);
  const open = useCallback((value: string) => setPrompt(value), []);
  const close = useCallback(() => setPrompt(null), []);
  return { isOpen: prompt !== null, prompt: prompt ?? '', open, close };
}
