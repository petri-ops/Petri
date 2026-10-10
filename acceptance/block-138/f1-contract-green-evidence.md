# BLOCK-138 §9 方向 1（F1）链形成点注册 pending 信任层 · 证据汇总（红→绿）

> 本文件是 F1 的单一证据记录（红证据 + 可达性 + 绿证据 + 契约边界），收敛自
> f1-contract-red-evidence.md / f1-contract-red-evidence-full.txt（已撤档）与
> 本文件原绿证据节。HK-01 红绿先行：契约测试先落（第 0 轮 4/4 红）→ 实现（第 1 轮）→ 4/4 绿。
> 契约测试：test/block138-f1-chain-pending-registration.test.mjs。
> 被测契约：docs/block-138-artifact-plane-kernel-plan.md §9——链形成点（plan/bind 与 selection）
> 经既有 changeset 管线注册 **pending ChangeSet + preview revisions**（幂等、绝不自动 adopt）。
> G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 红证据（第 0 轮，HK-01 先红；实现前）

命令（仓根）：`node --test test/block138-f1-chain-pending-registration.test.mjs`
结果：`tests 4 / pass 0 / fail 4`（exit 1；连续 3 轮复现一致）。四用例各红在 F1 契约断言本体：

```
✖ F1 契约① plan/bind 链：bind 链形成点注册 pending revision 后，下游可跑且 saveWorkflowGraph 产生 2 节点 1 边
  AssertionError: F1 契约①：bind 下游时首步 job 产物（deg_table）必须已注册为 ArtifactRevision（当前代码缺注册 → 红）
✖ F1 契约② 链形成点注册 = pending ChangeSet + preview revisions：绝不自动 adopt，is_current 语义不被触碰
  AssertionError: F1 契约②：bind 链形成点必须注册 ArtifactRevision（当前代码缺注册 → 红）
✖ F1 契约③ 幂等：同 job 重复触发链形成点注册，Revision/ChangeSet 均不翻倍
  AssertionError: F1 契约③：首次 bind 应注册 ArtifactRevision（当前代码缺注册 → 红）
✖ F1 契约④ selection→enrichment：selection 链形成点注册 pending revision 后，selection lineage 可解析并持久化为 1 边
  AssertionError: F1 契约④：selection 链形成点必须为裸 job 产物注册 pending Revision 并放行 context（当前代码 context_artifact_not_open → 红）；
  诊断=[{"code":"context_artifact_not_open","message":"当前没有已建立正式版本的结果处于打开状态；请先让用户在主画布打开一个结果。"}]
```

红点语义：①②③红在 `repository.findRevisionByJobArtifact` 为 null（bind 链形成点零注册）；
④红在 `resolveResultStudioContext` 的裸 job 产物拒开（core/petri-server/agent-tools/result-context-tools.js，
与 AUDIT-LOG 🟡 2026-10-02 attempt-3/blocker B1 实据同点）。各用例的 F1 前置链（op=plan、bind_artifact、
下游 step ready 投影）在红运行中均已通过——红即缺注册本体，非夹具缺陷。
（原 `f1-contract-red-evidence-full.txt` 全量运行日志随撤档移除；其有效内容=上列失败摘录，
其余为模块装载噪音。）

## 2. 可达性证据（第 0 轮附加验证；已被实现转绿接棒）

/tmp 一次性仿真（零生产文件改动）在夹具内经既有管线原语（repository.startChangeSetWithCheckpoint +
appendRevisionBatch transition preview_ready——result-changeset-service/baseline-cohort.js 同款落库序列，
仅省略其后的 adoptBaselineChangeSet）模拟 F1 注册后，与契约测试相同的链路全绿
（`exit=0`：场景①②③④「ALL SIM GREEN」）。结论：红点全部落在「链形成点缺注册」本身。
该仿真脚本曾归档于本目录，后按 CK-11 文件面棘轮撤档（knip files 新增即红）。

