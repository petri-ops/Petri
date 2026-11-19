---
capability: post-h9-optimization-blueprint-2026-11-10
status: completed
goal: 以 2026-11-10 当前 HEAD、当次十七门机械门禁取样、四路只读源码实证与 H7/393/394 既有验收证据为唯一事实基线，对十一维度做第四轮全量评估，并把「判据失真 + 兑现度 + 结构债」三类剩余问题转成不设工作量上限、但设证据上限的分阶段优化计划；核心目标是优化项目、增强使用体验。
acceptance:
  - 十一维度均有当前源码锚点、复核评分、剩余缺口与优化目标，逐条可追溯到 file:line 或当次读数
  - 每个阶段有目标、具体改进点、优先级、依赖、blocker 分类与出口判据
  - 不重复 W/S/H 三轮已闭合的发现，不回溯改写任何历史评分或终验结论
  - 本文件是多包程序文档（kind=living-plan，status=planned），不占单包串行槽位；各 K 阶段发令时各自注册 work-package
  - 未取数的门禁、未闭合的证据、在制 WIP 引起的门红如实标注，不写成通过
reopen: 源码、基线、门禁读数、工作区状态、在制 H10 收口结果或 active 工作包变化后，先重跑 §1.2 门禁与受影响维度复核，再执行对应阶段
---

# 第四轮全量评估与下一阶段优化蓝图（2026-11-10）

> 用户裁决依据：「全面评估项目的各个方面，我需要了解每一个细节，并据此建立一份蓝图，作为下一阶段的工作计划。不要设定工作量上限，核心目标就是优化项目、增强使用体验。」
> **定位**：第四轮方向蓝图，承接 [`next-stage-optimization-blueprint-2026-11-06.md`](./next-stage-optimization-blueprint-2026-11-06.md)（W0–W7，NSO 全程序已收官）、[`post-nso-optimization-blueprint-2026-11-06.md`](./post-nso-optimization-blueprint-2026-11-06.md)（S0–S7，BLOCK-375～383 已收官）、[`post-s7-optimization-blueprint-2026-11-09.md`](./post-s7-optimization-blueprint-2026-11-09.md)（H0–H7，BLOCK-385～392 已收官）以及其后的 [BLOCK-393](./block-393-post-s7-remaining-work-plan.md) / [BLOCK-394](./block-394-agent-side-remaining-work-plan.md) 两批剩余工作清偿。**不重复旧发现、不改写旧评分、不新建第二份当前状态真相**；只登记「到 2026-11-10 为止仍未闭合」的事实与下一阶段候选工作包。
> **形态**：`planned` 程序文档（`kind=living-plan`，多包并列于一个程序之下，不占单包串行槽位）。每个 K 阶段发令时各自是一个正式 work-package，按单工作包串行纪律逐阶段收口；正式 BLOCK 编号在发令时按 `$petri-project-governance` 分配，本文不预占编号。
> **波次命名**：W → S → H → **K**（跳过 I/J 避免与数字 1 及 Jev 工具名混淆）。
> **阶段纪律**：G0 开发期常态 · 不外推 packaged/Provider/GA。

---

## §0 执行摘要

### 0.1 一句话结论

前三轮已经把「有没有实现」解决到 eleven 维平均 4.2、19 门机械门禁常态全绿；**第四轮的瓶颈不再是「还缺什么功能」，而是「尺子准不准、已定义的能力有没有真正生效、结构上还能不能继续长」**。当次实证抓出一类前三轮没有系统处理的问题：多条被当作优化依据的判据已被实测推翻（`全量 DOM` 前提被服务端 `LIMIT 100` 证伪、`content-visibility` A/B 无可测收益回滚、热栈 5 轮被当作冷启动 ×5、400/800 档与 100 档读数相同），以及四类「定义已在、生产未兑现」的通用 agent 主链缺口（MCP 链计量、权限粒度、`goals` 工具定义、viewer 能力位）。因此本轮主线 = **先校准判据与干净树（K0），再补兑现度（K1/K2），再做体验与结构（K3/K4），最后把证据与边界钉死（K5/K6/K7）**；不是继续加能力，也不是把旧清单再抄一遍。

### 0.2 本轮新增结论（相对 H7 终验 + BLOCK-393/394）

1. **判据失真成第一类问题**：`GET /api/ai/conversations` 硬 `LIMIT 100`（`core/petri-server/routes/ai-conversations.js:71`）使 H8 DOM 8 档实测中 400/800 档与 100 档同为 7202 节点（`acceptance/post-s7-2026-11-10/h8/dom-budget-live.json:438-440,506-508`），BLOCK-393 已判「B-09 全量 DOM 前提不成立」；`h9/cv-ab.json:9,13,25,34-36` 的 A/B 为 0.7ms vs 0.7ms → `rollback-no-measurable-gain`。11-09 蓝图 §2.2/§2.7 仍把「全量 DOM」列为改进点，**旧判据需先作废再重立**（K0）。
2. **当次十七门取样 15 绿 2 红**：`docs:check` 528 注册 PASS、`quality:perf` 5/5 全绿（cold_start 547ms / long_conversation 21ms / packaged_start 471ms）、`quality:ear` 926/2143 = 43.2%；**`ui:audit:check` exit=1**（工作区 UI 改动未同步台账）、**`quality:lint` exit=1**（两轮错误源不同：`tmp-b22-complete.mjs:30` → `frontend/src/components/copilot/errorMessages.ts:19,44`，2374–2376 warnings）。两门红均归属**活跃的并发在制 H10**，不是产品代码回归；按纪律不代改、不写成通过、也不写成产品缺陷。
3. **在制 WIP 在观测期间持续增长**：会话起始 3 项 M + 14 项 untracked，取样结束时 10 项 M + 20 项 untracked（新增 `core/petri-server/server.js`、`src/main.js`、`src/ipc/startup-timeline.js`、`test/impact-map.json`、`scripts/post-s7-*.{mjs,cjs}`、`treeRoving.test.ts` 等），`acceptance/post-s7-2026-11-10/h10/` 新增 `cdp-event-projection.json`。**存在活跃并发写入者**，本蓝图全程零触碰其文件面，也不跑 `test:changed` / `closeout` 聚合门。
4. **H10 在制证据只能登记为候选，不能计入已交付**：`cascade-scan.json` 16 条 CASCADE DDL / 11 条显式 delete；`cycle-clusters.json` 12 环全部归因到已知根因；`unmapped-decay-batch2.json` 120 → 90（assigned 30）；`color-baseline.json` 354 处；`cdp-event-projection.json` `verdict=measured / allMapped=true / bannersOk=true / humanEyeEquivalent=false`。这些是其 owner 的在制产物，本蓝图只作重开条件指针。
5. **通用 agent 主链有四类「定义未兑现」**（本轮四路源码实证新登记）：`core/shared-backend/ai-usage-helper.js:6,25-30` + `core/petri-server/mcp/registry.js:333` → MCP 执行链不写 `ai_usage`，成本熔断只覆盖 `agent-runner` 主链；`core/petri-server/helpers/permissions.js:21-23` `tools_only` 解析但未强制；`agent-tools/tool-defs/goals.js` 3 个定义未被 `tool-defs.js:13-30` 的 16 域 facade require；`viewerRegistry.ts:58-62,69-86` 6 个 adapter 能力位仍全 false。
6. **性能债的真实形态被重新定位**：不是「前端全量渲染」，而是服务端数据面 —— `ai-conversations.js:71` 会话列表无分页参数、`:145` 每页额外 `COUNT(*)`、`:150` `meta_json` 逐条 parse、`:178/:244` export/fork 全量 SELECT、`:248-251` fork 逐条 INSERT 无事务；`agent-task-store.js:596-607` 默认 `limit=500` 但 ≥15 个生产点传 `1_000_000`；`routes/ai-agent/events.js:130-156` 每条 SSE 连接 500ms 轮询 + 15s 心跳。
7. **机械门禁密度已显著上升但口径未统一**：`gate:silent-catch` 92 文件 / 395 处、`gate:user-assets` 9 项、`gate:version-parity` 10 处、`gate:css-modules` 白名单 13→11、`knip` 330 键、`arch-cycles` 12 环、`code-size` 24 文件 23511 行 / 16 生效例外；但 `closeout` 门数在 11-09 文档里写 16/17、11-10 实录为 19，perf 读数 554/22/13/489 与 545/21/12/463 并存，rAF 8.3/9.3 与 8.4/10.3 并存（§1.5 冲突清单）。
8. **真实任务证据仍为空且不可由 Agent 补**：8 任务 0/8 全为环境因（凭据 0 key、presets=0、出网仅 HTTP 401），`gap-ledger` 计 `external-blocked=1`；人眼项 `pending_human_eye=1` + `humanRequiredCounts {no:27, split:5, yes:2}`。五类证据不得互相冒充。
9. **gap-ledger 34 条终态已刷新**：done 17 / done-partial 14 / retain-with-reason 1 / pending_human_eye 1 / external-blocked 1；`agentSideProgram` = 12 completed + 11 completed-with-declared-exception。本蓝图只接手「14 条 done-partial 的末步 + 1 条 retain + 本轮新登记缺口」，不重做 17 条 done。
10. **README/registry 台账滞后一处**：`docs/README.md:1` 仍写第三轮蓝图 `active（第三轮方向蓝图 · living-plan）`，而 `DOC-REGISTRY.json` 该条目已是 `completed`；`docs:check` 不判内容语义滞后，需 K0 对账。

### 0.3 十一维复核表（证据锚定评分）

口径沿用全量评估 §0.3：**5 = 当前证据下可长期托重，1 = 核心链路不可信；无证据扣分而不是给分**。前四列沿用既有 canonical（评估时 / NSO 后 / S7 复核 / H7 终验），第五列是本轮「四路只读源码实证 + 当次十七门取样」的**独立估值**，并列呈现、差值逐条归因，**不回溯修改任何历史分数**。

