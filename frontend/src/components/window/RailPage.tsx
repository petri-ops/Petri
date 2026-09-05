// ============================================================
// RailPage — BLOCK-59 P2 边缘活动轨道（/window/rail，内部专用路由）。
// 加映二（用户反馈「hover 应可预览 / 刻度看不出是啥」）：
//   - 刻度带类型图标（结果 bar-chart / 终端 terminal / agent brain），
//     不再是无法辨认的色块；
//   - hover 卡新增「内容快照预览」（降格瞬间主进程 capturePage 的
//     window:thumbnail，无快照回退纯文本）；
//   - 轨道窗加宽为 预览区336+条带28，卡片不再被窗体裁剪（首版根因）。
// 仍只做一件事：只读窗口注册表的投影（plan §5 克制版）。
// ============================================================
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import {
  collapseRailEntries,
  isFadedRailEntry,
  railEntryTitle,
  type RailEntry,
} from './railEntries';
import { getBridge } from '@/lib/desktopBridge';
import styles from './rail-page.module.css';

const TICK_ICON: Record<string, IconName> = {
  result: 'bar-chart',
  terminal: 'terminal',
  agent: 'brain',
};

/** 指针从刻度移向卡片需要跨越条带边界，用短延迟防误关（经典 popover 时序）。 */
const CLOSE_DELAY_MS = 180;
/** 卡片距窗口上下缘的最小间距（plan §5 垂直钳位）。 */
const CARD_EDGE_GAP = 12;

