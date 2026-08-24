/**
 * BLOCK-22-CODEMIRROR-INLINE-DIFF — useCodeMirrorEditor hook
 *
 * 单例 EditorView 模式：
 * - 每个 hook 调用挂载一个 EditorView 到传入的 parent DOM 节点
 * - 用 Compartment 把 `EditorView.editable` 重新配置，便于 P1 接编辑模式
 * - 用 useRef + useEffect cleanup 守护 React 19 strict mode 的双 mount
 * - 通过 useImperativeHandle 暴露只读 API（getValue / setValue / destroy）
 *
 * P0 故意只暴露三个方法；P1 才会扩 scrollToLine / setMode；P2 才会扩 accept / reject。
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
import type { EditorApi } from './types';

export interface UseCodeMirrorEditorOptions {
  /** 父组件提供的容器 DOM 节点 ref。 */
  parentRef: RefObject<HTMLElement | null>;
  /** 初始文档内容。 */
  initialValue: string;
  /** 只读开关，P0 默认 true。 */
  readonly?: boolean;
  /** 高亮语言标识（如 "python" / "typescript"），由 languageLoader 解析。 */
  language?: string;
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
  const { parentRef, initialValue, readonly = true, language } = options;
  const viewRef = useRef<EditorView | null>(null);
  const readonlyCompartmentRef = useRef<Compartment | null>(null);
  const langCompartmentRef = useRef<Compartment | null>(null);

  useImperativeHandle(
    apiRef,
    (): EditorApi => ({
      getValue: () => viewRef.current?.state.doc.toString() ?? '',
      setValue: (next: string) => {
        const view = viewRef.current;
        if (!view) return;
        const current = view.state.doc.toString();
        if (current === next) return;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: next },
        });
      },
      destroy: () => {
        const view = viewRef.current;
        if (view) {
          view.destroy();
          viewRef.current = null;
        }
      },
    }),
    [],
  );

  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) return;
    if (viewRef.current) return; // 严格模式下第二挂载命中守卫

    const readonlyCompartment = new Compartment();
    const langCompartment = new Compartment();
    readonlyCompartmentRef.current = readonlyCompartment;
    langCompartmentRef.current = langCompartment;

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
    ];

    const state = EditorState.create({
      doc: initialValue,
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
    // 只读 + 语言变化时通过单独 effect 重配（见下）；这里只负责初始挂载。
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
}
