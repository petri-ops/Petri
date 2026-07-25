# G0 Result Studio — 意图驱动、可编辑、Git-backed 的科研结果工作台计划

最后更新：2026-07-25

状态：`in_progress`（RS0 ✅ / RS1 ✅ / RS2 ✅ / RS3 ✅ / RS4 ✅ / RS5 ✅ / RS6 ✅ 已收口；当前下一阶段为 `G0-RS7`，单线串行）

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

### G0-RS1：Git Adapter 与 Repository Binding（`completed`）

目标：建立真实 Git 基础能力。

实现：

- `core/shared-backend/git-adapter.js` — 唯一 Git 命令边界（`GIT_ADAPTER_VERSION = 1`）。
- `core/shared-backend/git-repository-binding.js` — 项目到版本后端的绑定（`REPOSITORY_BINDING_VERSION = 1`）。
- 门禁：`npm run g0:result-studio:git`（= `node --test test/git-adapter.test.mjs`），已接入根 `npm run check`。

交付：

- ✅ Git readiness/版本/路径检测：`detectGitRuntime()`，最低版本 `2.20.0`（低于该版本不保证 `--porcelain=v1 -z` 与 worktree 子命令行为一致）。
- ✅ 托管 Git repository binding：`mode='managed'`，git 元数据落 `<workspace>/.biof3/git`，工作区仍是项目目录，用户浏览项目时看不到 `.git`。
- ✅ 现有 Git repository 安全绑定：`mode='existing'`，只操作 `MANAGED_RELATIVE_PATHS`（当前为 `analysis/scripts`、`analysis/workflows`）；项目为仓库子目录时自动加相对前缀。
- ✅ 精确路径 status/diff/commit/ref/branch/ls-files Adapter；`commit()` 使用 `--only` + 显式 pathspec。
- ✅ dirty/untracked/conflict/lock/mid-operation/submodule/linked-worktree 检测；5 类 `blocked_*` 状态。
- ✅ 脱敏诊断：`redactGitDiagnostic()` 替换 gitdir/workspace/home/tmp 绝对路径，屏蔽疑似凭据，截断到 2000 字符。

验收（`test/git-adapter.test.mjs`，24/24 pass，全部使用临时目录中的真实 git 仓库，不访问网络、不读用户数据）：

- ✅ 不使用 `git add .`/`git add -A`：`FORBIDDEN_PATHSPECS` 在 `assertSafePathspecs()` 层拒绝 `.`、`./`、`..`、`*`、`:`、`:/`、`-A`、`--all`、`-u`、`--update`、`-a`；另拒绝选项注入（`-` 前缀）、pathspec magic（`:` 前缀）、`..` 逃逸、NUL、工作区外绝对路径与工作区根本身。所有写操作必须携带显式 pathspec。
- ✅ 不触碰无关用户 WIP：`analysis/` 外的用户改动不被 stage、不被提交、不被改写；`detectDirtyConflict()` 的返回值只暴露受管理范围内的冲突路径，用户其他 WIP 仅以计数出现。
- ✅ 非 Git 项目可创建真实 commit 并恢复：托管仓库产生真实 commit hash，`showFile({ ref })` 能取回历史版本内容；用户目录不出现 `.git`。
- ✅ 已有 dirty Git 项目只修改显式目标：受管理路径有未提交改动 → `blocked_dirty_conflict`，不覆盖不 stash；WIP 在受管理路径外 → `ready` 并只提交自己的路径。
- ✅ Git 不可用时诚实阻断：`blocked_git_unavailable`，不降级为不可恢复编辑。

补充边界：

- 参数以数组传入 `execFileSync`，不经 shell，因此不存在命令注入面。
- 托管仓库通过 `core.hooksPath` 指向不存在目录 + `--no-verify` 双重禁用 hooks。
- 未实现 `push`/`force push`/`rebase`/删除分支，Adapter 层不存在这些方法。
- `existing` 模式遇 linked worktree、submodule 或 `.git` 为文件时一律阻断，不猜测用户意图、不删 `index.lock`。

