/**
 * BLOCK-22-CODEMIRROR-INLINE-DIFF — 公共类型
 *
 * P0 只读版本：只暴露只读渲染所需类型。
 * P1 才会补充 EditorMode 联合类型 'normal' | 'inline-diff'、DiffRevision / DiffHunk。
 * P2 才会补充 accept / reject / scrollToLine 等扩展 API 类型。
 *
 * 严格的导入边界：editor 外部代码只能从这个 barrel（`./index.ts`）导出；
 * 任何对 EditorApi 的新增都必须先扩这个 types.ts。
 */

export type EditorMode = 'normal';

/**
 * CodeMirror EditorView 的最小命令面（P0 只读 API）。
 *
 * 故意只暴露三个能力：
 * - getValue() — 同步读出当前编辑器文档
 * - setValue(v) — 整文替换（不重建 view）
 * - destroy() — 卸载时调用
 *
 * P1 才会扩：
 * - scrollToLine(line, { pulse?: boolean })
 * - setMode('normal' | 'inline-diff', DiffRevision?)
 *
 * P2 才会扩：
 * - acceptHunk(hunkIndex)
 * - rejectHunk(hunkIndex)
 */
export interface EditorApi {
  getValue(): string;
  setValue(value: string): void;
  destroy(): void;
}

export interface CodeMirrorEditorProps {
  /** 整篇文档内容；变化时通过 dispatch 更新而非重建 view。 */
  value: string;
  /**
   * 高亮语言提示（按文件扩展名推断 / 由父组件传入）。
   * 与 `frontend/src/components/ui/CodeHighlight.tsx` 的 `language` 参数语义一致。
   * P0 不强制要求；P1 会用它驱动 languageLoader。
   */
  language?: string;
  /** P0 默认 true：只读模式。P1 才允许 false。 */
  readonly?: boolean;
  className?: string;
}
