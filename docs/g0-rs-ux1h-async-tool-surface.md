# G0-RS-UX1H Async Tool Surface — 计划

> 2026-08-06 用户在真实 airway 数据流程中观察到：主 agent 启动 DESeq2 后被同步流锁死，且工具完成后 LLM 写总结阶段超时（`core/shared-backend/llm-providers/deepseek.js:238/443` 抛 `请求超时`），UI 把工具成功 + AI 总结失败渲染为"失败"，造成误导。
>
> 本计划目标：**消除这种"被锁 + 被误报失败"的主观体验**，范围限定在主 agent 与工具运行/结果呈现之间的边界，**不开 P7-F**。

---

## 1. 计划元信息

| 字段 | 值 |
|---|---|
| Plan ID | `G0-RS-UX1H` |
| 全名 | Async Tool Surface |
| 父主线 | `codex/g0-result-studio-product`（继 `UX1G-2` 之后） |
| 启用形式 | 短 Goal / 单工作包串行 |
| truthDomain | `g0-current-work-package` |
| 状态（启动时） | `active` |
| 替代关系 | 不替代任何已收口计划；不复用任何已 deferred 的 P7-F 范围 |
| 启用日期 | 2026-08-06 |
| 收口日期 | 待定 |

---

## 2. 背景与真实问题

### 2.1 用户真实操作回放

用户在 2026-08-06 进行了"完整流程测试"：

1. 启动开发态 Electron；
2. 拖入 `tmp/airway-test/airway_counts_symbol.csv`（34890 gene symbol × 8 sample，真实 airway 数据，control × 4 vs treated × 4）；
3. 拖入 `tmp/airway-test/airway_metadata.csv`；
4. 应用生成 `airway_coldata.csv`；
5. 与 Agent 对话确认 `design=condition, control vs treated`；
6. 应用调用 DESeq2 → 真实跑通，`tool_job: tj_mshbgvms_hluh` → 产物齐全 → 自动打开 PNG；
7. 等待 Agent 写自然语言总结；
8. UI 末尾显示 `请求超时`（来源：`core/shared-backend/llm-providers/deepseek.js:238/443`）。

### 2.2 核心问题分解

| 症状 | 真实根因 | 现有链路证据 |
|---|---|---|
| 主 agent 似乎"卡住" | 工具完成后的 LLM 总结与主对话 stream 在同一同步通道上 | `frontend/src/components/copilot/SimpleChat.tsx` 的 stream 渲染；`core/shared-backend/llm-providers/deepseek.js` 的 `req.on('timeout')` |
| UI 显示"请求超时" | `req.setTimeout(180_000)` 触发 Node http timeout 事件 | `core/shared-backend/llm-providers/deepseek.js:238` `finish({ error: 'timeout', message: '请求超时' }, 'timeout')` |
| 用户误以为工具失败 | UI 把"工具成功 + AI 总结失败"渲染为"失败"红字 | SimpleChat 中错误渲染分支未识别 `toolJob.completed === success` 的上下文 |

### 2.3 与现有不变量是否冲突

- ✅ 不破坏 `run_tool → tool_job → artifact truth` 唯一执行真相。
- ✅ 不重建 P-02 / Harness / Loop 第二套执行器。
- ✅ 不动 RS / SDC 现有阶段产物、不改 P7 deferred 边界。
- ⚠️ UI 错误渲染分支会改，但只改"已知 toolJob 成功时的失败文案"，不动工具成功判定本身。

---

## 3. 范围（Scope）

### 3.1 In Scope

- **A. 主 agent 不再被工具同步流锁死**
  - 工具启动（`run_tool`）发出后，主对话流立即返回"已发起后台任务（`toolJobId: tj_xxx`）"，不再等工具结果回写主 agent stream。
  - 主对话渲染"运行中 · DESeq2 (tj_xxx)"卡片，**不带 spinner / 不带 loading**，因为任务是真的在跑，只是我们不等。
  - 工具完成事件到达时，**只更新这张卡片**为"已成功 / 失败（含真实 status）"，并把 `tool_result.summary` 字段作为该卡片的事实回执。
  - 关键：**不强制发起"AI 写自然语言总结"的 stream**。AI 总结从"必需"降级为"可点击重试"。

