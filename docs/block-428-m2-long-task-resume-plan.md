# BLOCK-428 · M2 长任务可靠性：续跑 · 任务图 · 幂等

> 前置：M1=BLOCK-427 completed（带 W 类红归属与 done-partial）。唯一审计输入：
> `acceptance/m-blueprint-2026-11-11/FULL-AUDIT-AND-BLUEPRINT.md` §4-M2。
> 用户 2026-11-11 预授权连续工作裁决（见 `docs/m-blueprint-2026-11-11-program.md`）。

## 范围（M2-1…M2-5）

| 改进点 | 映射 | 本包交付 |
| --- | --- | --- |
> 判「补丁 vs 重构」：**5 项能力收敛到单一纯模块** `long-task-resume.js`
> （减少活动件、避免第二份状态真相；评审维度 7 YAGNI）。零新增依赖、零 spawn、零 DB 写入。

| M2-1 append-only transcript + hydrate + 半截 tool call 合成 interrupted result | G-03 | `createTranscript()`：message/part append-only、hydrate、`interruptedToolCount` |
| M2-2 运行时 checkpoint（复用已有 loop_iterations / loop_state_snapshots / task_events 语义） | G-03/M-07 | `writeCheckpoint/readCheckpoint`：写/读/校验三段，损坏必红不静默吞错 |
| M2-3 durable 任务图：阶段 DAG / 每节点转移落盘 / maxConsecutiveErrors 暂停 / 失败节点重派 | G-04/M-07 | `createTaskGraph()`：8 阶段样例、连续错误暂停、失败节点重派 |
| M2-4 幂等边界：commandId CAS + ACK duplicate/stale/noop | G-08 | `createCommandInbox()`：CAS + 三类 ACK |
| M2-5 取消跨后端单一 owner + 后台进程持久化租约 | M-52 | `createLeaseTable()`：单一 owner 路由 + 租约投影 |

## 关键工程裁决（逐项留痕）

**DB 层 `UNIQUE(task_id, seq)` 本包不擅自落地**：`core/petri-server/db/schema.js` 与
`core/petri-server/agent-task-store.js` 都在 perf 基线 `HOT_PATH_FILES`
（`scripts/lib/block350-hot-paths.mjs:11-20`）内；修改会令 `coreSha`
（当前 `7493447930e3f558`，绑定有效）失效，而本轮硬红线禁止直接重采 perf 基线、
禁止抬阈值。故本包只实现**幂等投影层**（不改 schema），DB 唯一约束标
`external-blocked` 并给补腿条件（干净树 + owner 重采基线后按迁移流程加约束）。
现有 `idx_task_events_task_seq` 是普通 INDEX（`agent-task-store.js:302`），如实登记。

## 非范围

- 不改 `server.js` 既有 recovery 语义以外的默认值；不改 `MAX_AGENT_ITERS=Infinity`；
  不改 `workspace_exec` 默认放行；零新增依赖；零触碰在制 WIP；零 stage / 零提交。
- 9223 离屏崩溃注入 flow 与「重启 resume 工具调用数逐字对齐」实机腿：本包无 GUI/后端变更，
  按 §6 V 类标 `external-blocked` 并给补腿条件，不冒充实机证据。
- 不外推 G1+（Provider/公证/签名/GA/packaged）；U/E/V/W 不代答。

## 验收门

- `node scripts/m-blueprint-m2-resume-gate.mjs --check`（状态机/恢复/幂等三类负测）。
- `node --test test/m2-long-task-resume.test.mjs`（HK-01 红→绿）。
- `npm run docs:check` / `npm run test:changed:list` / `npm run closeout`（读数如实）。

## 完成语义

五项各有当次证据且零放宽/零撤销裁决/零新增依赖才标 completed；
未达证据上限项标 `done-partial` / `external-blocked` + 补腿条件，不用文档措辞升级运行时结果。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 收口笔录（2026-11-11 · BLOCK-428 / COMPLETED，带 2 项 external-blocked）

**交付**：M2-1…M2-5 五项能力收敛为单一纯模块 `long-task-resume.js`（append-only transcript + hydrate 中断合成 / checkpoint 写读校验 / 8 阶段任务图 / CAS 幂等 / 单一 owner 租约）。HK-01 三轮红→绿 14/14；门自身 7 项篡改必红全绿；`gate:long-task-resume` 连续 3 轮 PASS 0 issues；lint 0；docs:check 573 / ui:audit / W5a / test:changed:list 全绿。

**门禁实况（不写全绿）**：`test:changed` 1441 tests / 2 fail（UI-629 与 P6 两红均 W 类在制 WIP，与 M0/M1 同构）；`closeout` **exit 1**（第 5 门拦停，前 4 门 PASS、后续 13 门 fail-fast 未执行）。

**范围守住**：`db/schema.js` / `server.js` / `agent-task-store.js` 零改动（coreSha 绑定未动）；零新增依赖 / 零放宽基线 / 零触碰他方在制 WIP / 零 stage 零提交 / 零产品契约撤销 / 零 G1+ 外推。

**external-blocked + 补腿**：① DB 层 UNIQUE(task_id,seq)（触及 perf 基线热路径，须干净树 + owner 重采基线后按迁移流程加约束）；② 9223 离屏崩溃注入实机腿（M4 fixture 后在离屏实例跑 dev-verify，跑完立即 kill）。两项不计入完成数，M7 逐件终态化。

**证据**：`acceptance/m-blueprint-2026-11-11/m2/`。

G0 开发期常态 · 不外推 packaged/Provider/GA。
