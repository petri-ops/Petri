# M1（BLOCK-427）六维度评审 · 收口前自评

> 按 `$petri-code-review` 七维度过；顺序=意图（M1 plan）→ 先看测试（18 项）→ 再过实现。
> AI 跑查（ocr）：**本轮未做**（可选外部工具、未装/未配置），按 skill 降级如实声明，不阻塞。

## 结论先行

**净改善 = 批准收口（带 W 类红归属与 1 项 done-partial）**。无 P1；P2 一条，Minor 一条。
`closeout` **exit 1**（第 5 门 `test:changed` 拦停，2 fail 均 W 类在制 WIP），前 4 门 PASS、
后续 13 门 fail-fast 未执行；不写「全绿 / verified / 通过」。

## 逐维度

| 维度 | 结论 | 证据（file:line → 合同原文） |
| --- | --- | --- |
| 1 契约一致性 | PASS | `turn-machine.js:76` 注释「转移表按当前态 → 允许下一态正查」；`adjudicateKernel` 机械断言 `MAX_AGENT_ITERS === Infinity` 且 `git diff HEAD -- loop-orchestrator.js agent-loop-control.js` = 0 行。三模块均为纯新增、不改既有导出。 |
| 2 单一真相 | PASS | 状态机只有 `TRANSITIONS` 一张表 + 一个 `phase` 变量；边界族只有 `DEFAULT_BOUNDARIES` 一处常量 + config 覆盖；未建第二套 executor/loop/项目状态。与既有 `MODEL_RESULT_LIMIT` 的关系在 `loop-boundaries.js:16-19` 明确「调用方作为 config 传入，不并造第二份硬编码」。 |
| 3 失败语义 | PASS | 非法转移 fail-closed 且不改当前态；`throwIfAborted` 每 model/tool 边界抛 `TURN_ABORTED`；`goal-verifier.js` 每条拒绝都有具名 `reasonCode`（`ARTIFACTS_ABSENT` / `TODO_NOT_TERMINAL` / `BACKGROUND_TASKS_UNSETTLED` / `GOAL_BLOCKED`），不返回空 `{}` 假成功。 |
| 4 测试有效性 | PASS | `test/m1-long-task-kernel.test.mjs` 真实跑满 30 轮 mock loop 并断言状态轨迹/终态/seq 连续（替代 M-54 的「只断言 async function + 源码字符串扫描」）；门自身 6 项篡改必红（`test/m1-kernel-gate.test.mjs`）。HK-01 三轮红→绿留痕。 |
| 5 边界与安全 | PASS | 纯函数零网络/零 eval/零 spawn/零写库；`Object.getOwnPropertyDescriptor` 取转移表避免动态下标；`goal-verifier` 签名不含工具能力（no-tool 契约）。 |
| 6 死代码/残留/补丁堆积 | PASS（1 项 P2） | 判「补丁 vs 重构」：M1 plan §非范围 明确「12 存量环消亡需抽 `runAgentLoop` 或依赖注入，按蓝图归 M6-A」⇒ 本包不垫第五层兼容 shim，只建可注入纯模块。**P2**：三模块尚未接线主循环，属 `done-partial`，见发现表。 |
| 7 最小化 YAGNI | PASS | 零新增依赖；三个模块合计约 300 行，无 pass-through 包装；`createBoundaryGuard` 复用同一 `events` 数组同时服务可审计与 M4 usage 消费。 |

## 发现

| 级别 | 位置 | 现象（合同原文） | 修法 | 状态 |
| --- | --- | --- | --- | --- |
| P2 | `core/petri-server/agent-tools/turn-machine.js` 全局 | 三模块是纯新增、未接 `loop-orchestrator.js:711` 主循环；蓝图 M1-1 要求「借依赖注入顺带打断 12 存量环」 | 归 **M6-A 结构单源组**（不提前实现后续阶段）；接线时须带 BLOCK-92 拆前拆后同套定向测试绿 + `gate:arch-cycles` 环数只减 | 已登记 `done-partial` + 补腿条件（`m1-evidence.json:deliverables[M1-1-dep]`） |
| Minor | `scripts/m-blueprint-m1-kernel-gate.mjs:69` | git diff 检查在 CLI 层而非纯函数内，负测不覆盖该守卫 | 门内 `PRODUCT_CONTRACT_BROKEN` 已覆盖常量语义；git 检查由收口 `git diff` 独立取证（本轮 0 行） | 已登记候选 |

## 回归→门禁转化

「新增测试未挂 impact-map rule」由既有 W5a 门第二次抓住（M0 一次、M1 一次）⇒ 符合「同类第二次」判据；
但 W5a 门**已存在**且本次立即修复，无需新建门；本包把 M1 两个测试挂进 `m-blueprint-program` rule 的 `tests`。

## 范围守住

零产品契约撤销（Infinity / workspace_exec 默认放行 / ADMISSION / FK / MCP 计量 / 主题 / 中栏）；
零新增依赖；零放宽基线；零触碰他方在制 WIP（仅 5 个 canonical 文件精确增量）；
零 stage / 零提交；零 UI 增量。

G0 开发期常态 · 不外推 packaged/Provider/GA。