实现期修正的真实缺陷：`--untracked-files=normal` 会把完全未跟踪的目录折叠成单条（新建的 `analysis/scripts/x.R` 只报告 `analysis/`），导致受管理路径下的用户新建文件在冲突检测中漏判、RS 随后可能覆盖它。已改为 `untracked='all'` 并加双向前缀匹配 `pathsOverlap()`。该缺陷由验收测试捕获，不是推测。

### G0-RS2：Revision Contract 与持久化 ✅ 已完成（2026-07-25）

目标：实现 ChangeSet、ArtifactRevision、Checkpoint。

实现文件：

- `core/shared-backend/result-studio-schema.js` — canonical DDL（5 张新表 + 索引）、`ensureResultStudioSchema()`、`inspectResultStudioSchema()`、`buildMigrationSql()`。
- `src/migrations/001_result_studio.sql` — 由 `buildMigrationSql()` 生成，逐字节一致由测试强制。
- `core/shared-backend/result-studio-contracts.js` — 4 个契约的 validator + 状态机 + checkpoint hash。
- `core/shared-backend/result-studio-repository.js` — CRUD、状态迁移、幂等 adopt/revert、中断扫描、可达性分析。

交付：

- ✅ JS validator：`validateScientificChangeSet` / `validateArtifactRevision` / `validateSelectionContext` / `validateWorkspaceCheckpoint`，统一返回 `{ ok, errors, <entity> }`，错误带稳定 `code`。TypeScript 类型留待 RS3 前端接入时生成，后端契约以本层为准。
- ✅ SQLite migration 与 CRUD：5 张新表 `git_repository_bindings`、`scientific_change_sets`、`artifact_revisions`、`result_selection_contexts`、`workspace_revision_checkpoints`；不修改任何现有表。
- ✅ Git commit ↔ ChangeSet ↔ ArtifactRevision 映射：ChangeSet 持有 `base_commit`/`candidate_commit`/`working_branch_ref`，Revision 持有 `source_commit` 与 `change_set_id`。
- ✅ crash-safe 状态机：迁移表显式声明，条件更新 `WHERE status = ?` 防并发覆盖，adopt/revert 全程单事务。
- ✅ content hash 与 reachability：`checkpoint_hash` 检测外部改写；`analyzeRevisionReachability()` 只产出 `gcCandidates`，不删除任何东西。

按 RS0 登记的契约缺陷修正：

- ✅ `validationStatus` 词表冲突已拆分：`validation_status`（`valid|degraded|blocked`，必须来自 `reconcileArtifactTruth()`）与 `reproducibility_status`（`unavailable|available|verified`，必须来自 delivery-manifest 的 artifact 级判定）。未新造第三套词汇。
- ✅ 增加 `valid_revision_requires_job`：`validationStatus='valid'` 的 Revision 必须携带 `toolJobId`，把「正式结果必须来自真实 Job」写成契约而非约定。

验收（`test/result-studio-contracts.test.mjs` 26/26、`test/result-studio-repository.test.mjs` 19/19、`test/result-studio-migration.test.mjs` 9/9，合计 54/54 pass；仓库测试使用临时目录中的真实 better-sqlite3 数据库）：

- ✅ draft→running→preview_ready→adopted 完整轨；采用后 `is_current` 原子切换。
- ✅ `validation_failed`、`reverted`、`abandoned` 终态；`validation_failed` 不能直接被采用。
- ✅ 进程中断后可恢复：真实关闭并重开数据库后状态、Revision、checkpoint 全部保留；`findInterruptedChangeSets()` 把 `running` 分类为 `recovery_required_after_restart`、`preview_ready` 为 `awaiting_user_decision`，只报告不自动改写。
- ✅ 重复 adopt/revert 幂等：返回 `idempotent: true`，不重复切换 current 指针。
- ✅ 一个 family 永不出现两个 current：由 partial unique index `WHERE is_current = 1` 在 DB 层保证，绕过仓库直接写库也会失败。
- ✅ migration runner 首次使用验证（RS0 要求）：空库首装、已有库升级不动现存表、坏 SQL 事务回滚且不记版本、重复执行幂等、缺目录时的静默 no-op 行为、`BIOF3_BETTER_SQLITE3_ROOT` 下的 ABI 路径。
- ✅ migration 文件与 schema 模块逐字节一致，且不含 `BEGIN/COMMIT`（runner 已包事务，自带会导致嵌套失败）、`PRAGMA`、`AUTOINCREMENT`、`INSERT OR REPLACE`、`DROP/ALTER TABLE`。

