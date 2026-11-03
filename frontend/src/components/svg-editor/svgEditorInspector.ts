/**
 * BLOCK-342 W2/W3/W4 — 编辑器属性、色板、样式与绘制工具（纯逻辑，可单测）。
 *
 * 设计：所有「人改的东西」最终都折算成与 agent 共用的白名单 op（set_attr / set_style / set_text / insert），
 * 这里只负责「值 → op」的确定映射与只读提取，不持有 DOM 状态、不发请求。
 */
import type { SvgOp } from './svgEditorModel';

/** 属性面板可编辑项（白名单：不进 SVG 规范外的自定义属性）。 */
export const EDITABLE_ATTRS: ReadonlyArray<{
  name: string;
  label: string;
  kind: 'text' | 'number' | 'color' | 'select';
  options?: readonly string[];
  placeholder?: string;
}> = [
  { name: 'fill', label: '填充', kind: 'color', placeholder: '#4a7cba / none' },
  { name: 'stroke', label: '描边', kind: 'color', placeholder: '#333 / none' },
  { name: 'stroke-width', label: '描边宽', kind: 'number' },
  { name: 'opacity', label: '不透明度', kind: 'number' },
  { name: 'font-size', label: '字号', kind: 'number' },
  { name: 'font-family', label: '字体', kind: 'text' },
  { name: 'font-weight', label: '字重', kind: 'select', options: ['normal', 'bold', '300', '600', '700'] },
  { name: 'text-anchor', label: '对齐', kind: 'select', options: ['start', 'middle', 'end'] },
] as const;

/** 从活视图读属性值（只读；渲染期不调用，事件里调用后落 state）。 */
export function readAttrs(el: Element | null, names: ReadonlyArray<string> = EDITABLE_ATTRS.map((a) => a.name)): Record<string, string> {
  const out: Record<string, string> = {};
  if (!el) return out;
  for (const name of names) {
    const value = el.getAttribute(name);
    if (value !== null && value !== '') out[name] = value;
  }
  return out;
}

