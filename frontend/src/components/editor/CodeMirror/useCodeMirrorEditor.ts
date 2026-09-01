/**
 * BLOCK-22-CODEMIRROR-INLINE-DIFF — useCodeMirrorEditor hook
 *
 * 单例 EditorView 模式：
 * - 每个 hook 调用挂载一个 EditorView 到传入的 parent DOM 节点
 * - 用 Compartment 把 `EditorView.editable` 重新配置
 * - 用 Compartment 把语言 extension 重新配置
 * - P1 新增：用 Compartment 把 diff extension 重新配置（`diffCompartment`）
 * - P2 新增：用 Compartment 把 accept/reject widget extension 重新配置
 * - 用 useRef + useEffect cleanup 守护 React 19 strict mode 的双 mount
 *
 * EditorApi 通过 apiRef 暴露（由父组件用 forwardRef 转接）：
 * - P0: getValue / setValue / destroy
 * - P1: setMode / getMode / setDiffRevision / getDiffRevision / scrollToLine
 * - P2: acceptHunk / rejectHunk / acceptAll / rejectAll / getHunk
 *
 * P2 不接：事件总线 events.ts（P3 才接）。
 */

import { useEffect, useImperativeHandle, useRef, type RefObject } from 'react';
import { useParams } from 'react-router-dom';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  HighlightStyle,
  syntaxHighlighting,
  defaultHighlightStyle,
  indentOnInput,
  bracketMatching,
} from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

import { getBridge } from '../../../lib/desktopBridge';
import { biof3Events, dispatchBioF3Event } from '../../../lib/events';
import { loadLanguage } from './extensions/languageLoader';
import { createUnifiedDiffExtension, type DiffViewOptions } from './extensions/unifiedDiff';
import { createScrollToLineApi, scrollToLineExtension } from './extensions/scrollToLine';
import {
  createAcceptRejectWidgetExtension,
  type AcceptRejectWidgetCallbacks,
  cssEscape,
} from './extensions/acceptRejectWidget';
import type {
  DiffHunk,
  DiffRevision,
  EditorApi,
  EditorMode,
  ScrollTarget,
} from './types';

export interface UseCodeMirrorEditorOptions {
  /** 父组件提供的容器 DOM 节点 ref。 */
  parentRef: RefObject<HTMLElement | null>;
  /** 初始文档内容（normal 模式初始值；inline-diff 模式以 diffRevision.modifiedText 为准）。 */
  initialValue: string;
  /** 只读开关，P0 默认 true。 */
  readonly?: boolean;
  /** 高亮语言标识（如 "python" / "typescript"），由 languageLoader 解析。 */
  language?: string;
  /** 编辑器模式；默认 'normal'。P1 落地。 */
  mode?: EditorMode;
  /** DiffRevision；仅 `mode === 'inline-diff'` 时必填。P1 落地。 */
  diffRevision?: DiffRevision | null;
  /**
   * Accept 回调（P2）：widget 点击 → IPC → onAccept。
   * 不接事件总线（P3 才接）。
   */
  onAcceptHunk?: (hunkId: string) => void;
  /** Reject 回调（P2）：语义同上。 */
  onRejectHunk?: (hunkId: string) => void;
  /** IPC 失败回调（P2）：走 onError（不接事件总线）。 */
  onError?: (err: unknown) => void;
  /** BLOCK-28 — 业务层注入的额外 CM6 扩展；数组引用变化时经独立 Compartment 热替换。 */
  extraExtensions?: Extension[];
  /** BLOCK-28 — inline-diff 渲染选项（如 collapseUnchanged）。 */
  diffOptions?: DiffViewOptions;
}

const biof3HighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--biof3-status-warning, #c586c0)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--biof3-status-success, #ce9178)' },
  { tag: t.number, color: 'var(--biof3-accent, #b5cea8)' },
  { tag: t.comment, color: 'var(--biof3-text-muted, #6a9955)', fontStyle: 'italic' },
  { tag: t.variableName, color: 'var(--biof3-text, #9cdcfe)' },
  { tag: t.typeName, color: 'var(--biof3-accent, #4ec9b0)' },
]);

