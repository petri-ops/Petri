/**
 * SideChatDock — UI-417 侧边聊天悬挂化（BLOCK-95 后继用户提案「右栏聊天目前在右侧
 * 意义不大，应该悬挂在中间区域右侧边上」）。
 *
 * 形态（D1-D4 按 roadmap 预置推荐落地）：
 * - D1 常驻把手：中栏右缘竖把手（聊天图标 + agent 运行中呼吸灯），点开滑出、再点收起；
 * - D2 overlay 覆盖：~380px 悬浮面叠在中栏右缘上方，不挤压布局（UI-351 float 先例）；
 *   加映 v2（UI-448）：贴底右下角占一半高度，与右上角摘要浮层同屏共存；
 * - 复用 SimpleChat 同一会话同一 run：与中央读同一 activeConvId（conversationRunStore
 *   单一真相），仅收窄承载；中央 ownsCopilotAsk 归属不变，悬挂面不承接「问 Agent」；
 * - 外点/Esc/再点把手收起。
 * UI-448 — 开态升 sideChatDockStore 共享单例（中栏 composer 让位 + 内容让位同源）；
 *   视觉对齐项目摘要浮层语言（圆角/阴影 token/280ms/reduced-motion）；compact 短占位符。
 * UI-448 加映 v2 — 悬挂面仅聊天：锁只读档（lockedAccessMode="read"），sc-root 中性化去双层背景。
 * UI-448 加映 v3 — **独立会话**：不再镜像中栏 activeConvId，每项目一个独立侧聊会话
 *   （localStorage 按 projectId 持久化；空则首发由 useChatStream 既有路径自动建话），
 *   主会话的编码 agent 内容不再出现在悬挂面，两会话 run 互不干扰。组件签名收缩为只收
 *   projectId。**slimComposer**：composer 只留只读徽标 + 发送键。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { SimpleChat } from '@/components/copilot/SimpleChat';
import { forkConversation } from '@/components/copilot/copilotConversationsClient';
import { gewuEvents, subscribeGewuEvent } from '@/lib/events';
// UI-448 — 开态升共享 store：中栏 composer 让位与内容让位类同源联动（单一输入面）
import styles from './SideChatDock.module.css';

const sideChatConvKey = (projectId: string) => `gewu:side-chat-conv:${projectId}`;

function readStoredSideConversation(projectId: string): string | null {
  try {
    return window.localStorage.getItem(sideChatConvKey(projectId));
  } catch {
    return null;
  }
}

export function SideChatDock({
  projectId,
  sourceConversationId = null,
  variant = 'float',
  surfaceSuppressed = false,
  belowSummary = false,
  open,
  onOpenChange,
}: {
  projectId: string;
  /**
   * UI-448 加映 v12 — 主会话 id：侧聊首次展开时 fork 它以「继承主会话的聊天记录」，
   * 之后独立演化（不写入、不 steer、不影响主会话上下文）。null=主会话为空，
   * 侧聊保持空态（首发送由 SimpleChat 建话）。
   */
  sourceConversationId?: string | null;
  /**
   * UI-448 加映 v12 — 形态：'float'=窄窗悬浮（把手 + 绝对定位面板）；
   * 'docked'=宽窗独立列区（由 CenterPanel 放进右轨，无悬浮把手）。
   */
  variant?: 'float' | 'docked';
  /** UI-448 加映 v12 — 宽窗时面板由独立列区承载：悬浮实例只渲染常驻把手。 */
  surfaceSuppressed?: boolean;
  /** UI-448 加映 v14 — 摘要悬浮同时打开：面板让到其下方下半区，同右缘不叠加。 */
  belowSummary?: boolean;
  /** UI-448 加映 v15 — 开态由壳状态传入（sideChatOpen，摘要概览同机制）。 */
  open: boolean;
  /** UI-448 加映 v15 — 收起回调（✕/事件入口统一走它回写壳状态）。 */
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  // UI-448 加映 v3 — 每项目独立侧聊会话（与中栏 activeConvId 完全解耦）。
  // projectId 切换由 CenterPanel 以 key={projectId} 重挂载承载（State 初始化器
  // 重新读 localStorage），避免同步 setState-in-effect 级联渲染。
  const [sideConvId, setSideConvId] = useState<string | null>(() => readStoredSideConversation(projectId));

  const handleConversationChange = useCallback((id: string | null) => {
    setSideConvId(id);
    try {
      if (id) window.localStorage.setItem(sideChatConvKey(projectId), id);
      else window.localStorage.removeItem(sideChatConvKey(projectId));
    } catch {
      // localStorage 不可用时退化为内存态（会话仍可用，仅不跨重启记忆）
    }
  }, [projectId]);

  // UI-448 加映 v12 — 首次展开且尚无侧聊会话时，fork 主会话继承其聊天记录。
  // 只读语义仍在（lockedAccessMode='read'），且分叉独立——侧聊的任何往来
  // 都不会写回主会话、不 steer 主任务、不进入主会话上下文（继承但不影响）。
  useEffect(() => {
    if (!open || sideConvId || !sourceConversationId) return;
    let cancelled = false;
    void (async () => {
      const forked = await forkConversation(sourceConversationId, '侧边聊天');
      if (cancelled || !forked?.id) return;
      setSideConvId(forked.id);
      try {
        window.localStorage.setItem(sideChatConvKey(projectId), forked.id);
      } catch {
        // localStorage 不可用：退化为内存态
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sideConvId, sourceConversationId, projectId]);

  // UI-417 入口收编：原右栏 chat tab 的入口（home 空态卡/分析完成跳转）派发
  // sideChatOpen，这里展开悬挂面（无会话时也展开——诚实空态引导首条消息）。
  useEffect(
    () => subscribeGewuEvent(gewuEvents.sideChatOpen, () => onOpenChange(true)),
    [onOpenChange]
  );
  // UI-448 加映 v5 — 常驻化（摘要卡同款特性）：移除外点收起与 Esc 收起
  // （Esc 在输入时误触），折叠/展开仅经把手与头部 ✕。

  const panel = (
    <>
      <header className={styles.surfaceHeader}>
        <Icon name="message-circle" size={13} />
        <span className={styles.surfaceTitle}>会话</span>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={() => onOpenChange(false)}
          aria-label="收起会话面板"
          title="收起（Esc）"
        >
          <Icon name="x" size={13} />
        </button>
      </header>
      <div className={styles.surfaceBody}>
        <SimpleChat
          key={sideConvId ?? 'side-new'}
          projectId={projectId}
          // 加映 v3 — null = 尚无侧聊会话：SimpleChat 内部首发建话（useChatStream
          // 既有路径）并经 onConversationChange 回写 localStorage
          conversationId={sideConvId}
          onConversationChange={handleConversationChange}
          inputHeight={88}
          // UI-448 — 窄面 compact：短占位符，完整键位提示在 380px 内折两行
          compact
          // UI-448 加映 v2 — 悬挂面仅聊天：锁只读档，写入/执行类工具被拒（后端权威门同口径）
          lockedAccessMode="read"
          // UI-448 加映 v3 — composer 删减：只留只读徽标 + 发送键
          slimComposer
        />
      </div>
    </>
  );

  // UI-448 加映 v12 — 宽窗独立列区变体：由 CenterPanel 放入右轨（in-flow），
  // 无悬浮把手（列区头部图标即入口）。
  if (variant === 'docked') {
    return (
      <div className={styles.dockedColumn} data-testid="side-chat-surface">
        {panel}
      </div>
    );
  }

  return (
    <div className={styles.dockRoot} data-testid="side-chat-dock">
      {open && !surfaceSuppressed ? (
        <div
          className={`${styles.surface} ${belowSummary ? styles.surfaceBelowSummary : ''}`}
          data-testid="side-chat-surface"
        >
          {panel}
        </div>
      ) : null}
      {/* UI-448 加映 v13 — 中栏浮动图标退役：入口迁至顶栏（摘要概览按钮邻居，
          见 titlebar/SideChatToggleButton），面板本体只保留浮面/列区两形态。 */}
    </div>
  );
}
