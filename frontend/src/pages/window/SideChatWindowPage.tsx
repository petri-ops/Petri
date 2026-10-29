/**
 * SideChatWindowPage — UI-627（BLOCK-321）— 侧聊原生独立窗页面
 * （/window/side-chat，frameless 单例窗，注册表见 src/main/_window-manager.js）。
 *
 * 形态（用户三条裁决，2026-10-29）：
 * - ①入口收编：只留标题栏「侧聊」开窗；中栏右下角 FAB 退役（CenterPanel）；
 * - ②极简 chrome：旧 52px「会话」标题头退役（挤压会话内容），只留窄拖动条
 *   （app-region drag，frameless 窗的移动把手）+ 右上角 ✕（真关闭）；
 * - ③跨屏自由：拖动/八方位 resize 全由 OS 承担（原生窗），可拖出软件边界
 *   到第二显示器，位置记忆走主进程 geometry（resolveLaunchBounds）。
 *
 * 初始状态（projectId/convId）从 URL query 读（主进程白名单 POP_OUT_QUERY_KEYS
 * 拼入）——localStorage 跨窗读写无 happens-before（实机抓真竞态），已退役。
 * fork 在主窗 helper（openSideChatWindow）完成，本页只承载。
 */
import React, { useCallback, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { SimpleChat } from '@/components/copilot/SimpleChat';
import { getBridge } from '@/lib/desktopBridge';
import { sideChatConvKey } from '@/lib/sideChatWindow';
import styles from './SideChatWindowPage.module.css';

function readInitialConvId(projectId: string): string | null {
  // 记忆兜底：URL query 无 convId（历史窗口/异常直开）时读 per-project 记忆——
  // 本页自己写自己读，同进程无竞态；主窗开窗时也读同一记忆经 query 带上。
  try {
    return window.localStorage.getItem(sideChatConvKey(projectId));
  } catch {
    return null;
  }
}

export function SideChatWindowPage(): React.ReactElement {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const projectId = params.get('projectId') ?? '';
  const [sideConvId, setSideConvId] = useState<string | null>(() =>
    projectId ? params.get('convId') ?? readInitialConvId(projectId) : null,
  );

  const handleConversationChange = useCallback(
    (id: string | null) => {
      setSideConvId(id);
      try {
        if (id) window.localStorage.setItem(sideChatConvKey(projectId), id);
        else window.localStorage.removeItem(sideChatConvKey(projectId));
      } catch {
        // localStorage 不可用时退化为内存态
      }
    },
    [projectId],
  );

  const handleClose = useCallback(() => {
    // window:close 关闭发送方窗口自身（closeBehavior=close 单例：× = 真关闭）
    getBridge('window')?.close();
  }, []);

  if (!projectId) {
    return (
      <div className={styles.page}>
        <div className={styles.dragStrip} data-testid="side-chat-window-drag-strip" />
        <button
          type="button"
          className={styles.closeBtn}
          onClick={handleClose}
          aria-label="关闭侧边聊天"
          title="关闭"
        >
          <Icon name="x" size={12} />
        </button>
        <div className={styles.empty}>未取得项目上下文，请从主窗标题栏重新打开侧聊。</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.dragStrip} data-testid="side-chat-window-drag-strip" />
      <button
        type="button"
        className={styles.closeBtn}
        onClick={handleClose}
        aria-label="关闭侧边聊天"
        title="关闭"
      >
        <Icon name="x" size={12} />
      </button>
      <div className={styles.body}>
        <SimpleChat
          key={sideConvId ?? 'side-new'}
          projectId={projectId}
          conversationId={sideConvId}
          onConversationChange={handleConversationChange}
          inputHeight={88}
          compact
          lockedAccessMode="read"
          slimComposer
        />
      </div>
    </div>
  );
}
