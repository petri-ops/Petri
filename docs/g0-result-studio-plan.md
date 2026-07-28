# G0 Result Studio — 意图驱动、可编辑、Git-backed 的科研结果工作台计划

最后更新：2026-07-28

状态：`active / implemented_unverified`（RS0～RS8 引擎基础与完整 P4R 已真实收口；G0-CHF0 审计修复已重新真实收口；`G0-RS-P5` 进行中）

开发形态：`单工作包串行 / 主工作区分支`（不使用 Git Worktree，判据见 §14 `G0-RS-WT0`）

计划编号：`G0-RS`

主模块：`W-04 结果与报告`

协作模块：`P-01 项目、会话与上下文`、`P-02 工具执行、Job 与 Artifact Truth`、`P-03 Harness 与 Agent 工作流`、`P-04 Plugin SDK 与分析能力`

跨模块关注点：`C-03 安全、确认与审计`、`C-04 状态与事件同步`、`C-05 测试与质量门禁`、`C-06 性能与交互手感`

前置条件：已满足。`G0-LF12` 已完成首个 `G0 Baseline v1 = qualified + maintained`，源码、证据与文档提交已全部推送形成干净 checkpoint，base commit 为 `38d3de2`（`main` 与 `origin/main` 同步、工作区 clean）。`run_tool → tool_job → artifact truth`、源数据不可变、Loop 恢复与交付复现契约不得回归

范围边界：Result Studio 不属于 LF12 原始资格范围。RS0～RS8 已形成 Git/SQLite/Artifact/ChangeSet/Revision 引擎基础，但 2026-07-25 产品复核确认选择 UI、图形实体映射、Agent 上下文、手动编辑器、主画布和真实端到端资格证据不足。`result-studio-editing` 的产品支持声明在 `G0-RS-P7` 重新资格前保持暂停，不从既有合成证据外推。

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

2026-07-24 决策：**不使用 Git Worktree**。Result Studio 在主工作区以单线串行方式开发，分支为 `codex/g0-result-studio-product`。

原设计（LF 留在 `main`、RS 使用 Codex 永久 Worktree）的目的是隔离与 LF 并行的开发线。该前提在 LF12 收口后已不存在，因此启动门不成立并标记 `deferred`。

判据：

- 隔离对象已消失：LF0～LF12 全部关闭，G0 转为常驻 `maintained` 门禁，不存在与 RS 并行的 LF 开发线。
- 无并行所有者：`git worktree list` 仅主工作区；当前只有一个活跃开发线程。
- 成本可量化：每个 Worktree 需独立 `node_modules`（527M + frontend 209M）与独立 electron-rebuild（`better-sqlite3` × `electron 30.5.1` ABI）；项目已有一次 native 架构错配事故记录，复制环境会放大该类问题。
- 参照实例已存在：`/Applications/BioF3.app`（rc.7）与 `dist/mac-arm64/BioF3.app` 已提供 `userData` 独立的稳定对照，无需第二份 checkout。
- 非技术前置：`G0-RS1` 的 Git Adapter 面向**用户项目目录**，其 非Git / clean / dirty 矩阵由临时 fixture 仓库覆盖，与 BioF3 仓库自身的 Worktree 无关。WT0 不是 RS1～RS9 的技术前置。

替代做法：

- 单分支 `codex/g0-result-studio-product`，小步提交并频繁与 `main` 集成，避免长期分叉后一次性重资格。
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

状态：`completed`（2026-07-25）

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

实现与边界：

- 新增 `result-studio-plugin-sdk.js`，对结果语义、稳定实体 schema、来源脚本、输入 Artifact binding、参数类型与影响级别、正式 Artifact、Validator、golden Revision 和升级策略执行 fail-closed lint；无效或不完整元数据不会进入 RS4 受信参数影响规则。
- 首批适配 canonical `deseq2`、`volcano-plot`、`gene-correlation`（heatmap）与 `go-kegg`。四者共 12 个正式 table/plot 输出全部映射，所有 required file input 全部具备 Artifact binding；未虚构插件并不存在的颜色或样式参数。
- 每个插件保留一个 canonical R 执行入口，但 RS5 已按 Artifact/Revision 将其快照到 `analysis/scripts/<artifactFamilyId>/<revisionId>/<artifactId>.R`。因此每个正式图/表拥有独立、可追溯、可继续修改的脚本，同时仍由原插件一次性满足 required outputs，不引入第二个 executor、Artifact 或插件内版本系统。
- 每个插件新增 `golden-revisions/result-studio-v1.json`，固定源码、输入绑定与 Artifact contract 三类 SHA-256。相同 major 且 contract digest 一致的历史 Revision 继续可读；major 或 contract 漂移要求迁移，缺迁移时明确降级为 `read_only_legacy`。
- 正式 `plugin-contract-lint` 已接入 Result Studio SDK；`npm run g0:result-studio:plugin` 与聚合门成为永久离线门禁。

验收证据：

- SDK 专项 5/5，覆盖四插件完整 lint、图表映射、binding、golden digest、伪造影响元数据拒绝和升级兼容。
- 四插件既有真实 macOS arm64 valid fixture 均已通过 `run_tool → tool_job → artifact_truth`；RS7 脱敏汇总位于 `acceptance/g0-result-studio/rs7-plugin-acceptance.json`，13/13 checks。
- `harness:plugins:contract` 为 10 plugins / 0 errors；既有 warnings 不属于 RS7 contract failure，未借本阶段虚构修复。

### G0-RS8：耐久恢复、性能与存储治理

状态：`completed`（2026-07-25）

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

实现与边界：

- `createResultChangeSet()` 在 change_set、materialized、candidate_committed、preview_ready 和失败/取消阶段持续更新同一 `WorkspaceCheckpoint`；关闭会话或进程中断后不依赖 renderer 内存恢复修改现场。
- `result-studio-lifecycle.js` 联合校验 checkpoint hash、ChangeSet 状态、candidate/current Git refs、Revision current 指针、source commit 与 Artifact SHA-256。只有已存在 candidate ref、valid Revision、completed Job 和 valid Artifact Truth 的 running ChangeSet 才可自动恢复到 `preview_ready`；缺失 current ref 可从 SQLite+commit 自愈，冲突 ref、Artifact 漂移、checkpoint 损坏或半采用状态一律阻断。
- 存储摘要按 Artifact SHA-256 区分 logical/unique/deduplicable bytes；精确重复结果可通过 plan token + 哈希前后条件物化为项目内 content-addressed hardlink，不触碰源数据或改变 Artifact 内容。Git 继续承担文本对象自身的 content-addressed 去重。
- 安全 GC 先生成稳定 plan token，执行时重新核对。可删除范围仅限超过年龄门的关闭态/临时 `.biof3/revision` staging 和仍匹配 candidate commit 的内部 ref；`artifactDeletionCount` 永远为 0，不删除 Artifact 文件、Revision 记录、current/adopted/selection/checkpoint 引用对象。
- 大表新增最多 1 MiB / 200 行的 byte cursor API，结果侧栏按 50 行渐进加载候选表并在局部滚动容器渲染，不读取完整文件、不阻塞首屏。RFC4180 multiline cell 边界明确披露，不冒充完整 CSV 引擎。
- preview Job 在创建 ChangeSet 前读取真实内存/磁盘快照和 active preview 数；资源不足 fail-closed，并发饱和返回 queued，绝不通过修改科学参数换取运行。项目级 status/recover/storage/deduplicate/gc/preview-budget API 与紧凑 UI 状态均复用同一 SQLite/Git/Artifact 真相。

验收证据：

- `test/result-studio-lifecycle.test.mjs` 6/6：重启恢复、Artifact drift、ref 自愈、内容去重/GC、渐进分页、资源预算。
- RS5/Repository 联合专项覆盖 checkpoint 每阶段落库与 selection/checkpoint 对 GC reachability 的保护；Result Studio 前端专项 6/6。
- 脱敏验收位于 `acceptance/g0-result-studio/rs8-lifecycle-acceptance.json`，12/12 checks；不包含绝对路径、URL、凭据或原始科学数据。
- UI-105 已登记为 `in_progress`：功能与组件门禁完成，真实大表、应用重启和明暗/820px 视觉证据留给 RS9 产品矩阵，不借离线测试提前标记 verified。

### G0-RS9：真实产品验收与基线晋升

状态：`qualification_withdrawn / evidence_reclassified`（2026-07-25 产品复核）。本节保留当时目标与历史实现记录，但其中“真实产品”“qualified”“verified”的晋升结论不再决定当前事实；新的产品资格只由 §22 的 `G0-RS-P7` 裁决。

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

历史实现与验收声明（已降级为单元、fixture、合成集成与 renderer 证据）：

- 新增确定性 `result-studio-qualification.js`：只有 5/5 科学任务、9/9 环境、7/7 证据类型、至少 2 类真实 Provider、全部独立脚本及零假成功/半采用/静默丢失同时成立才允许晋升；任一缺项都 fail-closed。
- DEG 表精确选择 27 个稳定 `gene_id`，以 filter/hash 和 12 个有界样本进入 Agent 上下文；科学阈值修改确定性覆盖 DEG、火山图与富集下游节点，并保持科学确认门。
- DeepSeek 与 OpenAI-compatible 两类真实 Provider 通过 Result Studio 展示修改、科学阈值、27 基因继续富集和未知参数保守分级矩阵；不保存模型、URL、响应或凭据。
- 真实 renderer 使用隔离 SQLite、项目目录和 BioF3 托管 Git：明亮/夜间、1440×900、820×900、五万行 DEG 大表、服务中断/重启共 5 态通过。820px 下 `innerWidth = clientWidth = scrollWidth = 820`；五万行表仅渲染当前可见 24 行，显示 4 个版本、逻辑占用与可去重空间，重启后仍恢复同一候选现场。
- Git Adapter 专项继续覆盖非 Git、已有 clean Git 和已有 dirty Git；ChangeSet/Review/Lifecycle 专项覆盖 AI/手动同一契约、失败/取消、compare/adopt/revert/restore、checkpoint、Artifact hash、ref 自愈/阻断与安全 GC。
- 脱敏证据：`rs9-product-acceptance.json`、`rs9-provider-acceptance.json`、`rs9-visual-acceptance.json` 及 `rs9-ui/` 五张截图。聚合结果为 5/5 tasks、9/9 environments、7/7 evidence classes。
- 历史实现曾把 `result-studio-editing` 晋升为 qualified support claim；产品复核发现五条任务由独立测试、fixture 与截图组合推导，Provider 探针未执行真实工具闭环，视觉检查依赖人工布尔值，大表由数据库 seed 构造。因此该资格声明暂停，待 `G0-RS-P0` 修正机器声明、`G0-RS-P7` 重新资格。
- UI-102、UI-103、UI-105 的历史 `verified` 已回退为 `in_progress`；UI-104 只保留“候选版本比较/采用/撤销引擎和紧凑侧栏”这一窄范围验证，不代表 Result Studio 产品完成。

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

RS0～RS9 的旧勾选记录已被 2026-07-25 产品复核撤销。只有同时满足以下条件，`G0-RS` 才能重新晋升为 `qualified`：

- [x] 使用真实 Git，不是模拟 commit/diff。
- [x] 非 Git与已有 Git 项目均有安全路径。
- [ ] 普通用户无须理解 Git、内部 ID 或路径即可完成完整版本操作。
- [ ] AI 和真实手动编辑控件进入同一 ChangeSet/Revision 流程。
- [x] 已适配 Artifact 具备独立、可追溯脚本基础；仍需在真实编辑旅程验证可直接重跑。
- [x] 原始脚本、源数据和历史 Artifact 不被覆盖。
- [ ] 展示重绘、数据变换、科学重算和流程重规划在真实 UI/Agent 链可靠区分。
- [x] 新结果可绑定 Job、Artifact Truth、Validator 和 lineage。
- [ ] 表格和图形的真实选择控件可结构化进入 Agent 上下文并跨重启恢复。
- [ ] 主画布、Diff、科学差异、采用、撤销和恢复通过真实 UI 验收。
- [ ] 应用重启、任务中断、Provider 中断和脏 Git 工作区通过连续产品恢复矩阵。
- [x] 大型科研数据不进入普通 Git object database。
- [ ] 至少一个完整 Bulk RNA-seq 任务从真实原始结果完成多轮编辑与二次分析。
- [ ] 根检查、专项门禁、真实 Provider tool calling、packaged Electron 和视觉证据全部闭环。
- [x] `G0-RS8` 的运行时隔离基础存在；破坏性产品旅程仍须在 `G0-RS-P6/P7` 重验。

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

## 22. 2026-07-25 产品复核与重开决策

### 22.1 当前裁决

Result Studio 当前按三层事实表达：

| 层级 | 当前状态 | 已有能力 | 不得宣称 |
|---|---|---|---|
| Engine foundation | `implemented` | Git Adapter、Revision、ChangeSet、Job/Artifact binding、比较、采用、撤销、checkpoint、恢复与存储治理 | 不等于用户可完成结果编辑 |
| Product surface | `incomplete` | 右侧紧凑版本面板与部分预览 | 不得宣称中央结果工作台、真实选择、手动编辑器已经可用 |
| Qualification | `under_review` | 单元、fixture、合成集成和 renderer 截图证据可继续用于回归 | 不得把这些证据称为真实连续科学任务或完整 Provider tool-calling 资格 |

