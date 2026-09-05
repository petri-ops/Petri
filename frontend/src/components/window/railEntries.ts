// ============================================================
// railEntries — BLOCK-59 P2 边缘活动轨道的纯逻辑（可单测）。
//
// 轨道是「降格窗口的存放处」（plan §5）：只读窗口注册表的投影，
// 不订阅任务事件流、不建第二套真相。刻度单屏上限 7，超出收拢 +N；
// static 类条目 5min 后淡出（仅视觉降权，hover 恢复，永不自动销毁）。
// ============================================================

export interface RailEntry {
  id: string;
  type: string;
  key: string;
  state: 'docked' | 'popped' | 'railed';
  railClass: 'static' | 'persistent';
  fadeAfter: number | null;
  createdAt: number;
  poppedAt: number | null;
  railedAt: number | null;
}

export const RAIL_MAX_TICKS = 7;

/** static（已完成结果窗）条目 5min 后淡出；常驻（终端/agent）不淡出。 */
export function isFadedRailEntry(
  entry: Pick<RailEntry, 'railClass' | 'fadeAfter'>,
  now: number,
): boolean {
  return (
    entry.railClass === 'static' &&
    typeof entry.fadeAfter === 'number' &&
    entry.fadeAfter < now
  );
}

/** 单屏刻度上限 7：保留最新降格的 6 个 + 「+N」收拢位（plan §5）。 */
export function collapseRailEntries(
  entries: RailEntry[],
): { visible: RailEntry[]; overflow: number } {
  const sorted = [...entries].sort(
    (a, b) => (b.railedAt ?? 0) - (a.railedAt ?? 0),
  );
  if (sorted.length <= RAIL_MAX_TICKS) {
    return { visible: sorted, overflow: 0 };
  }
  return {
    visible: sorted.slice(0, RAIL_MAX_TICKS - 1),
    overflow: sorted.length - (RAIL_MAX_TICKS - 1),
  };
}

const TYPE_LABELS: Record<string, string> = {
  result: '结果',
  terminal: '终端',
  agent: 'Agent',
};

/** 轨道卡标题：类型 + 内容键尾段（result:jobId:name → name）。 */
export function railEntryTitle(entry: Pick<RailEntry, 'type' | 'key'>): string {
  const typeLabel = TYPE_LABELS[entry.type] || entry.type;
  const keyTail = entry.key.includes(':')
    ? entry.key.slice(entry.key.indexOf(':') + 1)
    : entry.key;
  return keyTail ? `${typeLabel} · ${keyTail}` : typeLabel;
}
