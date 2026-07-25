# G0 Result Studio — 意图驱动、可编辑、Git-backed 的科研结果工作台计划

最后更新：2026-07-24

状态：`ready_to_start`（LF12 checkpoint 已推送；按 §21 顺序从 RS0 启动，单线串行）

开发形态：`单工作包串行 / 主工作区分支`（不使用 Git Worktree，判据见 §14 `G0-RS-WT0`）

计划编号：`G0-RS`

主模块：`W-04 结果与报告`

协作模块：`P-01 项目、会话与上下文`、`P-02 工具执行、Job 与 Artifact Truth`、`P-03 Harness 与 Agent 工作流`、`P-04 Plugin SDK 与分析能力`

跨模块关注点：`C-03 安全、确认与审计`、`C-04 状态与事件同步`、`C-05 测试与质量门禁`、`C-06 性能与交互手感`

前置条件：已满足。`G0-LF12` 已完成首个 `G0 Baseline v1 = qualified + maintained`，源码、证据与文档提交已全部推送形成干净 checkpoint，base commit 为 `38d3de2`（`main` 与 `origin/main` 同步、工作区 clean）。`run_tool → tool_job → artifact truth`、源数据不可变、Loop 恢复与交付复现契约不得回归

范围边界：Result Studio 不属于 LF12 待资格功能。LF12 只验证当前结果投影与 UI 状态收敛；Result Studio 在 LF12 通过后按本计划独立启动。

## 1. 决策结论

BioF3 当前已经具备可信运行、Artifact 导航、静态预览、交付摘要、脚本入口和 ReplayPackage，但结果仍主要是“可查看的交付终点”，尚未成为用户可以持续探索、选择、编辑、比较和继续分析的科研工作对象。

本工作包把结果区域升级为：

> 用户只需查看结果、选择科学对象并用自然语言表达意图；Agent 负责读取产生该结果的输入、脚本、参数和流程节点，在隔离版本中修改并重跑，生成经过验证、可比较、可撤销、可复现的新结果。

采用以下核心架构：

> **真实 Git 负责脚本、参数、流程定义、结果清单与文本差异；Artifact Truth 负责科学产物、验证与 lineage；SQLite 负责索引、查询和 UI 投影；BioF3 提供不要求用户理解 Git 的 Codex-like 交互。**

不自研一个弱化版 Git，也不把大型科研数据强行提交 Git。

## 2. 产品目标

### 2.1 用户体验目标

用户应当能够：

1. 打开图、表或报告后立即知道它回答了什么、来自哪里、是否可信。
2. 在表格中筛选、排序和选择行列，在图中选择点、区域、基因或样本。
3. 直接说“把这些基因做富集”“重新标注这些点”“换成论文配色”等自然语言。
4. 让 Agent 自动结合当前 Artifact、选择内容、历史任务和科学目标理解意图。
5. 对展示层修改即时获得预览；对科学计算修改自动创建正式 Job 并验证。
6. 查看 AI 修改了哪些脚本、参数和结果，并比较修改前后。
7. 一键采用、撤销、恢复或从旧版本创建新方案。
8. 关闭会话、退出软件、关机或升级后仍恢复当前版本、选择和修改历史。
9. 对任意正式图表、表格或报告取得独立可执行脚本。
10. 在不了解 Git、R 包、文件路径和插件名称的情况下完成上述操作。

### 2.2 产品力目标

- 默认界面只呈现当前结果、关键结论、选择状态和最相关动作。
- 技术细节按需展开，不把 Git 暴露成普通用户的必修概念。
- AI 修改和手动编辑进入同一套参数、脚本、Revision 和验证机制。
- 修改过程有连续进度，不因下一次工具调用而消失。
- 预览、比较、采用和撤销形成一个连续工作流，不要求用户寻找输出目录。
- 所有正式修改可恢复、可解释、可复现，不以“丝滑”为理由牺牲科学诚信。

### 2.3 非目标

- 不创建第二套分析执行器、Job 表或 Artifact 仓库。
- 不允许 AI 直接覆盖原始脚本、源数据或已验证 Artifact。
- 不以截图编辑、像素涂改代替可复现脚本。
- 不要求第一阶段支持完整 IDE、任意 Git rebase 或通用图形设计软件能力。
- 不把 FASTQ、BAM、H5AD、RDS 等大型文件直接纳入普通 Git object database。
- 不为每个插件制作互不兼容的独立结果页面。

## 3. 永久不变量

### 3.1 执行与科学真相

1. 正式计算仍唯一走：

   ```text
   run_tool → tool_job → artifact truth
   ```

