/**
 * svgEditorModel.ts — BLOCK-342 W1 编辑器纯逻辑（无 React、可单测）。
 *
 * 分工纪律：
 *  - 真值改写只走后端 span 引擎（svg_edit）；本文件只做「视图层」换算——元素路径、
 *    transform 合成、快捷键映射、缩放钳制、危险内容清理（视图用，不写回真值）。
 *  - 编辑器 DOM 是活视图：拖拽即时改 style 反馈，手势结束折算成 op 提交，保存时一次性写盘。
 */

export type SvgOp = Record<string, unknown> & { op: string };

export type EditorCommand =
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'save' }
  | { type: 'delete' }
  | { type: 'duplicate' }
  | { type: 'palette' }
  | { type: 'escape' }
  | { type: 'order'; direction: 'up' | 'down' }
  | { type: 'nudge'; dx: number; dy: number };

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;
export const NUDGE_STEP = 1;
export const NUDGE_STEP_LARGE = 10;

/** 元素在 <svg> 根下的子元素序号路径（与后端 {path} 定位器同源）。 */
export function elementPath(root: Element, el: Element | null): number[] | null {
  if (!el) return null;
  const path: number[] = [];
  let cur: Element | null = el;
  while (cur && cur !== root) {
    const parent: Element | null = cur.parentElement;
    if (!parent) return null;
    const idx = Array.prototype.indexOf.call(parent.children, cur);
    if (idx < 0) return null;
    path.unshift(idx);
    cur = parent;
  }
  return cur === root ? path : null;
}

/** 按 path 在根下找元素；越界返回 null。 */
export function findByPath(root: Element, path: number[]): Element | null {
  let cur: Element | null = root;
  for (const step of path) {
    if (!cur) return null;
    cur = (cur.children[step]) ?? null;
  }
  return cur;
}

export function pathKey(path: number[]): string {
  return path.join('.');
}

export function formatNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

const TRANSLATE_ONLY_RE = /^\s*translate\(\s*(-?[\d.]+)(?:[ ,]+(-?[\d.]+))?\s*\)\s*$/;

/**
 * 在已有 transform 基础上再叠加一段平移。
 * 纯 translate（最常见）→ 数值累加（避免长串堆叠）；其他形态 → 末尾追加一段（等价于先平移）。
 */
export function composeTranslate(current: string | null | undefined, dx: number, dy: number): string {
  const base = (current || '').trim();
  if (base === '') return `translate(${formatNumber(dx)} ${formatNumber(dy)})`;
  const match = TRANSLATE_ONLY_RE.exec(base);
  if (match) {
    const x = Number(match[1] || 0) + dx;
    const y = Number(match[2] || 0) + dy;
    return `translate(${formatNumber(x)} ${formatNumber(y)})`;
  }
  return `${base} translate(${formatNumber(dx)} ${formatNumber(dy)})`;
}

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** 滚轮缩放：以指针位置为锚，返回新的 scale 与滚动偏移修正量（视图层用）。 */
export function zoomAtPoint(scale: number, deltaY: number): number {
  const factor = deltaY > 0 ? 0.9 : 1.1;
  return clampScale(scale * factor);
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || el.isContentEditable === true;
}

/** 快捷键 → 编辑器命令（无命令返回 null；输入框内一律不触发）。 */
export function keyToCommand(event: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: EventTarget | null;
}): EditorCommand | null {
  if (isEditableTarget(event.target ?? null)) return null;
  const mod = event.metaKey === true || event.ctrlKey === true;
  const key = event.key;

  if (mod && (key === 'k' || key === 'K')) return { type: 'palette' };
  if (mod && (key === 'z' || key === 'Z')) return event.shiftKey ? { type: 'redo' } : { type: 'undo' };
  if (mod && (key === 'y' || key === 'Y')) return { type: 'redo' };
  if (mod && (key === 's' || key === 'S')) return { type: 'save' };
  if (mod && (key === 'd' || key === 'D')) return { type: 'duplicate' };
  if (key === 'Escape') return { type: 'escape' };
  if (key === 'Delete' || key === 'Backspace') return { type: 'delete' };
  if (key === 'ArrowLeft') return { type: 'nudge', dx: -(event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP), dy: 0 };
  if (key === 'ArrowRight') return { type: 'nudge', dx: event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP, dy: 0 };
  if (key === 'ArrowUp') return { type: 'nudge', dx: 0, dy: -(event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP) };
  if (key === 'ArrowDown') return { type: 'nudge', dx: 0, dy: event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP };
  return null;
}