本次重开不删除 RS0～RS8 的代码或历史证据。`G0-SDC0` 作为已完成的数据契约种子保留，`SDC-1`～`SDC-7` 延后；SDC-1 只有在 `G0-RS-P7` 收口后才重新排期。

### 22.2 复核确认的产品缺口

1. `artifactSelection` 在真实工作区没有表格/图形操作入口，Selection helper 主要停留在函数与测试层。
2. 通用图形 Artifact 没有稳定 mark-to-entity mapping，无法诚实点选基因、样本或区域。
3. Agent 系统上下文没有自动获得 artifact/revision/family/selection/workflow node/script/editable schema 全套坐标。
4. 产品不存在 Schema 驱动的 Manual Parameter Editor 与统一 AI Edit Composer。
5. 结果被压缩在右侧工具栏，无法承担大图、大表、报告、比较和科学解释的主要工作空间。
6. 版本 UI 偏向内部 ChangeSet/Revision 状态，缺少面向用户的“改了什么、为什么、结论怎么变、下一步做什么”。
7. RS9 的五条任务不是一条连续 trace；Provider 探针主要验证结构化回答，未验证真实 tool calling 与重跑。
8. 五万行表通过数据库 seed 构造，只证明 renderer fixture，不证明真实插件、选择、修改、采用和恢复。
9. 视觉矩阵主要验证截图存在、尺寸和人工布尔值，没有证明用户可在 820px 完成结果任务。
10. UI 台账历史 `verified` 与代码中“图形控件后续实现、表格实机待验”互相矛盾。

### 22.3 产品模式与布局原则

工作区保持 Agent 主导，不点击结果时仍是聊天与任务流。只有用户打开 Artifact、Revision 或候选结果时，中央区域进入 Result Studio：

```text
默认：Agent 对话/任务模式
  └─ 点击结果
      → Result Studio 结果模式
          ├─ 中央：图 / 表 / 报告主画布
          ├─ 右侧：参数 / 版本 / 血缘检查器
          └─ 可展开：Agent 协作面板
              └─ 产生候选后进入比较模式
```

四种模式共享同一个 Project、Conversation、Workflow、Job、Artifact、Revision 和 Selection 真相，不复制状态：

| 模式 | 中央焦点 | Agent 角色 | 退出方式 |
|---|---|---|---|
| 对话模式 | 会话与阶段结论 | 主导需求理解、DAG 和执行 | 点击 Artifact 进入结果 |
| 任务模式 | DAG、运行状态和节点证据 | 主导诊断、修复与继续 | 打开节点结果或回到对话 |
| 结果模式 | 单个图、表或报告 | 解释、选择感知、辅助编辑 | 返回对话或进入比较 |
| 比较模式 | 当前版本与候选版本 | 解释视觉/参数/科学差异 | 采用、撤销或返回结果 |

布局必须满足：

- 结果打开后中央主画布占主要可用面积，右侧仅承载检查器，不再把结果锁在窄栏。
- 聊天不消失；宽屏使用可收起侧边协作面板，中/小屏使用明确的“结果 / Agent”切换。
- 文件、浏览器和终端仍是工具视图，不与 Result Studio 争夺同一主状态。
- 打开、关闭和切换模式只改变投影与焦点，不改变 Artifact current Revision。

## 23. G0-RS-P0～P7 产品收口计划

### G0-RS-P0：Truth Correction 与可执行基线

状态：`completed`（2026-07-25）。

目标：先让机器声明、文档和证据分类与代码事实一致，冻结一条可比较的产品基线。

范围：

- 将 `result-studio-editing` Support Claim 降为 `experimental/limited` 或重新加入 excluded claims；不影响 LF12 原始核心资格。
- 将 RS9 product/provider/visual/table-seed 证据分类为 unit、synthetic integration、renderer fixture 或 historical evidence。
- UI-102、UI-103、UI-105 回退 `in_progress`；UI-104 只保留窄范围版本操作验证。
- 建立现状实机截图、操作录像/trace 索引、DOM 可达性和关键交互失败基线。
- 冻结真实产品 trace schema，禁止脚本用常量或独立测试拼装“完整任务通过”。

验收：

- 文档、Support Matrix、qualification gate、UI audit 与运行时投影不再声称未证实能力。
- 旧证据不删除但有明确 provenance/classification；资格门对缺真实 trace fail-closed。
- `npm run docs:reconcile`、`npm run docs:check`、G0 qualification 回归通过；若 Support Claim 降级导致门禁失败，应通过正式兼容变更修复，不能篡改旧证据。

实现与证据：

- G0 Baseline patch 升级为 `1.1.1`，LF12 核心仍为 `qualified + maintained`；强制证据恢复为原始 `16/16`，`result_studio_product` 不再冒充核心 mandatory evidence。
- `result-studio-editing` 在 Support Matrix 标为 `experimental`，Qualification Manifest 中进入 excluded claims；旧 RS9 三类证据和 table seed 全部机器分类为 non-qualifying historical evidence。
- `Result Studio Product Trace v1` 固定 14 个连续步骤、7 个来源支持的不变量、允许/禁止证据类型；旧 RS9 汇总因无 continuous traces 被资格器 v2 确定性拒绝。
- 开发态真实界面观察确认：1280×720 下中央 698×682 区域只有“返回对话”，结果集中在右侧 340px 面板；该观察明确为 non-qualifying baseline，不替代 packaged 资格。
- 脱敏证据：`acceptance/g0-result-studio/rs-p0-truth-correction.json` 与 `rs-p0-ui-baseline.json`。
- 专项 `25/25`、全量 `1353`（1342 pass / 0 fail / 11 skip）、G0 permanent qualification、G0-START 与文档/UI 门禁通过；最终根检查 `npm run check` 已于 2026-07-25 完整通过（exit 0）。

### G0-RS-P1：Result Surface 与中央主画布

状态：`completed`（2026-07-25）；开发态真实 renderer 与代码门禁已收口，不升级 `result-studio-editing` 产品资格。

目标：让结果成为可阅读、可操作的主要空间，同时保持默认 Agent 主导。

交付：

- 在既有 `ProjectWorkspace` 状态机中增加 conversation/task/result/compare 四种投影模式，不新建第二个项目工作区。
- 建立 `ResultStudioCanvas`、`ResultInspector`、`ResultContextBar` 与响应式模式切换。
- 图、表、报告、文本/JSON、不可预览二进制使用统一 shell、各自 viewer adapter。
- 顶部只显示标题、可信状态、一句话结论、当前版本、选择摘要与最相关动作；技术 ID 收进高级详情。
- 宽屏、中屏、820px 小屏分别定义布局；结果模式可全屏、可返回原会话滚动位置。

验收：

- 从聊天、任务节点、文件/Artifact 导航打开同一结果，均进入同一主画布且不会创建第二份 current 状态。
- 明暗主题、1440px、1024px、820px 无页面级溢出；键盘和屏幕阅读器可到达核心动作。
- 关闭结果后 Agent 对话、输入草稿、滚动位置和运行中任务不丢失。

实现与证据：

- 在同一 `ProjectWorkspace` 状态机中加入 `result` / `compare` 投影；Agent 会话组件保持挂载，仅切换可见投影，不建立第二份项目、会话或 Artifact current 状态。
- `ResultStudioCanvas`、`ResultStudioContextBar` 与紧凑 `ResultStudioInspector` 已接线；顶部结果入口、任务/Artifact 打开与 URL 模式统一进入中央主画布，返回会话恢复进入前的布局状态。
- report / image / table / JSON / text / binary 六类 viewer adapter 明确落地；相对、协议相对和危险 scheme 统一回落到受控 Job 文件端点，manifest-only 可预览文件不依赖 Job files 重复登记。
- 真实开发态 renderer 覆盖明暗主题和 1440×900、1024×900、820×900：中央画布宽度分别为 858、683、820px，均无页面级横向溢出；820px 隐藏检查器。报告在后台刷新后保持当前选择。
- Agent 对话草稿经结果往返后原样保留并在验收后清空；进入前关闭的左栏返回后仍关闭。核心动作均具有稳定 role/name，技术 ID 默认折叠。
- 实测首次画布 3.2ms、Artifact 切换 0.7ms、返回会话 2.6ms，均低于 1000/500/250ms 冻结预算；同时冻结表格滚动 100ms、选择反馈 100ms、参数预览 500ms、比较打开 1000ms、重启恢复 5000ms 和切换内存增长 64MiB 的后续硬预算。尚未交付的交互不得伪造实测值，分别由 P2/P4/P5/P6 在真实功能与可观测运行环境中验证。
- 脱敏证据：`acceptance/g0-result-studio/rs-p1-result-surface.json`。该证据只关闭 P1 bounded renderer/product-development 验收，`result-studio-editing` 继续为 experimental/excluded，完整产品资格仍只允许在 P7 连续产品 trace 后裁决。
- P0 历史纠偏门改为校验封存证据与当前资格政策，不再要求 P1～P7 的演进源码永远保持 P0 哈希；RS9 历史输入和 P0 UI baseline 仍保持不可变校验。
- P1 专项 12/12、前端全量 266/266、TypeScript strict、UI/文档/根门禁按收口记录通过。

### G0-RS-P2：Scientific Interaction 与 SelectionContext

状态：`completed`（2026-07-25）；关闭 P2 bounded product-development 验收，不升级 `result-studio-editing` 产品资格。

目标：把“这些基因、这些样本、这个区域”变成真实、耐久、可复现的数据引用。

交付：

- 大表虚拟化、字段类型、排序、过滤、行/列选择、全选查询、选择摘要和清除/恢复。
- 图形 point/region/legend selection；插件 descriptor 必须提供稳定 entity mapping，缺映射时显式只读，不猜实体。
- SelectionContext 使用稳定 ID 或可复现 query/filter + hash；大选择只向 Agent 投影计数、规则和有界样本。
- 选择 chip 与主画布高亮、Inspector、Agent Composer 使用同一 selectionId。
- Artifact/Revision 改变时执行 compatible、stale、invalid 三态判定，禁止把旧行号静默映射到新结果。

首批场景：DEG 表 gene_id 选择、火山图基因点选/框选、热图基因/样本选择、富集表 pathway 选择。

验收：

- 真实插件结果完成单选、多选、过滤后全选、框选、跨标签切换、会话重开和应用重启恢复。
- 选择对象经 Agent tool call 实际用于下游 GO/KEGG 或重绘，不只验证序列化函数。
- 10 万行级表只渲染视口行；选择、排序和过滤不阻塞主线程且统计不说谎。

实现与证据：

- 后端权威表查询基于完整 CSV/TSV 执行字段类型推断、排序、过滤、稳定实体摘要与分页；单页最多 250 行，renderer 永不接收完整 10 万实体 ID。前端以 200 行权威页、18 行视口窗口完成虚拟滚动，跨页等待时不短暂显示上一页错误实体。
- 通用 `ScientificInteractionViewer` 覆盖表格行/列、过滤后全选，散点 point/region/legend，以及矩阵行基因/列样本选择。DESeq2、volcano-plot、gene-correlation、GO/KEGG 的交互 mapping 进入 Plugin SDK fail-closed lint；没有稳定 entity mapping 的结果显式只读。
- SelectionContext 以持久 `selectionId`、显式实体集合 SHA-256 或 query/filter + hash 表达，贯通主画布高亮、Context Bar、Inspector、Agent composer 与 SQLite；只有 `compatible` 选择进入 Agent 上下文，`stale/invalid` 只展示状态，不把旧行号映射到新结果。选择写入串行化，保存或清除失败回滚到最后一个已提交 SQLite 状态。
- 正式 Agent 工具 `result_selection_run` 从同项目当前 Revision 解析稳定 gene ID，验证源 Artifact/Revision/hash 与插件派生动作，生成独立 `materialize-selection.R`、参数 JSON 和 `gene-list.csv`，再进入唯一 `run_tool → tool_job → artifact truth` 链；路径型 selectionId、显式 hash 漂移和 query 证据漂移均在创建下游工作前阻断。
- 机器捕获的真实 admitted 链为 valid DESeq2 25 项 Artifact → 3 gene SelectionContext → valid GO/KEGG 36 项 Artifact；选择创建时间早于当前 r-server 进程并从 SQLite 恢复为 compatible。DEG table、volcano scatter、heatmap matrix、130 行 enrichment table 均由真实 API/Artifact/Revision 读取，原始 ID、URL、路径和结果值未进入证据。
- 自动 renderer 性能证据：10 万行权威表的滚动、选择、排序和过滤反馈均低于 P1 冻结的 100ms 预算；当前精确采样值由 acceptance JSON 保存，不在 canonical 文档复制易漂移数值。明暗主题 × 1440/1024/820 六格矩阵均恢复 3 个勾选、无页面横向溢出；820px 隐藏 Inspector，主题恢复“跟随系统”。
- 脱敏证据：`acceptance/g0-result-studio/rs-p2-live-observation.json`、`rs-p2-ui-observation.json` 与 `rs-p2-scientific-interaction.json`（17/17）。这些是 P2 live local/product-development evidence；packaged continuous trace、双 Provider 和产品重新资格仍只属于 P7。
- 日常验收改为自动化优先：`npm run g0:result-studio:p2:update` 生成当前源码哈希、专项、strict build、renderer 性能和证据；`npm run g0:result-studio:p2` 验证证据未过期。Electron/真实 Provider 只在所属阶段出口抽检，不能被省略或由较小测试替代。

