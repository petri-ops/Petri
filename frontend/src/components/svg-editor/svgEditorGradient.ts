/**
 * BLOCK-342 切片4 — 渐变编辑（纯逻辑，可单测）。
 *
 * 形态：线性/径向两 stop 渐变 → `<defs>` 内 insert；应用=白名单 `set_attr fill="url(#id)"`；
 * stop 颜色/偏移编辑=`set_attr` 到 stop（自建 stop 带 id，外来 stop 走 path）。
 * 不做 CSS 简写/多 stop 拖拽——按需 reopen，不假装支持。
 */
import type { SvgOp } from './svgEditorModel';

export interface GradientStop { offset: number; color: string; opacity?: number }
export interface GradientDef {
  id: string;
  kind: 'linear' | 'radial';
  stops: GradientStop[];
  /** 方向/几何属性原文（x1,y1,x2,y2 / cx,cy,r） */
  attrs: Record<string, string>;
}

export type GradientDirection = 'h' | 'v' | 'd';

/** 编辑目标：优先 id（自建元素带 id），否则 live DOM path。 */
export type GradientTarget = { id?: string; path?: number[] };

const COLOR_RE = /^#[0-9a-fA-F]{3,8}$|^rgba?\(|^hsla?\(|^[a-zA-Z]+$/;

/** 从视图 markup 解析文档内全部渐变（DOMParser；解析失败返回空数组不猜）。 */
export function parseGradients(markup: string): GradientDef[] {
  if (typeof DOMParser === 'undefined' || !markup) return [];
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror')[0]) return [];
  const out: GradientDef[] = [];
  doc.querySelectorAll('linearGradient, radialGradient').forEach((el) => {
    const id = el.getAttribute('id') || '';
    if (!id) return;
    const stops: GradientStop[] = Array.from(el.querySelectorAll('stop')).map((stop) => {
      const raw = (stop.getAttribute('offset') || '0').trim();
      const offset = raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw);
      const color = stop.getAttribute('stop-color') || '#000000';
      const opacityRaw = stop.getAttribute('stop-opacity');
      return { offset: Number.isFinite(offset) ? Math.max(0, Math.min(1, offset)) : 0, color, ...(opacityRaw ? { opacity: Number(opacityRaw) } : {}) };
    });
    const attrs: Record<string, string> = {};
    for (const name of ['x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'fx', 'fy', 'gradientUnits', 'gradientTransform']) {
      const v = el.getAttribute(name);
      if (v !== null) attrs[name] = v;
    }
    out.push({ id, kind: el.tagName.toLowerCase() === 'radialgradient' ? 'radial' : 'linear', stops, attrs });
  });
  return out;
}

/** 新 id：g1/g2/…（跳过文档已用 id）。 */
export function newGradientId(existingIds: ReadonlyArray<string>): string {
  const used = new Set(existingIds);
  for (let i = 1; i < 10_000; i += 1) {
    const id = `g${i}`;
    if (!used.has(id)) return id;
  }
  return `g${Date.now()}`;
}