- **B. UI 不再把"工具成功 + AI 总结失败"渲染为"失败"**
  - SimpleChat 错误渲染分支：识别 `toolJob.status === 'success'` 上下文下的 `error === 'timeout'`，**改写为"工具已成功，AI 总结暂时不可用（可手动重试）"**。
  - 文案不出现"失败""错误"等强负面词。
  - 留一个"重试总结"按钮，可选地再次触发 LLM stream（失败仍可失败，但不再误报工具失败）。

- **C. 重试路径不重复执行已完成的工具**
  - "重试总结"路径只调 LLM，**不重跑 DESeq2**。
  - 重试时主对话里 LLM 失败仍然 fail-soft（红字，但卡片已是"已成功"）。

### 3.2 Out of Scope（显式不做）

- ❌ **不实现 P7-F 多任务控制面**：不引入 `workspace_process_start/check/stop`、不引入任务切换 UI、不引入 subagent 池。
- ❌ **不引入第二个执行器 / 第二个 Job 表 / 第二个 Artifact 真相**。
- ❌ **不把"AI 总结超时"配置为业务成功**——它仍是失败，只是**不让它掩盖工具成功**。
- ❌ **不修改 P-02 / Harness / Loop 的核心契约**。
- ❌ **不修改 DESeq2 / GO-KEGG / volcano 等插件的执行路径**。
- ❌ **不动 RS / SDC 现有阶段产物**。
- ❌ **不创建 Git Worktree**（`G0-RS-WT0` 仍 deferred）。
- ❌ **不冒充** `qualificationEligible: true` 或 UI `verified`。

### 3.3 依赖与前置

- 现有 SimpleChat 的 stream 解析与 ToolResult envelope 接入（已具备，P7-D 已落地）。
- 现有 `toolJobId` 与 `toolJob.status` 的 SSE 通道（已具备，UX1G-1/UX1G-2 阶段贯通）。
- 不依赖新增后端表、不依赖 DB 迁移、不依赖插件升级。

---

## 4. 验收判据（Acceptance Gates）

### 4.1 必过的硬门

```text
G-1. docs:check                            → 通过
G-2. ui:audit:check                        → 通过
G-3. test:changed 覆盖受影响模块            → 通过
G-4. frontend/src/lib/SimpleChat 的相关单元测试 → 通过
G-5. docs:reconcile 不出现新无主文档 / 不出现两份 active 计划
```

### 4.2 行为验收（必须做真实跑通才算数）

```text
A-1. 导入 airway_counts_symbol.csv + airway_metadata.csv
A-2. 与 Agent 对话确认 design=condition, control vs treated
A-3. 跑 DESeq2 → 工具成功后
       - 主对话里看到 "已成功 · DESeq2 (tj_xxx) · 自动打开结果"，
         **不再有 spinner / 锁死 / 等待**。
       - UI 不出现"请求超时"红字（即便 LLM 总结阶段超时）。
A-4. 复现"AI 总结超时"：
       - 制造 LLM 总结超时（用本地 mock LLM 故意不返回内容）
       - 验收：UI 显示"工具已成功，AI 总结暂时不可用（可点击重试）"
       - 验收：Result Studio 自动打开了结果 PNG
A-5. 点"重试总结"按钮：
       - 工具**不重跑** DESeq2
       - 仍然走无工具权限的 summary 模型调用，失败仍 fail-soft，且不掩盖工具成功
A-6. 控制台 0 error
A-7. 验收证据：
       acceptance/g0-rs-ux1h/async-tool-surface.json
       acceptance/g0-rs-ux1h/summary-failure-renders-soft.json
       acceptance/g0-rs-ux1h/retry-summary-does-not-rerun-tool.json
```

### 4.3 静态边界

```text
S-1. run_tool → tool_job → artifact truth 唯一执行真相不变
S-2. SimpleChat 错误渲染分支的改写，仅针对"已知 toolJob 成功 + AI 总结失败"组合
S-3. 总结重试使用独立 JSON 请求，不引入第二个 SSE 解析路径，服务端不注册工具定义
S-4. 只补齐 toolJobId 的活动持久化，不改变 traceId、callId 的关联语义
S-5. 不修改 plugin descriptor、不修改 r-server 入口
```

---

## 5. 风险与不破坏边界

