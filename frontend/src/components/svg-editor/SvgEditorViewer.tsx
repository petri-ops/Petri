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

export interface SvgEditorViewerProps {
  projectId: string;
  filePath: string;
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

export function SvgEditorViewer({ projectId, filePath, name, active = true }: SvgEditorViewerProps) {
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
    setHistory((prev) => [...prev, { markup: markupRef.current, opsLen: opsRef.current.length }]);
    setFuture([]);
    setPendingOps((prev) => [...prev, ...ops]);
    markupRef.current = nextMarkup;
    setMarkup(nextMarkup);
    setNotice(null);
    setError(null);
  }, []);

  const currentMarkup = React.useCallback((): string => rootEl()?.outerHTML || markupRef.current, [rootEl]);

  const handleOpsCommitted = React.useCallback((ops: SvgOp[]) => {
    commit(ops, currentMarkup());
    setSelected(new Set());
  }, [commit, currentMarkup]);

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

  const layerRows = state.status === 'ready'
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
    <div className={styles.viewer} data-testid="svg-editor-viewer" data-file={filePath}>
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
        <div className={styles.body}>
          <aside className={styles.layers} data-testid="svg-editor-layers">
            <div className={styles.panelTitle}>图层（{state.inspect.total}）</div>
            <ul className={styles.layerList}>
              {layerRows.map((el) => {
                const key = pathKey(el.path);
                return (
                  <li key={key} style={{ paddingLeft: 6 + el.path.length * 12 }}>
                    <button
                      type="button"
                      className={selected.has(key) ? styles.layerRowActive : styles.layerRow}
                      onClick={() => setSelected(new Set([key]))}
                      title={`<${el.tag}> path=[${el.path.join(',')}]`}
                    >
                      {el.id ? `#${el.id}` : `<${el.tag}>`}
                      {el.textPreview ? <span className={styles.layerText}>{el.textPreview.slice(0, 24)}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            {state.removed > 0 ? (
              <div className={styles.warn} data-testid="svg-editor-sanitized">
                视图已脱敏 {state.removed} 处（script/事件属性/危险链接）；真值未被删除。
              </div>
            ) : null}
          </aside>

          <div className={styles.stage} onWheel={handleWheel}>
            <SvgEditorCanvas
              markup={markup}
              scale={scale}
              selected={selected}
              hostRef={hostRef}
              onSelectionChange={setSelected}
              onOpsCommitted={handleOpsCommitted}
            />
          </div>

          <aside className={styles.inspector} data-testid="svg-editor-inspector">
            <div className={styles.panelTitle}>属性</div>
            {selected.size === 0 ? <div className={styles.note}>未选中元素。点画布元素或用图层树选择。</div> : null}
            <SelectedSummary rows={selectedRows} />
            <div className={styles.hint}>
              快捷键：⌘S 保存 · ⌘Z 撤销 · Delete 删除 · ⌘D 复制 · 方向键微移（⇧ 10px）· ⌘K 命令
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
