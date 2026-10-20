---
capability: q9-desktop-shell
goal: Q9（外壳可靠性与打磨）续项垂直切片——把「长跑、离开窗口、退出」补到第一梯队：系统通知（回合完成/失败/等待审批）、托盘最小化（可关窗不退出）、退出摘要（运行/排队/等待交互计数 → 取消 / 最小化到托盘 / 停止并退出）。
acceptance:
  - 主进程新增桌面外壳控制器：系统通知网关（偏好开关、窗口聚焦抑制、3s 去重、点击聚焦）、托盘（显示主窗 / 退出，closeToTray 时关窗改为隐藏）、退出协调器（活动计数 > 0 时先出摘要；0 时直接退出；渲染进程不可用/超时回退原生对话框）。
  - 后端新增 `GET /api/app/activity-summary`：运行/排队 tool_jobs、pending 审批、运行中主任务/子代理、运行中后台进程（+ 主进程侧终端会话语义，由主进程合并）。
  - 前端退出摘要弹窗（`data-testid="quit-summary-dialog"`）：逐类计数、取消 / 最小化到托盘 / 停止并退出三动作；托盘不可用时动作返回失败并在弹窗内如实提示（不假装已最小化）。
  - 常规设置两项：`userPrefs.notifyOnTurnEnd`（默认 true）、`userPrefs.closeToTray`（默认 false）；真值走 `/api/user/prefs`，主进程只持渲染进程推送的镜像。
  - 回合终态（done/error/stopped）与待审批出现时触发通知；不携带对话正文（隐私边界）。
  - 纯函数与组件测试 ≥8 条；9223 离屏实机腿 = 摘要弹窗截图 + 托盘/通知支持状态 + 通知去重；`theme-token-contract` + `quality:types` 绿；closeout 十三门 PASS。
reopen: 模型选择器深度（D1/D2/D4）、电脑控制 sidecar（E7/L4）、崩溃同意与本地解析（K2）、首启角色揭示（K9）、后续建议（C14）、通知中心/历史、通知声音与免打扰时段、托盘角标计数、退出摘要中的任务明细列表与逐项取消、macOS 通知权限引导 UI。
status: completed
---

# BLOCK-223 · Q9 续项（垂直切片）：系统通知 / 托盘最小化 / 退出摘要

> 用户裁决：2026-10-21「按照你的建议来，冲」——按建议先做 Q9 续项「长跑可离开窗口」一刀（通知 + 托盘 + 退出摘要），再收 P4 data model。
> 母纲：`docs/qoder-essence-absorption-plan.md` §6-Q9（K3 退出摘要 / K4 托盘与系统通知）。

## 1. P0 实码勘察（2026-10-21，只读实测）

| 面 | 现状证据 | 结论 |
| --- | --- | --- |
| 系统通知 / 托盘 | `src/` 全目录 `Tray` / `Notification` **零命中** | 完全空缺，非补丁可解 |
| 关窗语义 | 主窗 `closed` → `setMainWindow(null)`（`src/main/_window-create.js:410`）；`window-all-closed` → `app.quit()`（`src/main.js:755`） | 关窗即退出是硬契约；托盘最小化必须作为**显式偏好**（默认仍退出） |
| 退出链 | `before-quit` 既有三处消费者：后端 supervisor 关闭（`src/main.js:783`）、弹出窗销毁（`src/ipc/window-manager.js:611`）、终端会话击杀（`src/ipc/terminal.js:347`） | 退出协调器若晚于它们 `preventDefault`，后端已被杀 → 必须在模块加载期**先注册**守卫 |
| 活动计数源 | `tool_jobs.status`（pending/running，`core/petri-server/db/schema.js:420`）；审批 store `Map<taskId, store>`（`helpers/approval-request-store.js:28`，无全局计数）；任务表 `listInFlightPrimaryTasks` / `getRunningChildAgentTasks(parentTaskId)`（`agent-task-store.js:565/710`，均需参数）；后台进程 `Map`（`agent-tools/workspace-tools/internals.js:262`，无导出计数）；终端会话 `sessions Map`（`src/ipc/terminal.js:57`，闭包内） | 五类源都在，但**没有聚合面**；需新增只读端点 + 三个计数出口 |
| 偏好落点 | `/api/user/prefs` PUT 为**合并 patch**（`helpers/user-prefs.js:143-173`）；注册表 `user-prefs` 族现 5 键（theme/fontScale/accent/motion/density） | 两项布尔可安全并入；注册表键数 89 → 91，基线测试需带理由上调 |
| 主进程访问后端 | `process.env.R_SERVER_PORT` + `Authorization: Bearer desktop-local`（先例 `src/ipc/gen-ui.js:26-28`）；本地 auth 恒 `LOCAL_USER`（`core/petri-server/auth.js:12-16`） | 主进程可直接拉摘要，无需渲染进程代取 |
| 设置面 | 常规节在 `DesktopSettingsPanel.tsx`（外观三键 + MotionControl）；`ui:'settings'` 键自动进设置搜索 | 两开关落常规节，沿用既有控件样式 |
| 弹窗基元 | 无共享 Modal 组件；现有多处自绘 `role="dialog"`（命令面板 / 计划批准卡 / 设置面板） | 自绘一个最小 `QuitSummaryDialog`，不抽公共 Modal（避免一次性抽象） |