2. 展示层修改不能伪装成科学重算。
3. 会改变统计结论、数据内容或方法的修改必须创建正式 Job。
4. failed/blocked/degraded 结果不能因预览成功而升级为 valid。
5. 原始数据和既有正式 Revision 不可原地覆盖。
6. 每个新 Artifact 必须绑定父版本、输入、脚本、参数、环境、Job 与验证结果。

### 3.2 版本与恢复

1. 每次 AI 或手动正式修改形成原子 `ChangeSet`。
2. 文本变更必须可以查看真实 diff。
3. 二进制和大型数据变更必须提供语义差异与哈希，不伪造文本 diff。
4. 采用、撤销、恢复必须幂等。
5. 软件异常退出不能留下“部分采用”的混合状态。
6. 历史 Revision 除非用户明确清理，否则不得自动消失。

### 3.3 用户意图

1. Agent 不能只根据文件名猜测结果语义。
2. 当前 Artifact、选择对象、筛选条件、来源节点和用户语言共同组成意图上下文。
3. 只有科学设计存在多个会显著改变结论的合理选择、不可逆动作或重大外部副作用时才要求用户确认。
4. 纯查看行为不创建正式 Job；保存或用于后续分析时才物化为 Revision。

## 4. 目标用户体验

### 4.1 默认结果态

结果工作台默认只展示：

- 当前结果标题与可信状态。
- 一句话结论和必要限制。
- 主预览区。
- 紧凑的结果/版本导航。
- 当前选择摘要。
- “告诉 AI 怎么调整”入口。

脚本、参数、Commit、Job、Artifact hash 和日志默认折叠。

### 4.2 选择感知

用户对表格或图形的选择形成紧凑上下文 chip：

```text
已选择 27 个基因 · padj < 0.05 · log2FC > 1
```

输入框自动理解“这些基因”“这个簇”“异常的三个样本”等指代。

选择状态必须结构化保存，不能只拼接成自然语言。

### 4.3 AI 编辑

用户说：

```text
只标注 TP53、EGFR 和变化最大的 10 个基因，颜色柔和一些，导出 SVG。
```

系统应自动：

1. 定位当前火山图 Revision 和来源 Workflow node。
2. 读取当前 DEG Artifact、绘图脚本和参数。
3. 判断这是展示层重新渲染，不需要重跑 DESeq2。
4. 创建隔离 ChangeSet。
5. 修改派生脚本并执行。
6. 验证 SVG/PNG、标签和输入绑定。
7. 展示脚本 diff 与新旧图对比。
8. 自动切到预览版本；用户可采用或撤销。

### 4.4 手动编辑

用户可在属性面板调整：

- 配色、字体、尺寸、图例和标签。
- 表格列顺序、显示名、精度、排序和筛选。
- 可安全暴露的插件参数。

手动控件不得直接写结果文件。控件变化转换为与 AI 相同的参数 Patch、脚本生成和 Revision 流程。

### 4.5 Codex-like 变更审查

每轮修改显示紧凑摘要：

```text
AI 已完成修改

3 个文件发生变化                         +26  -9
plot_volcano.R                           +18  -7
plot_parameters.json                      +8  -2
artifact-manifest.json                    revision +1

生成结果
volcano.v2.svg                            验证通过

[查看变更] [比较结果] [撤销] [采用]
```

详细视图按类型展示：

| 类型 | 差异呈现 |
|---|---|
| R/Python/Markdown | Git 行级 diff |
| JSON/YAML | 字段级差异 + 原始 diff |
| CSV/TSV | schema、行数、过滤规则、关键统计和抽样行差异 |
| SVG/PNG | 前后并排、滑动对比、尺寸/元素摘要 |
| HTML 报告 | 章节、文本和引用 Artifact 差异 |
| DAG | 节点、参数、依赖和受影响子图 |
| 大型二进制 | hash、大小、结构、统计摘要，不展示虚假字节 diff |

### 4.6 历史与分支

普通用户看到：

- 原始版本
- 当前版本
- 历史版本
- 新方案
- 恢复
- 设为正式结果

高级视图才显示 Git commit、branch、父提交和完整 diff。

## 5. 总体架构

```text
Result Studio UI (W-04)
  ├─ Viewer Adapter
  ├─ Selection Context
  ├─ Manual Parameter Editor
  ├─ AI Edit Composer
  ├─ Diff / Compare
  └─ History / Adopt / Revert
          │
          ▼
Result Interaction Service (P-01 / P-03)
  ├─ Intent Resolver
  ├─ Edit Classifier
  ├─ Affected Subgraph Planner
  └─ ChangeSet Orchestrator
          │
          ├──────────────► Git Revision Backend
          │                 scripts / params / manifests / commits
          │
          └──────────────► Existing Execution Truth (P-02)
                            run_tool / tool_job / artifact truth
                                      │
                                      ▼
                              Artifact Store + Validator
```

