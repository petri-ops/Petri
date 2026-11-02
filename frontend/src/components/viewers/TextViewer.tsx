import React from 'react';
import { WorkspaceFilePreviewBridge } from '@/components/editor';
import type { EditorApi } from '@/components/editor/CodeMirror/types';

// BLOCK-334 P2 Slice B — 文本/JSON 唯一 viewer：两宿主统一到 CodeMirror 引擎
// （文件宿主原本即 CodeMirror 可编辑；结果壳原为 <pre> 只读）。验证腿
// `block334-p2-text-selection-live` 7/7 实证 CodeMirror 内的 DOM 选区可被选择总线式
// 采样（容器包含 + 非空文本）拿到，统一不回归「选择→继续分析」链；壳侧另经
// editorRef.getSelection() 取精确选区文本（长文档虚拟化下 DOM 选区可能不完整）。

export function TextViewer({
  value,
  language,
  readonly = false,
  filePath,
  onChange,
  editorRef,
  className,
  testId = 'text-viewer',
}: {
  value: string;
  /** CodeMirror 语言 id（json / markdown / 由 codeLanguageForFile 派生等）；缺省纯文本。 */
  language?: string;
  readonly?: boolean;
  /** pending-scroll 定位键（结果壳传产物名即可）。 */
  filePath: string;
  onChange?: (next: string) => void;
  /** 宿主持有 EditorApi（选区读取 / 行跳转）。 */
  editorRef?: React.MutableRefObject<EditorApi | null>;
  className?: string;
  testId?: string;
}): React.ReactElement {
  return (
    <div data-testid={testId} data-readonly={readonly ? 'true' : 'false'} style={{ display: 'contents' }}>
      <WorkspaceFilePreviewBridge
        filePath={filePath}
        value={value}
        language={language}
        readonly={readonly}
        className={className}
        onChange={onChange}
        editorRef={editorRef}
      />
    </div>
  );
}
