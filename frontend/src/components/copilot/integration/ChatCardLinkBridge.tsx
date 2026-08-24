/**
 * BLOCK-22 P3 桥接层 (UI-194) — ChatCardLinkBridge
 *
 * 用途：建立"事件 → context → CodeMirrorEditor"的抽象桥接层
 *
 * 本文件**不**直接消费 SimpleChat.tsx / events.ts / WorkspaceFilePreview。
 * 按 biof3-project-governance §Guardrails "Never modify unknown WIP"，
 * 业务侧入口（SimpleChat 聊天卡片 / WorkspaceFilePreview 容器）的具体
 * 接入动作**不在 P3 范围**，留给 WIP 收口后由业务侧 Agent 负责。
 *
 * ChatCardLinkBridge —— 跳转触发器包装：
 * 1. 接受 prop API（filePath / line / column / diffRevision）
 * 2. click 时通过 usePendingScroll().setPendingRequest 触发滚动
 * 3. variant: 'inline' | 'floating' —— 切换渲染样式
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