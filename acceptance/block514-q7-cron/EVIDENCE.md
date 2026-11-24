# BLOCK-514 · Q7 cron 包证据（2026-11-24）

## HK-01 红绿先行

- 红：`test/block514-cron-schedule.test.mjs` 对现码 ✖——`Cannot find module '../core/petri-server/helpers/cron-schedule.js'`（模块缺失，整批红实录）。
- 绿：**9/9 allPass**——parseCru 形态矩阵（6 合法形态全收）+ 非法显式拒绝（4/6 字段、@daily、月/星期英文名、越界；代码口径 invalid_field_count/invalid_range）+ nextFireMs 固定偏移（北京 09:00=UTC 01:00 精确断言）+ 周域 1-5 + unsatisfiable（2 月 30 日 366 天扫描显式抛）+ advanceSchedule cron 感知推进（非 cron 逐字不变回归）+ 二选一拒绝（非法 cron 400 口径）+ 失败指数退避（30m→60m→120m 曲线、封顶 24h、成功清零）+ overlap queue 放行/skip 默认逐字不变。

## 实现面（additive，零新依赖）

- 新增 `core/petri-server/helpers/cron-schedule.js`（纯函数，0 依赖）。
- `automation-store.js`：四列 additive（cron_expr/tz_offset_minutes/retry_backoff/overlap_policy，try/catch exists 惯例旧数据零迁移）；createSchedule 二选一校验（无 cron 且未显式给 interval → missing_schedule 拒绝，旧调用方全部显式传 interval 已核实）；advanceSchedule cron 感知 + 失败指数退避（streak 自 agent_schedule_runs 前导 failed 段推导，成功落库自然清零；封顶 24h）。
- `automation-runner.js`：overlap queue 放行（默认 skip 逐字不变；进程内 activeSchedules 去重保留）；executeSchedule additive 导出。
- `routes/automation.js`：POST /api/schedules 接受 cronExpr/tzOffsetMinutes/retryBackoff/overlapPolicy。

## 邻域回归与门禁

- block256 + next01 **9/9**（automation 域零回归）。
- test:changed **309 pass / 0 fail**；post-h9 契约 **186/186**（本波 5 flow 留因入册后 K-22 硬编码上限 409→414 同步——BLOCK-493 漏同步同根先例，正测上限与负测探针同批留痕 `e19e05d2f`）；impact-map 七目录 charter 登记随批。
- eslint 触碰文件 0 warning（object-injection 以迭代器形态规避）。

## 诚实边界

- 时区=固定偏移（tz_offset_minutes），无 DST 自动切换（边界登记于 cron-schedule.js 文件头与 plan §1）。
- cron 子集不含月/星期英文名与 @yearly 形态（显式拒绝，非静默）。
- UI cron 编辑器未做（plan 非范围，设置页展示另点）。