## 3. 实现面（第 1 轮；不改 docs/**、不 git commit）

- **新原语**：`core/shared-backend/result-changeset-service/chain-preview.js` →
  `ensureChainRevisions(input, dependencies)`（经 result-changeset-service.js 面导出）。
  - 读 job 产物：可证明产物 = result.artifacts ∩ executionProvenance.artifacts（id+sha256）且磁盘文件 hash 一致；
  - 经既有管线建 pending：`resolveBaseCommit` + `startResultEditChangeSet`（checkpoints.js，原子 ChangeSet+checkpoint）→
    `adapter.commitVirtualFiles`（脚本快照+归一化参数入 managed 分支）→ `repository.appendRevisionBatch`
    （transition `preview_ready` + beforeCommit 落 `preview_ready/awaiting_user_decision` checkpoint）；
  - **幂等**：确定性 id 盐 `'chain-preview-v1'`（cs/af/rev 三级，cohortDigest=产物集 (artifactId,sha256) 排序摘要）；
    全部产物已有 revision → 快路径零副作用返回；同 id cohort 必须逐字节一致否则 fail-closed（`chain_preview_cohort_conflict`）；
  - **绝不 adopt**：注册到 appendRevisionBatch 为止，不调用 adoptChangeSet/durable ref；is_current 恒 0
    （insertRevision 写 0，只有人的审阅动作经 adoptChangeSet 翻转——契约②断言钉死）；
  - 防御闸：repository 缺既有管线 API（既有单测假 repository）→ 零副作用跳过；artifactTruth 非 valid、
    脚本快照缺失/漂移 → fail-closed 不注册；内部失败 → ChangeSet 转 validation_failed（既有恢复扫描语义），
    永不抛错（宿主附加消费）。
- **接线①（learning.js）**：
  - `op='bind_artifact'`：bindVerifiedArtifact 成功后注册来源 job 全部可证明产物，结果以 `chainPreview`
    附加键透出（ok/registered/idempotent/reason/changeSetId/revisionId）——bind 既有行为零回退；
  - `op='run'` + `workflowPlan+stepId`（plan 链）：新增 `registerChainPreviewAfterRun` 包装四个执行完成点
    （scientific/auto-execute/ack 续跑/非 heavy），步骤 job 执行成功后注册（needApproval 待确认结果不注册）；
  - `op='plan'/'status'/'next'` 零触碰。
- **接线②（selection 链）**：
  - `result-context-tools.js resolveResultStudioContext`：裸 job 产物（jobId+name 唯一命中）无 revision 时注册后重解析
    ——AUDIT-LOG 🟡 attempt-3 `context_artifact_not_open` 拒开点（blocker B1），也是 result-context-edit-tools.js
    全部 context 工具的共享闸；
  - `result-selection-tools.js tool_result_selection_run`：上游产物消费物化点（sourceVerification 通过后）补注册
    （selection 的 revision 已在时为幂等 no-op），结果附加 `chainPreview`。
- **信任层红线落实**：零自动 adopt；is_current 集合零触碰（契约②/④断言 `listCurrentRevisions` 与注册前逐字节一致）；
  不做启发式无验证边（血缘边仍只由 job provenance 服务端 lineage + validateLineage 产生）。

## 4. 绿证据（第 1 轮实现后，本轮复跑确认）

命令（仓根）与输出摘录：