/** 文档色板：遍历 fill/stroke 的实色（排除 none/inherit/currentColor/渐变引用），按出现次数降序。 */
export function extractPalette(root: Element | null, limit = 24): Array<{ color: string; count: number }> {
  if (!root) return [];
  const counts = new Map<string, number>();
  const all = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of all) {
    for (const name of ['fill', 'stroke']) {
      const raw = (el.getAttribute(name) || '').trim().toLowerCase();
      if (!raw) continue;
      if (raw === 'none' || raw === 'inherit' || raw === 'currentcolor' || raw === 'transparent') continue;
      if (raw.startsWith('url(')) continue;
      if (!/^#[0-9a-f]{3,8}$/.test(raw) && !/^rgba?\(/.test(raw) && !/^hsla?\(/.test(raw)) continue;
      counts.set(raw, (counts.get(raw) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([color, count]) => ({ color, count }))
    .sort((a, b) => b.count - a.count || a.color.localeCompare(b.color))
    .slice(0, limit);
}

/** 文档色板（纯文本解析版）：随 markup 变化即时可得，不依赖 DOM 挂载或选中事件。 */
export function extractPaletteFromMarkup(markup: string, limit = 24): Array<{ color: string; count: number }> {
  const counts = new Map<string, number>();
  const pattern = /(?:fill|stroke)\s*=\s*"([^"]+)"/gi;
  let match: RegExpExecArray | null = pattern.exec(markup);
  while (match) {
    const raw = match[1].trim().toLowerCase();
    match = pattern.exec(markup);
    if (!raw) continue;
    if (raw === 'none' || raw === 'inherit' || raw === 'currentcolor' || raw === 'transparent') continue;
    if (raw.startsWith('url(')) continue;
    if (!/^#[0-9a-f]{3,8}$/.test(raw) && !/^rgba?\(/.test(raw) && !/^hsla?\(/.test(raw)) continue;
    counts.set(raw, (counts.get(raw) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([color, count]) => ({ color, count }))
    .sort((a, b) => b.count - a.count || a.color.localeCompare(b.color))
    .slice(0, limit);
}

/** 单属性改动 → op（空值 = 删属性）。 */
export function attrOp(target: { id?: string; path: number[] | null }, name: string, value: string | null): SvgOp | null {
  const locator = target.id ? { id: target.id } : target.path ? { path: target.path } : null;
  if (!locator) return null;
  if (value === null || value.trim() === '') return { op: 'remove_attr', target: locator, name };
  return { op: 'set_attr', target: locator, name, value: value.trim() };
}

/** 批量套样式：同一组属性改动应用到多个目标（多选/同标签批量）。 */
export function batchAttrOps(
  targets: ReadonlyArray<{ id?: string; path: number[] | null }>,
  name: string,
  value: string | null,
): SvgOp[] {
  return targets.map((t) => attrOp(t, name, value)).filter((op): op is SvgOp => Boolean(op));
}

/** 样式剪贴板：一组属性的快照，粘贴时逐个 set_attr。 */
export interface StyleSnapshot {
  label: string;
  attrs: Record<string, string>;
}

export function snapshotStyle(el: Element | null): StyleSnapshot | null {
  if (!el) return null;
  const attrs = readAttrs(el);
  if (Object.keys(attrs).length === 0) return null;
  const label = el.id ? `#${el.id}` : `<${el.tagName}>`;
  return { label, attrs };
}

export function pasteStyleOps(
  targets: ReadonlyArray<{ id?: string; path: number[] | null }>,
  snapshot: StyleSnapshot,
): SvgOp[] {
  const ops: SvgOp[] = [];
  for (const target of targets) {
    for (const [name, value] of Object.entries(snapshot.attrs)) {
      const op = attrOp(target, name, value);
      if (op) ops.push(op);
    }
  }
  return ops;
}

/**
 * 文字节点（多行 tspan 正确拆行）：返回 text 元素的每段文本节点定位与内容。
 * 单段 → 一个 { path: textPath }；多 tspan → 每个 tspan 一条（行内 y/x 由各自属性决定，不改）。
 */
export function textSegmentsOf(root: SVGSVGElement | null, el: Element | null): Array<{ path: number[]; text: string; label: string }> {
  if (!root || !el) return [];
  const base = elementPathFrom(root, el);
  if (!base) return [];
  const tag = el.tagName.toLowerCase();
  if (tag !== 'text' && tag !== 'tspan') return [];
  const tspans = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'tspan');
  if (tspans.length === 0) {
    return [{ path: base, text: el.textContent || '', label: `<${tag}>` }];
  }
  return tspans.map((child) => ({
    path: elementPathFrom(root, child) || base,
    text: child.textContent || '',
    label: `<tspan> 第 ${Array.prototype.indexOf.call(el.children, child) + 1} 行`,
  }));
}

function elementPathFrom(root: Element, el: Element): number[] | null {
  const path: number[] = [];
  let node: Element | null = el;
  while (node && node !== root) {
    const parent: Element | null = node.parentElement;
    if (!parent) return null;
    const index = Array.prototype.indexOf.call(parent.children, node);
    if (index < 0) return null;
    path.unshift(index);
    node = parent;
  }
  return node === root ? path : null;
}

/** 绘制工具：拖拽矩形 → insert op（白名单 markup，交给后端安全校验）。 */
export type DrawTool = 'select' | 'rect' | 'ellipse' | 'line' | 'text';

export const DRAW_TOOLS: ReadonlyArray<{ id: DrawTool; label: string; hint: string }> = [
  { id: 'select', label: '选择', hint: '点选/框选/拖拽移动' },
  { id: 'rect', label: '矩形', hint: '拖拽画矩形' },
  { id: 'ellipse', label: '椭圆', hint: '拖拽画椭圆' },
  { id: 'line', label: '直线', hint: '拖拽画直线' },
  { id: 'text', label: '文字', hint: '拖拽出文字框后输入' },
];

export function drawOp(
  tool: Exclude<DrawTool, 'select'>,
  box: { x: number; y: number; width: number; height: number },
  opts: { color?: string; strokeWidth?: number; text?: string; parentPath?: number[] } = {},
): SvgOp | null {
  const x = Math.round(box.x);
  const y = Math.round(box.y);
  const w = Math.round(box.width);
  const h = Math.round(box.height);
  const color = opts.color || '#4a7cba';
  const stroke = opts.strokeWidth ?? 2;
  const parent = { path: opts.parentPath ?? [] };
  const round = (n: number) => Math.round(n * 10) / 10;

  if (tool === 'rect') {
    if (w < 2 || h < 2) return null;
    return { op: 'insert', parent, index: 'end', markup: `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}" />` };
  }
  if (tool === 'ellipse') {
    if (w < 2 || h < 2) return null;
    const rx = round(w / 2);
    const ry = round(h / 2);
    return { op: 'insert', parent, index: 'end', markup: `<ellipse cx="${round(x + w / 2)}" cy="${round(y + h / 2)}" rx="${rx}" ry="${ry}" fill="${color}" />` };
  }
  if (tool === 'line') {
    if (Math.abs(w) < 2 && Math.abs(h) < 2) return null;
    return { op: 'insert', parent, index: 'end', markup: `<line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" stroke="${color}" stroke-width="${stroke}" />` };
  }
  if (tool === 'text') {
    if (w < 4 || h < 4) return null;
    const label = escapeText(opts.text || '文字');
    return { op: 'insert', parent, index: 'end', markup: `<text x="${x}" y="${round(y + Math.max(12, h / 2))}" font-size="${Math.max(10, Math.min(48, Math.round(h)))}" fill="${color}">${label}</text>` };
  }
  return null;
}

function escapeText(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 选中元素 → 问 agent 的结构化引用（W4：单一 ContextItem 通道，不发明第二注入通道）。 */
export function selectionContextPrompt(input: {
  filePath: string;
  elements: Array<{ label: string; path: number[]; tag: string; attrs: Record<string, string> }>;
}): string {
  const lines = input.elements.slice(0, 12).map((el) => {
    const attrs = Object.entries(el.attrs).slice(0, 8).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `- ${el.label} <${el.tag}> path=[${el.path.join(',')}]${attrs ? ` ${attrs}` : ''}`;
  });
  return [
    `关于 ${input.filePath} 的选中元素（共 ${input.elements.length} 个）：`,
    ...lines,
    '',
    '请用 svg_edit 修改（先说方案，我确认后再 apply）。',
  ].join('\n');
}
