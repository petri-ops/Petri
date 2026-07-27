# G0-CHF0：Critical Cross-cutting Hardening

最后更新：2026-07-27

状态：`active / audit_repair`（2026-07-27 复核撤销首次 completed 结论；当前阶段 `CHF0-R1 Contract & failing tests`）

Plan ID：`G0-CHF0`

## 1. 决策与定位

`G0-CHF0` 是经用户批准插入 `G0-RS-P4R-2` 与 `G0-RS-P4R-3` 之间的独立横切修复工作包。它处理全项目审计中改动边界相对集中、但可能造成本机代码执行、敏感文件泄露、错误科研结论或真实长分析失败的硬伤。

Result Studio 的既有实现与证据不回退；`G0-RS-P4R-3` 在本工作包收口前暂停，不并行修改其 UI。`G0-CHF0` 完成后，当前工作包归还 `G0-RS` 并从 P4R-3 继续。

范围输入为 [`project-wide-audit-2026-07.md`](./project-wide-audit-2026-07.md)。该审计是问题依据，不是验收证据。

首次收口结论已于 2026-07-27 的运行时反例复核中撤销：volcano 会把 `padj` 错标为 `pvalue` 且显式裸 `pvalue` 路径崩溃；PCA 接受表达矩阵重复/空 sample ID；Node 自刷 heartbeat 不能证明子进程活性；终止 helper 会在 `kill()` 返回 false 时虚报成功；专项 acceptance 未逐项覆盖计划验收且引用 amend 前的不可达提交。`G0-RS-P4R-3` 因单工作包串行纪律暂停，待本工作包重新真实收口后恢复。

## 2. 必须修复的范围

### CHF0-A：本地 HTTP 执行与文件边界

1. `SEC-1 / BE-1`：R/Python 两个 `POST /api/run` 入口不再接受任意跨源网页请求后以本地管理员身份直接执行代码；执行必须具有明确、可测试的受信来源边界，并且正式科学执行不得绕过 `run_tool → tool_job → artifact truth`。
2. 不用可绕过的 R 函数黑名单冒充沙箱；若旧 FigCode/Playground 兼容入口不能安全映射到正式工具链，则 fail-closed 停用执行而保留浏览/复制能力。
3. `SEC-2`：`/api/files/:key` 必须使用现有路径安全原语，拒绝绝对路径、编码/未编码 `..`、symlink 与结果根逃逸；响应不得对任意网页开放跨源读取。

### CHF0-B：三条最高优先级科学正确性

1. `SCI-1`：火山图默认用校正后显著性列 `padj`；`pval_col` 属科学参数。缺少所选列、列非数值或校正值不可用时 fail-closed，不静默换回裸 p 值。标签、坐标轴和输出字段必须诚实表达实际统计量。
2. `SCI-2`：PCA 缺少分组文件时不得按样本顺序伪造 A/B 分组；必须使用明确的未分组投影或阻断需要分组语义的输出。
3. `SCI-3`：PCA 分组信息必须通过稳定 sample ID 对齐；缺少 sample ID、重复 ID、缺失或多余样本不得按位置贴标签。

### CHF0-C：长任务与进程终态

1. `UX-2`：正式工具执行不再以固定 5 分钟墙钟时间把健康长分析判失败；超时策略必须区分最大运行预算与活性/心跳。
2. `BE-5`：zombie recovery 不得只改数据库状态。进程仍存活时必须尝试终止；主动取消与超时使用 `SIGTERM → 有界等待 → SIGKILL` 升级，并记录真实终止结果。
3. 恢复不得误杀 PID 已复用的无关进程；无法证明进程归属时 fail-closed 记录诊断，不发送信号。

## 3. 明确不在范围内

- 不实施 P4R-3～P4R-6 的 UI、版本、代码视图或重新资格工作。
- 不一次性修复横切审计中的其余 SCI-4～SCI-14、SEC-3～SEC-8、FE/GOV 条目。
- 不建立第二套 executor、Job、Artifact Truth、进程表或科学参数系统。
- 不改变 G0、Result Studio 或平台的 qualified/maintained/verified 声明。
- 不做发布、签名、公证、Provider 或 packaged Electron 验收。

## 4. 串行阶段

1. `CHF0-0 Contract & failing tests`：为安全路径、三条科学错误和进程终态建立失败测试与兼容调用清单。
2. `CHF0-1 HTTP boundary`：修复 `/api/run`、CORS/来源边界与 `/api/files`。
3. `CHF0-2 Scientific correctness`：修复 volcano 与 PCA 三条错误，更新插件 descriptor/fixture。
4. `CHF0-3 Long-task lifecycle`：修复预算、心跳、取消和 zombie 终止。
5. `CHF0-4 Acceptance & handoff`：完成定向验收、文档/UI 门、审计处置和 P4R-3 恢复。

同一时间只推进一个 CHF0 子阶段。

### 4.1 审计修复阶段（CHF0-R）

1. `CHF0-R1 Contract & failing tests`：把已复现的科学、进程、HTTP 与 evidence 反例写成逐契约失败测试。
2. `CHF0-R2 Scientific truth`：修复 volcano 统计量/输出/报告契约与 PCA sample-ID 完整性、descriptor。
3. `CHF0-R3 Process and HTTP truth`：建立子进程可观测活性、真实 TERM→KILL 终态、取消/超时/恢复诊断及明确桌面来源边界。
4. `CHF0-R4 Acceptance`：每个 check 绑定独立测试结果、当前可达 source commit 与完整 source/producer hashes。
5. `CHF0-R5 Closeout`：运行影响范围、专项、docs/UI 门与 reconcile；只有全部绿后再次完成并恢复 P4R-3。

## 5. 验收与证据

最低验收：

- 恶意 Origin、无受信桌面标识及 R 黑名单绕过样例不能触发 `/api/run` 本地执行；受支持兼容路径有明确结果或明确停用诊断。
- `/api/files` 对编码/未编码 traversal、绝对路径和 symlink 逃逸全部拒绝，合法结果对象仍可读取。
- volcano 默认与显式 `padj` 产生一致分类；显式裸 `pvalue` 被标记为科学变化且不能由默认路径静默采用；缺列/坏列失败。
- PCA 无分组时不出现伪造 A/B；乱序 metadata 按 ID 正确对齐；缺 ID、重复、缺失和多余样本有确定性处理。
- 长任务测试证明健康任务不会在旧 5 分钟边界被杀；取消/超时证明 TERM、升级 KILL、数据库终态与诊断一致；PID 归属不明不发信号。
- 运行 `npm run test:changed:list` 可复现影响范围，随后运行受影响定向测试、`npm run docs:check` 与 `npm run ui:audit:check`。

证据写入 `acceptance/g0-critical-crosscut-hardening/`，保持 `qualificationEligible:false`。只有全部阶段和门禁真实通过后才能把本工作包标为 `completed`。

## 6. 收口语义

收口时：

1. 更新本计划、`AUDIT-LOG.md`、next steps、handoff 与 registry。
2. 运行 `npm run docs:reconcile` 并审阅候选，再运行 docs/UI 门。
3. `G0-CHF0` 改为 `completed / canonical:false`，`G0-RS` 恢复为当前 canonical 工作包，当前阶段恢复为 P4R-3。
4. 如任何子范围无法达到上述验收，不得用“风险降低”冒充完成；保留 active 状态和明确阻塞证据。
