# 审计广播台 (AUDIT-LOG)

> **本文件是非主线 agent（审计/辅助 agent）向主 agent 广播发现的唯一入口。**
> 主 agent 每次会话开始时，**必须先读本文件**，处理其中 🔴 阻塞项和 🟢 待合并项，再开始主线工作。
> 非主 agent 每次完成审计后，必须把发现追加到本文件并提交，不要只写在单独报告里。
>
> 维护方：非主 agent（只读审计 + 阻断性回归修复通道）
> 最后更新：2026-07-24（G0 第一波 LF1/LF2 收口）

---

## 当前待处理项（主 agent 请优先看这里）

| 状态 | 日期 | 发现 | 来源 | 详情 |
|------|------|------|------|------|
| ✅已处理 | 2026-07-17 | Stage 3 M1: R_LIBS_USER 组装逻辑抽到 `shared-backend/r-libs-resolver.js`，两处调用共用 | 本文件 §3 | [§3 问题 A](#问题-a代码重复r-libs-user-组装逻辑) |
| ✅已处理 | 2026-07-17 | Stage 3 M1: 两处 `catch {}` 静默吞掉所有错误，调试困难 | 本文件 §3 | [§3 问题 B](#问题-b静默-catch-吞掉所有错误) |
| 🟡建议 | 2026-07-17 | Stage 3 M1: `capability-provisioning.js` 的 defaultDownload 未复用 plugin-manager 且无 host 白名单 | 本文件 §3 | [§3 问题 C](#问题-cdefaultdownload-未复用-plugin-manager) |
| ✅已处理 | 2026-07-18 | Stage 3 M1: `capability-provisioning` 加 host 白名单（https-only + 精确/后缀匹配 + env 覆盖），下载前 gate；顺带纠正设计文档失实描述（plugin-manager 从无 host 白名单） | 本文件 §4 | [§4 问题 D](#问题-ddefaultdownload-缺少-host-白名单) |
| ✅已处理 | 2026-07-17 | `fix/qa-smoke-stale-css-paths` 已合并，themes 门禁恢复 7/7 | 分支备忘录 | [§2.1](#21-fixqa-smoke-stale-css-paths-) |
| 🟡待评估 | 2026-07-17 | `codex/fix-collapsed-right-titlebar` 分支待评估，三文件两边改过 | 分支备忘录 | [§2.2](#22-codexfix-collapsed-right-titlebar-) |
| ✅已处理 | 2026-07-24 | G0-START 10/10 与 G0-LF0 10/10 建立：机器可读 Constitution、Baseline Manifest/Registry、Support Matrix 和治理词汇落地；项目持久记录创建/打开 baseline、manifest/bundle 摘要，legacy 显式采用，未来主版本或同版本摘要冲突保持可读但阻断正式写入；API/前端投影及永久根门禁均有脱敏证据。G0 仍为 establishing/not_yet_qualified。 | G0-LF0 / P-01～P-07 | `core/shared-backend/g0/`, `g0-baseline.js`, `project_g0_baselines`, `acceptance/g0-living-foundation/` |
| ✅已处理 | 2026-07-24 | G0 第一波完成：LF1 五层 Truth Projection 已接入 Workflow/Delivery，Presentation 不得提升上游真相；LF2 为 13 类对象和 10 类故障建立恢复契约、项目导出校验与 append-only 审计；LF7/LF8 第一波供应链和权限基础契约落地。基线兼容升级为 0.2.0，仍为 establishing/not_yet_qualified。 | G0-LF1 / G0-LF2 / LF7-LF8 foundation | `g0-truth-projection.js`, `g0-durable-state.js`, `acceptance/g0-living-foundation/g0-first-wave-acceptance.json` |
| ✅已处理 | 2026-07-17 | 5 个 codex/* 已合并残留分支已删除（连带 prune 6 个失效 worktree 注册） | 分支备忘录 | [§2.3](#23-已合并残留分支可安全删除-) |
| ✅已处理 | 2026-07-17 | `sanitizer.js` 死模块 + 其测试已删除（全仓零生产引用） | 本文件 §4 | [§4 问题 E](#问题-esanitizerjs-死模块) |
| ✅已处理 | 2026-07-17 | `core/test/` 门禁盲区已收口：3 个单测迁入 `test/*.test.mjs`，死模块测试删除，4 个联网 smoke 保留在 core/test/ | 本文件 §4 | [§4 问题 F](#问题-fcoretest-目录不在门禁范围) |
| ✅已处理 | 2026-07-17 | `project-run-layout.js` isAdmin 硬编码 → 实现为 `db.getUserById().role === 'admin'`（与 api-data/feedback 一致） | 本文件 §4 | [§4 问题 G](#问题-gproject-run-layoutjs-isadmin-硬编码) |
| ✅已处理 | 2026-07-18 | Stage 3 B2: `provisionCapability` 写好但未接入任何真实运行路径（无执行器/readiness gate 调用它，`r-libs-resolver` 只查已装不触发下载）——文档说有、实际没有 → B2 part2 已接进 tools-executor/registry 运行路径 | 本文件 §5 | [§5 问题 H](#问题-hprovisioncapability-未接入任何真实运行路径) |
| ✅已处理 | 2026-07-19 | Stage 4: 开发 migration 使用系统 Node 却加载 electron-builder 留下的 Electron ABI `better-sqlite3`，导致首次启动和全量测试不干净 | 本文件 §6 | [§6 问题 I](#问题-istage-4-migration-原生模块-abi-边界错误) |
| ✅已处理 | 2026-07-19 | Stage 4: Runtime 首装被线上旧 manifest 覆盖，且内置清单缺校验描述符、安装包缺 R 路径修复脚本 | 本文件 §6 | [§6 问题 J](#问题-jruntime-首装契约不完整) |
| ✅已处理 | 2026-07-19 | Stage 4: 诊断导出范围过宽且原始日志未脱敏，可能携带用户数据 | 本文件 §6 | [§6 问题 K](#问题-k诊断导出隐私边界过宽) |
| ✅已处理 | 2026-07-19 | Stage 4: DESeq2 可产生科学文件却缺必需 ZIP/报告模板，golden-path 曾用补救逻辑掩盖失败 | 本文件 §6 | [§6 问题 L](#问题-ldeseq2-首次成功产物契约不完整) |
| ✅已处理 | 2026-07-21 | rc.7: `diagnostic-redaction.js` 在打包态仍从 app.asar 相邻目录解析 `core/`，主进程启动即报模块缺失 | rc.7 安装候选实机 | 已改为 `Resources/core/shared-backend/redaction.js`，补开发/打包双路径回归并完成安装启动验证 |
| ✅已处理 | 2026-07-24 | HLE-C4R/HLE-C5 已完成生产收口：历史/终态/恢复/active-background/token-cost 均由 SQLite 投影；真实 SPT-1 正常 7 节点、可修复、科学阻断三轨，双 Provider、应用重启及明暗/820px/停止恢复视觉矩阵均已形成脱敏证据。 | 生产收口计划 | [`harness-loop-production-closure-plan.md`](./harness-loop-production-closure-plan.md) HLE-C4~C5 |
| ✅已处理 | 2026-07-24 | ReplayPackage 取最新 checkpoint 时会把共表的 Loop iteration checkpoint 当成 ContextCheckpoint，导致真实交付回放报 `replay_package_context_checkpoint_invalid`。现按 ContextCheckpoint 契约从新到旧选择兼容记录；显式指定不兼容记录时诚实返回 422，并补回归。 | HRT-6 / HLE-C5 | `scientific-replay-package.js`, `routes/harness.js`, `scientific-replay-package.test.mjs` |
| ✅已处理 | 2026-07-24 | 全量插件 schema 在 ToolResult 投影中截断，模型看不到后部插件 ID 后会猜测名称；现 `run_tool(op=list)` 返回完整紧凑目录，`op=list, toolId=...)` 返回单工具精确契约，unknown 也返回真实 ID 列表。真实正常轨据此稳定完成 go-kegg 与 gsea。 | P-03 / P-04 / HLE-C5 | `agent-tools/learning.js`, `agent-tools/tool-defs.js`, `agent-approval.test.mjs` |
| ✅已处理 | 2026-07-24 | 双 Provider 工作区复验发现 full access 下模型可把 `sudo` 直接交给 shell，产生系统密码提示；同类 `rm`、`git push`、远程脚本管道也不应成为无提示副作用。现保留通用 shell 能力，但在 handler/preflight 共用 verdict 中稳定拒绝这四类不可协商风险，返回明确 `command_blocked`，不再回退到旧 allowlist。 | P-02 / P-03 / HLE-C5 | `workspace-tools.js`, `tool-defs.js`, `harness-workspace-tools.test.mjs` |
| ✅已处理 | 2026-07-24 | 生产可修复轨的 failed parent 与 completed replacement 已存在，但未知故障没有可选 RepairStrategy 时 checkpoint 不记录替换链；同时 `EVIDENCE_KINDS` 数组被误当枚举对象，`undefined` kind 触发的异常又被保护性 catch 吞掉，导致 LoopEvidence 恒为 0。现对已验证的同工具 replacement 生成 `observed_same_tool_replacement` lineage，统一构造合法 observation evidence；生产证据采集同时按明确 TaskEvent 绑定 Loop，不再被同会话后续普通聊天污染。真实重跑已写入 parent/replacement checkpoint 与 2 条 LoopEvidence。 | P-03 / HLE-C5 | `agent-runner.js`, `harness-loop-production-acceptance.mjs`, `loop-agent-integration.test.mjs` |
| ✅已处理 | 2026-07-24 | 真实 Desktop 启动发现 Loop API 被 legacy `/api/loop/:loopRunId` 路由吞掉、desktop-local 只注入 `req.user` 导致 401、无 assistant 消息的历史会话不展示已恢复 Loop。现将 bounded AI Loop API 前置注册、统一归一化 `req.user.id`，并为无 assistant 历史提供独立 LoopStatusPanel；新增生产注册顺序与桌面身份回归。 | HLE-C4R / UI-101 | `routes/index.js`, `routes/ai-loop.js`, `SimpleChat.tsx`, `loop-api-route.test.mjs` |
| ✅已处理 | 2026-07-24 | Provider 人工验收工具不识别产品已支持的通用 OpenAI-compatible Profile，双 Provider 验收只能依赖固定 DeepSeek/Anthropic 环境变量；控制台还会打印自定义 endpoint/model。现增加 `openai-compatible` 目标（key/base URL/model 三字段齐备才启用），日志只显示目标/协议，报告保持脱敏。 | P-07 / HLE-C5 | `scripts/harness-provider-eval.mjs`, `test/harness-provider-eval.test.mjs` |
| ✅已处理 | 2026-07-24 | 真实 Bulk RNA 主轨生成最终答案后，Loop 收口从 `loop-contract` 错误解构 `deriveObservedStateDigest`，异常又被已有 assistant 正文掩盖：task=completed、Loop=running、iterations=0。现改从 Loop Controller 导入并启动即校验依赖；真实 state digest 纳入 Job/进度事实；模型终答只有在 Loop 收口成功后才发 done；任何 post-processing fatal error 优先标 task/Loop failed，不能由文本长度升级成功。 | P-03 / HLE-C5 | `agent-runner.js`, `loop-agent-integration.test.mjs` |
| ✅已处理 | 2026-07-24 | Loop 原注释要求“首次 run_tool 才惰性创建、每个 Agent turn 持久化”，生产却在所有 execution-capable 消息首轮即创建且只在整轮结束落一次 iteration：普通问答会误建 Loop，长任务崩溃前无 durable 阶段。现改为首次 `run_tool`（含 plan/blocked preflight）才建 Loop，每个工具批次立即落公开结论、Job 状态、hash chain 与 checkpoint；终答再落终态 iteration。失败 Job 被同工具后续 completed Job 修复时保留 parent/replacement lineage，不因旧失败产物阻断新验证结果。 | P-03 / HLE-C4R~C5 | `agent-runner.js` |
| ✅已处理 | 2026-07-24 | 真实 SPT-1 主轨中 sample metadata validator 对大小写不兼容，Agent 用 `workspace_replace` 原地修改项目 `metadata.csv` 以迎合插件，违反源数据不可变与 repair lineage。任务已主动取消，Loop/阶段/Job 保留；原始 metadata 按既有 Job 输入副本恢复并校验回原 SHA-256。工具策略现拒绝覆盖/替换已有科学数据文件，要求写 `derived/`/`results/`；系统提示同步禁止通过 exec 绕过。 | P-03 / HLE-C5 | `agent-tool-policy.js`, `agent-runner.js`, `agent-tool-policy.test.mjs` |
| ✅已处理 | 2026-07-23 | HLE-C3R 耐久恢复收口：`_loopInit` 改为先 `getActiveLoopRunForConversation` 复用同会话未终结 LoopRun（planned/running）并重建内存 iteration 链，不再每轮新建；server-restart 标为 failed(recovery_required) 的 run 被排除、只经恢复 API 暴露不静默复用。新增 `db.getActiveLoopRunForConversation` 与 `db.listLoopActions`（修复此前空转的 `/api/loop/actions`）。checkpoint-on-success 接线：每轮 `buildIterationCheckpoint→saveContextCheckpoint`，聊天摘要不再是 loop 状态唯一副本，ContextEnvelope 可从持久化 checkpoint 重建（模型切换仅换决策提供者，不改重建状态）。修复 `ai-loop.js` 三处真实 bug：recovery/abort 读错字段（`run.loopStatusJson/loopStatusHash` → `run.record/run.hash`，此前 statusJson 恒为 `{}`、recovery_required 永不暴露）、无项目归属隔离（新增 `userMayAccessProject`+`loadRunAuthorized`，跨用户 403、public/admin 放行）、expanded 投影暴露 recoveryRequired/recoveryReason。新增 11 durable-resume + 15 route 集成测试（挂真实 router+DB+mock auth）；641 loop 测试、`npm test` 1049 pass/0 fail、`npm run check` 全绿。 | 本提交 | `core/r-server/db.js`, `core/r-server/agent-runner.js`, `core/r-server/routes/ai-loop.js`, `test/loop-durable-resume.test.mjs`, `test/loop-api-route.test.mjs` |
| ✅已处理 | 2026-07-24 | LoopRun 契约漂移已修复：`automationMode` 固定为 guided/confirm/trusted，新增独立 `executionIntent=task_draft/task_execute`；生产新建统一走 `buildLoopRun`，旧 task_* 行只读归一化，恢复仍按项目+会话复用同一 run。 | 本文件 §7 | 见 §7 |
| ✅已处理 | 2026-07-23 | HLE-C1 完成
| ✅已处理 | 2026-07-23 | HLE-C2 完成
| ✅已处理 | 2026-07-23 | HLE-C5R：真实 Bulk RNA 聊天路径发现 Plugin Contract 未统一——DESeq2 coldata 绑定丢失、log2FoldChange/log2FC 列名漂移、volcano-plot 硬编码 log2FC、Workflow DAG 缺少 deg-standardizer、failed Job 假成功防护基于文件存在而非 artifactTruth、metadata→coldata 映射未进入 Job 参数。合成测试通过但产品路径失败。修复：biof3.deg.v1 profile、volcano-plot lfc_col 参数、DESeq2 preflight、bulk-rna-core 4-step DAG、Repair Boundary、scientific-task-planner coldataBinding、agent-runner false-success 检测。1032/1032 测试全量通过，插件契约 lint 0 错误。真实产品验收待 Step 7。 |
| ✅已处理 | 2026-07-23 | DESeq2 存在 built-in、新旧 installed 快照和 `tool-scripts` 三条脚本来源，真实加载被 6 月 installed 副本覆盖。现以 `resources/built-in-plugins/deseq2` 为 builtin-canonical 唯一源码：移除 installed 台账/本机副本和 legacy R 脚本，普通 installed 不得覆盖，显式 development 仍可调试覆盖，并补充来源选择回归。 |
| ✅已处理 | 2026-07-23 | HLE-C5 离线基础：server.js 启动恢复（HLE-C5）接入 listRunningLoopRuns；running LoopRun → failed(recovery_required) 平滑过渡；Loop Controller 修复 require('./loop-failure-diagnoser') 引用 loop-repair-strategy；22/22 恢复矩阵测试通过；46/46 SPT-1 三轨离线验收测试通过；440/440 Loop 离线测试全量通过。注意：离线测试通过不等于真实产品路径通过，HLE-C5 真实产品验收待 HLE-C5R 完成。 | 本提交 | `core/r-server/server.js`, `core/r-server/db.js`, `core/shared-backend/loop-controller.js`, `test/loop-recovery-integration.test.mjs`, `test/loop-spt1-acceptance.test.mjs` |

| ✅已处理 | 2026-07-23 | HLE-C3（REST API 部分）完成，耐久恢复由 HLE-C3R 收口（见上方 ✅ 条目）：Loop REST API 上线（runs/iterations/actions/evidence/recovery/abort），compact 投影不暴露无界字段 | 本提交 | `core/r-server/routes/ai-loop.js` |
| ✅已处理 | 2026-07-24 | HLE-C4R 功能与视觉接线完成：有界 `session-summary`、历史回放、active/background、恢复、Token/缓存/成本及 completed/blocked/cancelled 终态全部来自持久化真相；blocked/failed/cancelled 非绿，不展示隐藏思维链。真实 renderer 明暗、820px、停止/恢复矩阵通过，UI-101 已 verified。 | UI-101 | `loop-client.ts`, `useDurableConversationLoop.ts`, `SimpleChat.tsx`, `CenterPanel.tsx`, `WorkspaceSummaryCard.tsx`, `acceptance/harness-loop/production/ui-matrix.md` |
：Validator Registry 接入生产 orchestration，运行真实 job truth 读取；Diagnoser 分类故障并选 Repair Strategy；blocked/failed 验证结果阻止完成；假成功（failed job + partial files）稳定阻断；38/38 集成测试通过 | 本提交 | `core/r-server/agent-runner.js` + `test/loop-validator-diagnoser.test.mjs` |
：Loop Controller 接入 agent-runner.js，惰性初始化 LoopRun、按轮持久化 Iteration、发出 loop_phase/loop_iteration SSE 事件、记录用户取消和 Controller 终止；非执行轮不创建 LoopRun；19/19 集成测试通过 | 本提交 | `core/r-server/agent-runner.js` + `test/loop-agent-integration.test.mjs` |
 HLE 生产代码与实机审计 | 按 [`harness-loop-production-closure-plan.md`](./harness-loop-production-closure-plan.md) HLE-C0～HLE-C5 收口；failed Job 即使存在部分文件也不得宣称任务完成 |

**状态图例**：🔴 阻塞验收必须处理 | 🟡 建议处理不阻塞 | 🟢 待合并零风险 | ⚪ 可清理 | ✅ 已处理

---

## §1 Stage 2 验收审计（已完成，归档）

> 详细报告见 `docs/stage2-acceptance-audit.md`
> **状态：✅ 已被主 agent 完成验收，本审计归档**

主 agent 已于 2026-07-17 完成 Stage 2 全部验收：
- 真实 Provider 矩阵通过（DeepSeek + xunfei-astron + api.xcdw.us claude-opus-4-8）
- 打包态 UI-031 verified（提交 `f7a9b4e`）
- conversation/tool_job/artifact 契约不变

原审计报告中的 3 条建议级问题（注释陈旧/成本估算硬编码/兼容期 apiKeyOverride）未在 Stage 2 验收中处理，仍为 🟡 建议级，不阻塞后续工作，主 agent 可在 Stage 3 间隙清理。

---

## §2 并行分支待合并（2026-07-17）

> 详细备忘录见 `docs/branch-handoff.md`

### §2.1 fix/qa-smoke-stale-css-paths ✅

- **提交**：`ce1f054`
- **改动**：`scripts/qa-smoke.mjs`（2 行删除）
- **状态**：✅ 2026-07-17 已 `git merge` 进 main（ort merge commit），qa-smoke 从 6/7 恢复到 7/7。分支已删除。
- **风险**：零冲突，与 MODEL 文件零重叠（已确认）

### §2.2 codex/fix-collapsed-right-titlebar 🟡

- **提交**：`23705a3`
- **改动**：3 文件（TitleBar.module.css、TitleBar.tsx、project-workspace.tsx）
- **风险**：无文本冲突，但三文件两边都改过，有语义冲突风险
- **合并方式**：建议先 `git diff main...codex/fix-collapsed-right-titlebar` review
- **合并时机**：人工 review 后

### §2.3 已合并残留分支可安全删除 ✅

- **状态**：✅ 2026-07-17 已处理（主 agent）。`git branch --merged main` 逐个核实 5 个分支确已合并；发现它们各被 `/private/tmp/` 下的 worktree 占用（且 `/tmp` 已清空，worktree 目录 MISSING、标记 prunable），先 `git worktree prune` 清理陈旧注册，再 `git branch -d`（安全删除，只删已合并）删除。
- 待评估的 `codex/fix-collapsed-right-titlebar`（§2.2，无 `-minimal` 后缀）不在 `--merged` 列表，已正确排除、保留。

```bash
# 已执行：
git worktree prune
git branch -d codex/fix-collapsed-right-titlebar-minimal \
              codex/fix-external-webview-height \
              codex/restore-user-avatar \
              codex/restore-user-chat-bubble \
              codex/theme-linked-panels
```

---

## §3 Stage 3 M1 Capability Provisioning 审计（2026-07-17）

> 审计对象：工作区未提交的 Stage 3 M1 代码
> 审计方式：只读，未改动任何代码
> 审计结论：**代码质量良好，13 个测试全通过，无阻塞级问题。3 条建议级改进。**

### 审计范围

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `core/shared-backend/capability-provisioning.js` | 新增 | 核心模块：能力预备 CRUD + SHA-256 校验 + 幂等 |
| `test/capability-provisioning.test.mjs` | 新增 | 13 个测试，全通过 |
| `core/shared-backend/index.js` | +1 行 | 注册新模块导出 |
| `core/r-server/helpers/tools-executor.js` | +27/-4 | R_LIBS_USER 注入 provisioned bundle |
| `core/r-server/mcp/registry.js` | +29/-3 | 同上（插件脚本路径） |
| `src/main.js` | +16 | IPC: `harness-capabilities:list`（只读） |
| `src/preload.js` | +5 | 暴露 `harnessCapabilities.list` |
| `frontend/src/lib/electron.d.ts` | +17 | 类型定义 |
| `frontend/src/components/desktop/DesktopSettingsPanel.tsx` | +59 | 设置面板 HarnessEnvironment 只读视图 |
| `scripts/harness-file-index.mjs` | +7/-2 | 索引更新 |

### 优点（设计正确的部分）

1. **capability-provisioning.js 不依赖 electron**，可独立测试，符合 D5 "不引入新依赖"
2. **流式 SHA-256 + 幂等性 + 自愈检查**（install_dir_missing）设计完善
3. **可注入的 download/hash/install 函数**，测试用 mock 完全覆盖，无真实网络调用
4. **IPC 只暴露 list（只读）**，provision/remove 由 Harness 编排层内部完成，符合 D8 透明进度
5. **tools-executor.js 和 mcp/registry.js 两处 R_LIBS_USER 注入逻辑一致**，provisioned bundle 优先级最高
6. **HarnessEnvironment 组件遵循 Stage 1 UI 规范**（field__label / field__hint / biof3-badge）

### 问题 A：代码重复（R_LIBS_USER 组装逻辑）

- **位置**：`core/r-server/helpers/tools-executor.js:590-615` 和 `core/r-server/mcp/registry.js:475-500`
- **现象**：两处的 R_LIBS_USER 三段式组装逻辑几乎完全相同（约 25 行重复代码）：
  1. provisioned capability bundle lib（requiresBundle）
  2. 插件内置 packages/r
  3. R runtime library
- **建议**：抽取为共享 helper，如 `core/shared-backend/r-libs-resolver.js`，导出 `resolveRLibsForPlugin(pluginCfg)` 函数
- **优先级**：中（不阻塞 M1，但 M2 增加更多 bundle 类型时会重复更多）
- **对验收影响**：无
- **状态**：✅ 2026-07-17 已处理。新建 `core/shared-backend/r-libs-resolver.js`，导出 `resolveRLibsForPlugin(pluginCfg)` 与 `resolveProvisionedBundleLibs(pluginCfg)`。`tools-executor.js`（HTTP 执行器）与 `mcp/registry.js`（MCP 注册表）两处三段式逻辑替换为单行调用，约 25 行重复消除。触发时机正是 WGCNA 引入第二个 bundle 类型（`r-wgcna`）——审计预判的"M2 增加更多 bundle 类型时会重复更多"已兑现。全量测试 312 pass（唯一 fail 为环境 sqlite ABI，与改动无关），`npm run check` 绿。
- **状态**：✅ 2026-07-17 已处理。新建 `core/shared-backend/r-libs-resolver.js`，导出 `resolveRLibsForPlugin(pluginCfg)`（返回完整 runEnv 或 null）+ `resolveProvisionedBundleLibs`。`tools-executor.js`、`mcp/registry.js` 两处三段式组装均改为调用该 helper，重复代码消除。四件套全绿（harness:check 7/7、node --test 312 pass 仅环境 sqlite ABI fail、frontend tsc 0、npm run check 绿）。

### 问题 B：静默 catch {} 吞掉所有错误

- **位置**：`tools-executor.js:598` 和 `mcp/registry.js:484`
- **现象**：两处 `try { require('capability-provisioning')... } catch {}` 会吞掉所有错误（require 失败、ledger 损坏等）
- **设计意图**：provisioning 未就绪时不阻塞基础执行（正确）
- **建议**：至少 `console.warn` 一次，记录原因，否则调试困难。例如：
  ```js
  } catch (e) { console.warn('[harness] capability provisioning unavailable:', e.message); }
  ```
- **优先级**：中
- **对验收影响**：无
- **状态**：✅ 2026-07-17 随问题 A 一并处理。抽取到 `r-libs-resolver.js` 后，provisioning 不可用时 `console.warn('[harness] capability provisioning unavailable:', ...)`（每进程只 warn 一次，避免刷屏），单个 bundle readiness 检查失败也 warn 而非静默。两处调用点不再有裸 `catch {}`。
- **状态**：✅ 2026-07-17 随问题 A 一并处理。抽取进 `r-libs-resolver.js` 时，require 失败改为每进程 warn 一次（`_warnedProvisioningUnavailable` 门闩，避免每次 tool run 刷屏）；`checkCapabilityReady` 单 bundle 失败也改为 `console.warn` 带 bundleId，不再静默。

### 问题 C：defaultDownload 未复用 plugin-manager

- **位置**：`core/shared-backend/capability-provisioning.js` 的 `defaultDownload` 函数
- **现象**：代码注释写"mirrors src/plugin-manager.js#streamingSha256"，是复制而不是复用
- **背景**：设计文档 D5 提到"复用现有管道 plugin-manager.js 的 downloadFile"
- **判定**：可接受的偏离 -- capability-provisioning 有意不依赖 electron（plugin-manager 依赖 electron 的 app.getPath），无法直接复用。但可考虑抽取共享的下载函数到 shared-backend
- **建议**：M2 阶段评估是否抽取共享下载函数
- **优先级**：低
- **对验收影响**:无

### 问题 D：defaultDownload 缺少 host 白名单

- **位置**：`core/shared-backend/capability-provisioning.js` 的 `defaultDownload` 函数
- **现象**：直接 `https.get(options.url)`，无 host 白名单校验
- **设计文档要求**：第 5.5 节明确提到"host 走白名单"
- **当前风险评估**：低 -- M1 阶段 URL 来源是内置 `CAPABILITIES` 常量，非用户直接输入
- **建议**：在 M2 扩展分发源前补上 host 白名单，复用 plugin-manager 的 host 白名单逻辑
- **优先级**：中（当前低风险，但应在 M2 前修复）
- **对验收影响**：不阻塞 M1
- **✅ 处理（2026-07-18，主 agent）**：在 `capability-provisioning.js` 实现 host 白名单，作为独立 gate 加在 `provisionCapability` 的 readiness 检查之后、任何下载之前：
  - `checkUrlAllowed(url, options)`：强制 `https:`（对齐 `macos-oss-updater.js` 的 https-only），host 走白名单；返回结构化 `{ok:false, reason}`（`invalid_url` / `insecure_protocol` / `host_not_allowed`），不抛异常。
  - 默认白名单 `DEFAULT_ALLOWED_HOSTS` = 真实分发源 `biof3-uploads.oss-cn-hangzhou.aliyuncs.com` + 后缀 `.aliyuncs.com`（对齐 D7 OSS CDN）。`.` 开头条目为后缀匹配且防 `aliyuncs.com.evil.net` 型 lookalike，其余精确匹配。
  - 可覆盖：`options.allowedHosts`（测试/编排）与 `BIOF3_CAPABILITY_ALLOWED_HOSTS` 环境变量（D4 分发源可换、只改配置不改逻辑）。
  - gate 位置刻意在 readiness 之后：已就位的 capability 短路返回、不重新校验，收紧白名单不会 strand 已装 bundle。
  - 新增 5 个测试（off-allowlist 拒绝且不下载 / http 拒绝 / allowedHosts 覆盖 / checkUrlAllowed 匹配规则 / env 覆盖），本文件测试 13→18，全通过。
  - **顺带纠正设计文档失实描述**：设计文档 §3.3/§5.5 与本审计原文均称"复用 plugin-manager 的 host 白名单逻辑"——经核实 `src/plugin-manager.js#downloadFile`（及 `content-sync.js#downloadFile`）**从来没有 host 白名单**，都是裸 `https.get(url)`；全仓唯一做 host 校验的是 `macos-oss-updater.js#resolveArtifactUrl`（https + 同源）。因此本次是**新实现**而非复用，并已修正 `stage3-standard-workflows-design.md` §3.3/§5.2 的错误表述，避免后续 agent 继续被"现成白名单"误导。
- **详细报告**：`docs/stage3-m1-audit.md`

---

## §4 代码质量审计（2026-07-17）

### 问题 E：sanitizer.js 死模块

- **位置**：`core/r-server/sanitizer.js`（51 行）
- **现象**：导出 `sanitizeParam`/`assertSafePath`/`sanitizeRString`，但全项目（core/ + src/ + frontend/）无任何生产代码引用
- **测试**：`core/test/sanitizer.test.mjs` 存在，但该文件在 `core/test/` 下，不在 `npm test` 门禁范围（`node --test test/*.test.mjs`）
- **dependency-decoupling-checkpoint.md 记录**："早期 flagged 但保留的模块，等 P-07 模型网关落地时统一收编"。P-07 已落地，但 sanitizer 仍无人引用
- **建议**：主 agent 评估是否删除 `sanitizer.js` 和 `core/test/sanitizer.test.mjs`。如果安全函数仍有价值，应迁移到 `core/shared-backend/` 或合并到现有 util
- **优先级**：低（死代码不影响运行，但增加维护噪音）
- **对验收影响**：无
- **✅ 处理（2026-07-17，主 agent）**：确认全仓（core/+src/+frontend/，排除 dist/node_modules）无任何生产引用，确为死模块。删除 `core/r-server/sanitizer.js` + `core/test/sanitizer.test.mjs`。安全函数当前无消费方，未迁移；未来需要 R 参数/路径消毒时再从 git 历史取回并接入实际调用点。

### 问题 F：core/test/ 目录不在门禁范围

- **现象**：`package.json` 的 test 脚本是 `node --test test/*.test.mjs`，只覆盖 `test/` 目录
- **`core/test/` 目录下有 9 个测试文件**不被门禁覆盖：
  - `sanitizer.test.mjs`（测死模块）
  - `agent-tools.smoke.mjs`、`agent-workflow.mjs`、`copilot-scenarios.mjs`
  - `execution-context.mjs`、`final-report.mjs`、`report-theme.mjs`
  - `smoke-phase-c3.mjs`、`smoke-tools.mjs`
- **风险**：这些测试可能测的模块已变更但测试未同步，产生"假绿色"或"假红色"
- **建议**：主 agent 评估：
  1. 将仍有价值的 `core/test/` 测试迁移到 `test/` 目录纳入门禁
  2. 删除测死模块的测试（如 sanitizer.test.mjs）
  3. 或在 package.json 中扩展 test glob 为 `node --test test/*.test.mjs core/test/*.mjs`
- **优先级**：中（门禁覆盖范围直接影响 CI 可信度）
- **对验收影响**：不阻塞 Stage 3，但影响长期代码质量
- **✅ 处理（2026-07-17，主 agent）**：未采用方案 3（`core/test/*.mjs` glob 会拖入 4 个打 `biof3.com` 已下线云平台的 live smoke，CI 必挂）。改为按测试性质分流：
  - 3 个纯单测迁进门禁：`agent-workflow.mjs` / `execution-context.mjs` / `final-report.mjs` → `test/*.test.mjs`（`git mv` 保留历史，修正相对 require 路径）。同步更新引用它们的 `package.json`（harness:phase6 / harness:agent-evaluate）与 `.github/workflows/ci.yml`。
  - `report-theme.mjs`：`test/report-theme.test.mjs` 已是其超集（含 isHtmlFile + XSS 用例），删除 `core/test/` 陈旧副本。
  - `sanitizer.test.mjs`：随死模块删除（见问题 E）。
  - 4 个 live-network smoke（`agent-tools.smoke` / `copilot-scenarios` / `smoke-phase-c3` / `smoke-tools`）**有意保留在 `core/test/`**：它们打已下线的 `biof3.com` 云平台、需凭证、CI 里会挂，不应进门禁。已在本记录标注其性质，避免后续误纳入。
  - **顺带抓到的真 bug**：迁移后 `npm test` 覆盖到 `agent-workflow.test.mjs`，暴露 `listAgentWorkflowTemplates` 断言仍期望 2 个模板 —— 但 WGCNA 提交 `e30bc90` 已新增第 3 个 `coexpression-network` 模板。该测试在 CI 门禁内、却不在本地 `npm test` glob 内，正是本问题所述"假绿"：`e30bc90` 一旦 push 就会让 CI 变红。已把断言更新为 3 模板（含 coexpression-network）。本地 `npm test` 从 324→367（+43 迁移用例），唯一 fail 仍是环境性 sqlite ABI。

### 问题 G：project-run-layout.js isAdmin 硬编码

- **位置**：`core/r-server/helpers/project-run-layout.js:86`
- **现象**：`const isAdmin = false; // TODO: 从 user 对象获取角色`
- **风险**：管理员判断被硬编码为 false，如果有依赖 isAdmin 的权限分支，可能永远不执行
- **建议**：主 agent 确认该 TODO 是否需要实现，或标记为"桌面版不需要管理员角色"并移除 TODO
- **优先级**：低（桌面单用户场景可能不需要 admin 判断）
- **对验收影响**：无
- **✅ 处理（2026-07-17，主 agent）**：核实"桌面版不需要 admin"的建议前提**不成立** —— 仓库确有角色模型：`users` 表有 `role` 列（默认 `'user'`），`db.getUserById()` 返回它，且 `api-data.js` / `feedback.js` 均已用 `role === 'admin'` 派生管理员权限。因此按既有模式**实现** TODO 而非删除：`resolveProjectRunLayout` 在非 owner 时经 `db.getUserById(userId)` 查 `role === 'admin'` 放行。防御性处理：db 未提供 `getUserById`（如单测 mock）或用户不存在/抛错时安全回退为非管理员，owner-only 行为不变。注意实际路径是 `core/shared-backend/project-run-layout.js`（审计记的 `core/r-server/helpers/` 已过时）。新增 3 个测试用例（admin 放行 / 非 admin 拒绝 / 无 getUserById 回退），`test/project-run-layout.test.mjs` 30→33 pass。

---

## §5 Stage 3 B2 接线缺口审计（2026-07-18）

### 问题 H：provisionCapability 未接入任何真实运行路径

- **位置**：`core/shared-backend/capability-provisioning.js#provisionCapability`（下载函数本身）；缺口在 `core/shared-backend/r-libs-resolver.js#resolveProvisionedBundleLibs`（运行路径侧）
- **现象**：`provisionCapability`（下载 + 校验 + 落盘 + ledger）实现完整、测试齐全，但**全仓没有任何执行器 / readiness gate 真正调用它**。全仓搜索 `provisionCapability` 的调用者，除模块自身、文档、测试外，无生产调用点。运行路径侧 `r-libs-resolver.js` 的 `resolveProvisionedBundleLibs` 只调 `checkCapabilityReady`（检查 bundle 是否**已装**），从不在缺失时触发 `provisionCapability`（**下载**）。
- **事实核对（已核实）**：
  - `checkCapabilityReady` 有生产调用者（`r-libs-resolver.js`）——只读检查已装。
  - `provisionCapability` 无生产调用者——即"缺 bundle 就自动触发下载"这一步从未接线。
  - 结果：即便 `BUNDLE_REGISTRY` 里某 bundle 已 `ready`（有 sha256），运行路径也不会去下载它，只会因 `checkCapabilityReady` 返回 `not_provisioned` 而静默跳过该 bundle 的 lib 注入。
- **性质**：与之前 host 白名单那个 gap（问题 D）同类——**"文档说有、实际没有"**。设计文档 §5.2 把"缺 bundle 就自动 provision"描述成"已有机制"，实际 M1 只做了下载函数本身，没做"缺 bundle 就自动触发下载"的接线。
- **B2 进度对账**：
  - ✅ B2 part1（`capability-bundles.js` bundle 注册表，commit `4c6557e`）已补齐 **"bundleId → descriptor"** 这一环（单一事实源：bundleId → `{url, sha256, sizeBytes, platforms}`），并提供了 `ensureBundlesForPlugin()` 编排层作为"未来运行路径将调用的接缝"——但该编排层同样尚未被任何运行路径调用（见 `capability-bundles.js` 文件头注释自述）。
  - ⏳ 剩下的运行路径接线（在 `r-libs-resolver.js` / readiness gate 缺 bundle 时调 `ensureBundlesForPlugin` → `provisionCapability`）留 **B2 part2**。
- **状态标记**：✅已处理（原为 🟡建议。不阻塞当前验收——bundle 尚未构建发布，`sha256===null` 时本就不该下载；B2 part2 已把接线批次补齐，闭合本 gap）。
- **对验收影响**：无（当前所有 bundle 均 unpublished，运行路径本就应跳过；接线缺口只有在 bundle 真正发布后才显现为"该下载却没下载"）。
- **✅ 处理（2026-07-18，主 agent）**：B2 part2 已把运行路径接线补齐，闭合本 gap：
  - `core/r-server/helpers/tools-executor.js#executeJob`（R 分支，`resolveRLibsForPlugin` 之前）与 `core/r-server/mcp/registry.js#_runPluginScript`（已改为 async，在 `return new Promise` 之前 await）两处，均在 R 库解析前调用 `ensureBundlesForPlugin(cfg/plugin)`；`getToolConfig` 已透传 `requiresBundle`/`requiresBundleVersion`。
  - best-effort 语义：双守卫（仅 R 插件 + 有 `requiresBundle`）+ try/catch only-warn；unpublished（`sha256===null`）/ unknown / 下载失败均不中断 job，行为与接线前一致（当前所有 bundle 均 unpublished 故不下载）。
  - 新增 `test/capability-bundle-wiring.test.mjs`（4 个 wiring 契约测试，零网络）；全量 `npm test` 423 tests，仅 1 个环境性 sqlite ABI fail，零功能回归。
  - **gap 已闭合**：`provisionCapability` 现在有真实运行路径调用者（经 `ensureBundlesForPlugin` 编排层触达），"缺 bundle 就自动 provision"不再是空转；bundle 一旦发布（有 sha256）即会在运行路径按需下载。
  - 相关提交：B2 part1 注册表 `4c6557e`；B1 构建脚本 + 本 gap 记录（批次一）；B2 part2 接线（批次二）均已 push。

---

## §6 Stage 4 发布收口审计（2026-07-19）

### 问题 I：Stage 4 migration 原生模块 ABI 边界错误

- **位置**：`src/main.js` 启动 migration 子进程；`src/migration-runner.js` 的 `better-sqlite3` 加载边界。
- **现象**：electron-builder 会把根 `better-sqlite3` 重建为 Electron ABI。构建后再运行 `npm test` 或 `npm run dev` 时，migration 使用系统 Node，却从根 `node_modules` 加载 Electron ABI，出现 `NODE_MODULE_VERSION 123` / `131` 错误。
- **影响**：此前虽被记录成“环境性允许失败”，但实际会让开发首次启动 migration 失败，也使 Stage 4 的“全量测试通过”无法成立；属于发布收口阻断。
- **✅ 处理（2026-07-19，主 agent）**：
  - 开发 migration 通过内部环境变量明确加载 `core/r-server` 的系统 Node ABI 依赖；
  - 打包态保持 Electron Helper + electron-builder 重建的根 ABI，`afterPack` 继续复制到两个 Core；
  - migration 单测改用相同 Core 依赖边界，消除 build/test 执行顺序耦合；
  - `npm test` 达到 428 total / 417 pass / 11 skip / 0 fail，原唯一 ABI fail 消失；
  - 全新临时数据目录的开发态和 arm64 打包态均验证 migration version 0、SQLite 25 张表、R/Python/SPA 健康；
  - 详细 Stage 4 矩阵见 `docs/stage4-stable-release-checklist.md`。

### 问题 J：Runtime 首装契约不完整

- **位置**：`resources/built-in-plugins/manifest.json`、`src/plugin-manager.js`、`src/plugin-schema.js`、`electron-builder.yml`。
- **现象**：线上 `plugins/manifest.json` 仍是旧 `{url, checksum, size, platform}` 结构，浅合并后覆盖新版 `artifacts`，导致全新首装无法选择 artifact；内置 R/Python 条目的 SHA-256/大小为空，且安装包只带旧 `.sh`、未带实际调用的 `fix-r-paths.mjs`。
- **影响**：已有开发机因缓存 Runtime 不暴露问题，但全新用户会在下载、校验或 R dylib 修复阶段失败。
- **✅ 处理（2026-07-19，主 agent）**：
  - 旧远程条目先归一化为现代 artifact 契约，再与可信内置 fallback 合并；
  - 回填线上 R/Python ZIP 的真实大小与 SHA-256，并增加严格 archive 大小校验；
  - 同时打包 `.mjs` 与 `.sh` 路径修复资源；
  - 隔离目录通过真实 OSS 下载 R/Python，R 修复扫描 74 个 `.so` 后 framework 引用为 0，R 4.5.2 与 Python 3.11.15 均可执行。

### 问题 K：诊断导出隐私边界过宽

- **位置**：`src/main.js` 诊断导出 IPC。
- **现象**：旧实现归档整个用户数据目录并附带未经脱敏的原始后端日志，与“诊断包”名称不符。
- **影响**：可能将 SQLite、设置、对话、结果或日志中的认证信息带入用户分享的 ZIP，属于安全发布阻断。
- **✅ 处理（2026-07-19，主 agent）**：
  - 导出仅保留脱敏后的 R/Python 日志、最小系统信息、插件安装摘要和隐私说明；
  - 明确排除数据库、设置、对话、结果与凭据；
  - 覆盖 header、结构化字段、query 参数和 Provider key 模式的脱敏测试；
  - 适配 archiver v8 的 `ZipArchive` 构造接口。

### 问题 L：DESeq2 首次成功产物契约不完整

- **位置**：`core/r-server/helpers/tools-executor.js`、DESeq2 tool definition、`scripts/golden-path.mjs`。
- **现象**：R 脚本完成并产生 22 个科学文件后，因声明的 `all_results.zip` 不存在而失败；报告模板只查插件目录，golden-path 还保留测试侧补报告逻辑。
- **影响**：科学计算成功不等于产品首次成功，`run_tool → tool_job → artifact truth` 会被缺失的交付产物阻断，且测试补救会掩盖真实产品缺口。
- **✅ 处理（2026-07-19，主 agent）**：
  - 执行器在 artifact truth 前按声明输出生成 `all_results.zip`；
  - 报告模板允许回退到内置 tool-scripts；
  - golden-path 读取当前报告 URL 契约，旧补救只保留为兼容分支；
  - 隔离首用任务 `job_828eacaf0e9741ea` 为 `completed`，run.json `passed`，ZIP 与约 1.6 MB 自包含报告均存在。

---

## §7 HLE-C3R 耐久恢复收口审计（2026-07-23）

### 问题 M：LoopRun.automationMode 分类漂移（契约与生产不一致）

- **位置**：`core/shared-backend/loop-contract.js#validateLoopRun`（枚举 `guided|confirm|trusted`） vs `core/r-server/agent-runner.js#_loopInit`（写入 `task_execute|task_draft`）。
- **现象**：契约校验器要求 `automationMode ∈ {guided, confirm, trusted}`，但生产 `_loopInit` 经 `db.persistLoopRun`（**不过 `buildLoopRun` 校验**）直接落库 `task_execute`/`task_draft`。两套词表并存：契约描述的是"自动化信任级别"，生产存的是"本轮执行意图"。
- **性质**：与问题 D/H 同类的**"文档/契约说一套、生产存另一套"**。`persistLoopRun` 是裸仓储写入、不校验 `automationMode`，因此漂移长期未被测试捕获（HLE-C3R 新测试经 `buildLoopRun` 才暴露）。
- **当前影响**：低。`automationMode` 目前只作展示/查询投影字段，不参与决策或恢复分支；`getActiveLoopRunForConversation` 已**刻意不按 automationMode 过滤**（draft→execute 属同一 LoopRun 生命周期，见 closure plan §4.1）。
- **不阻塞 C3R**：耐久恢复不依赖该字段取值。
- **状态**：✅ 已处理（2026-07-24）。采用第二条路线：
  - `LOOP_AUTOMATION_MODES=guided|confirm|trusted` 与 `LOOP_EXECUTION_INTENTS=task_draft|task_execute` 分离并进入 hash 语义字段。
  - `_loopInit` 新写统一走 `buildLoopRun`；完全访问映射 trusted，只读映射 guided，执行意图独立保存。
  - DB 读取兼容历史 `task_execute`/`task_draft`，分别投影为 trusted/guided 且恢复出 executionIntent，不批量改写旧 hash。
  - 项目/会话列表查询和投影缺字段一并修复；Contract、Repository 与真实 Router 回归覆盖新写和旧读。
- **对验收影响**：契约漂移关闭，不改变 `run_tool → tool_job → artifact truth`。

---

## 审计发现追加规范

非主 agent 完成新审计后，按以下格式追加到"当前待处理项"表格：

```
| 状态 | 日期 | 简述 | 来源 | 详情锚点 |
```

- **状态**：🔴/🟡/🟢/⚪/✅
- **来源**：审计报告文件名或"本文件 §N"
- **详情锚点**：指向本文件下方的详细小节

每条新增发现同时在下方新建小节记录详情。已处理的条目状态改为 ✅ 并保留，不删除（供追溯）。

---

## 处理记录

| 日期 | 处理内容 | 处理方 |
|------|---------|--------|
| 2026-07-17 | 建立审计广播台，汇总 Stage 2 验收审计 + 分支备忘录的发现 | 非主 agent |
| 2026-07-17 | Stage 2 验收审计归档（主 agent 已完成验收） | 非主 agent |
| 2026-07-17 | 追加 Stage 3 M1 capability-provisioning 审计（3 条建议级） | 非主 agent |
| 2026-07-17 | 追加 Stage 3 M1 深度审计报告（不变量/约束/安全），新增问题 D（host 白名单） | 非主 agent |
| 2026-07-17 | 追加代码质量审计：死模块/门禁覆盖盲区/硬编码 TODO（问题 E/F/G） | 非主 agent |
| 2026-07-17 | 合并 `fix/qa-smoke-stale-css-paths`（§2.1），qa-smoke 6/7 → 7/7，删除已合并分支 | 主 agent |
| 2026-07-17 | 打包 WGCNA 为 built-in 插件（Stage 3 M4）+ 修锚定正则输入 bug + 新增 coexpression-network 工作流 | 主 agent |
| 2026-07-17 | 抽取共享 R_LIBS_USER resolver（问题 A/B），静默 catch → warn | 主 agent |
| 2026-07-17 | 删除 sanitizer 死模块（问题 E）；core/test 门禁分流：3 单测迁入门禁、删陈旧副本、保留 4 个 live smoke（问题 F）；顺带修 agent-workflow 模板数断言（WGCNA 引入的 CI 潜伏失败） | 主 agent |
| 2026-07-17 | 处理问题 G：实现 project-run-layout 的 isAdmin（`db.getUserById().role === 'admin'`，防御性回退非管理员），补 3 个权限单测（admin 放行 / 非 admin 拒绝 / 无 getUserById 回退） | 主 agent |
| 2026-07-17 | 清理 §2.3 5 个已合并 codex 残留分支（worktree prune + branch -d），保留 §2.2 待评估分支 | 主 agent |
| 2026-07-18 | 处理问题 D：为 capability-provisioning 实现 host 白名单（`checkUrlAllowed`：https-only + 默认 OSS CDN 白名单 + `options.allowedHosts`/env 覆盖），gate 加在 readiness 之后不 strand 已装 bundle，补 5 个测试（13→18）；顺带纠正设计文档 §3.3/§5.5「复用 plugin-manager host 白名单」的失实描述（该白名单从不存在，本次为新实现） | 主 agent |
| 2026-07-18 | Stage 3 M3：实现多 Provider harness 评测脚本 `scripts/harness-provider-eval.mjs`（6 环节探针，前 4 必需；Markdown+JSON 双报告到 gitignored `eval-reports/`；凭据只读环境变量、不落盘/不打印/不进 CI）+ 31 个 mock 单测纳入门禁（`test/harness-provider-eval.test.mjs`，零网络）+ package.json `harness:provider-eval` 接线。真机跑分待用户 key/endpoint。全量测试 367→406（+39），唯一 fail 仍为环境 sqlite ABI。 | 主 agent |
| 2026-07-18 | Stage 3 M3 首次真机跑分（用户执行 `source .biof3-secrets && npm run harness:provider-eval`）：DeepSeek + Anthropic 双目标各 6/6 全绿，exit 0，达成"≥2 Provider 通过必需项 + 可比较报告 + 失败分类"出口判据；结论记入 stage3 §9（不含 key） | 主 agent |
| 2026-07-18 | Stage 3 M5 三方插件接入指南落地：新建 `docs/third-party-plugin-guide.md`（基于真实 go-kegg/deseq2/volcano-plot 插件），stage3 §15 占位改为指向该指南 | 主 agent |
| 2026-07-18 | Stage 3 B1/B2：新增 R bundle 构建脚本 build-r-bundle.mjs + capability-bundles 注册表 + 运行路径接线（ensureBundlesForPlugin 接进 tools-executor/registry），闭合问题 H；4 wiring 测试，全量 423 零回归 | 主 agent |
| 2026-07-19 | Stage 4 第一批：修复 migration 系统 Node / Electron ABI 边界（问题 I），全量根测试首次 0 fail；开发态与 arm64 打包态空目录启动通过 | 主 agent |
| 2026-07-19 | Stage 4 rc.6：处理 Runtime 首装契约、诊断导出隐私和 DESeq2 首次成功产物缺口（问题 J/K/L）；完成真实 OSS Runtime、bundle、rc.4 数据副本与双架构验证 | 主 agent |
| 2026-07-19 | 发布 `v0.0.1-rc.6`：main/tag/OSS 一致；公开更新选择、下载、大小/SHA-512、DMG 挂载及包内版本/架构验证通过，Stage 4 arm64 RC 出口关闭 | 主 agent |
| 2026-07-21 | 发布 `v0.0.1-rc.7`：修复打包态诊断模块路径，完成 arm64/x64 构建、UI-033/UI-034 收口、OSS 四对象上传及公开 `latest-mac.yml`/SHA-256 反向核验 | 主 agent |
| 2026-07-23 | HLE-2 完成：实现统一 Loop Controller（observe→decide→validate→record→evaluate exit）；核心：deriveObservedStateDigest/digests、computeGoalGapIds（含 prior iterations 累积语义）、detectNoProgress/detectRepeatedAction（含 self-guard）/detectOscillation；decideNextAction 优先级分支（振荡→重复→验证→完成→无进展→等待→运行→推进→完成）；validateAction 前置校验；buildControllerIteration 全链路记录；evaluateExit 退出判定；toStructuredDecision Provider 安全决策；reconcileJobResult 状态回填。核心：core/shared-backend/loop-controller.js（纯函数，560 行）+ 51 单元测试（test/loop-controller.test.mjs）+ 10 集成测试（test/loop-controller-integration.test.mjs，全链路 observe→decide→persist）。新 npm 脚本：harness:loop:controller:test、harness:loop:controller；check 已接线。HLE-3~HLE-6 保持 planned；MCP 工具注册延后到 HLE-2/3 | 主 agent |
| 2026-07-23 | HLE-3 完成：实现 Validator Registry 与科学完成判定；核心：loop-validator-registry.js（register/dispatch/validateArtifact/validateDelivery/aggregateStatus，四态结果 valid/degraded/blocked/unavailable）+ loop-validators.js（7 个内置验证器：input-snapshot/metadata-consistency/counts-matrix/de-results/heatmap-data/enrichment-statistics/delivery-integrity）+ loop-controller.js（HLE-2 收口：decideNextAction + buildControllerIteration 集成 validatorResults，2 个新 REASON_CODE：ARTIFACT_VALIDATION_FAILED/WARNING）+ loop-contract.js（2 个新 reason code）。新 npm 脚本：harness:loop:validator:test、harness:loop:validator；check 接线。验收通过：142 测试全量通过，`npm run check` 通过。HLE-4~HLE-6 保持 planned | 主 agent |
| 2026-07-23 | HLE-4 完成：实现故障诊断、修复策略与受影响子图重规划；核心：loop-failure-diagnoser.js（10 类故障分类，36 条规则，含 HLE-3 validator 结果集成，confidence 评分）+ loop-repair-strategy.js（12 个 strategy，safety level，cost multiplier，parent lineage，computeAffectedSubgraph 保留 verified artifacts）+ loop-controller.js（decideNextAction 新增 failedJob 参数，诊断后 decision='retry' 自动修复，或 decision='block' 要求人工介入）。loop-repair-strategy.js 内置 computeAffectedSubgraph 仅遍历 downstream，不误走 dependsOn。验收通过：88 测试全量通过（HLE-2 61 + HLE-3 81 + HLE-4 88），`npm run check` 通过，HLE-5~HLE-6 保持 planned | 主 agent |
| 2026-07-23 | HLE-5/HLE-6 完成（离线基础设施）：实现耐久检查点、预算策略和会话阶段视图；scripts/harness-loop.mjs 升级为统一全量聚合门禁，输出 acceptance/harness-loop/hle-all-gate.json。验收通过：330 测试全量通过（HLE-2 61 + HLE-3 81 + HLE-4 88 + HLE-5 38 = 330），npm run harness:loop 通过。注意：离线门禁通过不等于生产验收完成——HLE-C0 审计确认 ai-agent 未接入 Loop Controller、前端未消费 Loop 状态、双 Provider/重启/视觉证据待补。生产接线由 HLE-C1~C5 实施 | 主 agent |

| 2026-07-23 | HLE-C0 完成：事实审计、状态纠偏与生产基线；HLE-0~HLE-5 后端原语和离线测试确认存在（7 个 loop-*.js + 10 个离线测试，330 测试全量通过）；发现生产接线尚未完成：agent-loop-control.js 未调用 Loop Controller/Validator/Repair，`harness.js` 路由未接线 Validator/Repair 到真实 Job/Artifact，前端完全未消费 Loop 状态，HLE-6 只验证离线门禁无 Provider/重启/视觉证据；文档状态纠偏：HLE-0~HLE-2 离线基础设施状态修正为 completed，HLE-3~HLE-5 保持 in_progress（HLE-C1~C5 待实施），HLE-6 保持 pending；新增 test/loop-false-success-regression.test.mjs（10 个测试，验证 failed Job + partial files 假成功回归被正确阻断），新增 test/loop-iterate-route.test.mjs（38 个测试，验证 /api/loop/iterate 路由边界：鉴权/FMS/sequence/idempotency/hash 不变/跨项目隔离）；两个测试 48/48 通过，`npm run check` 通过；HLE-C1~C5 生产接线待实施，HLE 主计划总状态保持 in_progress | 主 agent |
| 2026-07-23 | HLE-C3R 完成：耐久恢复收口。生产纠偏——`agent-runner._loopInit` 先 `getActiveLoopRunForConversation` 复用同会话未终结 LoopRun（planned/running）并从 `listLoopIterations` 重建内存序列/parent 链，不再每轮新建；restart 标为 failed(recovery_required) 的 run 被排除、仅经恢复 API 暴露。新增 `db.getActiveLoopRunForConversation` + `db.listLoopActions`（修复空转的 `/api/loop/actions`）。checkpoint-on-success 接线：每轮 `buildIterationCheckpoint→saveContextCheckpoint`，摘要不再是 loop 状态唯一副本，ContextEnvelope 可从持久化 checkpoint 重建（模型切换只换决策提供者）。修 `ai-loop.js` 三真 bug：recovery/abort 读错字段（`loopStatusJson/loopStatusHash`→`record/hash`，此前 statusJson 恒 `{}`、recovery_required 永不暴露）、缺项目归属隔离（`userMayAccessProject`+`loadRunAuthorized`：跨用户 403，public/admin 放行）、expanded 投影补 recoveryRequired/recoveryReason。新增 `test/loop-durable-resume.test.mjs`（11）+ `test/loop-api-route.test.mjs`（15，挂真实 router+DB+mock auth）；641 loop 测试、`npm test` 1049 pass/0 fail/11 skip、`npm run check` 全绿。途中发现 automationMode 契约漂移记入 §7 问题 M（🟡 不阻塞）。 | 主 agent |
| 2026-07-23 | HLE-C4R 聊天消费端接线（UI-101）：修复 loop 事件被丢弃（startConversationRun 未传 onLoopPhase/onLoopIteration）；新增 loop-client.ts（/api/loop/* 类型化 REST + SSE 事件类型 + deriveLoopDisplay/loopStatusLabel 展示辅助）；ConversationRunSnapshot.loop 投影 + 幂等合并（iterationId 去重、sequence 排序）；SimpleChat LoopStatusPanel（紧凑状态+轮次+最近结论，可展开逐轮 decision/publicConclusion，blocked/failed/cancelled 非绿，只展示 publicConclusion）；loop 投影 stop 后保留。frontend 223/223（conversationRunStore +4 loop 用例）、build:check 绿、根 check 全绿、ui:audit 通过。摘要卡/历史回放/视觉矩阵/HLE-C5 Step 7 待续 | 主 agent |
| 2026-07-24 | HLE-C4R 摘要卡实时投影续作（UI-101）：`CenterPanel` 从共享 conversation run store 读取当前会话 loop，`WorkspaceSummaryCard` 紧凑显示后端状态、轮次、最近公开结论与最近决策；普通聊天无 LoopRun 时不显示，blocked/failed/cancelled 继续沿用非绿语义。同步纠正生产收口计划、UI audit 与 handoff；历史 API 回放、active/background/recovery/token-cost 数据和实机视觉矩阵仍保持待验。 | 主 agent |
| 2026-07-24 | Loop 契约与 HLE-C4R 功能收口（UI-101）：automationMode/executionIntent 分轴并兼容旧行；真实落盘 completed/blocked/cancelled；修复项目/会话单条件查询及列表漏字段；新增 session-summary + useDurableConversationLoop，历史阶段、恢复、active/background、会话 Token/缓存/成本自动回放到聊天和摘要。新增 8 项后端/前端回归；根测试 1067（1056 pass/0 fail/11 skip），前端 226 pass。视觉矩阵与 HLE-C5 Step 7 继续待验。 | 主 agent |
| 2026-07-24 | HLE-C4R 真实桌面接线纠偏（UI-101）：真实应用启动验证发现 `/api/loop/session-summary` 被 legacy catch-all 吞掉、desktop-local 身份只在 `req.user` 导致 Loop API 401，以及历史会话无 assistant 消息时 Loop 面板不可见。调整生产路由注册顺序、归一化桌面身份并补 standalone 历史 Loop 面板；新增真实 registry 顺序与桌面身份回归。 | 主 agent |
| 2026-07-24 | HLE-C5 Provider 验收入口扩展（P-07）：`harness:provider-eval` 新增通用 OpenAI-compatible Profile 目标，凭据、Base URL 和模型仍只从环境变量读取，不落盘、不输出；32 项离线测试通过。 | 主 agent |
| 2026-07-24 | HLE-C5 真实主轨假成功纠偏（P-03）：真实产品发现 Agent Loop post-processing 从错误模块解构状态摘要函数，导致正文已输出后 task 假完成而 Loop 永久 running/0 iteration。依赖改为 fail-fast；done 延后至 Loop ledger 成功；fatal error 优先失败；完成决策明确要求模型终答且 Job/Validator 无阻断。 | 主 agent |
| 2026-07-24 | HLE-C4R/C5 durable stage 纠偏（P-03）：Loop 改为首次 run_tool 惰性创建，工具批次完成即持久化阶段 iteration/checkpoint，普通问答不误建；终答单独落终态。修复后同工具“失败父 Job → 后续成功 replacement Job”保留 lineage 且只按未修复失败决定终态。 | 主 agent |
| 2026-07-24 | HLE-C5 源数据不可变边界（P-03）：真实主轨因插件大小写约束原地改写 metadata，立即取消并从既有 Job 输入副本恢复原 SHA-256。workspace write/replace 对已有科学数据扩展名强制 `source_data_immutable`，派生 CSV 仍可在 derived/results 编辑；Agent prompt 禁止 exec 绕过。 | 主 agent |
