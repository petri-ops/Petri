/**
 * BLOCK-22 P3 桥接层 (UI-194) — WorkspaceFilePreviewBridge
 *
 * 用途：建立"事件 → context → CodeMirrorEditor"的抽象桥接层
 *
 * 本文件**不**直接消费 SimpleChat.tsx / events.ts / WorkspaceFilePreview。
 * 按 biof3-project-governance §Guardrails "Never modify unknown WIP"，
 * 业务侧入口（SimpleChat 聊天卡片 / WorkspaceFilePreview 容器）的具体
 * 接入动作**不在 P3 范围**，留给 WIP 收口后由业务侧 Agent 负责。
 *
 * WorkspaceFilePreviewBridge —— CodeMirrorEditor + PendingScrollContext 集成包装：
 * 1. 内部 wrap PendingScrollProvider，**避免业务侧重复 wrap**
 * 2. 订阅 pendingRequest：当 filePath 匹配时调 editorApi.scrollToLine
 * 3. 当 pendingRequest.diffRevision 存在时切到 inline-diff 模式并应用 revision
 * 4. 处理完一次后清空 pendingRequest
 *
 * 设计要点：
 * - 不直接读取文件、不直接调 IPC、不调 git-adapter（业务侧负责提供 content）
 * - 不消费 SimpleChat / events.ts（保持桥接层纯净）
 * - 默认 mode = 'normal'；只有业务侧显式传 'inline-diff' 才进 diff 模式
 *
 * 不外推：详见 plan §8。
 */

import React, { useCallback, useEffect, useRef, type ReactNode } from 'react';

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
} from '../../../lib/pendingScrollContext';

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
 * 用法：
 *   <WorkspaceFilePreviewBridge
 *     filePath="/workspace/foo.py"
 *     value={content}
 *     language="python"
 *   />
 *
 * 默认 mode = 'normal'；业务侧显式传 mode='inline-diff' 才进 diff 模式。
 *
 * 内部已经包了 PendingScrollProvider，**业务侧**无需再次 wrap；
 * 业务侧只需要调 `usePendingScroll().setPendingRequest({...})` 即可触发滚动。
 *
 * 通过 `editorRef` prop 透传 EditorApi：
 *   const editorRef = useRef<EditorApi | null>(null);
 *   <WorkspaceFilePreviewBridge editorRef={editorRef} ... />
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
    <PendingScrollProvider>
      <BridgeInner
        filePath={filePath}
        mode={mode}
        diffRevision={diffRevision}
        editorRef={editorRef}
        {...rest}
      >
        {children}
      </BridgeInner>
    </PendingScrollProvider>
  );
}

/**
 * 内部桥接消费者：
 * - 必须挂在 PendingScrollProvider 内
 * - 通过 usePendingScroll() 订阅 + 调用 editorApi
 *
 * 注意：使用 callback ref 把 CodeMirrorEditor 暴露的 api 同步到本地 ref，
 *       避免 `useImperativeHandle` 的"调用工厂时 ref 未填"的时序问题。
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
  // 保存业务侧传入的"基础" mode / diffRevision，用于 pending 处理完后恢复
  const baseModeRef = useRef<EditorMode>(mode);
  const baseDiffRevisionRef = useRef<DiffRevision | null>(diffRevision);
  baseModeRef.current = mode;
  baseDiffRevisionRef.current = diffRevision;

  // callback ref：CodeMirrorEditor 暴露 api 时同步到本地 ref + 透传给 editorRef
  const handleEditorRef = useCallback(
    (api: EditorApi | null) => {
      editorApiRef.current = api;
      if (editorRef) {
        editorRef.current = api;
      }
    },
    [editorRef],
  );

  // 处理 pendingRequest 变化
  useEffect(() => {
    if (!pendingRequest) return;
    if (pendingRequest.filePath !== filePath) return;

    const api = editorApiRef.current;
    if (!api) return;

    // 1) 应用 diff revision（若存在）：先切到 inline-diff 再 setDiffRevision
    if (pendingRequest.diffRevision) {
      api.setMode('inline-diff');
      api.setDiffRevision(pendingRequest.diffRevision);
    } else {
      // 恢复业务侧传入的基础 mode / revision
      api.setMode(baseModeRef.current);
      api.setDiffRevision(baseDiffRevisionRef.current);
    }

    // 2) 滚动到目标行
    api.scrollToLine({
      line: pendingRequest.line,
      column: pendingRequest.column,
      pulseMs: pendingRequest.pulseMs,
    });

    // 3) 清空 pendingRequest（一次性语义）
    setPendingRequest(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRequest, filePath]);

  return (
    <CodeMirrorEditor
      {...rest}
      ref={handleEditorRef}
      mode={mode}
      diffRevision={diffRevision}
    >
      {children}
    </CodeMirrorEditor>
  );
}