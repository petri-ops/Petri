---
capability: block514-q7-cron
status: completed
kind: work-package
canonical: true
truthDomain: block514-q7-cron
entrypoint: docs/README.md
registeredAt: 2026-11-24
owner: main-agent
phase: CLOSED
---

# BLOCK-514 · Q7 cron+时区+失败退避+overlap 可配置（plan）

> 发令：owner 经 Orca 转达主人「行呀 还有啥没干的 继续呀」三按钮全批（2026-11-24）：「Q7 cron 包：立项开工（confidence=0.96 那个）——cron 五字段解析+时区+失败退避+overlap 可配置，automation-runner/store 之上 additive，零新依赖」。
> 材料：`acceptance/q7-reopen-candidates/DECISION-MATERIAL.md`（唯一推荐）；block-256 §2 非范围 reopen 清单核码在案。

## 1. 范围（additive，零新依赖，HK-01 红绿先行）

1. **新纯函数模块** `core/petri-server/helpers/cron-schedule.js`：
   - `parseCron(expr)`：五字段（分 时 日 月 周）子集——`*`、`*/N`、`N`、`A-B`、`A,B,C` 组合；域界校验；不支持的形态（月/星期英文名、@yearly 等）显式 `invalid_*` 拒绝（登记边界不静默）。
   - `nextFireMs({ cron, fromMs, tzOffsetMinutes })`：按固定偏移时区求下一次触发 ms（分钟粒度扫描，上限 366 天显式 `unsatisfiable`）。
   - **时区语义（零依赖诚实形态）**：`tz_offset_minutes` 固定偏移（如 480=UTC+8），cron 在该本地钟面求值；固定偏移无 DST 概念——夏令时区偏移须随政策手动调整，如实登记边界（中国等无 DST 区为主场景）。
2. **store additive**：`agent_schedules` 增列 `cron_expr` / `tz_offset_minutes` / `retry_backoff`（none|exponential）/ `overlap_policy`（skip|queue）（try/catch exists 惯例，旧数据零迁移）；`createSchedule` 接受并校验（intervalMinutes 与 cronExpr 二选一）；`advanceSchedule` cron 感知（cron 调度按 nextFireMs 求下一触发；非 cron 维持 interval 现行为逐字不变）。
3. **失败退避**：`retry_backoff=exponential` 时失败路径下一触发=now+interval×2^连续失败次数（封顶 24h）；成功清零。连续失败数从 `agent_schedule_runs` 近态推导（不加列）。
4. **overlap 可配置**：`overlap_policy=queue` 时既有 open-run 不再 skip（新提交排队）；默认 `skip` 维持现行为逐字不变；进程内 activeSchedules 去重保留（同 tick 防重入不受策略影响）。
5. **routes additive**：POST /api/schedules 接受 `cronExpr/tzOffsetMinutes/retryBackoff/overlapPolicy`；非法 cron 显式 400。
6. **HK-01**：`test/block514-cron-schedule.test.mjs` 先红（模块缺失/语义未实现）→ 绿：parseCru 形态矩阵/nextFire 固定偏移+边界/退避曲线/overlap queue 放行/skip 回归；邻域 block256/next01 回归。

## 2. 非范围（exclusions）

- 跨设备同步（G1+/外部）；agent 唤醒（审批语义裁决另点）；DST 自动切换（固定偏移边界如实登记）；月/星期英文名与 @yearly 形态（显式拒绝）；UI 面板 cron 编辑器（设置页展示另点）；G1+。

## 3. 红线

零新依赖；HK-01 红绿先行；旧数据/非 cron 调度行为逐字不变（skip 默认、interval 推进）；定向测试优先；共享台账追加式写。

## 4. 验收门禁（收口对账）

- block514 红绿证据 + block256/next01 邻域回归 + 定向集全绿；收口 `npm run closeout`（存量红如实归属）。
- 完成语义：plan/registry/AUDIT-LOG 同批翻 completed；证据=acceptance/block514-q7-cron/。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 收口笔录（2026-11-24 · completed）

提交链：立项 `0c3a23cd5` → 实现 `d7c29d5e0` → 收口对账双修 `e19e05d2f` → 本批回写。

- HK-01 红（模块缺失实录）→ 绿 **9/9**；邻域 block256+next01 9/9；test:changed **309/0**；post-h9 契约 **186/186**（knip 上限 409→414 同步=BLOCK-493 同根先例，正测+负测探针同批留痕）。
- 其余门：code-size/tracked-consistency（4345+）/secret/arch/lint/types/knip（414 键含 5 flow 留因）全绿；lint:ledger/EAR 存量红维持如实归属（S0 基点，S6 同款纪律）。
- §1 对账：五项全交付（纯函数/四列 additive/退避/overlap/routes）；非范围四项（跨设备/唤醒/DST/UI 编辑器）未触碰。

G0 开发期常态 · 不外推 packaged/Provider/GA。
