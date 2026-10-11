/**
 * frontend/src/components/copilot/gen-ui/GenUiMessageContent.tsx
 *
 * BLOCK-166 [A→B 层粘合]：助手已完结消息的 Gen UI 投影。
 * 快路径：无 ui/pending/invalid 片段时原样走 CopilotMarkdown（既有消息零行为变化）；
 * 命中时分段渲染——text 段仍走 CopilotMarkdown，ui 段渲染 GenUiCard，
 * invalid 段渲染占位（流式 pending 段由 SimpleChat 既有 pending 语义整体隐藏，
 * 本组件只在 completed=true 时启用）。
 */

import React from 'react';
import { CopilotMarkdown } from '../copilotMarkdown';
import type { FileReferenceClickDetail, ExtractContext } from '@/lib/chat-file-references';
import { dedupeGenUiParts, projectGenUiReferences } from './references';
import { GenUiCard } from './GenUiCard';
import type { GenUiFollowUpRequest, GenUiFollowUpResult } from './followUp';

interface GenUiMessageContentProps {
  content: string;
  projectId: string;
  conversationId: string | null;
  rowKey: string;
  onFileReferenceClick: (detail: FileReferenceClickDetail) => void;
  resolveContext: ExtractContext | null;
  resolveNonce: number;
  highlightCode?: ((code: string, language: string | undefined) => React.ReactNode) | undefined;
  /** P2 follow-up 宿主回调（SimpleChat 输入绑定执行）。 */
  onFollowUp?: (request: GenUiFollowUpRequest) => Promise<GenUiFollowUpResult>;
}

export function GenUiMessageContent({
  content,
  projectId,
  conversationId,
  rowKey,
  onFileReferenceClick,
  resolveContext,
  resolveNonce,
  highlightCode,
  onFollowUp,
}: GenUiMessageContentProps) {
  const parts = React.useMemo(() => dedupeGenUiParts(projectGenUiReferences(content, true)), [content]);
  const hasGenUi = parts.some((part) => part.kind !== 'text');

  const renderMarkdown = (text: string, key: string) => (
    <CopilotMarkdown
      key={key}
      text={text}
      onFileReferenceClick={onFileReferenceClick}
      resolveContext={resolveContext}
      resolveNonce={resolveNonce}
      highlightCode={highlightCode}
    />
  );

  if (!hasGenUi) return renderMarkdown(content, 'md');

  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === 'text') return renderMarkdown(part.text, `md-${index}`);
        if (part.kind === 'ui') {
          return (
            <GenUiCard
              key={`ui-${index}-${part.reference.path}`}
              cardKey={`${rowKey}:${index}`}
              reference={part.reference}
              projectId={projectId}
              conversationId={conversationId}
              onFollowUp={onFollowUp}
            />
          );
        }
        return (
          <div
            key={`invalid-${index}`}
            data-testid="gen-ui-invalid"
            style={{
              margin: '10px 0',
              padding: '10px 12px',
              border: '1px dashed var(--petri-border)',
              borderRadius: 10,
              fontSize: 13,
              color: 'var(--petri-text-muted)',
            }}
          >
            可视化指令参数无效，已跳过渲染
          </div>
        );
      })}
    </>
  );
}
