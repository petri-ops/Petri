/**
 * BLOCK-22-CODEMIRROR-INLINE-DIFF — useCodeMirrorEditor hook
 *
 * 单例 EditorView 模式：
 * - 每个 hook 调用挂载一个 EditorView 到传入的 parent DOM 节点
 * - 用 Compartment 把 `EditorView.editable` 重新配置
 * - 用 Compartment 把语言 extension 重新配置
 * - P1 新增：用 Compartment 把 diff extension 重新配置（`diffCompartment`）
 * - 用 useRef + useEffect cleanup 守护 React 19 strict mode 的双 mount
 *
 * EditorApi 通过 apiRef 暴露（由父组件用 forwardRef 转接）：
 * - P0: getValue / setValue / destroy
 * - P1: setMode / getMode / setDiffRevision / getDiffRevision / scrollToLine
 *
 * BLOCK-43（UI-193 收口）：移除 BLOCK-22 通用 accept/reject widget 链路
 * （extension + EditorApi acceptHunk/rejectHunk/acceptAll/rejectAll/getHunk/
 * dismissHunk + IPC helper）。业务路径的按 hunk 接受/拒绝由 BLOCK-28
 * `hunkControls.ts`（经 extraExtensions 注入）承担。
 *
 * BLOCK-42：文档变化回调 onChange（normal 模式 only）。
 */

import { useEffect, useImperativeHandle, useRef, type RefObject } from 'react';
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

import { loadLanguage } from './extensions/languageLoader';
import { createFallbackLanguage } from './extensions/fallbackLanguage';
import { createUnifiedDiffExtension, type DiffViewOptions } from './extensions/unifiedDiff';
import { createScrollToLineApi, scrollToLineExtension } from './extensions/scrollToLine';
import type {
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
  /** BLOCK-42 — 文档变化回调（normal 模式 only；inline-diff 不派发）。 */
  onChange?: (value: string) => void;
  /** BLOCK-28 — 业务层注入的额外 CM6 扩展；数组引用变化时经独立 Compartment 热替换。 */
  extraExtensions?: Extension[];
  /** BLOCK-28 — inline-diff 渲染选项（如 collapseUnchanged）。 */
  diffOptions?: DiffViewOptions;
}