### 5.1 四类真相的边界

| 真相 | 负责对象 | 不负责 |
|---|---|---|
| Git | 文本版本、Commit、diff、分支、恢复 | 科学有效性、大型数据存储 |
| Artifact Truth | 科学输出、hash、状态、lineage、验证 | 文本编辑体验 |
| SQLite | 查询索引、UI 投影、选择状态、映射 | 代替 Git 或 Artifact 文件本体 |
| Harness | 意图、规划、分类、执行和恢复 | 自己发明执行真相 |

## 6. 核心契约

### 6.1 `ArtifactInteractionManifest v1`

插件或结果生成器为可交互 Artifact 声明：

```ts
interface ArtifactInteractionManifestV1 {
  contractVersion: '1';
  artifactId: string;
  revisionId: string;
  semanticType:
    | 'differential-expression-table'
    | 'volcano-plot'
    | 'heatmap'
    | 'enrichment-table'
    | 'network'
    | 'generic-table'
    | 'generic-plot'
    | string;
  sourceNodeRef: {
    workflowPlanId: string;
    nodeId: string;
    toolJobId: string;
  };
  sourceScriptRef?: string;
  inputArtifactRefs: string[];
  entitySchema: ResultEntitySchemaV1[];
  editableProperties: EditablePropertyV1[];
  supportedInteractions: string[];
  derivationActions: DerivationActionV1[];
  validatorRefs: string[];
}
```

### 6.2 `SelectionContext v1`

```ts
interface SelectionContextV1 {
  contractVersion: '1';
  selectionId: string;
  projectId: string;
  conversationId: string;
  artifactId: string;
  revisionId: string;
  entityType: 'row' | 'column' | 'gene' | 'sample' | 'feature' | 'plot-mark' | 'region' | string;
  entityIds: string[];
  filterExpression?: StructuredFilterV1;
  sort?: Array<{ field: string; direction: 'asc' | 'desc' }>;
  viewport?: Record<string, unknown>;
  displayState?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

要求：

- 支持空选择、单选、多选和区域选择。
- 引用稳定实体 ID，不依赖当前显示行号。
- 对大型选择使用 query/filter + hash，不把百万 ID 塞进会话。
- 进入 Agent 上下文时提供紧凑摘要和可解析引用。

### 6.3 `ResultEditIntent v1`

```ts
type ResultEditClass =
  | 'view_only'
  | 'presentation_rerender'
  | 'data_transform'
  | 'scientific_recompute'
  | 'workflow_replan';

interface ResultEditIntentV1 {
  contractVersion: '1';
  intentId: string;
  userMessageId?: string;
  artifactRef: { artifactId: string; revisionId: string };
  selectionRef?: string;
  requestedOutcome: string;
  editClass: ResultEditClass;
  proposedParameterPatch: Record<string, unknown>;
  affectedNodeIds: string[];
  requiresJob: boolean;
  requiresScientificConfirmation: boolean;
  classificationReason: string;
}
```

### 6.4 `ScientificChangeSet v1`

```ts
type ChangeSetStatus =
  | 'draft'
  | 'running'
  | 'preview_ready'
  | 'validation_failed'
  | 'adopted'
  | 'reverted'
  | 'abandoned';

