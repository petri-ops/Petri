/**
 * SvgEditorViewer.tsx — BLOCK-342 W1 受治理 SVG 编辑器宿主。
 *
 * 语义边界（plan §2/§3）：
 *  - 人改的就是真值文件：每个手势折算成白名单 op，保存时一次性提交后端 span 引擎写盘
 *    （before-hash 冲突检测：期间外部改过 ⇒ svg_hash_mismatch，绝不覆盖）。
 *  - 撤销/重做是**未保存修改**的视图回退（已保存历史的回滚走结果面版本链，不在 W1）。
 *  - 载入前脱敏只作用于视图（script / foreignObject / on 事件属性 / javascript: 链接）；真值不被编辑器删除。
 */

import * as React from 'react';
import { workspaceFileUrlFor } from '@/lib/previewFileUtils';
import { editSvgFile, inspectSvgFile, SvgEditError, SvgInspectResult } from '@/lib/svgEditClient';
import button from '../ui/controls/button.module.css';
import { SvgEditorCanvas } from './SvgEditorCanvas';
import {
  DRAW_TOOLS,
  ALIGN_MODES,
  EDITABLE_ATTRS,
  alignOps,
  type AlignMode,
  batchAttrOps,
  drawOp,
  extractPaletteFromMarkup,
  pasteStyleOps,
  readAttrs,
  selectionContextPrompt,
  snapshotStyle,
  textSegmentsOf,
  type DrawTool,
  type StyleSnapshot,
} from './svgEditorInspector';
import { dispatchPetriEvent, petriEvents } from '@/lib/events';
import { listSvgRevisions, readSvgRevision } from '@/lib/svgEditClient';
import {
  duplicateOp,
  findByPath,
  keyToCommand,
  orderOp,
  pathKey,
  SvgOp,
  sanitizeSvgForView,
  translateOp,
  zoomAtPoint,
  clampScale,
} from './svgEditorModel';
import styles from './SvgEditorViewer.module.css';
import layout from './SvgEditorLayout.module.css';

export interface SvgEditorViewerProps {
  projectId: string;
  filePath: string;
  /** 宿主为全屏 modal 时初始即全宽（窄预览区放不下三卡+右栏）。 */
  defaultExpanded?: boolean;
  /** 宿主 modal 的「关闭编辑器」回调（工具条按钮与 Esc 都会触发）。 */
  onExitExpanded?: () => void;
  name?: string;
  active?: boolean;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'failed'; reason: string }
  | { status: 'ready'; inspect: SvgInspectResult; baseSha: string; removed: number };

interface HistoryEntry {
  markup: string;
  opsLen: number;
}

/** 命令面板清单（模块级：不含闭包，渲染期零 ref 访问）。 */
const COMMANDS = [
  { id: 'save', label: '保存修改（⌘S）' },
  { id: 'undo', label: '撤销未保存修改（⌘Z）' },
  { id: 'redo', label: '重做（⇧⌘Z）' },
  { id: 'delete', label: '删除选中元素（Delete）' },
  { id: 'duplicate', label: '复制选中元素（⌘D）' },
  { id: 'up', label: '上移一层' },
  { id: 'down', label: '下移一层' },
  { id: 'reload', label: '重新载入（丢弃未保存修改）' },
] as const;

interface LoadedDocument {
  inspect: SvgInspectResult;
  markup: string;
  removed: number;
}

/** 模块级取数（含视图脱敏）：供挂载 effect 与「重新载入」共用，不在组件作用域里同步 setState。 */
async function fetchSvgDocument(projectId: string, filePath: string): Promise<LoadedDocument> {
  const inspect = await inspectSvgFile({ projectId, path: filePath });
  const response = await fetch(workspaceFileUrlFor(projectId, filePath));
  if (!response.ok) throw new Error(`读取 SVG 失败：HTTP ${response.status}`);
  const text = await response.text();
  const view = sanitizeSvgForView(text);
  if (!view.ok) throw new Error(`SVG 无法载入（${view.error || 'parse_error'}）`);
  return { inspect, markup: view.markup || '', removed: view.removed };
}

/** 把白名单 op 落到活视图（即时反馈；真值仍以保存时的后端 span 改写为准）。 */
function applyOpsToDom(root: SVGSVGElement, ops: ReadonlyArray<SvgOp>): void {
  const resolve = (target: unknown): Element | null => {
    if (!target || typeof target !== 'object') return null;
    const t = target as { id?: string; path?: number[] };
    if (t.id) return root.querySelector(`#${CSS.escape(t.id)}`);
    return Array.isArray(t.path) ? findByPath(root, t.path) : null;
  };
  const str = (value: unknown): string => (typeof value === 'string' ? value : '');
  for (const op of ops) {
    const o = op as Record<string, unknown>;
    const kind = str(o.op);
    const el = resolve(o.target);
    if (kind === 'set_attr') {
      if (el) el.setAttribute(str(o.name), str(o.value));
    } else if (kind === 'remove_attr') {
      if (el) el.removeAttribute(str(o.name));
    } else if (kind === 'set_style') {
      const props = (o.props && typeof o.props === 'object' ? o.props : {}) as Record<string, unknown>;
      if (el && el instanceof SVGElement) {
        for (const [name, value] of Object.entries(props)) {
          el.style.setProperty(name, typeof value === 'string' ? value : '');
        }
      }
    } else if (kind === 'set_text') {
      if (el) el.textContent = str(o.text);
    } else if (kind === 'remove') {
      if (el) el.remove();
    } else if (kind === 'insert') {
      const parent = resolve(o.parent) || root;
      const markup = str(o.markup);
      if (!parent || !markup) continue;
      const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml');
      const fragment = doc.documentElement.firstElementChild;
      if (!fragment) continue;
      const imported = root.ownerDocument.importNode(fragment, true);
      const index = o.index;
      if (index === 'end' || typeof index !== 'number') parent.appendChild(imported);
      else parent.insertBefore(imported, parent.children[index] || null);
    } else if (kind === 'move') {
      const parent = resolve(o.parent) || root;
      const index = o.index;
      if (el && parent) {
        if (index === 'end' || typeof index !== 'number') parent.appendChild(el);
        else parent.insertBefore(el, parent.children[index] || null);
      }
    }
  }
}