| 维度 | 评估时 | NSO 后 | S7 复核 | H7 终验 | **本次复核** | 目标 | 本次归因 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 功能完整性 | 4.2 | 4.3 | 4.4 | 4.4 | **4.4** | 4.7 | 平。16 域 facade / 168 通道 / MCP 单入口未动；本轮新登记 4 项「定义未兑现」属兑现度债，不因发现更多问题回溯扣分；8 任务套件仍 0/8（凭据缺失） |
| 性能表现 | 3.5 | 3.8 | 3.8 | 3.9 | **3.9** | 4.5 | 平。perf 当次 5/5 全绿、DOM 8 档与 rAF 270 帧读数机器可读；但**判据有效性下降**（全量 DOM 前提被证伪、cv A/B 无收益、热栈≠冷启动），证据增量与判据缺陷相抵 |
| 代码质量 | 3.3 | 3.6 | 3.7 | 3.9 | **4.0** | 4.5 | +0.1。393/394 新增 6 族机械门（user-assets / version-parity / lint 分域 / matrix-parity / dependency-parity / skill-integrity）与 prompt-injection 盘点；环 13→12、css 白名单 13→11。当次 `quality:lint` 红归属在制 WIP，2312→2374 warnings 与 16 例外仍在 |
| 可维护性 | 3.2 | 3.5 | 3.6 | 3.7 | **3.7** | 4.4 | 平。版本与 DB 路径单源已交付；五个巨型文件（`SimpleChat.tsx` 2079 / `tools-executor.js` 2080 / `result-studio-repository.js` 1793 / `workspace-tools.js` 1605 / `loop-orchestrator.js` 1579）未拆，W5b 逐刀纪律未开工 |
| 可扩展性 | 4.2 | 4.5 | 4.5 | 4.5 | **4.5** | 4.8 | 平。16 域 facade / `listTools()`+`callTool()` 单入口 / 168 通道注册制零改动；插件源三处装配仍三处 |
| 安全性 | 3.4 | 4.0 | 4.2 | 4.3 | **4.3** | 4.6 | 平。四项 webPreferences + 全局 sender 门 + CSP 三层 + zip 四道闸 + 凭据加密在册；本轮新登记 PiP 窗未显式 `sandbox/webSecurity` 且不在安全断言名单、统一 IPC 参数 schema 缺失、ADMISSION 默认 observe / FK OFF-ON 分裂仍属 U 类未裁决 |
| 用户界面与交互体验 | 3.7 | 3.7 | 3.8 | 4.0 | **4.1** | 4.6 | +0.1。`treeRoving.ts` roving tabindex、`StreamReconnectBanner` 三态 live region、Toast 有界历史、分屏 slider 语义的代码面已交付；但 `ui:audit:check` 当次红（在制 WIP）、debt 35（live-missing 13 / blocked 22）人眼未闭合，不冒 verified |
| 错误处理与边界情况 | 3.1 | 3.5 | 3.7 | 3.9 | **3.9** | 4.6 | 平。42 原因码 + 生产面未注册即红 + 静默 catch 棘轮（395）已由 H7 计入；四事件前端投影、SSE 断线注入三态、8 处空 catch 三分法后的实机末步仍挂起 |
| 测试覆盖 | 3.7 | 4.1 | 4.2 | 4.3 | **4.4** | 4.7 | +0.1。未映射 145→138→120（H10 在制候选 90）、分片 38→3、6 族新契约 + 当次 15/17 门绿；`test:changed` / `closeout` 因并发 WIP 本轮未取数，不复用历史全绿 |
| 文档完善度 | 4.3 | 4.5 | 4.6 | 4.7 | **4.7** | 4.8 | 平。`DOC-REGISTRY` 528/511、coverage 单写入者、`docs:reconcile` 0 validation issues；但 AUDIT-LOG 81KB > 50KB 建议阈、README 首行 status 滞后、UI 台账多口径（494/52/7 vs 488 uniqueIds vs debt 35）未对账 |
| 依赖与架构合理性 | 3.7 | 3.9 | 4.0 | 4.0 | **4.0** | 4.6 | 平。R1–R5 PASS、12 环受控、零新增依赖；三套 lock、typescript `^5.9.3` vs `^5.5.4`、uuid 三树漂移、FK 运行时分裂未动 |

**综合**：**三升八平零降**；达「每维 ≥4.4」出口 **4/11**（功能 4.4、可扩展 4.5、测试 4.4、文档 4.7）。三升全部来自 393/394 的机械交付，**本轮无产品代码交付故不产生新的升分**；两个当次红门归属在制 WIP，既不构成扣分也不构成加分。**差距集中在性能 3.9 / 可维护性 3.7 / 错误处理 3.9 / 依赖架构 4.0 / UI 4.1，全部卡在「判据与证据」而非「功能数量」**。

---

## §1 事实基线与证据边界

### 1.1 三轴口径

| 轴 | 事实 |
| --- | --- |
| 已交付基线 | `main` HEAD `6dc6ae86`（BLOCK-394 收口 + `closeout:full` 后干净树重生成产物），含 W/S/H 三轮全程序与 393/394 剩余清偿 |
| 在制候选（零触碰） | 会话起始 = 跟踪 3 项 + untracked 14 项；取样结束时 = 跟踪 **10 项**（含 `core/petri-server/server.js`、`src/main.js`、`src/ipc/startup-timeline.js`、`test/impact-map.json`、`test/impact-map-coverage-baseline.json`、`frontend/.../LeftPanel.tsx`）+ untracked **20 项**（含 `acceptance/post-s7-2026-11-10/h10/`、`scripts/post-s7-*.mjs/cjs`、`treeRoving.ts` 与其测试、10 项用户资产/临时目录）。**并发写入者活跃**，逐项归属见 `npm run state` |
| 当前 active | 层 1 串行槽位：**空**（新开串行包需用户裁决）；层 2 常驻计划：`G0-LF`（`docs/g0-living-foundation-plan.md`）。`AUDIT-LOG` 无 🔴/🟢 未决 |
| 本轮动作 | 只读核查、四路子代理源码实证、十七门逐门取样、形成评估与 `planned` 蓝图；**未改任何产品代码、未提交、未暂存、未清理 WIP、未跑聚合门** |
| 证据等级 | 当次命令输出 > Git/源码 > acceptance JSON > canonical 文档；历史「全绿」不自动复用 |

### 1.2 当次机械门禁真值（2026-11-10，逐门串行取样）

| 门禁 | 结果 | 读数 |
| --- | --- | --- |
| `docs:check` | PASS | 528 registered；AUDIT-LOG 81KB > 50KB 建议级提示 |
| `ui:audit:check` | **FAIL (1)** | 「当前工作区包含 UI 改动，但没有同步 `docs/ui-productization-audit.md`」——在制 WIP 归属 |
| `hygiene:check` | PASS | 无死链 / CRLF / 控制字节 / 桥退化；untracked 仅列出（34+ 用户资产） |
| `quality:secret` | PASS | 生产面 0，7 个 fixture + `acceptance/block-105/` 前缀豁免在册 |
| `quality:arch` | PASS | R1–R5 无违规，cruise 全新 |
| `quality:types` | PASS | `tsc --noEmit` 0 error（incremental） |
| `quality:lint` | **FAIL (1)** | 两轮取样均 2 errors / 2374–2376 warnings，错误源漂移（临时 `tmp-b22-complete.mjs:30` → `errorMessages.ts:19,44`）——在制 WIP 归属 |
| `gate:code-size` | PASS | 24 文件 23511 行 = 基线 23511；生效例外 16；预算 700 行 |
| `gate:arch-cycles` | PASS | 12 存量环在册，无新环 |
| `quality:knip:check` | PASS | 保留面 330 键冻结，无新增 |
| `gate:silent-catch` | PASS | 92 文件 / 395 处，基线 395 |
| `gate:user-assets` | PASS | 9 项受保护路径未入库/未暂存（tracked=6036 / staged=0） |
| `gate:version-parity` | PASS | 10 处跨语言字面量与 `schema-versions` 一致 |
| `gate:css-modules` | PASS | plain CSS 11 个，白名单 11 个（已收缩） |
| `quality:ear` | PASS | 926/2143 = **43.2%**（阈值 40%；manifest 43.3%；**45% 目标未达**） |
| `quality:perf` | PASS | 连续 5 次采样全绿；cold_start 547ms / long_conversation 21ms / packaged_start 471ms |
| `skills:check` | PASS | 11 内置（2 `skill.json` + 9 `SKILL.md`）+ 3 领域包 |

> 本表是**逐门取样**，不是 `npm run closeout` 聚合结果，15 绿 2 红。`closeout` 当前 19 门（固定 5 + 14 `--gate`，另 `skills:check` 作非阻塞 `--report`）；11-10 实录 `acceptance/post-s7-2026-11-10/h8/closeout.json` 为 19 门全绿，属 BLOCK-393 收口时的**历史读数**，不冒充本次现场证据。
> **未取数**：`test:changed` / `closeout`（并发 WIP 未收口，按定向纪律不跑聚合门）、`quality:surface`（会刷新两份 generated 产物 `generatedAt`，并发写入者在工作区，跳过）、`test:all:sharded`（有界长任务）。三者一律**不写通过、不写全绿**。
> **取样副作用已复原**：`ui:audit:triage` 跑了一次只为读取 UI 台账分诊计数（`sections=497 / uniqueIds=488 / verified=450 / debt=35`），写盘仅刷新 `acceptance/block-332/ui-ledger-triage.json` 的 `generatedAt` 一行，已逐字复原为会话起始值，**不作为新证据、不进入本轮交付**。
> **两个红门的处置边界**：属在制 UI/源码改动未同步台账与临时文件残留，其 owner 收口时清零；本蓝图不代改 `docs/ui-productization-audit.md`、不删临时文件、不放宽 `eslint-suppressions.json` 基线。若干净树上重跑仍红，才升级为产品/契约缺陷走 P0。
> **自指读数注记**：本蓝图与其 registry 条目落盘后，`npm run docs:coverage` 重算为 `documentCount=529 / managedMarkdown=512`、`npm run docs:check` PASS 529 registered、`docs:reconcile` 0 unregistered / 0 validation issues。上表的 528/511 是**注册前基线**，529/512 是本轮自身产物引起的增量，不是项目基线变化；后续引用须标明时点。

### 1.3 既有评估链与不重复原则

- 事实基线链：[`Petri-Desktop-Holistic-Evaluation-2026-11-06.md`](./Petri-Desktop-Holistic-Evaluation-2026-11-06.md)（十一维全量评估 + 24 条发现）→ W0–W7 → S0–S7 → [`block-382-post-nso-s7-final-report.md`](./block-382-post-nso-s7-final-report.md) → H0–H7 → [`block-392-post-s7-h7-final-report.md`](./block-392-post-s7-h7-final-report.md)（十一维五列复评）→ BLOCK-393 / 394 → 本文（K0–K7）。
- **已闭合、不再列为改进点**：errorsAsRejections 全链、增量摘要、SSE `task.failed` 三态、FK 三面一致、链哈希 UPDATE、`file:` 注册制、字号宪章、prefs 重放、空 flags、inert、能力位、UI-697～702 实机腿、perf 连续判据、coverage 单写入者、执行准入四类拒绝 9/9、zip 四道闸 5/5、manifest 链三态、链校验默认 strict、原因码 25→42、静默 catch 棘轮、Toast 有界历史、版本与 DB 路径单源、AUDIT-LOG 超长行迁档、lastUpdated 分叉校验、17 条 done 缺口。
- **AUDIT-LOG 中已由用户裁决的延期/资格类 🟡 项**按既有裁决态保留，不重复登记、不推动状态变化。

### 1.4 证据等级与不可外推边界

