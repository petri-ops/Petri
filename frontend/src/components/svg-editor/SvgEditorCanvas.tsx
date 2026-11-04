/**
 * SvgEditorCanvas.tsx — BLOCK-342 W1 画布：内联 SVG 视图 + 选择 + 拖拽 + 框选。
 *
 * 纪律：DOM 是活视图。拖拽只改 DOM transform 做即时反馈，手势结束才折算成 op
 * （onOpsCommitted），真值由后端 span 引擎在保存时改写。
 */

import * as React from 'react';
import {
  Box,
  boxIntersects,
  composeTranslate,
  elementPath,
  findByPath,
  normalizeBox,
  pathKey,
  SvgOp,
  translateOp,
} from './svgEditorModel';
import {
  anchorsOf,
  deleteAnchor,
  insertNodeAtSegMidpoint,
  moveAnchor,
  moveControl,
  parsePathD,
  PathPoint,
  PathSeg,
  penInsertMarkup,
  penPathD,
  smoothAnchor,
} from './svgPathNodes';
import styles from './SvgEditorViewer.module.css';
import button from '../ui/controls/button.module.css';
import type { DrawTool } from './svgEditorInspector';

export interface CanvasProps {
  markup: string;
  scale: number;
  selected: Set<string>;
  /** 宿主共享的画布容器引用（宿主需要用同一 DOM 读回序列化视图 / 做结构命令）。 */
  hostRef: React.MutableRefObject<HTMLDivElement | null>;
  onSelectionChange: (next: Set<string>) => void;
  onOpsCommitted: (ops: SvgOp[], opts?: { keepSelection?: boolean }) => void;
  /** W3 绘制工具：非 select 时指针拖拽产生新元素（SVG 用户坐标）。 */
  tool: DrawTool;
  onDrawBox: (box: Box) => void;
  /** 切片2 基础钢笔：点列落定 → insert op（宿主负责 commit + 回选择工具）。 */
  onPenCommit: (op: SvgOp) => void;
  /** 诚实拒绝/提示通道（M 锚不可删、d 含不支持命令等）。 */
  onNotice?: (msg: string) => void;
  /** 切片3 图片嵌入：拖图进画布（宿主校验+嵌入）。 */
  onEmbedImage?: (file: File) => void;
  /** 切片6 提案幽灵：agent propose 的 previewMarkup（半透明叠加，与画布同 scale 对齐）。 */
  proposalMarkup?: string | null;
  /** P1.1 选区浮动工具条：选择工具且有选区时渲染；动作语义由宿主分发（与属性面板动作行同源）。 */
  onSelectionAction?: (action: 'delete' | 'duplicate' | 'ask' | 'text') => void;
  /** P2.1 版本对比：修订版 markup 洋葱皮叠加（透明度由宿主滑杆控制）。 */
  compareMarkup?: string | null;
  compareOpacity?: number;
}

interface OverlayBox extends Box {
  key: string;
}

const DRAG_THRESHOLD = 3;

