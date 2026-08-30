# BLOCK-28.4-REVIEW-EXIT-ENTRY — 审阅退出按钮 + 「+」菜单审阅入口 Plan

- **Plan ID**: `BLOCK-28.4-REVIEW-EXIT-ENTRY`（用户反馈驱动，2026-08-29）
- **状态**: `completed`（2026-08-30 收口：tsc 0 / 定向 vitest 19/19 / ui:audit:check / docs:check；CDP 实机 8/8，证据 `acceptance/ui-213/`）
- **truthDomain**: `block-28-review-exit-entry`
- **阶段**: 单 PHASE（UI-213）实施 + CDP 取证 + 收口
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 用户反馈（2026-08-29）

1. 「审阅界面有退出按钮吗 不然打开了 不知道怎么退出」——审阅面板需要**显式退出按钮**
   （现仅 Esc / TitleBar Toggle 隐性入口）。
2. 「+」下拉菜单（结果/文件/后端/浏览器/聊天/分析）应加「审阅」入口。

## 2. 方案（单 PHASE，UI-213）

- ReviewMode summary 栏尾部加「退出审阅」X 按钮（Icon `x`）：dock 形态 → `onClose`；
  mode 形态 → `exitReviewMode`（保持已有 Esc 语义层级不变）。
- 「+」菜单 `toolMenuItems` 尾部 concat `{ id: 'review', label: '审阅', icon: 'git-branch' }`
  （isOpen 映射 shell.workingTreeOpen）；`onSelectToolItem` 对 `review` 走
  `shell.toggleWorkingTree()`，不切换 RightPanelMode。

**非范围**：0 新增 IPC / 0 新依赖 / AI 审阅 0 重新引入 / G1+ 不外推。

## 3. 门禁

tsc 0 / 定向 vitest（ReviewMode 退出按钮断言）/ ui:audit:check / docs:check；
CDP 断言「+」菜单含审阅且点击开 dock、面板 X 关闭 dock，截图落 `acceptance/ui-213/`；
台账 verified 后收口提交推送。G0 开发期常态 · 不外推 packaged/Provider/GA.
