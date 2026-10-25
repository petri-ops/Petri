// BLOCK-154 波次 3 — SimpleChat 消息行组件抽取（渲染边界 memo 化）。
//
// 背景（现状核实后下行范围）：BLOCK-95 B2 已有后端窗口化历史分页（older.windowOffset），
// 「全量渲染无分页」前提不成立；真实热点=流式每个 delta 经 conversationRunStore 通知
// SimpleChat 整体重渲染 → displayMessages.map 对全部历史行重走 JSX + CopilotMarkdown
// 重解析。displayMessages 派生链已保历史消息对象引用恒定（buildBaseDisplayMessages
// slice+尾替换），故行级 React.memo 可精确跳过未变行——本文件即该边界。
//
// 语义守约：JSX 与拆分前 SimpleChat.tsx 行内 map 逐行一致（含 topicShift 分隔、
// timeline renderProgress 闭包、错误/续跑/总结重试 IIFE、操作行）；唯一刻意差异=
// 冷却计时用父级采样的 cooldownNow（retryTick 变化时刷新）替代逐渲染 Date.now()，
// tick 调度点（minUntil）不变，标签刷新精度等价。
//
// memo 契约（SimpleChatMessageRow.test.tsx 锁定）：相同 props 重渲染必须 bail-out
// （子组件不重执行）；m 对象身份变化必须重渲染。父级传入的回调/记录身份必须跨
// 流式 tick 恒定（现有 hooks 均满足；新增调用方若传入不稳定回调，memo 退化为
// 现状行为，无正确性风险）。
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/icons/Icon';
import { HighlightedCode } from '@/components/ui/CodeHighlight';
import { CopilotMarkdown } from '../copilotMarkdown';
import { ConversationTimeline } from '../ConversationTimeline';
import type { ConversationSegment } from '../conversationSegments';
import { MessageMeta, MessageTime } from './helpers';
import { LoopStatusPanel } from './LoopStatusPanel';
import { AgentProgressPendingRow } from './AgentProgress';
import { ErrorBanner } from './ErrorBanner';
import { ResumePrompt } from './ResumePrompt';
import { ResultEditProgressList } from './ResultEditProgressList';
import { AssistantResultNodes } from '../extraRenderers';
import { GenUiMessageContent } from '../gen-ui/GenUiMessageContent';
import type { GenUiFollowUpRequest, GenUiFollowUpResult } from '../gen-ui/followUp';
import { resumeInterruptedConversation } from '../conversationRunStore';
import type { SimpleMessage } from './types';
import type { ExtractContext, FileReferenceClickDetail } from '@/lib/chat-file-references';
import type { FormattedError } from '../useErrorFormatter';
import { parseInlineAttachments, workspaceFileUrl, type InlineAttachmentImage } from './attachmentInline';
import { ImagePreviewModal } from './ImagePreviewModal';
import { MessageStatsPanel } from './MessageStatsPanel';
// BLOCK-246 C4 — 动作注册表（复制/重新生成/分支/加入上下文/评价）
import { buildMessageActions, polishPrompt, selectFollowupPrompts, type MessageActionId, type MessageRatingValue } from './messageActions';