实现期修正的真实缺陷（均由验收测试捕获）：

1. **状态机守卫全线失效**：`canTransitionChangeSet()` 返回 `{ allowed, idempotent, reason }` 对象，而 `transitionChangeSet`/`adoptChangeSet`/`revertChangeSet` 三处都写成 `!canTransitionChangeSet(...)`。对象取反恒为 `false`，守卫从未生效，任意非法迁移（含 `draft → adopted` 跳过预览）都会被放行。已全部改为读 `.allowed`。
2. **`adopted` 被误列为完全终态**：迁移表允许 `adopted → reverted`（撤销已采用是真实用户动作），与 `TERMINAL` 语义自相矛盾。已拆分为 `CHANGE_SET_CLOSED_STATUSES`（`reverted`/`abandoned`，无任何向外迁移）与 `CHANGE_SET_SETTLED_STATUSES`（含 `adopted`，不再进行中但可撤销）。
3. **可达性规则会永久泄漏磁盘**：原 `original_revision` 规则无条件保护每个 family 的 ordinal 1，导致「用户新建 artifact family 后放弃」的 Revision 永不可回收。已改为只保护「仍有 current 或 adopted Revision」的活跃 family 的原始版本。
4. RS0 审计中「`src/migrations/` 只有 `.gitkeep`」不准确：该目录当时**根本不存在**，`runMigrations` 走 `readdirSync` 的 catch 分支静默返回。已在审计文件更正，并由 migration 测试固化该行为。

范围外（留给后续阶段）：

- 前端 TypeScript 类型与 `ActiveArtifact` 升级 → RS3。
- `sourceScriptRef` 的图表级语义（当前只存 `relativePath`/`sha256`/`entryPoint` 三元组）→ RS5。
- 真实 Git 提交与 ChangeSet 的联动写入（本层只持久化映射字段，不调用 Adapter）→ RS5。

### G0-RS2 原始验收清单（保留对照）

- draft→preview_ready→adopted 完整轨。
- validation_failed、reverted、abandoned 终态。
- 进程中断后可恢复。
- 重复 adopt/revert 幂等。

### G0-RS3：Artifact Interaction 与 Selection Context ✅ 已完成（2026-07-25）

目标：让用户选择成为 Agent 可理解的结构化上下文。

交付：

- ✅ ArtifactInteractionManifest v1：`core/shared-backend/artifact-interaction.js`。`buildTableInteractionManifest()` / `buildPlotInteractionManifest()` 产出 `idField` / `idStrategy` / `entityType` / `selectionDurable` / `capabilities`。
- ✅ 稳定 ID 判定：`resolveEntityIdField()` 三级策略 `declared_column`（调用方声明）→ `inferred_column`（29 个生物学候选列名 + **实测唯一性**验证）→ `positional`（回退且必附诊断）。声明列不唯一时拒绝声明、不产出错误实体映射。
- ✅ SelectionContext v1：沿用 RS2 的 `validateSelectionContext()` 与 `result_selection_contexts` 表，不新建第二套选择契约。
- ✅ 表格行列/过滤/排序选择 + 图形 point/region 选择：前端 `frontend/src/lib/artifact-selection.ts`，`buildRowSelection` / `buildColumnSelection` / `buildQuerySelection` / `buildPointSelection` / `buildRegionSelection`。
- ✅ selection 持久化与有界摘要：`POST/GET/DELETE /api/result-studio/selection`，`describeSelectionForAgent()` 与 `summarizeSelectionForAgent()` 恒定有界（≤12 个样本 ID），永不外泄完整 ID 列表。
- ✅ HTTP 边界：`core/r-server/routes/result-studio.js` 6 个端点，已注册进 `routes/index.js`。
- ✅ `activeArtifact` 从文件级升级到 revision/semantic/selection-aware（UI-102）：新增 `revisionId` / `artifactFamilyId` / `semanticKind` / `entityType` / `idField` / `selectionDurable` / `interactionCapabilities` / `selection`，并把身份比较从 `jobId+name` 扩展到覆盖 revision 与 selection。

