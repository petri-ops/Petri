# BLOCK-28.3-REVIEW-MODE-CHROME-FIX — 审阅面板文案中文化 + 卡片按钮 + 字号对齐 Plan

- **Plan ID**: `BLOCK-28.3-REVIEW-MODE-CHROME-FIX`（用户反馈驱动，2026-08-29）
- **状态**: `completed`（2026-08-29 启动并收口；UI-212 verified，证据 `acceptance/ui-212/`）
- **truthDomain**: `block-28-review-mode-chrome-fix`
- **阶段**: 单 PHASE 收口
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 用户反馈（2026-08-29，BLOCK-28.2 交付后实测）

1. 「code review 是审阅」——面板标题与入口文案应为「审阅」（中文化）。
2. 审阅的按钮应做成与首页快捷入口一致的**卡片风格**（白底 / 描边 / 圆角 / 微阴影）。
3. 「code review 编辑界面的文字明显比其它文字要大」——BLOCK-28.2 把 chrome 字号提到
   13px 反而大于软件主流；实测其它桌面面板 chrome 主流为 **12px**（0.72~0.76rem）。

## 2. 方案（单 PHASE，UI-212）

- 文案：summary 标题 / 空态标题 / TitleBar tooltip / aria-label 统一「审阅」。
- 字号对齐：按钮 / 文件行 / chips / 统计 / diff 头 / commitbox 全部回落 `--biof3-font-size-caption`（12px）；
  summary 标题 13px（body-sm）semibold；空态维持 lg 层级（对齐首页「开始工作」尺度）。
- 按钮卡片化：`.wt-btn` 基础样式改为白底（bg-surface）+ 描边 + 8px 圆角 + 微阴影，
  hover 抬边框加深；Commit 保持 accent 实色主按钮（与首页主操作一致性）。

**非范围**：0 新增 IPC / 0 新依赖 / AI 审阅 0 重新引入 / G1+ 不外推。

## 3. 门禁

tsc 0 / 定向 vitest（断言同步更新）/ ui:audit:check / docs:check；CDP 截图 +
字号计算样式断言落 `acceptance/ui-212/`；台账 verified 后收口提交推送。
G0 开发期常态 · 不外推 packaged/Provider/GA.
