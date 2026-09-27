/**
 * SideChatToggleButton — UI-448 加映 v15 入口归位 + 机制统一。
 *
 * 侧边聊天是主会话区的外延、整个项目开发周期常驻使用的问答面：
 * 开关并入壳状态 useWorkspacePanelsContext（与摘要概览开关完全同一套机制、
 * 同一写法），不再用独立 store。运行提示：侧聊会话 agent 运行中时
 * 按钮图标取在线色呼吸（v7 语言迁入）。
 */
import React, { useEffect, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { isConversationRunning } from '@/components/copilot/conversationRunStore';
import { useWorkspacePanelsContext } from '@/components/desktop/WorkspacePanelsContext';
import styles from './ColumnizedTitleBar.module.css';

const sideChatConvKey = (projectId: string) => `gewu:side-chat-conv:${projectId}`;

function readStoredSideConversation(projectId: string | null): string | null {
  if (!projectId) return null;
  try {
    return window.localStorage.getItem(sideChatConvKey(projectId));
  } catch {
    return null;
  }
}

export function SideChatToggleButton({
  projectId,
}: {
  projectId: string | null;
}): React.ReactElement {
  const panels = useWorkspacePanelsContext();
  const [running, setRunning] = useState(false);

  // 侧聊 agent 运行中 → 图标呼吸（UI-397 同款语言；v4「与 open 解耦」语义保留）
  useEffect(() => {
    const update = () => setRunning(isConversationRunning(readStoredSideConversation(projectId)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [projectId, panels.sideChatOpen]);

  return (
    <button
      type="button"
      className={`${styles.iconBtn} ${running ? styles.sideChatRunning : ''}`}
      onClick={panels.toggleSideChat}
      title={panels.sideChatOpen ? '收起侧边聊天' : '侧边聊天'}
      aria-label={panels.sideChatOpen ? '收起侧边聊天' : '侧边聊天'}
      aria-pressed={panels.sideChatOpen}
      data-testid="side-chat-toggle"
    >
      <Icon name="message-circle" size={15} />
    </button>
  );
}