验收（`test/artifact-interaction.test.mjs` 26/26 + `frontend/src/lib/artifact-selection.test.ts` 20/20）：

- ✅ 稳定实体 ID，不依赖行号：`idStrategy` 为 `positional` 时 `selectionDurable` 强制为 false，且 `describeSelectionForAgent()` 附 `caveat` 明示"重算后可能不指向同一实体"；契约校验拒绝 `positional` + `selectionDurable=true` 的自相矛盾组合。
- ✅ 10 万行表格仍可用 query/hash 表达选择：实测 10 万行仅抽样 39 行即判定 `inferred_column`/`gene_id`/durable；超过 2000 个实体的选择以 `filterExpression` + `filterHash` 为权威表达，`entityIds` 仅作抽样证据，`matchedCount` 如实反映真实规模。
- ✅ 切换会话和重启后选择可恢复：选择落 RS2 的 `result_selection_contexts`，`toPersistPayload()` / `fromPersistedSelection()` 往返保持 `entityIdsHash` 与计数。
- ✅ Agent 能准确回答"这些基因"对应的真实 ID：摘要携带 `entityType`、真实 `sampleEntityIds`、总数与 `truncated` 标记；不可持久时显式给出 caveat，不把行号伪装成基因身份。

补充边界：

- 交互清单必须由**后端基于完整文件**产出。浏览器侧只解析前 40 行预览（`buildPreviewTable`），那个样本没有资格判定"哪一列是稳定实体 ID"；前端只消费清单，不自建第二套判定。
- artifact 路径一律经 `resolveProjectRunLayout` + 包含性检查派生，不接受调用方传入任意路径；读取体积设上限。
- revision 维度（`revisionId` / `artifactFamilyId`）在 RS3 只打通类型与身份比较，实际填充待 RS5/RS6 接入 `artifact_revisions`，不伪造数据。

实现期修正的真实缺陷（3 项，全部为集成层，均由实跑捕获）：

1. 路由用了**不存在**的 `requireAuth` 中间件。桌面版是 loopback-only 单用户（`core/r-server/auth.js` 的 `localIdentityMiddleware` 全局注入 `req.user`），故意不提供 `requireAuth`；原写法会让整个模块永远走 skip 分支静默不注册，RS3 持久化沦为死代码。已改为 harness 既有模式：裸注册 + 每端点内联 `canAccessProject`。
2. `require('../db')` 返回模块对象而非 better-sqlite3 实例，`db.prepare(...)` 运行时必抛；且仓库在注册期 eager 创建，抛错会被 `routes/index.js` 的 try/catch 吞掉。已改为 `require('../db').db` 真实句柄 + 惰性构造。
3. 我的验证脚本三次用错入参名（`totalRowCount` 应为 `rowCount`、`filterExpression` 应为 `filter`、`rows` 需为列名键对象数组），一度把正确实现误判为 `positional` 回退。模块本身无误，记录于此以免后续复现同类误判。

### G0-RS4：AI Edit Intent 与受影响范围 ✅ 已完成（2026-07-25）

目标：可靠区分查看、重绘、转换、重算和重规划。

实现：

- `core/shared-backend/result-edit-intent.js`：`ResultEditIntent v1` validator、确定性参数影响分类、来源定位、DAG 校验与 affected subgraph 计算、科学确认门及只读规划器。
- `core/r-server/agent-tools/result-edit-tools.js`：新增只读/R0 的 `result_edit_plan`。只从已加载插件 manifest 的可选 `resultStudio.parameterImpacts` 读取受信声明，Agent 参数不能自行伪造轻量影响规则。
- `core/r-server/plugin-loader.js`：仅透传可选 Result Studio 描述符；未给现有插件批量补声明。描述符缺失或参数未知时一律保守升级为 `scientific_recompute + requiresScientificConfirmation`。
- `package.json`：新增 `g0:result-studio:syntax` / `g0:result-studio:intent` 并纳入聚合 `g0:result-studio` 与根 `check`。