## 2. 范围

1. **后端** `GET /api/app/activity-summary`（只读）：
   - `toolJobs: { running, pending }`（`user_id=LOCAL_USER` 且 `is_test_run=0`）
   - `approvals.pending`（新增 `countPendingApprovals()`：全局 sweep 后计数）
   - `tasks: { primary, subagent }`（新增 `countRunningAgentTasks(userId)`：`tasks.status='running'` 按 `params.kind` 分流）
   - `backgroundProcesses`（新增 `countRunningBackgroundProcesses()`）
   - 返回 `counts` 扁平对象 + `total`；路由挂到 `routes/index.js`。
2. **主进程外壳控制器**（`src/main/desktop-shell.js` + 纯逻辑 `desktop-shell-model.js`）：
   - 偏好镜像（渲染进程推送）；托盘生命周期（`icons/icon.png`，菜单：显示主窗 / 退出 Petri；`closeToTray` 时关窗=隐藏）。
   - 退出协调器状态机：`idle → summarizing → awaiting_decision`；活动 `total>0` → 通知渲染进程弹摘要；`total=0` → 直接放行；5s 无决策或渲染进程不可用 → 原生对话框兜底（停止并退出 / 取消）。守卫必须在 `before-quit` 既有消费者之前注册。
   - 通知网关：`Notification.isSupported()`、`notifyOnTurnEnd`、窗口可见且聚焦时抑制、3s 去重、标题/正文截断与控制字符清理、点击聚焦主窗并回传 `app:notification-clicked`；`PETRI_TEST_INSTANCE=1` 下**不弹真实 toast**（返回 `simulated_test_instance`），托盘允许短暂创建供探针断言、探针后销毁。
   - 主进程合并终端会话数（`src/ipc/terminal.js` 导出只读计数）。
3. **IPC**：`channels.js` 登记 + `preload.js` 自包含包装（`app:get-activity-summary` / `app:get-shell-status` / `app:set-shell-prefs` / `app:notify` / `app:quit-decision` / 主→渲染 `app:quit-requested`、`app:notification-clicked` / 测试实例守卫 `app:preview-quit-summary`、`app:hide-to-tray`、`app:show-main`）。
4. **前端**：
   - `QuitSummaryDialog`（逐类计数 + 三动作；托盘不可用隐藏「最小化到托盘」）。
   - `useDesktopShell`：启动/变更时把两项偏好推给主进程；订阅退出请求与通知点击。
   - SimpleChat 回合终态与待审批出现时触发通知（不含消息正文）。
   - 常规设置两开关 + 注册表两键（89→91）。
5. **测试与证据**：纯逻辑（通知门/摘要决策/计数归一）、路由集成、组件测试、通道注册表测试、9223 离屏实机腿（摘要截图 + 托盘状态 + 通知去重）、`acceptance/block-223/`。

## 3. 非范围（reopen）

模型选择器深度、电脑控制 sidecar、崩溃同意/本地解析、首启角色揭示、后续建议、通知中心/历史/免打扰、托盘角标、摘要内逐项任务明细与取消、macOS 通知权限引导。Q-DOMAIN P4 data model 仍按母纲留到最后。

## 4. 红线

- 默认行为零变化：`closeToTray=false`、`notifyOnTurnEnd=true`（通知仅在窗口不聚焦时出现，聚焦时静默）。
- 退出守卫不得提前杀掉后端：守卫注册顺序必须先于既有 `before-quit` 消费者。
- 摘要计数只读，不做取消/停止动作；「停止并退出」沿用既有退出清理链。
- 通知内容不含对话正文/工具参数/文件路径。
- 测试实例不弹真实系统通知；托盘短暂创建的探针必须收尾销毁。
- 托盘创建失败不得阻塞关窗/退出（如实降级为直接退出）。

