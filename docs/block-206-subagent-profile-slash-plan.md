---
capability: subagent-profile-declarative
goal: BLOCK-206 = runlist W7a（阶段 4 C-1）＝ **子智能体 profile 声明式配置面**（profile 字段可声明可校验；与并发/汇报门默认值对账）+ **C-29 斜杠即执行抽单元**（把 `executeSlashCommand` 从 1664 行组件抽成可测单元，给竞争力清单 D15 挂真锚）。
acceptance:
  - P0 基线：`test/block206-subagent-profile.test.mjs` 前两例冻结——①`spawn_agent` 现有参数面（task/model/instructions/goals/todoRefs/role）与 `concurrency_limit` 软上限语义；②并发/深度上限来自 `runtime` 族（1–8 / 1–3），profile 不得引入第二套数字。
  - P1 schema：族 `subagent-profile`——`subagentProfile.default`（string，可空）+ 条目字段 `<item>.{name, role, model, concurrency, reportGuard}`。**对账条款**：`concurrency` 的 domain 必须与 `runtime.spawnConcurrency` 的 domain 逐字相等；profile 只能**收紧**（spawn 时取 min），不能放宽。
  - P2 落点：`helpers/subagent-profile.js`（`subagent-profiles.json`，走 `data-paths`）：读宽容/写消毒/`resolveProfile(name)`/`listProfiles()`/`resetProfiles()`；未知 profile 名 fail-closed（与 `agentRoles.resolveRoleOrError` 同语义）。
  - P3 接线：`spawn_agent` 增可选 `profile` 参数（缺省=零行为变化）：profile 提供 `role`/`model` 缺省、`concurrency` 只能把软上限**调低**、`reportGuard` 目前只接受 `inherit`（其余值在写侧 400，理由=汇报门是全局接点，逐子任务覆盖要改 `report-guard` 契约，属 reopen）。
  - P4 证据：`spawn_agent` 的 profile 解析与 min-收紧要有单元测；`profile` 未传时行为与基线逐字相同。
  - P5 C-29：`executeSlashCommand` 的"决策"部分抽成 `SimpleChat/slashExecute.ts` 纯函数（输入 commandId + 依赖，输出动作描述），组件只负责执行动作；新增单测作为 D15 锚，并更新 `evals/anchors/competitiveness-8d.json`（claim 改写 + 挂 unit 锚 + `--update` 棘轮留痕）。
  - P5b 收尾：`config-transfer`/`config:doctor`/漂移门 `NO_UI_FAMILIES` 接入；closeout 十三门。
  - 完成语义：**profile 是"派发缺省值的声明"，不是第二套权限系统**——不动 policy/审批/四档判定；结构化 chip（`slashSources.ts` 里登记的 v2）不在本包范围。
reopen: 结构化 chip 注入通道（slashSources v2）；逐子任务 reportGuard 覆盖（需改 report-guard 契约）；profile 的 UI；按 profile 的工具子集（等 W7b 信任级别落地后再做，避免与权限系统重叠）。
status: completed
---

# BLOCK-206 · 阶段 4 C-1：子智能体 profile + 斜杠即执行抽单元

执行序位置=`docs/stage-3-4-execution-runlist.md` 的 **W7a**（W0–W6 已 completed）。用户发令：2026-10-18「行！ 搞完 W7a」。

## 0. P0 勘察（实码）

- `spawn_agent`（`agent-tools/spawn-agent-tools.js:208`）现有参数：`task` / `model` / `instructions` / `goals` / `todoRefs` / `role`；并发软上限来自 `resolveSpawnConcurrencyLimit()`（`runtime` 族，1–8），深度 `resolveSpawnMaxDepth()`（1–3）。
- 角色注册表已存在（`agentRoles.resolveRoleOrError`，BLOCK-93）：**profile 不替代它**，而是"一次声明一组派发缺省值"。
- 汇报门是**全局接点**（`report-guard.js`，默认关），逐子任务覆盖会改其契约 ⇒ 本包只允许 `reportGuard: 'inherit'`。
- 斜杠：`SimpleChat.tsx:1322` 的 `executeSlashCommand` 是组件内 `useCallback`，switch 里混着 UI 动作与网络调用（compact）⇒ 无法离线断言；C-29 要求"抽成可测单元"才能挂锚。

## 1. 红线

- **profile 不是权限系统**：不动 `agent-tool-policy` / 审批链 / 四档判定；profile 只能收紧并发，绝不能放宽。
- **未传 profile = 零行为变化**（基线先冻结）。
- **未知 profile / 未知字段 fail-closed**（与 role 注册表同语义）。
- 不碰凭据、不新增依赖、不碰 G1+。

## 2. 落地记录（2026-10-18）

- **P1+P2**：schema 加 `subagent-profile` 族（`default` + `name/role/model/concurrency/reportGuard`）⇒ 注册表 **15 族 / 81 键**；`helpers/subagent-profile.js`（`subagent-profiles.json` 走 `data-paths`；读宽容、写整份消毒、`resolveProfile` 未知 fail-closed）。
- **对账条款落地**：`subagentProfile.<item>.concurrency` 的 domain 与 `runtime.spawnConcurrency` **逐字相等**（测断言）；`effectiveSpawnConcurrency = min(runtime, profile)` 抽成纯函数并单测——**只能收紧、永不放宽**。
- **P3**：`spawn_agent` 增可选 `profile`（未传=零行为变化）：profile 提供 `role`/`model` 缺省、并发取 min；`reportGuard` 只收 `inherit`（逐子任务覆盖汇报门要改 report-guard 契约=reopen）；profile 名落 params 可观测。
- **P4 写面**：`GET/PUT /api/subagent/profiles`（400 + diagnostics；重名/悬空 default/未知字段/域外值全拒）；`config-transfer`/`config:doctor`/漂移门 `NO_UI_FAMILIES` 接入。
- **P5（C-29）**：`executeSlashCommand` 的判定抽成 `SimpleChat/slashExecute.ts:classifySlashCommand`（组件只执行副作用），新测 3/3；`evals/anchors/competitiveness-8d.json` 的 `5-slash-execute` 改写 claim 并挂 **unit 锚**，`block195-anchors --update` 已提升基线。
- **证据**：block206 5/5 + 漂移/基线/transfer 26/26 + slash 3/3；lint/tsc 待跑（见下"未完成"）。

## 3. 遗留与更正（如实登记）

- ~~closeout 十三门未跑~~ → **已跑并 PASS**（2026-10-18；含 code-size 棘轮当场抓到 SimpleChat +2 行，删冗余注释回 2142 并重打指纹，未抬基线）。
- **评测基线漂移（重要）**：`context_snapshot` golden 指纹 `dfc9be7b986a1c17` vs 基线 `9bb90c149e001115`，原因行=「system prompt 文案变更」；**已用 stash 验证与 W7a 无关**（W7a 改动移除后同样漂移）。**W6 收口时我写的"指纹未变"因此不成立**——当时用的是单测（只验归一化机制），不是 golden fp 对比。已在 AUDIT-LOG 立 🟡 条目待归因，**未**重基准（归因清楚前不得 `--update-snapshot`）。