export interface SimpleChatMessageRowProps {
  m: SimpleMessage;
  /** 行 React key（复制按钮的 copiedMessageKey 判定用），由父级按既有公式派生。 */
  messageKey: string;
  isTopicShiftStart: boolean;
  topicShiftReason: string;
  /** 该消息的时间线分段（父级 WeakMap 缓存，消息对象身份不变则引用不变）。 */
  segments: ConversationSegment[];
  streaming: boolean;
  /**
   * BLOCK-171 CP-1 — 运行簇取消（宿主提供，POST task/:taskId/tool-cancel）。
   * 宿主侧 useCallback 稳定标识（不破坏行级 memo）；不传=零变化。
   */
  onCancelTools?: (callIds: string[]) => void;
  settledContext: ExtractContext | null;
  resolveNonce: number;
  extraRenderersFlag: boolean;
  conversationId: string | null;
  projectId: string;
  copiedMessageKey: string | null;
  forkingAtIndex: number | null;
  /** older.windowOffset + index（分支终点绝对下标，父级计算）。 */
  forkAbsoluteIndex: number;
  summaryRetryState: Record<string, 'running' | 'done'>;
  summaryRetryErrors: Record<string, string>;
  summaryRetryAttempts: Record<string, number>;
  summaryRetryCooldownUntil: Record<string, number>;
  /** 冷却计时采样点（父级随 retryTick 刷新；替代逐渲染 Date.now()）。 */
  cooldownNow: number;
  maxSummaryRetries: number;
  formatError: (error: Error | string) => FormattedError;
  getTechnicalDetails: (error: Error | string) => string | undefined;
  // void | Promise<void>：调用方多为 hook 的 async 回调；行内统一 `void fn()` 消费，
  // 类型放宽亦规避 no-misused-promises 对「Promise 传 void 属性」的误报。
  onFileReferenceClick: (detail: FileReferenceClickDetail) => void;
  /** P2 follow-up 宿主回调（SimpleChat 输入绑定执行）。 */
  onGenUiFollowUp?: (request: GenUiFollowUpRequest) => Promise<GenUiFollowUpResult>;
  onCopyMessage: (messageKey: string, content: string) => void | Promise<void>;
  onRegenerate: () => void | Promise<void>;
  /** BLOCK-178 P0 — 用户消息编辑重发（仅历史消息由父层给值；run 投影件/流式期=undefined）。 */
  onEditUserMessage?: (m: SimpleMessage) => void;
  onForkAt: (absoluteIndex: number) => void | Promise<void>;
  onRetrySummary: (toolJobId: string) => void | Promise<void>;
  /** BLOCK-246 C4 — 把这条回复作为上下文引用进 composer（不传 = 不显示该动作）。 */
  onQuoteToContext?: (messageKey: string, content: string) => void;
  /** BLOCK-246 C4 — 赞/踩（不传 = 不显示评价动作）。 */
  onRateMessage?: (messageKey: string, rating: MessageRatingValue) => void;
  /** BLOCK-259 C14 — 润色/追问模板填入输入框（不传 = 不显示这两个动作）。 */
  onInsertComposerText?: (text: string) => void;
  /** 当前评价（受控；null = 未评价）。 */
  messageRating?: MessageRatingValue | null;
}

