import React from 'react';
import { Icon } from '@/components/icons/Icon';
import type { ComposerContextItem } from './contextItems';
import { PromptEnhanceDialog } from './PromptEnhanceDialog';
import type { PromptEnhanceContext } from '@/lib/promptEnhanceClient';

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
  const [source, setSource] = React.useState<string | null>(null);
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

  return (
    <>
      <button
        type="button"
        className="sc-access-btn"
        data-testid="prompt-enhance"
        disabled={!prompt.trim()}
        title={prompt.trim() ? '优化提示词：生成 TaskSpec 草稿，仅预览，不自动发送' : '先输入内容，再优化提示词'}
        onClick={() => setSource(prompt)}
      >
        <Icon name="sparkles" size={14} />
      </button>
      {source !== null && (
        <PromptEnhanceDialog
          prompt={source}
          context={context}
          onClose={() => setSource(null)}
          onApply={(next) => {
            onApplyText(next);
            setSource(null);
          }}
          onInsert={(original, optimized) => {
            onApplyText(`${original.trim()}\n\n${optimized}`);
            setSource(null);
          }}
        />
      )}
    </>
  );
}
