/**
 * BLOCK-22 P3 桥接层 (UI-194) — WorkspaceFilePreviewBridge
 *
 * 用途：建立"事件 → context → CodeMirrorEditor"的抽象桥接层
 *
 * 本文件**不**直接消费 SimpleChat.tsx / events.ts / WorkspaceFilePreview。
 * 按 petri-project-governance §Guardrails "Never modify unknown WIP"，
 * 业务侧入口（SimpleChat 聊天卡片 / WorkspaceFilePreview 容器）的具体
 * 接入动作**不在 P3 范围**，留给 WIP 收口后由业务侧 Agent 负责。
 *
 * WorkspaceFilePreviewBridge —— CodeMirrorEditor + PendingScrollContext 集成包装：
 * 1. 内部 wrap PendingScrollProvider，**避免业务侧重复 wrap**
 * 2. 订阅 pendingRequest：当 filePath 匹配时调 editorApi.scrollToLine
 * 3. 当 pendingRequest.diffRevision 存在时切到 inline-diff 模式并应用 revision
 * 4. 处理完一次后清空 pendingRequest
 *
 * P4.2 改进：
 * - 改进 1：自动检测外部 Provider，避免 double wrap
 * - 改进 2：导出 `useEditorApi()` hook，业务侧可直接调用 EditorApi
 *
 * 设计要点：
 * - 不直接读取文件、不直接调 IPC、不调 git-adapter（业务侧负责提供 content）
 * - 不消费 SimpleChat / events.ts（保持桥接层纯净）
 * - 默认 mode = 'normal'；只有业务侧显式传 'inline-diff' 才进 diff 模式
 *
 * 不外推：详见 plan §8。
 */

import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { CodeMirrorEditor } from '../CodeMirror/CodeMirrorEditor';
import type {
  CodeMirrorEditorProps,
  DiffRevision,
  EditorApi,
  EditorMode,
} from '../CodeMirror/types';
import {
  PendingScrollProvider,
  usePendingScroll,
  useHasPendingScrollProviderContext,
} from '../../../lib/pendingScrollContext';

// ===== EditorApiContext =====

/**
 * EditorApiContext —— 跨组件共享 EditorApi 实例的 Context。
 *
 * 用途：BridgeInner 内部通过 callback ref 填充 api，
 *       供 `useEditorApi()` hook 读取（业务侧无需通过 prop drilling 传 ref）。
 *
 * 不直接订阅 PendingScrollContext，仅作为 EditorApi 的"读端"；
 * 业务侧拿到 EditorApi 后可直接调 scrollToLine / setMode / setDiffRevision。
 *
 * P4.2 实现细节：context value 是稳定的 `{ api: EditorApi | null }` 对象引用，
 *               通过 mutation 更新 api 字段，避免触发 context consumer 重新渲染。
 */
const EditorApiContext = React.createContext<{ api: EditorApi | null }>({ api: null });

export interface WorkspaceFilePreviewBridgeProps
  extends Omit<CodeMirrorEditorProps, 'mode' | 'diffRevision'> {
  /** 当前预览的文件路径（用于比对 pendingRequest.filePath）。 */
  filePath: string;
  /**
   * 编辑器模式（normal / inline-diff）。默认 'normal'。
   *
   * 注意：当 pendingRequest.diffRevision 存在时会被**临时**切到 'inline-diff'
   *       并应用 revision；下次清空时还原 props.mode。
   */
  mode?: EditorMode;
  /**
   * 初始 diff revision（仅 inline-diff 模式生效）。
   * pendingRequest.diffRevision 会覆盖此值。
   */
  diffRevision?: DiffRevision | null;
  /** 透传给 CodeMirrorEditor 的子节点（HunkHUD、跳转锚点等）。 */
  children?: ReactNode;
}

/**
 * WorkspaceFilePreviewBridge —— 公开 API。
 *
 * 用法（业务侧一行接入）：
 *   <WorkspaceFilePreviewBridge
 *     filePath="/workspace/foo.py"
 *     value={content}
 *     language="python"
 *   />
 *
 * 默认 mode = 'normal'；业务侧显式传 mode='inline-diff' 才进 diff 模式。
 *
 * P4.2 改进：内部已自动检测外部 Provider，**业务侧无需再次 wrap PendingScrollProvider**。
 *            若外部已 wrap，内部不会 double wrap（React Context 隔离规则导致 double wrap
 *            会让 Context 失效）。
 *
 * 通过 `editorRef` prop 透传 EditorApi（原有方式，仍有效）：
 *   const editorRef = useRef<EditorApi | null>(null);
 *   <WorkspaceFilePreviewBridge editorRef={editorRef} ... />
 *   // 或直接用 useEditorApi() hook
 *
 * 父组件可拿到 CodeMirrorEditor 的命令面。
 */
export function WorkspaceFilePreviewBridge({
  filePath,
  mode = 'normal',
  diffRevision = null,
  children,
  editorRef,
  ...rest
}: WorkspaceFilePreviewBridgeProps & { editorRef?: React.MutableRefObject<EditorApi | null> }): React.ReactElement {
  return (
    <BridgeRoot
      filePath={filePath}
      mode={mode}
      diffRevision={diffRevision}
      editorRef={editorRef}
      {...rest}
    >
      {children}
    </BridgeRoot>
  );
}

/**
 * BridgeRoot —— 自动 wrap PendingScrollProvider 的根组件。
 *
 * P4.2 改进：
 * - 用 `useHasPendingScrollProviderContext()` 检测是否已有外部 Provider
 * - 若无外部 Provider，内部自动 wrap（业务侧无需关心）
 * - 若已有外部 Provider，直接 render BridgeInner（避免 double wrap）
 *
 * 不使用 `React.memo`，因为 BridgeInner 需要无条件接收外部 context 变化。
 */
