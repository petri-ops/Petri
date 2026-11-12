# BLOCK-429 · M3 上下文与工具能力面

> 前置：M2=BLOCK-428 completed（带 2 项 external-blocked）。唯一审计输入：
> `acceptance/m-blueprint-2026-11-11/FULL-AUDIT-AND-BLUEPRINT.md` §4-M3。
> 用户 2026-11-11 预授权连续工作裁决（见 `docs/m-blueprint-2026-11-11-program.md`）。

## 范围（M3-1…M3-6）

| 改进点 | 映射 | 本包交付 |
| --- | --- | --- |
| M3-1 compact 恢复契约：summary 强制五字段 + 压缩后有界重读关键文件 | G-05 | `buildCompactSummary` / `planBoundedReread`（5 文件 / 50k token 上限） |
| M3-2 工具能力元数据单源：一份声明产出四视图，消除 115/114/71 漂移 | G-06/M-27/M-70 | `adjudicateToolSurface()` 跨表对账门 + 声明投影（跨表锚 `CONTRACTS ⊆ TOOL_METADATA`） |
| M3-3 声明驱动拓扑并行调度（组内并行 + 合成取消结果） | G-06 | `planToolTopology()` 环检测 + `stopTurnAfterResult` |
| M3-4 结果预算统一：超预算落本地 artifact 只回预览 + 错误结构化投影 | G-06/M-19 | `projectResultBudget()` / `projectToolError()` |
| M3-5 权限 fail-closed + 竞速单一 settled 闩 + 可恢复拒绝 + guard-ack 跨恢复持久化 | G-07/M-01/M-36 | `adjudicatePermission()` 真实读取 `needsApproval`（生产读取者 >0） |
| M3-6 不可信内容边界：系统提示条款 + `untrusted` 包装与来源标注 | G-12/M-39 | `wrapUntrusted()` / `UNTRUSTED_SYSTEM_CLAUSE` |

所有能力收敛到单一纯模块 `core/petri-server/agent-tools/tool-capability.js`（零新增依赖）。

## 关键工程裁决（逐项留痕）

- **不改既有四表**：`tool-defs.js` / `tool-metadata.js` / `registry.js` 的 115/114/71 计数由
  既有契约测试钉住；本包先建立**只读跨表对账门**，把漂移暴露为可机械核验的事实，
  再由 M6-A 结构单源组做生成器改造（不提前实现后续阶段）。登记 `done-partial` + 补腿条件：
  M6-A 在拆前拆后同套绿基线把「新增 1 工具改动处 7→1」落地。
- **不改 `workspace_exec` 默认放行**（2026-11-05 S2 裁决）：`needsApproval` 接线只做
  事前声明消费与风险声明显式化，默认语义不变。
- 不改 `MAX_AGENT_ITERS=Infinity`；零触碰在制 WIP；零 stage / 零提交；零放宽基线。

## 验收门

- `node scripts/m-blueprint-m3-capability-gate.mjs --check`（元数据/权限/不可信三类负测）。
- `node --test test/m3-tool-capability.test.mjs`（HK-01 红→绿）。
- `npm run docs:check` / `npm run test:changed:list` / `npm run closeout`（读数如实）。

## 完成语义

六项各有当次证据且零放宽/零撤销裁决/零新增依赖才标 completed；
未达证据上限项标 `done-partial` + 补腿条件，不用文档措辞升级运行时结果。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 收口笔录（2026-11-11 · BLOCK-429 / COMPLETED，带 1 项 done-partial）

**交付**：M3-1…M3-6 六项能力收敛为单一纯模块 `tool-capability.js`：compact 五字段恢复契约 + 有界重读 / 跨表只读对账门（`CONTRACTS ⊆ TOOL_METADATA`）/ 声明驱动拓扑并行调度与合成取消结果 / 结果预算落 artifact 与错误结构化投影 / 权限 fail-closed + 竞速 settled 闩 + 可恢复拒绝 / `untrusted` 包装与来源标注。`needsApproval` 首次有真实生产消费点（`adjudicatePermission`）。HK-01 三轮红→绿 18/18；门自身 7 项篡改必红全绿；`gate:tool-capability` PASS 0 issues；lint 0；docs:check 574 / ui:audit / W5a 全绿。

**门禁实况（不写全绿）**：`test:changed` 1459 tests / 2 fail（UI-629 与 P6 两红均 W 类在制 WIP）；`closeout` **exit 1**（第 5 门拦停，前 4 门 PASS、后续 13 门 fail-fast 未执行）。

**范围守住**：`tool-defs.js` / `tool-metadata.js` / `registry.js` / `workspace-tools.js` 零改动（`workspace_exec` 默认放行裁决保持、`MAX_AGENT_ITERS=Infinity` 未改）；零新增依赖 / 零放宽基线 / 零触碰他方在制 WIP / 零 stage 零提交 / 零撤销既有裁决 / 零 G1+ 外推。

**done-partial + 补腿**：工具能力元数据生成器（新增 1 工具改动处 7→1）归 **M6-A**；本包先建只读跨表对账门暴露 115/114/71 漂移。补腿条件=M6-A 拆前拆后同套绿基线落生成器，复跑 `quality:surface` 且 P1/P2=0、计数单源。

**证据**：`acceptance/m-blueprint-2026-11-11/m3/`。

G0 开发期常态 · 不外推 packaged/Provider/GA。
