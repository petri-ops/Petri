# BLOCK-28.6-FONT-SIZE-TOKEN-UNIFICATION — 全局字号 token 统一 Plan

- **Plan ID**: `BLOCK-28.6-FONT-SIZE-TOKEN-UNIFICATION`（用户反馈驱动，2026-08-30）
- **状态**: `completed`（2026-08-30 收口：tsc 0 / 全套 vitest 786/794（8 失败为 TitleBar 已知遗留）/ ui:audit:check / docs:check；CDP 实机 5/5，证据 `acceptance/ui-215/`）
- **truthDomain**: `block-28-font-size-token-unification`
- **阶段**: 单 PHASE（UI-215）codemod + CDP 取证 + 收口
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 用户反馈（2026-08-30）

「审阅的文字和消息会话区的文字大小统一了吗？我觉得软件的所有文字字号都应统一大小」——
审阅面板已 token 化（BLOCK-28.3），但会话区（simple-chat.css 40+ 处硬编码 px，含
10.5/11.5/12.5/13.5 半像素野值）与全局 30+ 文件的 486 处硬编码字号未统一。

## 2. 方案（单 PHASE，UI-215）

**裁决：不做「一个字号走天下」（层级是可读性基础），做「同一层级 = 绝对同一字号」**——
全量归档到 9 级 token（含新增 md）：

| token | 值 | 归档来源（px → rem） |
| --- | --- | --- |
| xs | 10px | 10/10.5px → 0.66rem |
| sm | 11px | 11/11.5px → 0.68~0.74rem |
| caption | 12px | 12/12.5px → 0.75~0.78rem |
| body-sm | 13px | 13/13.5px → 0.8~0.85rem |
| body | 14px | 14px → 0.86~0.92rem |
| md（新增） | 16px | 15/16/17px → 0.95~1.05rem |
| lg | 18px | 18px → 1.1~1.15rem |
| xl / 2xl / 3xl | 20/22/28px | 20/21/22/28px → 1.25/1.3/1.4/1.42rem |

- **保留例外**：<10px（WorkspaceFileIcon 7/8px、9px 微角标等装饰缩微层）、
  24px/>28px display 大标题、em/% 等比字号、xterm 终端配置值。
- codemod（Node 脚本）替换 `font-size: Npx|Nrem` 与 tsx 内联 `fontSize: 'Npx'`：
  **678 处 / 34 文件**（simple-chat.css 79、project-workspace.module.css 234、
  desktop.css 70、custom.css 72、skills 34 等）。
- 顺带补齐 theme-token-contract 第 3 批缺口（7 个被引用未定义的
  `--biof3-fg/-fg-muted/-bg-elev/-bg-button/-bg-button-hover/-mono/-status-success`，
  沿用 UI-151/155 先例以 var() 别名 + 对齐 fallback 定义，该测试由 pre-existing
  失败转绿）。

**非范围**：0 新增 IPC / 0 新依赖 / 0 视觉层级调整（就近归档）/ G1+ 不外推。

## 3. 门禁

tsc 0 / 全套 vitest 786/794（8 失败为 TitleBar 已知遗留集合，theme-token-contract
转绿）/ ui:audit:check / docs:check；CDP 实机 5/5（全页计算字号扫描无半像素与
rem 野值、审阅 13/12px、聊天正文 13px meta 11px、明暗主题分布一致），
截图落 `acceptance/ui-215/`。G0 开发期常态 · 不外推 packaged/Provider/GA.