export function SvgEditorCanvas({ markup, scale, selected, hostRef, onSelectionChange, onOpsCommitted, tool, onDrawBox, onPenCommit, onNotice, onEmbedImage, proposalMarkup, onSelectionAction, compareMarkup, compareOpacity }: CanvasProps) {
  const [boxes, setBoxes] = React.useState<OverlayBox[]>([]);
  const drawStartRef = React.useRef<{ clientX: number; clientY: number } | null>(null);
  const [hoverBox, setHoverBox] = React.useState<Box | null>(null);
  const [rubber, setRubber] = React.useState<Box | null>(null);

  // —— 切片2：路径节点编辑 ——
  const [nodeTarget, setNodeTarget] = React.useState<{ key: string; path: number[]; id: string | null } | null>(null);
  const [nodeSegs, setNodeSegs] = React.useState<PathSeg[] | null>(null);
  const [nodeUnsupported, setNodeUnsupported] = React.useState(false);
  const [activeAnchor, setActiveAnchor] = React.useState<number | null>(null);
  const [nodePreviewD, setNodePreviewD] = React.useState<string | null>(null);
  const nodeDragRef = React.useRef<{
    kind: 'anchor' | 'handle';
    anchorIndex?: number;
    segIndex?: number;
    which?: 1 | 2;
    startClientX: number;
    startClientY: number;
    baseSegs: PathSeg[];
    el: Element;
    origD: string;
    lastD: string;
  } | null>(null);

  // —— 切片2：基础钢笔 ——
  const [penPoints, setPenPoints] = React.useState<PathPoint[]>([]);
  // 同 tick 连续点列需要读到最新值（setState 批量更新下闭包是旧的——实机抓真），ref 镜像同步
  const penPointsRef = React.useRef<PathPoint[]>([]);
  // UI-686 徒手模式：按住拖动=高频采样一笔（与「单击点列」并存，up 时按位移分流）
  const strokeRef = React.useRef<PathPoint[] | null>(null);

  const dragRef = React.useRef<{
    startX: number;
    startY: number;
    moved: boolean;
    targets: Array<{ el: Element; path: number[]; id: string | null; origin: string | null }>;
    box: Box | null;
  } | null>(null);

  const getRoot = React.useCallback((): SVGSVGElement | null => {
    const host = hostRef.current;
    if (!host) return null;
    return host.querySelector('svg');
  }, []);

  const refreshBoxes = React.useCallback(() => {
    const root = getRoot();
    const host = hostRef.current;
    if (!root || !host) { setBoxes([]); return; }
    const hostRect = host.getBoundingClientRect();
    const next: OverlayBox[] = [];
    selected.forEach((key) => {
      const path = key === '' ? [] : key.split('.').map((n) => Number(n));
      const el = findByPath(root, path);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      next.push({
        key,
        x: rect.left - hostRect.left,
        y: rect.top - hostRect.top,
        width: rect.width,
        height: rect.height,
      });
    });
    setBoxes(next);
  }, [getRoot, selected]);

  React.useEffect(() => { refreshBoxes(); }, [refreshBoxes, markup]);
  React.useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => refreshBoxes());
    observer.observe(host);
    return () => observer.disconnect();
  }, [refreshBoxes]);

  const targetOf = (el: Element): { el: Element; path: number[]; id: string | null; origin: string | null } | null => {
    const root = getRoot();
    if (!root) return null;
    const path = elementPath(root, el);
    if (!path) return null;
    return { el, path, id: el.getAttribute('id'), origin: el.getAttribute('transform') };
  };

  /**
   * 屏幕 → SVG 用户坐标。
   * 不用 getScreenCTM：离屏（show:false）窗口下 Chromium 返回 null，绘制会静默失效。
   * 改用 boundingRect + viewBox 比例（与 CSS scale 无关，比例法自动抵掉缩放）。
   */
  const toUser = React.useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const root = getRoot();
    if (!root) return null;
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const viewBox = root.viewBox?.baseVal;
    if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
      // UI-681 — contain（meet）letterbox 修正：内容按 min 比例缩放并居中，
      // 屏幕坐标须先扣居中偏移再除实际缩放（否则宽高比 ≠ 容器时坐标漂移）
      const k = Math.min(rect.width / viewBox.width, rect.height / viewBox.height);
      const offX = (rect.width - viewBox.width * k) / 2;
      const offY = (rect.height - viewBox.height * k) / 2;
      return {
        x: (clientX - rect.left - offX) / k + viewBox.x,
        y: (clientY - rect.top - offY) / k + viewBox.y,
      };
    }
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, [getRoot]);

  /** 用户坐标 → 宿主 px（节点 overlay 定位用；与 toUser 同源比例，互逆）。 */
  const userToHost = React.useCallback((x: number, y: number): { x: number; y: number } | null => {
    const root = getRoot();
    const host = hostRef.current;
    if (!root || !host) return null;
    const rect = root.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const viewBox = root.viewBox?.baseVal;
    if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
      // UI-681 — meet letterbox 逆换算（与 toUser 同一 k/offset）
      const k = Math.min(rect.width / viewBox.width, rect.height / viewBox.height);
      const offX = (rect.width - viewBox.width * k) / 2;
      const offY = (rect.height - viewBox.height * k) / 2;
      return {
        x: (x - viewBox.x) * k + offX + (rect.left - hostRect.left),
        y: (y - viewBox.y) * k + offY + (rect.top - hostRect.top),
      };
    }
    return { x: x + (rect.left - hostRect.left), y: y + (rect.top - hostRect.top) };
  }, [getRoot]);

  // —— 切片2：路径节点 ——
  // 节点编辑目标派生：node 工具 + 单选 path + d 可解析（不支持时给诚实提示 chip）
  React.useEffect(() => {
    if (tool !== 'node' || selected.size !== 1) {
      setNodeTarget(null); setNodeSegs(null); setNodeUnsupported(false); setActiveAnchor(null); setNodePreviewD(null);
      return;
    }
    const root = getRoot();
    const key = Array.from(selected)[0];
    const el = root ? findByPath(root, key === '' ? [] : key.split('.').map((n) => Number(n))) : null;
    if (!el || el.tagName.toLowerCase() !== 'path') {
      setNodeTarget(null); setNodeSegs(null); setNodeUnsupported(false);
      return;
    }
    const segs = parsePathD(el.getAttribute('d') || '');
    if (!segs) {
      setNodeTarget(null); setNodeSegs(null); setNodeUnsupported(true);
      return;
    }
    const path = elementPath(root as Element, el) || [];
    setNodeTarget({ key, path, id: el.getAttribute('id') });
    setNodeSegs(segs);
    setNodeUnsupported(false);
    setNodePreviewD(null);
  }, [markup, getRoot, selected, tool]);

  const commitPathD = React.useCallback((nextD: string) => {
    if (!nodeTarget) return;
    const op: SvgOp = nodeTarget.id
      ? { op: 'set_attr', target: { id: nodeTarget.id }, name: 'd', value: nextD }
      : { op: 'set_attr', target: { path: nodeTarget.path }, name: 'd', value: nextD };
    onOpsCommitted([op], { keepSelection: true });
  }, [nodeTarget, onOpsCommitted]);

  /** 节点动作（加点/删点/平滑）：纯函数产出新 d → 单 set_attr op（keepSelection）。 */
  const nodeAction = React.useCallback((action: 'insert' | 'delete' | 'smooth') => {
    if (!nodeSegs || activeAnchor === null) return;
    const anchor = anchorsOf(nodeSegs).find((a) => a.index === activeAnchor);
    if (!anchor) return;
    if (action === 'insert') {
      const outIdx = anchor.segIndex + 1;
      const outSeg = nodeSegs[outIdx];
      if (!outSeg || (outSeg.cmd !== 'L' && outSeg.cmd !== 'C')) {
        onNotice?.('加点需要锚点后方有可分割的线段/曲线段');
        return;
      }
      commitPathD(insertNodeAtSegMidpoint(nodeSegs, outIdx));
      return;
    }
    if (action === 'delete') {
      const nextD = deleteAnchor(nodeSegs, anchor);
      if (nextD === null) { onNotice?.('该锚点不可删（子路径起点或删除后子路径退化）'); return; }
      commitPathD(nextD);
      setActiveAnchor(null);
      return;
    }
    const smoothD = smoothAnchor(nodeSegs, anchor);
    if (smoothD === null) { onNotice?.('平滑需要锚点两侧都是曲线段'); return; }
    commitPathD(smoothD);
  }, [activeAnchor, commitPathD, nodeSegs, onNotice]);

  // —— 切片2：基础钢笔 ——
  const finalizePen = React.useCallback((closed: boolean) => {
    const pts = penPointsRef.current;
    const d = penPathD(pts, closed);
    penPointsRef.current = [];
    setPenPoints([]);
    if (!d) {
      if (pts.length > 0) onNotice?.('钢笔至少需要 2 个点（Esc 取消）');
      return;
    }
    onPenCommit({
      op: 'insert', parent: { path: [] }, index: 'end',
      markup: penInsertMarkup(d, { closed }),
    });
  }, [onPenCommit]);

  // 钢笔：Esc 取消 / Enter 结束（open 落定）
  React.useEffect(() => {
    if (tool !== 'pen') return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { penPointsRef.current = []; strokeRef.current = null; setPenPoints([]); }
      if (event.key === 'Enter') finalizePen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finalizePen, tool]);

  /** 节点/手柄拖拽：live 改 DOM `d`（即时反馈），pointerup 落成单个 set_attr d op。 */
  const beginNodeDrag = React.useCallback((
    event: React.PointerEvent<SVGCircleElement>,
    info: { kind: 'anchor' | 'handle'; anchorIndex?: number; segIndex?: number; which?: 1 | 2 },
  ) => {
    if (!nodeSegs) return;
    const el = nodeTarget ? findByPath(getRoot() as Element, nodeTarget.path) : null;
    if (!el) return;
    event.stopPropagation();
    event.preventDefault();
    // 先落 drag 状态（合成指针的 setPointerCapture 会抛 NotFoundError，不能挡住赋值——实机抓真）
    nodeDragRef.current = {
      ...info,
      startClientX: event.clientX,
      startClientY: event.clientY,
      baseSegs: nodeSegs,
      el,
      origD: el.getAttribute('d') || '',
      lastD: el.getAttribute('d') || '',
    };
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch { /* 合成指针无活跃 pointerId：可安全忽略（指针事件仍派发在圆元素上） */ }
    if (info.kind === 'anchor' && info.anchorIndex !== undefined) setActiveAnchor(info.anchorIndex);
  }, [getRoot, nodeSegs, nodeTarget]);

  const nodeDragMove = React.useCallback((event: React.PointerEvent<SVGCircleElement>) => {
    const drag = nodeDragRef.current;
    if (!drag) return;
    const from = toUser(drag.startClientX, drag.startClientY);
    const to = toUser(event.clientX, event.clientY);
    if (!from || !to) return;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    let nextD: string;
    if (drag.kind === 'anchor' && drag.anchorIndex !== undefined) {
      const anchor = anchorsOf(drag.baseSegs).find((a) => a.index === drag.anchorIndex);
      if (!anchor) return;
      nextD = moveAnchor(drag.baseSegs, anchor, anchor.pos.x + dx, anchor.pos.y + dy);
    } else if (drag.kind === 'handle' && drag.segIndex !== undefined && drag.which) {
      const seg = drag.baseSegs[drag.segIndex];
      if (!seg || seg.cmd !== 'C') return;
      const h = seg.pts[drag.which - 1];
      nextD = moveControl(drag.baseSegs, drag.segIndex, drag.which, h.x + dx, h.y + dy);
    } else {
      return;
    }
    drag.lastD = nextD;
    drag.el.setAttribute('d', nextD);
    setNodePreviewD(nextD);
  }, [toUser]);

  const nodeDragEnd = React.useCallback(() => {
    const drag = nodeDragRef.current;
    nodeDragRef.current = null;
    if (!drag) return;
    if (drag.lastD !== drag.origD) commitPathD(drag.lastD);
  }, [commitPathD]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (tool === 'pen') {
      // 钢笔两笔法：按下先入徒手缓冲，up 按位移分流——
      // 位移小=「点击落点」（点列：回首点闭合/追加）；位移大=「徒手一笔」松手落定（UI-686）
      const pt = toUser(event.clientX, event.clientY);
      if (!pt) return;
      strokeRef.current = [pt];
      setPenPoints([pt]);
      return;
    }
    if (tool !== 'select' && tool !== 'node') {
      const host = hostRef.current;
      if (!host) return;
      drawStartRef.current = { clientX: event.clientX, clientY: event.clientY };
      const hostRect = host.getBoundingClientRect();
      setRubber({ x: event.clientX - hostRect.left, y: event.clientY - hostRect.top, width: 0, height: 0 });
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }
    const root = getRoot();
    const host = hostRef.current;
    if (!root || !host) return;
    const raw = event.target as Element;
    if (raw === root) {
      // 空白处：起框选
      const hostRect = host.getBoundingClientRect();
      dragRef.current = {
        startX: event.clientX, startY: event.clientY, moved: false, targets: [], box: { x: 0, y: 0, width: 0, height: 0 },
      };
      setRubber({ x: event.clientX - hostRect.left, y: event.clientY - hostRect.top, width: 0, height: 0 });
      return;
    }
    const target = targetOf(raw);
    if (!target) return;
    const key = pathKey(target.path);
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    let nextSelected = selected;
    if (additive) {
      nextSelected = new Set(selected);
      if (nextSelected.has(key)) nextSelected.delete(key); else nextSelected.add(key);
      onSelectionChange(nextSelected);
    } else if (!selected.has(key)) {
      nextSelected = new Set([key]);
      onSelectionChange(nextSelected);
    }
    const targets = Array.from(nextSelected)
      .map((k) => findByPath(root, k === '' ? [] : k.split('.').map((n) => Number(n))))
      .filter((el): el is Element => !!el)
      .map((el) => targetOf(el))
      .filter((t): t is { el: Element; path: number[]; id: string | null; origin: string | null } => !!t);
    dragRef.current = { startX: event.clientX, startY: event.clientY, moved: false, targets, box: null };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    // UI-686 徒手采样：按住拖动时 ≥4 用户单位记一点（抽稀），实时进预览
    if (tool === 'pen' && strokeRef.current) {
      const pt = toUser(event.clientX, event.clientY);
      if (!pt) return;
      const pts = strokeRef.current;
      const last = pts[pts.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) >= 4) {
        pts.push(pt);
        setPenPoints([...pts]);
      }
      return;
    }
    const drawStart = drawStartRef.current;
    const hostEl = hostRef.current;
    if (drawStart && hostEl) {
      const hostRect = hostEl.getBoundingClientRect();
      setRubber({
        x: drawStart.clientX - hostRect.left,
        y: drawStart.clientY - hostRect.top,
        width: event.clientX - drawStart.clientX,
        height: event.clientY - drawStart.clientY,
      });
      return;
    }
    const drag = dragRef.current;
    const host = hostRef.current;
    if (!drag || !host) return;
    // UI-682 修漂移——位移一律走 toUser 差值（meet letterbox + CSS 缩放复合系数都在换算里；
    // 旧 /scale 只在「svg 布满=k==scale」的旧模型下成立，contain 填满后拖拽比指针快数倍）
    const from = toUser(drag.startX, drag.startY);
    const to = toUser(event.clientX, event.clientY);
    if (!from || !to) return;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) return;
    drag.moved = true;

    if (drag.box !== null) {
      const hostRect = host.getBoundingClientRect();
      const start = { x: drag.startX - hostRect.left, y: drag.startY - hostRect.top };
      const current = { x: event.clientX - hostRect.left, y: event.clientY - hostRect.top };
      const box = normalizeBox(start, current);
      drag.box = box;
      setRubber(box);
      return;
    }

    drag.targets.forEach((t) => {
      const value = composeTranslate(t.origin, dx, dy);
      t.el.setAttribute('transform', value);
    });
    refreshBoxes();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    // UI-686 徒手分流：位移 ≥6 用户单位且 ≥3 采样点 → 徒手一笔落定；否则回退为「点击落点」
    if (tool === 'pen' && strokeRef.current) {
      const pts = strokeRef.current;
      strokeRef.current = null;
      if (!pts) return;
      const start = pts[0];
      const end = pts[pts.length - 1];
      const moved = Math.hypot(end.x - start.x, end.y - start.y);
      if (pts.length >= 3 && moved >= 6) {
        const d = penPathD(pts, false);
        if (!d) { setPenPoints([]); return; }
        setPenPoints([]);
        penPointsRef.current = [];
        onPenCommit({
          op: 'insert', parent: { path: [] }, index: 'end',
          markup: penInsertMarkup(d, { closed: false }),
        });
        return;
      }
      const cur = penPointsRef.current;
      const first = cur[0];
      if (first && cur.length >= 3 && Math.hypot(end.x - first.x, end.y - first.y) < 8) {
        finalizePen(true);
        return;
      }
      penPointsRef.current = [...cur, end];
      setPenPoints(penPointsRef.current);
      return;
    }
    if (drawStartRef.current) {
      const start = drawStartRef.current;
      drawStartRef.current = null;
      setRubber(null);
      const from = toUser(start.clientX, start.clientY);
      const to = toUser(event.clientX, event.clientY);
      if (!from) return;
      if (!to) return;
      const box = {
        x: Math.min(from.x, to.x),
        y: Math.min(from.y, to.y),
        width: Math.abs(to.x - from.x),
        height: Math.abs(to.y - from.y),
      };
      onDrawBox(box);
      return;
    }
    const drag = dragRef.current;
    dragRef.current = null;
    setRubber(null);
    if (!drag) return;

    if (drag.box !== null) {
      const root = getRoot();
      const host = hostRef.current;
      if (!root || !host) return;
      const box = drag.box;
      const hostRect = host.getBoundingClientRect();
      const hits: string[] = [];
      Array.prototype.slice.call(root.children).forEach((child: Element) => {
        const rect = child.getBoundingClientRect();
        const rel = {
          x: rect.left - hostRect.left,
          y: rect.top - hostRect.top,
          width: rect.width,
          height: rect.height,
        };
        if (box.width === 0 && box.height === 0) return;
        if (boxIntersects(box, rel)) {
          const path = elementPath(root, child);
          if (path) hits.push(pathKey(path));
        }
      });
      onSelectionChange(new Set(hits));
      return;
    }

    if (!drag.moved) return;
    const from = toUser(drag.startX, drag.startY);
    const to = toUser(event.clientX, event.clientY);
    if (!from || !to) return;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const ops: SvgOp[] = drag.targets
      .filter((t) => {
        const current = t.el.getAttribute('transform');
        return current !== t.origin;
      })
      .map((t) => {
        const current = t.el.getAttribute('transform');
        const origin = t.origin;
        // 用「origin + 总位移」重建，避免把逐帧累加串写进 op
        const value = composeTranslate(origin, dx, dy);
        t.el.setAttribute('transform', current ?? value);
        return t.id
          ? { op: 'set_attr', target: { id: t.id }, name: 'transform', value }
          : translateOp(t.path, dx, dy, origin);
      });
    if (ops.length > 0) onOpsCommitted(ops);
    refreshBoxes();
  };

  const handleHover = (event: React.PointerEvent<HTMLDivElement>) => {
    const root = getRoot();
    const host = hostRef.current;
    if (!root || !host) return;
    const raw = event.target as Element;
    if (raw === root) { setHoverBox(null); return; }
    const rect = raw.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) { setHoverBox(null); return; }
    const hostRect = host.getBoundingClientRect();
    setHoverBox({
      x: rect.left - hostRect.left,
      y: rect.top - hostRect.top,
      width: rect.width,
      height: rect.height,
    });
  };

  return (
    <div
      className={styles.canvas}
      data-testid="svg-editor-canvas"
      ref={hostRef}
      onPointerDown={handlePointerDown}
      onPointerMove={(event) => { handlePointerMove(event); handleHover(event); }}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={() => setHoverBox(null)}
      onDoubleClick={() => { if (tool === 'pen') finalizePen(false); }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        const file = event.dataTransfer.files?.[0];
        if (file && onEmbedImage) {
          event.preventDefault();
          onEmbedImage(file);
        }
      }}
    >
      <div
        className={styles.canvasInner}
        style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}
        dangerouslySetInnerHTML={{ __html: markup }}
      />
      {proposalMarkup ? (
        <div
          className={styles.proposalGhostLayer}
          data-testid="svg-editor-proposal-ghost"
          style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}
          dangerouslySetInnerHTML={{ __html: proposalMarkup }}
        />
      ) : null}
      {compareMarkup ? (
        <div
          className={styles.compareGhostLayer}
          data-testid="svg-editor-compare-ghost"
          style={{ transform: `scale(${scale})`, transformOrigin: '0 0', opacity: compareOpacity ?? 0.5 }}
          dangerouslySetInnerHTML={{ __html: compareMarkup }}
        />
      ) : null}
      <div className={styles.overlay} aria-hidden="true">
        {boxes.map((box) => (
          <div
            key={box.key}
            className={styles.selectionBox}
            data-testid="svg-editor-selection"
            style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
          />
        ))}
        {hoverBox ? (
          <div
            className={styles.hoverBox}
            data-testid="svg-editor-hover"
            style={{ left: hoverBox.x, top: hoverBox.y, width: hoverBox.width, height: hoverBox.height }}
          />
        ) : null}
        {tool === 'select' && boxes.length > 0 && onSelectionAction ? (() => {
          const left = Math.min(...boxes.map((b) => b.x));
          const right = Math.max(...boxes.map((b) => b.x + b.width));
          const top = Math.min(...boxes.map((b) => b.y));
          const bottom = Math.max(...boxes.map((b) => b.y + b.height));
          const flip = top < 34; // 贴顶时翻到选区下方
          return (
            <div
              className={styles.selectionActions}
              data-testid="svg-editor-selection-actions"
              style={{ left: (left + right) / 2, top: flip ? bottom + 8 : top - 32 }}
            >
              <button type="button" className={button.ghost} data-action="sel-copy" onPointerDown={(e) => e.stopPropagation()} onClick={() => onSelectionAction('duplicate')}>复制</button>
              <button type="button" className={button.ghost} data-action="sel-text" onPointerDown={(e) => e.stopPropagation()} onClick={() => onSelectionAction('text')}>文字</button>
              <button type="button" className={button.ghost} data-action="sel-ask" onPointerDown={(e) => e.stopPropagation()} onClick={() => onSelectionAction('ask')}>问 agent</button>
              <button type="button" className={button.ghost} data-action="sel-delete" onPointerDown={(e) => e.stopPropagation()} onClick={() => onSelectionAction('delete')}>删除</button>
            </div>
          );
        })() : null}
        {rubber ? (
          <div className={styles.rubber} style={{ left: rubber.x, top: rubber.y, width: rubber.width, height: rubber.height }} />
        ) : null}
        {tool === 'node' && nodeTarget && nodeSegs && !nodeUnsupported ? (() => {
          const anchors = anchorsOf(nodeSegs);
          const displaySegs = nodePreviewD ? (parsePathD(nodePreviewD) || nodeSegs) : nodeSegs;
          const toHost = (p: PathPoint) => userToHost(p.x, p.y);
          const actionsAnchor = anchors.find((a) => a.index === activeAnchor) || anchors[0] || null;
          const at = actionsAnchor ? toHost(actionsAnchor.pos) : null;
          return (
            <>
              <svg className={styles.nodeOverlaySvg} data-testid="svg-editor-node-overlay">
                {displaySegs.map((seg, i) => {
                  if (seg.cmd !== 'C') return null;
                  const p0 = i > 0 && displaySegs[i - 1].cmd !== 'Z'
                    ? displaySegs[i - 1].pts[displaySegs[i - 1].pts.length - 1]
                    : { x: 0, y: 0 };
                  const h1 = toHost(seg.pts[0]); const h2 = toHost(seg.pts[1]);
                  const e0 = toHost(p0); const e1 = toHost(seg.pts[2]);
                  if (!h1 || !h2 || !e0 || !e1) return null;
                  return (
                    <g key={`h${i}`}>
                      <line className={styles.handleLine} x1={e0.x} y1={e0.y} x2={h1.x} y2={h1.y} />
                      <line className={styles.handleLine} x1={e1.x} y1={e1.y} x2={h2.x} y2={h2.y} />
                      <circle
                        className={styles.nodeHandle} data-testid="svg-editor-node-handle"
                        cx={h1.x} cy={h1.y} r={4}
                        onPointerDown={(e) => beginNodeDrag(e, { kind: 'handle', segIndex: i, which: 1 })}
                        onPointerMove={nodeDragMove}
                        onPointerUp={nodeDragEnd}
                      />
                      <circle
                        className={styles.nodeHandle} data-testid="svg-editor-node-handle"
                        cx={h2.x} cy={h2.y} r={4}
                        onPointerDown={(e) => beginNodeDrag(e, { kind: 'handle', segIndex: i, which: 2 })}
                        onPointerMove={nodeDragMove}
                        onPointerUp={nodeDragEnd}
                      />
                    </g>
                  );
                })}
                {anchors.map((a) => {
                  const pos = toHost(a.pos);
                  if (!pos) return null;
                  return (
                    <circle
                      key={`a${a.index}`}
                      className={a.index === activeAnchor ? styles.nodeAnchorActive : styles.nodeAnchor}
                      data-testid="svg-editor-node-anchor"
                      cx={pos.x} cy={pos.y} r={5}
                      onPointerDown={(e) => beginNodeDrag(e, { kind: 'anchor', anchorIndex: a.index })}
                      onPointerMove={nodeDragMove}
                      onPointerUp={nodeDragEnd}
                    />
                  );
                })}
              </svg>
              <div
                className={styles.nodeActions}
                style={at ? { left: at.x + 12, top: at.y - 16 } : undefined}
              >
                <button type="button" className={button.ghost} data-action="node-insert" onPointerDown={(e) => e.stopPropagation()} onClick={() => nodeAction('insert')}>加点</button>
                <button type="button" className={button.ghost} data-action="node-delete" onPointerDown={(e) => e.stopPropagation()} onClick={() => nodeAction('delete')}>删点</button>
                <button type="button" className={button.ghost} data-action="node-smooth" onPointerDown={(e) => e.stopPropagation()} onClick={() => nodeAction('smooth')}>平滑</button>
              </div>
            </>
          );
        })() : null}
        {tool === 'node' && nodeUnsupported ? (
          <div className={styles.nodeUnsupported} data-testid="svg-editor-node-unsupported">
            该 path 的 d 含不支持的命令（仅支持 M/L/H/V/C/Z 绝对坐标），节点编辑不可用
          </div>
        ) : null}
        {tool === 'pen' && penPoints.length > 0 ? (() => {
          const pts = penPoints.map((p) => userToHost(p.x, p.y)).filter((p): p is PathPoint => !!p);
          if (pts.length === 0) return null;
          return (
            <svg className={styles.nodeOverlaySvg} data-testid="svg-editor-pen-preview">
              <path
                className={styles.penPreviewPath}
                d={pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')}
              />
              {pts.map((p, i) => (
                <circle key={i} className={styles.penPreviewDot} cx={p.x} cy={p.y} r={3} />
              ))}
            </svg>
          );
        })() : null}
      </div>
    </div>
  );
}


