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
import { projectStreamingCompose } from './referencesStreaming';
import { GenUiCard } from './GenUiCard';
import { ComposeCard } from './compose/ComposeCard';
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
  /**
   * BLOCK-466（W11 P3）：消息是否仍在流式输出。true 时 ::compose 在 spec 完整前只出
   * 稳定占位（经 projectStreamingCompose），不泄漏原始 JSON/不闪烁；默认 false 保持
   * 既有完成态投影零行为变化。仅流式 assistant 且 content 含 compose 时由消息行开启。
   */
  streaming?: boolean;
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
  streaming = false,
}: GenUiMessageContentProps) {
  const parts = React.useMemo(
    () => (streaming
      ? projectStreamingCompose(content, true).parts
      : dedupeGenUiParts(projectGenUiReferences(content, true))),
    [content, streaming],
  );
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
        if (part.kind === 'compose') {
          // BLOCK-461（W11 双形态并存）：::compose spec 受控渲染；spec=null → ComposeCard 内降级占位
          return (
            <ComposeCard
              key={`compose-${index}`}
              spec={part.spec}
              conversationId={conversationId}
              projectId={projectId}
            />
          );
        }
        if (part.kind === 'pending') {
          // BLOCK-466（W11 P3）：流式期 ::compose spec 未完整——稳定占位，不泄漏原始 JSON、
          // 不随 delta 闪烁（身份由 index 稳定）。观感 pending_human_eye 不代签。
          return (
            <div
              key={`pending-${index}`}
              data-testid="compose-stream-pending"
              role="status"
              style={{
                margin: '10px 0',
                padding: '10px 12px',
                border: '1px dashed var(--petri-border)',
                borderRadius: 10,
                fontSize: 'var(--petri-font-size-sm, 12px)',
                color: 'var(--petri-text-muted)',
              }}
            >
              正在生成组合视图…
            </div>
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
              fontSize: 'var(--petri-font-size-sm, 12px)',
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
