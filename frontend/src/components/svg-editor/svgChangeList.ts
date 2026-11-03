/**
 * UI-663 — 「未保存改动（逐元素取舍）」清单由 pendingOps 直接生成。
 *
 * 语义 diff = op 列表本身：不再做「磁盘文本 vs 视图序列化」的反序列化比对
 * （两轮实机空清单的根因，见 plan §9），也不需要基线快照。
 * 撤销一组 = 从 pendingOps 移除该组；由调用方以磁盘文本重建视图后按序应用剩余组。
 */
import type { SvgOp } from './svgEditorModel';

export interface SvgOpGroup {
  /** 组序号 = history 条目序号（commit 每次推进一条，undo 同步弹出） */
  index: number;
  label: string;
  ops: SvgOp[];
}

/** op 字段的安全文本化（实践里都是 string；非字符串显式 JSON 化，不走 Object 默认 toString）。 */
function asText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === undefined || v === null) return '';
  return JSON.stringify(v);
}

/** target 的可读标签：优先 #id，否则 path[1,0] 形态，异常兜底不猜。 */
export function targetLabel(target: Record<string, unknown> | undefined): string {
  if (!target || typeof target !== 'object') return '(?)';
  const id = typeof target.id === 'string' ? target.id : '';
  if (id) return `#${id}`;
  const path = Array.isArray(target.path) ? target.path : [];
  return path.length > 0 ? `path[${path.map((n) => String(n)).join(',')}]` : '(根)';
}

function opLabel(op: SvgOp): string {
  const t = targetLabel(op.target as Record<string, unknown> | undefined);
  switch (op.op) {
    case 'set_attr': return `set ${asText(op.name)}=${asText(op.value)}（${t}）`;
    case 'remove_attr': return `删属性 ${asText(op.name)}（${t}）`;
    case 'set_style': return `set style ${asText(op.name)}=${asText(op.value)}（${t}）`;
    case 'set_text': return `改文字（${t}）`;
    case 'remove': return `删除 ${t}`;
    case 'insert': return `插入 <${asText(op.tag) || '?'}>`;
    case 'move': return `调层级 ${asText(op.direction)}（${t}）`;
    default: return `${op.op}（${t}）`;
  }
}

/** 组摘要：单 op 直出；多 op「首条 等 N 项」。 */
export function groupLabel(ops: ReadonlyArray<SvgOp>): string {
  if (ops.length === 0) return '';
  const first = opLabel(ops[0]);
  return ops.length === 1 ? first : `${first} 等 ${ops.length} 项`;
}

/**
 * 按 history 的 opsLen 快照切组：第 i 组 = ops.slice(prev.opsLen, cur.opsLen)。
 * history 与 pendingOps 由 commit/undo 同步维护（Viewer 既有约定）；
 * 尾部余量（理论不出现）如实兜底成组，不静默丢弃。
 */
export function splitOpGroups(ops: ReadonlyArray<SvgOp>, opsLens: ReadonlyArray<number>): SvgOpGroup[] {
  const groups: SvgOpGroup[] = [];
  let prev = 0;
  opsLens.forEach((len, i) => {
    const end = Math.min(Math.max(len, prev), ops.length);
    if (end > prev) {
      const slice = ops.slice(prev, end);
      groups.push({ index: i, label: groupLabel(slice), ops: slice });
      prev = end;
    }
  });
  if (prev < ops.length) {
    const slice = ops.slice(prev);
    groups.push({ index: opsLens.length, label: groupLabel(slice), ops: slice });
  }
  return groups;
}
