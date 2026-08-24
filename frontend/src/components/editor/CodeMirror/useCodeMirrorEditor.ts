/**
 * BLOCK-22-CODEMIRROR-INLINE-DIFF — useCodeMirrorEditor hook
 *
 * 单例 EditorView 模式：
 * - 每个 hook 调用挂载一个 EditorView 到传入的 parent DOM 节点
 * - 用 Compartment 把 `EditorView.editable` 重新配置
 * - 用 Compartment 把语言 extension 重新配置
 * - **P1 新增**：用 Compartment 把 diff extension 重新配置（`diffCompartment`）
 * - 用 useRef + useEffect cleanup 守护 React 19 strict mode 的双 mount
 *
 * EditorApi 通过 apiRef 暴露（由父组件用 forwardRef 转接）：
 * - P0: getValue / setValue / destroy
 * - P1: setMode / getMode / setDiffRevision / getDiffRevision / scrollToLine
 *
 * P2 才扩：accept / reject。
 */

import { useEffect, useImperativeHandle, useRef, type RefObject } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
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
import { createUnifiedDiffExtension } from './extensions/unifiedDiff';
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
  } = options;

  const viewRef = useRef<EditorView | null>(null);
  const readonlyCompartmentRef = useRef<Compartment | null>(null);
  const langCompartmentRef = useRef<Compartment | null>(null);
  const diffCompartmentRef = useRef<Compartment | null>(null);

  // 当前状态镜像（apiRef 暴露 read 用）
  const currentModeRef = useRef<EditorMode>(mode);
  const currentDiffRevisionRef = useRef<DiffRevision | null>(diffRevision);

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
            const diffExt = rev ? createUnifiedDiffExtension(rev) : [];
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
          const diffExt = rev ? createUnifiedDiffExtension(rev) : [];
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
    readonlyCompartmentRef.current = readonlyCompartment;
    langCompartmentRef.current = langCompartment;
    diffCompartmentRef.current = diffCompartment;

    const initialMode: EditorMode = mode;
    const initialDiffRevision: DiffRevision | null = diffRevision;
    currentModeRef.current = initialMode;
    currentDiffRevisionRef.current = initialDiffRevision;

    const diffExtension =
      initialMode === 'inline-diff' && initialDiffRevision
        ? createUnifiedDiffExtension(initialDiffRevision)
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

  // mode 变化：reconfigure diffCompartment
  useEffect(() => {
    const view = viewRef.current;
    const compartment = diffCompartmentRef.current;
    if (!view || !compartment) return;
    currentModeRef.current = mode;
    if (mode === 'inline-diff') {
      const rev = currentDiffRevisionRef.current;
      const diffExt = rev ? createUnifiedDiffExtension(rev) : [];
      view.dispatch({ effects: compartment.reconfigure(diffExt) });
    } else {
      view.dispatch({ effects: compartment.reconfigure([]) });
    }
  }, [mode]);

  // diffRevision 变化：仅 inline-diff 时 reconfigure diff
  useEffect(() => {
    const view = viewRef.current;
    const compartment = diffCompartmentRef.current;
    if (!view || !compartment) return;
    currentDiffRevisionRef.current = diffRevision;
    if (currentModeRef.current !== 'inline-diff') return;
    const diffExt = diffRevision ? createUnifiedDiffExtension(diffRevision) : [];
    view.dispatch({ effects: compartment.reconfigure(diffExt) });
  }, [diffRevision]);
}