/** 删除 op（根元素由后端拒收，前端也先挡一层给出可读原因）。 */
export function removeOp(path: number[]): SvgOp {
  return { op: 'remove', target: { path } };
}

/** 平移 op（拖拽/微移共用一条换算，保证两端语义一致）。 */
export function translateOp(path: number[], dx: number, dy: number, currentTransform: string | null): SvgOp {
  return {
    op: 'set_attr',
    target: { path },
    name: 'transform',
    value: composeTranslate(currentTransform, dx, dy),
  };
}

/** 层序调整：把元素移到自己父元素的指定位置。 */
export function orderOp(path: number[], direction: 'up' | 'down'): SvgOp | null {
  if (path.length === 0) return null;
  const parent = path.slice(0, -1);
  const index = path[path.length - 1];
  const nextIndex = direction === 'up' ? index - 1 : index + 1;
  if (nextIndex < 0) return null;
  return { op: 'move', target: { path }, parent: { path: parent }, index: nextIndex };
}

export function duplicateOp(path: number[], markup: string): SvgOp | null {
  if (path.length === 0) return null;
  return {
    op: 'insert',
    parent: { path: path.slice(0, -1) },
    index: path[path.length - 1] + 1,
    markup,
  };
}

export interface SanitizedView {
  ok: boolean;
  markup?: string;
  error?: string;
  removed: number;
}

const DANGEROUS_TAGS = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed']);

/**
 * 视图层清理：编辑器内联渲染前剥掉可执行内容（真值不改——保存只写 op）。
 * 用 DOMParser 解析 XML；解析失败如实返回错误（不猜测修复）。
 */
export function sanitizeSvgForView(text: string): SanitizedView {
  if (typeof DOMParser === 'undefined') return { ok: false, error: 'do_not_parser_unavailable', removed: 0 };
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') {
    return { ok: false, error: 'svg_parse_error', removed: 0 };
  }
  const parserError = doc.getElementsByTagName('parsererror')[0];
  if (parserError) return { ok: false, error: 'svg_parse_error', removed: 0 };

  let removed = 0;
  const kill: Element[] = [];
  // root 自身也要清（onload 常挂在 <svg> 上）
  const all: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
  all.forEach((el) => {
    const tag = el.tagName.toLowerCase();
    if (DANGEROUS_TAGS.has(tag)) {
      kill.push(el);
      removed += 1;
      return;
    }
    Array.prototype.slice.call(el.attributes).forEach((attr: Attr) => {
      const name = attr.name.toLowerCase();
      const value = String(attr.value || '').replace(/\s+/g, '').toLowerCase();
      const badOn = name.startsWith('on');
      const badHref = (name === 'href' || name === 'xlink:href') && (value.startsWith('javascript:') || value.startsWith('vbscript:'));
      if (badOn || badHref) {
        el.removeAttribute(attr.name);
        removed += 1;
      }
    });
  });
  kill.forEach((el) => { if (el.parentNode) el.parentNode.removeChild(el); });
  root.querySelectorAll('script,foreignObject').forEach((el) => { if (el.parentNode) el.parentNode.removeChild(el); });

  const serializer = typeof XMLSerializer !== 'undefined' ? new XMLSerializer() : null;
  if (!serializer) return { ok: false, error: 'serializer_unavailable', removed };
  return { ok: true, markup: serializer.serializeToString(root), removed };
}

/** 选区合并矩形（框选命中判定用，坐标相对画布容器）。 */
export interface Box { x: number; y: number; width: number; height: number }

export function normalizeBox(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

export function boxIntersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** 选中元素的可读标签（图层树/属性栏共用）。 */
export function elementLabel(el: Element | null): string {
  if (!el) return '—';
  const id = el.getAttribute('id');
  const tag = el.tagName;
  if (id) return `#${id}`;
  const cls = el.getAttribute('class');
  return cls ? `${tag}.${cls.split(/\s+/)[0]}` : tag;
}
