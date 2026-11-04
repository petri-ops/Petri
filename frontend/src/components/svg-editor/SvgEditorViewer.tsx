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
import { editSvgFile, inspectSvgFile, inkscapeAction, inkscapeStatus, InkscapeStatus, SvgEditError, SvgInspectResult } from '@/lib/svgEditClient';
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
  parseStyleAttr,
} from './svgEditorInspector';
import { dispatchPetriEvent, petriEvents, subscribePetriEvent } from '@/lib/events';
import { listSvgRevisions, readSvgRevision } from '@/lib/svgEditClient';
import {
  duplicateOp,
  elementPath,
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
import { opLabel, splitOpGroups } from './svgChangeList';
import { fitImageBox, imageInsertOp, isSafeImageDataUrl, rewriteAssetHrefsForView, validateAssetRefPath, validateEmbedFile, assetRefInsertOp } from './svgEditorImage';
import {
  applyGradientOps,
  gradientInsertOps,
  gradientPreviewCss,
  gradientRefOf,
  newGradientId,
  parseGradients,
  stopEditOps,
} from './svgEditorGradient';

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
  // BLOCK-344 资产路径显示改写：href=项目内相对路径的 <image> 改写为 workspace 文件 URL
  // （真值不动——保存仍走磁盘原文 + span 引擎 op；此处只改视图显示，防相对路径裂图）
  const viewMarkup = rewriteAssetHrefsForView(view.markup || '', (relPath) =>
    workspaceFileUrlFor(projectId, relPath),
  );
  return { inspect, markup: viewMarkup, removed: view.removed };
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
  // UI-663 撤销重建：磁盘重建后待按序回放的剩余 op（effect 里消费一次即清）
  const rebuildOpsRef = React.useRef<SvgOp[] | null>(null);
  // 切片3 图片嵌入：隐藏 file input（工具栏「图片」按钮触发）
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  // BLOCK-344 资产路径引用：输入项目内相对路径 → 校验在档 → 引用模式 insert（真值存相对路径）
  const [assetPathInput, setAssetPathInput] = React.useState<string | null>(null);

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
  // P1.4 内联样式行（单选时采集；编辑走 set_style op）
  const [styleRows, setStyleRows] = React.useState<Array<{ name: string; value: string }>>([]);
  // P2.1 版本对比：修订版与当前视图洋葱皮叠加（透明度滑杆）
  const [compare, setCompare] = React.useState<{ revision: string; at: string; markup: string; opacity: number } | null>(null);
  // UI-682 — 底排（图层|修订历史）高度：把手拖拽驱动（clamp 140–420，会话内生效不落盘）
  const [row2Height, setRow2Height] = React.useState(196);
  const row2DragRef = React.useRef<{ startY: number; startH: number } | null>(null);
  // UI-685 — 图形属性栏宽度：左缘把手拖拽驱动（clamp 220–420，会话内生效不落盘）
  const [inspectorWidth, setInspectorWidth] = React.useState(272);
  const inspectorDragRef = React.useRef<{ startX: number; startW: number } | null>(null);
  // 切片5 Inkscape 协处理探针（挂载即查，缺席诚实灰化）
  const [inkscape, setInkscape] = React.useState<InkscapeStatus | null>(null);
  // 切片6 提案幽灵：agent svg_edit propose 结果（previewMarkup + ops），路径匹配当前文件才收
  const [proposal, setProposal] = React.useState<{ markup: string; ops: SvgOp[] } | null>(null);
  // 切片7 渲染回验：当前视图 → PNG 自证 + 判据 prompt 注入会话
  const [renderCheck, setRenderCheck] = React.useState<{ png: string; width: number; height: number } | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    inkscapeStatus(projectId)
      .then((st) => { if (!cancelled) setInkscape(st); })
      .catch(() => { if (!cancelled) setInkscape({ available: false, bin: null, source: null, hint: '探针不可达（后端未就绪？）' }); });
    return () => { cancelled = true; };
  }, [projectId]);

  // 切片6 提案订阅：path 匹配当前文件才收（校验 markup/ops 形态，不猜）
  React.useEffect(() => {
    const off = subscribePetriEvent(petriEvents.svgProposal, (detail) => {
      if (!detail || detail.path !== filePath) return;
      if (typeof detail.previewMarkup !== 'string' || detail.previewMarkup === '') return;
      if (!Array.isArray(detail.ops) || detail.ops.length === 0) return;
      setProposal({ markup: detail.previewMarkup, ops: detail.ops as SvgOp[] });
      setNotice('收到 agent 提案：已在画布上叠加 ghost，可逐项接受');
    });
    return off;
  }, [filePath]);

  // 事件回调需要「最新值」而闭包可能陈旧，故用镜像 ref；同步在 effect 里做（不在渲染期写 ref）。
  React.useEffect(() => {
    markupRef.current = markup;
    opsRef.current = pendingOps;
  }, [markup, pendingOps]);

  const rootEl = React.useCallback((): SVGSVGElement | null => {
    const host = hostRef.current;
    return host ? (host.querySelector('svg')) : null;
  }, []);

  // UI-663：磁盘重建后的剩余 op 回放（markup 落 DOM 后消费一次；空清单=纯回磁盘，零回放）
  React.useEffect(() => {
    const replay = rebuildOpsRef.current;
    if (!replay || state.status !== 'ready') return;
    rebuildOpsRef.current = null;
    if (replay.length === 0) return;
    const root = rootEl();
    if (!root) return;
    applyOpsToDom(root, replay);
    const next = root.outerHTML;
    markupRef.current = next;
    setMarkup(next);
  }, [markup, rootEl, state.status]);

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

  const handleOpsCommitted = React.useCallback((ops: SvgOp[], opts?: { keepSelection?: boolean }) => {
    commit(ops, currentMarkup());
    if (!opts?.keepSelection) setSelected(new Set());
  }, [commit, currentMarkup]);

  /** 切片2 基础钢笔：insert op 落定 → commit + 回选择工具。 */
  const handlePenCommit = React.useCallback((op: SvgOp) => {
    commit([op], currentMarkup());
    setTool('select');
    setNotice('已插入 <path>；⌘S 保存到文件');
  }, [commit, currentMarkup]);

  /**
   * 切片3 图片嵌入：本地文件 → 安全校验 → data URL → 自然尺寸适配 → 白名单 insert op。
   * 边界（裁决留档见 svgEditorImage.ts）：只收 PNG/JPEG/GIF/WebP ≤2MB；拒 SVG 与外链。
   */
  const embedImageFile = React.useCallback((file: File) => {
    const check = validateEmbedFile(file);
    if (!check.ok) { setNotice(`图片未嵌入：${check.reason}`); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!isSafeImageDataUrl(dataUrl)) { setNotice('图片未嵌入：读取结果不是安全形态'); return; }
      const probe = new Image();
      probe.onload = () => {
        const box = fitImageBox(probe.naturalWidth, probe.naturalHeight);
        const op = imageInsertOp(dataUrl, box);
        if (!op) { setNotice('图片未嵌入：data URL 校验失败'); return; }
        commit([op], currentMarkup());
        setNotice(`已嵌入图片（${box.width}×${box.height}）；⌘S 保存到文件`);
      };
      probe.onerror = () => setNotice('图片未嵌入：文件无法解码为位图');
      probe.src = dataUrl;
    };
    reader.onerror = () => setNotice('图片未嵌入：文件读取失败');
    reader.readAsDataURL(file);
  }, [commit, currentMarkup]);

  /** BLOCK-344 引用模式：校验在档（探 workspaceFileUrlFor）→ assetRefInsertOp（真值存相对路径）。 */
  const insertAssetRef = React.useCallback(async (relPath: string) => {
    const check = validateAssetRefPath(relPath);
    if (!check.ok) { setNotice(`引用未创建：${check.reason}`); return; }
    const url = workspaceFileUrlFor(projectId, relPath);
    try {
      const probe = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10_000) });
      const type = probe.headers.get('content-type') || '';
      if (!probe.ok) { setNotice(`引用未创建：文件不存在（${relPath}）`); return; }
      if (!/^image\//.test(type)) { setNotice(`引用未创建：目标不是图片（${type}）`); return; }
      const op = assetRefInsertOp(relPath, { x: 20, y: 20, width: 160, height: 120 });
      if (!op) { setNotice('引用未创建：路径校验失败'); return; }
      commit([op], currentMarkup());
      setNotice(`已创建图片引用（${relPath}）；⌘S 保存到文件`);
    } catch (caught) {
      setNotice(`引用未创建：${caught instanceof Error ? caught.message : String(caught)}`);
    }
  }, [commit, currentMarkup, projectId]);

  /** 切片5 Inkscape 协处理动作：before-sha 守卫（协处理器不绕过治理），成功后重载视图。 */
  const runInkscape = React.useCallback((action: string) => {
    if (state.status !== 'ready' || saving) return;
    setSaving(true);
    inkscapeAction({ projectId, path: filePath, action, beforeSha256: state.baseSha })
      .then((result) => {
        setNotice(result.description || `Inkscape ${action} 完成`);
        return load();
      })
      .catch((runError: unknown) => {
        setError(runError instanceof Error ? runError.message : String(runError));
      })
      .finally(() => setSaving(false));
  }, [filePath, load, projectId, saving, state]);

  /** 切片6 提案接受：接受全部剩余 op（一次 commit）或逐项接受单个 op；拒绝=整单清除。 */
  const acceptProposal = React.useCallback((only?: number) => {
    if (!proposal) return;
    const ops = only === undefined ? proposal.ops : [proposal.ops[only]];
    const rest = only === undefined ? [] : proposal.ops.filter((_, i) => i !== only);
    commit(ops, currentMarkup());
    setProposal(rest.length > 0 ? { ...proposal, ops: rest } : null);
    setNotice(`已接受提案改动（${ops.length} 项）；⌘S 保存到文件`);
  }, [commit, currentMarkup, proposal]);
  const rejectProposal = React.useCallback(() => {
    setProposal(null);
    setNotice('已拒绝该提案（未应用任何 op）');
  }, []);

  /** 切片7 渲染回验：当前视图 → 离屏 canvas PNG（data: URL；渲染失败/画布污染如实报错）。 */
  const runRenderCheck = React.useCallback(() => {
    const markupText = currentMarkup();
    const vb = /viewBox="([\d.\-+\s]+)"/.exec(markupText);
    let width = 800; let height = 480;
    if (vb) {
      const parts = vb[1].trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
        const cap = 1024;
        const scale = Math.min(1, cap / Math.max(parts[2], parts[3]));
        width = Math.max(1, Math.round(parts[2] * scale));
        height = Math.max(1, Math.round(parts[3] * scale));
      }
    }
    const blob = new Blob([markupText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    const cleanup = () => URL.revokeObjectURL(url);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { setNotice('渲染回验失败：canvas 2D 上下文不可用'); cleanup(); return; }
        ctx.drawImage(img, 0, 0, width, height);
        const png = canvas.toDataURL('image/png');
        setRenderCheck({ png, width, height });
        setNotice(`渲染回验快照已生成（${width}×${height}）`);
      } catch (drawError: unknown) {
        setNotice(`渲染回验失败：${drawError instanceof Error ? drawError.message : String(drawError)}（含外链资源时浏览器会污染画布）`);
      } finally {
        cleanup();
      }
    };
    img.onerror = () => { setNotice('渲染回验失败：视图无法解码为位图'); cleanup(); };
    img.src = url;
  }, [currentMarkup]);

  /** 切片7 判据注入：copilotAsk 带路径 + 待保存 op 摘要 + 结构回验判据（指路 svg_inspect/svg_edit）。 */
  const askRenderCheck = React.useCallback(() => {
    if (!renderCheck) return;
    const summary = pendingOps.length > 0
      ? pendingOps.map((op) => opLabel(op)).join('；')
      : '（无待保存改动）';
    dispatchPetriEvent(petriEvents.composerAttachImage, { dataUrl: renderCheck.png, name: `render-check-${renderCheck.width}x${renderCheck.height}.png` });
    dispatchPetriEvent(petriEvents.copilotAsk, {
      prompt: [
        `渲染回验请求（${filePath}，快照 ${renderCheck.width}×${renderCheck.height}）：`,
        `当前待保存改动：${summary}。`,
        '请用 svg_inspect 读取该文件当前结构，对照以上渲染意图逐条核对是否落地且自洽（几何/属性引用/渐变与图片 id 存在等）；',
        '发现可疑处先用 svg_edit propose 说方案，我确认后再 apply。',
      ].join('\n'),
    });
    setNotice('已把渲染回验快照与判据放进会话输入框（图片附件 + 判据 prompt）');
  }, [filePath, pendingOps, renderCheck]);


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
    setStyleRows(selected.size === 1 || (next.size === 1 && el !== null) ? parseStyleAttr(el?.getAttribute('style')) : []);
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

  // UI-663 改动清单：由 pendingOps + history 的 opsLen 快照直接切组（语义 diff = op 列表本身，
  // 不做「磁盘文本 vs 视图序列化」的反序列化比对——两轮实机空清单的根因，见 plan §9）。
  const changeGroups = React.useMemo(
    () => splitOpGroups(pendingOps, history.map((entry) => entry.opsLen)),
    [pendingOps, history],
  );

  /**
   * UI-663 撤销：移除指定组 → 磁盘真值重建视图 → 按序回放剩余 op。
   * 快照栈（history/future）跨重建不可延续，如实清空；预览态先退出再撤销。
   */
  const revertGroups = React.useCallback(async (removeIndexes: ReadonlySet<number>) => {
    if (state.status !== 'ready' || saving) return;
    if (preview) { setNotice('正在预览历史版本——退出预览后再撤销改动'); return; }
    const remainingOps = changeGroups
      .filter((group) => !removeIndexes.has(group.index))
      .flatMap((group) => group.ops);
    try {
      const doc = await fetchSvgDocument(projectId, filePath);
      rebuildOpsRef.current = remainingOps;
      applyLoaded(doc);
      setPendingOps(remainingOps);
      setNotice(remainingOps.length > 0 ? `已撤销，回放剩余 ${remainingOps.length} 项改动（未保存）` : '已撤销，视图回到磁盘真值');
    } catch (revertError: unknown) {
      rebuildOpsRef.current = null;
      setNotice(`撤销失败：${revertError instanceof Error ? revertError.message : String(revertError)}`);
    }
  }, [applyLoaded, changeGroups, filePath, preview, projectId, saving, state]);

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

  /** 适应窗口：重置为 contain 全览基准（UI-681 起画布填满、svg 自动 contain，scale=1 即适应；不改文档）。 */
  const fitToView = React.useCallback(() => {
    setScale(1);
  }, []);


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

  /** P2.1 版本对比：读取修订版 → 洋葱皮叠加（不改真值、不进 pendingOps）。 */
  const openCompare = React.useCallback((item: { file: string; at: string }) => {
    void readSvgRevision({ projectId, path: filePath, revision: item.file })
      .then((content) => {
        const view = sanitizeSvgForView(content.text);
        if (!view.ok) { setNotice(`对比失败：快照无法解析（${view.error}）`); return; }
        setCompare({ revision: item.file, at: item.at, markup: view.markup || '', opacity: 0.5 });
        setNotice(`版本对比中：${item.file.slice(-24)}（拖滑杆调透明度）`);
      })
      .catch((error: unknown) => {
        setNotice(`读取快照失败：${error instanceof Error ? error.message : String(error)}`);
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

  /** P1.1 选区浮动工具条：动作与属性面板动作行/快捷键同源（deleteSelected/duplicateSelected/askAgent/openTextEditor）。 */
  const handleSelectionAction = React.useCallback((action: 'delete' | 'duplicate' | 'ask' | 'text') => {
    if (action === 'delete') { deleteSelected(); return; }
    if (action === 'duplicate') { duplicateSelected(); return; }
    if (action === 'ask') { askAgent(); return; }
    openTextEditor();
  }, [askAgent, deleteSelected, duplicateSelected, openTextEditor]);

  /** P1.4 内联样式编辑：value 空=删键（set_style props null）；单选限定向。 */
  const commitStyleProp = React.useCallback((name: string, value: string) => {
    const root = rootEl();
    if (!root || selected.size !== 1) return;
    const path = decodePath(Array.from(selected)[0]);
    const el = findByPath(root, path);
    const target = el?.getAttribute('id') ? { id: el.getAttribute('id') as string } : { path };
    commit([{ op: 'set_style', target, props: { [name]: value === '' ? null : value } }], currentMarkup());
    setStyleRows((prev) => {
      if (value === '') return prev.filter((row) => row.name !== name);
      // upsert：新增行在空清单上也要追加（实机抓真：map 对空清单加不进）
      return prev.some((row) => row.name === name)
        ? prev.map((row) => (row.name === name ? { name, value } : row))
        : [...prev, { name, value }];
    });
  }, [commit, currentMarkup, rootEl, selected]);

  /** P1.4 新增样式属性行。 */
  const [newStyleName, setNewStyleName] = React.useState('');
  const addStyleProp = React.useCallback(() => {
    const name = newStyleName.trim();
    if (name === '' || /[\s:;]/.test(name)) { setNotice('样式属性名非法（禁空白/冒号/分号）'); return; }
    if (styleRows.some((row) => row.name === name)) { setNotice(`样式属性 ${name} 已存在`); return; }
    commitStyleProp(name, 'initial');
    setNewStyleName('');
  }, [commitStyleProp, newStyleName, styleRows]);
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

  // —— 切片4 渐变：文档渐变清单（随 markup 纯计算）+ 新建表单态 ——
  const docGradients = React.useMemo(() => parseGradients(markup), [markup]);
  const selectedGradientId = gradientRefOf(selectedProps.fill || selectedProps.stroke);
  const selectedGradient = docGradients.find((g) => g.id === selectedGradientId) || null;
  const [gradKind, setGradKind] = React.useState<'linear' | 'radial'>('linear');
  const [gradDir, setGradDir] = React.useState<'h' | 'v' | 'd'>('h');
  const [gradFrom, setGradFrom] = React.useState('#4a7cba');
  const [gradTo, setGradTo] = React.useState('#ffffff');

  /** 创建渐变（无 defs 先建在根 end）并应用到选中（单 commit 单改动组）。 */
  const createGradient = React.useCallback(() => {
    const root = rootEl();
    if (!root || selected.size === 0) return;
    const gid = newGradientId(docGradients.map((g) => g.id));
    const defsEl = root.querySelector('defs');
    const ops = [
      ...gradientInsertOps({ id: gid, kind: gradKind, from: gradFrom, to: gradTo, direction: gradDir }, defsEl ? elementPath(root, defsEl) : null, root.children.length),
      ...applyGradientOps(Array.from(selected).map((key) => {
        const path = decodePath(key);
        const el = findByPath(root, path);
        return { id: el?.getAttribute('id') || undefined, path };
      }), gid),
    ];
    commit(ops, currentMarkup());
    setSelectedProps((prev) => ({ ...prev, fill: `url(#${gid})` }));
    setNotice(`已创建渐变 #${gid} 并应用到 ${selected.size} 个元素；⌘S 保存到文件`);
  }, [commit, currentMarkup, docGradients, gradDir, gradFrom, gradKind, gradTo, rootEl, selected]);

  /** 应用文档内已有渐变到选中。 */
  const applyGradient = React.useCallback((gid: string) => {
    const root = rootEl();
    if (!root || selected.size === 0) return;
    commit(applyGradientOps(Array.from(selected).map((key) => {
      const path = decodePath(key);
      const el = findByPath(root, path);
      return { id: el?.getAttribute('id') || undefined, path };
    }), gid), currentMarkup());
    setSelectedProps((prev) => ({ ...prev, fill: `url(#${gid})` }));
    setNotice(`已把 #${gid} 应用到 ${selected.size} 个元素`);
  }, [commit, currentMarkup, rootEl, selected]);

  /** 编辑 stop 颜色/偏移：自建 stop 有 id 走 id，外来 stop 走 live DOM path。 */
  const editGradientStop = React.useCallback((stopIndex: number, patch: { color?: string; offset?: number }) => {
    const root = rootEl();
    if (!root || !selectedGradientId) return;
    const gEl = Array.from(root.querySelectorAll('linearGradient, radialGradient'))
      .find((el) => el.getAttribute('id') === selectedGradientId);
    const stopEl = gEl?.querySelectorAll('stop')[stopIndex];
    if (!stopEl) return;
    const stopId = stopEl.getAttribute('id');
    const ops = stopEditOps(stopId ? { id: stopId } : { path: elementPath(root, stopEl) || [] }, patch);
    if (ops.length > 0) commit(ops, currentMarkup());
  }, [commit, currentMarkup, rootEl, selectedGradientId]);

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
        <div
          className={layout.body}
          data-layers={layersOpen ? '1' : '0'}
          data-inspector={inspectorOpen ? '1' : '0'}
          style={{ '--svg-inspector-w': `${inspectorWidth}px` } as React.CSSProperties}
        >
          <div className={layout.leftCol} style={{ '--svg-row2': `${row2Height}px` } as React.CSSProperties}>
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
            {compare ? (
              <div className={styles.proposalBar} data-testid="svg-editor-compare">
                <span className={styles.proposalTitle}>版本对比 · {compare.revision.slice(-24)}</span>
                <div className={styles.fieldRow}>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={compare.opacity}
                    data-attr="compare-opacity"
                    aria-label="对比层透明度"
                    onChange={(event) => setCompare((prev) => (prev ? { ...prev, opacity: Number(event.target.value) } : prev))}
                  />
                  <span className={styles.changeKind}>{Math.round(compare.opacity * 100)}%</span>
                </div>
                <div className={styles.rowActions}>
                  <button type="button" className={button.ghost} data-action="compare-close" onClick={() => setCompare(null)}>关闭对比</button>
                </div>
              </div>
            ) : null}
            {renderCheck ? (
              <div className={styles.proposalBar} data-testid="svg-editor-render-check">
                <span className={styles.proposalTitle}>渲染回验快照（{renderCheck.width}×{renderCheck.height}）</span>
                <img
                  className={styles.renderCheckPreview}
                  src={renderCheck.png}
                  alt="当前视图渲染快照"
                  data-testid="svg-editor-render-check-img"
                />
                <div className={styles.rowActions}>
                  <button type="button" className={button.ghost} data-action="render-check-ask" onClick={askRenderCheck}>请 agent 回验</button>
                  <button type="button" className={button.ghost} data-action="render-check-close" onClick={() => setRenderCheck(null)}>关闭</button>
                </div>
              </div>
            ) : null}
            {proposal ? (
              <div className={styles.proposalBar} data-testid="svg-editor-proposal">
                <span className={styles.proposalTitle}>agent 提案（{proposal.ops.length} 项 op）</span>
                <div className={styles.proposalOps}>
                  {proposal.ops.map((op, i) => (
                    <div key={i} className={styles.changeRow}>
                      <span className={styles.changeLabel} title={opLabel(op)}>{opLabel(op)}</span>
                      <button type="button" className={button.ghost} data-action={`proposal-accept-${i}`} onClick={() => acceptProposal(i)}>接受</button>
                    </div>
                  ))}
                </div>
                <div className={styles.rowActions}>
                  <button type="button" className={button.ghost} data-action="proposal-accept-all" onClick={() => acceptProposal()}>全部接受</button>
                  <button type="button" className={button.ghost} data-action="proposal-reject" onClick={rejectProposal}>拒绝</button>
                </div>
              </div>
            ) : null}
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
              <button
                type="button"
                className={styles.tool}
                data-action="embed-image"
                title="嵌入本地图片（PNG/JPEG/GIF/WebP ≤2MB，data: 内嵌；也可直接拖图进画布）"
                onClick={() => fileInputRef.current?.click()}
              >
                图片
              </button>
              <button
                type="button"
                className={styles.tool}
                data-action="asset-ref-toggle"
                title="引用项目内已有图片文件（相对路径，文件可替换不重新嵌入）"
                onClick={() => setAssetPathInput((prev) => (prev === null ? '' : null))}
              >
                引用
              </button>
              <button
                type="button"
                className={styles.tool}
                data-action="render-check"
                title="渲染回验：当前视图渲染成 PNG 快照 + 判据注入会话"
                onClick={runRenderCheck}
              >
                回验
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                style={{ display: 'none' }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) embedImageFile(file);
                  event.target.value = '';
                }}
              />
              {assetPathInput !== null ? (
                <div className={styles.assetRefRow} data-testid="svg-editor-asset-ref">
                  <input
                    data-testid="svg-editor-asset-ref-input"
                    value={assetPathInput}
                    placeholder="项目内相对路径（如 assets/logo.png）"
                    onChange={(event) => setAssetPathInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && assetPathInput.trim() !== '') { void insertAssetRef(assetPathInput.trim()); setAssetPathInput(null); }
                      if (event.key === 'Escape') setAssetPathInput(null);
                    }}
                  />
                  <button type="button" className={button.ghost} data-action="asset-ref-create" onClick={() => { const v = assetPathInput.trim(); if (v !== '') { void insertAssetRef(v); setAssetPathInput(null); } }}>引用</button>
                </div>
              ) : null}
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
              onPenCommit={handlePenCommit}
              onNotice={setNotice}
              onEmbedImage={embedImageFile}
              proposalMarkup={proposal?.markup || null}
              onSelectionAction={preview ? undefined : handleSelectionAction}
              compareMarkup={compare?.markup || null}
              compareOpacity={compare?.opacity}
            />

          </div>

          {/* 图层栏常挂载：收起态靠 data-open + display:none 退场（layout 单一真源），不条件卸载——
             卸载会让 flow 契约（V2d 读 dataset.open）与收起列宽组合丢元素（实机抓真） */}
            <div
              className={layout.row2Resizer}
              data-testid="svg-row2-resizer"
              title="拖动调整底部卡片高度"
              onPointerDown={(event) => {
                row2DragRef.current = { startY: event.clientY, startH: row2Height };
                event.currentTarget.setPointerCapture?.(event.pointerId);
              }}
              onPointerMove={(event) => {
                const drag = row2DragRef.current;
                if (!drag) return;
                // UI-685 方向语义：把手在底排顶边——边缘跟随指针（向下拖=顶边下移=底排变矮）
                const next = Math.max(140, Math.min(420, drag.startH - (event.clientY - drag.startY)));
                setRow2Height(next);
              }}
              onPointerUp={() => { row2DragRef.current = null; }}
              onPointerCancel={() => { row2DragRef.current = null; }}
            />
            <aside className={layout.layers} data-testid="svg-editor-layers" data-open={layersOpen ? '1' : '0'}>
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
                      <div className={styles.revisionRow}>
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
                        <button
                          type="button"
                          className={button.ghost}
                          data-action={`compare-revision-${item.file.slice(-16)}`}
                          title="与当前视图洋葱皮对比"
                          onClick={() => openCompare(item)}
                        >
                          对比
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* 属性栏常挂载：同图层栏——收起靠 data-open + display:none，选中时 setInspectorOpen(true) 展开 */}
            <div
              className={layout.inspectorResizer}
              data-testid="svg-inspector-resizer"
              title="拖动调整属性栏宽度"
              onPointerDown={(event) => {
                inspectorDragRef.current = { startX: event.clientX, startW: inspectorWidth };
                event.currentTarget.setPointerCapture?.(event.pointerId);
              }}
              onPointerMove={(event) => {
                const drag = inspectorDragRef.current;
                if (!drag) return;
                // 边缘跟随指针：把手左拖（clientX 减）= 属性栏变宽
                const next = Math.max(220, Math.min(420, drag.startW + (drag.startX - event.clientX)));
                setInspectorWidth(next);
              }}
              onPointerUp={() => { inspectorDragRef.current = null; }}
              onPointerCancel={() => { inspectorDragRef.current = null; }}
            />
            <aside className={layout.inspector} data-testid="svg-editor-inspector" data-open={inspectorOpen ? '1' : '0'}>
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
              {selected.size === 1 ? (
                <div data-testid="svg-editor-style-props">
                  <div className={styles.inspectorHead}><span className={styles.panelTitle}>内联样式（style）</span></div>
                  {styleRows.map((row) => (
                    <div key={row.name} className={styles.field}>
                      <span className={styles.fieldLabel} title={row.name}>{row.name}</span>
                      <input
                        data-attr={`style:${row.name}`}
                        value={row.value}
                        placeholder="空=删除该条"
                        onChange={(event) => commitStyleProp(row.name, event.target.value)}
                      />
                    </div>
                  ))}
                  <div className={styles.fieldRow}>
                    <input
                      data-attr="style-new-name"
                      value={newStyleName}
                      placeholder="新属性名（如 fill-opacity）"
                      onChange={(event) => setNewStyleName(event.target.value)}
                    />
                    <button type="button" className={button.ghost} data-action="style-add" onClick={addStyleProp}>添加</button>
                  </div>
                </div>
              ) : null}
              <details className={styles.paletteBlock} data-testid="svg-editor-gradient">
                <summary className={styles.sectionSummary}>渐变{docGradients.length > 0 ? `（文档 ${docGradients.length}）` : ''}</summary>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>新建</span>
                  <select data-attr="gradient-kind" value={gradKind} onChange={(event) => setGradKind(event.target.value as 'linear' | 'radial')}>
                    <option value="linear">线性</option>
                    <option value="radial">径向</option>
                  </select>
                </div>
                {gradKind === 'linear' ? (
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>方向</span>
                    <select data-attr="gradient-dir" value={gradDir} onChange={(event) => setGradDir(event.target.value as 'h' | 'v' | 'd')}>
                      <option value="h">横向</option>
                      <option value="v">竖向</option>
                      <option value="d">对角</option>
                    </select>
                  </div>
                ) : null}
                <div className={styles.fieldRow}>
                  <input type="color" aria-label="渐变起色" data-attr="gradient-from" value={toHexColor(gradFrom)} onChange={(event) => setGradFrom(event.target.value)} />
                  <input type="color" aria-label="渐变止色" data-attr="gradient-to" value={toHexColor(gradTo)} onChange={(event) => setGradTo(event.target.value)} />
                  <button type="button" className={button.ghost} data-action="gradient-create" onClick={createGradient}>创建并应用</button>
                </div>
                {docGradients.map((g) => (
                  <div key={g.id} className={styles.changeRow}>
                    <span className={styles.gradientSwatch} style={{ background: gradientPreviewCss(g) }} title={`#${g.id}`} />
                    <span className={styles.changeLabel}>#{g.id}（{g.kind === 'radial' ? '径向' : '线性'}·{g.stops.length} stop）</span>
                    <button type="button" className={button.ghost} data-action={`gradient-apply-${g.id}`} onClick={() => applyGradient(g.id)}>应用</button>
                  </div>
                ))}
                {selectedGradient ? (
                  <div className={styles.rowActions} data-testid="svg-editor-gradient-stops">
                    <span className={styles.fieldLabel}>#{selectedGradient.id} stops</span>
                    {selectedGradient.stops.map((stop, i) => (
                      <div key={i} className={styles.fieldRow}>
                        <input
                          type="color"
                          aria-label={`stop ${i} 颜色`}
                          data-attr={`gradient-stop-color-${i}`}
                          value={toHexColor(stop.color)}
                          onChange={(event) => editGradientStop(i, { color: event.target.value })}
                        />
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.05}
                          aria-label={`stop ${i} 位置`}
                          data-attr={`gradient-stop-offset-${i}`}
                          value={stop.offset}
                          onChange={(event) => editGradientStop(i, { offset: Number(event.target.value) })}
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
              </details>
              <details className={styles.paletteBlock} data-testid="svg-editor-inkscape">
                <summary className={styles.sectionSummary}>Inkscape 协处理{inkscape?.available ? '（可用）' : ''}</summary>
                {inkscape === null ? (
                  <div className={styles.note}>探针中…</div>
                ) : inkscape.available === false ? (
                  <div className={styles.note} data-testid="svg-editor-inkscape-unavailable">{inkscape.hint || '未检测到 Inkscape'}</div>
                ) : (
                  <>
                    <div className={styles.rowActions}>
                      <button type="button" className={button.ghost} data-action="inkscape-union" disabled={saving || selected.size < 2} title="布尔联合：需选中 ≥2 个元素" onClick={() => runInkscape('union')}>联合</button>
                      <button type="button" className={button.ghost} data-action="inkscape-difference" disabled={saving || selected.size < 2} title="布尔差集：需选中 ≥2 个元素" onClick={() => runInkscape('difference')}>差集</button>
                      <button type="button" className={button.ghost} data-action="inkscape-intersection" disabled={saving || selected.size < 2} title="布尔交集：需选中 ≥2 个元素" onClick={() => runInkscape('intersection')}>交集</button>
                    </div>
                    <div className={styles.rowActions}>
                      <button type="button" className={button.ghost} data-action="inkscape-text-to-path" disabled={saving} title="全档文字转路径（object-to-path）" onClick={() => runInkscape('text-to-path')}>文字转路径</button>
                      <button type="button" className={button.ghost} data-action="inkscape-export-pdf" disabled={saving} title="导出 PDF（同目录同名 .pdf）" onClick={() => runInkscape('export-pdf')}>导出 PDF</button>
                    </div>
                  </>
                )}
              </details>
              <details className={styles.changeBlock} data-testid="svg-editor-changes">
                <summary className={styles.sectionSummary}>
                  未保存改动（逐元素取舍）{changeGroups.length > 0 ? `（${changeGroups.length}）` : ''}
                </summary>
                {changeGroups.length === 0 ? (
                  <div className={styles.note}>暂无未保存改动；每次操作会在这里分组列出，可单项撤销。</div>
                ) : (
                  <>
                    <ul className={styles.changeList}>
                      {changeGroups.map((group) => (
                        <li key={group.index} className={styles.changeRow}>
                          <span className={styles.changeLabel} title={group.label}>{group.label}</span>
                          <button
                            type="button"
                            className={button.ghost}
                            data-action="revert-change"
                            onClick={() => { void revertGroups(new Set([group.index])); }}
                          >
                            撤销
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={button.ghost}
                        data-action="revert-all"
                        onClick={() => { void revertGroups(new Set(changeGroups.map((group) => group.index))); }}
                      >
                        全部撤销
                      </button>
                    </div>
                  </>
                )}
              </details>
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
