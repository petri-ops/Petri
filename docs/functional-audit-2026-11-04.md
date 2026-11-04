# 功能面审计报告（2026-11-04）

> 形态：专项 / 归因（TASK-FORM-TAXONOMY §3）。产出=结论，不是功能。
> 账本锚点：`docs/AUDIT-LOG.md` 同日四条 🟡 表行（本文件为详情指针目标）。
> 方法：四路并行只读审计（工具面 / 前端面 / 后端接线面 / 文档台账）+ 机械基线统计。**未修改任何产品代码**。

## 0. 基线

| 项 | 数值 |
| --- | --- |
| agent 工具定义 | 114（`core/petri-server/agent-tools/tool-defs.js`） |
| IPC 通道字符串 | 180（`src/ipc/channels.js`） |
| REST 路由文件 | 48 + harness 子路由 10 |
| 台账在制 | `ui-productization-audit` 28 条 `in_progress`；`AUDIT-LOG` 待处理项非 ✅ 10 条（全 🟡，无 🔴/🟢） |

台账口径纠正（避免误判）：

- `ui-productization-audit.md` 实际状态词只有 `verified` / `in_progress` / `cancelled`（+「判销」）；`implemented_unverified` 全仓仅 1 处，指 Result Studio（`AUDIT-LOG.md:142`），不存在以此标注的 `UI-###` 条目。
- 成熟度蓝图 25 种子已全 completed（`g0-agent-maturity-blueprint.md:175-181`）。
- 真正的 Q-MATRIX 在 `qoder-essence-absorption-plan.md`，最新计数 ✅73 / 🟡21 / 🔴0 / ⛔7（`AUDIT-LOG.md:83`；backlog 内 ✅72/🟡22/🔴1 为滞后旧值）。
- 竞争力纲 CP 19 包全 completed。

## 1. P1 — 与 computer-use 同型的断链（能力在，用户用不到）

### 1.1 `browser_act` click / fill 恒失败

- 硬门：`core/petri-server/helpers/browser-connector.js:117-120` 要求 mutating 动作携带 `ackToken`，否则 `ack_token_required`。
- 全仓 ackToken 产生点只有三处：`agent-tools/act-tools.js:154`（仅 `ui_action`）、`agent-tools/computer-use-tools.js:107`、`agent-tools/learning.js`（run_tool 重操作）。**browser 无任何签发路径**，REST 面 `routes/browser-connector.js:36-43` 直通无 mint。
- 更糟：契约 `sideEffect: external-request`（`agent-tools/registry.js:335`）不在 `MUTATING_SIDE_EFFECTS`（`agent-tool-policy.js:8`）→ policy 永不进入审批分支（`:157-162`）。
- 影响：浏览器写操作从 agent 面恒失败，UI 侧也无确认入口。**比 computer_* 更严重：连 token 都不存在**。

### 1.2 `workspace_worktree_remove` 死工具

- 契约 R3（`registry.js:312`）→ policy 无条件 deny（`agent-tool-policy.js:264-266`，位于所有档位/审批判定之后，无豁免）。
- schema/handler/元数据三全（`tool-defs/worktree.js:36-47`、`registry.js:166`、`tool-metadata.js:37`），前端无 worktree 面、core 无路由 → 无任何通道可通过。

### 1.3 默认执行目标设置静默无效

- 写入：`frontend/src/components/desktop/DesktopSettingsPanel/sections/RemoteTargets.tsx:94-96` → `petri.executionTargetId`（点号形态）。
- 读取：`frontend/src/components/copilot/SimpleChat/hooks/useChatStream.ts:363-365` → `readBrandStorage('executionTargetId')`。
- `frontend/src/lib/brand.ts:29-34` 只尝试 `petri-<key>` / `gewu-` / `biof3-` / `biof3.` / `biof3_`，**不含 `petri.`**，且 `LEGACY_TARGET_STORAGE_KEY` 与 `DEFAULT_TARGET_STORAGE_KEY` 同值（`RemoteTargets.tsx:94-96`）→ `??` 回退分支永不触发。
- 影响：设置「计算与数据 → 默认执行目标」（含联邦节点「设为默认」）后分析仍在本机执行，**零提示**。

### 1.4 `needsApproval` 元数据轴零读取者（横切根因）

