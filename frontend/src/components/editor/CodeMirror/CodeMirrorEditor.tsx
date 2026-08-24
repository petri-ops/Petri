/**
 * BLOCK-22-CODEMIRROR-INLINE-DIFF — CodeMirrorEditor 组件
 *
 * P0 只读最小实现：
 * - 受控 value：通过 dispatch 整文替换，不重建 view
 * - readonly 开关：P0 默认 true，P1 才允许 false
 * - language：通过 languageLoader 懒加载
 * - 不接任何业务事件（不订阅 events.ts）
 * - 不接 fallbackKind 判定（P3 才接入 WorkspaceFilePreview）
 *
 * 设计要点：
 * - useRef 守护 React 19 strict mode 双 mount
 * - 把父 DOM 通过 ref 传给 useCodeMirrorEditor
 * - 用 forwardRef 暴露 EditorApi（getValue / setValue / destroy）
 */

import React, { forwardRef, useRef } from 'react';

import { useCodeMirrorEditor } from './useCodeMirrorEditor';
import type { CodeMirrorEditorProps, EditorApi } from './types';
import styles from './CodeMirrorEditor.module.css';

export const CodeMirrorEditor = forwardRef<EditorApi, CodeMirrorEditorProps>(function CodeMirrorEditor(
  { value, language, readonly = true, className },
  ref,
) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<EditorApi | null>(null);
  const lastValueRef = useRef<string>(value);

  useCodeMirrorEditor(
    {
      parentRef,
      initialValue: value,
      readonly,
      language,
    },
    apiRef,
  );

  // 把 apiRef 转接给父组件 ref
  // 注意：forwardRef 的 ref 是固定的 mutable ref 对象，直接把 apiRef.current 写入即可
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (typeof ref === 'function') {
      ref(apiRef.current);
    } else if (ref) {
      (ref as React.MutableRefObject<EditorApi | null>).current = apiRef.current;
    }
  });

  // value 变化：透传给底层 EditorApi.setValue（dispatch 整文替换，不重建 view）
  React.useEffect(() => {
    if (value === lastValueRef.current) return;
    lastValueRef.current = value;
    const api = apiRef.current;
    if (api) api.setValue(value);
  }, [value]);

  return (
    <div
      ref={parentRef}
      className={[styles.cmEditor, className].filter(Boolean).join(' ')}
      data-block-22-codemirror
      data-readonly={readonly ? 'true' : 'false'}
      aria-readonly={readonly}
    />
  );
});