| 风险 | 缓解 |
|---|---|
| 误把"工具成功 + LLM 失败"当"完整成功" | UI 文案必须显式提示"AI 总结暂不可用"，且"重试总结"按钮始终可见 |
| LLM 写总结是用户当下最期待的人话 | 提供"重试总结"按钮作为补救；同时**默认不发起** stream（避免空等） |
| 改 stream 路径会破坏 P7-D 既有 envelope 兼容 | 改写范围限定在 SimpleChat 渲染分支与"是否再发起 stream"的判定，**不改 envelope 协议本身** |
| 用户以为 agent 沉默了 | 工具启动时主对话立即返回一条"已发起后台任务"消息，**不是沉默** |
| 写代码时顺手扩大范围 | 本计划 §3.2 显式列出 Out of Scope；任何越界都必须回到本计划修订后再说 |
| 文档治理门禁挂掉 | 启动前、收口前分别 `npm run docs:check` |

---

## 6. 影响范围（预期文件清单）

```text
frontend/src/components/copilot/SimpleChat.tsx
  - 增加 toolJobId-based running/finished 卡片渲染分支
  - 在 stream 错误渲染里识别 "toolJob 成功 + LLM 失败" 组合
  - 新增"重试总结"按钮（仅触发 LLM，触发 run_tool 则阻断）

frontend/src/components/copilot/copilotClient.ts
  - 新增 retryToolSummary(toolJobId) 方法（调用无工具权限的服务端 summary-only 契约）

frontend/src/components/copilot/toolActivity.ts
core/r-server/agent-tools/tool-events.js
  - 持久化已完成 run_tool 的 toolJobId，作为总结重试的精确锚点

core/r-server/routes/ai-chat.js
  - 新增带 ToolJob/Artifact Truth 归属核验的 JSON summary-only 重试接口

core/r-server/agent-runner.js
  - 工具已完成且总结失败时收敛 durable loop 终态，不再遗留 running

frontend/src/components/copilot/__tests__/ 或 SimpleChat.test.tsx
  - 覆盖"工具成功 + LLM 超时"渲染分支
  - 覆盖"重试总结"按钮不调用 run_tool
```

不修改：

```text
core/shared-backend/llm-providers/*.js
core/shared-backend/agent-workflow.js
src/mcp-server.js
src/main.js
core/shared-backend/result-studio-*.js
```

（保留 LLM provider 现有的 180s socket timeout 行为，只是让 UI 在工具已成功时不再把它的失败渲染为"失败"。）

---

## 7. 进度跟踪

| 日期 | 状态 | 说明 |
|---|---|---|
| 2026-08-06 | 计划创建 | 用户在 airway 完整流程中识别问题，本计划上线 |
| 2026-08-06 | active | 写完本计划 + 同步 handoff/registry/AUDIT-LOG |
| 2026-08-06 | active checkpoint | SimpleChat 已接入真实 ToolJob 成功 + 总结超时展示分支；单元测试 6/6、strict TypeScript 通过。一次开发态 Electron 阶段收口验收使用真实 airway counts/metadata 跑出 DESeq2 completed + Artifact Truth valid + 同 Job PNG，并确认目标文案可见、"请求超时"不可见。证据见 `acceptance/g0-rs-ux1h/`；本地 `ux1h-timeout-adapter` 不代表外部模型 |
| 2026-08-06 | active implementation | 已补齐成功 `run_tool` 的 `toolJobId` 活动持久化、服务端 summary-only 重试接口与按钮；接口按 user/project/conversation 核验 completed ToolJob + valid Artifact Truth，调用时不注册工具并持久化总结。工具完成但总结失败时 durable loop 收敛为 completed，避免重开后仍显示“执行中”；工具活动汇总改为“运行 N 次”以消除状态歧义。SimpleChat 运行期间新增最多 5 条待发送队列，任务完成并完成 SQLite 对账后自动发送。本轮按用户要求未运行测试或 Electron 验收，因此这些新增行为仍待阶段门验证。 |
| 2026-08-06 | active checkpoint | 上述新增实现（`7e02f07` summary-only 重试面、`de83c58` 运行中排队）已经 `npm run g0:result-studio:ux1h` 全门验证通过：syntax、Node/前端 24/24、strict TypeScript、真实 Electron 验收链 EXIT=0（`passed:true`）。注：本次运行需 `env -u ELECTRON_RUN_AS_NODE ELECTRON_DISABLE_SANDBOX=1` 与系统 Node 23（better-sqlite3 ABI 131）。`retry-summary-does-not-rerun-tool.json` 证据仍缺，"重试不重跑工具"行为门未闭合 |
| — | pending（下一阶段：终态分离设计） | **UX1H 最后一个大阶段：task"工具完成、总结分离"终态设计**。主线评估已否决"工具完成后强行切断总结流"（现有 cancel 会把会话写成 `cancelled`，破坏 Job/Artifact Truth 与会话持久化）。本阶段为 durable loop 设计一个合法终态（工具 completed + 总结 detached/可独立重试），约束：① 不动 cancel 语义；② 不动 `run_tool → tool_job → artifact truth` 唯一执行真相；③ 不引入第二执行器/第二 Job 表；④ 总结保持"可重试、失败 fail-soft 不掩盖工具成功"。先产出设计（含状态机迁移与持久化影响分析），实现后再做一次阶段级验收（补齐 `retry-summary-does-not-rerun-tool.json`） |
| — | pending | 完成主对话与长工具执行的完整 async surface；验证本次 summary-only 重试确实不重跑工具。未完成前不将本计划或 UI-126 标为 `verified` |
| — | pending | 收口前按风险驱动运行 G-1 ~ G-5 与剩余行为门；开发中不重复运行长耗时 Electron 链，只有产品行为或验收脚本发生实质变化才重跑 |
| — | pending | 收口（同步 handoff、registry、UI audit、evidence） |

