// ============================================================
// MessageRail — UI-262 聊天区左缘「用户消息导航条」（Codex 风格）
//
// 贴边窄条 rail，当前会话的每条用户消息对应一个横杠刻度；
// 悬浮刻度弹出预览卡片（用户消息 + AI 回复摘要），点击刻度
// 平滑滚动跳转到聊天区中对应的那条消息。
//
// 定位契约：挂在 [data-rail-body]（position: relative）容器内，
// rail / 卡片均相对该容器绝对定位。
// ============================================================

import React, { useLayoutEffect, useRef, useState } from 'react';
import styles from './MessageRail.module.css';

export interface MessageRailItem {
  key: string;
  /** 用户消息原文 */
  content: string;
  /** 紧随其后的 AI 回复摘要（可选） */
  reply?: string;
}

export function MessageRail({
  items,
  onJump,
}: {
  items: MessageRailItem[];
  onJump: (index: number) => void;
}): React.ReactElement {
  const [hover, setHover] = useState<number | null>(null);
  // 卡片 top（相对 rail-body 坐标，两阶段：先估、后按卡片实高夹取）
  const [cardTop, setCardTop] = useState(0);
  const [cardMeasured, setCardMeasured] = useState(false);
  const tickRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLElement | null>(null);
  const closeTimer = useRef<number | null>(null);

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setHover(null), 160);
  };

  const showCard = (i: number) => {
    cancelClose();
    const tick = tickRefs.current[i];
    if (!tick) return;
    const body = tick.closest('[data-rail-body]') as HTMLElement | null;
    if (!body) return;
    bodyRef.current = body;
    const br = body.getBoundingClientRect();
    const tr = tick.getBoundingClientRect();
    setCardTop(tr.top - br.top + tr.height / 2);
    setCardMeasured(false);
    setHover(i);
  };

  // 渲染后按卡片实际高度夹取 top，保证卡片不超出聊天区上下边界
  useLayoutEffect(() => {
    if (hover === null) return;
    const card = cardRef.current;
    const body = bodyRef.current;
    if (!card || !body) return;
    const cr = card.getBoundingClientRect();
    const br = body.getBoundingClientRect();
    const pad = 12;
    const maxTop = Math.max(pad, br.height - cr.height - pad);
    setCardTop((prev) => Math.max(pad, Math.min(prev - cr.height / 2, maxTop) + cr.height / 2));
    setCardMeasured(true);
  }, [hover, items.length]);

  if (items.length === 0) return <></>;

  return (
    <>
      <div
        className={styles.rail}
        role="navigation"
        aria-label="用户消息导航"
        onMouseLeave={scheduleClose}
      >
        {items.map((item, i) => (
          <button
            key={item.key}
            ref={(el) => {
              tickRefs.current[i] = el;
            }}
            type="button"
            className={styles.tickBtn}
            onMouseEnter={() => showCard(i)}
            onFocus={() => showCard(i)}
            onClick={() => onJump(i)}
            aria-label={`跳转到第 ${i + 1} 条用户消息`}
          >
            <span className={`${styles.tickBar}${hover === i ? ` ${styles.tickBarActive}` : ''}`} />
          </button>
        ))}
      </div>
      {hover !== null && items[hover] && (
        <div
          ref={cardRef}
          className={styles.card}
          style={{ top: cardTop, visibility: cardMeasured ? 'visible' : 'hidden' }}
          data-testid="message-rail-card"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className={styles.cardUser}>{items[hover].content}</div>
          {items[hover].reply && (
            <>
              <div className={styles.cardDivider} />
              <div className={styles.cardReply}>{items[hover].reply}</div>
            </>
          )}
        </div>
      )}
    </>
  );
}
