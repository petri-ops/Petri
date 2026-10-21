---
capability: q9-notification-center
goal: Q9 续项（通知中心/免打扰）——回合完成/失败/待审批在应用内留痕（标题栏铃铛 + 未读徽章 + 列表），系统通知支持免打扰时段（应用内仍记录）；默认零行为变化。
acceptance:
  - `userPrefs.quietHours`（默认空=不启用；`HH:MM-HH:MM`，支持跨午夜）；主进程通知门在内返回 `quiet_hours`。
  - 前端通知中心 store（内存 + localStorage，≤50 条，未读计数/已读/清空），回合终态与待审批事件写入（不论系统通知是否被抑制）。
  - 标题栏铃铛（未读徽章）+ 弹层列表（类型/标题/时间/未读点、全部已读、清空）；无新通知时有空态。
  - 设置页常规节新增免打扰时段输入（非法值拒绝并提示，留空=关闭）。
  - 测试 ≥8；类型/主题门禁；9223 实机腿（铃铛/列表/免打扰门截图）；closeout 十三门。
reopen: 通知点击跳转到具体会话、系统通知历史、免打扰例外规则（仅审批穿透）、声音、按类型开关、跨设备同步。
status: completed
---

# BLOCK-226 · Q9 续项（垂直切片）：通知中心 + 免打扰

> 用户裁决：2026-10-21「Q9 余项和 Q-DOMAIN P4 data model 按顺序做完」。
> 母纲：`docs/qoder-essence-absorption-plan.md` §6-Q9（K4 托盘/系统通知；通知中心与免打扰为 BLOCK-223 reopen）。

## 1. P0 实码勘察（2026-10-21）

| 面 | 现状 | 结论 |
| --- | --- | --- |
| 系统通知 | BLOCK-223 网关（偏好/聚焦抑制/去重/点击聚焦） | 无应用内留痕；窗口聚焦时事件直接消失 |
| 通知触发 | `useTurnNotifications`（回合终态/待审批） | 可复用为写入点 |
| 标题栏 | `TitleBarRightZone.windowTools` 已有终端/右栏开关与徽章样式 | 铃铛可复用 `iconBtn` / `tabCountBadge` / `toolMenu` 样式 |
| 免打扰 | 无 | 偏好 + 主进程门新增 |
| 偏好 | `user-prefs` 支持布尔/字符串 | 新增 `quietHours` 字符串 |

## 2. 范围

1. `userPrefs.quietHours`（默认 ''，注册表 92→93 键）；`lib/quiet-hours.ts` 纯函数（解析/窗口判定，跨午夜）。
2. 主进程 `desktop-shell-model`：`notificationDecision` 增加 `quietHours` 门（reason=`quiet_hours`）；`parseShellPrefs` 归一；`desktop-shell` 推送偏好。
3. 前端 store `lib/notification-center.ts`：`pushNotice/list/markAllRead/clear/subscribe`，localStorage 持久化，≤50 条。
4. `useTurnNotifications` 在触发系统通知的同时写入 store（保留 projectId/conversationId/kind/title/body）。
5. 标题栏 `NotificationCenterBell`（铃铛 + 未读徽章 + 弹层列表 + 全部已读/清空 + 空态），挂到 `TitleBarRightZone.windowTools`。
6. 设置页 `DesktopBehaviorPanel` 新增免打扰输入（与现有两开关同区）。
7. 测试 + 9223 实机腿 + closeout。

## 3. 非范围（reopen）

点击跳转会话、系统通知历史、仅审批穿透免打扰、声音、按类型开关、跨设备同步。

## 4. 红线

- 默认零行为变化：quietHours 空=不启用；通知中心纯前端本地，不新增后端接口。
- 免打扰只抑制**系统 toast**，应用内必须留痕（不丢事件）。
- 免打扰输入非法值不得静默接受（表单提示，主进程归一为空）。
- 通知内容不含对话正文（沿用 BLOCK-223 文案边界）。

## 5. 验收门禁

- `node --test test/block226-*.test.mjs`（quiet-hours + 主进程通知门）。
- 前端 `src/lib/quiet-hours.test.ts`、`src/lib/notification-center.test.ts`、`src/components/desktop/titlebar/NotificationCenterBell.test.tsx`、`DesktopBehaviorPanel.test.tsx`、`useTurnNotifications.test.tsx`（若无则新建）。
- `test:changed` + `theme-token-contract` + `quality:types` + `gate:code-size`。
- 9223 离屏实机腿 `acceptance/block-226/`；`npm run closeout` 十三门 PASS。

## 6. 完成语义

`completed` 需：偏好/门/中心/铃铛/设置/测试/实机腿/closeout。**明确声明**：通知中心只留痕与已读管理，不做点击跳转或系统通知历史。

## 7. 收口（2026-10-21）

**结论：BLOCK-226 Q9 通知中心/免打扰 completed。**

### 7.1 交付

- `userPrefs.quietHours`（默认 ''=关闭，`HH:MM-HH:MM`，支持跨午夜；注册表 92→93 键）。
- 主进程 `desktop-shell-model`：`parseShellPrefs` 归一、`notificationDecision` 新增 `quiet_hours` 门（先于聚焦/去重）；`desktop-shell` 推送偏好。
- 前端 `lib/quiet-hours.ts` 纯函数 + `lib/notification-center.ts`（内存 + localStorage ≤50 条、未读/已读/清空/订阅）。
- `useTurnNotifications` 在回合终态/待审批时写入通知中心（不论系统通知是否被抑制），并把 projectId 带入。
- 标题栏 `NotificationCenterBell`：铃铛 + 未读徽章 + 弹层（类型/标题/正文/时间/未读点、全部已读、清空、空态）；面板改为向左展开（`.notificationMenu`）避免右缘裁切。
- 设置页 `DesktopBehaviorPanel`：免打扰输入（非法值就地报错、不写回；留空关闭）。

### 7.2 验证

- 前端 **62/62**（8 文件：quiet-hours 5 + notification-center 5 + Bell 3 + DesktopBehaviorPanel 3 + QuitSummaryDialog 4 + SimpleChat 6 + TitleBarRightZone 7 + TitleBar 29）。
- Node **13/13**（block226 3 + 配置基线 4 + BLOCK-223 shell 6）。
- 9223 离屏实机腿 **11/11**：空态 → seed 两条通知重载后 2 行/2 未读/徽章 2 → 亮/暗截图 → 全部已读清零 → quietHours 全天窗口 `notify` 返回 `quiet_hours` → 设置页输入在场；`acceptance/block-226/`。
- `theme-token-contract` 17/17；`quality:types` 0；`gate:code-size` PASS。
- `npm run closeout` 十三门 PASS（收口时执行）。

### 7.3 边界（reopen）

- 点击通知不跳转会话；无系统通知历史；无「仅审批穿透免打扰」、声音、按类型开关、跨设备同步。
- 通知中心为本地存储（≤50 条），清空即不可恢复。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
