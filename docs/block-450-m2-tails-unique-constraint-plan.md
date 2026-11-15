# BLOCK-450 · M2 尾巴清偿：task_events 唯一约束 + M2-live 闭环登记（plan）

> 发令链：用户主控提示词 v1.0（预授权连续工作）+ 用户「继续 不要停」（2026-11-15 当次显式续令）+ Jev 不可用（`jev_unavailable:http_error:cloud`，2026-11-15 当次 probe 顺带复证）确定性兜底。
> 队列对账：P6 pressure 补腿 external-blocked（bundle 404，2026-11-15T07:37:08Z probe 复证）；M2-4-db 的 closureCondition 前置已由 BLOCK-449 满足（干净树 + perf 基线全量重采 b06d8c19）；M2-live（9223 崩溃注入实机腿）已由 BLOCK-449 `m7-longtask-resume-live` 31/31 交付——本包登记闭环，不重做。
> **本包 = M2（BLOCK-428）唯一未清偿尾巴 M2-4-db 的正式清偿。**
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 事实基线（2026-11-15 当次读数）

- dev 库 task_events 4,863 行，存在 **4 组 (task_id, seq) 碰撞**，且为**不同事件类型**（如 seq=109 同挂 child_finished 与 token_budget，相差 275ms）——根因=`appendAgentTaskEvent(taskId, seq, …)` 的 seq 由调用方读-算-写，双写者竞态。
- tasks / task_events 表 DDL 单源在 `core/petri-server/agent-task-store.js` 模块加载通道（statement 级容错 + 幂等）；src/migrations 无 task_events（该表不经 migrations 文件通道）。
- `agent-task-store.js` 在 perf 基线 HOT_PATH_FILES 内 → 本包改动后需 B2 重采重绑。

## 2. 范围

| 任务 | 内容 |
| --- | --- |
| T1 案头核查（只读） | schema 通道 / 调用方 seq 语义 / 存量碰撞规模 ——（本节即产物） |
| T2 约束落地（红绿先行） | ①`appendAgentTaskEvent` UNIQUE 碰撞时原子重分配（单语句 `max+1` 子查询）重试 + warn 留痕；②模块加载通道新增**行数守恒事务内碰撞重排**（零删除，created_at 序取首个保留，其余逐行 max+1；计数不匹配即 ROLLBACK fail-closed）+ `CREATE UNIQUE INDEX IF NOT EXISTS uq_task_events_task_seq ON task_events(task_id, seq)`；③红绿测试：唯一索引契约 / 同 seq 双写必分离 / 存量碰撞重排行数守恒 |
| T3 门禁复跑 | `gate:long-task-resume` 三连（closureCondition 指定）+ perf B2 重采重绑 + `closeout:full` |
| T4 回写 | M 台账 M2-4-db 翻态 + M2-live 闭环登记（指向 BLOCK-449 证据）+ registry/AUDIT-LOG/README/roadmap/handoff + 交付包 |

## 3. 非范围（exclusions）

- P6 pressure 腿（external 404 原册）；G1+ 全部；任何产品行为语义变更（约束仅收紧持久层不变量，调用方 API 零变化）；
- seq 对外投影语义变化（SSE/trajectory 游标按 seq 单调，重排只影响 4 组历史行）；
- 用户资产 / 受保护原件（post-h9 蓝图等）零触碰。

## 4. 红线

- 零新增依赖；零放宽基线（perf 重绑走门禁自身指引 + 阈值零改动）；不改既有裁决与默认语义。
- 数据安全：重排**零删除**（行数守恒断言 + 事务回滚）；约束失败诚实 warn 不静默吞。
- WIP 零触碰；收口逐路径显式枚举；无窗纪律照旧。

## 5. 验收门禁

1. 新契约测试全绿（唯一索引契约 / 同 seq 双写分离 / 重排行数守恒）。
2. 邻域回归绿：`test/m2-long-task-resume.test.mjs` 7/7 + agent-task-store 相关测试。
3. `gate:long-task-resume` 三连 PASS。
4. `closeout:full` 全绿（含 perf 重绑后 5 连采样）。
5. dev 库当次读数：碰撞组=0、唯一索引在册。

## 6. 证据位置

`acceptance/block-450/`（s0…s5、CLOSEOUT、DELIVERABLES、evidence/）。

## 7. 完成语义

全门禁达成 → registry `completed`；M2-4-db 终态 external-blocked → done（M 台账增量行）；M2-live 登记为 BLOCK-449 交付闭环。