不变量与边界：

- 精确来源必须同时满足同项目 `tool_job`、`completed`、非阻断 valid Artifact Truth、Artifact **id** 唯一命中、与 Job/Artifact 对齐的 execution provenance、带 hash 的脚本快照和输入；有上游依赖的来源节点还必须有显式 `sourceArtifactRef`，文件名永不作为 Artifact 身份或 lineage 推断依据。
- `design` / formula / contrast 族字段无条件进入科学确认与重算；method/tool/plugin/workflow 族字段升级为 `workflow_replan`，插件的较弱声明不能覆盖这些保护字段。
- `view_only` 不产生受影响节点；`presentation_rerender` 只包含来源节点；转换/重算/重规划包含来源节点及所有确定性下游。DAG 缭乱、循环、缺边、来源节点歧义均 fail-closed。
- RS4 只规划：返回值固定声明 `performed=false / toolJobCreated=false / changeSetCreated=false`。未创建 ChangeSet、未 materialize 脚本、未执行重跑，RS5 边界未提前实现。

验收（`test/result-edit-intent.test.mjs` + `test/result-edit-agent-tool.test.mjs` + registry 回归）：

- ✅ 受信 manifest 明确声明的 palette 修改仅重绘来源绘图节点。
- ✅ 显式科学阈值重算来源及下游节点；design formula 强制科学确认；method 变化升级工作流重规划。
- ✅ 未知参数即使名称是 `color` 也不会猜成展示修改，保守进入科学重算。
- ✅ 缺脚本、输入、Artifact、Revision 或 DAG 时结构化阻断；文件名不能冒充 Artifact id。
- ✅ 跨项目来源在加载插件描述符前拒绝；Agent 工具只读且不创建新 Job。
- ✅ `npm run g0:result-studio` 聚合门由 104 项提升为 126 项，全部通过。

### G0-RS5：隔离编辑与独立脚本

状态：`completed`（2026-07-25）。

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

实现与边界：

- 不启用 Git Worktree。`GitAdapter.commitVirtualFiles()` 使用临时 `GIT_INDEX_FILE` 和 Git plumbing 构造 candidate commit，并以 `update-ref <new> <expected-old>` 做 CAS；不 checkout、不改工作树、不携带用户 WIP，现有仓库子目录保留 `gitPathPrefix`。
- `.biof3/revision/<changeSetId>/` 是私有执行 staging；脚本、参数和 materialization manifest 通过临时目录原子发布。正式可追溯脚本同时写入 candidate commit 的 `analysis/scripts/<artifactFamily>/<revision>/`，源脚本、源数据、旧 Artifact 与旧 Revision 保持不可变。
- 首次打开一个真实 `completed + Artifact Truth valid` 的交互式 Artifact 时，若尚无 Revision，基于 Job/Artifact/输出 hash 建立确定性的 baseline ChangeSet、独立脚本和 current v1。每个普通 root Job/Artifact 建立独立 family，无法证明同源时不擅自合并；RS5 candidate Job 已绑定 Revision 时直接复用，不自动覆盖 current。
- `result_changeset_create` 复用 RS4 的完整 `ResultEditIntent`，科学变化必须通过确认门；执行仍唯一进入现有 MCP 插件执行器，产生真实 `tool_job → artifact truth → provenance`，再登记 v2 Revision。候选只到 `preview_ready`，固定返回 `adopted:false`；RS6 才能采用或撤销。
- materialized override 只接受真实位于该 ChangeSet 私有目录、语言扩展匹配且 SHA-256 精确匹配的脚本；任意工作区路径、symlink escape、hash 漂移均拒绝。
- 失败进入 `validation_failed`，取消进入 `abandoned`，并发 ref 漂移稳定报 `git_ref_conflict`；均不得切换 current。中断的 running ChangeSet 可从 SQLite、candidate ref 与 materialization manifest 恢复检查，但永远不会因恢复扫描而自动采用。
- `sourceScriptRef` 已升级为 artifact/renderer 级引用，包含 path/hash/entryPoint/artifactId/rendererId/language/origin；`project_materialized` 缺任一关键身份即校验失败。
- 修改进度以 `result_edit_progress` SSE 发出 change_set/materialize/commit/job/revision/preview/failed/cancelled 阶段；前端 run store 有界去重并投影为紧凑状态。当前只完成进度消费，不提前实现 RS6 ChangeSet 卡片和比较 UI。