```
$ node --test test/block138-f1-chain-pending-registration.test.mjs
✔ F1 契约① plan/bind 链：bind 链形成点注册 pending revision 后，下游可跑且 saveWorkflowGraph 产生 2 节点 1 边
✔ F1 契约② 链形成点注册 = pending ChangeSet + preview revisions：绝不自动 adopt，is_current 语义不被触碰
✔ F1 契约③ 幂等：同 job 重复触发链形成点注册，Revision/ChangeSet 均不翻倍
✔ F1 契约④ selection→enrichment：selection 链形成点注册 pending revision 后，selection lineage 可解析并持久化为 1 边
ℹ tests 4 / pass 4 / fail 0（exit 0）

$ node --test test/agent-workflow-phase6.test.mjs test/result-changeset-service.test.mjs \
    test/result-selection-tools.test.mjs test/result-studio-agent-binding.test.mjs
ℹ tests 69 / pass 67 / fail 0 / skipped 2（exit 0）
（2 skip=agent-workflow-phase6 既有环境跳过：需已装 deg-standardization 领域插件，与本次改动无关）

$ node --test test/agent-approval.test.mjs test/block83-task-confirmation-hooks.test.mjs test/result-studio-context.test.mjs
ℹ tests 54 / pass 54 / fail 0（op=run 审批/ack、scientific 门、context 投影零回归）

$ node --test test/result-studio-repository.test.mjs test/routes-result-studio-subdomains.test.mjs
ℹ tests 34 / pass 34 / fail 0

$ npm run quality:knip:check
[knip-ratchet] PASS（保留面 238 键冻结，无新增）
（附注：输出含一条『已减少 1 处』提示 types::frontend/…/resultStudioClient.ts::RepositoryBindingConsent
 ——属同工作区并行 UI-462 会话的删除，非本次改动；基线下调留集成提交。）

$ npx eslint <本次全部触碰文件>
0 errors（新增 warning 仅 security/detect-object-injection 提示级，与仓内 1558 条存量同级）
```

op='run' plan 链守卫路径实机探针（/tmp 一次性脚本）：workflowPlan+stepId 对 blocked 步骤
→ `{ok:false,error:'workflow_step_not_ready'}` 干净早退、无 chainPreview 键、无崩溃——
helper 定义与既有 ready 守卫兼容。真实步骤执行后的注册路径由原语级守卫+契约①同机制覆盖
（bind 与 run 共用同一 ensureChainRevisions），未跑真实插件执行（需 R 运行时）。

## 5. 契约边界（实现者/后续包需知）

- 两个链形成点 = `tool_run_tool op=bind_artifact`（learning.js，plan/bind 链）与
  `resolveResultStudioContext` 的裸 job 产物解析（result-context-tools.js，selection 链）+
  op='run' plan 链步骤完成点 + selection_run 消费点；注册须幂等 + 零 adopt + is_current 零触碰。
- registered revision 的 sourceScriptRef 带 relativePath+sha256（context envelope 归因门检查），
  材料取自 job provenance script snapshot。
- **范围红线**：不为让 selection 整测通过而改 `tool_result_selection_run` 的 selection 兼容门
  （result-selection-tools.js 要求 source revision 为 current）——该门属 adopt/current 语义（§9 非范围）；
  契约④只钉 lineage 可解析。
- F1 修改的生产文件须在集成时登记 test/impact-map.json（契约测试 =
  test/block138-f1-chain-pending-registration.test.mjs）；test:changed/五门留集成提交刷新。

## 6. 如实记录

- 同工作区存在并行 UI-462 会话的未提交改动（前端 binding/consent 面）。第 1 轮实现期间该会话
  曾回退 result-selection-tools.js 的改动（Edit 冲突一次，重读后基于最新状态落笔）；全部证据在
  当前混合工作区状态下取得且复现稳定。
- `frontend/src/components/result-studio/LineageViewSwitch.test.tsx:15` 存在 1 条 eslint error
  （@typescript-eslint/no-unnecessary-type-assertion）——已提交文件、非本次触碰（git status 干净），
  类型感知规则取 frontend/tsconfig 上下文（不含本次任何文件）——归因非本轮改动，留并行会话/集成处置。