interface ScientificChangeSetV1 {
  contractVersion: '1';
  changeSetId: string;
  projectId: string;
  conversationId: string;
  intentRef: string;
  baseCommit: string;
  candidateCommit?: string;
  workingBranchRef: string;
  status: ChangeSetStatus;
  changedPaths: ChangedPathV1[];
  parentArtifactRefs: string[];
  candidateArtifactRefs: string[];
  jobRefs: string[];
  validationSummary?: ValidationSummaryV1;
  createdBy: 'user' | 'agent';
  createdAt: string;
  updatedAt: string;
  adoptedAt?: string;
  revertedAt?: string;
}
```

### 6.5 `ArtifactRevision v1`

```ts
interface ArtifactRevisionV1 {
  contractVersion: '1';
  revisionId: string;
  artifactFamilyId: string;
  artifactId: string;
  parentRevisionIds: string[];
  sourceCommit: string;
  sourceScriptRef?: string;
  inputArtifactRefs: Array<{ artifactId: string; hash: string }>;
  parametersRef: string;
  toolJobId?: string;
  outputPath: string;
  outputHash: string;
  validationStatus: 'valid' | 'degraded' | 'blocked' | 'unavailable';
  changeSetId: string;
  createdAt: string;
}
```

### 6.6 `WorkspaceCheckpoint v1`

Checkpoint 绑定：

- Git base/candidate commit。
- ChangeSet 状态。
- 当前 Artifact Revision。
- SelectionContext。
- 未采用预览。
- 相关 Job/Loop 引用。

恢复时必须从 Git、SQLite 和 Artifact Truth 三方核对，不以单一 UI 缓存为准。

## 7. Git-backed Revision 设计

### 7.1 无现有 Git 的项目

BioF3 创建托管 Git backend：

```text
.biof3/
├── git/
├── revision/
├── checkpoints/
└── objects/
```

要求：

- 使用真实 Git object/commit/tree/ref 语义。
- 不要求用户执行 `git init`。
- 不污染普通用户的文件浏览。
- 只追踪受管理路径，不使用全目录无差别 add。
- Git 不可用时不得静默降级为不可恢复编辑；应阻止正式采用并解释运行时问题。

### 7.2 已有 Git 的项目

必须先检测：

- 仓库根目录。
- 当前 branch/HEAD。
- dirty/untracked 状态。
- BioF3 将修改的明确路径。
- 是否存在 submodule、worktree 或锁。

安全规则：

- 永不自动 stage 用户无关改动。
- 禁止 `git add .` 和 `git add -A`。
- AI 修改使用专用 branch/worktree 或等价隔离区。
- 不自动 push、force push、rebase 或删除用户分支。
- 与用户现有未提交修改冲突时，ChangeSet 进入 blocked，不覆盖。
- 用户可以选择“仅使用 BioF3 托管历史”，避免接入现有仓库。

### 7.3 Git Runtime

产品不能假设目标机器已正确安装 Git：

1. macOS 第一阶段实现系统 Git readiness 检测。
2. 无可用 Git 时给出明确诊断，开发阶段可暂时阻断。
3. 正式产品阶段随应用提供受控 Git runtime。
4. Windows/macOS 使用经过验收的固定 Git 版本和统一命令适配层。
5. 所有命令由 Git Adapter 生成，UI 和 Harness 不直接拼 shell。

### 7.4 Commit 与 ChangeSet

- 一个已采用 ChangeSet 至少对应一个不可变 candidate commit。
- 自动保存草稿可以使用临时 ref，不污染正式历史。
- “采用”通过受控 ref 更新完成，不复制覆盖文件冒充提交。
- “撤销未采用修改”删除临时工作区/ref，但保留审计摘要。
- “恢复已采用版本”使用新 commit 表达恢复，不改写已发布历史。
- Commit message 包含稳定 ChangeSet ID、意图摘要和 Artifact 引用。

## 8. Artifact 存储与版本图

建议布局：

```text
analysis/
├── scripts/
│   └── volcano/
│       ├── plot_volcano.R
│       └── parameters.json
└── workflows/

results/
└── artifacts/
    └── volcano-plot/
        ├── revisions/
        │   ├── v1/
        │   │   ├── artifact-manifest.json
        │   │   └── volcano.svg
        │   └── v2/
        │       ├── artifact-manifest.json
        │       └── volcano.svg
        └── current.json