五类证据不得互相冒充：①行为/契约测试；②机械门禁；③DOM 与 CDP 实机；④人眼观感；⑤真实任务成功。本蓝图所有 `verified` 级表述必须有对应类别的当前证据；`quality:surface` 的「矩阵可达」不等于任务成功，`quality:perf` 毫秒读数不等于用户观感，`closeout` 绿不等于 UI 在场（dev-infra §9 三面齐判定），`verdict=measured` 不等于视觉绿（`h10/cdp-event-projection.json` 的 `humanEyeEquivalent=false` 即范例）。

### 1.5 数字口径冲突清单（本轮新登记 · K0 对账项）

| 项 | 冲突读数 | 处置原则 |
| --- | --- | --- |
| `closeout` 门数 | 16（11-09 蓝图）/ 17（H7 笔录）/ 19（11-10 实录） | 以 `package.json:177` 的 `--gate` 数 + 固定 5 门机械计算为准 |
| perf 四场景 | 554/22/13/489（11-09）vs 545/21/12/463（BLOCK-390）vs 当次 547/21/-/471 | 不同轮次；以当次 `PETRI_PERF_EVIDENCE` 落盘证据为准 |
| rAF 帧时 | 8.3/9.3（BLOCK-393 叙述）vs 8.4/10.3（`h8/dom-budget-live.json:571-577`） | 以证据 JSON 为准 |
| reasonCode | 约 25（11-09 蓝图）→ 42（现册） | 以 `helpers/reason-codes.js:31-92` 为准 |
| 静默 catch | 403（H2 建立）→ 395（现基线） | 以 `test/silent-catch-baseline.json` 为准 |
| 未映射测试 | 145 → 138 → 120（H9）→ 90（H10 在制候选） | 在制候选不计入已交付 |
| UI 台账计数 | 标题计数 494/52/7、分段解析 488 uniqueIds / 450 verified、debt 35（13+22） | 三种口径各自成立，须在同一报告里标明口径，禁止混用 |
| EAR | 41.6% → 43.2%（当次）；manifest 43.3%；目标 45% | 分子分母同时报，不缩分母 |
| `POST-S7` 蓝图状态 | README 首行 `active` vs registry `completed` | 以 `DOC-REGISTRY.json` 为准 |

---

## §2 十一维度详尽分析

> 每维按「已兑现证据 → 当前缺口（带 `file:line` 与数字）→ 优化目标」三段展开；锚点来自本轮四路只读源码实证与当次门禁取样（2026-11-10，HEAD `6dc6ae86`）。

### 2.1 功能完整性 — 4.4 / 5

**已兑现**：`core/petri-server/agent-tools/tool-defs.js:13-49` 16 域 facade；`core/petri-server/mcp/registry.js:532,825,949-966` 与 `src/mcp-server.js` 的 `listTools()`/`callTool()` 单入口（3 Skill + 18 IDE + 运行时插件）；`src/ipc/channels.js:11-258` **27 域 / 168 通道**集中注册 + `test/ipc-channels-registry.test.mjs` 双向集合相等门；`src/preload.js` 4 处 `exposeInMainWorld`、140 处 `invoke` 包装（差额为 main→renderer 推送与 PiP 独立 preload，属设计）；`core/shared-backend/loop-controller.js:4-18` observe→decide→validate→record→evaluate 纯函数内核；`helpers/conversation-compaction.js` rolling 压缩、`helpers/agent-resilience.js` microcompact、`helpers/ai-usage.js` 计量与 `routes/ai-agent/cost-cap.js` 成本熔断；`frontend/src/components/result-studio/viewerRegistry.ts:30-42` 12 种 adapter；`resources/skills/manifest.json` 11 内置 Skill。

**当前缺口**：
- **MCP 链计量盲区**：`core/shared-backend/ai-usage-helper.js:6,25-30` 的 `recordAiUsage` 未注入即空函数，`core/petri-server/mcp/registry.js:333` 明写「桌面版不写库、helper no-op」；成本熔断只覆盖 `agent-runner` 主链（`routes/ai-agent/cost-cap.js:9-10`）。**通用 agent 五维里的「模型计量」在 MCP 执行链上不闭环**。
- **权限粒度未强制**：`core/petri-server/helpers/permissions.js:21-23` `tools_only` 解析但 `not yet enforced`，`:135,:197` 异步派发占位。
- **档位缺失**：`core/petri-server/mcp/ide-tools/contracts.js:11`、`index.js:107,120` `accessMode` 档位接入留 reopen，现仅 `confirm=true` 闸。
- **定义未接线**：`agent-tools/tool-defs/goals.js` 3 个 `type:'function'` 定义未被 16 域 facade require；`viewerRegistry.ts:58-62,69-86` 6 个 adapter 的 `canSelect/canCompare/canExport` 仍全 false。
- **平台桩**：`src/ipc/auto-update.js:4` 3 个 disabled stubs；`src/main/desktop-shell.js:179` 与 `desktop-shell-model.js:159,164` 返回固定 `{shown:false}` / `unsupported_*`。
- **能力位诚实降级 ≠ 已完成**：`resultSurface.ts:167` 明写 Result Studio 长期 `implemented_unverified / experimental`（P7 deferred），`g0/support-matrix.json` 3 平台 `unavailable`；按 G0 纪律属阶段常态，不列改进点。
- `acceptance/post-nso-2026-11-08/task-suite-round1.json` 8 任务 0/8（全环境因），`gap-ledger` 记 `external-blocked`；「结构化可达」与「用户任务成功」之间的证据链仍空。

**优化目标**：MCP 链计量与成本熔断同一真源；`tools_only` / IDE 档位 / `goals` 定义 / viewer 能力位四类逐件裁决为「接线」或 `retain-with-reason`，禁止零消费声明位继续沉积；`quality:surface` 的 165 个 `ipcUnusedInRenderer` 与 2 个只读 storage key 逐件销号；新增能力必须先有用户入口、审批、错误态与回归证据。

### 2.2 性能表现 — 3.9 / 5

**已兑现**：`scripts/block350-perf-gate.mjs:25-49,60-88` 双判据 + 连续 5 次采样 + 最差轮口径 + 缺样本即红，负测 10/10；当次 5/5 全绿；`helpers/conversation-compaction.js:100-109` 真增量摘要替代 O(n²)、摘要输入裁 60000 字；系统提示静态预缓存 + prompt cache 96.8% 命中、压缩每轮省 47.6% tokens；`mobile-gateway/agent-ws.js:16-17` 把 SSE 的 500ms DB 轮询降为事件总线即时推送 + 2s 兜底（8 subs / 16 inflight / 8s data 超时）；`WorkspaceSummaryCard.tsx:684-692` 6 个定时器合并为 1 个；`task_events` 30 天 retention（`agent-task-store.js:330-355`）。

**当前缺口**：
- **判据失真（最高优先）**：`ai-conversations.js:71` 硬 `LIMIT 100` 使 `h8/dom-budget-live.json` 的 400/800 档与 100 档同为 7202 节点 → 「全量 DOM」旧前提作废；`h9/cv-ab.json` 的 cv A/B 0.7ms vs 0.7ms → 回滚不改 CSS；`h8/startup-five-stage.json:10` 是**热栈 5 轮**而非冷启动 ×5。三条旧改进点必须先重立判据再谈优化。
- **服务端数据面**：`ai-conversations.js:71` 会话列表无分页参数；`:127` 消息 `clamp(1..500, 默认 100)`；`:145` 每页额外 `COUNT(*)`；`:150` `meta_json` 逐条 `JSON.parse`（历史上 `meta_json` 总体积达正文 6.9 倍、单条 39191 B）；`:178` export 与 `:244` fork 全量 SELECT；`:248-251` fork 逐条 INSERT 无事务；`src/migrations/*.sql` 34 处 + `db/schema.js` 19 处索引中**未见 `copilot_messages` / `task_events` 的复合索引**（分页靠 rowid）。
- **事件面**：`agent-task-store.js:596-607` 默认 `limit=500`，但 `routes/ai-agent/events.js:79`、`resume.js:122,161,209`、`task-actions.js:52,87,113`、`agent-runner.js:1082`、`spawn-agent-tools.js:187,722` 等 ≥15 个生产点传 `1_000_000`；`events.js:130-156` 每条 SSE 连接 500ms 轮询 + 15s 心跳；历史实测 `task_events` 236,087 行 vs `copilot_messages` 180 行（1,312:1）、`delta` 占 98.54%。
- **同步 IO**：`better-sqlite3` 全同步，`core/petri-server/**/*.js` 至少 141 文件命中同步 IO 调用；`block350-perf-collect.mjs` 同步直插 1000 行 / 写 520 文件。
- **未入门禁**：DOM 节点上限（唯一阈值 `scripts/block95-a2-frame-live.cjs:84` `<20000`，独立脚本非门）、滚动帧率（270 帧 P50 8.4 / P95 10.3 / max 26.7 / 长帧 0，仅取数）、冷启动五段（专项脚本**刻意不进常驻链**：依赖活 dev 栈，无栈必红 = fail-open 陷阱）、请求体五类占比、T7 去 `windowOverride` 的自然长任务。

**优化目标**：先修尺子（K0）再修数据面（K2）；会话列表分页 + 复合索引 + 去掉每页 COUNT + `meta_json` 按需投影；fork 事务化；`1_000_000` 传参收编为具名常量 + 上限契约；SSE 轮询复用既有 WS 事件总线而非新建第二通道；四场景连续 5 次 PASS 常态可复跑，DOM/帧率/五段判据在「有活栈才断言」的显式条件下入门禁且自带负测。

### 2.3 代码质量 — 4.0 / 5

**已兑现**：当次 `quality:types` 0、`quality:secret` 生产面 0、`quality:arch` R1–R5 PASS、`gate:code-size` 24 文件 23511 行、`quality:knip:check` 330 键、`gate:arch-cycles` 12 环、`gate:silent-catch` 395 处、`gate:css-modules` 白名单 11、`gate:version-parity` 10 处、`gate:user-assets` 9 项；`frontend/src/styles/theme-token-contract.test.ts` token 引用/禁 slate/暗色特异性/z-index 8 档/裸 font-size 清零等 17 族断言；负测文化成熟（perf / chain-hash / ipc-trust / exec-token / EAR / 表面矩阵 / user-assets / version-parity）。

**当前缺口**：
- **当次 `quality:lint` 红**：2 errors / 2374–2376 warnings，两轮错误源漂移；`security/detect-object-injection` 在测试与生产面广泛存在。抑制基线 100 文件 / 120 条「文件×规则」/ 191 处实际抑制，只许收缩不许放宽；lint 分域棘轮（production 154 / test 36 / scripts 1）已建但 warnings 总数无只减锚。
- **尺寸门盲区**：`core/petri-server/loop-orchestrator.js` 1579 行既不入 24 项 MANIFEST 也不在白名单（靠 `acceptance/post-s7-2026-11-10/h9/big-file-anchor.json` 独立锚兜住）；16 条生效例外中 15 条 `expires=2026-12-31`、1 条 `expires=2026-11-30`，靠到期续期维持。
- **主题字面量**：`ContextBudgetBar.tsx:38-54,66,113,188,249`、`OrchestrationGraph.tsx:22-26`、`ChatArtifactCard.tsx:43,149,186,239`、`PluginStorePanel.tsx:244,252,346` 颜色硬编码；`h10/color-baseline.json`（在制）记 354 处。
- **层级字面量**：`frontend/src/App.tsx:158,162` 壳层抽屉仍用 `zIndex:78/79`，未走 z-index 8 档 token（theme 门只扫 CSS 不扫内联样式）。
- **源码扫描契约**：`test/loop-orchestrator-subdomains.test.mjs:126-157` 用行数锚、`release-contract.test.mjs:97,109`、`block199-config-drift.test.mjs:182`、`nso-w5b-second-truth.test.mjs:46-72` 用 `src.includes(...)` 保护实现细节而非行为。

