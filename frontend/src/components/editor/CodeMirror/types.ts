/**
 * BLOCK-22-CODEMIRROR-INLINE-DIFF — 公共类型
 *
 * P0 只读版本：只暴露只读渲染所需类型。
 * P1 落地：
 * - EditorMode 联合类型扩展为 'normal' | 'inline-diff'
 * - DiffRevision / DiffHunk 数据契约（用于 unified diff 渲染）
 * - ScrollTarget 滚动目标参数（含可选 column + 高亮 pulse）
 * - EditorApi 扩展：setMode / setDiffRevision / scrollToLine / getDiffRevision
 *
 * P2 才落地：accept / reject API 类型。
 *
 * 严格的导入边界：editor 外部代码只能从这个 barrel（`./index.ts`）导出；
 * 任何对 EditorApi 的新增都必须先扩这个 types.ts。
 */

import type { Extension } from '@codemirror/state';

import type { DiffViewOptions } from './extensions/unifiedDiff';

export type { DiffViewOptions };

/**
 * 编辑器模式。
 * - 'normal'：只读 / 可编辑单轨文本（默认）。
 * - 'inline-diff'：unified diff 行级 + 字符级对比（`diffRevision` 必填）。
 */
export type EditorMode = 'normal' | 'inline-diff';

/**
 * 单个 hunk（行级变更块）的类型。
 *
 * P1 只用于描述 / 传递元数据，CM6 unifiedMergeView 自身会从
 * originalText / modifiedText 重新算 chunks；这里保留类型方便上层
 * 业务侧（P2 / P3）按 hunk 维度操作（accept / reject / scrollToHunk）。
 */
export type DiffHunkKind = 'insert' | 'delete' | 'modify';

export interface DiffHunk {
  /** 稳定 id（用于 accept / reject 时定位）。 */
  id: string;
  /** hunk 起始行（modifiedText 一侧，1-based）。 */
  startLine: number;
  /** hunk 结束行（inclusive）。 */
  endLine: number;
  /** hunk 性质：纯插入 / 纯删除 / 修改（含字符级 inline diff）。 */
  kind: DiffHunkKind;
  /**
   * 旧文本（baseline 侧该 hunk 覆盖的行内容）。缺省视为空串。
   */
  oldText?: string;
  /** 新文本（modifiedText 侧该 hunk 覆盖的行内容）。 */
  newText?: string;
}

/**
 * DiffRevision：一份"原始文本 vs 修改文本"的对比输入。
 *
 * P1 字段命名采用任务规范的 `filePath` / `originalText` / `modifiedText`，
 * 与 plan §3.3 的 `path` / `baseline` / `proposed` 是同一语义
 * （internal code 引用这层定义时统一改用 P1 命名）。
 */
export interface DiffRevision {
  /** 工作区相对路径（仅用于错误日志 / 调试）。 */
  filePath: string;
  /** 旧文本（git HEAD 或磁盘原始内容）。 */
  originalText: string;
  /** 新文本（agent 写入后的当前内容）。 */
  modifiedText: string;
  /** 可选：上层预解析的 hunk 列表；CM6 不强制依赖，会自算。 */
  hunks?: DiffHunk[];
}

/**
 * ScrollTarget：scrollToLine 命令的目标参数。
 *
 * `pulseMs > 0` 表示滚动后用 Decoration.mark 高亮目标位置指定毫秒后自动清除。
 * `highlight: true` 是简写：`pulseMs = 3000`。
 */
export interface ScrollTarget {
  /** 目标行号（1-based）。 */
  line: number;
  /** 列偏移（0-based，从行首开始算字符数；缺省 0）。 */
  column?: number;
  /** 简写开关：true 等价 pulseMs = 3000。 */
  highlight?: boolean;
  /** 自定义 pulse 持续毫秒；`highlight` 优先。 */
  pulseMs?: number;
}

/**
 * BLOCK-52 P1（选中即引用）：编辑器当前选区的只读快照。
 * 行号为 1-based，与 ScrollTarget.line / pendingScroll 语义一致。
 */