```

具体磁盘路径由现有 project-run-layout 扩展决定，不在 UI 中硬编码。

大型文件优化：

- 内容寻址与 SHA-256 去重。
- 可用时使用 hardlink/reflink/copy-on-write。
- 版本清理必须先做 reachability 分析。
- 原始输入、被正式结果引用的版本和 ReplayPackage 引用对象不得自动清理。

## 9. 编辑分类与执行策略

| 分类 | 示例 | 是否正式 Job | 是否新 Revision | 默认确认 |
|---|---|---:|---:|---|
| `view_only` | 临时排序、缩放、隐藏列 | 否 | 否，除非保存 | 否 |
| `presentation_rerender` | 配色、字体、标签、尺寸 | 是，轻量 renderer Job | 是 | trusted 可自动 |
| `data_transform` | 保存筛选表、改列、计算派生字段 | 是 | 是 | 依影响判断 |
| `scientific_recompute` | 阈值、模型公式、对照组 | 是 | 是 | 科学影响显著时确认 |
| `workflow_replan` | 换方法、增加分析节点 | 是，重跑受影响子图 | 是 | 需要关键设计决定时确认 |

Loop/Harness 必须根据 ArtifactInteractionManifest、参数影响分类和当前权限模式确定策略，不得仅由模型自由判断。

## 10. Plugin SDK 扩展

每个支持 Result Studio 的插件至少提供：

1. 结果语义类型。
2. 稳定实体 ID 和字段 schema。
3. 来源脚本或可物化脚本模板。
4. 输入 Artifact binding。
5. 可编辑参数及类型、范围、默认值。
6. 参数影响级别：
   - `view`
   - `presentation`
   - `data`
   - `scientific`
   - `workflow`
7. 支持的选择和派生动作。
8. 输出 Artifact 声明。
9. Validator。
10. fixture 与 golden revision。

插件不得：

- 原地修改 canonical builtin 脚本。
- 只返回图而不保留生成脚本。
- 让 UI 猜测列语义。
- 用自定义页面绕开 ChangeSet、Job 或 Artifact Revision。

第一批适配插件：

1. DESeq2 标准化结果表。
2. Volcano plot。
3. Heatmap。
4. GO/KEGG enrichment table/plot。

## 11. Harness 与 Agent 集成

### 11.1 上下文注入

Agent 每轮只接收有界摘要：

- 当前 Artifact/Revision。
- 科学语义。
- 当前选择摘要。
- 来源节点和输入引用。
- 当前脚本/参数入口。
- 最近 ChangeSet 状态。

完整表格、脚本和历史按需通过工具读取，不能全部塞入 prompt。

### 11.2 Agent 工具

新增能力必须是受控工具，不通过任意 shell 拼装第二套路径：

- `result_interaction_get`
- `result_selection_get`
- `result_edit_plan`
- `result_changeset_create`
- `result_changeset_status`
- `result_changeset_compare`
- `result_changeset_adopt`
- `result_changeset_revert`
- `artifact_revision_list`
- `artifact_revision_restore`

真实计算仍由工具内部桥接现有 `run_tool`。

### 11.3 目标驱动

Agent 编辑 Loop：

```text
理解意图
  → 定位来源
  → 分类影响
  → 创建隔离 ChangeSet
  → 修改脚本/参数
  → 运行受影响节点
  → 验证
  → 生成差异
  → 预览
  → 自动采用或等待关键决定
  → 持久化终态
