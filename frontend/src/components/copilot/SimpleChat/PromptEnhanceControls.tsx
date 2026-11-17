import React from 'react';
import { Icon } from '@/components/icons/Icon';
import type { ComposerContextItem } from './contextItems';
import { enhancePrompt, type PromptEnhanceContext } from '@/lib/promptEnhanceClient';

export function PromptEnhanceControls({
  prompt,
  hasProject,
  contextItems,
  onApplyText,
}: {
  prompt: string;
  hasProject: boolean;
  contextItems: ComposerContextItem[];
  onApplyText: (next: string) => void;
}): React.ReactElement {
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const requestRef = React.useRef(0);
  const context = React.useMemo<PromptEnhanceContext>(() => ({
    workspaceLabel: hasProject ? '当前项目' : '全局会话',
    surface: 'conversation',
    taskTypeHint: 'general',
    items: contextItems.map((item) => ({
      kind: item.kind,
      label: item.label,
      source: item.source,
    })),
  }), [contextItems, hasProject]);

  const run = React.useCallback(async () => {
    const original = prompt.trim();
    if (!original || busy) return;
    const requestId = ++requestRef.current;
    setBusy(true);
    setNotice('正在优化提示词…');
    try {
      const result = await enhancePrompt({ prompt: original, context, mode: 'quick' });
      if (requestId !== requestRef.current) return;
      const optimized = String(result.optimizedPrompt || '').trim();
      if (!optimized) throw new Error('model_output_empty');
      onApplyText(optimized);
      setNotice('已优化并覆盖原稿');
    } catch (error) {
      if (requestId !== requestRef.current) return;
      const code = error instanceof Error ? error.message : 'prompt_enhance_failed';
      setNotice(`优化失败：${code}。原稿未修改。`);
    } finally {
      if (requestId === requestRef.current) setBusy(false);
    }
  }, [busy, context, onApplyText, prompt]);

  return (
    <>
      <button
        type="button"
        className="sc-access-btn"
        data-testid="prompt-enhance"
        disabled={!prompt.trim() || busy}
        title={prompt.trim() ? '优化提示词：生成后直接覆盖输入框（不自动发送）' : '先输入内容，再优化提示词'}
        onClick={() => void run()}
      >
        <Icon name="sparkles" size={14} />
      </button>
      {notice && <span role="status" data-testid="prompt-enhance-status" className="sc-hint">{notice}</span>}
    </>
  );
}
