/**
 * BLOCK-22 P3 桥接层 (UI-194) — ChatCardLinkBridge + ChatCardLink
 *
 * 用途：建立"事件 → context → CodeMirrorEditor"的抽象桥接层
 *
 * 本文件**不**直接消费 SimpleChat.tsx / events.ts / WorkspaceFilePreview。
 * 按 petri-project-governance §Guardrails "Never modify unknown WIP"，
 * 业务侧入口（SimpleChat 聊天卡片 / WorkspaceFilePreview 容器）的具体
 * 接入动作**不在 P3 范围**，留给 WIP 收口后由业务侧 Agent 负责。
 *
 * ChatCardLinkBridge —— 跳转触发器包装：
 * 1. 接受 prop API（filePath / line / column / diffRevision）
 * 2. click 时通过 usePendingScroll().setPendingRequest 触发滚动
 * 3. variant: 'inline' | 'floating' —— 切换渲染样式
 *
 * P4.2 新增 ChatCardLink —— 开箱即用组件：
 * - 提供默认样式（蓝色下划线），无需业务侧传入 children 内容
 * - 完整 props API：`{ filePath, line?, column?, pulseMs?, diffRevision?, variant?, children }`
 * - 默认 variant = 'inline'
 *
 * 设计要点：
 * - **不**消费 SimpleChat.tsx 的 ToolActivityList / cards —— 业务侧负责把
 *   ChatCardLinkBridge 包到现有卡片里（P3 不接业务侧）
 * - 通过 PendingScrollContext 投递请求，**不**直接调任何事件总线
 * - 提供 prop API 让上游业务侧（含未来 SimpleChat 适配层）方便接入
 *
 * 不外推：详见 plan §8。
 */

import React, { useCallback, type ReactNode } from 'react';

import type { DiffRevision } from '../../editor/CodeMirror/types';
import { usePendingScroll } from '../../../lib/pendingScrollContext';
import styles from './integration.module.css';

export type ChatCardLinkVariant = 'inline' | 'floating';

export interface ChatCardLinkBridgeProps {
  /** 目标文件路径。 */
  filePath: string;
  /** 目标行号（1-based）。 */
  line?: number;
  /** 目标列偏移（0-based，可选）。 */
  column?: number;
  /** pulse 高亮时长（可选）。 */
  pulseMs?: number;
  /** 可选 diff revision；存在时 WorkspaceFilePreviewBridge 会切到 inline-diff。 */
  diffRevision?: DiffRevision;
  /** 渲染形态：'inline'（嵌在文本流）或 'floating'（absolute 定位）。 */
  variant?: ChatCardLinkVariant;
  /** 子节点（通常是 chat 卡片里某段文本）。 */
  children: ReactNode;
  /**
   * 自定义 click handler；通常**不**需要，组件已默认处理 setPendingRequest。
   * 传入时会在 setPendingRequest 之后调用（不阻止默认行为）。
   */
  onActivate?: () => void;
  /**
   * 透传 className / 业务侧样式。
   */
  className?: string;
  /**
   * ARIA label（按钮的辅助标签）。默认由 filePath + line 拼接。
   */
  ariaLabel?: string;
}

/**
 * ChatCardLinkBridge —— 跳转触发器包装。
 *
 * 用法示例（业务侧后续接入 SimpleChat 时）：
 *
 *   <ChatCardLinkBridge filePath={hit.filePath} line={hit.line}>
 *     Open {hit.filePath}:{hit.line}
 *   </ChatCardLinkBridge>
 *
 * 注意：本组件**只**渲染一个 button；上游需要负责把它嵌在正确的视觉层。
 */
export function ChatCardLinkBridge({
  filePath,
  line = 1,
  column,
  pulseMs,
  diffRevision,
  variant = 'inline',
  children,
  onActivate,
  className,
  ariaLabel,
}: ChatCardLinkBridgeProps): React.ReactElement {
  const { setPendingRequest } = usePendingScroll();

  const handleClick = useCallback<React.MouseEventHandler<HTMLButtonElement>>(() => {
    setPendingRequest({
      filePath,
      line,
      column,
      pulseMs,
      diffRevision,
      timestamp: Date.now(),
    });
    onActivate?.();
  }, [filePath, line, column, pulseMs, diffRevision, setPendingRequest, onActivate]);

  const label =
    ariaLabel ?? `Open ${filePath}${line ? `:${line}` : ''}`;

  const variantClass =
    variant === 'floating' ? styles.chatCardLinkFloating : styles.chatCardLink;
  const composedClassName = [variantClass, className].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      data-bf3-chat-card-link
      data-bf3-chat-card-link-variant={variant}
      className={composedClassName}
      aria-label={label}
      onClick={handleClick}
    >
      {children}
    </button>
  );
}

