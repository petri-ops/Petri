# BLOCK-450 收口笔录 · M2 尾巴清偿：task_events 唯一约束 + M2-live 闭环登记

**终态：`completed` · 2026-11-15 · HEAD 链 `83000151 → 58498ae7 → 04ac52c0 → 93927db3 → 收口提交`**

## 目标与范围

M2（BLOCK-428）唯一未清偿尾巴 M2-4-db（DB 层 UNIQUE(task_id,seq) 约束）的正式清偿——closureCondition 前置已由 BLOCK-449 满足（干净树 + perf 基线全量重采）；M2-live（9223 崩溃注入实机腿）由 BLOCK-449 `m7-longtask-resume-live` 31/31 交付，本包登记闭环。发令链=用户主控提示词 v1.0（预授权连续工作）+ 用户「继续 不要停」（2026-11-15 当次续令）+ Jev 不可用确定性兜底（P6 probe 404 排除后按队列取 M2-4-db）。

## 证据与结果

| 项 | 终态 | 关键读数（当次） |
| --- | --- | --- |
| M2-4-db 约束 | external-blocked → **done** | 三层落地：①启动行数守恒事务内碰撞重排（零删除）②`uq_task_events_task_seq` 唯一索引 ③运行时 UNIQUE 碰撞原子 max+1 重分配重试（调用方 API 零变化）；契约测试 3/3（红=索引缺席/重复行在册/碰撞留存，`58498ae7`） |
| 缺陷抓真 | 首版两缺陷红测试当场捕获 | ①`id INTEGER PRIMARY KEY` 是 rowid 别名——`SELECT rowid` 返回列名 `id`，`members[i].rowid`=undefined → UPDATE 空 match（显式 `AS rowid` 修复）②计数虚报——`changes!==1` fail-closed 回滚兜底 |
| dev 库副本实测 | PASS | 4 组/4 行重排、4,863 行守恒、碰撞清零、索引在册（真实数据路径验证，本体零触碰） |
| M2-live | 闭环（登记） | BLOCK-449 实机腿 31/31 逐字满足 M2-live closureCondition（9223 离屏崩溃注入→重启→resume 逐字对齐） |
| 门禁 | 全绿 | `gate:long-task-resume` 三连 0 issues（closureCondition 指定）+ 邻域 16/16 + `closeout:full` ×2 全绿 + perf B2 重绑（block350 15/15 + 5 连采样）+ lint:ledger P1489=基线（分域只减） |

**过程红四起四落（全协议闭环）**：knip 棘轮（449 自核脚本→entry 注册 `04ac52c0`）、code-size（+78 行→`--write` 台账重打，协议路径）、lint 分域 +2（重排循环改常量属性键清零，`93927db3`）、perf 热路径失效（B2 重绑）。

## 未达项与补腿

| 项 | 终态 | 补腿条件 |
| --- | --- | --- |
| P6 pressure 腿重采 | `external-blocked` | r-enrichment bundle 分发恢复（probe 2026-11-15T07:37:08Z 仍 404）→ `npm run g0:result-studio:p6:update` → `closeout:full`（原册 `acceptance/block-448/p6-pressure-blocked.json`） |

## 边界声明

- 数据安全：重排零删除（行数守恒断言 + 事务回滚 + changes 校验 fail-closed）；dev 库本体在下次后端启动时自愈（副本已先行验证）。
- M2/M7 原档（m2-evidence.json / m7-evidence.json）零触碰；M 台账增量行承载翻态。
- 调用方 API 零变化；SSE/trajectory 游标按 seq 单调——重排只影响 4 组历史碰撞行。
- 12 项 untracked 用户资产零触碰；G1+ 全部不在范围。

## 复跑命令

```
node --test --test-force-exit test/m2-db-task-events-unique.test.mjs
node --test --test-force-exit test/m2-long-task-resume.test.mjs test/agent-task-store-busy-timeout.test.mjs test/block106-task-events-retention.test.mjs
for i in 1 2 3; do node scripts/m-blueprint-m2-resume-gate.mjs --check; done
npm run closeout:full
npm run docs:check && npm run docs:reconcile
npm run decision:session    # jev×0 本轮 · 累计 344（当次取数）
```

G0 开发期常态 · 不外推 packaged/Provider/GA。
