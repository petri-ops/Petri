---
capability: block516-wakeup-ui
status: active
kind: work-package
canonical: true
truthDomain: block516-wakeup-ui
entrypoint: docs/README.md
registeredAt: 2026-11-24
owner: main-agent
---

# BLOCK-516 · 唤醒 B 档 UI 勾选面收尾（plan）

> 发令：owner 经 Orca 转达「下一波两件」第一项（2026-11-24）——BLOCK-515 收口时登记「UI 勾选面另点」，本包收尾最后一公里。属已批 B 案自然收尾件（非新裁决点）。
> 预估体量 S~M；UI 轨（新 UI-724 登记，实机 flow 全绿翻 verified，观感待主人过目不代签）。

## 1. 范围

1. **routes additive**：`GET /api/schedules/auto-tool-names`（registry 内置工具名单，供前端白名单勾选数据源——内置名单此前无 REST 面，插件目录 /api/tools/catalog 不覆盖）；`POST /api/schedules/:id/auto`（store.setScheduleAuto 显式授予/撤回口）；POST /api/schedules 透传 `autoMode/autoToolAllowlist`。
2. **automationClient.ts additive**：createSchedule 增 autoMode/autoToolAllowlist/goalId 透传；新增 `setScheduleAuto` / `fetchAutoToolNames`；AutomationSchedule 增 auto 三字段。
3. **ScheduleDialog.tsx**：新增「无人值守预授权（可选）」折起区（默认收起，过程信息不占空间）——trusted 勾选 → 显示 ①goal 下拉（带预算 active goals，来自既有 fetchAutomation 数据或按需拉取）②白名单勾选列表（auto-tool-names 数据源，附「最小只读起步」提示）③预算硬顶说明（trusted 强制绑定带预算 goal，既有 goalGate 执行）。提交携 autoMode/autoToolAllowlist/goalId；服务端校验错误原样透出。
4. **ScheduledWorkspacePanel.tsx**：行内 trusted 徽章（模式+白名单数）+ 「撤回预授权」按钮（setScheduleAuto guided，撤回即回 guided 清白名单）。
5. **HK-01**：前端组件测试先红（ScheduleDialog.test.tsx/ScheduledWorkspacePanel.test.tsx 扩展）→绿；9223 实机 flow：composer `/schedule` → 对话框预授权折起区 → trusted 创建（带 goal+白名单）→ 面板徽章 → 撤回 → REST 复核。

## 2. 非范围（exclusions）

- 唤醒触发新机制/DST/跨设备/G1+；goal 创建面（对话框只选既有 goal，建 goal 走既有 goal 面板）；CRON 表达式 UI（BLOCK-514 的 cron 面 UI 另点）；观感签字（零代签）。

## 3. 验收门禁（收口对账）

- 组件测试红绿 + 9223 实机 flow allPass + UI 台账 UI-724 登记（实机翻 verified + 观感待主人过目注记）；收口 `npm run closeout`（存量红如实归属）。
- 证据=acceptance/block516-wakeup-ui/；完成语义=plan/registry/AUDIT-LOG 同批翻 completed。

G0 开发期常态 · 不外推 packaged/Provider/GA。