> 当前已进入实现检查点；本次目标展示组合有真实 Electron 证据，但 §4.2 的重试/完整异步行为尚未满足，计划继续保持 `active`。

---

## 8. 与其他计划的边界

| 计划 | 关系 |
|---|---|
| G0-SDC1-A | 上游；本计划假设其已收口 |
| G0-RS-UX1A~UX1G-2 | 上游；本计划承接其"主对话"边界，不修改 Job/Artifact/Selection 真相 |
| G0-RS-P3 / P4 / P5 / P6 | 无关；不动 |
| P7-F | 显式不开；不写 `workspace_process_*`；不写 subagent 池；本计划只是 UX1 范畴的"不锁死" |
| P7-A ~ P7-H | 无关；本计划不改 model gateway、不改 provider |
| SDC-2 ~ SDC-7 | 不动；本计划不动 Profiler / Binder / Adapter / Design Gate / Validator |
| UI-108 / UI-109 / UI-113 / UI-114 | 不动；本计划不冒充其 `verified` |

---

## 9. 收口判据（Closeout）

满足以下全部条件才能把本计划从 `active` 切到 `completed`：

1. §4.1 全部硬门通过
2. §4.2 行为验收 A-1 ~ A-7 全部通过
3. §4.3 静态边界 S-1 ~ S-5 全部维持
4. 写入 evidence 三份：
   - `acceptance/g0-rs-ux1h/async-tool-surface.json`
   - `acceptance/g0-rs-ux1h/summary-failure-renders-soft.json`
   - `acceptance/g0-rs-ux1h/retry-summary-does-not-rerun-tool.json`
5. `npm run docs:check` 绿
6. `npm run ui:audit:check` 绿
7. `docs/project-workspace-handoff.md` 同步本计划收口事实
8. `docs/DOC-REGISTRY.json` 把本计划从 `active` 改为 `completed`
9. `docs/AUDIT-LOG.md` 追加一行"本计划收口"
10. **不升级** `qualificationEligible:false`、**不升级** UI `in_progress` → `verified`

---

## 10. 暂未决定的项

- [ ] 是否在本计划收口后启动"完整"子 agent 工作包（用户拍板）。
- [ ] `retrySummary` 按钮的可见性：始终可见 / 仅在 LLM 失败时可见（实现时定）。
- [ ] 主对话"已发起后台任务"卡片的复制按钮：是否允许复制 `toolJobId`（用户拍板）。
- [ ] **终态分离设计待决**（下一阶段设计稿回答）：新终态的命名与持久化形态（独立终态 vs completed + summary 子状态）；历史 running/已完成数据的迁移策略；总结 detached 后会话恢复时的事实来源（以 tool_job 为准还是会话消息为准）；失败总结的 retry 上限与退避。
