/**
 * BLOCK-22-CODEMIRROR-INLINE-DIFF — CodeMirrorEditor 组件
 *
 * P0 只读最小实现 + P1 mode 切换 + inline-diff 渲染：
 * - 受控 value：normal 模式通过 dispatch 整文替换，不重建 view
 * - readonly 开关：P0 默认 true
 * - language：通过 languageLoader 懒加载
 * - mode：normal / inline-diff 切换通过 diffCompartment reconfigure
 * - diffRevision：仅 inline-diff 模式生效；变化时 reconfigure diff extension
 *
 * 通过 `EditorApiContext` 把 EditorApi 实例暴露给下游业务侧。
 *
 * 设计要点：
 * - useRef 守护 React 19 strict mode 的双 mount
 * - 把父 DOM 通过 ref 传给 useCodeMirrorEditor
 * - 用 forwardRef 暴露 EditorApi
 *
 * BLOCK-43（UI-193 收口）：移除 BLOCK-22 通用 accept/reject widget 链路
 * （DiffActionBar 挂载 + onAcceptHunk/onRejectHunk/onError/showDiffActionBar
 * props）。业务路径的按 hunk 接受/拒绝由 BLOCK-28 `hunkControls.ts`
 * （经 extraExtensions 注入）承担。
 */

import React, { createContext, forwardRef, useRef } from 'react';

import { useCodeMirrorEditor } from './useCodeMirrorEditor';
import type {
  CodeMirrorEditorProps,
  EditorApi,
} from './types';
import styles from './CodeMirrorEditor.module.css';

/**
 * EditorApiContext。
 *
 * 让父组件以外的下游组件（例如 WorkspaceFilePreview 内嵌区）能拿到
 * 当前 CodeMirrorEditor 的 EditorApi 实例。
 *
 * 设计要点：
 * - 默认值 null（未在 Provider 内时）
 * - Provider 必须放在 hook 拿到 apiRef 之后；当前实现放在 mount 完成前同步赋值。
 */
export const EditorApiContext = createContext<EditorApi | null>(null);


export const CodeMirrorEditor = forwardRef<EditorApi, CodeMirrorEditorProps>(function CodeMirrorEditor(
  {
    value,
    language,
    readonly = true,
    mode = 'normal',
    diffRevision = null,
    className,
    onChange,
    extraExtensions,
    diffOptions,
    children,
  },
  ref,
) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<EditorApi | null>(null);
  const lastValueRef = useRef<string>(value);
  // 让 EditorApiContext 消费者能在 api 就绪后 re-render；初始化为 null
  const [contextApi, setContextApi] = React.useState<EditorApi | null>(null);

  // BLOCK-42 — onChange 包装：同步 lastValueRef，防止「打字 → onChange → setText →
  // value effect → setValue」的反馈回路（value effect 命中 lastValueRef 短路）
  const handleChangeRef = useRef(onChange);
  handleChangeRef.current = onChange;
  const handleOnChange = React.useCallback((next: string) => {
    lastValueRef.current = next;
    handleChangeRef.current?.(next);
  }, []);

  useCodeMirrorEditor(
    {
      parentRef,
      initialValue: value,
      readonly,
      language,
      mode,
      diffRevision,
      onChange: handleOnChange,
      extraExtensions,
      diffOptions,
    },
    apiRef,
  );

  // 把 apiRef 转接给父组件 ref + context 状态
  // 注意：forwardRef 的 ref 是固定的 mutable ref 对象，直接把 apiRef.current 写入即可
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (typeof ref === 'function') {
      ref(apiRef.current);
    } else if (ref) {
      (ref).current = apiRef.current;
    }
    setContextApi(apiRef.current);
  });

  // value 变化：透传给底层 EditorApi.setValue
  // inline-diff 模式下 setValue 是 no-op（unifiedMergeView 管理 doc）
  React.useEffect(() => {
    if (value === lastValueRef.current) return;
    lastValueRef.current = value;
    const api = apiRef.current;
    if (api) api.setValue(value);
  }, [value]);

  return (
    <EditorApiContext.Provider value={contextApi}>
      <div
        ref={parentRef}
        className={[styles.cmEditor, className].filter(Boolean).join(' ')}
        data-block-22-codemirror
        data-readonly={readonly ? 'true' : 'false'}
        data-cm6-mode={(mode) ?? 'normal'}
        aria-readonly={readonly}
      >
        {children}
      </div>
    </EditorApiContext.Provider>
  );
});