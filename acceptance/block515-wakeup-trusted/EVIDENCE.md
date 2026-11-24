# BLOCK-515 · 唤醒 B 档证据（2026-11-24）

## HK-01 红绿先行

- 红：`test/block515-wakeup-trusted.test.mjs` 对现码 **4/4 fail**（store 无 autoMode 参数/SetScheduleAuto 缺失、runner 不带档、interceptor 无执行面收窄——实录）。
- 绿：**4/4 allPass**——store 校验矩阵（trusted 无白名单/未知工具名/无预算 goal 三类 fail-closed 拒绝 + 授予/撤回往返）+ runner trusted 提交带 `context.automationMode='trusted'`+顶层 `autoToolAllowlist`（guided 对照逐字不变）+ interceptor 白名单外硬拒绝 `auto_allowlist_denied` 不进审批队列、白名单内与无白名单任务决策照常。

## 实现面（additive，零新依赖）

- store：三列 additive（auto_mode/auto_tool_allowlist/auto_budget_checked）；createSchedule trusted 校验 fail-closed（非空白名单 ∧ registry 内置声明面 `listBuiltinToolNames` ∧ 带预算 active goal——预算硬顶复用既有 goalGate 保守机制）；`setScheduleAuto` 显式授予/撤回口（撤回即回 guided 清白名单；变更走本函数留 updated_at）。
- runner：trusted schedule 提交带档与白名单（loop 三档契约消费，guided 提交逐字不变）。
- interceptor：`ctx.autoToolAllowlist` 在场时白名单外工具硬拒绝（auto_allowlist_denied，不进审批队列——比 guided 更严而非更松）；无白名单任务零变化。
- routes/ai-agent chat.js：`autoToolAllowlist` 透传落任务 params（供审计与执行面读取）。

## 邻域回归与门禁

- block256 + next01 + block514 **22/22**（automation 域零回归；含 block514 cron 真相表回归）。
- test:changed 309+/0（见收口笔录数字）；触碰文件 eslint 0 新增 warning（存量 5 条 stash 对照实测）。
- 已知边界：store→agent-tools/registry 顶层 require 与 goal-tools 成环，改惰性 require（留痕注释）；唤醒触发面本身=既有 schedule 链（本包只补 trusted 档语义，plan 非范围）。

## 治理对照（owner 四约束逐条）

- 白名单最小只读起步 ✅（建计划时显式配置，校验面未知名拒绝）
- 默认无授权=维持 guided ✅（auto_mode 默认 guided、guided 提交逐字不变）
- 预算硬顶保守值 ✅（复用既有 goalGate 80%/100% 机制，trusted 强制绑定带预算 active goal）
- 显式/可审计/可撤回 ✅（setScheduleAuto 显式口 + auto_budget_checked 留痕 + 清空即撤回）
- additive 不改 loop 三档契约 ✅（loop-contract/loop-orchestrator 零触碰）
