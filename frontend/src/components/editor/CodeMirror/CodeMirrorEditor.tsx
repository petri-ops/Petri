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
 * P2 新增：
 * - 接受 `onAcceptHunk` / `onRejectHunk` / `onError` props 透传到 hook
 * - 通过 `EditorApiContext` 把 EditorApi 实例暴露给可能的 P3 业务侧
 *   （不实际消费）
 *
 * 设计要点：
 * - useRef 守护 React 19 strict mode 的双 mount
 * - 把父 DOM 通过 ref 传给 useCodeMirrorEditor
 * - 用 forwardRef 暴露 EditorApi
 *
 * 不接：
 * - 事件总线 events.ts（P3 才接）
 * - WorkspaceFilePreview 容器入口（P3 才接）
 *
 * P3 增量（Task 3）：
 * - 新增 `showDiffActionBar?: boolean` prop（默认 false 向后兼容）
 * - 打开后挂 `<DiffActionBar>` 在 parentRef DOM 内最前（视觉位于编辑器上方）
 * - 不接管 CodeMirror 的 contentDOM；CM6 EditorView 仍按既有路径 append 到 parent
 */

import React, { createContext, forwardRef, useContext, useRef } from 'react';

import { useCodeMirrorEditor } from './useCodeMirrorEditor';
import { DiffActionBar } from './DiffActionBar';
import type {
  CodeMirrorEditorProps,
  EditorApi,
  EditorMode,
} from './types';
import styles from './CodeMirrorEditor.module.css';

/**
 * EditorApiContext：P2 新增。
 *
 * 让父组件以外的下游组件（例如 P3 WorkspaceFilePreview 内嵌区）能拿到
 * 当前 CodeMirrorEditor 的 EditorApi 实例；P3 才真正消费。
 *
 * 设计要点：
 * - 默认值 null（未在 Provider 内时）
 * - Provider 必须放在 hook 拿到 apiRef 之后；当前实现放在 mount 完成前同步赋值。
 */
export const EditorApiContext = createContext<EditorApi | null>(null);

export function useEditorApi(): EditorApi | null {
  return useContext(EditorApiContext);
}

export const CodeMirrorEditor = forwardRef<EditorApi, CodeMirrorEditorProps>(function CodeMirrorEditor(
  {
    value,
    language,
    readonly = true,
    mode = 'normal',
    diffRevision = null,
    className,
    onAcceptHunk,
    onRejectHunk,
    onError,
    showDiffActionBar = false,
    children,
  },
  ref,
) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<EditorApi | null>(null);
  const lastValueRef = useRef<string>(value);
  // 让 EditorApiContext 消费者能在 api 就绪后 re-render；初始化为 null
  const [contextApi, setContextApi] = React.useState<EditorApi | null>(null);

  useCodeMirrorEditor(
    {
      parentRef,
      initialValue: value,
      readonly,
      language,
      mode,
      diffRevision,
      onAcceptHunk,
      onRejectHunk,
      onError,
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
      (ref as React.MutableRefObject<EditorApi | null>).current = apiRef.current;
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
        data-cm6-mode={(mode as EditorMode) ?? 'normal'}
        aria-readonly={readonly}
        data-show-diff-action-bar={showDiffActionBar ? 'true' : 'false'}
      >
        {showDiffActionBar ? (
          <DiffActionBar apiRef={apiRef} onError={onError} />
        ) : null}
        {children}
      </div>
    </EditorApiContext.Provider>
  );
});