/** color input 只认 #rrggbb：非 hex 值（none/rgb()/渐变）给中性灰，避免受控值非法。 */
function toHexColor(value: string | undefined): string {
  if (!value) return '#000000';
  const raw = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-f]{3}$/.test(raw)) return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  return '#888888';
}

function decodePath(key: string): number[] {
  return key === '' ? [] : key.split('.').map((part) => Number(part));
}

function comparePathDesc(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const av = i < a.length ? a[i] : -1;
    const bv = i < b.length ? b[i] : -1;
    if (av !== bv) return bv - av;
  }
  return 0;
}

export function SvgEditorViewer({
  defaultExpanded = false,
  onExitExpanded, projectId, filePath, name, active = true }: SvgEditorViewerProps) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const markupRef = React.useRef('');
  const opsRef = React.useRef<SvgOp[]>([]);

  const [state, setState] = React.useState<LoadState>({ status: 'loading' });
  const [markup, setMarkup] = React.useState('');
  const [pendingOps, setPendingOps] = React.useState<SvgOp[]>([]);
  const [history, setHistory] = React.useState<HistoryEntry[]>([]);
  const [future, setFuture] = React.useState<HistoryEntry[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [scale, setScale] = React.useState(1);
  const [saving, setSaving] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  // W2/W3/W4 — 绘制工具 / 选中属性 / 文档色板 / 样式剪贴板 / 行内文字编辑
  const [tool, setTool] = React.useState<DrawTool>('select');
  const [selectedProps, setSelectedProps] = React.useState<Record<string, string>>({});
  const [styleClip, setStyleClip] = React.useState<StyleSnapshot | null>(null);
  // W4 逐元素取舍：磁盘真值基线 + 当前差异清单
  // 交互：右栏空间有限 —— 分区折叠（默认只开「图形属性」），整栏可收，工具栏可收
  // 默认全收起：先给画布空间，用户点开才占用（用户裁决：默认收起而非占位）
  const [inspectorOpen, setInspectorOpen] = React.useState(false);
  const [layersOpen, setLayersOpen] = React.useState(false);
  // 宿主为全屏 modal 时初始即全宽（否则在窄预览区里三卡+右栏放不下）
  const [expanded, setExpanded] = React.useState(defaultExpanded === true);
  // 历史预览：只读显示某一版（不改真值、不进 pendingOps）
  const [preview, setPreview] = React.useState<{ revision: string; at: string; markup: string; elements: Array<{ tag: string; path: number[]; id: string | null; attrCount: number; textPreview?: string }> } | null>(null);
  const [revisions, setRevisions] = React.useState<Array<{ file: string; at: string; sha8: string; sizeBytes: number }>>([]);
  const [textEdit, setTextEdit] = React.useState<{ path: number[]; label: string; value: string; list: Array<{ path: number[]; label: string; text: string }> } | null>(null);

  // 事件回调需要「最新值」而闭包可能陈旧，故用镜像 ref；同步在 effect 里做（不在渲染期写 ref）。
  React.useEffect(() => {
    markupRef.current = markup;
    opsRef.current = pendingOps;
  }, [markup, pendingOps]);

  const rootEl = React.useCallback((): SVGSVGElement | null => {
    const host = hostRef.current;
    return host ? (host.querySelector('svg')) : null;
  }, []);

  /** 把一次成功的载入结果落到组件状态（只在异步回调/事件里调用，不在 effect 同步段调用）。 */
  const applyLoaded = React.useCallback((doc: LoadedDocument) => {
    setMarkup(doc.markup);
    markupRef.current = doc.markup;
    setState({ status: 'ready', inspect: doc.inspect, baseSha: doc.inspect.sha256, removed: doc.removed });
    setPendingOps([]);
    setHistory([]);
    setFuture([]);
    setSelected(new Set());
    setScale(1);
    setError(null);
    setNotice(null);
  }, []);

  const applyFailed = React.useCallback((loadError: unknown) => {
    setState({ status: 'failed', reason: loadError instanceof Error ? loadError.message : String(loadError) });
  }, []);

  const load = React.useCallback(() => {
    setState({ status: 'loading' });
    setError(null);
    setNotice(null);
    return fetchSvgDocument(projectId, filePath).then(applyLoaded).catch(applyFailed);
  }, [applyFailed, applyLoaded, filePath, projectId]);

  React.useEffect(() => {
    let cancelled = false;
    fetchSvgDocument(projectId, filePath)
      .then((doc) => { if (!cancelled) applyLoaded(doc); })
      .catch((error: unknown) => { if (!cancelled) applyFailed(error); });
    return () => { cancelled = true; };
  }, [applyFailed, applyLoaded, filePath, projectId]);

  const commit = React.useCallback((ops: SvgOp[], nextMarkup: string) => {
    if (ops.length === 0) return;
    // 先落到活视图（即时渲染），再从 DOM 序列化真值——只 setMarkup 不动 DOM 会导致「保存了才生效」
    const root = rootEl();
    if (root) applyOpsToDom(root, ops);
    const resolvedMarkup = root ? root.outerHTML : nextMarkup;
    setHistory((prev) => [...prev, { markup: markupRef.current, opsLen: opsRef.current.length }]);
    setFuture([]);
    setPendingOps((prev) => [...prev, ...ops]);
    markupRef.current = resolvedMarkup;
    setMarkup(resolvedMarkup);
    setNotice(null);
    setError(null);
  }, [rootEl]);

  const currentMarkup = React.useCallback((): string => rootEl()?.outerHTML || markupRef.current, [rootEl]);

  const handleOpsCommitted = React.useCallback((ops: SvgOp[]) => {
    commit(ops, currentMarkup());
    setSelected(new Set());
  }, [commit, currentMarkup]);

  /** 选中变化：同时刷新属性面板与文档色板（都在事件里读活视图，渲染期不读 ref/DOM）。 */
  const syncSelection = React.useCallback((next: Set<string>) => {
    setSelected(next);
    // 点图片内容（选中元素）= 用户进入编辑：图层与属性一起展开（用户裁决）
    if (next.size > 0) {
      setInspectorOpen(true);
      setLayersOpen(true);
    }
    const root = rootEl();
    const first = next.size > 0 ? Array.from(next)[0] : null;
    const el = root && first !== null ? findByPath(root, decodePath(first)) : null;
    setSelectedProps(readAttrs(el));
    setTextEdit(null);
    void listSvgRevisions({ projectId, path: filePath, limit: 30 })
      .then((list) => setRevisions(list))
      .catch((revisionError: unknown) => {
        setRevisions([]);
        setNotice(`修订历史读取失败：${revisionError instanceof Error ? revisionError.message : String(revisionError)}`);
      });
  }, [rootEl]);

  /** 属性改动：批量应用到当前选中（多选天然支持「批量套样式」）。 */
  const applyAttr = React.useCallback((name: string, value: string) => {
    const root = rootEl();
    if (!root || selected.size === 0) return;
    const targets = Array.from(selected).map((key) => {
      const path = decodePath(key);
      const el = findByPath(root, path);
      return { id: el?.getAttribute('id') || undefined, path };
    });
    const trimmed = value.trim();
    const ops = batchAttrOps(targets, name, trimmed === '' ? null : trimmed);
    if (ops.length === 0) return;
    commit(ops, currentMarkup());
    setSelectedProps((prev) => (trimmed === '' ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== name)) : { ...prev, [name]: trimmed }));
  }, [commit, currentMarkup, rootEl, selected]);

  /** W3 绘制：拖出的框 → 白名单 insert op。 */
  const handleDrawBox = React.useCallback((box: { x: number; y: number; width: number; height: number }) => {
    if (tool === 'select') return;
    const color = selectedProps.fill || '#4a7cba';
    const op = drawOp(tool, box, { color, strokeWidth: Number(selectedProps['stroke-width']) || 2 });
    if (!op) return;
    setTool('select');
    commit([op], currentMarkup());
    setNotice(`已插入 <${tool}>；⌘S 保存到文件`);
  }, [commit, currentMarkup, selectedProps, tool]);

  /** W2 行内文字：双击 text/tspan 打开覆盖输入（多行 tspan 逐段编辑）。 */
  const openTextEditor = React.useCallback(() => {
    const root = rootEl();
    if (!root || selected.size !== 1) return;
    const el = findByPath(root, decodePath(Array.from(selected)[0]));
    const list = textSegmentsOf(root, el);
    if (list.length === 0) return;
    const first = list[0];
    setTextEdit({ path: first.path, label: first.label, value: first.text, list });
  }, [rootEl, selected]);

  /** W4 选区 → 会话（单一 ContextItem 通道 copilotAsk，不建第二注入面）。 */
  const askAgent = React.useCallback(() => {
    const root = rootEl();
    if (!root || selected.size === 0) return;
    const elements = Array.from(selected).slice(0, 12).map((key) => {
      const path = decodePath(key);
      const el = findByPath(root, path);
      return {
        label: el?.getAttribute('id') ? `#${el.getAttribute('id')}` : `<${el?.tagName || '?'}>`,
        path,
        tag: (el?.tagName || '').toLowerCase(),
        attrs: readAttrs(el),
      };
    });
    dispatchPetriEvent(petriEvents.copilotAsk, { prompt: selectionContextPrompt({ filePath, elements }) });
    setNotice('已把选中元素与属性放进会话输入框');
  }, [filePath, rootEl, selected]);

  /** W2 样式剪贴板：复制当前选中元素的样式（属性白名单内）。 */
  const copyStyle = React.useCallback(() => {
    const root = rootEl();
    if (!root || selected.size !== 1) return;
    const snapshot = snapshotStyle(findByPath(root, decodePath(Array.from(selected)[0])));
    if (!snapshot) { setNotice('该元素没有可复制的样式属性'); return; }
    setStyleClip(snapshot);
    setNotice(`已复制样式：${snapshot.label}（${Object.keys(snapshot.attrs).length} 项）`);
  }, [rootEl, selected]);

  /** W2 样式粘贴：应用到当前全部选中（多元素批量套样式）。 */
  const pasteStyle = React.useCallback(() => {
    const root = rootEl();
    if (!root || !styleClip || selected.size === 0) return;
    const targets = Array.from(selected).map((key) => {
      const path = decodePath(key);
      const el = findByPath(root, path);
      return { id: el?.getAttribute('id') || undefined, path };
    });
    const ops = pasteStyleOps(targets, styleClip);
    if (ops.length === 0) return;
    commit(ops, currentMarkup());
    setNotice(`已把 ${styleClip.label} 的样式套到 ${targets.length} 个元素`);
  }, [commit, currentMarkup, rootEl, selected, styleClip]);

  /**
   * W4 改动清单：磁盘真值 vs 当前未保存视图的逐元素差异。
   * 基线现读磁盘（cache:no-store）而不是复用加载时快照——「磁盘真值」的定义就是文件当前内容，
   * 快照会与外部改动/上次保存脱节（UI-663 实机空清单的根因方向）。
   */
  /** 多选对齐：按整体包围盒平移（只改 transform，不动几何定义）。 */
  const applyAlign = React.useCallback((mode: AlignMode) => {
    const root = rootEl();
    if (!root || selected.size < 2) return;
    const entries = Array.from(selected).map((key) => {
      const path = decodePath(key);
      const el = findByPath(root, path);
      const box = el && typeof (el as SVGGraphicsElement).getBBox === 'function'
        ? (el as SVGGraphicsElement).getBBox()
        : { x: 0, y: 0, width: 0, height: 0 };
      return {
        key,
        id: el?.getAttribute('id') || undefined,
        path,
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
        transform: el?.getAttribute('transform') ?? null,
      };
    });
    const ops = alignOps(entries, mode);
    if (ops.length === 0) { setNotice('已对齐，无需移动'); return; }
    commit(ops, currentMarkup());
    setNotice(`已对齐 ${entries.length} 个元素`);
  }, [commit, currentMarkup, rootEl, selected]);

  /** 适应窗口：按 viewBox 与容器宽度定缩放（不改文档）。 */
  const fitToView = React.useCallback(() => {
    const root = rootEl();
    const host = hostRef.current;
    if (!root || !host) return;
    const viewBox = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    const width = viewBox.length === 4 && viewBox[2] > 0 ? viewBox[2] : root.getBoundingClientRect().width / scale;
    const available = host.clientWidth - 28;
    if (!width || available <= 0) return;
    setScale(clampScale(Math.min(2, available / width)));
  }, [rootEl, scale]);


  /** W4 逐元素拒绝：把该元素恢复成磁盘形态（只产出白名单 op）。 */

  /** W4 全部拒绝：回到磁盘真值形态（不可逆项如实跳过并提示）。 */

  /** 点历史条目：只读预览那一版（画布与图层树都切过去，不改真值、不进 pendingOps）。 */
  const openRevision = React.useCallback((item: { file: string; at: string }) => {
    void readSvgRevision({ projectId, path: filePath, revision: item.file })
      .then((content) => {
        const view = sanitizeSvgForView(content.text);
        setPreview({ revision: item.file, at: item.at, markup: view.ok ? (view.markup || '') : '', elements: content.elements });
      })
      .catch((error: unknown) => {
        setNotice(`读取历史快照失败：${error instanceof Error ? error.message : String(error)}`);
      });
  }, [filePath, projectId]);

  const undo = React.useCallback(() => {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const entry = prev[prev.length - 1];
      setFuture((f) => [...f, { markup: markupRef.current, opsLen: opsRef.current.length }]);
      setPendingOps((ops) => ops.slice(0, entry.opsLen));
      markupRef.current = entry.markup;
      setMarkup(entry.markup);
      return prev.slice(0, -1);
    });
  }, []);

  const redo = React.useCallback(() => {
    setFuture((prev) => {
      if (prev.length === 0) return prev;
      const entry = prev[prev.length - 1];
      setHistory((h) => [...h, { markup: markupRef.current, opsLen: opsRef.current.length }]);
      setPendingOps((ops) => ops.slice(0, entry.opsLen));
      markupRef.current = entry.markup;
      setMarkup(entry.markup);
      return prev.slice(0, -1);
    });
  }, []);

  const targetFor = (el: Element): Record<string, unknown> => {
    const id = el.getAttribute('id');
    const root = rootEl();
    if (id) return { id };
    if (!root) return { path: [] };
    const path: number[] = [];
    let cur: Element | null = el;
    while (cur && cur !== root) {
      const parent: Element | null = cur.parentElement;
      if (!parent) break;
      path.unshift(Array.prototype.indexOf.call(parent.children, cur));
      cur = parent;
    }
    return { path };
  };

  const deleteSelected = React.useCallback(() => {
    const root = rootEl();
    if (!root || selected.size === 0) return;
    const targets = Array.from(selected)
      .map(decodePath)
      .sort(comparePathDesc)
      .map((path) => findByPath(root, path))
      .filter((el): el is Element => !!el && el !== root);
    if (targets.length === 0) return;
    const ops: SvgOp[] = targets.map((el) => {
      const target = targetFor(el);
      if (el.parentNode) el.parentNode.removeChild(el);
      return { op: 'remove', target };
    });
    commit(ops, currentMarkup());
    setSelected(new Set());
  }, [commit, currentMarkup, rootEl, selected]);

  const duplicateSelected = React.useCallback(() => {
    const root = rootEl();
    if (!root || selected.size === 0) return;
    const ops: SvgOp[] = [];
    Array.from(selected).forEach((key) => {
      const path = decodePath(key);
      const el = findByPath(root, path);
      if (!el || !el.parentElement) return;
      const clone = el.cloneNode(true) as Element;
      clone.removeAttribute('id');
      el.parentElement.insertBefore(clone, el.nextSibling);
      const duplicate = duplicateOp(path, clone.outerHTML);
      if (duplicate) ops.push(duplicate);
    });
    if (ops.length === 0) return;
    commit(ops, currentMarkup());
    setSelected(new Set());
  }, [commit, currentMarkup, rootEl, selected]);

  const reorder = React.useCallback((direction: 'up' | 'down') => {
    const root = rootEl();
    if (!root || selected.size !== 1) return;
    const path = decodePath(Array.from(selected)[0]);
    const el = findByPath(root, path);
    if (!el || !el.parentElement) return;
    const op = orderOp(path, direction);
    if (!op) return;
    const siblings = el.parentElement.children;
    const currentIndex = Array.prototype.indexOf.call(siblings, el);
    const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (nextIndex < 0 || nextIndex >= siblings.length) return;
    if (direction === 'up') el.parentElement.insertBefore(el, siblings[currentIndex - 1]);
    else el.parentElement.insertBefore(siblings[currentIndex + 1], el);
    commit([op], currentMarkup());
  }, [commit, currentMarkup, rootEl, selected]);

  const nudge = React.useCallback((dx: number, dy: number) => {
    const root = rootEl();
    if (!root || selected.size === 0) return;
    const ops: SvgOp[] = [];
    Array.from(selected).forEach((key) => {
      const path = decodePath(key);
      const el = findByPath(root, path);
      if (!el) return;
      const origin = el.getAttribute('transform');
      const value = translateOp(path, dx, dy, origin).value as string;
      el.setAttribute('transform', value);
      const target = targetFor(el);
      ops.push({ op: 'set_attr', target, name: 'transform', value });
    });
    if (ops.length === 0) return;
    commit(ops, currentMarkup());
  }, [commit, currentMarkup, rootEl, selected]);

  const save = React.useCallback(async () => {
    if (state.status !== 'ready' || saving) return;
    if (opsRef.current.length === 0) {
      setNotice('没有待保存的修改（零操作零 diff）。');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await editSvgFile({
        projectId,
        path: filePath,
        ops: opsRef.current,
        apply: true,
        beforeSha256: state.baseSha,
      });
      setNotice(result.changed ? `已保存：${result.semanticDiff.length} 个操作（after ${result.afterSha256.slice(0, 8)}）` : '本次修改未产生字节变化，文件未被写入。');
      await load();
    } catch (saveError) {
      if (saveError instanceof SvgEditError && saveError.code === 'svg_hash_mismatch') {
        setError('文件在编辑期间被外部修改，已阻止覆盖。请重新载入后再改（人的修改优先）。');
      } else {
        setError(saveError instanceof Error ? saveError.message : String(saveError));
      }
    } finally {
      setSaving(false);
    }
  }, [filePath, load, projectId, saving, state]);

  React.useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      const command = keyToCommand(event);
      if (!command) return;
      if (command.type === 'escape') { setSelected(new Set()); setPaletteOpen(false); return; }
      if (command.type === 'palette') { event.preventDefault(); setPaletteOpen((open) => !open); return; }
      if (command.type === 'undo') { event.preventDefault(); undo(); return; }
      if (command.type === 'redo') { event.preventDefault(); redo(); return; }
      if (command.type === 'save') { event.preventDefault(); void save(); return; }
      if (command.type === 'delete') { event.preventDefault(); deleteSelected(); return; }
      if (command.type === 'duplicate') { event.preventDefault(); duplicateSelected(); return; }
      if (command.type === 'nudge') { event.preventDefault(); nudge(command.dx, command.dy); return; }
      if (command.type === 'order') { event.preventDefault(); reorder(command.direction); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, deleteSelected, duplicateSelected, nudge, redo, reorder, save, undo]);

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    setScale((current) => zoomAtPoint(current, event.deltaY));
  };

  // 文档色板：随 markup 纯计算（渲染期零 DOM/ref 访问）
  const docPalette = React.useMemo(() => extractPaletteFromMarkup(markup), [markup]);

  const layerRows = preview
    ? preview.elements.filter((el) => el.path.length <= 3).slice(0, 300)
    : state.status === 'ready'
      ? state.inspect.elements.filter((el) => el.path.length <= 3).slice(0, 300)
      : [];

  // 属性面板数据源=后端 inspect（渲染期不读 DOM ref；删除/移动后以保存后的重新 inspect 为准）
  const selectedRows = state.status === 'ready'
    ? state.inspect.elements
      .filter((el) => selected.has(pathKey(el.path)))
      .slice(0, 20)
      .map((el) => ({
        key: pathKey(el.path),
        label: el.id ? `#${el.id}` : `<${el.tag}>`,
        tag: el.tag,
        attrCount: el.attrCount,
        pathLabel: `[${el.path.join(',')}]`,
      }))
    : [];

  // 命令面板只存 id/label（渲染期不持有含 ref 访问的闭包），分发在事件里做
  const runCommand = React.useCallback((id: string) => {
    switch (id) {
      case 'save': void save(); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'delete': deleteSelected(); break;
      case 'duplicate': duplicateSelected(); break;
      case 'up': reorder('up'); break;
      case 'down': reorder('down'); break;
      case 'reload': void load(); break;
      default: break;
    }
  }, [deleteSelected, duplicateSelected, load, redo, reorder, save, undo]);

  return (
    <div
      className={expanded ? `${layout.expanded} ${styles.viewer}` : styles.viewer}
      data-testid="svg-editor-viewer"
      data-file={filePath}
      data-expanded={expanded ? '1' : '0'}
    >
      <header className={styles.header}>
        <div className={styles.title}>
          <strong className={styles.name}>{name || filePath}</strong>
          <span className={styles.path}>{filePath}</span>
        </div>
        <div className={styles.actions}>
          <button type="button" className={button.ghost} onClick={() => setScale((s) => clampScale(s / 1.2))} title="缩小">−</button>
          <span className={styles.zoom} data-testid="svg-editor-zoom">{Math.round(scale * 100)}%</span>
          <button type="button" className={button.ghost} onClick={() => setScale((s) => clampScale(s * 1.2))} title="放大">+</button>
          <button type="button" className={button.ghost} onClick={undo} disabled={history.length === 0} title="撤销">撤销</button>
          <button type="button" className={button.ghost} onClick={redo} disabled={future.length === 0} title="重做">重做</button>
          <button type="button" className={button.ghost} onClick={deleteSelected} disabled={selected.size === 0} title="删除">删除</button>
          <button type="button" className={button.ghost} onClick={duplicateSelected} disabled={selected.size === 0} title="复制">复制</button>
          <button
            type="button"
            className={button.primary}
            onClick={() => { void save(); }}
            disabled={saving || pendingOps.length === 0}
            data-testid="svg-editor-save"
          >
            {saving ? '保存中…' : `保存${pendingOps.length > 0 ? `（${pendingOps.length}）` : ''}`}
          </button>
          <span
            className={styles.status}
            data-testid="svg-editor-status"
            data-state={saving ? 'saving' : pendingOps.length > 0 ? 'dirty' : 'saved'}
            title="实时预览只改视图；点「保存」（⌘S）才提交到文件"
          >
            {saving
              ? '保存中…'
              : pendingOps.length > 0
                ? `● 未保存 ${pendingOps.length} 项改动 · 实时预览中，⌘S 确认写盘`
                : `✓ 已保存${state.status === 'ready' ? ` · ${state.baseSha.slice(0, 8)}` : ''}`}
          </span>
        </div>
      </header>

      {state.status === 'loading' ? <div className={styles.note} data-testid="svg-editor-state">载入 SVG 中…</div> : null}
      {state.status === 'failed' ? (
        <div className={styles.fallback} data-testid="svg-editor-state">
          <strong>SVG 编辑器不可用</strong>
          <span>{state.reason}</span>
          <button type="button" className={button.ghost} onClick={() => { void load(); }}>重试</button>
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <div className={layout.body} data-layers={layersOpen ? '1' : '0'} data-inspector={inspectorOpen ? '1' : '0'}>
          <div className={layout.leftCol}>
          {!layersOpen ? (
            <button type="button" className={styles.railToggle} data-action="expand-layers" style={{ left: 10 }} title="展开图层">
              图层
            </button>
          ) : null}
          {!inspectorOpen ? (
            <button type="button" className={styles.railToggle} data-action="expand-inspector" style={{ right: 10 }} title="展开图形属性">
              属性
            </button>
          ) : null}

          <div className={layout.stage} onWheel={handleWheel}>
            {state.removed > 0 ? (
              <div className={styles.warn} data-testid="svg-editor-sanitized">
                视图已脱敏 {state.removed} 处（script/事件属性/危险链接）；真值未被删除。
              </div>
            ) : null}
            <div className={styles.toolbar} data-testid="svg-editor-toolbar">
              <span className={styles.toolGroup} data-testid="svg-editor-tool-group" data-open="1">
              <button
                type="button"
                className={styles.tool}
                data-action={expanded ? 'exit-expanded' : 'enter-expanded'}
                title={expanded ? '退出全屏编辑' : '全屏编辑'}
                onClick={() => {
                  setExpanded((prev) => !prev);
                  if (expanded && onExitExpanded) onExitExpanded();
                }}
              >
                {expanded ? '退出全屏' : '全屏编辑'}
              </button>
              <button type="button" className={styles.tool} onClick={fitToView} data-action="fit">适应窗口</button>
              {DRAW_TOOLS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-tool={item.id}
                  title={item.hint}
                  className={tool === item.id ? styles.toolActive : styles.tool}
                  onClick={() => setTool(item.id)}
                >
                  {item.label}
                </button>
              ))}
              </span>
            </div>
            {textEdit ? (
              <div className={styles.textEdit} data-testid="svg-editor-text-edit">
                <div className={styles.panelTitle}>{textEdit.label}</div>
                {textEdit.list.length > 1 ? (
                  <select
                    value={textEdit.path.join('.')}
                    onChange={(event) => {
                      const seg = textEdit.list.find((item) => item.path.join('.') === event.target.value);
                      if (seg) setTextEdit({ ...textEdit, path: seg.path, label: seg.label, value: seg.text });
                    }}
                  >
                    {textEdit.list.map((seg) => (
                      <option key={seg.path.join('.')} value={seg.path.join('.')}>{seg.label}</option>
                    ))}
                  </select>
                ) : null}
                <textarea
                  rows={3}
                  value={textEdit.value}
                  onChange={(event) => setTextEdit({ ...textEdit, value: event.target.value })}
                  data-testid="svg-editor-text-input"
                />
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={button.primary}
                    onClick={() => {
                      commit([{ op: 'set_text', target: { path: textEdit.path }, text: textEdit.value }], currentMarkup());
                      setTextEdit(null);
                    }}
                  >
                    应用文字
                  </button>
                  <button type="button" className={button.ghost} onClick={() => setTextEdit(null)}>取消</button>
                </div>
              </div>
            ) : null}
            <SvgEditorCanvas
              markup={preview ? preview.markup : markup}
              scale={scale}
              selected={selected}
              hostRef={hostRef}
              onSelectionChange={syncSelection}
              onOpsCommitted={preview ? () => {} : handleOpsCommitted}
              tool={tool}
              onDrawBox={handleDrawBox}
            />

          </div>

          {inspectorOpen ? (
            <aside className={layout.inspector} data-testid="svg-editor-inspector">
              <div className={styles.inspectorHead}>
                {inspectorOpen ? (
                  <>
                    <span className={styles.panelTitle}>图形属性</span>
                    <button
                      type="button"
                      className={button.ghost}
                      data-action="collapse-inspector"
                      title="收起属性栏（画布变宽）"
                      onClick={() => setInspectorOpen(false)}
                    >
                      »
                    </button>
                  </>
                ) : null}
              </div>
              {selected.size === 0 ? <div className={styles.note}>未选中元素。点画布元素或用图层树选择。</div> : null}
              <SelectedSummary rows={selectedRows} />
              {selected.size > 0 ? (
                <div className={styles.props} data-testid="svg-editor-props">
                  {EDITABLE_ATTRS.map((attr) => (
                    <label key={attr.name} className={styles.field}>
                      <span className={styles.fieldLabel}>{attr.label}</span>
                      {attr.kind === 'select' ? (
                        <select
                          data-attr={attr.name}
                          value={selectedProps[attr.name] || ''}
                          onChange={(event) => applyAttr(attr.name, event.target.value)}
                        >
                          <option value="">—</option>
                          {(attr.options || []).map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      ) : (
                        <span className={styles.fieldRow}>
                          {attr.kind === 'color' ? (
                            <input
                              type="color"
                              aria-label={`${attr.label}取色`}
                              value={toHexColor(selectedProps[attr.name])}
                              onChange={(event) => applyAttr(attr.name, event.target.value)}
                            />
                          ) : null}
                          <input
                            type={attr.kind === 'number' ? 'number' : 'text'}
                            data-attr={attr.name}
                            value={selectedProps[attr.name] || ''}
                            placeholder={attr.placeholder || ''}
                            onChange={(event) => applyAttr(attr.name, event.target.value)}
                          />
                        </span>
                      )}
                    </label>
                  ))}
                  {selected.size > 1 ? (
                    <div className={styles.rowActions} data-testid="svg-editor-align">
                      {ALIGN_MODES.map((mode) => (
                        <button key={mode.id} type="button" className={button.ghost} onClick={() => applyAlign(mode.id)} data-align={mode.id}>
                          {mode.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className={styles.rowActions} data-testid="svg-editor-prop-actions">
                    <button type="button" className={button.ghost} onClick={openTextEditor} data-action="text">编辑文字</button>
                    <button type="button" className={button.ghost} onClick={copyStyle} data-action="copy-style">复制样式</button>
                    <button type="button" className={button.ghost} onClick={pasteStyle} disabled={!styleClip} data-action="paste-style">粘贴样式</button>
                    <button type="button" className={button.ghost} onClick={askAgent} data-action="ask-agent">问 agent</button>
                  </div>
                </div>
              ) : null}
              {preview ? (
                <div className={styles.previewBar} data-testid="svg-editor-preview-bar">
                  <span>只读预览：{preview.at.replace('T', ' ').slice(0, 19)}</span>
                  <button type="button" className={button.ghost} data-action="exit-preview" onClick={() => setPreview(null)}>退出预览</button>
                </div>
              ) : null}

              <details open className={styles.paletteBlock} data-testid="svg-editor-doc-palette">
                <summary className={styles.sectionSummary}>文档色板（点色块填入选中）</summary>
                {docPalette.length === 0 ? <div className={styles.note}>点一下画布或图层即可提取现有颜色</div> : null}
                <div className={styles.swatches}>
                  {docPalette.map((item) => (
                    <button
                      key={item.color}
                      type="button"
                      className={styles.swatch}
                      style={{ background: item.color }}
                      title={`${item.color} ×${item.count}`}
                      data-color={item.color}
                      onClick={() => applyAttr('fill', item.color)}
                    />
                  ))}
                </div>
              </details>
              <div className={styles.hint}>
                ⌘S 保存 · ⌘Z 撤销 · ⌘K 命令
              </div>
          </aside>
          ) : null}
          {layersOpen ? (
            <aside className={layout.layers} data-testid="svg-editor-layers">
              <div className={styles.layersHead}>
                {layersOpen ? (
                  <>
                    <span className={styles.panelTitle}>图层（{state.inspect.total}）</span>
                    <button
                      type="button"
                      className={button.ghost}
                      data-action="collapse-layers"
                      title="收起图层栏"
                      onClick={() => setLayersOpen(false)}
                    >
                      «
                    </button>
                  </>
                ) : null}
              </div>
              <ul className={styles.layerList} data-open={layersOpen ? '1' : '0'}>
                {layerRows.map((el) => {
                  const key = pathKey(el.path);
                  return (
                    <li key={key} style={{ paddingLeft: 6 + el.path.length * 12 }}>
                      <button
                        type="button"
                        className={selected.has(key) ? styles.layerRowActive : styles.layerRow}
                        onClick={(event) => {
                          syncSelection(new Set([key]));
                          event.currentTarget.scrollIntoView({ block: 'nearest' });
                          const root = rootEl();
                          const target = root ? findByPath(root, decodePath(key)) : null;
                          target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                        }}
                        onDoubleClick={() => { syncSelection(new Set([key])); setTextEdit(null); }}
                        title={`<${el.tag}> path=[${el.path.join(',')}]`}
                      >
                        {el.id ? `#${el.id}` : `<${el.tag}>`}
                        {el.textPreview ? <span className={styles.layerText}>{el.textPreview.slice(0, 24)}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>

          </aside>
          ) : null}
            <section className={layout.revisionCard} data-testid="svg-editor-revision-panel">
              <div className={styles.layersHead}>
                <span className={styles.panelTitle}>修订历史（{revisions.length}）</span>
              </div>
              {revisions.length === 0 ? (
                <div className={styles.note}>尚无修订快照（每次保存会在 .petri/svg-revisions/ 留一份）。</div>
              ) : (
                <ul className={styles.revisionList} data-testid="svg-editor-revision-list">
                  {revisions.map((item) => (
                    <li key={item.file} className={styles.changeRow} data-revision={item.file}>
                      <button
                        type="button"
                        className={styles.revisionItem}
                        data-action="preview-revision"
                        title="预览这一版（只读）"
                        onClick={() => openRevision(item)}
                      >
                        <span className={styles.changeLabel}>{item.at.replace('T', ' ').slice(0, 19)}</span>
                        <span className={styles.changeKind}>{item.sha8} · {Math.round(item.sizeBytes / 1024)}KB</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      ) : null}

      {notice ? <div className={styles.notice} role="status" data-testid="svg-editor-notice">{notice}</div> : null}
      {error ? <div className={styles.error} role="alert" data-testid="svg-editor-error">{error}</div> : null}

      {paletteOpen ? (
        <div className={styles.palette} data-testid="svg-editor-palette">
          <div className={styles.paletteTitle}>命令（Esc 关闭）</div>
          <ul className={styles.paletteList}>
            {COMMANDS.map((command) => (
              <li key={command.id}>
                <button
                  type="button"
                  className={styles.paletteItem}
                  onClick={() => { setPaletteOpen(false); runCommand(command.id); }}
                >
                  {command.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** 选中元素摘要（属性只读展示：改属性走 svg_edit op，不在视图里假装可编辑）。 */
function SelectedSummary({
  rows,
}: {
  rows: Array<{ key: string; label: string; tag: string; attrCount: number; pathLabel: string }>;
}) {
  if (rows.length === 0) return null;
  return (
    <ul className={styles.propList}>
      {rows.map((row) => (
        <li key={row.key} className={styles.propRow}>
          <span className={styles.propLabel}>{row.label}</span>
          <span className={styles.propValue}>&lt;{row.tag}&gt; · {row.attrCount} 属性 · path {row.pathLabel}</span>
        </li>
      ))}
    </ul>
  );
}
