// ============================================================
// contextLimits.ts — BLOCK-245 P5「上限诚实化」文案单源（C16 部分）
//
// 收敛前：附件超量/超大只 console.warn（`attachments.ts:95/112`），引用超限由
// `appendContextItem` 静默 `slice` 掉最早那条——用户看不到自己丢了什么。本包
// 把这些路径接上可见提示，**文案集中在本文件**（一条上限知识只写一遍）。
//
// 纪律：
//   · 文案必须说清「谁被拒」与「已有项有没有被动」——后者是 C16 的核心抱怨；
//   · 不在这里做上限判定（上限常量各自在本域定义：附件在 attachments.ts、
//     引用组在 contextItems.ts），本文件只产出去人话。
// ============================================================

/** 附件组显示名（超限文案用）。 */
const GROUP_LABELS = {
  image: '图片引用',
  reference: '引用',
  attachment: '附件',
} as const;

export type ContextLimitGroup = keyof typeof GROUP_LABELS;

/** 单个附件超过体积上限（drop 拒收 + 上传前置校验共用同一句）。 */
export function attachmentTooLargeNotice(name: string, maxBytes: number): string {
  const mb = Math.max(1, Math.round(maxBytes / (1024 * 1024)));
  return `${name} 超过 ${mb}MB 附件上限`;
}

/** 附件数量超限：说清"本次几个未加入"，并明确已有附件不受影响。 */
export function attachmentCountNotice(limit: number, rejected: number): string {
  return `附件已达上限 ${limit} 个：本次新增的 ${rejected} 个未加入（已在列表里的附件不受影响）`;
}

/**
 * 同组引用超限：现状语义是**保留最后 N 条**（最早那条被移出）。
 * 文案必须把"移出的是最早的"说出来，否则用户会以为点错了。
 */
export function contextLimitNotice(group: ContextLimitGroup, limit: number, dropped: number): string {
  return `${GROUP_LABELS[group]}已达上限（同组最多 ${limit} 条）：最早加入的 ${dropped} 条已移出，请重新选择要引用的项`;
}

/** 与同组上一条完全同源：不重复计入，但要让用户知道"点了但有反应"。 */
export function contextDedupedNotice(group: ContextLimitGroup): string {
  return `这条${GROUP_LABELS[group]}已经在列表里（同源重复不重复计入）`;
}