## 5. 验收门禁（收口时逐项对账）

- 定向 Node：`node --test test/block223-*.test.mjs`（⌂ 纯逻辑 + 路由集成 + 计数）。
- 定向前端：`npm run test:files --prefix frontend -- src/components/shell/QuitSummaryDialog.test.tsx src/components/desktop/DesktopSettingsPanel/sections/DesktopBehaviorPanel.test.tsx`
- `npm run test:changed`（影响面）+ `theme-token-contract` + `quality:types`。
- 9223 离屏实机腿：`acceptance/block-223/`（JSON + 截图），断言摘要弹窗 / 托盘状态 / 通知门与去重。
- `npm run closeout` 十三门 PASS + canonical 五件套回写 + UI-536 台账。

## 6. 完成语义

`completed` 需：后端端点 + 主进程控制器 + 前端弹窗/设置 + 测试全绿 + 9223 实机腿证据 + closeout 十三门 + canonical 回写。**明确声明**：模型选择器深度与电脑控制 sidecar 仍 open；退出摘要只做计数与三动作，不做逐项任务操作。

## 7. 收口（2026-10-21）

**结论：BLOCK-223 Q9 续项垂直切片 completed。**

### 7.1 交付

- 后端 `GET /api/app/activity-summary`（tool_jobs running/pending、pending 审批、运行中主任务/子代理、后台进程）+ 三个只读计数出口（`countPendingApprovals` / `countRunningBackgroundProcesses` / `countRunningAgentTasks`）；主进程合并终端会话数，`total` 按归一值重算。
- 主进程 `desktop-shell.js` + `desktop-shell-model.js`：通知网关（偏好/支持性/聚焦抑制/3s 去重/点击聚焦；测试实例返回 `simulated_test_instance`，不弹真实 toast）；托盘（`closeToTray=true` 时关窗=隐藏；菜单「显示主窗 / 退出 Petri」；创建失败如实降级为正常退出）；退出协调器（活动 `total>0` → 渲染摘要；0 或摘要不可读 → 直接退出；渲染进程不可用/5s 无决策 → 原生对话框；守卫先于既有 `before-quit` 消费者注册）。
- IPC：10 个 app 通道 + preload 自包含包装；测试实例守卫 `preview-quit-summary` / `hide-to-tray` / `show-main`。
- 前端：`DesktopShellProvider`（偏好读取/写回/镜像推送/退出事件订阅）+ `QuitSummaryDialog`（计数行由主进程单源产出；托盘失败弹窗内如实报错）+ `useTurnNotifications`（回合终态/审批触发；SimpleChat 不增行）+ 常规设置 `DesktopBehaviorPanel` 两开关。
- 配置：`userPrefs.notifyOnTurnEnd`（默认 true）/ `userPrefs.closeToTray`（默认 false）；注册表 17 族 89→91 键。
- 证据：`acceptance/block-223/`（live JSON + 亮/暗截图）。

### 7.2 验证

- `block223-desktop-shell-model` **6/6**；`block223-activity-summary` **3/3**；前端 `QuitSummaryDialog` **4/4** + `DesktopBehaviorPanel` **2/2** + `SimpleChat` **6/6**；配置基线 **4/4**；IPC 注册表/配置漂移/user-prefs 邻域 **21/21**；`theme-token-contract` **17/17**；`quality:types` 0。
- 9223 离屏实机腿 `block223-desktop-shell-live` **16/16**：摘要弹窗亮/暗（卡片底色 `rgb(255,255,255)` → `rgb(29,41,69)`）、托盘创建/销毁、通知模拟/去重/偏好关、终端会话合并、取消清除。
- `npm run closeout` **十三门 PASS**（test:changed、lint 0 error、types、knip 均绿；报告级 `skills:check` PASS）。
- 决策建议器：`test:suggest` 采纳（增量建议 7 项；影响面下限仍由 impact-map 保证）；`doc:suggest` 命中 planDoc/uiAudit（已回写）；`output:judge` PASS（fit 3.64）。

### 7.3 边界（reopen）

- 真实 OS toast 外观/点击、托盘图标外观属系统层；测试实例按纪律不弹真实 toast，实机腿只证网关与门控。
- 退出摘要只做计数与三动作，不做逐项任务明细/逐项取消；原生对话框仅作渲染进程不可用/超时兜底（不可自动化）。
- 模型选择器深度（D1/D2/D4）、电脑控制 sidecar（E7/L4）、崩溃同意（K2）、首启揭示（K9）、通知中心/免打扰仍 open。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