/**
 * IPC 路径：复用 BLOCK-20 PHASE 1 已备的两个 channel
 *  - `git:apply-inverse-hunk`：调 `applyInverseHunk({ patch })`
 *  - `git:revert-file`：调 `revertFile({ path })`
 *
 * 通过 `getBridge('workingTreeReview')` 拿到 typed handle；非 desktop 环境抛错走 onError。
 */

interface WorkingTreeReviewLike {
  // BLOCK-32 — params 增加 projectId（项目级审阅隔离，additive）
  applyInverseHunk: (params: { patch: string; projectId?: string }) => Promise<{
    ok: boolean;
    data?: { ok: true };
    error?: string;
    message?: string;
  }>;
  revertFile: (params: { path: string; projectId?: string }) => Promise<{
    ok: boolean;
    data?: { reverted: string[] };
    error?: string;
    message?: string;
  }>;
  rejectHunkByInverseHunk: (params: {
    file: string;
    hunkIndex: number;
    patch: string;
    feedback?: string;
    projectId?: string;
  }) => Promise<{
    ok: boolean;
    data?: unknown;
    error?: string;
    message?: string;
  }>;
}

/**
 * 把 `DiffHunk.oldText/newText` 转成 BLOCK-20 apply-inverse-hunk 期望的正向 unified diff patch。
 *
 * 真正的 hunk text 由 `DiffRevision` 上层预解析时携带（BLOCK-22 plan §3.3 §3.4）；
 * 旧 / 新文本缺省视为空串（不会让函数返回 undefined）。
 */
function buildForwardPatch(rev: DiffRevision, hunk: DiffHunk): string {
  const oldText = hunk.oldText ?? '';
  const newText = hunk.newText ?? '';
  const oldStart = hunk.startLine;
  const newStart = hunk.startLine;
  const oldLines = countLines(oldText);
  const newLines = countLines(newText);
  const header = [
    `--- a/${rev.filePath}`,
    `+++ b/${rev.filePath}`,
    `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`,
  ].join('\n');
  const body = oldText.length > 0 ? `${oldText}\n` : '';
  const additions = newText.length > 0 ? `${newText}\n` : '';
  return `${header}\n${body}${additions}`;
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  // 按 \n 切分；末尾无 \n 视为完整行
  const parts = text.split('\n');
  return parts[parts.length - 1] === '' ? parts.length - 1 : parts.length;
}

async function runAcceptHunkIPC(rev: DiffRevision, hunk: DiffHunk, projectId?: string): Promise<void> {
  const bridge = getBridge('workingTreeReview') as WorkingTreeReviewLike | null;
  if (!bridge) {
    throw new Error('Desktop IPC bridge "workingTreeReview" is not available.');
  }
  const patch = buildForwardPatch(rev, hunk);
  const result = await bridge.applyInverseHunk({ patch, projectId });
  if (!result.ok) {
    throw new Error(result.error || result.message || 'applyInverseHunk failed.');
  }
}

async function runRejectHunkIPC(
  rev: DiffRevision,
  hunk: DiffHunk,
  hunkIndex: number,
  feedback?: string,
  projectId?: string,
): Promise<void> {
  const bridge = getBridge('workingTreeReview') as WorkingTreeReviewLike | null;
  if (!bridge) {
    throw new Error('Desktop IPC bridge "workingTreeReview" is not available.');
  }
  const patch = buildForwardPatch(rev, hunk);
  const result = await bridge.rejectHunkByInverseHunk({
    file: rev.filePath,
    hunkIndex,
    patch,
    feedback,
    projectId,
  });
  if (!result.ok) {
    throw new Error(result.error || result.message || 'rejectHunkByInverseHunk failed.');
  }
}

async function runRejectFileIPC(rev: DiffRevision, projectId?: string): Promise<void> {
  const bridge = getBridge('workingTreeReview') as WorkingTreeReviewLike | null;
  if (!bridge) {
    throw new Error('Desktop IPC bridge "workingTreeReview" is not available.');
  }
  const result = await bridge.revertFile({ path: rev.filePath, projectId });
  if (!result.ok) {
    throw new Error(result.error || result.message || 'revertFile failed.');
  }
}

function errToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * 在容器中创建并管理 EditorView 单例。
 * 卸载时 view.destroy() 释放 DOM。
 */