// ===== P4.2 新增：ChatCardLink 开箱即用组件 =====

/**
 * P4.2 props：ChatCardLink 开箱即用组件的 props。
 *
 * 与 ChatCardLinkBridgeProps 基本一致，但 `children` 是**可选**的（默认显示文件名）。
 */
export interface ChatCardLinkProps {
  /** 目标文件路径。 */
  filePath: string;
  /** 目标行号（1-based）。默认 1。 */
  line?: number;
  /** 目标列偏移（0-based，可选）。 */
  column?: number;
  /** pulse 高亮时长（可选）。 */
  pulseMs?: number;
  /** 可选 diff revision；存在时 WorkspaceFilePreviewBridge 会切到 inline-diff。 */
  diffRevision?: DiffRevision;
  /**
   * 渲染形态：'inline'（蓝色下划线，文本流内）或 'floating'（absolute 定位浮层）。
   * 默认 'inline'。
   */
  variant?: ChatCardLinkVariant;
  /**
   * 子节点（可选）。默认显示 `filePath + ":" + line`。
   *
   * 业务侧传入 children 时，内容会替代默认文本显示。
   */
  children?: ReactNode;
  /**
   * 自定义 click handler；通常**不**需要，组件已默认处理 setPendingRequest。
   * 传入时会在 setPendingRequest 之后调用（不阻止默认行为）。
   */
  onActivate?: () => void;
  /**
   * 透传 className / 业务侧样式（会与默认 .chatCardLink / .chatCardLinkFloating 叠加）。
   */
  className?: string;
  /**
   * ARIA label（按钮的辅助标签）。默认由 filePath + line 拼接。
   */
  ariaLabel?: string;
}

/**
 * ChatCardLink —— P4.2 开箱即用跳转组件。
 *
 * 用法（业务侧一行接入）：
 *   // 最简：只传 filePath + line
 *   <ChatCardLink filePath="/workspace/foo.py" line={5} />
 *
 *   // 完整 API
 *   <ChatCardLink
 *     filePath="/workspace/foo.py"
 *     line={5}
 *     column={3}
 *     pulseMs={1500}
 *     variant="floating"
 *   >
 *     查看第 5 行
 *   </ChatCardLink>
 *
 * 对比 ChatCardLinkBridge（底层组件）：
 * - ChatCardLinkBridge：业务侧提供 button 内容（`{children}` 即 button 的 label）
 * - ChatCardLink：children 可选；不传时默认显示 `filePath:line`
 *
 * P4.2 改进前（ChatCardLinkBridge）：
 *   <ChatCardLinkBridge filePath={path} line={5}>
 *     <button>Open {path}</button>
 *   </ChatCardLinkBridge>
 *
 * P4.2 改进后（ChatCardLink）：
 *   <ChatCardLink filePath={path} line={5} />
 *
 * 默认样式（via integration.module.css）：
 * - variant='inline'：蓝色下划线，与正文文本流混排
 * - variant='floating'：absolute 定位浮层，适合工具提示 / 工具栏
 *
 * 注意：本组件需要被 PendingScrollProvider 包裹（WorkspaceFilePreviewBridge 已内置）。
 *       若单独使用，需确保外部有 PendingScrollProvider。
 */
export function ChatCardLink({
  filePath,
  line = 1,
  column,
  pulseMs,
  diffRevision,
  variant = 'inline',
  children,
  onActivate,
  className,
  ariaLabel,
}: ChatCardLinkProps): React.ReactElement {
  const { setPendingRequest } = usePendingScroll();

  const handleClick = useCallback<React.MouseEventHandler<HTMLButtonElement>>(() => {
    setPendingRequest({
      filePath,
      line,
      column,
      pulseMs,
      diffRevision,
      timestamp: Date.now(),
    });
    onActivate?.();
  }, [filePath, line, column, pulseMs, diffRevision, setPendingRequest, onActivate]);

  const label =
    ariaLabel ?? `Open ${filePath}${line ? `:${line}` : ''}`;

  // 默认显示文本：children 存在时用 children，否则用 filePath:line
  const defaultLabel = `${filePath}:${line}`;
  const buttonLabel = children ?? defaultLabel;

  const variantClass =
    variant === 'floating' ? styles.chatCardLinkFloating : styles.chatCardLink;
  const composedClassName = [variantClass, className].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      data-bf3-chat-card-link
      data-bf3-chat-card-link-variant={variant}
      className={composedClassName}
      aria-label={label}
      onClick={handleClick}
    >
      {buttonLabel}
    </button>
  );
}