- 声明：`core/petri-server/agent-tools/tool-metadata.js:23-187` 全表。
- `core/` 与 `frontend/src` 无任何读取点（唯一读在 `test/block109-p2-tool-metadata.test.mjs:77` 的类型断言）；调度只消费 `readOnly/concurrentSafe`（`agent-loop-control.js:572`）。
- 影响：审批意图纯装饰。computer_* 与 browser_act 的断链能长期不被门禁发现，根因在此。

## 2. P1 — 静默失效（看起来成功，实际没做）

| # | 现象 | 证据 |
| --- | --- | --- |
| 2.1 | `fix_enum_or_range` 假修复：`clampParams` 只贴 `_repair` 标记、参数未变，上层仍返回 `isActionable: true` → 「已修复」重试必复现同一错误 | `core/shared-backend/loop-repair-strategy.js:867-874`（调用点 `:429`，返回 `:430-444`） |
| 2.2 | 3D `provider=mock` 与真实同构：返回 `status:'ready'`、产出 BoxGeometry GLB，仅 `reason` 区分；下游只判 `ready` 即当真 | `core/petri-server/helpers/model3d-generation-provider.js:77-86`、`:261-263` |
| 2.3 | 侧聊窗档位锁死无提示：`lockedAccessMode="read"` 在 `useModelAccessMenus.ts:74-81` 直接 return，菜单四选项照常可点、无 disabled/说明 | `frontend/src/pages/window/SideChatWindowPage.tsx:96`、`SimpleChat.tsx:1803-1809` |

## 3. P1 — 安全口径破口

1. **`external-request` 逃逸桶**：该 sideEffect 不在 `MUTATING_SIDE_EFFECTS`（`agent-tool-policy.js:8`）→ 只读档（`:240-246`）与计划档（`:222-228`）不拦、observe 不记录（`:382`）。受影响：`delegate_to_petri_node`（只读档可远程执行他机）、`generate_methods`（只读档可写 project.database）。
2. **IDE MCP 写面绕过统一 policy**：`core/petri-server/mcp/ide-tools/file.js:38,53,66,79`（write/create/delete/rename）、`terminal.js:73`（terminal_write）不经 `decideAgentToolCall`，仅 path 白名单（`ide-tools/path-allowlist.js`），无契约/元数据条目。

## 4. P2 — 零消费端点与半接线

| # | 能力 | 现状 | 证据 |
| --- | --- | --- | --- |
| 4.1 | 联邦作业通道 | 后端三端点齐全，前端全文无 `/jobs` | `routes/federation-admin.js:259/296/314`；`Federation.tsx:136-284,626` |
| 4.2 | 科研任务计划/确认 + Loop 迭代 | 5 + 3 端点，前端只用 2 个 GET | `routes/harness/scientific-task.js:59-132`、`routes/harness/loop.js:33,137,160` |
| 4.3 | 模型白名单 | 后端 GET+PUT，前端只有 GET | `routes/ai-settings-api.js:48,58-69`；`ModelMenu.tsx:149-158` |
| 4.4 | Harness 环境包面板 | 纯只读、连刷新都没有；IPC 仅 list | `HarnessEnvironment.tsx:40-66`；`src/ipc/harness-capabilities.js:32-39` |
| 4.5 | `canCompare` 能力位 | 一处无人消费（只看加载态）、另一处硬编码 `true` | `ResultArtifactShell.tsx:1001`；`ResultStudioSurface.tsx:41` |
| 4.6 | 钉住快照预览 | markdown/spreadsheet/pdf 落到「无内嵌预览载荷」 | `ArtifactPinPane.tsx:143-153` |
| 4.7 | `/api/ai/reason-codes` | 前端零调用，原因码字典无 UI 出口 | `ai-settings-api.js:233` |
| 4.8 | `circuit-breaker.js` | 8.4KB 完整三态实现全仓零引用；实际生效的是 `agent-resilience.js:195-220` inline 版 → 三份熔断口径并存 | `helpers/circuit-breaker.js:13` |
| 4.9 | `federation-terminal.js` | 唯一挂载点在默认关闭的移动网关内 → 桌面默认态整体不启动 | `mobile-gateway/index.js:311`；`server.js:396-408` |

## 5. P3 — 契约与文案卫生

