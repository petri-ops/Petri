/**
 * KnowledgeConsoleDock — BLOCK-103 P4 管理会话台折叠抽屉（/knowledge 页右缘）
 *
 * 形态对标 UI-417 SideChatDock：右缘常驻竖把手，点开滑出 ~380px overlay
 * 覆盖在文档区上方（不挤压布局），Esc / 外点 / 再点把手收起。
 * 默认收起（空空间时它是页面最无用区域却最占宽——BLOCK-103 §0 P-02），
 * 开合状态 localStorage 记忆。KnowledgeConsoleChat 内部能力零改动（D2）。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { KnowledgeConsoleChat } from './KnowledgeConsoleChat';
import styles from './KnowledgeConsoleDock.module.css';

const CONSOLE_OPEN_KEY = 'petri.knowledgeConsoleOpen';

function readInitialOpen(): boolean {
  try {
    return window.localStorage.getItem(CONSOLE_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function KnowledgeConsoleDock(): React.ReactElement {
  const [open, setOpen] = useState(readInitialOpen);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  const setOpenPersisted = useCallback((next: boolean) => {
    setOpen(next);
    try {
      window.localStorage.setItem(CONSOLE_OPEN_KEY, next ? '1' : '0');
    } catch {
      /* localStorage 不可用时状态仅会话内有效 */
    }
  }, []);

  const toggle = useCallback(() => setOpenPersisted(!open), [open, setOpenPersisted]);

  // Esc 收起
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenPersisted(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpenPersisted]);

  // 外点收起（面板内交互不触发；把手自身 toggle 处理）
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (surfaceRef.current && !surfaceRef.current.contains(target)) {
        setOpenPersisted(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open, setOpenPersisted]);

  return (
    <div className={styles.dockRoot} data-testid="knowledge-console-dock">
      {open ? (
        <div className={styles.surface} ref={surfaceRef} data-testid="knowledge-console-surface">
          <button
            type="button"
            className={styles.closeBtn}
            onClick={() => setOpenPersisted(false)}
            aria-label="收起管理会话台"
            title="收起（Esc）"
          >
            <Icon name="x" size={13} />
          </button>
          <KnowledgeConsoleChat />
        </div>
      ) : null}
      <button
        type="button"
        className={`${styles.handle} ${open ? styles.handleActive : ''}`}
        onClick={toggle}
        aria-label={open ? '收起管理会话台' : '打开管理会话台'}
        aria-expanded={open}
        title={open ? '收起管理会话台' : '管理会话台（自然语言管理知识空间）'}
        data-testid="knowledge-console-handle"
      >
        <Icon name="message-circle" size={15} />
        <span className={styles.handleText}>管理台</span>
      </button>
    </div>
  );
}