**优化目标**：两个红门在干净树上归零且不靠抬基线；巨型文件纳管并有真实拆分路线与行数只减锚；颜色/z-index 字面量按 token 阶梯收敛（含内联样式扫描）；warnings 设分域只减棘轮；源码扫描契约换成事件、状态机、错误码断言。

### 2.4 可维护性 — 3.7 / 5

**已兑现**：`core/shared-backend/schema-versions.js` 收编四常量与六处字面量（BLOCK-389）；`db-connection-policy.js:31-37,101-109` `resolveDbPath` + `openDatabase` 单源并认 `PETRI_DB_PATH`；`src/main.js` will-quit `closeAll` + WAL checkpoint；`helpers/reason-codes.js` 42 码封闭词表；`scripts/docs-governance.mjs` coverage 单写入者 + 分叉 fail-closed；`npm run state` 两层 active 语义显式化。

**当前缺口**：
- 五个巨型文件未拆（见 2.3）；`loop-orchestrator.js` 1579 行单文件承载 init/provider/tools/decision/finalize 五段。
- **插件源装配三处**：`mcp/registry.js:357-384`、`server.js:109-120`、`agent-tools/plugin-loader.js:749-769`；`agent-tools/tool-metadata.js` 的 `TOOL_METADATA` 与 `registry.js:306` 的 `CONTRACTS` 双表需跨表一致性锚。
- **W5b 逐刀纪律未开工**：「一切片 = 一会话 + 拆前拆后同套定向测试绿」，BLOCK-389/394 两次如实挂起。
- `knip.json:38` 把 `core/**/*.js` 全设 entry，动态点（`agent-tools/plugin-loader.js:152`、`learning.js:617`、`mcp/registry.js:305-335`）无法判死导出 → 330 键是上界不是精确债；`test/impact-map.json` 365 条规则仍有 120 条未映射（H10 在制候选 90，**不计入已交付**）。
- `docs/AUDIT-LOG.md` 81KB > 50KB 建议阈（`audit:compact` 幂等自稳已入 closeout 首步）；`docs/README.md:1` status 滞后。

**优化目标**：主链按职责拆为可单测单元（每刀同套绿）；插件源与工具元数据单源；动态入口显式注册；源码扫描契约换行为断言；账本只留活跃广播。

### 2.5 可扩展性 — 4.5 / 5

**已兑现**：16 域 facade、`mcp/registry.js:532` `listTools = skillTools + ideTools + pluginTools`、`:542-558` 每工具投影 `executionMetadata`、`registry-health` degraded 逐工具透传；`src/ipc/channels.js` 168 通道注册制；`mcp-projection.js` 把已连接 MCP server 工具投影为 `mcp_*`；Manifest v1 插件契约 + `pack:*` 分发通道；`skills:check` 11+3 契约齐。

**当前缺口**：
- 三份矩阵 `scripts/block357-capability-map.mjs`、`block352-shelf-audit.mjs`、`scripts/functional-surface-audit.mjs` 各自生成，无同源生成器与「人工改动判红」联动；`functional-surface-audit.mjs:420-424` 零消费端点检测是业务段子串命中的宽松启发式，路由正则只数 `app.(get|post|put|patch|delete)`，无 `router.*` / 动态挂载兜底。
- 165 个 `ipcUnusedInRenderer` 只登记不判红；2 个 storage key（`petri_token`、`petri.simplechat.extraRenderers`）只读不写；`src/preload.js:87-99` 与 `channels.js:258-260` 的 2 个 PiP 通道无 preload 包装（可解释例外但无机械豁免留痕）。
- `acceptance/block-118/corpus-doc-suggest.json:2284` 仍列已删的 `helpers/circuit-breaker.js`（语料化石）。
- `acceptance/post-s7-2026-11-10/h9/ipc-unused-triage.json`（H9）记 165 通道中 124 需接线 / 41 retain（在册，未逐件裁决）。

**优化目标**：三矩阵同一生成器重建且人工改动判红；表面矩阵补 `router.*` / 动态挂载扫描 + 消费方检测可信度负测；165 通道与 2 个 key 逐件销号或 `retain-with-reason`；新货架/工具仍走既有单入口与审批元数据，零新增依赖。

### 2.6 安全性 — 4.3 / 5

**已兑现**：`src/main/_window-create.js:134-143` 与 `src/ipc/window-manager.js:258-264,360-366` 三处创建点 `contextIsolation:true / nodeIntegration:false / sandbox:true / webSecurity:true`，`test/electron-security-assertions.test.mjs:25-35,59-107` 逐块断言；`src/main/csp-config.js:15-37,86-101` 应用级 CSP、`:40-85` OOPIF 网络栈阻断、`src/main/security-hardening.js:143-213` 劫持侦测三路、`gen-ui/csp.js` + `pack-ui/csp.js` 全禁面 CSP；`src/ipc/_ipc-trust.js:104-143` 一次性全局 `ipcMain.handle/on` 信任补丁（webview 一律拒、`file:` 注册制、其余 origin 精确匹配且空集合 fail-closed）；`src/ipc/_workspace-roots.js:26-44` realpath 反查 + `file-dialog.js` 写面双 guard；`src/plugin/zip.js:25-87` 四道闸（20000 条目 / 512MB / symlink / 路径形态）+ 5/5 真实 zip 负测；`credential-store.js` macOS Keychain / 其他平台 0600、`mcp-env-crypto.js` AES-256-GCM、`mcp-oauth-store.js` 10min 有界；`scripts/secret-scan.mjs` 8 模式 fail-closed。

**当前缺口**：
- **PiP 窗边界**：`src/main/computer-use-pip.js:67-72` 只声明 `contextIsolation/nodeIntegration/preload`，**未显式写 `sandbox`/`webSecurity`**，且不在 `electron-security-assertions.test.mjs:25-28` 的 `WINDOW_FILES` 名单；补偿靠自包含 preload 与 `file:` 注册制，但缺机械断言。
- **统一 IPC 参数 schema 未做**：W2 蓝图 `docs/next-stage-optimization-blueprint-2026-11-06.md:157-158` 的出口判据仍是台账声明；`_ipc-trust.js:29-37,88` 保留 `PETRI_IPC_FILE_SENDER_EXEMPT_IDS` env 豁免口。
- **dev CSP** 放行 `'unsafe-inline'` 与 `127.0.0.1:*`（`csp-config.js:16-21,103-107`）；`BrowserPanel.tsx:106-110` 结果 webview 允许任意 http(s) 远程页，靠 `security-hardening.js:88-132` 中和。
- **内存态不跨进程**：`guard-ack-store.js:13-14`、`approval-request-store.js:4-33`、`execution-admission.js:15-16` 均为进程内态，不跨会话/不落库；dev 双后端形态下凭证与审批可能脑裂（dev-infra §76）。
- **U 类未裁决**：`execution-admission.js:112-120` 默认 `observe`（工作区 `workspace_exec` 已真实消耗，但 `h9/structural-triage.json:14-22` 记 `tools_executor` / `ssh_direct_runner` 两入口显式 deferred）；`core/petri-server/db/connection.js:24-25` `foreign_keys=OFF` vs `src/database/_db-singleton.js:86-90` `ON`（179 违约未清偿）；`h10/cascade-scan.json`（在制）记 16 条 CASCADE DDL / 11 条显式 delete，属其 owner 的决策材料。
- `mcp-env-crypto.js:12-13` 对无 `enc:v1:` 前缀字符串透传（存量明文迁移语义），密钥文件与密文同在 data dir（本地主权形态，非 OS keystore）。

**优化目标**：PiP 四项基线补齐并纳入安全断言名单；统一 IPC 参数 schema 与 env 豁免口收紧；ADMISSION / FK 出「一页决策材料」交用户裁决，裁决前不改默认语义；prompt-injection 输入面盘点结论（H9 `prompt-injection-inventory.json` 7 处）逐件落地；任何新防线自带负测。

### 2.7 用户界面与交互体验 — 4.1 / 5

**已兑现**：`frontend/src/App.tsx:192-217` 主窗路由 + `:242-270` 独立窗路由、路由级 lazy、RouteErrorBoundary + Suspense、窄屏 AppRail 抽屉；`themes/ThemeProvider.tsx:31,55-70` 四轴偏好 + `prefsSync` + 30s×3 有界重放；`theme-token-contract.test.ts` 17 族断言；`ToastProvider.tsx:32-45,72-95` 有界历史（去重 / 上限 50 / 可清空）；`StreamReconnectBanner.tsx:3-14,18-48` 三态独立 live region；`treeRoving.ts:1-40` + `LeftPanel.tsx:442-472` roving tabindex（**在制文件，未计入已交付**）；`ArtifactPinPane.tsx:84-92` 分屏键盘 ±5 + slider 语义；`ResultsSurface.tsx:61-90` 右栏唯一宿主、四态局部化不进 URL；`ModelMenu.tsx` 供应商/模型下钻与禁用原因；`CommandPalette.tsx:103-105,234,250` dialog + Escape + 初始焦点。

**当前缺口**：
- **当次 `ui:audit:check` 红**：在制 UI 改动（`CenterPanel.tsx` / `project-workspace.module.css` / `LeftPanel.tsx` / `treeRoving.ts`）未同步台账，owner 收口前不得写 verified。
- **debt 35**（live-missing 13 / blocked 22），`humanRequiredCounts` 人眼项：`UI-702` 通知历史层级/长消息换行/暗色对比、`UI-694/695/697/698/699` 暗色观感、`treeRoving.ts:10` VoiceOver 读屏、断线注入三态截图、32 条 debt 终态化；`docs/post-s7-h7-human-eye-route.md` 路线已生成但**无签字记录**。
- **布局非单源**：`CenterPanel.tsx:203-213` 内外两层布局语义名已分离但仍在同文件多层嵌套；`project-workspace.module.css:1546,2836` 同名 class 两处定义（172KB 文件）；两处 `FloatCardResizeHandle`。
- **主题收敛**：颜色字面量 4 族（2.3）、`App.tsx:158,162` 内联 z-index 78/79；`CommandPalette` 未见显式 focus trap 循环。
- **四事件前端投影**：`compaction_failed` / `trim_skipped` / `provider_retry` / `stream_stall` 在 `frontend/src` 仍零直接消费（H10 在制 `cdp-event-projection.json` 为 `measured` 且 `humanEyeEquivalent=false`，**不计入已交付**）。
- **DOM/几何**：`SimpleChat.tsx:1536`、`LeftPanel.tsx:443,654,662`、`ResultsLibrary.tsx:58-94` 仍 `.map` 全量；但**必须先按 2.2 修正判据**，不再以「全量 DOM」为优化前提。

