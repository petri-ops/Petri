/**
 * BLOCK-22-CODEMIRROR-INLINE-DIFF — barrel 导出
 *
 * 严格的导入边界：editor 外部代码只能从这个 barrel 导出，
 * 避免散落 import 引发 React strict mode 双 mount 等隐性问题。
 *
 * P0 只暴露 CodeMirrorEditor + 必要类型。
 * P1 才会扩 unifiedDiffExtension / DiffRevision / EditorMode 联合类型。
 * P3 新增 integration 层桥接组件（WorkspaceFilePreviewBridge / AppLevelBridge）。
 */

export { CodeMirrorEditor } from './CodeMirror/CodeMirrorEditor';
export type {
  CodeMirrorEditorProps,
  EditorApi,
  EditorMode,
  DiffRevision,
  DiffHunk,
  ScrollTarget,
  AcceptRejectEvent,
} from './CodeMirror/types';

// ===== P3 桥接层 (UI-194) =====
export { WorkspaceFilePreviewBridge } from './integration/WorkspaceFilePreviewBridge';
export type {
  WorkspaceFilePreviewBridgeProps,
} from './integration/WorkspaceFilePreviewBridge';
export { AppLevelBridge } from './integration/AppLevelBridge';
export type { DispatchOpenFileFn } from './integration/AppLevelBridge';