### G0-RS-P3：Agent Context 与 Edit Orchestration

目标：用户只表达目标，Harness 自动补齐 Result Studio 的工程坐标和执行步骤。

交付：

- 构建版本化 `ResultStudioContextEnvelope`，至少包含 project/conversation/workflow node/job/artifact/family/revision/selection/plugin/script/editable schema/validation/reproducibility。
- 上下文由当前 UI 状态和后端真相自动投影；用户、模型都不需要手写内部 ID。
- Agent 工具支持 context-bound plan/create/status/compare/adopt/revert，服务端校验上下文 token 与当前 Revision，防止陈旧操作。
- 公开进度统一为“理解意图 → 判断影响 → 执行/重算 → 验证 → 候选可比较”，只展示阶段结论，不展示隐藏推理链。
- context 缺失、选择陈旧、来源脚本不足或归因只能到 Job 时诚实阻断，并给 Agent 可行动修复路径。

验收：

- 至少两个真实 Provider 在不提供任何内部 ID 的情况下，从当前结果和选择完成真实 tool calling。
- 工具调用必须生成同一项目中的 ChangeSet、正式 Job/Artifact 和候选 Revision；失败不得回退为模型口头成功。
- 切换模型、压缩会话和重开应用后 ContextEnvelope 可以从 SQLite/Artifact/Revision 重建。

实现状态（2026-07-25，`implemented_unverified`）：

- `core/shared-backend/result-studio-context.js` 建立 `ResultStudioContextEnvelope v1`：artifact/family、job、revision（含 current 与 ordinal）、script（相对路径 + sha256 + language + origin）、parameters、plugin 可编辑参数与声明动作、selection、validation、reproducibility、workflow 与五阶段公开词表。`contextToken` 为覆盖上述身份与选择证据的 SHA-256，任一项变化即失效。
- `core/r-server/agent-tools/result-context-tools.js` 只把前端 activeArtifact 当线索，坐标全部从 SQLite/`tool_jobs`/插件 descriptor 重新解析；跨项目 revision、未打开结果、缺正式 Revision 与"归因只能到 Job"均 fail-closed。只有 `compatible` 选择进入上下文，stale/invalid 只回报可行动状态。
- `result-context-edit-tools.js` 提供 context-bound plan/create/status/compare/adopt/revert，复用既有 `result-changeset-service` 与 `result-compare-service`，不建立第二套执行真相；写操作强制校验 `contextToken`，陈旧 token 返回 `context_token_stale` 并指向 `result_studio_context`；intent 指向另一 Revision 时返回 `context_intent_mismatch`。
- 模型可见 schema 新增 7 个工具（注册表共 32 个），其中 6 个 `*_in_context` 工具的参数中不含 toolJobId/artifactId/revisionId/artifactFamilyId/selectionId；系统提示描述当前结果但不写入任何内部 ID，并固定五阶段公开进度、禁止向用户索要内部 ID。
- `GET /api/result-studio/context-envelope` 与前端 `fetchResultStudioContext` 共用同一投影；Inspector 的 `ResultStudioContextReadiness` 如实显示 loading/blocked/ready 与选择是否交给 Agent，不把缺失坐标伪装成可用。
- 脱敏证据 `acceptance/g0-result-studio/rs-p3-agent-context.json`（20/20，`qualificationEligible: false`）。这是离线契约/注册表/提示词/strict build 证据；P3 验收要求的双真实 Provider tool calling、真实 ChangeSet/Job/候选 Revision 与重开重建仍未执行，因此本阶段保持 `implemented_unverified`，UI-108 记为 `in_progress`，不外推 P7 产品资格。
- 日常验收：`npm run g0:result-studio:p3:update` 生成证据，`npm run g0:result-studio:p3` 校验未过期；两者已接入 `g0:result-studio:acceptance` 与根 `check`。

### G0-RS-P4 Core：Manual + AI Unified Editing（`stable implementation checkpoint / implemented_unverified`）

目标：手动调整和自然语言修改共用一条可审计、可撤销、可复现的编辑链。

交付：

- 根据 Plugin SDK editable schema 生成参数面板，不为每个插件手写孤立结果页。
- 首批控件覆盖配色、字体、尺寸、图例、标签、导出格式，以及经过插件声明的科学参数。
- `AI Edit Composer` 自动引用当前 Artifact/Revision/Selection；用户可在执行前看到解释后的参数 Patch 与影响级别。
- 手动输入和 AI 结果都归一化为 `ResultEditIntent → ScientificChangeSet`，进入相同 validation、preview、compare、adopt/revert。
- presentation、data transform、scientific recompute、workflow replan 分级；未知参数保守按重算或阻断，绝不猜成样式修改。

验收：

- 同一火山图分别通过手动控件与 AI 完成等价配色/标签修改，生成可比较、可恢复的 ChangeSet。
- 修改科学阈值必须展示影响节点和科学确认语义；纯样式修改不得重跑 DESeq2。
- 任一控件不得直接覆盖 Artifact、源数据或 current Revision 文件。

实现状态（2026-07-26，`implemented_unverified`）：

- `core/shared-backend/result-edit-controls.js` 从插件 descriptor 的 `parameters` + `parameterImpacts` 投影控件，不为任何插件手写结果页；缺 impact 的参数不提供控件（缺声明不等于默认安全）。控件按 presentation / data / scientific / workflow 分组，只有 presentation 组允许标注"不改变科学结论"。
- `volcano-plot` descriptor 与 `scripts/volcano-plot.R` 补齐首批 presentation 参数：`color_up`/`color_down`/`color_ns`、`base_font_size`/`label_size`、`point_size`/`plot_width`/`plot_height`、`legend_position`、`plot_title`、`export_dpi`、`point_alpha`。此前这些全是 R 脚本硬编码，P4 要求的配色/字体/尺寸/图例/标签/导出控件无参数可绑。阈值与分类逻辑仍只由 `fc_threshold`/`pval_threshold` 决定，改呈现不改变任何科学判定。
- `normalizeEditSubmission` 是手动控件与 AI 提议的唯一归一化闸门：类型/范围/枚举 fail-closed 拒绝，未声明参数记为 rejected 而非静默丢弃，与当前生效值相同的提交不产出 patch（因此不会创建空 ChangeSet）。R 脚本内的 clamp 是运行时最后防线，不是本层放宽校验的借口。
- 影响分级只能由受信 descriptor 提升：调用方声明 `presentation_rerender` 无法把 descriptor 判为 scientific 的参数降级；未声明 impact 的参数保守落到 `scientific_recompute` 并标记为保守决策。
- 修复既有缺陷：`classifyParameterPatch` 原先让保护字段表覆盖 descriptor 规则，导致 deseq2 声明为 `workflow` 的 `design` 被悄悄降级成 `scientific`。保护字段现在只作下限，不再压低已声明的更高影响。
- `currentValues` 取自该 Job 的 `executionProvenance.params.normalized`，即真实执行过的参数，不用 descriptor 默认值冒充"当前生效值"。
- `GET /api/result-studio/context-envelope` 与 `result_studio_context` 返回同一份控件 schema，因此手动面板与 AI 看到的参数契约不可能分叉；`result_edit_plan_in_context` 新增 `editOrigin`（manual/agent）用于审计，不影响任何校验强度。
- `frontend/src/components/result-studio/ResultEditPanel.tsx` 只发出编辑请求，不写文件、不覆盖 Artifact 或 current Revision；科学/流程参数必须显式勾选确认才可提交；后端无法投影坐标时面板按真实原因禁用。
- 脱敏证据 `acceptance/g0-result-studio/rs-p4-unified-editing.json`（18/18，`qualificationEligible: false`）。这是离线 descriptor 投影 / 插件接线 / 注册表 / strict build 证据；P4 验收要求的"同一火山图手动与 AI 各跑一次真实候选并比较恢复"属真实运行观测，尚未执行，因此本阶段保持 `implemented_unverified`，UI-109 记为 `in_progress`。
- 日常验收：`npm run g0:result-studio:p4:update` 生成证据，`npm run g0:result-studio:p4` 校验未过期；两者已接入 `g0:result-studio:acceptance` 与根 `check`。

### G0-RS-RH0：Repository Hygiene Gate（`completed`）

目标：在 P4R 大规模产品交互开发前，把 Agent 热上下文、脚本入口、测试选择和临时产物生命周期收口为确定性工程契约。RH0 是现有 `G0-RS` 工作包内的串行前置门，不是第二份主计划，也不改变 Result Studio、Job、Artifact、Revision 或科学执行真相。

启动依据：2026-07-26 静态审计确认，仓库根有 35 份非归档 Markdown、65 个脚本、145 个 npm 命令、127 个 Node MJS 测试、4 个 Node CJS 测试、39 个前端测试和 2013 个 `tmp/` 文件。主要风险不是文件数量本身，而是已完成材料仍在默认必读、`AUDIT-LOG` 与 `CLAUDE.md` 持续膨胀、脚本无机器分层、`npm run check` 重复执行测试、定向测试只有文字纪律而无自动入口，以及测试对本机 `tmp` 绝对路径存在依赖。

串行阶段：

1. **RH0-0 Truth Snapshot**：冻结文件/命令/测试/临时产物基线，确认 P4 提交、分支和工作区归属。
2. **RH0-1 Hot Context**：把 `AUDIT-LOG` 收缩为活跃广播，把已处理历史移入归档；让 `CLAUDE.md` 只作为 `AGENTS.md` 的兼容入口；把文档默认必读缩为审计、next steps、handoff 和当前工作包，其他材料按需读取。
3. **RH0-2 Test Impact**：建立机器可读影响映射与 `test:changed`；Node 测试去重后一次执行，前端复用 Vitest `--changed`/related；未知生产改动无法映射时 fail-closed，不静默冒充通过。保留 `test:all` 作为发布、资格或基础契约变化时的显式门。
4. **RH0-3 Script/Temp Lifecycle**：为全部活跃脚本标注 development/check/acceptance/release/historical 责任；清退确认失效的旧桌面脚本与已下线云端 smoke；保留 `fix-r-paths.*` 等真实运行依赖。解除测试对本机 `tmp` 的硬编码依赖，测试模式不落永久日志，交互运行日志采用有界保留。
5. **RH0-4 Acceptance**：运行选择器自身测试、受影响测试、文档/UI 门和一次 RH0 收口全量基线；记录全量只在本阶段最终稳定源树执行一次，不恢复“每次修改跑全量”的旧习惯。

不在 RH0 范围：

- 不实现 P4R 结果快路径、画布重排、版本选择器或代码查看 UI。
- 不移动或删除 `acceptance/` 资格与科学证据，不删除运行时/发布真实消费的脚本。
- 不重写分析插件、执行器、Job、Artifact、ChangeSet、Revision 或数据库真相。
- 不通过全局 ignore 隐藏历史证据；默认搜索与当前状态判断由治理入口和脚本分类约束。

完成门：

- 任一 Agent 从 `AGENTS.md`/`CLAUDE.md` 得到同一当前阶段与定向测试规则；默认启动不再要求读取已完成工作包全文。
- `AUDIT-LOG` 只保留活跃项和紧凑处理记录，已处理详情仍可从归档恢复。
- `npm run test:changed` 对工作区/显式基线变化给出可解释、去重、确定性的测试集合；未映射生产文件必须非零退出。
- `npm run test:all` 明确覆盖 Node MJS/CJS，前端提供对应 changed/all 入口；CI/发布职责与本地迭代职责不混淆。
- `tmp` 无测试硬依赖；QA 测试不再无限生成日志；清理命令只作用于仓库内明确 `tmp` 子目录。
- `docs:reconcile`、`docs:check`、`ui:audit:check`、RH0 定向测试和最终一次全量基线通过；RH0 已由 `95a7fe3`、`041e32e` 形成可恢复提交，满足 P4R 启动门。

RH0 收口证据（2026-07-26）：`test/impact-map.json` 与 `scripts/test-affected.mjs` 已建立确定性、去重、fail-closed 的影响选择；`npm run test:changed` 定向 Node 41 项与前端 294 项通过，`npm run test:all:workspace` 最终基线为 Node 1581 pass / 0 fail / 11 skipped、前端 294 pass / 0 fail；`npm run docs:reconcile`（39 registered、0 unregistered、0 validation issues）、`npm run docs:check`、`npm run ui:audit:check` 与 `git diff --check` 全部通过。旧 `dev-desktop.sh`、已下线云端 smoke 与旧 DESeq2 MCP 验收脚本已删除；真实 JSON 证据迁移到 `test/fixtures/golden-path/deseq2-run.json`，`tmp` 历史日志/二进制已清理，QA/golden-path 日志保留上限为 20。后续审计确认 RS9 脚本仍被历史证据引用，因此保留文件但从日常 Result Studio syntax 热路径移出，新增显式 `g0:result-studio:historical:syntax`；历史代码仍可单独校验。该收口只改变工程治理，不改变任何执行/科学真相；P4R 启动门已满足，P4R-0～P4R-2 已按当前证据推进。

### G0-RS-P4R：Product Reframe — Agent-first Focused Result Experience（`completed · non-qualifying`）