**优化目标**：任何状态下用户都知道「发生了什么、能用什么、为什么不能用」且失败可回看；四事件与 SSE 三态有断线注入实机证据；台账 debt 逐件终态为 verified / cancelled / retain-with-reason；布局与样式单源且几何量测 + 人眼过目双证；按产品人设把「本地主权 / 全链可审计 / 证据自证」做成可见形态（偏好标权威源、写动作给原因码与回看入口、界面显式标证据等级、失败诚实、通用 agent 主线不被领域形态挤占）。

### 2.8 错误处理与边界情况 — 3.9 / 5

**已兑现**：`loop-orchestrator.js:1484-1503`、`routes/ai-chat.js:329-338`、`agentTaskStream.ts:437-448` 的 done / error / `task.failed{reason,reasonCode}` 三态；`helpers/llm-client.js` → `model-gateway.js` → provider 的 `errorsAsRejections` 全链；`message-trimmer.js:69-97,160-174` tool 消息原子性；`tool-cancel-registry.js:23-53` 协作取消；`helpers/reason-codes.js:31-92` 42 码 9 类 + 生产面未注册即红；`gate:silent-catch` 按文件冻结 395 处 + 2/2 负测；`helpers/no-stream-subscriber.js:10-18` 三处 `onEvent:()=>{}` 改具名；`src/plugin/zip.js` 四类拒绝原因码；`delivery-manifest.js` 链三态 + `verify-artifact-chain.mjs` 默认 strict（118 版 0 legacy）。

**当前缺口**：
- 8 处生产空 catch 三分法**全部判豁免并补具名理由**（`gap-ledger.json:127-133`），机械门只挡新增、不证明存量已消除；`events.js:153-155` 轮询出错不终止；`copilotConversationsClient.ts:92-96,139-141` 等 8+ 处 `catch` 塌缩成 `[]/null/false`。
- 四事件无前端消费（2.7）；SSE 断线注入三态截图、64MB 上限分散在 mesh / 语义校验 / 远端读预算 / mmap / transcript 轮转，无单一入口。
- `execution-admission.js:103-104,114` observe 默认永远 ok 只审计不拦；`stale-running-reconciler.js:73-76` 对账器失败仅 warn；`build/afterPack.js` `PROBE_UNAVAILABLE` 静默放行（11-06 登记，本轮未复核）。
- 取消竞态：`events.js:158-163` 关闭订阅只清 interval、后台 loop 继续；AUDIT-LOG 在册「墙面板取消跨后端 15s 无效果」属 dev 双后端脑裂家族，非产品缺陷。

**优化目标**：所有失败有结构化原因码 + 可见 UI/轨迹态 + 明确可重试或不可重试；四事件接通前端投影并有反向契约测；空 catch 存量按三分法逐处清零并扩 `gate:silent-catch` 扫描根到 `frontend/src`/`scripts`；64MB 上限收进单一入口；断线注入实机 flow 三态断言落盘。

### 2.9 测试覆盖 — 4.4 / 5

**已兑现**：`test/` 约 700 个 `.mjs`（628 文件 / 5081 测试的全量分片读数）+ `frontend/src/**/*.test.ts(x)` 362（356 文件 / 2539 测试）；`test/impact-map.json` 365 条规则 + `impact-map-coverage-baseline.json` 只减棘轮 + `nso-w5-impact-coverage.test.mjs` 新测试不挂规则即红；`scripts/test-all-shards.mjs` 三段分片（默认串行、每段 45min 有界、exit 124/125 = unknown 不写 PASS）；红绿先行与负测文化；分片残红 38→3（2 条外部归属）。

**当前缺口**：
- **当次 `test:changed` / `closeout` 未取数**（并发 WIP），不得复用 H8 的 19 门全绿作本次现场证据；`acceptance/nso-2026-11-06/wave-0/full-test-shards/` 5 份 summary 全 `allPassed=false`，最新一轮 node-core failed / frontend passed / node-long passed。
- 120 条未映射按八簇消亡未推完（H10 在制候选 90）；源码扫描契约（2.3）；`test/loop-orchestrator-subdomains.test.mjs` 行数锚需随每刀刷新。
- 8 项 `humanEyePending`（`toolSelectJudge` / `artifactJudge` 占位）与 `results-v2final.json` 冻结判据表无人眼确认记录。
- `quality:lint` 当次红且错误源漂移，说明「在制文件进入 lint 扫描面」而 `hygiene:check` 只报告不拦截——两门之间缺联动（K0 改进点）。

**优化目标**：干净树上 `closeout:full` 连续 3 次 19 门 PASS、三段分片 0 未归因 fail；120 条按簇消亡且禁盲挂；行为契约替代源码扫描；每个新机械门自带负测；人眼判据集中落盘。

### 2.10 文档完善度 — 4.7 / 5

**已兑现**：`docs:check` PASS 528 registered / 511 managed；`scripts/docs-governance.mjs:191-196,238-262` coverage 单写入者 + `COVERAGE_COUNT_DRIFT` / `COVERAGE_LASTUPDATED_DRIFT` 双报警；`docs:reconcile` 当次 0 validation issues / 258 retained references / 0 manual review；`scripts/docs-roll-index.mjs` 按月滚动（搬移不改写）；`audit:compact` 幂等入 closeout 首步；acceptance 与解释文档分离；`DOC-REGISTRY.json` 528 条 status 分布 completed 394 / active 40 / planned 2 / reference 70 / superseded 5 / archived 17。

**当前缺口**：
- `docs/AUDIT-LOG.md` 81KB > 50KB 建议阈（当次 `docs:check` 建议级提示）；`docs/README.md:1` 第三轮蓝图仍写 `active` 而 registry 为 `completed`（§1.5）。
- UI 台账三口径（494/52/7 标题计数、488 uniqueIds / 450 verified 分段解析、debt 35 分桶）在同一报告里须标明口径；`scripts/ui-ledger-triage.mjs:35,58-59` 的否定语境已修，但口径说明未集中。
- acceptance 证据元数据 `platform` / `command` 仅对新产出强制，历史证据不回填（改写历史 = 伪造，已有裁决）；skills manifest sha256 小批未清偿；`docs:roll-index --check` 未完全脚本化入门禁。
- EAR 43.2% < 45% 目标；`npm run state` 与 registry 的两层 active 语义需在每个恢复者面前显式标注（已实现，需保持）。

**优化目标**：单一真相可机械恢复；`docs:reconcile` 候选逐件复核、README 入口行格式与 status 机械化对账；证据元数据齐 `sourceCommit / platform / command / generatedAt`；下一 Agent 只读 `state + AUDIT-LOG + roadmap + handoff + active plan` 即可接手。

### 2.11 依赖与架构合理性 — 4.0 / 5

**已兑现**：`.dependency-cruiser.cjs:36,43` 仅两处 `pathNot` 例外桥；当次 `quality:arch` R1–R5 PASS 且 `scripts/lib/arch-cruise.mjs:25-31` 单轮共享 cruise；`gate:arch-cycles` 12 环在册（H10 在制 `cycle-clusters.json` 12 环全部归因到已知根因）；`package.json:279` Electron 精确 44.7.0；全程零新增依赖；`gate:version-parity` 10 处跨语言字面量一致。

**当前缺口**：
- 三套依赖树：根 `package-lock.json` 300KB / `frontend/package-lock.json` 258KB / `core/petri-server/package-lock.json` 79KB，根无 `workspaces` 字段，靠 `postinstall` → `scripts/install-core-deps.mjs:13-25,37-40` 只装 petri-server 并只 rebuild `better-sqlite3` 一个 native 模块。
- 版本漂移：根 `typescript ^5.9.3`（在 dependencies）vs frontend `^5.5.4`；`uuid ^9.0.1` vs `^9.0.0` 三树声明；`better-sqlite3` / `archiver` / `pdfjs-dist` 同版本重复声明；`node-pty 1.1.0-beta34` 预发布钉扎、`occt-wasm 5.11.0` + `occt-import-js 0.0.23` 同族双包；根 `engines.node >=24`。
- FK 运行时分裂（2.6 U 类）；12 环无按簇消亡里程碑；`CenterPanel.tsx` 布局非单源（2.7）。
- 工具数量口径漂移：`tool-defs.js:8` 71、`test/block113-tool-prerouting.test.mjs:8` 84、`test/agent-tool-registry.test.mjs:189` 115 —— 历史快照与当前值并存，权威应取运行时 `getToolDefs()`。

**优化目标**：不新增依赖；版本与 native ABI 由单一清单 + 机械对账守住（`gate:version-parity` 扩面）；12 环按簇消亡并逐簇 `--update` 下调基线；FK 策略与运行时一致（需用户裁决）；布局与样式单源；工具数量口径统一到运行时单源。

---

## §3 剩余缺口总台账（按优先级 · 带 blocker 分类）

分级沿用评审纪律：**P0** = 正确性 / 安全 / 契约破坏 / 当前门禁真红 / 判据失真；**P1** = 可靠性、体验、可维护性实质影响；**P2** = 长期演进与清理。blocker 分类决定能否由 Agent 直接开工：`A` Agent 可做（需立项发令）· `L` 需实机/CDP 腿 · `E` 需人眼 · `U` 需用户裁决 · `V` 凭据/出网/平台 · `W` 在制 WIP 归属（需其 owner 收口）。