验收证据：

- `npm run g0:result-studio`：syntax、Git Adapter、Revision/Repository、migration、interaction、Intent/Agent registry 与 ChangeSet service 全绿。
- `test/result-changeset-service.test.mjs` 覆盖真实 baseline、私有 materialization、成功候选、AI/手动同契约、existing Git 子目录、失败/取消、跨项目、科学确认、crash recovery 与 override 路径/hash 边界。
- 前端 `artifact-selection + copilotClient + conversationRunStore` 40/40，`npm run build:check --prefix frontend` 通过。UI-102/UI-103 因尚未完成真实 renderer 视觉验收继续保持 `in_progress`，不写 `verified`。

### G0-RS6：Codex-like Diff、比较、采用与撤销

目标：形成核心产品体验。

状态：`completed`（2026-07-25）。

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

实现与边界：

- `result-compare-service.js` 在同一 ChangeSet/ArtifactRevision 真相上提供有界文本 Git diff、JSON 字段 diff、CSV/TSV 语义 diff、图像/SVG Revision 对照和 history；200k 字符、500 JSON 字段、4 MiB 表格前缀与 20 行样本上限均显式返回截断状态。
- adopt 仅接受 `preview_ready`、candidate ref/commit 一致、父 Revision 仍为 current、脚本哈希与真实 completed Job/Artifact Truth 均有效的候选。Git `refs/heads/biof3/current/*` 以 CAS 更新并在 SQLite transaction 回调内切 current；并发漂移或任一失败均回滚，不留下部分采用。
- revert 只允许撤销仍为 current 的非 baseline ChangeSet；未采用候选只删除自己的临时 ref，baseline 永远不能撤销。restore 不改写历史，而是产生新的 commit、ChangeSet 和 Revision；重复恢复同一目标幂等返回同一新版本。
- 5 个 Agent 工具和 6 个 HTTP 端点复用相同服务与项目权限边界；Revision Artifact 下载再次校验工作区包含性与 SHA-256。普通用户默认只看当前版本、状态、来源、文件数和操作，高级 Git 信息折叠披露。
- `ResultStudioChangeSetPanel` 已接入真实结果侧栏；默认紧凑，展开后显示前后图、表格/JSON/文本差异和历史。采用/恢复后打开返回的真实 Job/Artifact，不建立第二套结果预览或版本状态。

验收证据：

- 服务专项 9/9 覆盖采用/撤销/恢复、幂等、baseline 禁止撤销、跨项目拒绝、CAS 冲突不改 SQLite，以及大 JSON/大表有界截断；组件专项 4/4 覆盖紧凑/展开、采用、撤销与 baseline 边界、恢复为新版本。
- 隔离真实 R Server/SQLite/Git fixture 完成 v1 → 采用 v2 → 撤销回 v1 → 历史恢复为新 v3；重复恢复幂等，Revision Artifact 下载返回 200。
- 真实 renderer 已覆盖明亮、夜间与 820×900；窄窗 `innerWidth=clientWidth=scrollWidth=820`，无页面级横向溢出。矩阵记录见 [`../acceptance/g0-result-studio/rs6-visual-matrix.md`](../acceptance/g0-result-studio/rs6-visual-matrix.md)，UI-104 为 `verified`。
- UI-102 仍待真实大表选择/重启/positional caveat；UI-103 仍待真实长修改失败/取消/历史恢复，不借 RS6 证据提前关闭。

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