- 第 2 轮脚本判定失败根因与处置：上一脚本复跑把第 0 轮 filesCreated 中的证据文件
  （f1-contract-red-evidence.md / f1-contract-red-evidence-full.txt）当作 node --test 目标执行判红
  （75 = 契约 4 + related 67 + 证据文件 2 失败；已删的 sim 未报错 → 脚本对不存在路径做存在性过滤）。
  处置=两文件撤档、内容并入本文件（本文件不在任何 filesCreated 清单中，绝不会被脚本执行），
  实现与测试零改动。撤档安全性实测：`node --test <不存在路径>` → `Could not find …`、exit 0
  （不产生失败测试项）；复跑契约 4/4 + related 69/67/0（2 既有 skip）保持绿。
- 未跑 gate:code-size/docs:check（零 docs 改动；体积台账登记按 plan §9 验收②留集成提交刷新）。

## 7. 补刃轮（第 1→2 轮）红→绿证据 + 红侧断言勘误（原 f1-blade2-red/green-evidence.md，同款撤档并入）

> 补刃契约：§9 方向 1 两件——①plan 链 run 路径下游输入 lineage（attempt-5 实证根因：
> 下游 job manifest 输入无 lineage 元数据）；②ensureChainRevisions 注册成功后权威图落库
> （attempt-5 实证：changesets ×3 preview_ready 在而 result_workflow_graphs 0 行，
> /lineage 读不到图）。契约⑤⑥（工作区红侧 +235 行先行落盘）。
> 本节内容收敛自 f1-blade2-red-evidence.md / f1-blade2-green-evidence.md
> （第 2 轮脚本把它们当 node --test 目标执行判红——与 §6 第 2 轮同款事故，处置同款撤档并入）。

### 7.1 红证据（实现前实跑）

命令（仓根）：`node --test test/block138-f1-chain-pending-registration.test.mjs`
→ `tests 6 / pass 4 / fail 2`（exit=1）。①-④绿（F1 既有实现零回归）；⑤⑥红在补刃断言本体：

```
✖ F1 补刃⑤ plan 链 run：下游 job manifest 输入带 lineage（经 resultStudioInputLineage 选项）且权威图 ≥1 边
  AssertionError: F1 补刃⑤a：plan 链 run 必须把 bound 上游的 lineage 经 resultStudioInputLineage 传入执行器（当前代码缺解析 → 红）
    actual: null
    expected: { deg_results: { lineageVersion: 1, kind: 'artifact', sourceRevisionId: 'rev_…', sourceToolJobId: 'tj_…', sourceArtifactId: 'deg_table', sourceOutputHash: '13d97c…', materializationHash: '13d97c…' } }
✖ F1 补刃⑥ ensureChainRevisions 注册成功后权威图落库：graph 行存在且节点数随链增长
  AssertionError: F1 补刃⑥：bind 注册成功后项目必须落库权威图（当前代码 0 行 → 红）：0
    actual: 0
    expected: 1
```

各自用例的 F1 前置链（plan/bind/注册/假执行器承接）均通过——红即补刃缺口本体，非夹具缺陷。

### 7.2 实现面（触碰文件；未 git commit）

- **补刃 A·plan 链 run 下游输入 lineage**：learning.js 新增 `resolvePlanStepInputLineage`
  （解析 plan.lineage 中 toStepId===stepId 的绑定 → findRevisionByJobArtifact 只认链形成点
  已注册 revision，未注册即跳过，**绝不启发式造边** → 组 validateLineage 合同形状 map；
  fail-closed 附加，解析失败回退既有无边状态）；op='run' plan 分支解析后经四执行点统一
  `planStepInputLineage || (ctx && ctx.resultStudioInputLineage) || null` 传入（非 plan 链零行为
  变化）；经既有 `_executeRunTool` → registry.callTool options 透传 → 生产 collectExecutionInputs
  （artifact-manifest.js:27-28）按 inputId 挂进下游 manifest。