export function RailPage(): React.ReactElement {
  const [entries, setEntries] = useState<RailEntry[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());
  const [cardTop, setCardTop] = useState<number>(CARD_EDGE_GAP);
  const closeTimerRef = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const tickRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  // 悬停锚点：刻度在视口坐标系的 top（railPage 为 fixed inset 0，二者同坐标系）
  const anchorTopRef = useRef<number>(CARD_EDGE_GAP);

  const setIgnore = (ignore: boolean) => {
    getBridge('windowManager')?.setRailMouseIgnore(ignore);
  };
  const cancelClose = () => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setHoveredId(null);
      setIgnore(true);
    }, CLOSE_DELAY_MS);
  };

  // 快照水合 + 增量维护（只保留 railed 条目）
  useEffect(() => {
    const bridge = getBridge('windowManager');
    if (!bridge) return;
    let alive = true;
    const railedFromSnapshot = (snap: Awaited<ReturnType<typeof bridge.snapshot>>['snapshot']) =>
      (snap?.entries || []).filter((e): e is RailEntry => e.state === 'railed');
    bridge
      .snapshot()
      .then((res) => {
        if (alive && res.ok) setEntries(railedFromSnapshot(res.snapshot));
      })
      .catch(() => {});
    const off = bridge.onStateChanged((event) => {
      setEntries((prev) => {
        if (event.kind === 'remove') return prev.filter((e) => e.id !== event.id);
        if (event.entry.state !== 'railed') return prev.filter((e) => e.id !== event.entry.id);
        const next = prev.filter((e) => e.id !== event.entry.id);
        return [...next, event.entry as RailEntry];
      });
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  // 淡出判定随时间推进（30s 粒度足够 5min 语义）
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // 初始整窗穿透；卸载恢复穿透（轨道窗常驻复用）
  useEffect(() => {
    setIgnore(true);
    return () => {
      cancelClose();
      setIgnore(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // hover 时拉取内容快照（缓存；无快照 → 卡回退纯文本）
  useEffect(() => {
    if (!hoveredId || thumbs[hoveredId]) return;
    let cancelled = false;
    getBridge('windowManager')
      ?.thumbnail(hoveredId)
      .then((res) => {
        if (!cancelled && res?.ok && res.dataUrl) {
          setThumbs((prev) => ({ ...prev, [hoveredId]: res.dataUrl as string }));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hoveredId, thumbs]);

  const { visible, overflow } = useMemo(() => collapseRailEntries(entries), [entries]);
  const hovered = visible.find((e) => e.id === hoveredId) || null;

  // ── 加映三：悬停锚定 + 卡片垂直钳位（plan §5，复用 UI-255 重钳思路）──
  // 卡片 top 跟随悬停刻度，钳制在 [GAP, innerHeight - cardH - GAP]；
  // 缩略图加载等引起的卡片尺寸变化经 ResizeObserver 重钳。
  useLayoutEffect(() => {
    if (!hoveredId) return;
    const reclamp = () => {
      const cardH = cardRef.current?.offsetHeight ?? 0;
      const max = Math.max(CARD_EDGE_GAP, window.innerHeight - cardH - CARD_EDGE_GAP);
      setCardTop(Math.min(Math.max(anchorTopRef.current, CARD_EDGE_GAP), max));
    };
    reclamp();
    const card = cardRef.current;
    if (!card) return;
    const ro = new ResizeObserver(reclamp);
    ro.observe(card);
    return () => ro.disconnect();
  }, [hoveredId, thumbs]);

  /** 统一的悬停入口：记录锚点刻度位置 + 取消关闭计时 + 收鼠标。 */
  const hoverTick = (id: string) => {
    cancelClose();
    const el = tickRefs.current[id];
    if (el) anchorTopRef.current = el.getBoundingClientRect().top;
    setHoveredId(id);
    setIgnore(false);
  };

  // ── 加映三：刻度区滚轮换卡（deltaY>0 向列表下方、<0 向上方）──────
  const handleWheel = (e: React.WheelEvent) => {
    if (visible.length === 0) return;
    const currentIndex = visible.findIndex((item) => item.id === hoveredId);
    const nextIndex = currentIndex < 0
      ? 0
      : e.deltaY > 0
        ? Math.min(currentIndex + 1, visible.length - 1)
        : Math.max(currentIndex - 1, 0);
    const next = visible[nextIndex];
    if (next && next.id !== hoveredId) hoverTick(next.id);
  };

  const handleRestore = async (id: string) => {
    cancelClose();
    setHoveredId(null);
    setIgnore(true);
    await getBridge('windowManager')?.restore(id);
  };

  const handleRemove = async (id: string) => {
    cancelClose();
    setHoveredId(null);
    setIgnore(true);
    await getBridge('windowManager')?.remove(id);
  };

  return (
    <div className={styles.railPage}>
      {hovered && (
        <div
          ref={cardRef}
          className={styles.card}
          style={{ top: cardTop }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          {thumbs[hovered.id] ? (
            <div className={styles.thumbWrap}>
              <img className={styles.thumbImg} src={thumbs[hovered.id]} alt={railEntryTitle(hovered)} />
            </div>
          ) : (
            <div className={styles.thumbFallback}>无内容快照</div>
          )}
          <strong className={styles.cardTitle}>{railEntryTitle(hovered)}</strong>
          <span className={styles.cardMeta}>
            {hovered.railClass === 'static' ? '静态（完成态）' : '常驻'} · 快照于降格时
          </span>
          {isFadedRailEntry(hovered, now) && (
            <span className={styles.fadedNote}>已静置淡出 · hover 恢复可继续查看</span>
          )}
          <div className={styles.cardActions}>
            <button
              type="button"
              className={`${styles.cardBtn} ${styles.cardBtnPrimary}`}
              onClick={() => void handleRestore(hovered.id)}
            >
              恢复
            </button>
            <button
              type="button"
              className={`${styles.cardBtn} ${styles.cardBtnDanger}`}
              onClick={() => void handleRemove(hovered.id)}
              title="从轨道显式移除（唯一销毁路径）"
            >
              移除
            </button>
          </div>
        </div>
      )}
      <div
        className={`${styles.strip} ${hovered ? styles.stripActive : ''}`}
        onWheel={handleWheel}
        onMouseLeave={scheduleClose}
      >
        {visible.length === 0 && <span className={styles.emptyHint}>无降格窗口</span>}
        {visible.map((entry) => (
          <button
            key={entry.id}
            ref={(el) => {
              tickRefs.current[entry.id] = el;
            }}
            type="button"
            className={styles.tick}
            data-kind={entry.type}
            data-faded={isFadedRailEntry(entry, now) ? 'true' : 'false'}
            title={railEntryTitle(entry)}
            aria-label={`预览并恢复 ${railEntryTitle(entry)}`}
            onMouseEnter={() => hoverTick(entry.id)}
            onClick={() => void handleRestore(entry.id)}
          >
            <Icon name={TICK_ICON[entry.type] || 'square-stack'} size={13} />
          </button>
        ))}
        {overflow > 0 && <span className={styles.overflowChip}>+{overflow}</span>}
      </div>
    </div>
  );
}
