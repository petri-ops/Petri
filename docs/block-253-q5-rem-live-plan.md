---
capability: q5-rem-long-tail
goal: 收 Q5-REM 长尾中可安全闭环的四项——B3/H4 计划修订版本 tabs、F7 分屏窗格最大化、E4 文件管理器显示动作的实机点验、E1 宿主入口统一第一步（标题栏工具菜单聚合中心模式/终端/侧聊/右轨面）；E1 的跨宿主结构合并与 E9 终端分屏按边界保留 reopen/deferred。
acceptance:
  - B3/H4：计划面展示「当前 + 修订版本」tabs；选中修订显示原因/提议步骤/状态；proposed 修订可批准，批准后步骤表替换、状态变 applied、计划面刷新；复制/下载反映当前选中版本。
  - F7：ArtifactPinPane 在既有 60/40 拖拽/键盘比例之上提供「主区最大化 / 副栏最大化 / 恢复分屏」，状态可访问（aria-pressed）、恢复后比例保留；组件测试覆盖三条路径。
  - E4：文件树/生成文件面的「在文件管理器中显示」经真实 bridge → IPC；测试实例不再真的弹系统文件管理器（`testInstance:true` 干跑），UI 显示可见状态；实机断言 bridge 返回值与状态文案。
  - E1（第一步）：标题栏「更多工具」菜单统一列出中心模式（结果/代码/审查/历史）、终端、侧聊与右轨 surface；点击可切换/开合；不在本包做跨宿主渲染合并。
  - 实机：隔离栈（:3001 + :3000 + :9223 离屏 + 临时数据根 + 合成计划/修订 fixture），亮/暗各一轮；证据落 `acceptance/ui-544-547-q5rem/` 与 `acceptance/block-253/`。
  - 门禁：定向 Node/前端测试 + `npm run closeout` 十三门 + canonical 回写 + 本地提交（不推送）。
status: completed
---

# BLOCK-253 · Q5-REM：工作面长尾（B3/H4 + F7 + E4 + E1 入口）

> **一句话**：把计划版本、分屏窗格、系统文件定位、宿主入口这四件「用户看得见的收尾」做实；跨宿主渲染合并与终端分屏不硬塞进本包。

## 0. 交接摘要（换 agent 先读这一节）

- **背景**：Q5 主体由 BLOCK-216 完成；§6.5 Q5-REM 剩余 E1/E4/F7/B3/H4/H3/E9。H3 已由 BLOCK-248 事件级证据覆盖；E9 终端分屏在母纲明确 deferred。
- **本包范围**：B3/H4（计划修订 tabs）、F7（现有分屏窗格最大化）、E4（文件管理器点验，测试实例干跑）、E1 第一步（标题栏工具菜单统一宿主入口）。
- **明确 reopen**：E1 跨宿主渲染合并（工作区 URL/底部终端/侧聊仍各自宿主，本包只统一入口）；E9 终端分屏（母纲 deferred）；计划修订的“草稿正文版本”若后端无 spec 版本表则只展示步骤表（不造第二真相）。
- **实机夹具**：合成计划 + 一条 proposed 修订（直接写隔离库，报告标 synthetic）；文件树用真实工作区文件；宿主菜单用真实标题栏。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 范围与判据

| 项 | 用户路径 | 判据 |
| --- | --- | --- |
| B3/H4 | 右轨计划面 → 选中计划 → 点修订 tab | tabs 当前/修订可见；修订原因、提议步骤、状态可见；批准后 applied + 步骤替换 + 刷新 |
| F7 | 钉住产物后 → 最大化主区/副栏 → 恢复 | divider 状态切换；主/副区可见性；比例恢复；aria-pressed |
| E4 | 文件树「在文件管理器中显示」 | bridge 返回 `{ok:true,testInstance:true}`；UI 状态可见；测试实例不弹系统窗口 |
| E1（入口） | 标题栏「更多工具」菜单 | 中心模式/终端/侧聊/右轨面同菜单列出；点击生效 |
| 非范围 | E1 渲染宿主合并、E9 终端分屏、计划 spec 版本表新模型 |

## 2. 实现清单

- `PlanSurface.tsx` + `planApprovals.ts`：`fetchPlanRevisions`、修订 tab/批准/刷新、按选中版本复制下载。
- `ArtifactPinPane.tsx` + CSS：最大化/恢复。
- `src/ipc/file-dialog.js`：测试实例干跑；`RightFileTree.tsx`/`GeneratedFilesSurface.tsx` 可见状态。
- `useWorkspaceTitleBar.ts` + `project-workspace.tsx`：宿主入口菜单。
- 实机脚本/flow、canonical 台账。

## 3. 阶段与状态

| 阶段 | 状态 | 产出 |
| --- | --- | --- |
| P0 立项 | ✅ | 本计划 + 注册 + 影响面 |
| P1 计划修订 tabs | ✅ | PlanSurface 修订 tabs/批准/按版本复制下载 + 3/3 测试 |
| P2 分屏最大化 | ✅ | ArtifactPinPane 主区/副栏最大化/恢复 + 6/6 测试 |
| P3 E4/E1 | ✅ | 测试实例干跑 + 可见状态；标题栏宿主菜单 + 测试 |
| P4 实机/收口 | ✅ | 亮/暗各 **14/14** + closeout + 提交 |

## 4. 验证记录

- **亮/暗各 14/14**（`acceptance/ui-544-547-q5rem/q5rem-live{,-dark}.json`；同份 `acceptance/block-253/`）。
- **B3/H4 计划修订**：`P1_revision_tab_visible`（v1·待批准）、`P1b_revision_detail`（原因 + 提议步骤「先做质控」）、
  `P2_revision_applied_rest`（REST 计划步骤替换为 3 步）、`P2b_revision_applied_ui`（tab 变「已应用」）。
- **E4 文件管理器**：`F1_bridge_test_instance_dry_run` — bridge 直调返回
  `{ok:true,testInstance:true,path:…/note.txt}`（测试实例不弹系统文件管理器）；
  `F2_show_in_folder_status` — 文件树按钮点击后可见「已在文件管理器中显示（测试实例干跑）」。
- **E1 宿主入口（第一步）**：`H1_host_entries_in_tools_menu` 菜单同时列出结果/代码/审查/历史/终端/侧聊与右轨面；
  `H2a_side_chat_toggled`、`H2b_terminal_toggled` 实机开合生效。
- **F7 分屏窗格**：组件测试 6/6（比例拖拽/键盘/持久化 + 主区/副栏最大化/恢复，恢复后比例不变）。
  本包未做「通用窗格模型」与钉住实机腿 → Q-MATRIX F7 仍 🟡。
- **截图**：离屏 `captureScreenshot` 在计划/终端切换后连续超时 → 如实标 unavailable
  （`q5rem-screenshots-{light,dark}.json`）；DOM 断言 + REST 真相为证据主体，不伪造截图。
- **明确 reopen**：E1 跨宿主渲染合并（工作区 URL/底部终端/侧聊仍各自宿主）；E9 终端分屏（母纲 deferred）；
  通用 pane 模型与钉住实机腿；宿主菜单在底部终端打开后无法再次弹出（实机观察到，未在本包修壳层菜单）。

## 5. 非范围

- 不做跨宿主渲染合并（E1 结构部分保留 reopen）。
- 不做终端分屏（E9 deferred）。
- 不碰 G1+ 事项。