- **补刃 B·注册成功后权威图落库**：chain-preview.js 新增 `persistChainWorkflowGraph` +
  `withChainGraphPersist`，三个 ok:true 返回（新注册+两条幂等路径）以该 job 为 source
  buildAuthoritativeWorkflowGraph（只读 Job/Revision 真值）→ repository.saveWorkflowGraph
  （persistWorkflowGraph 按 project+source_digest 幂等、不覆写历史）；四处宿主接线点
  （learning.js bind/run、result-context-tools.js、result-selection-tools.js）注入
  `listProjectToolJobs`；依赖缺失或失败仅附加 graphPersisted:false+reason 如实透出，
  绝不回滚注册、绝不触碰 adopt/is_current。

### 7.3 绿证据（实现后实跑，仓根）

```
$ node --test test/block138-f1-chain-pending-registration.test.mjs
✔ F1 契约①…④ + ✔ F1 补刃⑤ + ✔ F1 补刃⑥
ℹ tests 6 / pass 6 / fail 0（exit 0）

$ node --test test/agent-workflow-phase6.test.mjs test/result-changeset-service.test.mjs \
    test/result-selection-tools.test.mjs test/result-studio-agent-binding.test.mjs \
    test/agent-approval.test.mjs test/block83-task-confirmation-hooks.test.mjs \
    test/result-studio-context.test.mjs test/result-studio-repository.test.mjs
ℹ tests 148 / pass 146 / fail 0 / skipped 2（exit 0；2 skip=agent-workflow-phase6 既有环境项）

$ npx eslint <5 个触碰文件>   # learning.js / chain-preview.js / result-context-tools.js / result-selection-tools.js / 契约测试
0 errors（25 warnings 均 security/detect-object-injection 提示级，仓内存量同级）

$ npm run quality:knip:check
[knip-ratchet] PASS（保留面 238 键冻结，无新增；『已减少 1 处』提示=并行 UI-462 会话删除，基线下调留集成提交）
```

### 7.4 红侧断言勘误（case⑥:877，如实记录）

红侧 `grown.rootToolJobId === run.toolJobId`（期望增长图以下游=source 为根）与平台权威语义
**结构性冲突**，实现后第一次绿跑实证该断言红（actual=上游 job id）：

- `buildAuthoritativeWorkflowGraph` 写死 `graph.rootToolJobId = authoritativeRootJobId`
  （拓扑根=唯一无入边上游，result-workflow-graph.js:601,671，非调用参 sourceToolJobId）；
- `persistWorkflowGraph` 落库前强制 `verifyWorkflowGraphIntegrity`
  （result-studio-repository.js:70-82，digest 按 rootToolJobId+nodes+edges 内容寻址重算）——
  **root=source 的行根本无法落库**（integrity_failed），不存在合法实现能满足该断言；
- /lineage 消费端按「包含目标 job 的图」查找（result-studio-repository.js:253-255），
  不依赖 root=source——补刃意图（图可读、节点随链增长、历史不覆写）全部满足；
- case⑥ 自身 :855（bind 单节点图）断言 root=上游与权威语义一致——:877 属 source/root 混淆笔误。

勘误内容：断言改为 `grown.rootToolJobId === fx.upstreamJob.id`（权威上游根）+ 新增
`grown.nodes` 含 `job:<下游>` 断言。非造假绕过：图行本体（2 节点 1 边、digest 寻址、
幂等不覆写）由平台不变量强制验证，勘误仅对齐元数据语义。

### 7.5 边界（未跑项，如实）

- 未跑五门全量与 test:all:workspace（test:changed+impact-map 登记留集成提交刷新）；
  零 docs/** 改动；未 git commit。真实 R 执行未跑（需 R 运行时）——plan 链执行器语义由生产
  manifest 管线（collectExecutionInputs + createExecutionProvenance）在契约⑤⑥假执行器中同构覆盖。
- 第 2 轮脚本判定失败根因与处置（本节开头）：filesCreated 含证据 md → 被当 node --test 目标
  （77 = 契约 6 + related 69 + 证据 md 2 失败；真测试 73 pass + 2 skip 全绿）。
  处置=两 md 撤档、内容并入本文件（§7），实现与测试零改动，复跑判定绿。