const biof3HighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--gewu-status-warning, #c586c0)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--gewu-status-success, #ce9178)' },
  { tag: t.number, color: 'var(--gewu-accent, #b5cea8)' },
  { tag: t.comment, color: 'var(--gewu-text-muted, #6a9955)', fontStyle: 'italic' },
  { tag: t.variableName, color: 'var(--gewu-text, #9cdcfe)' },
  { tag: t.typeName, color: 'var(--gewu-accent, #4ec9b0)' },
]);

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
    onChange,
    extraExtensions,
    diffOptions,
  } = options;

  const viewRef = useRef<EditorView | null>(null);
  const readonlyCompartmentRef = useRef<Compartment | null>(null);
  const langCompartmentRef = useRef<Compartment | null>(null);
  const diffCompartmentRef = useRef<Compartment | null>(null);
  const extraCompartmentRef = useRef<Compartment | null>(null);

  // 当前状态镜像（apiRef 暴露 read 用）
  const currentModeRef = useRef<EditorMode>(mode);
  const currentDiffRevisionRef = useRef<DiffRevision | null>(diffRevision);

  // BLOCK-28 — diffOptions 镜像：所有 createUnifiedDiffExtension 调用统一走此 helper
  const diffOptionsRef = useRef<DiffViewOptions | undefined>(diffOptions);
  diffOptionsRef.current = diffOptions;
  const buildDiffExt = (rev: DiffRevision): Extension[] =>
    createUnifiedDiffExtension(rev, diffOptionsRef.current);

  // BLOCK-42 — onChange 走 ref（updateListener 扩展不随 callback 引用变化 reconfigure）
  const onChangeRef = useRef<typeof onChange>(onChange);
  onChangeRef.current = onChange;

  useImperativeHandle(
    apiRef,
    (): EditorApi => {
      const isInlineDiff = (): boolean => currentModeRef.current === 'inline-diff';
      const ensureView = (): EditorView | null => viewRef.current;

      return {
        getValue: (): string => {
          const v = ensureView();
          if (!v) return '';
          // inline-diff 模式下 doc 由 unifiedMergeView 管理，但 getValue 仍返回当前 doc
          return v.state.doc.toString();
        },
        // BLOCK-52 P1（选中即引用）：读出非空选区；行号 1-based（lineAt().number）
        getSelection: () => {
          const v = ensureView();
          if (!v) return null;
          const { state } = v;
          const range = state.selection.main;
          if (range.from === range.to) return null;
          return {
            text: state.sliceDoc(range.from, range.to),
            startLine: state.doc.lineAt(range.from).number,
            endLine: state.doc.lineAt(range.to).number,
          };
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
    const extraCompartment = new Compartment();
    readonlyCompartmentRef.current = readonlyCompartment;
    langCompartmentRef.current = langCompartment;
    diffCompartmentRef.current = diffCompartment;
    extraCompartmentRef.current = extraCompartment;

    const initialMode: EditorMode = mode;
    const initialDiffRevision: DiffRevision | null = diffRevision;
    currentModeRef.current = initialMode;
    currentDiffRevisionRef.current = initialDiffRevision;

    const diffExtension =
      initialMode === 'inline-diff' && initialDiffRevision
        ? buildDiffExt(initialDiffRevision)
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
      extraCompartment.of(extraExtensions ?? []),
      scrollToLineExtension(),
      // BLOCK-42 — 文档变化派发（normal 模式 only；callback 走 ref 保持扩展稳定）
      EditorView.updateListener.of((u) => {
        if (!u.docChanged) return;
        if (currentModeRef.current === 'inline-diff') return;
        onChangeRef.current?.(u.state.doc.toString());
      }),
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
      void loadLanguage(language).then((langExt) => {
        if (cancelled) return;
        const compartment = langCompartmentRef.current;
        if (!compartment || !viewRef.current) return;
        // UI-395 — 未识别格式走通用保底高亮（用户裁决：常见格式都要有，保底通用）
        viewRef.current.dispatch({
          effects: compartment.reconfigure(langExt ? [langExt] : [createFallbackLanguage()]),
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
    void loadLanguage(language).then((langExt) => {
      if (cancelled || !viewRef.current) return;
      viewRef.current.dispatch({
        effects: compartment.reconfigure(langExt ? [langExt] : [createFallbackLanguage()]),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  // mode 变化：reconfigure diffCompartment
  useEffect(() => {
    const view = viewRef.current;
    const diffCompartment = diffCompartmentRef.current;
    if (!view || !diffCompartment) return;
    currentModeRef.current = mode;
    if (mode === 'inline-diff') {
      const rev = currentDiffRevisionRef.current;
      const diffExt = rev ? buildDiffExt(rev) : [];
      view.dispatch({ effects: diffCompartment.reconfigure(diffExt) });
    } else {
      view.dispatch({ effects: diffCompartment.reconfigure([]) });
    }
  }, [mode]);

  // diffRevision 变化：仅 inline-diff 时 reconfigure diff
  useEffect(() => {
    const view = viewRef.current;
    const diffCompartment = diffCompartmentRef.current;
    if (!view || !diffCompartment) return;
    currentDiffRevisionRef.current = diffRevision;
    if (currentModeRef.current !== 'inline-diff') return;
    const diffExt = diffRevision ? buildDiffExt(diffRevision) : [];
    view.dispatch({ effects: diffCompartment.reconfigure(diffExt) });
  }, [diffRevision]);

  // BLOCK-28 — extraExtensions 变化：经独立 Compartment 热替换（不重建 view）
  useEffect(() => {
    const view = viewRef.current;
    const extraCompartment = extraCompartmentRef.current;
    if (!view || !extraCompartment) return;
    view.dispatch({ effects: extraCompartment.reconfigure(extraExtensions ?? []) });
  }, [extraExtensions]);
}
