---
capability: evaluation
goal: BLOCK-188 = 评测基线 v2 首切片·context_snapshot 棘轮（评估报告 §5.1 阶段2「证据自证期」队列头=评测基线 v2；用户 AskUserQuestion 选定「评测基线 v2（推荐·最自动化）」2026-10-16）。§4.2 判词=context_snapshot 棘轮是「Petri 完全没有的 prompt 回归防线，单项价值最高」。把 agent 出站请求的「组装形状」（system prompt + 工具 schema + 上下文结构）指纹化并棘轮固化——prompt/工具 schema/上下文组装任何变更在 diff 显形、须显式重打基线，杜绝静默 prompt 回归。评测 v2 全貌拆多串行切片，本包=价值最高且完全确定性（无 provider 依赖、无人眼）的首切片。
acceptance:
  - P1 组装快照：从 evals harness 已 capture 的黄金任务出站请求（mock provider `captured`）提取归一化形状——system prompt 文本 + 工具 schema 名/参数结构 + 上下文消息骨架；动态值（id/时间戳/随机）归一化消除（§4.2 九类结构化差分姿势）。产出纯函数 `buildContextSnapshot(capturedRequest)` → 稳定形状 + sha256 指纹
  - P2 棘轮基线：`evals/snapshots/context-snapshot.json` 冻结当前形状为基线；契约测试重跑黄金任务→重建快照→逐字段对比基线，任一漂移即红；重打基线只走显式 `--update`（防退化，formal admission 精神）
  - P3 接线：`evals:run`/gate 链在黄金任务后跑 context_snapshot 对比（并入现有 evals 棘轮，不建第二评测真相）
  - 门禁：docs:check/ui:audit:check（纯基建免 UI-###）/契约单测（快照确定性：两次跑同形状同指纹 + 动态值归一 + 漂移检出）/test:changed 全绿
  - 完成语义：context_snapshot 棘轮在册且可重跑绿；prompt/工具 schema/上下文组装变更会显形为棘轮红（用一条构造漂移自证）；零 provider 依赖、零人眼
reopen: 评测 v2 后续切片各自独立立项——② mock capture/replay 哨兵防作弊 + 判据三件套（禁 sleep）扩充；③ catalog 五列化；④ formal admission 门控棘轮（**该切片含「判据门控口径」架构裁决，须用户拍板**）；⑤ LLM-as-judge real 模式；⑥ 竞争力 8 维复测（蓝图明定随包不单开）
status: active
---

# BLOCK-188 — 评测基线 v2 首切片·context_snapshot 棘轮（阶段2 证据自证）

- 状态：`active`（2026-10-16 用户选定「评测基线 v2（推荐·最自动化）」为阶段2 首包方向）
- 定位：评估报告 §5.1 阶段2 出口判据 = `catalog 五列 + 判据三件套(禁 sleep) + mock capture/replay 防作弊 + context_snapshot 棘轮`（+ 竞争力 8 维复测随包）。本包交付其中**单项价值最高、且完全确定性无 provider 依赖**的 context_snapshot 棘轮；其余切片按单包串行纪律后续各自立项（见 frontmatter reopen）。

## 1. 立项自检（产品个性纪律问句）

「本地可审计/证据自证体现了吗？」——context_snapshot 棘轮是纯「证据自证」防线：prompt 工程与工具 schema 的每次变更都在本机 diff 显形、留审计痕迹，断网可用、无厂商评测云中台。这正是 Petri 区别于「质量靠人眼/靠厂商 A/B」的差异化能力（魂③可信透明即能力 + ④证据自证），非复刻通用形态。

## 2. 范围（P0 勘察定位，2026-10-16）

| 面 | 实况（勘察） | 本包处置 |
| --- | --- | --- |
| prompt 单源 | `core/petri-server/helpers/system-prompt.js`（canonical）；`agent-runner.js`/`loop-orchestrator.js` 组装 | 取其出站组装形状入快照 |
| 工具 schema 单源 | `core/petri-server/agent-tools/tool-defs/*` + `registry.js`（`listTools()` 单入口） | 取工具名/参数结构入快照 |
| 上下文骨架 | `message-trimmer.js`/`token-estimator.js` 参与组装；harness mock `captured[]` 已存每轮出站 messages | 复用 capture，归一化提取消息骨架 |
| 现有 evals 基建 | `scripts/lib/evals-harness.mjs`（隔离后端+mock capture+14 判据 kind+基线棘轮 `compareRunVsBaseline`）；BLOCK-187 刚加 funnel/ttfs kind | P3 并入现有 evals:run/gate 链，不建第二评测真相 |
| 先例 | `test/desktop-agent-prompt.test.mjs`/`block56-context-freshness`/`block93-role-prompt` | 借其 prompt 契约断言姿势，升级为全形状棘轮 |

## 3. 非范围（红线）

- **不做判据门控口径裁决**：formal-admission「什么算 PASS/FAIL、smoke→real 晋升门」属后续切片，且报告明列为**架构裁决项**（§5 2b 行「架构裁决 1（判据门控口径）」）——须用户拍板，本包不代裁。
- **不接 LLM-as-judge / real 模式质量分**：需 provider，属独立切片；本包纯确定性、无网络、无模型。
- **不建第二评测真相**：快照是 evals harness 出站 capture 的派生视图，复用现有 runGoldenTask/mock，不另起 runner/Job/度量系统。
- **不做动态值入基线**：id/时间戳/随机 token 归一化后入快照，绝不把易变值冻结进基线（否则假红）。
- **G1+ 不外推**：不碰 packaged/Provider/GA。

## 4. 执行方案

- **P1 组装快照纯函数**：`scripts/lib/evals-harness.mjs`（或就近新文件）加 `buildContextSnapshot(capturedRequest)`——抽取 system prompt 全文 + 工具 schema 结构（name + 参数 JSON Schema 形状，去 description 易变文案或归一）+ 消息 role 骨架；动态值按九类结构化差分归一化。纯函数供单测。
- **P2 棘轮**：`evals/snapshots/context-snapshot.json` 基线（当前形状 + 指纹）；`test/block188-context-snapshot.test.mjs`：跑黄金任务采集 capture→buildContextSnapshot→对比基线逐字段；确定性（两次同输入同指纹）、动态值归一生效、构造一处 prompt/schema 漂移→红、`--update` 显式重打。
- **P3 接线**：`evals:run --suite=golden` 收口后自动跑 context_snapshot 对比（并入现有链），漂移即 exit 非零。
- **P4 收口**：closeout 全链 + 五件套回写 → completed；评测 v2 剩余切片在 reopen 登记为后续包。

## 5. 回退路径与并行隔离

- 回退：快照漂移=红即拦，重打基线走显式 `--update` 留痕（formal admission 精神）；归一化不足致抖动则先修归一不放宽棘轮。
- 并行隔离：触碰面=`scripts/lib/evals-harness.mjs`（加快照纯函数）/新 `test/block188-*.test.mjs`/`evals/snapshots/**`/`scripts/evals-run.mjs` 收口钩子；当前唯一 active 包。
- 环境纪律：复用隔离后端 harness（PETRI_DB_PATH 临时目录 + bootstrapDb src/migrations），无 dev 栈依赖、无人眼。