| # | 项 | 证据 |
| --- | --- | --- |
| 5.1 | computer 域 schema 漂移：`hwnd`/`summary`/`ref`(press) 实现消费但未声明；`computer_click.prefer` 声明但实现不读；`computer_authorize` 元数据与 R0 契约冲突 | `computer-use-tools.js:48-49,126,200` vs `tool-defs/computer.js`；`tool-metadata.js:152` vs `registry.js:342` |
| 5.2 | `skill_discover`/`skill_get` 双面参数名分叉（`categoryFilter` vs `category`；前端读 `args.name` 而 schema 是 `id`） | `tool-defs/skill.js:19,45` vs `mcp/registry.js:73`；`toolActivity.ts:568,570` |
| 5.3 | `skill_execute` 只在 MCP 面有，元数据却声明 needsApproval/high | `mcp/registry.js:104,847`；`tool-metadata.js:186` |
| 5.4 | `validateToolArguments` 不拒绝多余键 → 未声明键永不报错，只是模型猜不到 | `agent-tool-interceptor.js:61-65` |
| 5.5 | `tool-resource-sampler` win32 直接 `resolve(null)`，与「采样失败」同形、无原因码 | `shared-backend/tool-resource-sampler.js:71-73` |
| 5.6 | 设置分区描述与内容不符（写「远程执行目标 + 数据占用」，实际还有网络代理/联网授权/环境包/回收站） | `DesktopSettingsPanel.tsx:563` vs `:570-588` |
| 5.7 | 桥缺失时整块静默 `return null`（投影/Web 宿主无「本宿主不支持」说明） | `HarnessEnvironment.tsx:32` 等 5 处 |
| 5.8 | `permissions.js` 注释自认 async dispatch 仍 placeholder | `helpers/permissions.js:188-198,199-217` |

## 6. 已核实完好（避免误判为全坏）

- 审批链其他形态：`GuardAckCard` 覆盖 dynamic_guard / user_rule / mcp_trust，并因 `Boolean(approval)` 兜底覆盖 `tool_approval_required` 与 `loop_guard`；`ask_user_question` → `UserQuestionCard`；`act`(ui_action) → `useUiActionHost` + `POST /ai/act-ack/:token`。
- `run_tool` 两段式在子代理中未失效（复用父 conversationId，scope 校验一致）。
- 工具结果展示面覆盖（`toolActivity.ts` 动词表 + 图标表），无「注册了连活动行都没有」的工具。
- 放权坡道、逐工具审批策略、联邦面板主体、移动网关、SSH 目标 CRUD、轨迹/模型 I/O/证据面、全部路由可达性。
- 三条 feature flag（`server_history_assembly` / `session_compaction` / `agent_resilience`）均有真实读取者与调用点。
- `routes/index.js` 46 项全部挂载；定时器/订阅启动齐备；抽查数据表与 JSONL 无孤儿。
- 诚实降级白名单（非缺陷）：3D `none`/缺 key 的 `unavailable` + reason、APFS clone 非 darwin 的 `causeCode`、平台分支 executor、`fix_schema`/`fabricate_*` 禁止编造。

## 7. 修复批次建议（待裁决，未开工）

| 批 | 内容 | 覆盖条目 |
| --- | --- | --- |
| A（根因） | 审批载荷改工具无关 + `needsApproval` 声明与 UI 渲染的契约门 | 1.1 / 1.2 / 1.4 / computer P1 |
| B（静默失效） | 存储键收敛单源 + loop 修复返回参数 diff 或诚实失败 + mock 增加 `synthetic` 且下游强制区分 + 锁定档 disabled+原因 | 1.3 / 2.1 / 2.2 / 2.3 |
| C（零消费端点） | 联邦 jobs / 科研计划 / Loop / 模型白名单 / 环境包 / reason-codes / canCompare / 钉住预览 | 4.1-4.7 |
| D（安全面） | `external-request` 纳入 mutating + IDE MCP 写面接 policy | 3.1 / 3.2 |

## 8. 审计边界（诚实声明）

- 未做 114 工具 × schema 的全量脚本对账；仅逐键人工核对 computer / worktree / skill 三域，其余域为名单级核对。建议把对账脚本做成门禁（可并入 BLOCK-345 P4）。
- `helpers/workflow-journal.js` 读取面、`notify-feishu.js` 未逐条验证。
- Provider 矩阵 / packaged / 签名 / i18n 属 G1+，按阶段纪律不列。
- 台账 28 条 `in_progress` 中 13 条（UI-382~390、458/459/471/526/532/535、389）属「代码完成、仅缺实机数据/环境」，不应视为未实现。真正需查代码的仅 UI-513（跨端偏好同步 UI 面未交付）、UI-534（MCP 货架治理控件未交付）、UI-663（未保存改动列清单返回空，疑代码缺陷）。
