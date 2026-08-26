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
   * 旧文本（baseline 侧该 hunk 覆盖的行内容）。P2 acceptHunk 走 IPC 时
   * 用此生成正向 patch（由 `apply-inverse-hunk` 内部 invert 后应用）。
   * 缺省视为空串。
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
 * AcceptRejectEvent：accept / reject 操作产生的事件载荷。
 *
 * P2 不接 events.ts（事件总线 P3 才接），所以这里只是 UI 回调的载荷定义；
 * 业务侧按需订阅，事件总线不会自动 dispatch。
 */
export interface AcceptRejectEvent {
  /** 操作类型。 */
  type: 'accept' | 'reject';
  /** 关联的 hunk id（与 `DiffHunk.id` 对齐）。 */
  hunkId: string;
  /** 操作发生的 epoch ms。 */
  timestamp: number;
}

/**
 * CodeMirror EditorView 的命令面（P0 + P1 + P2）。
 *
 * P0：getValue / setValue / destroy
 * P1：setMode / setDiffRevision / scrollToLine / getDiffRevision / getMode
 * P2：acceptHunk / rejectHunk / acceptAll / rejectAll / getHunk
 */
export interface EditorApi {
  /** 同步读出当前编辑器文档（normal 模式 = 文档全文；inline-diff 模式 = modifiedText）。 */
  getValue(): string;
  /** 整文替换（不重建 view；normal 模式生效）。 */
  setValue(value: string): void;
  /** 卸载时调用。 */
  destroy(): void;
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
  /**
   * Accept 单 hunk：通过 IPC `git:apply-inverse-hunk` 把 hunk 的反向 patch 应用到工作区。
   *
   * P2 实现：通过 `desktopBridge` 调 `biof3Desktop.workingTreeReview.applyInverseHunk`，
   * 不接业务侧 dispatch（事件总线 P3 才接）。
   *
   * @param hunkId `DiffHunk.id`；编辑器不持有 IPC patch 文本，所以 P2 只在
   *               已知 `DiffHunk` 含 `oldText`/`newText` 等可生成 patch 的元数据时使用。
   * @returns IPC 调用结果；任何 throw 走 `onError`（P2 prop）。
   */
  acceptHunk(hunkId: string): Promise<void>;
  /**
   * Reject 单 hunk：当前实现等价于整文件 revert（P2 不单做"按 hunk revert"）。
   * 真正的"按 hunk revert"路径走 `git:hunk-reject-inverse`，由 BLOCK-20 PHASE 4
   * 落地；P3 业务侧接入后才需要。
   *
   * P2 实现：调 `biof3Desktop.workingTreeReview.revertFile({ path })`。
   */
  rejectHunk(hunkId: string): Promise<void>;
  /**
   * Accept 所有 hunks：遍历当前 diffRevision.hunks，逐一 accept。
   * 单 hunk 失败不影响其他 hunk；最终整体结果通过返回值聚合（allOk 字段）。
   */
  acceptAll(): Promise<{ allOk: boolean; succeeded: string[]; failed: Array<{ hunkId: string; error: string }> }>;
  /**
   * Reject 整文件：等价单次 `git:revert-file`。
   */
  rejectAll(): Promise<void>;
  /**
   * 取当前 hunk 详情（用于 P2 内部生成 patch / IPC 序列化）。
   * 找不到返回 null。
   */
  getHunk(hunkId: string): DiffHunk | null;
  /**
   * 从本地数据结构中移除 hunk（CSS 淡出 + diffCompartment reconfigure）。
   *
   * Task 2 实现：
   * 1. 给该 hunk 的所有 `[data-hunk-id]` DOM 元素加 `dismissing` class，
   *    触发 200ms CSS transition 淡出背景色
   * 2. 200ms 后从 `currentDiffRevisionRef.current.hunks` 过滤掉该 hunk，
   *    触发 `diffCompartment.reconfigure` 重建 unifiedMergeView
   *
   * 纯本地数据结构操作（不调 IPC）。IPC 完成后由 `acceptHunk` / `rejectHunk`
   * 调用方负责调用本方法。
   */
  dismissHunk(hunkId: string): void;
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
   * Accept hunk 回调。P2 落地：
   * - 走 `view.contentDOM` click 拦截（按 data-accept-hunk 匹配）
   * - 真正接事件总线（dispatch events）由 P3 完成
   */
  onAcceptHunk?: (hunkId: string) => void;
  /**
   * Reject hunk 回调。P2 落地（语义同上）。
   */
  onRejectHunk?: (hunkId: string) => void;
  /**
   * IPC 失败回调：accept / reject IPC 抛出时调用。
   * P2 用于承载业务侧 toast / fallback；不接事件总线。
   */
  onError?: (err: unknown) => void;
  /**
   * 子节点：挂在编辑器 DOM 容器内，可在 P3 由业务侧用于额外 UI 叠层
   * （例如 HunkHUD、跳转锚点）。P2 不消费。
   */
  children?: React.ReactNode;
  /**
   * 是否在编辑器上方挂载 DiffActionBar（Accept All / Reject All / Review）。
   *
   * 默认 false（向后兼容：现有调用方 0 改动）。仅当业务侧希望暴露
   * "整文件决策"快捷入口时才打开；与 `mode === 'inline-diff'` 配套使用，
   * 其它 mode 下 bar 自动隐藏。
   *
   * P3 落地：业务侧 WorkspaceFilePreview 入口按 prop 打开。
   */
  showDiffActionBar?: boolean;
}