#### P4R.1 定位与启动门

P4 Core 已证明“手动与 AI 可以进入同一条受信编辑链”，但 2026-07-26 的真实开发态体验复核确认：底层能力存在不等于结果工作台可用。P4R 是同一 `G0-RS` 工作包内、P4 Core 之后、P5 之前的串行产品重校准阶段，不是第二个 canonical 计划，也不改变 P4 Core 已建立的 schema、Intent、ChangeSet 或 Git 真相。

P4R 只有在以下启动门满足后才能进入实现：

1. P4 Core 的代码、测试、18/18 脱敏证据和 canonical 状态形成可恢复提交；不得在未知 P4 WIP 上重排 UI。
2. `npm run g0:result-studio:p4` 对该提交为 current；`qualificationEligible:false` 继续保留。
3. 当前分支、工作区和运行进程归属明确；继续遵守“不使用 Worktree”的当前裁决。
4. P4R-0 先捕获失败基线并冻结预算，再修改产品；不得先凭主观审美重写组件。

P4R 未收口前，`G0-RS-P5`、P6、P7 和 SDC-1 均保持阻断。

#### P4R.2 已确认的用户问题与事实依据

本阶段直接解决以下已由用户操作和代码核对共同确认的问题：

1. **结果打开慢**：点击本地图片时可等待数秒。开发态日志观察到本地后端事件循环反复阻塞约 2.1～8.2 秒；当前打开路径会并发触发 Artifact Truth reconcile、首次 baseline Revision/Git binding、完整 backing table 查询、ContextEnvelope、ChangeSet/Workspace storage 检查，且其中存在同步文件扫描与哈希。图片字节请求因此被同一事件循环中的次级工作阻塞。
2. **版本不可直接选择**：现有 ChangeSet 面板自动选择一个 ChangeSet；历史列表只在展开比较后出现，旧 Revision 只有“恢复为新版本”，没有“只查看此版本”。用户无法区分查看、比较、采用、撤销和恢复。
3. **导航与内容层级失配**：主结果之前同时出现版本存储、交付摘要、最终报告和两级结果导航；常驻“结果导航”与二级 Artifact rail 争夺画布，结果本体无法首屏成为唯一焦点。
4. **编辑入口倒置**：P4 Core 把 schema 参数面板做成显著入口，但目标用户可能不理解参数；自然语言 Agent 应是主要入口，参数控件只作为渐进披露的高级精调。
5. **注意力与作用域分散**：打开一个结果后仍可同时看到其他结果、交付卡、版本存储和多个操作面板；系统没有清楚表达“Agent 当前只处理哪个结果/版本/选择”。
6. **代码入口不足**：当前仅有藏在旧导航中的 Job 级“查看脚本”；Revision 已保存 `sourceScriptRef`，但没有每个 Artifact/Revision 的精确代码查看 API 和中央代码视图，无法一键复制该版本的完整可执行代码。
7. **Git 引擎没有形成 Codex 式审查体验**：真实 commit/ref/CAS、compare/adopt/revert 已存在，但普通用户看到的是存储与技术信息，不能先回答“改了什么、科学结论是否变化、我要采用还是放弃”。

这些事实是产品缺口基线，不是 P4R 已通过的证据。

#### P4R.3 产品契约

P4R 完成后的默认产品形态固定为：

```text
返回结果列表   当前结果名称 · vN ▼ · 验证状态
────────────────────────────────────────
                当前结果主画布
────────────────────────────────────────
告诉 Agent 你希望怎么调整……              发送

有候选时：
一句话修改摘要 · 科学影响 · [比较] [采用] [放弃]
```

必须满足以下契约：

- **结果优先**：当前图、表或报告先于交付、版本存储、复现和高级信息出现；普通窗口无需滚动即可看到主体。
- **单结果聚焦**：同一时刻只有一个 `ActiveArtifact + viewedRevision + SelectionContext` 作用域。后台任务和受影响下游节点不得抢走当前画布。
- **Agent-first**：自然语言输入是默认修改入口；Agent 自动获得当前 Artifact、Revision、Selection、脚本和可编辑 schema，不向用户索要内部 ID。
- **渐进披露**：高级参数、Git commit/ref/hash、环境明细、存储统计和完整日志默认隐藏。
- **四态互斥**：中央区域一次只处于“结果 / 代码 / 比较 / 历史”中的一个模式，不把四种信息纵向堆叠。
- **查看不写入**：选择历史版本、打开代码或比较候选都是只读操作，绝不改变 Git current ref、SQLite current Revision 或 Artifact 文件。
- **修改形成候选**：手动或 Agent 修改继续进入 `ResultEditIntent → ScientificChangeSet → run_tool → tool_job → artifact truth → candidate Revision`；没有第二条快捷写路径。
- **原子采用**：图、表、代码、参数和受影响结论可以逐项审查，但相关 ChangeSet 只能整体采用或放弃，不能留下科学不一致的半套结果。
- **精确代码**：代码视图读取该 Artifact/Revision 实际执行和校验过的脚本快照；不得根据当前插件版本事后生成近似代码。
- **诚实降级**：历史结果只有 Job 级共享脚本时明确显示“共享执行脚本”；缺少脚本或 hash 不符时只读阻断，不伪造独立代码。

#### P4R.4 架构边界

1. **复用现有真相**
   - 结果身份继续使用 `ActiveArtifact`；选择继续使用 `SelectionContext`；Agent 坐标继续使用 `ResultStudioContextEnvelope + contextToken`。
   - 版本继续使用 `ArtifactRevision / ScientificChangeSet / WorkspaceCheckpoint` 和现有 Git Adapter。
   - `viewedRevisionId` 只能是可丢弃 UI 投影；“正在查看”不新增 current 指针、不落第二套版本表。

2. **快路径与次级路径解耦**
   - 点击结果的快路径只取得最小 Job/Artifact 身份、可信 URL/stream 和已缓存 manifest，立即渲染 skeleton/主体。
   - InteractionManifest、ContextEnvelope、版本列表、代码元数据、Workspace lifecycle/storage 进入主体可见后的独立次级请求；任一失败不得清空已显示结果。
   - 首次 baseline Revision、完整 backing table 解析、工作区扫描、Git 检查和大文件 hash 不得同步执行在图片/预览响应的事件循环关键路径。
   - 可在 Job 完成时预计算的 manifest、Revision binding、缩略图和内容摘要应前移；其余重任务进入 worker/后台队列，并以 Artifact/Revision hash 作为缓存失效依据。
   - Revision Artifact 服务不得每次图片请求都同步重算完整文件 hash；使用已验证的 content identity 或后台完整性状态，并在漂移时 fail-closed。

3. **Focused Result Surface**
   - 现有中央 `ResultStudioCanvas` 继续使用，不新增页面级 Result Studio 真相。
   - 常驻结果导航和二级 rail 被一个紧凑结果头与按需结果抽屉替代；从 Agent 消息点击结果时直接打开准确 Artifact/Revision。
   - Result header 只显示结果名、当前/查看版本、validation 状态和返回入口；内部 ID 不进入普通视图。
   - Result/Code/Compare/History 切换必须保持 Agent 草稿、滚动、选择和进入前布局。

4. **Agent-first Editing**
   - 结果画布底部或同一焦点区域提供紧凑 Composer；发送时自动绑定当前 context token。
   - Agent 先返回人可读 Patch 与影响级别，再按会话自动化模式进入既有 plan/create 工具；样式修改不要求用户逐项理解参数。
   - 科学设计、阈值和工作流变化继续服从现有权限/确认契约；不得用统一复选框替代 Agent 对科学影响的解释。
   - P4 Core 的 `ResultEditPanel` 保留为“高级精细调整”抽屉，与 Agent 仍共用 `normalizeEditSubmission`。

5. **Git-backed Change Review**
   - 顶部版本选择器至少区分“当前、候选、历史、原始”，并显示来源与简短时间，不展示裸 Revision ID。
   - 选择历史版本只改变 `viewedRevisionId`；“恢复为新版本”是另一个明确动作。
   - 默认变更摘要回答：修改意图、变化对象数、是否重算科学结论、验证状态。
   - 展开审查按“视觉 / 代码 / 参数 / 表格 / 科学影响”组织；Git patch、commit、ref 和存储信息进入高级详情。
   - Agent 必须能理解“比较上一版、采用候选、放弃修改、恢复 v2”等自然语言，而不要求用户操作 Git 术语。

6. **Per-result Code & Reproduce**
   - 新增只读、项目隔离的 Revision source 投影：返回语言、精确脚本内容或受控 stream、relative path、sha256、origin、是否独立脚本以及对应参数/输入/环境摘要。
   - 中央代码视图支持复制完整代码、下载脚本、在项目编辑器打开、让 Agent 解释/修改；只有服务端投影为 `replayable` 的 Revision 才能发起受控重放，材料或输入不足时明确禁用。
   - 切换版本时代码同步切换；代码修改只能产生新 ChangeSet/Revision，不覆盖历史脚本。
   - 复现入口逐步披露参数 JSON、输入引用与 hash、Runtime/包/插件版本、随机种子、精确命令和输出 hash；完整 ReplayPackage 继续由现有 HRT-6 真相提供。

#### P4R.5 串行实施阶段

##### P4R-0：Truth Baseline、失败测试与预算冻结

进度（2026-07-28）：P4R-0 已收口。一次性隔离捕获环境、canonical corpus、失败测试先行和性能预算均已完成；`acceptance/g0-result-studio/rs-p4r-performance.json` 为 13/13，基线由 `RS-P4R0-13` 冻结，重跑只写 `currentObservation` 与对比，不覆盖基线。P4R-0 收口时不变量为 6/7，唯一红项 Revision source projection 已由 P4R-5 关闭；当前套件含 7 条核心不变量与 1 条显式 runtime skip guard，本机为 8/8。原始观测工具由 `340c09a` 引入并保持 `BIOF3_PERF_PROBE=1` 默认关闭。

运行时勘察（2026-07-26，只读检查开发库 `core/r-server/biof3.db`，只取计数与结构，不读结果内容）：

| 事实 | 实测 | 对 P4R-0 的影响 |
|---|---|---|
| `tool_jobs` | 1921（failed 1427 / completed 420 / running 74） | 有真实历史可用 |
| migrations 表 | **不存在** | `src/migrations/001_result_studio.sql` 从未在该库执行 |
| RS2 的 5 张表 | 全部缺失 | Revision/ChangeSet/Selection/Checkpoint 路径在该库无法执行 |
| completed 按工具 | `test-tool-2` 382、`deseq2` 35、`volcano-plot` 3 | 非合成语料仅 38 个 |
| heatmap、GO/KEGG completed | 0 | P4R-5 要求的两类正式 Artifact 尚不存在 |
| 卡在 `running` | 74 | 属重启中断 `recovery_required` 投影，是 P4R-0 应捕获的失败基线之一 |
| 本机 R runtime | Rscript 4.5.2，DESeq2 可用 | 可在隔离环境真实生成基线语料 |

由此产生三条对 §P4R.2 原有指控的纠偏，必须在捕获基线时一并验证，不得直接沿用：

1. §P4R.2(1) 记录的「事件循环阻塞约 2.1～8.2 秒」是开发态人工观察。由于该库缺少全部 RS 表，该观察**不可能来自完整 Result Studio 打开链**；其真实来源需要在捕获阶段重新归因，不能预设为 Revision/ChangeSet/Git binding 造成。
2. §P4R.2(1) 同时列举的「首次 baseline Revision / Git binding / ChangeSet / Workspace storage 检查」在该库中无表可查，因此当前开发态根本走不到这些分支；其代价必须在补齐 migration 的捕获环境中重新测量。
3. 基线捕获不得使用用户开发库：其中含 6 个真实项目，且 420 个 completed 中 382 个为合成 `test-tool-2`，直接采样会同时污染用户数据并违反「不使用数据库 seed 冒充真实产品旅程」。

因此 P4R-0 增加一个前置步骤：建立一次性可抛的捕获环境（沿用 `G0-RS8` 已确立的模式，用环境变量把 SQLite、results/uploads/tmp/logs 指向临时目录，只隔离运行时、不复制源码树），在其中执行 migration 并真实运行 deseq2 / volcano / heatmap / GO-KEGG 生成基线语料，再开始采样。该环境已由 `scripts/g0-rs-p4r-capture.mjs` 实现（`2225dde`），隔离由 `assertIsolated()` fail-closed 断言，不依赖任何生产代码改动。

代码勘察结论（2026-07-26，只读核对，全部带 path:line 依据）。以下条目是**计划与代码不一致**之处，按纪律登记而不擅自裁决：