export const SimpleChatMessageRow = React.memo(function SimpleChatMessageRow({
  onCancelTools,
  m,
  messageKey,
  isTopicShiftStart,
  topicShiftReason,
  segments,
  streaming,
  settledContext,
  resolveNonce,
  extraRenderersFlag,
  conversationId,
  projectId,
  copiedMessageKey,
  forkingAtIndex,
  forkAbsoluteIndex,
  summaryRetryState,
  summaryRetryErrors,
  summaryRetryAttempts,
  summaryRetryCooldownUntil,
  cooldownNow,
  maxSummaryRetries,
  formatError,
  getTechnicalDetails,
  onFileReferenceClick,
  onGenUiFollowUp,
  onCopyMessage,
  onRegenerate,
  onEditUserMessage,
  onForkAt,
  onRetrySummary,
  onQuoteToContext,
  onRateMessage,
  onInsertComposerText,
  messageRating = null,
}: SimpleChatMessageRowProps): React.ReactElement {
  // BLOCK-150 加映（UI-477）— 用户消息图片附件内联渲染：图片附件行抽成 <img>
  //（经 /file 端点按路径取图），不再停留为「[附件: 路径]」文本行。
  const inlineImages = m.role === 'user' ? parseInlineAttachments(m.content || '') : { text: '', images: [] };
  // UI-477 加映 — 点击放大（复用 ImagePreviewModal）；悬挂式小图不占正文主区。
  const [zoomedImage, setZoomedImage] = useState<InlineAttachmentImage | null>(null);
  // BLOCK-255 C4 — 本条统计面板开合（行内状态；不污染父级 memo props）。
  const [statsOpen, setStatsOpen] = useState(false);
  // BLOCK-259 C14 — 常用追问 chips 开合（本地固定模板，不触发模型调用）。
  const [followupsOpen, setFollowupsOpen] = useState(false);
  const followupPrompts = selectFollowupPrompts(m.content);
  const statsPanelId = React.useId();
  // BLOCK-246 C4 — 动作来自注册表；宿主没给回调的动作不渲染（不留死按钮）。
  const actions = buildMessageActions({
    role: m.role === 'user' ? 'user' : 'assistant',
    hasContent: Boolean(m.content),
    pending: Boolean(m.pending),
    streaming,
    forking: forkingAtIndex === forkAbsoluteIndex,
    copied: copiedMessageKey === messageKey,
    rating: messageRating,
    statsOpen,
  }).filter((action) => {
    if (action.id === 'edit') return Boolean(onEditUserMessage);
    if (action.id === 'quote-context') return Boolean(onQuoteToContext);
    if (action.id === 'rate-up' || action.id === 'rate-down') return Boolean(onRateMessage);
    if (action.id === 'polish' || action.id === 'suggest-followups') return Boolean(onInsertComposerText);
    return true;
  });
  const runAction = (id: MessageActionId) => {
    if (id === 'edit') onEditUserMessage?.(m);
    else if (id === 'copy') void onCopyMessage(messageKey, m.content);
    else if (id === 'regenerate') void onRegenerate();
    else if (id === 'fork') void onForkAt(forkAbsoluteIndex);
    else if (id === 'quote-context') onQuoteToContext?.(messageKey, m.content);
    else if (id === 'stats') setStatsOpen((open) => !open);
    else if (id === 'polish') onInsertComposerText?.(polishPrompt(m.content));
    else if (id === 'suggest-followups') setFollowupsOpen((open) => !open);
    else if (id === 'rate-up') onRateMessage?.(messageKey, 'up');
    else if (id === 'rate-down') onRateMessage?.(messageKey, 'down');
  };
  const actionBar = actions.length === 0 ? null : (
    <div className={`sc-msg-actions${statsOpen ? ' sc-msg-actions-open' : ''}`}>
      {actions.map((action) => (
        <React.Fragment key={action.id}>
          <button
            type="button"
            className="sc-msg-action"
            onClick={() => runAction(action.id)}
            disabled={action.disabled}
            title={action.title}
            aria-label={action.title}
            aria-pressed={action.pressed}
            aria-expanded={action.id === 'stats' ? statsOpen : action.id === 'suggest-followups' ? followupsOpen : undefined}
            aria-controls={action.id === 'stats' && statsOpen ? statsPanelId : undefined}
            data-testid={action.id === 'edit' ? 'msg-edit-user' : `msg-action-${action.id}`}
          >
            <Icon name={action.icon} size={14} />
            {action.label}
          </button>
          {action.dividerAfter && <span className="sc-msg-action-divider" aria-hidden="true" />}
        </React.Fragment>
      ))}
      <MessageTime ts={m.ts} />
    </div>
  );
  return (
    <>
      {isTopicShiftStart && (
        <div className="sc-topic-shift" role="separator" aria-label="话题转换">
          <Icon name="layers" size={13} />
          <span className="sc-topic-shift-label">话题转换{topicShiftReason ? ` · ${topicShiftReason}` : ''}</span>
        </div>
      )}
      <div className={`sc-msg sc-msg-${m.role}`}>
        <div className="sc-msg-avatar">
          {m.role === 'user' ? (
            <Icon name="user" size={16} />
          ) : (
            <Icon name="cpu" size={16} />
          )}
        </div>
        <div className="sc-msg-body">
          {/* BLOCK-107 P1c — 时间线化（D1=c）：思考节点与工具簇按 iteration
              交错排列，取代「一个摘要条收编全部工具、思考内嵌其中」。narrative
              仍由下方正文位渲染，本组件不重复产出（见 ConversationTimeline 文件头）。
              P2c（D5）：阶段进度作为独立分段上轴、插在对应工具簇之后，
              UI-305 的两条语义（首条=意图故省略、运行中补标记）在此判定。 */}
          <ConversationTimeline
            segments={segments}
            runActive={Boolean(m.pending)}
            onCancelTools={onCancelTools}
            renderProgress={(segment, meta) => {
              // BLOCK-108 P2 — 过渡叙述正文式渲染（Qoder 形态「模型说话 →
              // 模型做事」）：全部显示、含首条（UI-305「首条意图省略」在时间线
              // 呈现上被取代，block-108 plan §7.2）；纯文本 pre-wrap，文件引用
              // 链接化随最终正文保留、过渡段不做。
              const text = segment.content.trim();
              const transition = text ? (
                <div className="sc-timeline-transition-text">{text}</div>
              ) : null;
              const runningMarker = meta.isLast && m.pending
                ? <AgentProgressPendingRow />
                : null;
              if (!transition && !runningMarker) return null;
              return <>{transition}{runningMarker}</>;
            }}
          />
          {m.role === 'assistant' && <MessageMeta modelName={m.modelName} />}
          {m.role === 'assistant' && m.loop && m.loop.loopRunId && (
            <LoopStatusPanel loop={m.loop} pending={Boolean(m.pending)} />
          )}
          {m.resultEditProgress && m.resultEditProgress.length > 0 && (
            <ResultEditProgressList events={m.resultEditProgress} />
          )}
          {extraRenderersFlag && m.resultNodes && m.resultNodes.length > 0 && (
            <AssistantResultNodes nodes={m.resultNodes} />
          )}
          {m.role === 'assistant' && m.modelFallbackNotice && (
            <div className="sc-msg-fallback-notice" role="status">
              <Icon name="info" size={14} />
              {m.modelFallbackNotice}
            </div>
          )}
          {/* BLOCK-166：assistant 已完结且非流式消息走 Gen UI 投影（无指令时快路径
              等价原 CopilotMarkdown，零行为变化）；其余（user/流式/pending）原样。 */}
          {m.role === 'assistant' && !m.pending && !streaming && m.content ? (
            <GenUiMessageContent
              content={m.content}
              projectId={projectId}
              conversationId={conversationId}
              rowKey={messageKey}
              onFileReferenceClick={onFileReferenceClick}
              onFollowUp={onGenUiFollowUp}
              resolveContext={settledContext}
              resolveNonce={resolveNonce}
              highlightCode={m.role === 'assistant' ? ((code, language) => (
                <HighlightedCode code={code} language={language} />
              )) : undefined}
            />
          ) : (
          <CopilotMarkdown
            text={m.role === 'user' && inlineImages.images.length > 0
              ? (inlineImages.text || m.statusMessage || (m.pending ? '…' : ''))
              : (m.content || m.statusMessage || (m.pending ? '…' : ''))}
            onFileReferenceClick={onFileReferenceClick}
            resolveContext={m.pending || (m.role === 'assistant' && streaming) ? null : settledContext}
            resolveNonce={resolveNonce}
            highlightCode={m.role === 'assistant' ? ((code, language) => (
              <HighlightedCode code={code} language={language} />
            )) : undefined}
          />
          )}
          {m.role === 'user' && inlineImages.images.length > 0 && (
            <div className="sc-msg-inline-images">
              {inlineImages.images.map((img) => (
                <button
                  key={img.path}
                  type="button"
                  className="sc-msg-inline-image-btn"
                  onClick={() => setZoomedImage(img)}
                  aria-label={`放大查看 ${img.name}`}
                  title="点击放大"
                >
                  <img
                    className="sc-msg-inline-image"
                    src={workspaceFileUrl(projectId, img.path)}
                    alt={img.name}
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          )}
          {m.role === 'user' && actionBar}

          {zoomedImage && createPortal(
            <ImagePreviewModal
              attachment={{
                id: `inline-${zoomedImage.path}`,
                name: zoomedImage.name,
                type: 'image/png',
                size: 0,
                dataUrl: workspaceFileUrl(projectId, zoomedImage.path),
                previewUrl: workspaceFileUrl(projectId, zoomedImage.path),
              }}
              onClose={() => setZoomedImage(null)}
            />,
            document.body,
          )}
          {m.error && m.role === 'assistant' && (() => {
            // UI-AGENTWB-### / chat-error-rendering: prefer the
            // raw stack captured by conversationRunStore.finish;
            // fall back to m.content (legacy: Error instance
            // passed through). formatError still classifies for
            // userMessage + severity.
            const formatted = formatError(m.content);
            const techDetails = m.technicalDetails || getTechnicalDetails(m.content);
            return (
              <ErrorBanner
                message={formatted.userMessage}
                severity={formatted.severity}
                showDetails={formatted.showDetails}
                technicalDetails={techDetails}
              />
            );
          })()}
          {/* BLOCK-38 P2 / UI-275 — 仅服务中断任务显示「继续执行」（非中断失败诚实走 retry 链路） */}
          {conversationId && m.role === 'assistant' && m.error && m.resumable && m.taskId && (
            <ResumePrompt
              taskId={m.taskId}
              onConfirm={async () => {
                await resumeInterruptedConversation(conversationId, projectId);
              }}
            />
          )}
          {m.role === 'assistant' && m.summaryUnavailable && m.retryToolJobId && summaryRetryState[m.retryToolJobId] !== 'done' && (() => {
            const tj = m.retryToolJobId;
            const attempts = summaryRetryAttempts[tj] ?? 0;
            const cooling = cooldownNow < (summaryRetryCooldownUntil[tj] ?? 0);
            const exhausted = attempts >= maxSummaryRetries;
            const running = summaryRetryState[tj] === 'running';
            if (exhausted) {
              return (
                <div className="sc-msg-actions sc-msg-actions-summary">
                  <span className="sc-msg-action-error">已达重试上限，请稍后再试</span>
                </div>
              );
            }
            const remaining = cooling ? Math.max(0, Math.ceil((summaryRetryCooldownUntil[tj] - cooldownNow) / 1000)) : 0;
            return (
              <div className="sc-msg-actions sc-msg-actions-summary">
                <button
                  type="button"
                  className="sc-msg-action"
                  onClick={() => void onRetrySummary(tj)}
                  disabled={running || cooling}
                  title="仅重新生成 AI 总结，不会再次运行分析工具"
                >
                  <Icon name="refresh" size={14} />
                  {running
                    ? '正在重试总结'
                    : cooling
                      ? `冷却中 ${remaining}s`
                      : `重试 AI 总结（剩 ${maxSummaryRetries - attempts} 次）`}
                </button>
                {summaryRetryErrors[tj] && (
                  <span className="sc-msg-action-error">{summaryRetryErrors[tj]}</span>
                )}
              </div>
            );
          })()}
          {m.role === 'assistant' && actionBar}
          {m.role === 'assistant' && followupsOpen && onInsertComposerText && (
            <div
              data-testid="msg-followups"
              style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '4px 0 8px' }}
            >
              {followupPrompts.map((item, index) => (
                <button
                  key={item.label}
                  type="button"
                  className="sc-msg-action"
                  data-testid={`msg-followup-${index}`}
                  onClick={() => {
                    onInsertComposerText(item.prompt);
                    setFollowupsOpen(false);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
          {m.role === 'assistant' && statsOpen && !m.pending && (
            <MessageStatsPanel
              message={m}
              onClose={() => setStatsOpen(false)}
              id={statsPanelId}
            />
          )}
        </div>
      </div>
    </>
  );
});