```

不得用固定普通轮数提前停止。

## 12. UI 组件边界

建议拆分，避免继续膨胀 `project-workspace.tsx`：

```text
frontend/src/components/result-studio/
├── ResultStudio.tsx
├── ArtifactViewer.tsx
├── ArtifactNavigator.tsx
├── SelectionSummary.tsx
├── ResultEditComposer.tsx
├── ManualPropertyEditor.tsx
├── ChangeSetSummary.tsx
├── DiffViewer.tsx
├── VisualCompare.tsx
├── TableCompare.tsx
├── RevisionHistory.tsx
└── result-studio.types.ts
```

Viewer Adapter：

- `TableViewerAdapter`
- `PlotViewerAdapter`
- `ImageViewerAdapter`
- `HtmlViewerAdapter`
- `TextViewerAdapter`
- `BinarySummaryAdapter`

通用 Result Studio 负责框架与契约；插件只提供 manifest、schema 和专用 adapter 扩展，不复制整套页面。

## 13. 数据库与 API

需要版本化迁移，至少支持：

- `scientific_change_sets`
- `artifact_revisions`
- `result_selection_contexts`
- `workspace_revision_checkpoints`
- `git_repository_bindings`

所有表包含：

- project/user scope。
- contract version。
- created/updated/terminal timestamps。
- status 和 reason code。
- 外键或稳定引用。

API 必须按 project/user 权限校验，不允许通过 revisionId 越权读取其他项目结果。

## 14. 分阶段开发计划

### G0-RS-WT0：开发环境隔离（`deferred`）

2026-07-24 决策：**不使用 Git Worktree**。Result Studio 在主工作区以单线串行方式开发，分支为 `codex/g0-result-studio`。

原设计（LF 留在 `main`、RS 使用 Codex 永久 Worktree）的目的是隔离与 LF 并行的开发线。该前提在 LF12 收口后已不存在，因此启动门不成立并标记 `deferred`。

判据：

- 隔离对象已消失：LF0～LF12 全部关闭，G0 转为常驻 `maintained` 门禁，不存在与 RS 并行的 LF 开发线。
- 无并行所有者：`git worktree list` 仅主工作区；当前只有一个活跃开发线程。
- 成本可量化：每个 Worktree 需独立 `node_modules`（527M + frontend 209M）与独立 electron-rebuild（`better-sqlite3` × `electron 30.5.1` ABI）；项目已有一次 native 架构错配事故记录，复制环境会放大该类问题。
- 参照实例已存在：`/Applications/BioF3.app`（rc.7）与 `dist/mac-arm64/BioF3.app` 已提供 `userData` 独立的稳定对照，无需第二份 checkout。
- 非技术前置：`G0-RS1` 的 Git Adapter 面向**用户项目目录**，其 非Git / clean / dirty 矩阵由临时 fixture 仓库覆盖，与 BioF3 仓库自身的 Worktree 无关。WT0 不是 RS1～RS9 的技术前置。

替代做法：

- 单分支 `codex/g0-result-studio`，小步提交并频繁与 `main` 集成，避免长期分叉后一次性重资格。
- 需要与旧行为对照时使用已安装 rc.7，不新建开发实例。
- `G0-RS8` 的破坏性耐久测试通过环境变量把 Electron `userData`、SQLite、results/uploads/tmp/logs 指向临时目录；只隔离运行时，不复制源码树。

重开条件（任一成立即重新评估，并按 [`worktree-governance.md`](./worktree-governance.md) §3～§8 执行）：

1. 出现第二个真实并行开发者或 Agent，且核心文件所有权可清晰划分。
2. RS 需要让 `main` 持续不稳定超过一周，同时必须保留可发布的热修线。
3. `G0-RS8` 需要一个允许被故意破坏、且不影响主开发环境的完整实例。

保留策略：`worktree-governance.md` 继续是 `git-worktree-lifecycle` 的 canonical 规范并保持 `active policy`，仅正式 rollout 记为 deferred。重开时不得临时另立一套简化流程。

### G0-RS0：现状审计与 ADR（`completed` 2026-07-24）

目标：固定边界，避免在当前 G0 未提交工作上直接扩张。

产出记录：[`g0-rs0-result-studio-audit.md`](./g0-rs0-result-studio-audit.md)（`G0-RS0`，`result-studio-architecture` canonical）。

交付：

- ✅ 当前 ResultView、Artifact Truth、project-run-layout、ReplayPackage、Plugin SDK、Git 可用性审计。
- ✅ ADR：Git-backed + Artifact Store 双层版本架构（ADR-1～ADR-6）。
- ✅ 现有 Git 项目/非 Git 项目/dirty workspace 风险矩阵。
- ✅ UI 原型流程图（文本流程，未做高保真先行）。

验收：

- ✅ 复用/新增边界已裁决：复用 `tool_jobs` 执行真相与 `reconcileArtifactTruth`；新增 5 张 RS 表走 `src/migrations/001+`。
- ✅ 明确不建立第二套 executor/artifact truth；正式重算仍唯一走 `run_tool → tool_job → artifact truth`。
- ✅ 与 G0 的关系已裁决：G0 为常驻 `maintained` 门禁，每次 RS 提交保持 `g0:qualification` 通过；RS9 晋升前必须处理 `excludedClaims` 的 `result-studio-editing` 并重资格。

审计发现的三项契约缺陷已登记，必须在对应阶段修正，不得沿用计划原文：`validationStatus` 词表冲突（RS2）、`sourceScriptRef` 语义不足（RS5）、`ActiveArtifact` 仍是文件级（RS3）。

### G0-RS1：Git Adapter 与 Repository Binding

目标：建立真实 Git 基础能力。

交付：

- Git readiness/版本/路径检测。
- 托管 Git repository binding。
- 现有 Git repository 安全绑定。
- 精确路径 status/diff/commit/ref/worktree Adapter。
- dirty/untracked/conflict/lock/submodule 检测。
- 脱敏诊断。

验收：

- 不使用 `git add .`/`git add -A`。
- 不触碰无关用户 WIP。
- 非 Git 项目可创建真实 commit 并恢复。
- 已有 dirty Git 项目只修改显式目标。
- Git 不可用时诚实阻断。

### G0-RS2：Revision Contract 与持久化

目标：实现 ChangeSet、ArtifactRevision、Checkpoint。

交付：

- JSON Schema/JS validator/TypeScript 类型。
- SQLite migration 与 CRUD。
- Git commit ↔ ChangeSet ↔ ArtifactRevision 映射。
- crash-safe 状态机。
- content hash 和 reachability。

验收：

- draft→preview_ready→adopted 完整轨。
- validation_failed、reverted、abandoned 终态。
- 进程中断后可恢复。
- 重复 adopt/revert 幂等。

### G0-RS3：Artifact Interaction 与 Selection Context

目标：让用户选择成为 Agent 可理解的结构化上下文。

交付：

- ArtifactInteractionManifest v1。
- SelectionContext v1。
- 表格行列/过滤/排序选择。
- 图形 point/region 选择接口。
- selection 持久化和有界摘要。
- activeArtifact 从文件级升级到 revision/semantic/selection-aware。

验收：

- 稳定实体 ID，不依赖行号。
- 10 万行表格仍可用 query/hash 表达选择。
- 切换会话和重启后选择可恢复。
- Agent 能准确回答“这些基因”对应的真实 ID。

### G0-RS4：AI Edit Intent 与受影响范围

目标：可靠区分查看、重绘、转换、重算和重规划。

交付：

- ResultEditIntent v1。
- 确定性参数影响规则。
- 来源节点和脚本定位。
- affected subgraph 计算。
- 科学确认门规则。
- Agent edit tools。

验收：

- 改颜色只重跑绘图节点。
- 改显著性阈值按插件声明重跑必要节点。
- 改 design formula 进入科学确认/重算。
- 不能定位脚本或输入时不猜测执行。

### G0-RS5：隔离编辑与独立脚本

目标：AI/手动编辑都不污染正式结果。

交付：

- 临时 branch/worktree 或等价 Git 隔离区。
- Artifact 输入只读挂载/引用。
- canonical plugin script 派生为项目级独立脚本。
- 参数 Patch 和脚本 materialization。
- 正式轻量 renderer Job。
- 修改进度事件。

验收：

- 原脚本、源数据和 v1 Artifact hash 不变。
- v2 有独立脚本、参数、commit、Job、Artifact 和 validator。
- 中止或失败不会留下部分采用状态。
- AI 与手动编辑生成相同类型 ChangeSet。

### G0-RS6：Codex-like Diff、比较、采用与撤销

目标：形成核心产品体验。

交付：

- 紧凑 ChangeSet 摘要。
- 文本 Git diff。
- JSON 字段 diff。
- 表格语义 diff。
- 图像/SVG 前后对比。
- adopt/revert/restore/history。
- 普通与高级 Git 信息分层。

验收：

- 用户不理解 Git 也能完成修改、比较、采用、撤销。
- 一次操作可恢复全部关联脚本、参数和 Artifact。
- 820px、明暗主题和大量修改文件场景可用。
- 详细信息不会淹没主预览。

### G0-RS7：Plugin SDK 首批适配

目标：以真实科学结果证明通用协议。

交付：

- DESeq2 table。
- volcano plot。
- heatmap。
- GO/KEGG enrichment。
- plugin contract lint。
- golden revision fixtures。

验收：

- 四类插件不建立独立版本系统。
- 每个正式图/表都有独立脚本。
- 输入输出可无缝绑定。
- 插件版本升级后历史 Revision 仍可读取或明确迁移。

### G0-RS8：耐久恢复、性能与存储治理

目标：长时间使用仍稳定丝滑。

交付：

- ChangeSet/preview 恢复。
- Git 与 SQLite 漂移检测、自愈或阻断。
- 内容去重和存储占用摘要。
- 安全 GC/归档。
- 大表虚拟化和渐进式 diff。
- 后台预览 Job 与资源预算。

验收：

- 编辑中退出应用后可恢复。
- 关机模拟后无半采用 Revision。
- 大文件不进入普通 Git。
- 版本历史增长不会明显拖慢打开结果页。
- 清理不会删除仍被历史/正式结果引用的对象。

### G0-RS9：真实产品验收与基线晋升

目标：将 Result Studio 晋升为 G0 长期基线。

真实任务：

1. Bulk RNA-seq DEG 表筛选 27 个基因并继续 GO/KEGG。
2. 火山图 AI 调整标签/颜色/尺寸并导出 SVG。
3. 热图手动调整配色后让 AI 继续优化注释。
4. 修改科学阈值触发受影响子图重算。
5. 从旧版本创建替代方案并比较。

环境矩阵：

- 非 Git 项目 + BioF3 托管 Git。
- 已有 clean Git 项目。
- 已有 dirty Git 项目。
- 应用重启和任务中断。
- 明暗主题、820px 和常规宽屏。
- 至少两个真实 Provider。

必须形成脱敏证据：

- commits/refs。
- ChangeSet/ArtifactRevision。
- Job/Artifact truth。
- 脚本与参数。
- diff/compare 截图。
- adopt/revert/restart 轨迹。
- 性能和存储数据。

## 15. 质量门禁

建议新增：

```text
npm run g0:result-studio
npm run g0:result-studio:git
npm run g0:result-studio:revision
npm run g0:result-studio:interaction
npm run g0:result-studio:plugin
npm run g0:result-studio:acceptance
```

根 `npm run check` 在契约稳定后接入离线门禁；真实 Provider、真实 Renderer 和视觉矩阵保持独立生产验收，不能由单测冒充。

## 16. 性能与“丝滑”验收

具体阈值在 RS0 基于真实机器测量后冻结，至少覆盖：

- 打开普通结果时不因加载完整历史而阻塞首屏。
- 选择、筛选、排序先本地响应，再异步持久化。
- Diff 按需加载，大文件渐进渲染。
- AI 修改期间持续显示阶段状态和可取消入口。
- 新结果 ready 后自动切换预览，不要求手动刷新。
- adopt/revert 期间 UI 有原子状态，不出现两个“当前版本”。
- Git 操作和 Artifact hash 在后台执行，不长时间冻结 renderer。

## 17. 安全与隐私

- Diff、commit message 和诊断不得泄露 API Key、环境变量或项目外路径。
- Git remote 操作默认禁用；本工作包不自动 push。
- 外部 Git hooks 默认不在 BioF3 托管仓库执行。
- 现有仓库 hooks、filters、attributes 的行为必须审计后受控调用。
- 脚本执行继续受 Harness 权限、项目作用域和副作用策略约束。
- 源数据不可变规则覆盖 AI、手动 UI、Git restore 和 shell 绕过路径。

## 18. 迁移与兼容

历史 Artifact 没有 InteractionManifest 或 Git commit 时：

1. 保持可查看和下载。
2. 标记 `legacy_read_only` 或 `interaction_partial`。
3. 能从 DeliveryManifest/ReplayPackage 推导来源时生成迁移草稿。
4. 迁移必须生成新 Revision，不能伪造旧提交时间或完整历史。
5. 无法可靠定位脚本/输入时，只允许“基于现有 Artifact 创建新派生分析”，不得宣称编辑了原流程。

## 19. 风险与应对

| 风险 | 应对 |
|---|---|
| 自研版本系统逐渐偏离 Git | Git 作为真实文本版本内核，内部只做映射和产品 UI |
| Git 无法管理大型科学文件 | Artifact Store + hash pointer + 内容去重 |
| 已有用户 Git WIP 被污染 | 显式路径、隔离 worktree、冲突即阻断 |
| 插件没有独立脚本 | Plugin SDK 门禁，未适配插件只读 |
| AI 错判展示修改为科学修改 | 参数影响元数据 + 确定性分类 + Validator |
| 版本过多占满磁盘 | reachability、去重、保留策略、用户可见占用 |
| UI 变成复杂 IDE | 渐进披露，普通用户只见结果/比较/采用/撤销 |
| 预览成功掩盖计算失败 | UI 永远投影 Artifact Truth |
| Git/SQLite/磁盘三方漂移 | checkpoint hash、启动核对、明确恢复状态 |

## 20. 完成定义

只有同时满足以下条件，`G0-RS` 才能从 `planned` 晋升为 `qualified`：

- [ ] 使用真实 Git，不是模拟 commit/diff。
- [ ] 非 Git 与已有 Git 项目均有安全路径。
- [ ] 用户无须理解 Git 即可完成完整版本操作。
- [ ] AI 和手动编辑进入同一 ChangeSet/Revision 流程。
- [ ] 每个正式图表和表格有独立可执行脚本。
- [ ] 原始脚本、源数据和历史 Artifact 不被覆盖。
- [ ] 展示重绘与科学重算被可靠区分。
- [ ] 新结果有 Job、Artifact Truth、Validator 和 lineage。
- [ ] 表格、图形选择可结构化进入 Agent 上下文。
- [ ] Diff、视觉比较、采用、撤销和恢复均通过真实 UI 验收。
- [ ] 应用重启、任务中断和脏 Git 工作区通过恢复矩阵。
- [ ] 大型科研数据未被错误提交普通 Git。
- [ ] 至少一个完整 Bulk RNA-seq 任务从原始结果完成多轮编辑与二次分析。
- [ ] 根检查、专项门禁、真实 Provider 和视觉证据全部闭环。
- [ ] `G0-RS8` 的运行时隔离（临时 Electron `userData`、SQLite、results/tmp/logs）通过破坏性耐久测试；不以 Worktree 作为完成条件。

## 21. 推荐启动顺序

LF12 已形成 qualified checkpoint（`38d3de2`），前置解除。`G0-RS-WT0` 已 `deferred`，不再是启动步骤。

执行顺序（单线串行，一次只推进一个阶段）：

```text
G0-RS0 只读审计与 ADR
  → G0-RS1 Git Adapter
  → G0-RS2 Revision Contract
  → G0-RS3 Selection Context
  → G0-RS4 Intent / affected subgraph
  → G0-RS5 隔离编辑
  → G0-RS6 Codex-like UI
  → G0-RS7 插件适配
  → G0-RS8 耐久与性能
  → G0-RS9 真实生产验收
```

串行纪律：

- 同一时间只有一个 RS 阶段处于进行中；当前阶段的交付、门禁和证据收口后才启动下一个。
- 不因为"顺手"提前实现后续阶段的契约或 UI；发现必要的顺序调整时先改本计划，再执行。
- 每个阶段的进展回写本文件，不按日期新建进度文档。

本计划是 G0 qualified 后的首个重要产品升级，不得以 UI 先行掩盖版本、执行和 Artifact 契约问题。