| # | 计划原文 | 代码实际 | 处置 |
|---|---|---|---|
| 1 | §P4R.2(1) 把 ContextEnvelope 列为阻塞元凶 | `core/r-server/agent-tools/result-context-tools.js` 全 414 行零 fs/crypto/child_process，纯 SQLite + 缓存 descriptor | **纠正**：不得按同步 fs 热点计预算 |
| 2 | §12 的 13 个组件文件与 6 个 Viewer Adapter | 一个都不存在；全部逻辑在 `frontend/src/pages/project-workspace.tsx:3209-4371` 的内联 `ResultArtifactShell`，adapter 是 `resultSurface.ts:68-81` 的字符串联合 | **降级**：§12 是提案，不是现状描述 |
| 3 | §P4R.3「查看不写入」 | 字面成立（不改 current 指针/ref），但 `routes/result-studio.js:320-330` 在**每个** result-studio 请求（含纯 GET 读历史 artifact）无条件 `saveRepositoryBinding()` + 未缓存 git 探测 | **待裁决**：契约指「完全不写」还是「不改 current」，计划未区分 |
| 4 | P4R-0 要求捕获「代码打开」基线 | `routes/result-studio.js` 23 条路由中无 revision source 投影；§P4R.4(6) 自己也说这是新工作 | 基线只能记 `not_implemented`，不能记时间 |
| 5 | P4R-0 要求机器捕获首屏内容可见/切换 | 仓库无 playwright/puppeteer；`g0-qualification-visual.mjs` 只校验既有 PNG，不捕获 | **已决策**：只冻服务端预算，客户端记 `ObservedMs:null` + 状态串，沿用 RS-P1 先例 |
| 6 | P4R-0 设 >250ms 事件循环阻塞门 | `server.js:178-193` 的 tick 采样器 `TICK_MS=1000`/阈值 2000ms，分辨不出 250ms | 权威信号必须声明为 `snapshotProbe().eventLoop.maxMs`（10ms 分辨率直方图） |
| 7 | §P4R.6(1) 暗示主体普遍等待次级请求 | 静态图片/报告主体**已经不等** interaction/context/version/storage；真正阻塞的是 `/tools/status`（所有主体）、interaction manifest（仅交互表/散点）、以及 CSV/JSON/文本主体的第二次全文件下载 | 失败测试必须针对这三处具体耦合，不能写成笼统断言 |
| 8 | RS-P1 已冻结 `firstCanvasVisibleMs=1000` | 该指标在 `ResultStudioSurface.tsx:40-48` 的 `useLayoutEffect(...,[])` 里量**画布挂载**，非内容；用户等数秒也会通过 | 必须替换为内容锚定指标。**替换不等于放宽**，但计划未给出区分机制，须在证据中显式注明 |
| 9 | §P4R.7 列两份证据文件 | 未说明哪个子阶段写 `rs-p4r-product-reframe.json`，也未指定两种证据风格取哪种 | P4R-0 只写 `rs-p4r-performance.json`，采用 sourceHashes 风格以便源码漂移时失效 |

已确认的性能事实（可直接作为 P4R-1 的目标，不需重新论证）：

- `routes/result-studio.js:1021` 在**每个**图片请求上对整个文件重算 sha256（`hashFile` 是同步 openSync/readSync 循环）后才 `sendFile`。计划 §P4R.4(2) 末条指控**属实**。
- `/api/result-studio/workspace/status` 最重：`inspectRevisionIntegrity` 遍历至多 5000 个 revision，**每个**算全文件 sha256 并 fork 1～2 次 `git rev-parse`（execFileSync 阻塞），随后 `inspectResultStudioStorage` 再遍历一次并递归 walk 至多 10000 个文件。
- 打开 PNG **并不豁免**表格解析：绘图分支对声明的 backing CSV 调 `queryResultTable`，`limit:250` 只限制返回行数，`readDelimitedTable` 仍 `readFileSync` 整个文件（上限 64 MiB / 250k 行）并算 sha256。
- git-adapter 全部使用 `execFileSync`，且 `detectGitRuntime()` 明确不缓存，因此该路径上每次 binding 都要 fork 若干次进程。

证据门机制的既有约束（影响 P4R 全程，不只 P4R-0）：

- p2/p3/p4 的 `sourceHashes` 同时包含 `package.json`、`frontend/src/pages/project-workspace.tsx` 和（p3/p4）`core/r-server/routes/result-studio.js`。这三者正是 P4R 每阶段必改的文件，因此**刷新 p2/p3/p4 证据是 P4R 全程的每次提交税，不是 npm 接线时的一次性成本**。
- `test/result-studio-qualification.test.mjs`（影响图为 `acceptance/g0-result-studio/**` 选中的测试）并不读取 `rs-p4r-performance.json`，因此真实校验必须写在生成脚本或新增专用测试里，不能依赖该测试。
- 三份验收脚本原本内部调用 `npm test --prefix frontend`（= `vitest run --changed`），叠加文件过滤后选中 0 个测试并退出 0，被记为 `passed:true`；已于 `be0a6de` 统一改为 `npm run test:files`。新增 P4R 脚本必须同样使用 `test:files`，否则会静默空转。

- 机器捕获结果点击的请求 waterfall、事件循环 lag、首次内容可见、Artifact 切换、版本切换和代码打开基线。
- 建立小/中/大 PNG/SVG、10 万行表、长报告、多 Revision 的 canonical fixture；不使用数据库 seed 冒充真实产品旅程。
- 先补失败测试：结果显示不得等待 interaction/context/storage；查看历史版本不得改变 current；代码 hash 不符必须阻断；次级请求失败不得清空主体。
  - ✅ 已交付于 `test/p4r-invariants.test.mjs`，入口 `npm run g0:result-studio:p4r:invariants`。P4R-5 已关闭原源码投影红项并加入真实受控 replay 不变量；当前为 7 条核心不变量 + 1 条显式 skip guard，且已进入 `p4r:p5:test` 与影响映射。
  - 每条按代码实况书写，不照本节原文写成笼统断言（笼统写法要么恒真要么红在错误原因上）：
    - **① 通过**。服务端已成立：`/api/tools/file` 与 result-studio 路由无依赖关系，断言用于防回归。客户端那半属不变量 ④。
    - **②a 通过**。重复读取不新增 Revision。
    - **②b 已转绿（P4R-1）**。纯读路径不再写 repository binding。
    - **③ 已关闭于 P4R-5**。Revision source 端点、hash/commit/path/project fail-closed 与两阶段 replay 已落地；真实 source/replay 不变量持续防回归。
    - **④ 已转绿（P4R-1）**。主体状态决策已抽入并测试 `resultBodyState.ts`，次级失败不再清空已显示主体。
- 冻结可机器验证的性能预算。最低要求：点击后 100ms 内有可见反馈；Result Studio 打开链不得产生超过 250ms 的同步事件循环阻塞；不同大小 Artifact 的首内容与版本切换精确阈值由本阶段真实采样写入 acceptance contract，后续不得放宽来换取通过。

##### P4R-1：Fast Result Path

**范围细化（2026-07-27，基于 P4R-0 真实测量）**：原 charter 把相邻版本预取和大文件渐进加载列为先验必做项；测量证明主要阻塞来自重复 Git 子进程，工作区扫描为 0%、hashing <5%。因此 P4R-1 的出口按证据收敛为：消除只读写 binding、缓存 runtime、惰性 repository state、批量 rev-parse，以及次级请求失败不替换已显示主体。预取/渐进加载没有可证明收益且未实现，不计为交付；只在 P4R-6 真实矩阵重新观察到对应瓶颈时重开。该细化不放宽冻结性能预算。

- 拆分 Job 状态/Artifact 字节与 interaction/context/version/storage 请求。
- 将重复 Git runtime/repository state/rev-parse 成本移出预览关键路径；只读路径不得写 binding。
- 相邻版本预取与大文件渐进加载经测量未形成当前瓶颈，明确推迟到 P4R-6 真实性能矩阵出现对应回归时再评估，不作为 P4R-1 已交付项。
- 增加请求级 timing、cache hit/miss 和 event-loop lag 观测，但不得记录结果内容、绝对路径或凭据。

##### P4R-2：Focused Result Surface

**范围（2026-07-27 按代码实况收敛）**

P4R-2 的可交付范围以**该子阶段启动时**的代码实况为界，本阶段**不新增阶段、不借用后续阶段的工作**。当时四态互斥中只有 `result` 一态有实现基础：`WorkspaceMode`（`frontend/src/hooks/useWorkspaceRouting.ts:4`）中不存在 `code` 与 `history`；`compare` 在 `frontend/src` 内零写入者（无任何 `updateWorkspaceMode('compare')` 调用点，只能由手输 `?mode=compare` 经 `project-workspace.tsx:219` 进入），且每个消费点都写成 `result || compare`（`:311`、`:377-378`、`:394`、`:945`、`:1148`，`CenterPanel.tsx:114`），`ResultStudioCanvas` 只把 `mode` 落成 `data-mode` 属性（`ResultStudioSurface.tsx:53`）而 `ResultStudioSurface.module.css` 与 `project-workspace.module.css` 都不选择该属性，因此它与 `result` 渲染**完全相同**。Code 的数据源属 P4R-5：当时 `core/r-server/routes/result-studio.js` 的 23 条路由无一投影 Revision 源，计划 §P4R.4(6) 与 §P4R-5 已把该只读源投影和「Result/Code 无损切换」明写为 P4R-5 的新工作；History 的版本选择器属 P4R-4（§P4R-4 第一条）。因此 P4R-2 独立可交付的只有三件事：(1) **首屏化**——主体之上不再出现无条件块，仍保留的每个块都要给出「为什么必须排在结果之前」的判据，判据抽成可测纯谓词放进 `frontend/src/components/result-studio/resultFirstScreen.ts`，不再埋在内联且不 export 的 `ResultArtifactShell` 里（当前对象：`workflowBar` `:4049`、`recoveryConfirmation` `:4073`、`ResultStudioChangeSetPanel` `:4145`、`resultScientificDelivery` `:4161-4162`；`resultDeliveryCard` 已由 `ba6b124` 处理）；(2) **header 收敛**——`ResultStudioContextBar`（`ResultStudioSurface.tsx:64-103`）已存在，要做的是消除它与 `workflowBar`（`:4059`）对同一 `artifactTruth.status` 的重复呈现，并把版本位从截断 Revision ID（`resultSurface.ts:125-129`）改为真实 `vN` 或如实降级；(3) **模式机制骨架**——只建立「一次只显示一态」的容器与状态载体，并在其上接入唯一有实现的 `result`，`code` 入口在 P4R-5 的源投影路由存在前不得渲染，`history` 随 P4R-4 接入，`compare` 保持不可达而非被本阶段伪装成可用。跨模式的草稿/选择/滚动/布局保持由 P4R-2 建立机制并**只对 `result↔chat` 验证**，其余组合随 P4R-4/P4R-5 补齐。附带可安全清理的死代码：`HistoryPanel`（`project-workspace.tsx:2777-2823`）、`ToolboxPanel`（`:2840-3106`）在 `frontend/src` 内零引用，`ResultSidebarPanel`（`:4462-4504`）虽 export 却无 import，使 `ResultArtifactShell` 中 6 处 `isSidebar` 分支（`:3246`、`:3947`、`:4090`、`:4095`、`:4246`、`:4403`）全部不可达，合计约 357 行。（行号钉在 `1a31ed3`；`project-workspace.tsx` 正在串行修改中，引用时按符号名重新定位。）

**证据边界**

P4R-2 的证据边界沿用 P4R-0 已确立的纪律：**没有生产者的指标一律记 `unmeasured` 并写明原因，绝不估算、绝不默认为 0、绝不用形状校验冒充测量**（先例见 `acceptance/g0-result-studio/rs-p4r-performance.json` 的 `unmeasured` 数组与 `budgets.visibleFeedbackMs` 的 `machineVerifiable:false` / `status:"frozen_target_not_yet_measurable"`）。可以机器证明的部分：模式容器一次只渲染一态、`resultFirstScreen.ts` 中每个首屏谓词的真值表、header 不再重复呈现 `artifactTruth.status`、版本位在拿不到 `revisionOrdinal` 时走降级文案而非截断 ID、焦点顺序与 `role`/`aria-*` 完整、核心路径键盘处理器可触发、状态不只依赖颜色、样式只引用已定义的 `--biof3-*` token——这些全部是 DOM 结构与纯函数断言，happy-dom 足以覆盖，写成 vitest 并经 `npm run test:files`（**不得用会退化成 `vitest run --changed` 的裸 `npm test`**，见 §P4R-0 证据门约束）。必须记为未测量的部分：`1440/1024/820px` 下的实际布局与横向溢出、明暗主题的真实渲染差异、以及「主体首屏可见」的像素判定。原因是实测的而非假设的——`frontend/vite.config.ts` 的 `test.environment` 为 `happy-dom`，本次核对临时跑的探针（用例已删除）得 `getBoundingClientRect() = 0×0`、`offsetWidth = 0`、`document.documentElement.scrollWidth = 0`、`clientWidth = 0`，`getComputedStyle` 只回显声明值，`window.innerWidth` 可设但不带布局；仓库内无 playwright/puppeteer；`scripts/g0-qualification-visual.mjs` 只校验既有 PNG 与人工 `inspection.json`（其 `accessibilityInspection` 断言 `method === 'computer-use-accessibility-and-screenshot-review'`），并不捕获。统一用 `not_captured_no_browser_automation_in_repo` 作为原因串，与 P4R-0 保持同一词表。另有两条不得重复的前例：其一，`acceptance/g0-result-studio/rs-p2-ui-observation.json` 在仓库内**没有任何生产者**（`scripts/g0-rs-p2-acceptance.mjs:131-144` 只校验其形状：六格矩阵、`pageHorizontalOverflow === false`、64 位 sha256），因此它不可重跑、不可复核，P4R-2 **不得**再产出同类「形状被校验、内容无来源」的 UI 证据；其二，`npm run g0:result-studio:p4r:frontend` 已建立并执行真实 frontend specs；不存在单独的 `:ui` 像素门，因为仓库仍无浏览器自动化。`acceptance/g0-result-studio/rs-p4r-product-reframe.json` 同时绑定 `sourceHashes` 与 source commit，生产源码或实际执行 spec 漂移都会令证据失效。所有 P4R-2 证据保持 `qualificationEligible:false`，不升级 `result-studio-editing` 支持声明，产品资格仍由 P7 唯一裁决。


