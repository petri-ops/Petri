/**
 * SideChatToggleButton — UI-448 加映 v13 入口归位。
 *
 * 侧边聊天是主会话区的外延、整个项目开发周期常驻使用的问答面，
 * 属「工作区级控件」：入口与摘要概览开关同排（顶栏中区 iconBtn 族），
 * 不再以中栏右缘浮动图标形态遮内容。
 * 运行提示：侧聊会话 agent 运行中时按钮图标取在线色呼吸（v7 语言迁入）。
 */
import React, { useEffect, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { isConversationRunning } from '@/components/copilot/conversationRunStore';
import { setSideChatDockOpen, useSideChatDockOpen } from '@/hooks/sideChatDockStore';
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
  const open = useSideChatDockOpen();
  const [running, setRunning] = useState(false);

  // 侧聊 agent 运行中 → 图标呼吸（UI-397 同款语言；v4「与 open 解耦」语义保留）
  useEffect(() => {
    const update = () => setRunning(isConversationRunning(readStoredSideConversation(projectId)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [projectId, open]);

  return (
    <button
      type="button"
      className={`${styles.iconBtn} ${running ? styles.sideChatRunning : ''}`}
      onClick={() => setSideChatDockOpen((v) => !v)}
      title={open ? '收起侧边聊天' : '侧边聊天'}
      aria-label={open ? '收起侧边聊天' : '侧边聊天'}
      aria-pressed={open}
      data-testid="side-chat-toggle"
    >
      <Icon name="message-circle" size={15} />
    </button>
  );
}
