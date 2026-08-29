# BLOCK-28.2-REVIEW-MODE-DOCK — 审阅右侧停靠形态 + 字号/控件卡片化 Plan

- **Plan ID**: `BLOCK-28.2-REVIEW-MODE-DOCK`（用户反馈驱动，2026-08-29 裁决）
- **状态**: `active`
- **truthDomain**: `block-28-review-mode-dock`
- **阶段**: P1 停靠形态（UI-210）→ P2 字号适配 + 控件卡片化（UI-211）→ P3 取证 + 收口
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 用户反馈（2026-08-29，BLOCK-28.1 交付后实测）

1. 「文字大小和软件不适配」——审阅页字号普遍低于全局基线（全局 base 15.5px、正文
   13~14px；审阅页大量使用 10~12px），观感偏小。
2. 「审阅 按钮卡片也应该加上」——hunk 的 Accept/Reject 控件应为卡片样式（elevated
   圆角卡片），而非贴在行尾的小按钮。
3. 「CodeReview 在右侧边栏区域显示就可以了 不需要整个全屏」——主入口改回**右侧
   停靠面板**（dock），不再独占主区。

## 2. 方案

**P1（UI-210）dock 形态**：
- 恢复 `useWorkspacePanels.workingTreeOpen`（Toggle 语义）+ TitleBar 按钮改回开关。
- AppShell 在 open 时渲染 `wt-dock`（fixed 右侧 520px，border-left + 阴影，
  z-index 与旧抽屉同层），内嵌 `<ReviewMode variant="dock" onClose=…>`。
- ReviewMode 支持 `variant: 'mode' | 'dock'`：
  - dock：文件树变为**横向文件条**（chips：状态字母 + basename + ±统计，单行滚动），
    diff 区最大化；summary 条紧凑化；Esc = 关闭 dock。
  - mode（`/review` 路由）保留现状（已 verified，深链可用），两形态共享同一组件。

**P2（UI-211）字号 + 卡片**：
- 字号升档对齐全局：文件行/按钮/统计 caption(12)→body-sm(13)、标题→body(14)、
  空态标题→lg；不再使用 xs(10) 作正文性文字。
- hunk 控件卡片化：`wt-hunk-controls` 改为 elevated 圆角卡片（bg-elevated + border +
  shadow-menu + 内边距），按钮加大热区。

**非范围**：0 新增 IPC / 0 新依赖 / AI 审阅 0 重新引入 / packaged / Provider / GA / P7 G1+。

## 3. 门禁与完成语义

每阶段 tsc 0 + 定向 vitest + ui:audit:check + docs:check（提交含 UI-### 并同提交更新
台账）；P3 CDP 取证 dock 形态（浅/暗）落 `acceptance/ui-210/`，UI-210/211 转 verified，
台账收口 + docs 门禁 + git diff --check 全绿后提交推送。
G0 开发期常态 · 不外推 packaged/Provider/GA.