- 主体首屏化。**删除对象按代码实况重新指定**：原文点名的三个对象经核对均不成立——Honeycomb 结果导航是网格列（`project-workspace.module.css:4086-4088`）且已可收起（`project-workspace.tsx:4257-4258`、`:3947`），删之得横向宽度而非首屏高度，其去留改为横向宽度问题单独裁决、不计入首屏化交付；存储卡已自抑制（`ResultStudioChangeSetPanel.tsx:56`、`:182`、`:184`）；二级 Artifact rail 已条件渲染（`project-workspace.tsx:3946`）。真正无条件占据首屏的是计划未点名的 `resultDeliveryCard`，已由 `ba6b124` 按 `resultFirstScreen.ts::shouldShowDeliveryCard` 条件化。
- 本阶段剩余的首屏对象是主体之上仍会出现的四个条件块：`workflowBar`（`project-workspace.tsx:4049`）、`recoveryConfirmation`（`:4073`）、`ResultStudioChangeSetPanel`（`:4145`）与 `resultScientificDelivery`（`:4161-4162`）。每个都必须给出「为什么它必须排在结果之前」的判据；判据一律抽成可测纯谓词放进 `frontend/src/components/result-studio/resultFirstScreen.ts`，不再埋在内联且不可导出的 `ResultArtifactShell` 里——该组件定义在近 5000 行的 `project-workspace.tsx` 内且不 export，其内部决策此前无法被任何测试触及。
- 顺带清理与首屏无关但同处该文件的死代码：`HistoryPanel`（`project-workspace.tsx:2777-2823`，47 行）与 `ToolboxPanel`（`:2840-3106`，267 行）在 `frontend/src` 内零引用；`ResultSidebarPanel`（`:4462-4504`，43 行）虽 `export` 却无任何 import，使 `ResultArtifactShell` 中 6 处 `isSidebar` 分支（`:3246`、`:3947`、`:4090`、`:4095`、`:4246`、`:4403`）全部不可达。
- **收敛已有 header，不新建（P4R-2 启动判据）**：`ResultStudioContextBar`（`ResultStudioSurface.tsx:64-103`，挂载于 `CenterPanel.tsx:181-191`）已经是结果头。本阶段做三件事：去掉它与 `workflowBar`（`project-workspace.tsx:4049`、`:4059`）对同一 `artifactTruth.status` 的重复呈现；把版本位从截断 Revision ID（`resultSurface.ts:125-129`）改为 §P4R.3 要求的 `vN`——启动时 `ActiveArtifact`（`project-workspace.tsx:132-150`）不含 `revisionOrdinal`，P4R-2 最终选择补一条不阻塞主体的最小投影，并在载荷缺失时如实显示「当前版本」，**不得用截断 ID 冒充 `vN`**；保留返回入口，内部 ID 不进普通视图。
- **返回目标按现状写为「返回会话」**：仓库内不存在结果列表界面，返回按钮的 `aria-label` 就是「返回对话」（`ResultStudioSurface.tsx:83`）并走 `updateWorkspaceMode('chat')`（`CenterPanel.tsx:188`），右栏 `results` tab 是单 Artifact Inspector（`RightPanel.tsx:146-174`）。§P4R.3 布局图中的「返回结果列表」同步改为「返回会话」；若要建结果列表，那是新增产品面，不属 P4R-2 且需单独立项。
- **模式机制本阶段只能立骨架，不能立四态**：`WorkspaceMode`（`useWorkspaceRouting.ts:4`）中不存在 `code` 与 `history`；`compare` 零写入者且与 `result` 渲染完全相同（`ResultStudioSurface.tsx:53` 只落 `data-mode`，两份 module CSS 均不选择它）。因此 P4R-2 只交付「一次只显示一态」的容器与状态载体，并在其上接入唯一有实现的 `result`。`code` 入口在 P4R-5 的 Revision 源投影路由存在前不得渲染；`history`/版本选择器随 P4R-4 接入；`compare` 在 P4R-4 给出比较入口前保持不可达，**不得由本阶段把它伪装成可用的第四态**。
- **[x] Agent 会话常驻（已交付 `8e58f98`）**。该条在原 charter 中被写成布局偏好，实测是**主路径上的静默数据丢失**：`ResultEditPanel`（`RightPanel.tsx:161-174`）提交后派发的 `copilotAsk` 经零缓冲的 `dispatchBioF3Event`（`lib/events.ts:109-113`）发出，唯一订阅者 `SimpleChat.tsx:579-585` 在 result 模式下未挂载，事件消失且 `finally` 同步把按钮重置为空闲，用户得不到任何失败提示。修复去掉了 `CenterPanel` 中冗余且具破坏性的 `{ctx.showPinnedSummary && children}` 门（可见性本由投影层 `aria-hidden` + CSS 承担，去掉后比原来**少**做工作），并新增 `ownsCopilotAsk`（默认 `false`，仅中央实例传 `true`，`CenterPanel.tsx:167`）避免右栏 chat tab 重复订阅。守门测试此前双重假绿（给所有模式硬编码 `showPinnedSummary: true` 并 mock 掉 `SimpleChat`），已改为按 mode 派生并新增 `copilotAskDelivery.test.tsx` 用真实订阅验证送达。记为**交付缺陷修复**，不记为布局改造。
- **[x] 选择与滚动保持（已交付）**：进出结果、切换 Artifact/Revision 后草稿、选择、滚动可恢复。其中「布局」一项已由 `project-workspace.tsx:309-320`、`:377-386` 的 `resultPanelRestoreRef` 实现；草稿的存活已由 `8e58f98` 从结构上保证（会话不再卸载）；**选择**状态因 `activeArtifact`（含 selection）是宿主 state、`updateWorkspaceMode` 不重置它、仅 `activeJobId` 变化才清空而天然保持；**滚动**位置由新增的 `frontend/src/components/result-studio/resultScrollMemory.ts`（按 jobId 缓存 `.resultView` scrollTop 的纯模块，7/7 单测）+ `ResultArtifactShell` 成功态 div 的 ref/onScroll 接线实现，result 层重新挂载时按 job.id 恢复。chat 侧 `sc-messages` 因 SimpleChat 常驻天然保持，无需额外机制。仅对 `result↔chat` 验证；Code/History/Compare 的对应验证分别随 P4R-5/P4R-4 补齐。滚动恢复的实机像素验证本仓库无浏览器自动化，按 P4R-0 先例记 `not_captured_no_browser_automation_in_repo`。
- 1440/1024/820px、明暗主题和键盘焦点：**按可证明性拆成两半，不整条作为出口条件**。可在 happy-dom 单测中机器证明的部分必须成立并写进证据：模式容器在每个断点下渲染同一棵可达 DOM、焦点顺序与 `role`/`aria-*` 完整、核心路径的键盘处理器存在且可触发、状态不只靠颜色（以文本或 `data-*` 兜底）、样式只使用已定义的 `--biof3-*` token 因而明暗共用一套声明。不可证明的部分**必须按 P4R-0 先例记为未测量并给出原因**：`frontend/vite.config.ts` 用 happy-dom，实测 `getBoundingClientRect()`/`offsetWidth`/`scrollWidth`/`clientWidth` 全为 0，不做布局计算；仓库无 playwright/puppeteer；`scripts/g0-qualification-visual.mjs` 只校验既有 PNG 不捕获。因此 `pageHorizontalOverflow`、各断点实际可见高度与「主体首屏可见」的像素判定一律记 `unmeasured` + `not_captured_no_browser_automation_in_repo`，**不得估算、不得以 `innerWidth` 冒充布局、不得以人工提供而仓库内无生产者的 JSON 充作机器证据**。

##### P4R-3：Agent-first Editing

完成（2026-07-28）：中央结果画布已接入独立 `ResultAgentComposer`，前端按 project/conversation/Artifact/Revision/Selection 完整 binding key 保存草稿与后端 `contextToken`；事件把 token、结果与结构化编辑请求放入不可见 request context，可见用户消息只保存用户自己的目标。task/legacy 两条 Agent 路径共用 `result-context-binding.js`，在 schema 校验前只为缺少 token 的 `*_in_context` 调用补入点击时 token，显式 stale token 不被替换，后端继续从 SQLite/Artifact Truth 重新投影并 fail-closed。绑定态仍先读 `result_studio_context` 的可信 editable schema，再 plan；create 只接受同一 Agent turn 中服务端保存的原始 intent，模型篡改分类/确认、旧 selection intent 配新 token、任意 script patch 与模型提供的 DAG 均 fail-closed。无 DAG 的纯展示重绘诚实限定为 `current_result_only`，科学/数据/流程变化继续因缺权威 DAG 阻断。`ResultEditPanel` 已降为右栏默认关闭的“高级精细调整”抽屉；手动 patch 与 Agent 意图仍汇合到同一 context-bound plan/ChangeSet 链。五阶段由后端真实发出并单调记录；实时 Composer 按 token 隔离，完成/停止/Provider 失败写入 terminal assistant meta，重开会话可从 SQLite 消息恢复且不渲染内部 reason。并发 run 拒绝提交且不清草稿。P4R-3 Node 专项当前 76/76、前端 P4R 定向 134/134、strict TypeScript 通过。实现检查点为 `3d3eb29`，性能门校准修复为 `59b33c4`；P2 17/17、P3 20/20、P4 18/18、P4R-performance 13/13、P4R-product 10/10 均绑定可达 source commit。affected 门 700/700 Node、102/102 related frontend，专项 76/76 Node、134/134 frontend；本阶段已收口，当前阶段推进至 P4R-4。

- 把自然语言 Composer 置于当前结果焦点内；自动绑定 Artifact/Revision/Selection/contextToken。
- 用户只描述目标，Agent 输出紧凑参数 Patch、影响级别和受影响节点；不展示隐藏推理链。
- P4 Core 参数面板移入高级抽屉；手动与 Agent 路径继续产生等价归一化 patch。
- 修改过程复用持久五阶段公开进度；切换工具、停止或失败后不丢失阶段结论。

##### P4R-4：Version Switcher 与 Codex-like Change Review

完成（2026-07-28）：实现检查点 `f710261` 交付真实互斥且可路由的 Result / Compare / History 中央模式；Code 继续由 P4R-5 的 Revision source projection 门控。历史查看使用前端可丢弃 `viewedRevision`，主体、interaction、Selection 与 contextToken 均显式绑定所选 Revision，不移动 current、不切 active Job、不调用写 API；首次版本列表 GET 使用 `ensureSchema:false` 且不创建 managed Git，挂载自动 `workspace/recover` 已改为显式用户动作。版本选择器从项目/family-scoped SQLite Revision + ChangeSet truth 标注原始、当前正式、待采用候选和历史，100 条后可分页，跨项目/family 查询 fail-closed。

Change Review 默认只呈现服务端受信并持久化的一句话意图、影响等级/范围、验证状态和最多三个主动作；视觉、参数、表格、文本 Diff 按需展开，Git 详情默认折叠。adopt/revert/restore 的 checkpoint 写入已并入同一 SQLite transaction，失败时 Git ref 与 SQLite 一起回滚；参数 hash、candidate source commit、parent family/project 漂移均阻断。focused frontend 104/104、affected Node 258/258、related frontend 48/48、P4R product 13/13、strict TypeScript、docs/UI 门通过；P2 17/17、P3 20/20、P4 18/18、P4R-performance 13/13、P4R-product 13/13 全部绑定 `f710261` 且 `sourceCommitMatchesSourceHashes:true`。UI-113/UI-114 保持 `in_progress`，`qualificationEligible:false` 与 `implemented_unverified` 不变；实机明暗/响应式/键盘/连续旅程仍归 P4R-6。当前阶段推进至 P4R-5。

- 提供可直接查看任意 Revision 的版本选择器；严格区分查看、比较、采用、撤销和恢复。
- 默认只显示一句话摘要、验证/科学影响和三个主动作；详细视觉、代码、参数、表格、科学层 Diff 按需展开。
- 查看旧版本不产生 Git/SQLite 写入；采用继续使用 Git CAS + SQLite transaction；恢复继续生成新 Revision。
- 同一 active result 的版本切换和 Agent 上下文同步，陈旧 context token 明确刷新。

##### P4R-5：Per-result Code & Reproduce（已完成）

