# BLOCK-29.6-REVIEW-CHROME-COMPACT — 审阅头部 chrome 紧凑化（A+B 全套） Plan

- **Plan ID**: `BLOCK-29.6-REVIEW-CHROME-COMPACT`（用户截图反馈驱动，2026-08-31：「审阅的上面这几个按钮的布局不太专业」；AskUserQuestion 裁决 A+B 全套）
- **状态**: `completed`（2026-08-31 收口：P0 `484beb1` → P1 UI-243 `e47663b` → 本 commit P2 实机 + 收口；dev Electron 实机 verified，证据 `acceptance/ui-243/`）
- **truthDomain**: `block-29-review-mode`（BLOCK-29 审阅面板系列延续）
- **阶段**: P0 登记 → P1 实现（UI-243）→ P2 实机 + 收口
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 诊断（用户截图 + ReviewMode.tsx 结构核对）

三行堆叠 + 全重量级按钮：① `.rvw-summary` 在窄面板放不下换行（actions 折到第二行）→ 标题/按钮/历史工具三层；② 五个同尺寸 chip（编辑文件灰禁用/刷新/提交审阅/全部还原/✕退出）主次不分，唯一 primary「提交审阅」被淹没；③ 破坏性「撤销上次提交」与只读「对比」同权重并排、悬在中间；④ ✕退出属面板导航混进行动区；⑤ 快捷键提示常驻占地；⑥ 原生 select 与 chip 高度风格不一、历史行三控件间距松散。

## 2. 方案（P1，UI-243）

### A. Summary 一行化（不换行）
- 结构：`审阅 + tabs + stats（弱化：tabular-nums + secondary 色）+ 右侧行动区`；`.rvw-summary` 收紧 padding，dock 520px 内单行成立。
- 行动区瘦身：**提交审阅保留唯一 primary**（teal filled + 计数）；刷新 → `refresh` icon-button；✕退出 → icon-only（aria-label/testid 保留）；快捷键提示 → `info` icon tooltip（title），不常驻。
- 「编辑文件」从全局工具条**移到 diff 文件头行内**（`.rvw-file-header`，选中非二进制文件时显示「编辑」小按钮；无选中/二进制不渲染）。
- 「全部还原」降为 danger-ghost 小按钮（保留确认语义不变）。

### B. 历史行重排（`.rvw-history-head`）
- 左组（上下文紧挨）：文件过滤徽标 + 分支选择器 + 对比（模式 toggle）——统一高 28px。
- 右组：**「撤销上次提交」收进 ⋯ 溢出菜单**（危险项，保留 `window.confirm`）；菜单为本地 state 最小实现（点击外部/Esc 关闭），0 新依赖。
- 控件统一 28px 高 / caption 12px / 8px 间距栅格（`.wt-btn` 增加 compact 修饰，不破坏既有用法）。

### 窄面板
`.rvw-summary` 不再折行；放不下的按钮图标化。0 新增 IPC / 0 新依赖 / 审阅内核（diff/hunk/提交/历史数据流）不动。

## 3. 门禁与实机

tsc 0 / 定向 vitest（ReviewMode 相关）/ docs:check / ui:audit:check；实机（dev Electron CDP）：dock 520px + /review 断言单行布局、撤销入菜单、文件头行内编辑、控件 28px；截图 `acceptance/ui-243/`；台账同提交同步。

## 4. 收口（2026-08-31）

- **实机**（CDP 9222，dock 520px）：summary 单行 41px（原三行堆叠）；行动区 5 控件全 28px、提交审阅唯一 primary、退出 icon-only、编辑文件移出行；历史行左组 + ⋯ 菜单（撤销上次提交 danger 项，confirm 保留，backdrop 关闭 ✓）。**实现修正一处**：dock 手风琴与 /review 主区展开结构不同——行内编辑在 dock 落地为手风琴行第三操作（wrench icon，`diffFile.binary` 已知二进制隐藏，accent hover），/review 主区为文件头 `rvw-inline-edit-btn`；两路径实测均出。
- **门禁**：tsc 0 / ReviewMode vitest 19/19 / docs:check 169 / ui:audit:check 265 / docs:reconcile 0。
- **不变量**：0 新增 IPC / 0 新依赖 / 审阅内核（diff/hunk/提交/历史数据流）不动；`window.confirm` 语义保留。

G0 开发期常态 · 不外推 packaged/Provider/GA.
