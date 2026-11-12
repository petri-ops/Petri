# BLOCK-427 · M1 长任务内核：状态机 · 边界族 · 目标验证

> 本文件是第六轮 M 波次 M1 阶段 work-package 的 canonical plan。
> 前置：M0=BLOCK-426 completed（带 W/V 类红归属）。唯一审计输入：`acceptance/m-blueprint-2026-11-11/FULL-AUDIT-AND-BLUEPRINT.md` §4-M1。
> 用户 2026-11-11 预授权连续工作裁决（见 `docs/m-blueprint-2026-11-11-program.md`）。

## 范围

| 改进点 | 映射 | 本包交付 |
| --- | --- | --- |
| M1-1 显式 TurnMachine（≥9 态 + 转移表 + 非法转移 fail-closed）+ 每个 model/tool 边界 throwIfAborted | G-01 / M-06 | 纯新增 `turn-machine.js`（10 态），零改主循环控制流 |
| M1-2 统一资源边界族：provider usage 权威、compact 双熔断、工具超时/输出预算单源、成本超限可配置硬收尾（默认软提示） | G-02 / G-05 | 纯新增 `loop-boundaries.js` |
| M1-3 goal verifier：独立 no-tool 校验（产物/证据存在性 + todo 全终态 + 后台全 settle） | G-09 / M-06 | 纯新增 `goal-verifier.js` |
| M1-4 取消/暂停成为一等结果：稳定 `turn_cancelled` 结果类型 | G-01 | 状态机 `Cancelled` 态 + `TURN_CANCELLED` 常量 |
| M1-5 可注入 provider 的 loop 行为测试基座（≥30 轮 mock） | G-11 / M-54 / M-57 | `test/m1-long-task-kernel.test.mjs` 行为测试（非源码字符串扫描） |

## 非范围（明确不越界）

- **不给主循环加步数硬上限**：`MAX_AGENT_ITERS = Infinity`（`agent-loop-control.js:11`）是产品契约；`loop-orchestrator.js:711` 的 `for` 上界零改动。
- **不改 `workspace_exec` 默认放行**（2026-11-05 S2 裁决），只补补偿控制（归 M5）。
- **不改主循环控制流 / 不做 12 环逐环消亡**：`LO:1500+` 行的接线与 `cycle-clusters.json` 12 环属结构性重构，按蓝图归 **M6-A**（不提前实现后续阶段）。本包只建立可注入的纯模块与门，接线登记为 `done-partial` 并给补腿条件。
- ADMISSION observe / FK OFF-ON / MCP 计量 retain-with-reason / 主题与中栏既有裁决全部保持。
- 零新增依赖；零触碰 89 M + 68 ?? 在制 WIP；零 stage / 零提交；零放宽基线。

## 差异化形态（对标不改魂）

借 ZCode 的「显式状态机 + 边界族」之形，长成本地可审计形态：
- **事件可重放**：每次转移 append-only 记 `{seq,from,to,at,reason}`，`snapshot()` 供 hydrate → 与 M2 checkpoint 对接。
- **成本可计量**：边界族把 `cost_cap_exceeded` / `compact_*` 决策产出为结构化事件，不丢链（M4 usage 事实表消费）。
- **审批可追溯**：`AwaitingPermission` 是显式态，转移留痕，不靠隐式 flag。

## 验收门

- `node scripts/m-blueprint-m1-kernel-gate.mjs --check`：状态机 / 边界 / verifier 三类负测全绿。
- `node --test test/m1-long-task-kernel.test.mjs`：HK-01 红→绿两轮证据。
- `MAX_AGENT_ITERS` 语义保持 `Infinity` 的机械断言。
- `npm run docs:check` / `npm run test:changed:list` / `npm run closeout`（读数如实）。

## 完成语义

仅当四类门各有当次证据且零放宽/零撤销裁决/零新增依赖时才标 `completed`；
未达证据上限的项逐件标 `done-partial` + 补腿条件，不得用文档措辞升级运行时结果。

G0 开发期常态 · 不外推 packaged/Provider/GA。