| ID | 级 | 锚点 | 现象 | blocker | 阶段 |
| --- | --- | --- | --- | --- | --- |
| K-01 | P0 | `ai-conversations.js:71` / `h8/dom-budget-live.json:438-508` | 「全量 DOM」前提被 `LIMIT 100` 证伪；400/800 档与 100 档同读数 | A + L | K0 |
| K-02 | P0 | `h9/cv-ab.json:9,13,25,34-36` | cv A/B 无可测收益已回滚，旧改进点仍写在 11-09 蓝图 | A | K0 |
| K-03 | P0 | `h8/startup-five-stage.json:10` / `post-s7-startup-five-stage.mjs:17` | 热栈 5 轮 ≠ 冷启动 ×5；五段门刻意不进链是 fail-open 陷阱 | A + L | K0 / K5 |
| K-04 | P0 | §1.5 九组数字冲突 | perf / rAF / 门数 / reasonCode / catch / UI 计数 / EAR 口径不统一 | A | K0 |
| K-05 | P0 | 当次 `ui:audit:check` / `quality:lint` | 2 门红归属并发在制 H10；lint 错误源两轮漂移 | W | K0 |
| K-06 | P0 | `git status` 10 M + 20 untracked / `h10/` | 活跃并发写入者；WIP 未收口前任何聚合门与取证都不可信 | W | K0 |
| K-07 | P0 | `README.md:1` vs `DOC-REGISTRY.json` | 第三轮蓝图 status 口径滞后；AUDIT-LOG 81KB 超建议阈 | A | K0 |
| K-08 | P0 | `ai-usage-helper.js:6,25-30` / `mcp/registry.js:333` | MCP 执行链不写 `ai_usage`，成本熔断只覆盖主链 | A | K1 |
| K-09 | P1 | `permissions.js:21-23,135,197` / `mcp/ide-tools/contracts.js:11` | `tools_only` 与 IDE `accessMode` 档位未强制 | A + U | K1 |
| K-10 | P1 | `tool-defs/goals.js` / `viewerRegistry.ts:58-62,69-86` | 3 个工具定义未接线；6 个 adapter 能力位全 false | A | K1 |
| K-11 | P1 | `ai-conversations.js:127,145,150,178,244-251` | 每页 `COUNT(*)`、`meta_json` 逐条 parse、export/fork 全量、fork 无事务 | A | K2 |
| K-12 | P1 | `agent-task-store.js:596-607` 等 ≥15 生产点 | `getAgentTaskEventsSince(1_000_000)` 无具名上限；复合索引缺位 | A | K2 |
| K-13 | P1 | `routes/ai-agent/events.js:130-156` / `mobile-gateway/agent-ws.js` | 每条 SSE 500ms 轮询 + 15s 心跳，WS 即时推送未复用 | A | K2 |
| K-14 | P1 | `helpers/trajectory-events.js` → `frontend/src` | 四事件前端零消费；SSE 断线注入三态缺实机证据 | A + L | K3 |
| K-15 | P1 | `h7-human-eye-route.md` / debt 35 | 人眼路线无签字；13 live-missing + 22 blocked 未终态 | E + L | K3 |
| K-16 | P1 | `CenterPanel.tsx:203-213` / `project-workspace.module.css:1546,2836` | 布局非单源、同名 class 双定义、两处 resize handle | A + L | K3 |
| K-17 | P1 | 4 族颜色字面量 / `App.tsx:158,162` / `h10/color-baseline.json` | 颜色与内联 z-index 未走 token（在制基线 354 处，不计入已交付） | A | K3 |
| K-18 | P1 | 五个巨型文件 / `loop-orchestrator.js` 1579 | W5b 逐刀未开工；尺寸门盲区与 16 例外靠续期 | A | K4 |
| K-19 | P1 | `mcp/registry.js:357-384` 等三处 / `tool-metadata.js` | 插件源装配三处、双表一致性锚 | A | K4 |
| K-20 | P1 | `release-contract.test.mjs:97` 等 4 族 | 源码扫描契约未换行为断言 | A | K4 |
| K-21 | P2 | `test/impact-map.json` 365 规则 / 120 未映射 | 八簇消亡未推完（H10 在制候选 90） | A + W | K4 |
| K-22 | P2 | `knip.json:38` / 动态 require 三处 | 330 键保留面是上界；动态入口未显式注册 | A | K4 |
| K-23 | P2 | `block95-a2-frame-live.cjs:84` / `post-s7-dom-budget-live.cjs` | DOM 节点上限、帧率、请求体五类占比、T7 自然长任务未入门禁 | A + L | K5 |
| K-24 | P2 | 三矩阵生成器 / `quality:surface` 启发式 | 三矩阵非同源、路由扫描缺 `router.*` 与动态挂载负测 | A | K5 |
| K-25 | P2 | `h9/ipc-unused-triage.json` 165 通道 | 124 需接线 / 41 retain 未逐件裁决；2 个只读 storage key | A | K5 |
| K-26 | P2 | `quality:ear` 43.2% / manifest 43.3% | 45% 目标未达，需靠分子增长并带负测守住 | A | K5 |
| K-27 | P0 | `computer-use-pip.js:67-72` / `electron-security-assertions.test.mjs:25-28` | PiP 未显式 `sandbox`/`webSecurity` 且不在安全断言名单 | A | K6 |
| K-28 | P1 | W2 蓝图 `:157-158` / `_ipc-trust.js:29-37,88` | 统一 IPC 参数 schema 未做；env 豁免口仍在 | A | K6 |
| K-29 | P0 | `execution-admission.js:112-120` / `db/connection.js:24-25` | ADMISSION 默认 observe、FK OFF/ON 分裂 + 179 违约；材料在册未裁决 | U | K6 |
| K-30 | P2 | `task-suite-round1.json` 0/8 / 8 项 humanEyePending | 真实任务连续成功证据为空；人眼判据未签字 | V + E | K7 |
| K-31 | P2 | 三套 lock / `typescript` 双版本 / uuid 三树 | 版本漂移与 native ABI 只对 better-sqlite3 | A | K4 |
| K-32 | P2 | `docs/README.md` / acceptance 元数据 / `docs:roll-index --check` | 证据元数据仅对新产出强制、roll-index 未入门禁、skills manifest sha256 | A | K5 |

> 合计 32 项：P0 10、P1 13、P2 9。凡 `U` / `E` / `V` / `W` 类，Agent 不得自行开工或代答；遇到即停线出材料，按 §5.3 推进下一可开工项。

---

## §4 阶段蓝图（K0–K7）

> K = 第四轮 Horizon。**不设工作量上限，但设证据上限**：任何没有当前证据的「完成 / 通过 / 可信」都不得写入收口报告。阶段内可切多个正式工作包，但同一时间只有一个 active 工作包与一个进行中阶段。

### K0 · 判据校准与可信起点（P0 · 全程序前置）

**目标**：把被实测推翻的判据作废重立、把九组数字口径统一、把并发在制 WIP 与两个红门交给 owner 收口，产出一份干净、可复跑、可机械恢复的起点。**本阶段不做任何优化**——尺子不准时优化会做在假问题上。

**依赖**：无（但串行上必须等在制 H10 收口）。**blocker**：A + W + L。

**具体改进点**：
1. **判据三作废三重立（K-01/02/03）**：①「全量 DOM」→ 重立为「服务端会话列表 `LIMIT 100` 导致视图截断」判据，先决定产品语义（分页 / 游标 / 明确上限提示）再谈渲染；②`content-visibility` 不再作为默认优化手段，改以「渲染耗时 A/B + 无可测收益即回滚」为唯一准入；③冷启动 ×5 与热栈 5 轮分开命名、分开取数，专项脚本保持不进常驻链但补「有活栈才断言」的显式条件契约。三条均落到脚本注释与负测，不靠文档声明。
2. **数字口径单一化（K-04）**：把 §1.5 九组冲突收敛为一份机器可读 `acceptance/<阶段>/k0-canonical-readings.json`，每条带 `source / command / capturedAt / sourceCommit`；文档引用一律指向该 JSON，禁止在不同报告里各写一份读数。
3. **在制 WIP 与红门协同（K-05/06）**：`npm run state` 输出 WIP owner 归属表；`ui:audit:check` 的红由其 owner 同步 `docs/ui-productization-audit.md`（状态用 `in_progress`，不冒 verified）；`quality:lint` 的红由其 owner 清零且不放宽 `eslint-suppressions.json`。**新增联动门**：`hygiene:check` 已报告未跟踪临时文件却让它们进入 lint 扫描面 → 补「lint 扫描根 ∩ hygiene 报告」对账，或在 lint 前显式排除未跟踪临时产物，避免同类第二次出现（评审 skill 回归→门禁转化）。
4. **干净树基线（K-06）**：WIP 全部有 owner / Plan ID 后跑 `closeout:full` 连续 3 次 19 门 PASS、`test:changed` 0 fail / 0 cancelled；`test:all:sharded` 三段 0 未归因 fail，超时结论为 unknown；skip 均有显式原因。
5. **治理对账（K-07）**：README 首行第三轮蓝图 `active` → `completed`（与 registry 一致）；`audit:compact` 把 AUDIT-LOG 压回 50KB 建议阈内（搬移不改写）；`docs:reconcile` 候选逐件复核；`docs:roll-index --check` 试跑并评估入门禁。
6. **H10 在制成果接收（K-21 前置）**：`cascade-scan` / `cycle-clusters` / `unmapped-decay-batch2` / `color-baseline` / `cdp-event-projection` 五份证据只作重开条件指针；其 owner 收口后逐件复核 `sourceCommit` 与负测，再决定是否并入 K4/K5 基线，**不预先写成已交付**。

**出口判据**：三条旧判据有作废记录与新判据负测；canonical-readings JSON 在册且文档零重复读数；干净树 `closeout:full ×3` 19 门全绿；WIP 清单零未知 owner；两个红门在干净树重跑不复发。
**证据目录**：`acceptance/post-h9-2026-11-10/k0/`。

### K1 · 通用 agent 主线兑现度（P0/P1）

**目标**：把「已定义但未生效」的四类能力接到生产路径，让编排 / 工具 / 模型计量 / 可靠性四维在 MCP 与 viewer 侧同样成立。**不加新能力，只补兑现**。

**依赖**：K0（判据与干净树）。**blocker**：A + U。

**具体改进点**：
1. **MCP 链计量闭环（K-08，P0）**：`ai-usage-helper.js` 的注入点接到 `mcp/registry.js:333` 所在执行链，`recordAiUsage` 与 `helpers/ai-usage.js` 同一真源（不建第二账本）；`routes/ai-agent/cost-cap.js` 的成本熔断覆盖 MCP 执行；红绿先行：先落「MCP 调用后 `ai_usage` 有行且成本累计进入熔断」的失败测试，再改实现；负测覆盖 no-op 注入回归。
2. **权限与档位裁决（K-09）**：`tools_only` 与 IDE `accessMode` 各出「现状 / 候选 / 风险 / 推荐」一页材料交用户裁决；裁决前不改默认语义，裁决后按单一策略入口实现（复用 `agent-tool-policy.js` 与 `mcp-tool-policy.js`，不建第三套权限系统）。
3. **定义接线或显式 retain（K-10）**：`goals.js` 3 个定义与 `viewerRegistry` 6 个 adapter 能力位逐件判定「接线 / 删除 / retain-with-reason」；接线项必须同时补用户入口、错误态与行为断言，禁止再增零消费声明位。
4. **165 通道第一批销号（K-25 前置）**：按 `h9/ipc-unused-triage.json` 的 124 需接线项，先做「有用户入口」的前 1/3，其余留后续阶段逐件裁决；`quality:surface` 的零消费检测补可信度负测。
5. **立项自检留痕**：每条改进点回答「与 ZCode/Codex 的差别形态在哪、本地可审计 / 治理透明 / 证据自证如何体现」，写进 plan §1；答不出的先想清楚形态再开工。