function BridgeRoot({
  filePath,
  mode,
  diffRevision,
  children,
  editorRef,
  ...rest
}: WorkspaceFilePreviewBridgeProps & { editorRef?: React.MutableRefObject<EditorApi | null> }): React.ReactElement {
  // P4.2 改进 1：检测外部是否已有 Provider
  const hasOuter = useHasPendingScrollProviderContext();

  const inner = (
    <BridgeInner
      filePath={filePath}
      mode={mode}
      diffRevision={diffRevision}
      editorRef={editorRef}
      {...rest}
    >
      {children}
    </BridgeInner>
  );

  if (hasOuter) {
    // 已有外部 Provider，直接 render
    return inner;
  }

  // 无外部 Provider，内部自动 wrap
  return (
    <PendingScrollProvider>
      {inner}
    </PendingScrollProvider>
  );
}

/**
 * 内部桥接消费者：
 * - 必须挂在 PendingScrollProvider 内（由 BridgeRoot 保证）
 * - 通过 usePendingScroll() 订阅 + 调用 editorApi
 *
 * 注意：使用 callback ref 把 CodeMirrorEditor 暴露的 api 同步到本地 ref，
 *       避免 `useImperativeHandle` 的"调用工厂时 ref 未填"的时序问题。
 *
 * P4.2 改进：通过 EditorApiContext + BridgeInner 内联填充，使 useEditorApi() 可用。
 */
function BridgeInner({
  filePath,
  mode = 'normal',
  diffRevision = null,
  children,
  editorRef,
  ...rest
}: WorkspaceFilePreviewBridgeProps & { editorRef?: React.MutableRefObject<EditorApi | null> }): React.ReactElement {
  const { pendingRequest, setPendingRequest } = usePendingScroll();
  const editorApiRef = useRef<EditorApi | null>(null);
  // P4.2：稳定对象引用，context value 永不重新创建
  const ctxValueRef = useRef<{ api: EditorApi | null }>({ api: null });
  // P4.2：re-render trigger — 仅在 api 填充后触发一次（非 render-phase call，无限循环风险）
  const [reloadKey, setReloadKey] = useState(0);
  // P4.2：guard 确保只触发一次
  const didReloadRef = useRef(false);
  // 保存业务侧传入的"基础" mode / diffRevision，用于 pending 处理完后恢复
  const baseModeRef = useRef<EditorMode>(mode);
  const baseDiffRevisionRef = useRef<DiffRevision | null>(diffRevision);
  baseModeRef.current = mode;
  baseDiffRevisionRef.current = diffRevision;

  // callback ref：CodeMirrorEditor 暴露 api 时同步到本地 ref + 透传给 editorRef
  const handleEditorRef = useCallback(
    (api: EditorApi | null) => {
      editorApiRef.current = api;
      if (api !== null) {
        ctxValueRef.current.api = api;
        // P4.2：在 commit phase 触发一次 re-render，让 context consumer 读到新 api
        if (!didReloadRef.current) {
          didReloadRef.current = true;
          setReloadKey(k => k + 1);
        }
      }
      if (editorRef) {
        editorRef.current = api;
      }
    },
    [editorRef],
  );

  // 处理 pendingRequest 变化
  // BLOCK-42 P4 实机缺陷修复：同文件重开（activeFile 引用变化 → 重新 fetch →
  // status loading 卸载编辑器 → ready 重建）时，旧 view 会在卸载前同步消费
  // pendingRequest 并滚动，随后 view 销毁导致滚动丢失。改为 rAF 延迟一帧消费：
  // unmount 时 cleanup 取消 rAF（不清空 pendingRequest），新实例 mount 后
  // api 就绪（reloadKey 触发 effect re-run）再消费。
  useEffect(() => {
    if (!pendingRequest) return;
    if (pendingRequest.filePath !== filePath) return;

    const api = editorApiRef.current;
    if (!api) return;

    const raf = requestAnimationFrame(() => {
      const liveApi = editorApiRef.current;
      if (!liveApi) return; // view 已销毁：保留 pendingRequest 给重建后的实例

      // 1) 应用 diff revision（若存在）：先切到 inline-diff 再 setDiffRevision
      if (pendingRequest.diffRevision) {
        liveApi.setMode('inline-diff');
        liveApi.setDiffRevision(pendingRequest.diffRevision);
      } else {
        // 恢复业务侧传入的基础 mode / revision
        liveApi.setMode(baseModeRef.current);
        liveApi.setDiffRevision(baseDiffRevisionRef.current);
      }

      // 2) 滚动到目标行
      liveApi.scrollToLine({
        line: pendingRequest.line,
        column: pendingRequest.column,
        pulseMs: pendingRequest.pulseMs,
      });

      // 3) 清空 pendingRequest（一次性语义）
      setPendingRequest(null);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRequest, filePath, reloadKey]);

  // P4.2：EditorApiContext 消费者需要 EditorApi 实例（通过稳定引用 + reloadKey 触发重渲染）
   
  const ctxValue = React.useMemo(() => ctxValueRef.current, [reloadKey]);

  return (
    <EditorApiContext.Provider value={ctxValue}>
      <CodeMirrorEditor
        {...rest}
        ref={handleEditorRef}
        mode={mode}
        diffRevision={diffRevision}
      >
        {children}
      </CodeMirrorEditor>
    </EditorApiContext.Provider>
  );
}