- 为每个有正式 `sourceScriptRef` 的 ArtifactRevision 提供精确代码投影和 Result/Code 无损切换。
- 支持复制、下载、打开和 Agent 解释/修改；对 `reproduction.replayable` 的 Revision 提供两阶段受控重放，材料或输入不足的 Revision 明确返回 `unavailable`；历史版本显示其自己的脚本。
- 独立脚本与共享 Job 脚本诚实区分；缺代码、越界路径、hash 漂移和跨项目访问全部 fail-closed。
- 隔离 source-observation producer 已通过真实 `run_tool → tool_job → artifact truth → ArtifactRevision → revision source` 链验证 DESeq2 `deg_table`、standalone volcano、gene-correlation heatmap 与 go-kegg GO-BP 四类正式 Artifact；四项均为 completed Job、4/4 source projection verified，证据 source-bound 到 `f5c50db`。其中 volcano/heatmap 投影为 replayable，DESeq2/GO-BP 因当前材料不足诚实保持 `unavailable`；4/4 不外推为四类均已真实 replay。KEGG 条件性产物在无离线快照/REST 结果时保持 optional，GO-BP 结果与报告仍为 required，不再把一个真实完成的 GO Job 因条件性 KEGG 缺失错误标成 failed。

完成（2026-07-28）：`07d8c92` 交付 exact Revision source 与 Code surface，`f5c50db` 补齐 replayable Revision 的 context-bound 两阶段受控重放、真实 `run_tool → tool_job → Artifact Truth → candidate Revision` 执行、重复确认幂等、current/history 不变、Job-root legacy Artifact 安全解析和 source commit 对象可达性检查。普通 Source API 不暴露 raw 参数；只有进程内 replay service 可读取 exact normalized values，调用方不能传 toolId/params/script/command/workflowPlan。前端预检明确展示工具、输入数、运行时和副作用，确认后只创建候选并进入 Change Review；非 replayable Revision 不提供伪执行入口。

证据：P4R 套件为 7 条核心不变量 + 1 条显式 skip guard，本机 8/8；其中 standalone volcano 真实 replay invariant 创建一个且仅一个非 current 候选；source/replay 单测 7/7，P4R-5 聚合 Node 15/15。P4R-6 追加 background 17/17、source-bound live chain、同一 Electron BrowserWindow UI matrix；聚合 product evidence 20/20，`qualificationEligible:false`。四类 source observation 4/4 exact source projection 及所有 P4R-6 evidence 都有 `sourceCommitMatchesSourceHashes:true`。UI-113/UI-114/UI-115 已由 renderer evidence 升为 `verified`；P4R 收口并解锁 P5。

##### P4R-6：整体验收与交接

完成（2026-07-28）：P4R-6 已把 canonical baseline materialization 与 workspace/storage inspection 移至持久后台子进程；真实 source-bound performance evidence 为 14/14，event-loop 峰值 19.661ms，低于冻结的 250ms 预算。连续 live evidence 从 completed Job 经 context-bound presentation candidate、Compare、exact Code、adopt、controlled replay、discard、conversation 与真实 backend restart/reopen 全链通过；Electron evidence 在同一 BrowserWindow 覆盖明暗 × 1440/1024/820、键盘/focus、失败降级/重试与重启恢复。product evidence 20/20。三份新证据均脱敏、source-bound、`qualificationEligible:false`；未使用真实 Provider，未声称 packaged 资格。

- 从真实已完成 Job 打开结果，完成 Agent 样式修改、版本比较、代码查看、采用/放弃与会话往返。
- 捕获开发态明暗 × 1440/1024/820 矩阵、键盘路径、错误/重试、次级 API 失败和基本服务重开恢复。
- 更新 canonical 计划、roadmap、handoff、UI 台账和聚合门；P4R 证据保持 non-qualifying。
- 只有 P4R 全部出口满足后，下一阶段才允许 P5；Provider、packaged Electron、崩溃/系统重启压力和完整产品资格仍由 P6/P7 裁决。

#### P4R.6 验收矩阵

必须同时满足：

1. **速度与响应**
   - 点击任意 canonical 结果 100ms 内出现目标结果的 skeleton 或缓存内容，不显示上一结果假响应。
   - 图片/表格/报告主体不等待 InteractionManifest、ContextEnvelope、版本、代码或 storage 状态。
   - P4R-0 冻结矩阵内无 Result Studio 同步任务造成 >250ms event-loop block；冷/热打开与版本切换预算全部通过。

2. **单结果焦点**
   - 主体之上不出现无条件块；每个仍排在主体之前的块都由 `resultFirstScreen.ts` 中的具名纯谓词决定其出现条件，并有对应单测（当前对象：`workflowBar`、`recoveryConfirmation`、`ResultStudioChangeSetPanel`、`resultScientificDelivery`、`resultDeliveryCard`）。结果导航保持可收起且第二级保持按需（`project-workspace.tsx:3946`、`:4257-4258`），不再以「常驻两级导航」描述现状。「主体首屏可见」的像素判定在本仓库无生产者，按 P4R-0 先例记为 `unmeasured` + `not_captured_no_browser_automation_in_repo`，不作为可重跑门的通过条件。
   - 当前作用域显示“结果名称 · 版本 · validation”。`revisionOrdinal` 已由 P4R-2 接入 `ActiveArtifact`，有序号显示真实 `vN`，载荷缺失时诚实降级为“当前版本”，不再用截断 Revision ID 冒充版本号。P4R-6 以真实尺寸/主题和历史 Revision 连续切换复验该投影，后台节点不会自动切走。
   - 草稿、选择、滚动和布局保持已由 P4R-2 交付，Result/Code/Compare/History 已由 P4R-4/5 接入真实互斥模式。P4R-6 的剩余目标是连续实机回归：result↔chat 与四种结果模式往返后，草稿、Selection、主体滚动、viewed Revision 和布局都不退化，旧 Revision 不污染 current。

3. **Agent 主导**
   - 用户不提供任何内部 ID，仅在当前结果输入自然语言即可得到真实 ChangeSet 候选。
   - 样式修改不会重跑 DESeq2；科学/流程变化展示影响并服从既有自动化边界。
   - 高级控件与 Agent 产生相同 patch 时，Intent/ChangeSet 归一化结果一致。

4. **版本与 Git 审查**
   - v1/v2/v3 可直接查看；查看不改变 current，不新增 Revision，不写 Git ref。
   - 候选摘要、前后视觉、代码/参数 Diff 和验证状态可理解；裸 Git 细节默认隐藏。
   - 采用、放弃、撤销和恢复均使用现有原子契约并可重放。

5. **代码与复现**
   - 任一具有正式 `sourceScriptRef` 的 ArtifactRevision 可从结果头进入精确代码；缺源材料时明确阻断。
   - 复制/下载内容与 `sourceScriptRef.sha256` 一致；版本切换后代码同步变化。
   - 代码修改产生候选 Revision；源数据、current Artifact 和历史脚本保持不可变。
   - `replayable` Revision 可完成预检/确认并只生成非 current 候选；材料不足的 Revision 保持 `unavailable`，不得出现伪重放按钮。

6. **异常与降级**
   - interaction/context/version/storage/code 任一请求失败时，已打开结果仍可查看，并提供自动重试或可行动说明。
   - 脚本缺失、hash 漂移、版本过期和跨项目访问不得回退成近似成功。
   - 停止或服务短暂失败后，公开阶段与候选状态继续由 SQLite/Git/Artifact Truth 恢复。

7. **UI 与可访问性**
   - 明暗主题和 1440/1024/820px 无页面级横向溢出。
   - 核心路径可用键盘完成，状态不只依赖颜色；主操作每个模式不超过三个。
   - 普通视图不展示内部 ID、绝对路径、凭据、原始用户数据或完整 Git 实现细节。

#### P4R.7 计划证据与门禁

当前真实存在的专项入口：

- `npm run g0:result-studio:p4r:test`：fast-path、read-only revision view、source projection、Context/ChangeSet 不变量。
- `npm run g0:result-studio:p4r:frontend`：Focused Result Surface、Agent Composer、Version Switcher、Change Review、Code View。
- `npm run g0:result-studio:p4r:product`：P4R-1～当前子阶段的 source-bound 产品契约；`product:update` 刷新对应证据。
- `npm run g0:result-studio:p4r:invariants`：P4R 不变量与真实受控 replay 门；当前为 7 条核心不变量 + 1 条显式 runtime skip guard，本机 8/8，已由 `p4r:p5:test` 和影响映射纳入默认 P4R-5 范围。
- `npm run g0:result-studio:p4r[:update]`：聚合/刷新当前源码哈希和脱敏证据。

`npm run g0:result-studio:p4r:perf`、`:live`、`:ui` 与各自 `:update` 已真实落地；`p4r:update` 依序写入 performance、live、UI 与 product evidence。live/UI producer 分别执行 disposable local Truth 链和同一 Electron BrowserWindow；它们不是 Provider 或 packaged 资格替代物。

计划证据位置：

- `acceptance/g0-result-studio/rs-p4r-product-reframe.json`：契约、源码哈希与专项门。
- `acceptance/g0-result-studio/rs-p4r-performance.json`：请求 waterfall、event-loop 和预算。
- `acceptance/g0-result-studio/rs-p4r-live-observation.json`：P4R-6 source-bound、脱敏的连续 local Truth 链证据。
- `acceptance/g0-result-studio/rs-p4r-ui-observation.json`：P4R-6 source-bound、脱敏的 Electron UI 矩阵证据；截图位于同目录 `rs-p4r-ui/`。

这些证据只能把 P4R 标记为 `implemented_unverified/product-development evidence`；不得升级 `result-studio-editing` 支持声明。P7 仍是唯一产品资格裁决点。

#### P4R.8 完成定义与移交边界

P4R 只有在 P4R-0～P4R-6 串行完成、所有声明证据当前、`docs:reconcile`/docs/UI 门通过且 Git WIP 可恢复时才可收口。完成报告必须明确：

- 快路径与次级路径的真实边界及剩余性能例外；
- 保留/替换的旧导航、版本面板和参数面板；
- Agent、手动、Git、SQLite、Artifact Truth 是否仍为单一链；
- UI-103/UI-105/UI-108/UI-109 以及 P4R 新 UI 条目的真实状态；
- 留给 P5 的科学差异、留给 P6 的崩溃/压力恢复、留给 P7 的 Provider/packaged 资格。

### G0-RS-P5：Real Scientific Editing 与科学差异

状态：`in_progress`（2026-07-28）。

启动边界：P5 先以 SQLite、Job 与 Workflow Truth 建立可验证的权威持久 DAG 投影；在该投影及其下游影响证明缺失时，科学、数据和流程编辑必须继续 fail-closed。不得以模型提供的 `workflowPlan`、fixture 或 seeded Revision/ChangeSet/数据库替代这条真相链。P6 的 Provider/压力恢复与 P7 的 packaged/资格重新裁决仍不在本阶段范围。

目标：证明 Result Studio 可以修改真实科学结果，而不只是操作版本元数据。

首批真实任务：

1. DEG 表筛选稳定 gene_id 并继续 GO/KEGG。
2. 火山图选择基因后修改标签、颜色、尺寸并导出 SVG/PNG。
3. 热图修改配色、聚类展示和注释，区分展示变化与计算变化。
4. 修改 DEG 阈值，重算 affected subgraph 并比较显著基因与富集结果。
5. 从历史版本创建替代方案，比较后采用，再撤销并恢复为新 Revision。

交付：

- 每个正式图/表/报告都能定位和导出其独立脚本、参数、输入引用、环境与 validator。
- 比较视图同时显示视觉差异、参数/脚本差异、表格统计差异和科学结论差异。
- 科学差异至少覆盖显著实体数量、关键实体变化、通路排名/方向和受影响下游节点。
- 插件 descriptor 缺少交互或影响元数据时 fail-closed，修复进入插件 SDK 工作，不在 Harness Core 写插件特例。

验收：

- 五条任务都从真实 admitted 插件执行开始，不能直接 seed Revision/ChangeSet/数据库。
- 所有候选产物走 `run_tool → tool_job → artifact truth` 并通过插件 validator。
- 源数据哈希不变；脚本可在 ReplayPackage 中独立重跑并复现采用版本。

### G0-RS-P6：Durability、Recovery、Performance 与产品可解释性

目标：让长时间、多轮结果工作在中断、失败和资源压力下仍可理解、可恢复。

故障矩阵：

- 用户停止、Provider 暂时失败、R 进程失败、validator blocked、应用崩溃、系统重启。
- dirty Git、ref 漂移、SQLite/Artifact/Git 不一致、磁盘不足、内存压力、预览超预算。
- 选择陈旧、候选过期、插件升级、脚本缺失、Artifact 文件外部修改。

交付与验收：

- 每个阶段 checkpoint 可恢复；重开后明确显示停止位置、已保留内容、系统自动处理和下一动作。
- 可逆且不改变科学设计的问题由 Agent 自动修复；科学歧义、不可逆外部影响或缺少输入时才请求用户。
- 真实 10 万行表、复杂 SVG/PNG、长报告和多 Revision 项目满足冻结的交互预算。
- CPU/内存/磁盘/Job 峰值与 Token/cache/cost 以同一任务摘要投影，不把估算冒充精确计量。
- GC 永不删除 current、历史 Revision、可达脚本、采用证据或未终态 ChangeSet。

### G0-RS-P7：Honest Product Requalification

目标：只用真实连续产品旅程重新决定 Result Studio 是否可以成为 supported/qualified 能力。

每条任务必须保存一条脱敏、连续、机器可核对的 trace：

```text
conversation
→ open artifact
→ selection/manual edit
→ Agent context envelope
→ provider tool call
→ ResultEditIntent
→ ChangeSet
→ real Job
→ Artifact Truth + Validator
→ candidate Revision
→ compare
→ adopt/revert
→ restart/reopen
→ replay verification
```