**出口判据**：MCP 调用在 `ai_usage` 与成本熔断两处有可复跑行为断言；权限裁决记录留痕；定义类零消费位数量只减不增；新接线项均有用户入口 + 错误态 + 负测。
**证据目录**：`acceptance/post-h9-2026-11-10/k1/`。

### K2 · 服务端数据面与规模化（P1）

**目标**：把性能瓶颈从「猜测性前端优化」转到「可量测的服务端数据面」，让长会话、大项目、多连接都有明确预算。

**依赖**：K0（判据）、K1（计量同源）。**blocker**：A + L。

**具体改进点**：
1. **会话列表分页（K-01/K-11）**：`ai-conversations.js:71` 从硬 `LIMIT 100` 改为带游标/页码的显式分页 + `hasMore` 信封；前端同步展示「已加载 N / 共 M」或「更多」入口，消除「服务端截断被误读为前端全量渲染」的判据陷阱；补 `>100` 条夹具的 DOM 8 档重测。
2. **读路径减负（K-11）**：`:145` 每页 `COUNT(*)` 改缓存/按需；`:150` `meta_json` 改按需投影（列表不解析大 meta）；`:178` export 与 `:244` fork 改分批/游标；`:248-251` fork 逐条 INSERT 包进事务并补「中途失败全回滚」负测。
3. **索引与上限（K-12）**：为 `copilot_messages(conversation_id, rowid)` / `task_events(task_id, seq)` 建复合索引（走既有 migration 通道）；≥15 处 `getAgentTaskEventsSince(1_000_000)` 收编为具名上限常量并补「超上限必截断且带 hasMore」契约。
4. **事件推送收敛（K-13）**：SSE 的 500ms 轮询复用 `mobile-gateway/agent-ws.js` 既有事件总线（**不建第二通道**），保留 2s 兜底水位；`req.on('close')` 清 interval 时补后台 loop 的终止/复用语义，避免订阅关闭后空转。
5. **请求体五类占比（K-23 前置）**：工具定义 / 系统提示 / 消息 / 工具结果 / 输出预留每轮可核对，与 `token_budget`、`ai_usage`、`ContextBudgetBar` 同源，禁止「显示一套、请求一套」。

**出口判据**：>100 会话夹具下 DOM 与读数单调可解释；`fork` 事务负测绿；复合索引有迁移与查询计划证据；事件总线复用后 SSE 连接不再各自轮询 DB；请求体占比与计量读数逐轮对账一致。
**证据目录**：`acceptance/post-h9-2026-11-10/k2/`。

### K3 · 用户可感知体验收官（P0/P1）

**目标**：任何状态下用户都知道发生了什么、能用什么、为什么不能用；键盘与读屏路径完整；布局只有一个真源。

**依赖**：K0（判据）、K1（错误码面）、K2（数据面稳定）。**blocker**：A + L + E。

**具体改进点**：
1. **四事件前端投影（K-14）**：`compaction_failed` / `trim_skipped` / `provider_retry` / `stream_stall` 接会话轨迹面与通知历史（复用 `ToastProvider` 历史，不建第二通知中心），每条带 reasonCode + 重试/复核入口；补「事件发出但 UI 不消费」反向契约测；SSE 断线注入三态实机 flow 落盘。
2. **人眼判据集中过目（K-15）**：按 dev-infra 无人化验收阶梯第 4 级，用 `docs/post-s7-h7-human-eye-route.md` 已有路线（步骤 / 输入 / 每步预期 / 证据留存点）集中一次人工确认；覆盖 UI-694/695/697/698/699、Toast 历史层级与暗色对比、`treeRoving.ts:10` VoiceOver、32 条 debt 人眼子集、长内容三态；证据 = 路线原文 + 人的确认记录（日期、覆盖断言），**Agent 不代答**；未确认项保持 `in_progress`。
3. **布局单源（K-16）**：按 `$petri-css-theme`「布局层重构而非追加」——`CenterPanel.tsx:203-213` 收成单一 `XxxLayout.module.css`，删 `project-workspace.module.css` 重复 class 与死 fallback，两处 `FloatCardResizeHandle` 合并；四块几何量测 + 拖到两倍 / 缩到一半自查，DOM 几何绿不得替代视觉绿。
4. **主题与 a11y 收敛（K-17）**：4 族颜色字面量按海军蓝 token 阶梯替换；`App.tsx:158,162` 内联 z-index 走 8 档 token 并扩 `theme-token-contract.test.ts` 到内联样式；`CommandPalette` 补显式 focus trap 循环；补一条「隐藏层不可 Tab + 树可键盘展开 + 分隔件可键盘调宽」a11y 冒烟 flow。
5. **UI 台账终态化（K-15）**：debt 35 按 A/B/C/D/E 分诊，CDP 可代行补腿、人眼项集中过目；每条终态为 verified / cancelled / retain-with-reason；`ui:audit:check` 在干净树归零且棘轮不回弹。

**出口判据**：四事件端到端契约全绿 + 断线注入三态证据；人眼确认记录在案（未确认如实挂起）；布局几何 + 人眼双证；台账 debt 按契约不回弹；截图不可得如实 `screenshot_unavailable`。
**证据目录**：`acceptance/post-h9-2026-11-10/k3/`。

### K4 · 架构去补丁：大拆片与单源收编（P1/P2）

**目标**：降低读者需要持有的概念数，把「保护实现细节的测试」换成「保护行为的测试」。

**依赖**：K1/K2/K3 契约抽取完成。**blocker**：A + W。

**具体改进点**：
1. **W5b 逐刀（K-18）**：`loop-orchestrator.js`（五段）、`SimpleChat.tsx`、`tools-executor.js`、`result-studio-repository.js`、`workspace-tools.js`、`project-workspace.tsx`、`ReviewMode.tsx` 按「一切片 = 一会话 + 拆前拆后同套定向测试绿」推进；每刀后 `gate:code-size` 例外只减不增、行数锚随交付刷新、`loop-orchestrator.js` 纳入尺寸门 MANIFEST 不靠例外续期。
2. **插件源与工具元数据单源（K-19）**：三处装配收敛为单一 `loadPlugins(sourcePlan)`；`TOOL_METADATA` / `CONTRACTS` 双表合一或由同一生成器输出，删跨表一致性补丁测试。
3. **测试有效性（K-20/21）**：4 族 `src.includes(...)` / 行数断言逐文件换成事件、状态机、错误码、恢复行为断言；120 条未映射按八簇消亡（H10 在制成果经 K0 复核后才并入），禁一次性盲挂；`impact-map.json` 重复 id 契约保持 fail-closed。
4. **依赖与环（K-31/22）**：5 份 package.json 的版本漂移与重复声明出「单一清单 + 机械对账」方案并扩 `gate:version-parity` 覆盖面（**不新增依赖**、默认不改锁文件；改版本须走依赖升级评审与前后同套绿）；12 存量环按簇设里程碑，每消一簇 `--update` 下调基线；动态 require 三点改静态注册；lint warnings 设分域只减棘轮。

**出口判据**：主链拆为行为可测单元且行数只减锚不落后；插件源/工具元数据单源并有漂移负测；源码扫描契约数量显著下降或有明确遗留理由；环、knip 保留面、warnings 只减不增；任何 scoped 重构带拆前拆后同套绿基线。
**证据目录**：`acceptance/post-h9-2026-11-10/k4/`。

### K5 · 性能与证据门禁化（P1/P2）

**目标**：从「毫秒门稳定绿」升级为「长会话、长列表、大项目、冷启动、证据资产都有持续预算与可复跑读数」。

**依赖**：K0（判据）、K2/K3/K4（结构稳定）。**blocker**：A + L。

**具体改进点**：
1. **判据入门禁（K-03/23）**：冷启动 ×5 与热栈 5 轮分别取数；DOM 节点上限门补「植 2 万节点必红」负测；滚动帧率 P50/P95 与节点数同批落盘；所有依赖活 dev 栈的门带「有栈才断言」显式条件，杜绝无栈必红的 fail-open 陷阱。
2. **perf 证据常态落盘（K-04/23）**：`PETRI_PERF_EVIDENCE` 由 opt-in 改为默认写 `acceptance/`（带 `sourceCommit / platform / command / generatedAt`），负测「植入慢样本必红」每轮复跑；四场景基线变化留因。
3. **三矩阵同源与通道销号（K-24/25）**：功能矩阵 / 能力地图 / 货架矩阵同一生成器输出，人工改动判红；`quality:surface` 补 `router.*` 与动态挂载扫描 + 消费方检测可信度负测；165 通道与 2 个 storage key 逐件销号或 `retain-with-reason`。
4. **自然长任务与 EAR（K-23/26/32）**：T7 去掉 `windowOverride=20000`，在真实默认窗口触发压缩，20 项 FACT 全收、0 干预；attempt 级 token / cache / duration / 模型归因随行；EAR 45% 按「分子增长 + 负测守住」推进，不靠缩分母达标；`docs:roll-index --check` 完全脚本化入门禁；新证据元数据四字段齐全。

**出口判据**：四场景连续 5 次 PASS + 负测红；五段 / DOM / 帧率读数可复跑且各有负测；三矩阵一键重建且人工改动判红；T7 自然窗口长任务成功；EAR 分子真实增长。
**证据目录**：`acceptance/post-h9-2026-11-10/k5/`。

### K6 · 安全与边界纵深（P0/P1 · 含用户裁决）

**目标**：把已有防线延伸到最后一个未覆盖的创建点，并让策略判定与执行边界只有一份运行时真相。

**依赖**：K0 干净树；与 K1 的 MCP 面串行。**blocker**：A + U。

**具体改进点**：
1. **PiP 四项基线（K-27，P0）**：`src/main/computer-use-pip.js:67-72` 补显式 `sandbox` / `webSecurity`，并把该创建点加入 `test/electron-security-assertions.test.mjs:25-28` 的 `WINDOW_FILES`，四项逐块断言；补「漏配即红」负测。
2. **IPC 参数 schema 与豁免口（K-28）**：按 W2 蓝图 `:157-158` 做统一 `ipcMain.handle` 参数 schema（复用既有 handler 注册点，不建第二包装器）；`PETRI_IPC_FILE_SENDER_EXEMPT_IDS` 逐件复核，能删则删，必须保留的登记 reason 与到期复核。
3. **U 类决策材料（K-29，P0）**：ADMISSION 默认档（observe → enforce 或维持）、FK 全量切换（后端 OFF / 桌面 ON + 179 违约 + `h10/cascade-scan.json` 在制的 16 CASCADE DDL / 11 显式 delete 清单）各出一页「现状 / 候选 / 风险 / 推荐 / 证据」，**用户裁决前不改默认语义、不擅自开工**；裁决后按「三执行入口出示并消耗凭据 / 迁移连接同 pragma / 四腿一致性门」落地，且全程带生产路径负测。
4. **输入面与降级（K-28/§2.8）**：`h9/prompt-injection-inventory.json` 7 处盘点结论逐件落地；8 处生产空 catch 三分法逐处清零并把 `gate:silent-catch` 扫描根扩到 `frontend/src` / `scripts`；64MB 上限收进单一入口并逐值对账。
5. **dev 双后端形态**：AUDIT-LOG 在册的「墙面板取消跨后端 15s 无效果」按 dev-infra §76 归因（结构性修复方向 = dev 模式 attach 到 :3001），不误判为产品缺陷、不擅自改进程模型。