function safeColor(color: string): string {
  const c = (color || '').trim();
  return COLOR_RE.test(c) && !/[<>"']/.test(c) ? c : '#000000';
}

/** 方向预设 → 线性渐变几何（objectBoundingBox 默认单位，百分比）。 */
export function linearDirectionAttrs(direction: GradientDirection): Record<string, string> {
  if (direction === 'v') return { x1: '0%', y1: '0%', x2: '0%', y2: '100%' };
  if (direction === 'd') return { x1: '0%', y1: '0%', x2: '100%', y2: '100%' };
  return { x1: '0%', y1: '0%', x2: '100%', y2: '0%' };
}

/**
 * 渐变空壳 markup（开闭对、无子元素——后端 insert 的 markup 是「恰好一个元素」口径
 * （parseSvg.elements 为全量后代计数），子元素须走后续逐个 insert，见 gradientInsertOps）。
 * 颜色经形态守卫（非法回落 #000000，不把引号/尖括号带进属性）。
 */
export function gradientMarkup(def: {
  id: string;
  kind: 'linear' | 'radial';
  direction?: GradientDirection;
}): string {
  if (def.kind === 'radial') {
    return `<radialGradient id="${def.id}" cx="50%" cy="50%" r="50%"></radialGradient>`;
  }
  const dir = linearDirectionAttrs(def.direction ?? 'h');
  return `<linearGradient id="${def.id}" x1="${dir.x1}" y1="${dir.y1}" x2="${dir.x2}" y2="${dir.y2}"></linearGradient>`;
}

/** stop markup（带 id 便于后续按 id 编辑）。 */
export function gradientStopMarkup(id: string, index: 0 | 1, color: string): string {
  const offset = index === 0 ? 0 : 1;
  return `<stop id="${id}-s${index}" offset="${offset}" stop-color="${safeColor(color)}" />`;
}

/**
 * 建渐变的 op 序列（全部单元素 insert，合后端「恰好一个元素」口径）：
 * 无 `<defs>` 时先在根 `end` 插一个（不扰动既有元素 path 索引），再插空壳渐变（按 defs path），
 * 最后逐个 insert stop（parent 按渐变 id 定位——顺序应用语义下该 id 已在场）。
 * @param defsPath 已存在的 defs 的 path；null = 不存在，由本函数创建在根末尾（path=[rootChildCount]）
 */
export function gradientInsertOps(
  def: { id: string; kind: 'linear' | 'radial'; from: string; to: string; direction?: GradientDirection },
  defsPath: number[] | null,
  rootChildCount: number,
): SvgOp[] {
  const shell = gradientMarkup(def);
  const stops = [gradientStopMarkup(def.id, 0, def.from), gradientStopMarkup(def.id, 1, def.to)];
  const shellParent = defsPath ? { path: defsPath } : { path: [rootChildCount] };
  return [
    ...(defsPath
      ? []
      : [{ op: 'insert' as const, parent: { path: [] as number[] }, index: 'end' as const, markup: '<defs></defs>' }]),
    { op: 'insert', parent: shellParent, index: 'end', markup: shell },
    ...stops.map((m) => ({ op: 'insert', parent: { id: def.id }, index: 'end' as const, markup: m })),
  ];
}

/** 应用渐变到目标：白名单 set_attr fill=url(#id)。 */
export function applyGradientOps(
  targets: ReadonlyArray<GradientTarget>,
  gradientId: string,
  attr: 'fill' | 'stroke' = 'fill',
): SvgOp[] {
  return targets.map((t) => ({
    op: 'set_attr',
    target: t.id ? { id: t.id } : { path: t.path ?? [] },
    name: attr,
    value: `url(#${gradientId})`,
  }));
}

/** stop 编辑：颜色/偏移 → set_attr（目标优先 id，否则 path）。offset 钳到 [0,1]。 */
export function stopEditOps(
  target: GradientTarget,
  patch: { color?: string; offset?: number },
): SvgOp[] {
  const t = target.id ? { id: target.id } : { path: target.path ?? [] };
  const ops: SvgOp[] = [];
  if (patch.color !== undefined) ops.push({ op: 'set_attr', target: t, name: 'stop-color', value: safeColor(patch.color) });
  if (patch.offset !== undefined && Number.isFinite(patch.offset)) {
    ops.push({ op: 'set_attr', target: t, name: 'offset', value: String(Math.max(0, Math.min(1, Math.round(patch.offset * 100) / 100))) });
  }
  return ops;
}

/** 从 fill/stroke 值提取引用的渐变 id（`url(#g1)` → g1；非引用返回 null）。 */
export function gradientRefOf(value: string | undefined | null): string | null {
  const m = /^url\(\s*#([^)\s'"]+)\s*\)$/.exec((value || '').trim());
  return m ? m[1] : null;
}

/** 预览用 CSS 渐变（纯字符串计算，渲染期可用）。 */
export function gradientPreviewCss(def: GradientDef): string {
  const stops = def.stops.length > 0 ? def.stops : [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }];
  const list = stops.map((s) => `${safeColor(s.color)} ${Math.round(s.offset * 100)}%`).join(', ');
  return def.kind === 'radial' ? `radial-gradient(circle, ${list})` : `linear-gradient(90deg, ${list})`;
}
