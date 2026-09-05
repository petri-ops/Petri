// ============================================================
// RailPage — BLOCK-59 P2 边缘活动轨道（/window/rail，内部专用路由）。
//
// 只做一件事：展示「哪些窗口被降格了」（plan §5）——只读窗口注册表
// 投影，数据全部来自 windowManager 快照 + state-changed 增量，不订阅
// 任务事件流。刻度点击 = 恢复；hover 卡 = 详情 + 显式移除（唯一销毁
// 路径的 UI 入口）。点击穿透由主进程 setIgnoreMouseEvents 承载，
// 渲染层在条带/卡 hover 时切换。
// ============================================================
import React, { useEffect, useMemo, useState } from 'react';
import {
  collapseRailEntries,
  isFadedRailEntry,
  railEntryTitle,
  type RailEntry,
} from './railEntries';
import { getBridge } from '@/lib/desktopBridge';
import styles from './rail-page.module.css';

export function RailPage(): React.ReactElement {
  const [entries, setEntries] = useState<RailEntry[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

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
    getBridge('windowManager')?.setRailMouseIgnore(true);
    return () => getBridge('windowManager')?.setRailMouseIgnore(true);
  }, []);

  const { visible, overflow } = useMemo(() => collapseRailEntries(entries), [entries]);
  const hovered = visible.find((e) => e.id === hoveredId) || null;

  const handleRestore = async (id: string) => {
    await getBridge('windowManager')?.restore(id);
    setHoveredId(null);
  };

  const handleRemove = async (id: string) => {
    await getBridge('windowManager')?.remove(id);
    setHoveredId(null);
  };

  return (
    <div className={styles.railPage}>
      {hovered && (
        <div
          className={styles.card}
          onMouseEnter={() => getBridge('windowManager')?.setRailMouseIgnore(false)}
          onMouseLeave={() => {
            getBridge('windowManager')?.setRailMouseIgnore(true);
            setHoveredId(null);
          }}
        >
          <strong className={styles.cardTitle}>{railEntryTitle(hovered)}</strong>
          <span className={styles.cardMeta}>
            {hovered.id} · {hovered.railClass === 'static' ? '静态（完成态）' : '常驻'}
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
        onMouseEnter={() => getBridge('windowManager')?.setRailMouseIgnore(false)}
        onMouseLeave={() => {
          getBridge('windowManager')?.setRailMouseIgnore(true);
          setHoveredId(null);
        }}
      >
        {visible.length === 0 && <span className={styles.emptyHint}>无降格窗口</span>}
        {visible.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={styles.tick}
            data-kind={entry.type}
            data-faded={isFadedRailEntry(entry, now) ? 'true' : 'false'}
            title={railEntryTitle(entry)}
            aria-label={`恢复 ${railEntryTitle(entry)}`}
            onMouseEnter={() => setHoveredId(entry.id)}
            onClick={() => void handleRestore(entry.id)}
          />
        ))}
        {overflow > 0 && <span className={styles.overflowChip}>+{overflow}</span>}
      </div>
    </div>
  );
}