资格矩阵：

- 两个真实 Provider，其中至少一个 OpenAI-compatible；必须真实调用工具，不能复述 Prompt 中给出的 JSON。
- macOS arm64 packaged Electron；开发 renderer 只能作为调试证据。
- 明暗主题，1440px、1024px、820px；每个尺寸必须完成操作，不只是无横向溢出。
- 非 Git、clean Git、dirty Git、任务中断、应用重启、Provider/执行失败恢复。
- 五条 RS-P5 科学任务；至少一条从用户导入数据开始并完成多轮编辑和二次分析。

零容忍：

- 假成功、半采用、源数据覆盖、内部 ID 要求用户填写、选择错绑、历史丢失、无脚本正式结果、隐藏错误、证据常量冒充观测，任一出现即不 qualified。

出口：

- 独立资格器从 trace、数据库、Git、Artifact 和截图/操作事件读取事实，不读取人工“通过”布尔值作为唯一依据。
- `result-studio-editing` 只有在完整矩阵通过后才重新进入 Support Matrix；否则保持 experimental/limited 并列出精确边界。
- 完成时同步本计划、G0 Living Foundation、qualification ledger、UI audit、handoff、next steps 和审计台，并运行 `docs:reconcile`、`docs:check`、根检查、前端检查、真实 Provider 与 packaged-app 门禁。

## 24. 横向工程规范

### 24.1 单一真相与组件边界

- `ProjectWorkspace` 继续负责工作区模式与选择协调；viewer 不持久化自己的第二套 current Revision。
- `desktopBridge.ts` 是 Electron IPC 唯一前端入口；Result Studio HTTP/API client 继续使用既有后端身份和项目隔离。
- Selection、ChangeSet、Revision、Job、Artifact、Loop 均复用既有数据库与服务，不创建平行表或“轻量结果状态”。
- 前端状态只做可丢弃投影；重开后的事实从 SQLite、Git 和 Artifact Truth 重建。

### 24.2 插件与跨平台

- Result Studio 控件由通用 schema/descriptor 驱动，插件独立声明实体映射、editable properties、影响级别和 validator。
- 首批资格范围仍是 macOS arm64 admitted plugins；Windows/Linux/macOS x64 只有独立证据后才能扩张。
- 缺少声明的插件保持只读预览，不因 UI 能显示就冒充可编辑。

### 24.3 UI 与可访问性

- 新 UI 保持无重背景、紧凑层级和渐进披露；不把每个工具调用做成大卡片。
- 公开展示阶段结论、操作和证据摘要，不展示模型隐藏思维链。
- 主操作必须具备键盘路径、清晰焦点、可读状态和非颜色唯一编码。
- 技术字段、Git commit、hash、完整日志放入高级详情，普通视图优先回答“这是什么、是否可信、我能做什么”。

### 24.4 性能预算冻结时点

`G0-RS-P1` 以真实机器采样冻结具体阈值，至少监控：首次主画布可见、Artifact 切换、表格滚动、选择反馈、参数预览、比较打开、重启恢复和内存增长。后续阶段不得用降低数据真实性或截断选择来换取指标。

## 25. 串行顺序、依赖与完成语义

唯一顺序：

```text
G0-RS-P0 Truth Correction
  → G0-RS-P1 Result Surface
  → G0-RS-P2 Scientific Interaction
  → G0-RS-P3 Agent Context
  → G0-RS-P4 Core Unified Editing
  → G0-RS-RH0 Repository Hygiene Gate
  → G0-RS-P4R Product Reframe
  → G0-RS-P5 Real Scientific Editing
  → G0-RS-P6 Durability & UX
  → G0-RS-P7 Requalification
  → 恢复评估 G0-SDC1
```

阶段状态规则：

- 同一时间只有一个 `G0-RS-*` 阶段处于 `in_progress`；`G0-RS-P0`～`G0-RS-P3`、`G0-RS-RH0` 与 P4R-0～P4R-6 已完成；`G0-RS-P5` 已于 2026-07-28 建立 Goal 并处于 `in_progress`。P5 收口前不得启动 P6/P7。
- 每阶段先补失败测试/fixture，再实现，再形成与证据类型匹配的验收；不得提前开发下一阶段。
- 单元测试证明契约，fixture 证明确定性集成，真实 Provider 证明模型边界，packaged Electron 证明产品链；四者不能互相替代。
- 未运行 `npm run docs:reconcile` 与 `npm run docs:check` 不得宣布阶段 completed/verified/qualified。
- `G0-RS-P7` 之前只允许使用 `implemented_unverified`、`in_progress`、`experimental/limited` 等诚实状态。

## 26. 第一阶段交付清单

`G0-RS-P0` 交付结果：

1. [x] 修正 Support Matrix、Baseline Registry/Manifest 与 qualification gate 的 Result Studio 声明。
2. [x] 对 RS9 三类证据和 table seed 建立机器可读 classification/provenance。
3. [x] 冻结 continuous product trace schema 和禁止常量冒充观测的 validator。
4. [x] 回退 UI-102/UI-103/UI-105 状态并登记 UI-106～UI-111 产品增量。
5. [x] 捕获当前真实产品基线，不把截图存在等同于操作通过。
6. [x] 跑专项、G0、文档、UI 和全量测试；根门禁在最终文档收口后复跑。

`G0-RS-P1`～`G0-RS-P3` 已按本节证据收口；`G0-RS-P4 Core` 已形成离线实现检查点但真实候选等价性仍未验证。`G0-RS-RH0` 已完成仓库治理门，P4R 已完整收口，当前 Goal 为 P5；不得提前进入 P6/P7。

`G0-RS-P2` 交付结果：

1. [x] 完整表权威查询、字段类型、排序、过滤、虚拟化、行列选择与 filter/query 全选。
2. [x] point/region/legend 与矩阵 gene/sample 选择；缺 stable mapping 时只读 fail-closed。
3. [x] 单一 SelectionContext 贯通 Canvas、Inspector、Composer、SQLite 恢复和 compatible/stale/invalid。
4. [x] 真实 admitted DESeq2 → 选择物化 → GO/KEGG Job/Artifact Truth 下游链。
5. [x] 10 万行反馈预算、明暗 × 1440/1024/820、服务重启恢复和脱敏机器证据。
6. [x] UI-102/UI-107、canonical 文档、P2 永久门与根级门禁收口；未实现 P3～P7。

`G0-RS-P3` 交付结果：

1. [x] `ResultStudioContextEnvelope v1` 覆盖 project/conversation/artifact/family/job/revision/script/parameters/plugin schema/selection/validation/reproducibility/workflow，并由 `contextToken` 绑定当前身份与选择证据。
2. [x] 坐标全部由后端从 SQLite/`tool_jobs`/插件 descriptor 重新投影；模型可见 schema 中 6 个 `*_in_context` 工具不含任何内部 ID 参数。
3. [x] context-bound plan/create/status/compare/adopt/revert 复用既有 ChangeSet 与 Compare 服务；写操作强制 token 校验，陈旧返回 `context_token_stale`。
4. [x] 公开进度固定五阶段词表，不展示隐藏推理链或 Git 内部细节。
5. [x] context 缺失、选择陈旧、脚本不足、归因只能到 Job 与跨项目 revision 均 fail-closed 并给出可行动修复路径。
6. [x] UI-108 记为 `in_progress`、canonical 文档、P3 永久门与根级门禁收口；未实现 P4～P7。
7. [ ] 双真实 Provider tool calling、真实候选 Revision 与重开重建复验——属 P3 验收剩余项，未完成前保持 `implemented_unverified`。

`G0-RS-P4` 交付结果：

1. [x] 控件全部由 Plugin SDK editable schema 投影，未为任何插件手写孤立结果页；缺 impact 声明的参数不可编辑。
2. [x] 首批控件覆盖配色、字体、尺寸、图例、标签与导出格式，且每个参数都被真实 renderer 脚本消费。
3. [x] 手动控件与 AI Composer 汇合到同一 `normalizeEditSubmission → ResultEditIntent → ScientificChangeSet` 链，validation/preview/compare/adopt/revert 只有一条路径。
4. [x] 执行前展示影响级别与受影响节点；科学与流程参数必须显式确认，纯样式修改不重跑 DESeq2。
5. [x] 未声明参数、越界值与"与现状相同"的提交 fail-closed 拒绝，不产生空 ChangeSet；未知参数保守落到科学重算。
6. [x] 调用方无法把 descriptor 声明的科学或流程参数降级成样式修改；保护字段表只作下限。
7. [x] 面板不写 Artifact、源数据或 current Revision，只发出候选版本请求。
8. [x] UI-109 记为 `in_progress`、canonical 文档、P4 永久门与 umbrella 门禁收口；未实现 P5～P7。
9. [ ] 同一火山图手动与 AI 各生成一次真实候选并比较/恢复——属 P4 验收剩余项，未完成前保持 `implemented_unverified`。

`G0-RS-P4R` 计划交付：

1. [x] P4R-0 捕获真实失败基线、请求 waterfall 与事件循环阻塞，并冻结预算。证据 `rs-p4r-performance.json`（13/13）：基线已冻结为脚本内常量并由 `RS-P4R0-13` 钉住，重跑只写 `currentObservation` 与对比、不覆盖基线；不变量见 `test/p4r-invariants.test.mjs`（7 条核心不变量 + 1 条显式 runtime skip guard，本机 8/8）。分尺寸阈值按 `deferredBudgets` 显式推迟——在快路径存在前采样只会把缺陷固化成标准。
2. [x] P4R-1 按实测边界完成结果快路径。实测推翻计划前提——工作区扫描占 0%、hashing <5%，93% 是每次只读请求都 `bindProjectRepository()` 带来的 git 子进程；因此交付为 memo `detectGitRuntime`、`repositoryState()` 三次 fork 惰性化、`inspectRevisionIntegrity` 的每 revision rev-parse 批量成两次常量开销、只读请求不写 binding，以及客户端次级失败不替换已显示主体。对比冻结基线：changesets 42.102→1.203ms（-97.1%）；workspace-status 因 npm/direct 的 Git spawn 校准相差约 12 倍，不再比较不可比的裸毫秒，改用 6.785→2.040 spawn-equivalents（-69.9%）；每 revision 斜率 20ms→0.18ms（200 revision 由 4179ms 降至 66ms）。证据 `rs-p4r-product-reframe.json`（P4R-1～3 合计 10/10）。原 charter 的相邻版本预取与大文件渐进加载没有可证明收益且未实现，已从本子阶段出口移出，作为 P4R-6 真实性能矩阵出现回归时才重开的优化候选；不得描述为已交付。
3. [x] P4R-2 按 §P4R-2 的代码实况收敛范围完成：主体之上无无条件块且判据进入 `resultFirstScreen.ts`，已有结果 header 显示真实 `vN` 或诚实降级，建立一次只显示一态的容器并只接入真实存在的 `result`，Agent 会话常驻，result↔chat 选择/草稿/滚动/布局保持。`code` 随 P4R-5、`history`/版本选择器随 P4R-4，`compare` 在 P4R-4 前保持不可达；四态齐备从未属于收敛后的 P4R-2 出口。按需结果抽屉未单独新建：现有导航已可收起且 artifact rail 已条件化，未把不存在的重构冒充交付。
4. [x] P4R-3 让自然语言 Agent 成为默认编辑入口，P4 Core 参数面板降为高级精调。实现检查点 `3d3eb29`；性能校准门修复 `59b33c4`；P2/P3/P4/P4R evidence 均 source-bound。安全边界：context-bound create 只接受同一 Agent turn 的受信原始 intent；科学/数据/流程修改在缺少权威持久 DAG 时 fail-closed，不接收模型自带 DAG。
5. [x] P4R-4 完成可直接查看的版本选择器与 Codex-like Change Review；实现检查点 `f710261`。历史主体/interaction/Selection/contextToken 均显式绑定 viewed Revision，首次 GET 不写 SQLite、不创建 managed Git；采用/撤销/恢复 checkpoint 与 SQLite/Git 原子回滚，项目/family/参数/source commit 漂移 fail-closed。P2/P3/P4/P4R 五份 evidence 均 source-bound；UI-113/UI-114 保持 `in_progress`，实机矩阵留 P4R-6。
6. [x] P4R-5 完成具有正式 `sourceScriptRef` 的 ArtifactRevision 精确代码、复制/下载/Agent 解释与修改，并为 `replayable` Revision 提供两阶段受控复现；材料不足明确 `unavailable`。历史脚本、独立/共享 scope、缺失/越界/hash/commit/plugin/input/跨项目漂移全部 fail-closed。DESeq2、standalone volcano、gene-correlation heatmap、go-kegg GO-BP 四类正式 Artifact exact source observation 为 4/4；standalone volcano 真实 replay 只创建非 current 候选且重复确认幂等，不把 4/4 source projection 外推为四类都可 replay。
7. [x] P4R-6 完成真实连续链、性能、明暗/响应式/键盘、异常降级、文档和脱敏 evidence 收口：background 14/14、live Truth 链通过、同一 Electron BrowserWindow 六格矩阵/键盘/失败/重启通过，product 20/20；均为 source-bound non-qualifying evidence。