**出口判据**：PiP 四项有机械断言且负测红；参数 schema 覆盖全部 handle 并有越界负测；ADMISSION / FK 裁决记录留痕；空 catch 扫描根扩展后基线只减不增。
**证据目录**：`acceptance/post-h9-2026-11-10/k6/`。

### K7 · 真实任务终验与人眼验收（P2）

**目标**：把「机械判据绿、UI 实机腿绿」升级为「真实用户任务连续成功且人眼确认」。

**依赖**：全阶段；有效凭据与出网可用。**blocker**：V + E + L。

**具体改进点**：
1. **8 任务套件连续 3 次 8/8（K-30）**：凭据更新与出网恢复后按冻结判据表复跑 ×3，0 干预、0 伪造判据；T6 波动先归因到稳定根因；环境因逐条留时间线而非笼统记「失败」。
2. **人眼判据签字（K-15/30）**：`docs/post-s7-h7-human-eye-route.md` 路线 + 人的确认记录（日期、覆盖断言），Agent 不代答；`toolSelectJudge` / `artifactJudge` 8 项占位在真实产物到位后补判据。
3. **attempt 级证据**：真实 provider 长任务的 token / cache / duration / 模型归因 / 重试原因随 dev-verify flow 落盘；T7 无 `windowOverride` 的自然长会话。
4. **十一维终验复评**：按 §0.3 口径给出「评估时 / NSO 后 / S7 / H7 终验 / 本次复核 / 终验」六列，差值逐条归因到提交或读数，跑完不回溯调参；未达证据的项不写 completed / verified。

**出口判据**：连续 3 次 8/8；人眼确认记录在案；真实长任务 attempt 级证据齐；复评表差值可回溯。
**证据目录**：`acceptance/post-h9-2026-11-10/k7/`。

---

## §5 优先级矩阵与发令顺序

### 5.1 优先级定义

| 级 | 判据 | 阶段 |
| --- | --- | --- |
| **P0** | 判据失真 / 正确性 / 安全 / 契约破坏 / 当前门禁真红 / 用户可见的失败不可见 | K0、K1（部分）、K6（部分） |
| **P1** | 可靠性、体验、可维护性的实质影响 | K1（部分）、K2、K3、K4、K5（部分）、K6（部分） |
| **P2** | 长期演进、债务清理、证据运营 | K4（部分）、K5（部分）、K7 |

### 5.2 发令顺序

```text
[在制 H10 由其 owner 收口（本蓝图零触碰）]
        ↓
K0 发令 → 判据校准 + 干净树 closeout:full ×3 + 分片 0 未归因 fail
        ↓
K1 发令 → MCP 计量闭环 / 权限与档位裁决 / 定义接线
        ↓
K2 发令 → 会话分页 + 索引 + 读路径减负 + 事件总线复用
        ↓
K3 发令 → 四事件投影 / 人眼集中过目 / 布局单源 / 主题与 a11y
        ↓
K4 发令 → W5b 逐刀 / 插件源单源 / 行为断言 / 依赖与环
        ↓
K5 发令 → 五段与 DOM/帧率入门禁 / 三矩阵同源 / 自然长任务 / EAR
        ↓
K6 发令（含 U 类裁决：ADMISSION 档位 / FK 全量切换）
        ↓  ← 若裁决未下，按 §5.3 跳到 K7 的可开工部分，不空等
K7 发令 → 连续 8/8 / 人眼签字 / 十一维终验
```

阶段内可分多个正式工作包，但**同一时间只有一个 active 工作包与一个进行中阶段**；K1 与 K6 共享 MCP/执行语义必须串行；K3 与 K4 若发现共享文件或 `sharedBaselines`，按 registry 三判据自动排队，不并行抢文件面。

### 5.3 停线条件

1. 遇到 `U` 类（用户裁决）：出「一页决策材料」（现状、候选、风险、推荐、证据），停线等发令；队列推进下一可开工项，不空等。
2. 遇到 `E` 类（人眼）：自动生成测试路线，绝不代答；未确认的台账保持 `in_progress`。
3. 遇到 `V` 类（凭据 / 出网 / 平台）：如实标注环境因与补腿条件，不把 0/8 写成产品缺陷，也不把「未跑」写成通过。
4. 遇到 `W` 类（在制 WIP）：只登记指针与本仓归因，不越权改他方文件、不代提交、不跑聚合门。
5. 干净树门禁未绿、并发 WIP 未收口、或证据 source binding 未稳定时，不做 P6 重算类写盘取证（dev-infra P6 纪律）。

---

## §6 验收协议

### 6.1 不变量与红线

1. **通用 agent 主线不收缩**：编排 / 知识 / 工具 / 模型计量 / 可靠性五维仍是核心，领域包是放大器；对标只借形态，本地主权 / 治理透明 / 证据自证三点必须长出自己的形态优势。
2. **本地主权**：推理循环、工具、记忆、编排、证据全留用户机器；可观测性优先落本地事件、SQLite、JSONL 与 acceptance。
3. **零第二真相**：不新建第二 executor、Job、Artifact、Workflow、项目状态、UI truth、DB 连接源、插件源解析器、评分器、通知中心、计量账本、事件通道或台账。
4. **用户裁决不回退**：`workspace_exec` 默认放行、MCP trust 与 capability token 两轴分离、FK 维持缓、ADMISSION 拨硬维持缓、G0 阶段纪律均不变。
5. **零新增依赖**：默认复用 React 18 / Vite / better-sqlite3 / MCP SDK / dev-verify / 既有门禁；新增依赖须走 `DEPENDENCY-CHANGE-CHECKLIST` 与用户裁决。
6. **保护 WIP**：当前 10 个已跟踪在制 + 20 个未跟踪项（含活跃 H10 与 10 项用户资产）只登记、不覆盖、不暂存、不清理、不代提交。
7. **证据自证**：行为测试 / 机械门禁 / DOM 与实机 / 人眼观感 / 真实任务成功五类不得互相冒充；无证据不给分、不写 verified。
8. **单工作包串行**：`planned` 蓝图不占串行槽位；正式编号发令时分配。
9. **G0 开发期常态 · 不外推 packaged/Provider/GA**。

### 6.2 每个正式工作包的最小 DoD

- 独立 plan：范围 / 非范围 / 依赖 / 风险 / `touchSurface` / `sharedBaselines` / 验收 / 完成语义。
- 红绿先行：新行为契约与缺陷修复先落失败测试再写实现；纯重构用拆前拆后同套绿作行为基线。
- 当次证据：命令输出、exit code、acceptance JSON、实机/视觉证据、负测、未覆盖范围。
- 门禁：`docs:check` + `ui:audit:check` + 定向 `test:changed` + 本阶段专项门 + `closeout`；干净树上只跑一次全量门禁。
- canonical 回写：registry / README / roadmap / handoff / AUDIT-LOG / UI 台账同批；未达证据不写 verified / completed。
- 收口报告：P1 修复清单、P2 留痕、外部/人工/环境/WIP 边界、下一步唯一建议。

### 6.3 明确不做

- 不新增功能域或工具族充进度；不把「加能力」当作优化。
- 不为过门放宽 lint / types / knip / code-size / model-surface / domain-neutrality / perf / EAR 基线；重打必须显式留因与负测。
- 不把 DOM 断言、机械判据或进程 health 冒充视觉观感、人眼质量或真实任务成功。
- 不在并发 WIP 未收口时批量移动、删除、暂存或提交文档；不撤销任何既有用户裁决；不引入第二套评分卡或第二份当前状态真相。
- 不启动阶段跃迁，不外推发布资格事项。

---

## §7 与既有 canonical 的关系与复跑命令

- 本蓝图是 `planned` 程序文档，**不替代** `docs/next-steps-roadmap.md` 的当前立即任务；各 K 阶段由自己的 work-package plan 占串行槽位、按 §4 出口判据收口。当前立即任务以 active K 阶段工作包与 canonical roadmap 为准。
- 事实基线 = 本文 §1.2 当次十七门取样 + 四路只读源码实证；[`Petri-Desktop-Holistic-Evaluation-2026-11-06.md`](./Petri-Desktop-Holistic-Evaluation-2026-11-06.md)、[`block-382-post-nso-s7-final-report.md`](./block-382-post-nso-s7-final-report.md)、[`block-392-post-s7-h7-final-report.md`](./block-392-post-s7-h7-final-report.md) 的评分与收尾笔录保持原样，不被本文改写。
- 源码 / 基线 / 证据 / 工作区 / 在制 H10 收口结果变化后，先重跑 §1.2 门禁与受影响维度复核，再执行对应阶段；不把旧读数当现场证据。
- 发令后按 `$petri-project-governance` 分配正式工作包编号、登记 registry 与 AUDIT-LOG；本文件只保留波次、目标与验收，不记录每日进度。

**复跑命令（只读 / 取样）**：

```bash
npm run state                  # 分支 / WIP / AUDIT-LOG 未决 / active 两层口径
npm run docs:check             # 注册表与 coverage
npm run docs:reconcile         # 孤立 / 归档 / 保留候选（只读）
npm run ui:audit:check         # UI 台账同步（在制 WIP 未收口时会红）
npm run hygiene:check          # 死链 / 换行 / untracked 清单
npm run quality:secret         # 密钥 fail-closed
npm run quality:arch           # R1–R5
npm run quality:types          # tsc 0 error
npm run quality:lint           # 0 error 口径（当前红归属在制 WIP）
npm run gate:code-size         # 尺寸棘轮
npm run quality:knip:check     # 死代码保留面
npm run gate:arch-cycles       # 存量环
npm run gate:silent-catch      # 静默 catch 棘轮
npm run gate:user-assets       # 用户资产零入库
npm run gate:version-parity    # 跨语言版本对账
npm run gate:css-modules       # CSS Modules 白名单
npm run quality:ear            # 证据资产化率
npm run quality:perf           # 连续 5 次采样
npm run skills:check           # 产品 Skill 契约
npm run test:all:sharded       # 三段分片（有界；exit 124/125 = unknown）
npm run closeout:full          # 干净树冷启动全量收口
```

> 本次未跑 `test:changed` / `closeout` 聚合门、`quality:surface` 与 `test:all:sharded`（并发在制 + 写盘副作用）；`ui:audit:triage` 的写盘副作用已复原。逐门取样结果**不等于 closeout PASS**；任何收口声明须在干净树上重跑 `closeout:full` 取证。

---

*本蓝图不设工作量上限，但设证据上限：任何没有当前证据的「完成」「通过」「可信」都不得写入收口报告。*