export interface EditorSelectionInfo {
  /** 选中文字原文（调用方负责截断上限）。 */
  text: string;
  /** 起始行（1-based）。 */
  startLine: number;
  /** 结束行（1-based，含端点）。 */
  endLine: number;
}

/**
 * CodeMirror EditorView 的命令面（P0 + P1）。
 *
 * P0：getValue / setValue / destroy
 * P1：setMode / setDiffRevision / scrollToLine / getDiffRevision / getMode
 * BLOCK-52 P1：getSelection
 *
 * BLOCK-43：通用 accept/reject EditorApi（acceptHunk/rejectHunk/acceptAll/
 * rejectAll/getHunk/dismissHunk）已随 BLOCK-22 通用 widget 链路退休；
 * 业务路径的按 hunk 决策由 BLOCK-28 hunkControls（decideHunk）承担。
 */
export interface EditorApi {
  /** 同步读出当前编辑器文档（normal 模式 = 文档全文；inline-diff 模式 = modifiedText）。 */
  getValue(): string;
  /** 整文替换（不重建 view；normal 模式生效）。 */
  setValue(value: string): void;
  /** 卸载时调用。 */
  destroy(): void;
  /** BLOCK-52 P1：读出当前非空选区（空选区返回 null）。 */
  getSelection(): EditorSelectionInfo | null;
  /** 切换 EditorMode（normal ↔ inline-diff）。P1 落地。 */
  setMode(mode: EditorMode): void;
  /** 当前 mode。P1 落地。 */
  getMode(): EditorMode;
  /** 切换 diff revision（仅 inline-diff 模式生效）。传入 null 保持 inline-diff 但清空 revision。 */
  setDiffRevision(rev: DiffRevision | null): void;
  /** 当前 diff revision；normal 模式返回 null。P1 落地。 */
  getDiffRevision(): DiffRevision | null;
  /** 滚动到目标行 + 可选 pulse。P1 落地。 */
  scrollToLine(target: ScrollTarget): void;
}

export interface CodeMirrorEditorProps {
  /** 整篇文档内容；变化时通过 dispatch 更新而非重建 view（normal 模式）。 */
  value: string;
  /**
   * 高亮语言提示（按文件扩展名推断 / 由父组件传入）。
   * 与 `frontend/src/components/ui/CodeHighlight.tsx` 的 `language` 参数语义一致。
   */
  language?: string;
  /** P0 默认 true：只读模式。P1 才允许 false。 */
  readonly?: boolean;
  /** 编辑器模式（normal / inline-diff）；默认 'normal'。P1 落地。 */
  mode?: EditorMode;
  /**
   * DiffRevision；仅 `mode === 'inline-diff'` 时必填；normal 模式忽略。
   * 变化时触发 destroy + recreate（diff 是有状态的，不可 hot-replace）。
   * P1 落地。
   */
  diffRevision?: DiffRevision | null;
  className?: string;
  /**
   * BLOCK-42 — 文档变化回调（normal 模式 only；inline-diff 模式不派发）。
   * 用户编辑与程序化 setValue 都可能触发；业务侧（WorkspaceFilePreview）
   * 用它同步 React state 保持既有 dirty/save 链路。
   */
  onChange?: (value: string) => void;
  /**
   * 子节点：挂在编辑器 DOM 容器内，可在 P3 由业务侧用于额外 UI 叠层
   * （例如 HunkHUD、跳转锚点）。P2 不消费。
   */
  children?: React.ReactNode;
  /**
   * BLOCK-28 — 业务层注入的额外 CM6 扩展（如 hunk 悬浮控件）。
   * 数组引用变化时经独立 Compartment 热替换，不重建 view。
   */
  extraExtensions?: Extension[];
  /**
   * BLOCK-28 — inline-diff 渲染选项（如 collapseUnchanged 折叠未变更上下文）。
   * 缺省行为与 BLOCK-22 完全一致。
   */
  diffOptions?: DiffViewOptions;
}