export function useCodeMirrorEditor(
  options: UseCodeMirrorEditorOptions,
  apiRef: RefObject<EditorApi | null>,
): void {
  const {
    parentRef,
    initialValue,
    readonly = true,
    language,
    mode = 'normal',
    diffRevision = null,
    onAcceptHunk,
    onRejectHunk,
    onError,
    extraExtensions,
    diffOptions,
  } = options;

  const viewRef = useRef<EditorView | null>(null);
  const readonlyCompartmentRef = useRef<Compartment | null>(null);
  const langCompartmentRef = useRef<Compartment | null>(null);
  const diffCompartmentRef = useRef<Compartment | null>(null);
  const widgetCompartmentRef = useRef<Compartment | null>(null);
  const extraCompartmentRef = useRef<Compartment | null>(null);

  // 当前状态镜像（apiRef 暴露 read 用）
  const currentModeRef = useRef<EditorMode>(mode);
  const currentDiffRevisionRef = useRef<DiffRevision | null>(diffRevision);

  // BLOCK-32 — 项目级审阅隔离：accept/reject/revertFile IPC 落到当前项目工作区仓库
  // （/project/:projectId 路由内取路由参数；其余路由回退应用仓库旧行为）
  const routeParams = useParams<{ projectId?: string }>();
  const projectIdRef = useRef<string | null>(null);
  projectIdRef.current = routeParams.projectId ?? null;

  // BLOCK-28 — diffOptions 镜像：所有 createUnifiedDiffExtension 调用统一走此 helper
  const diffOptionsRef = useRef<DiffViewOptions | undefined>(diffOptions);
  diffOptionsRef.current = diffOptions;
  const buildDiffExt = (rev: DiffRevision): Extension[] =>
    createUnifiedDiffExtension(rev, diffOptionsRef.current);

  // P2 回调 ref：避免 EditorApi 重新创建 + 把稳定 callback 注入 widget extension
  const onAcceptHunkRef = useRef<typeof onAcceptHunk>(onAcceptHunk);
  const onRejectHunkRef = useRef<typeof onRejectHunk>(onRejectHunk);
  const onErrorRef = useRef<typeof onError>(onError);
  onAcceptHunkRef.current = onAcceptHunk;
  onRejectHunkRef.current = onRejectHunk;
  onErrorRef.current = onError;

  useImperativeHandle(
    apiRef,
    (): EditorApi => {
      const isInlineDiff = (): boolean => currentModeRef.current === 'inline-diff';
      const ensureView = (): EditorView | null => viewRef.current;

      // Task 2: 本地 dismissHunk 实现（由 acceptHunk / rejectHunk / api.dismissHunk 共用）
      const dismissHunkImpl = (hunkId: string): void => {
        const v = ensureView();
        if (!v) return;
        // 阶段 1：给 DOM 元素加 dismissing class，触发 CSS transition 淡出
        v.contentDOM
          .querySelectorAll<HTMLElement>(`[data-hunk-id="${cssEscape(hunkId)}"]`)
          .forEach((el) => el.classList.add('dismissing'));
        // 阶段 2：200ms 后从 hunks 数组移除该 hunk，reconfigure diff compartment
        setTimeout(() => {
          const v2 = ensureView();
          if (!v2) return;
          const rev = currentDiffRevisionRef.current;
          if (!rev || !rev.hunks) return;
          const diffCompartment = diffCompartmentRef.current;
          if (!diffCompartment) return;
          const updatedHunks = rev.hunks.filter((h) => h.id !== hunkId);
          const updatedRevision: DiffRevision = { ...rev, hunks: updatedHunks };
          currentDiffRevisionRef.current = updatedRevision;
          v2.dispatch({ effects: diffCompartment.reconfigure(buildDiffExt(updatedRevision)) });
        }, 200);
      };

      return {
        getValue: (): string => {
          const v = ensureView();
          if (!v) return '';
          // inline-diff 模式下 doc 由 unifiedMergeView 管理，但 getValue 仍返回当前 doc
          return v.state.doc.toString();
        },
        setValue: (next: string): void => {
          const v = ensureView();
          if (!v) return;
          if (isInlineDiff()) {
            // inline-diff 模式下 setValue 不直接修改 doc；
            // 调用方应当改用 setDiffRevision({ modifiedText: next, ... })
            // 这里 no-op 避免破坏 unifiedMergeView 状态。
            return;
          }
          const current = v.state.doc.toString();
          if (current === next) return;
          v.dispatch({
            changes: { from: 0, to: v.state.doc.length, insert: next },
          });
        },
        destroy: (): void => {
          const v = ensureView();
          if (v) {
            v.destroy();
            viewRef.current = null;
          }
        },
        setMode: (next: EditorMode): void => {
          const v = ensureView();
          if (!v) return;
          if (currentModeRef.current === next) return;
          currentModeRef.current = next;
          const diffCompartment = diffCompartmentRef.current;
          if (!diffCompartment) return;
          if (next === 'inline-diff') {
            const rev = currentDiffRevisionRef.current;
            const diffExt = rev ? buildDiffExt(rev) : [];
            v.dispatch({ effects: diffCompartment.reconfigure(diffExt) });
          } else {
            v.dispatch({ effects: diffCompartment.reconfigure([]) });
          }
        },
        getMode: (): EditorMode => currentModeRef.current,
        setDiffRevision: (rev: DiffRevision | null): void => {
          const v = ensureView();
          if (!v) return;
          currentDiffRevisionRef.current = rev;
          if (!isInlineDiff()) return; // normal 模式下忽略
          // diff 是有状态的（unifiedMergeView StateField 持有 chunks），
          // 不能 hot-replace extension；这里通过 reconfigure 触发 StateField 重新初始化
          const diffCompartment = diffCompartmentRef.current;
          if (!diffCompartment) return;
          const diffExt = rev ? buildDiffExt(rev) : [];
          v.dispatch({ effects: diffCompartment.reconfigure(diffExt) });
        },
        getDiffRevision: (): DiffRevision | null => currentDiffRevisionRef.current,
        scrollToLine: (target: ScrollTarget): void => {
          const v = ensureView();
          if (!v) return;
          const api = createScrollToLineApi(v);
          api.scrollToLine(target);
        },
        // ==================== P2: accept / reject ====================
        getHunk: (hunkId: string): DiffHunk | null => {
          const rev = currentDiffRevisionRef.current;
          if (!rev || !rev.hunks) return null;
          return rev.hunks.find((h) => h.id === hunkId) ?? null;
        },
        dismissHunk: dismissHunkImpl,
        acceptHunk: async (hunkId: string): Promise<void> => {
          if (!isInlineDiff()) return;
          const rev = currentDiffRevisionRef.current;
          if (!rev) return;
          const hunk = (rev.hunks ?? []).find((h) => h.id === hunkId);
          if (!hunk) return;
          try {
            await runAcceptHunkIPC(rev, hunk, projectIdRef.current ?? undefined);
          } catch (err) {
            onErrorRef.current?.(err);
            throw err;
          }
          // Task 5: IPC 成功后派发 typed event
          dispatchBioF3Event(biof3Events.hunkAccepted, {
            hunkId,
            filePath: rev.filePath,
            timestamp: Date.now(),
          });
          // 触发业务侧回调（事件总线接入由 P3 完成）
          onAcceptHunkRef.current?.(hunkId);
          // Task 2: IPC 成功后触发 dismissHunk（CSS 淡出 + diff 重建）
          dismissHunkImpl(hunkId);
        },
        rejectHunk: async (hunkId: string): Promise<void> => {
          if (!isInlineDiff()) return;
          const rev = currentDiffRevisionRef.current;
          if (!rev) return;
          const hunk = (rev.hunks ?? []).find((h) => h.id === hunkId);
          if (!hunk) return;
          const hunkIndex = (rev.hunks ?? []).findIndex((h) => h.id === hunkId);
          try {
            await runRejectHunkIPC(rev, hunk, hunkIndex, undefined, projectIdRef.current ?? undefined);
          } catch (err) {
            onErrorRef.current?.(err);
            throw err;
          }
          // Task 5: IPC 成功后派发 typed event
          dispatchBioF3Event(biof3Events.hunkRejected, {
            hunkId,
            filePath: rev.filePath,
            timestamp: Date.now(),
          });
          onRejectHunkRef.current?.(hunkId);
          dismissHunkImpl(hunkId);
        },
        acceptAll: async () => {
          if (!isInlineDiff()) {
            return { allOk: true, succeeded: [], failed: [] };
          }
          const rev = currentDiffRevisionRef.current;
          if (!rev || !rev.hunks || rev.hunks.length === 0) {
            return { allOk: true, succeeded: [], failed: [] };
          }
          const succeeded: string[] = [];
          const failed: Array<{ hunkId: string; error: string }> = [];
          for (const hunk of rev.hunks) {
            try {
              await runAcceptHunkIPC(rev, hunk, projectIdRef.current ?? undefined);
              succeeded.push(hunk.id);
              onAcceptHunkRef.current?.(hunk.id);
            } catch (err) {
              failed.push({ hunkId: hunk.id, error: errToString(err) });
              onErrorRef.current?.(err);
            }
          }
          return { allOk: failed.length === 0, succeeded, failed };
        },
        rejectAll: async (): Promise<void> => {
          if (!isInlineDiff()) return;
          const rev = currentDiffRevisionRef.current;
          if (!rev) return;
          try {
            await runRejectFileIPC(rev, projectIdRef.current ?? undefined);
          } catch (err) {
            onErrorRef.current?.(err);
            throw err;
          }
          onRejectHunkRef.current?.('__all__');
        },
      };
    },
    [],
  );

  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) return;
    if (viewRef.current) return; // 严格模式下第二挂载命中守卫

    const readonlyCompartment = new Compartment();
    const langCompartment = new Compartment();
    const diffCompartment = new Compartment();
    const widgetCompartment = new Compartment();
    const extraCompartment = new Compartment();
    readonlyCompartmentRef.current = readonlyCompartment;
    langCompartmentRef.current = langCompartment;
    diffCompartmentRef.current = diffCompartment;
    widgetCompartmentRef.current = widgetCompartment;
    extraCompartmentRef.current = extraCompartment;

    const initialMode: EditorMode = mode;
    const initialDiffRevision: DiffRevision | null = diffRevision;
    currentModeRef.current = initialMode;
    currentDiffRevisionRef.current = initialDiffRevision;

    const diffExtension =
      initialMode === 'inline-diff' && initialDiffRevision
        ? buildDiffExt(initialDiffRevision)
        : [];

    // P2 widget extension：仅 inline-diff 模式挂载
    const callbacks: AcceptRejectWidgetCallbacks = {
      onAccept: (hunkId: string): void => {
        // 不在 hook 内直接 await；调 EditorApi 暴露的方法（异步）
        // 这样 IPC 失败能走 onError 回调；onAccept 事件总线 P3 才接
        const api = apiRef.current;
        if (api) void api.acceptHunk(hunkId);
      },
      onReject: (hunkId: string): void => {
        const api = apiRef.current;
        if (api) void api.rejectHunk(hunkId);
      },
    };
    const widgetExtension =
      initialMode === 'inline-diff' && initialDiffRevision
        ? createAcceptRejectWidgetExtension({
            callbacks,
            getHunks: (): DiffHunk[] => initialDiffRevision.hunks ?? [],
          })
        : [];

    // initialValue 在 inline-diff 模式下使用 modifiedText
    const startDoc =
      initialMode === 'inline-diff' && initialDiffRevision
        ? initialDiffRevision.modifiedText
        : initialValue;

    const baseExtensions = [
      lineNumbers(),
      highlightActiveLine(),
      history(),
      indentOnInput(),
      bracketMatching(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      syntaxHighlighting(biof3HighlightStyle),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': { fontFamily: 'var(--font-family-mono, monospace)' },
      }),
      readonlyCompartment.of(EditorState.readOnly.of(readonly)),
      langCompartment.of([]),
      diffCompartment.of(diffExtension),
      widgetCompartment.of(widgetExtension),
      extraCompartment.of(extraExtensions ?? []),
      scrollToLineExtension(),
    ];

    const state = EditorState.create({
      doc: startDoc,
      extensions: baseExtensions,
    });

    const view = new EditorView({ state, parent });
    viewRef.current = view;

    // 异步加载语言 extension；挂上 Compartment.reconfigure
    let cancelled = false;
    if (language) {
      loadLanguage(language).then((langExt) => {
        if (cancelled) return;
        const compartment = langCompartmentRef.current;
        if (!compartment || !viewRef.current) return;
        viewRef.current.dispatch({
          effects: compartment.reconfigure(langExt ? [langExt] : []),
        });
      });
    }

    return () => {
      cancelled = true;
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // readonly 变化时通过 Compartment.reconfigure 重配（不重建 view）
  useEffect(() => {
    const view = viewRef.current;
    const compartment = readonlyCompartmentRef.current;
    if (!view || !compartment) return;
    view.dispatch({
      effects: compartment.reconfigure(EditorState.readOnly.of(readonly)),
    });
  }, [readonly]);

  // language 变化时重新走异步加载
  useEffect(() => {
    const view = viewRef.current;
    const compartment = langCompartmentRef.current;
    if (!view || !compartment) return;
    let cancelled = false;
    if (!language) {
      view.dispatch({ effects: compartment.reconfigure([]) });
      return;
    }
    loadLanguage(language).then((langExt) => {
      if (cancelled || !viewRef.current) return;
      viewRef.current!.dispatch({
        effects: compartment.reconfigure(langExt ? [langExt] : []),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  // mode 变化：reconfigure diffCompartment + widgetCompartment
  useEffect(() => {
    const view = viewRef.current;
    const diffCompartment = diffCompartmentRef.current;
    const widgetCompartment = widgetCompartmentRef.current;
    if (!view || !diffCompartment || !widgetCompartment) return;
    currentModeRef.current = mode;
    if (mode === 'inline-diff') {
      const rev = currentDiffRevisionRef.current;
      const diffExt = rev ? buildDiffExt(rev) : [];
      const widgetExt = rev
        ? createAcceptRejectWidgetExtension({
            callbacks: {
              onAccept: (hunkId: string): void => {
                const api = apiRef.current;
                if (api) void api.acceptHunk(hunkId);
              },
              onReject: (hunkId: string): void => {
                const api = apiRef.current;
                if (api) void api.rejectHunk(hunkId);
              },
            },
            getHunks: (): DiffHunk[] => rev.hunks ?? [],
          })
        : [];
      view.dispatch({
        effects: [
          diffCompartment.reconfigure(diffExt),
          widgetCompartment.reconfigure(widgetExt),
        ],
      });
    } else {
      view.dispatch({
        effects: [
          diffCompartment.reconfigure([]),
          widgetCompartment.reconfigure([]),
        ],
      });
    }
  }, [mode]);

  // diffRevision 变化：仅 inline-diff 时 reconfigure diff + widget
  useEffect(() => {
    const view = viewRef.current;
    const diffCompartment = diffCompartmentRef.current;
    const widgetCompartment = widgetCompartmentRef.current;
    if (!view || !diffCompartment || !widgetCompartment) return;
    currentDiffRevisionRef.current = diffRevision;
    if (currentModeRef.current !== 'inline-diff') return;
    const diffExt = diffRevision ? buildDiffExt(diffRevision) : [];
    const widgetExt = diffRevision
      ? createAcceptRejectWidgetExtension({
          callbacks: {
            onAccept: (hunkId: string): void => {
              const api = apiRef.current;
              if (api) void api.acceptHunk(hunkId);
            },
            onReject: (hunkId: string): void => {
              const api = apiRef.current;
              if (api) void api.rejectHunk(hunkId);
            },
          },
          getHunks: (): DiffHunk[] => diffRevision.hunks ?? [],
        })
      : [];
    view.dispatch({
      effects: [
        diffCompartment.reconfigure(diffExt),
        widgetCompartment.reconfigure(widgetExt),
      ],
    });
  }, [diffRevision]);

  // BLOCK-28 — extraExtensions 变化：经独立 Compartment 热替换（不重建 view）
  useEffect(() => {
    const view = viewRef.current;
    const extraCompartment = extraCompartmentRef.current;
    if (!view || !extraCompartment) return;
    view.dispatch({ effects: extraCompartment.reconfigure(extraExtensions ?? []) });
  }, [extraExtensions]);
}
