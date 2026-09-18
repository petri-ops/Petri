/**
 * SideChatDock — UI-417 侧边聊天悬挂化（BLOCK-95 后继用户提案「右栏聊天目前在右侧
 * 意义不大，应该悬挂在中间区域右侧边上」）。
 *
 * 形态（D1-D4 按 roadmap 预置推荐落地）：
 * - D1 常驻把手：中栏右缘竖把手（聊天图标 + agent 运行中呼吸灯），点开滑出、再点收起；
 * - D2 overlay 覆盖：~380px 悬浮面叠在中栏右缘上方，不挤压布局（UI-351 float 先例）；
 * - 复用 SimpleChat 同一会话同一 run：与中央读同一 activeConvId（conversationRunStore
 *   单一真相），仅收窄承载；中央 ownsCopilotAsk 归属不变，悬挂面不承接「问 Agent」；
 * - 外点/Esc/再点把手收起。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { SimpleChat } from '@/components/copilot/SimpleChat';
import { isConversationRunning } from '@/components/copilot/conversationRunStore';
import { gewuEvents, subscribeGewuEvent } from '@/lib/events';
import styles from './SideChatDock.module.css';

export function SideChatDock({
  projectId,
  conversationId,
  onConversationChange,
}: {
  projectId: string;
  conversationId: string | null;
  onConversationChange: (id: string | null) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [agentRunning, setAgentRunning] = useState(false);

  // 呼吸灯：当前会话 agent 运行中（conversationRunStore 单一真相；UI-397 同款语言）
  useEffect(() => {
    if (!open || !conversationId) {
      setAgentRunning(false);
      return;
    }
    const update = () => setAgentRunning(isConversationRunning(conversationId));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [open, conversationId]);

  // Esc 收起
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // 外点收起（overlay 外的mousedown；面板内交互不触发）
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (surfaceRef.current && !surfaceRef.current.contains(target)) {
        // 把手点击由把手自身 toggle 处理（contains 覆盖把手），其余外点收起
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  // UI-417 入口收编：原右栏 chat tab 的入口（home 空态卡/分析完成跳转）派发
  // sideChatOpen，这里展开悬挂面（无会话时也展开——诚实空态引导中央首条消息）。
  useEffect(
    () => subscribeGewuEvent(gewuEvents.sideChatOpen, () => setOpen(true)),
    []
  );

  return (
    <div className={styles.dockRoot} data-testid="side-chat-dock">
      {open ? (
        <div className={styles.surface} ref={surfaceRef} data-testid="side-chat-surface">
          <header className={styles.surfaceHeader}>
            <Icon name="message-circle" size={13} />
            <span className={styles.surfaceTitle}>会话</span>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={() => setOpen(false)}
              aria-label="收起会话面板"
              title="收起（Esc）"
            >
              <Icon name="x" size={13} />
            </button>
          </header>
          <div className={styles.surfaceBody}>
            {conversationId ? (
              <SimpleChat
                projectId={projectId}
                conversationId={conversationId}
                onConversationChange={onConversationChange}
                inputHeight={88}
              />
            ) : (
              <div className={styles.emptyHint}>当前项目还没有会话——在中央发送第一条消息后，这里会同步显示同一会话。</div>
            )}
          </div>
        </div>
      ) : null}
      <button
        type="button"
        className={`${styles.handle} ${open ? styles.handleActive : ''}`}
        onClick={toggle}
        aria-label={open ? '收起侧边聊天' : '打开侧边聊天'}
        aria-expanded={open}
        title={open ? '收起侧边聊天' : '侧边聊天'}
        data-testid="side-chat-handle"
      >
        <span className={`${styles.handleDot} ${agentRunning ? styles.handleDotRunning : ''}`} />
        <Icon name="message-circle" size={14} />
      </button>
    </div>
  );
}
