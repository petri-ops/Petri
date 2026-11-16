# UI-704 · 设置页 IA v2 · 实施记录（2026-11-17，e2e 波次 W7）

> 设计源：`docs/settings-ia-simplification-design.md`（v2 激进版）+ 用户三条裁决 + 设计宪法 R2。D4 预置=BLOCK-454 收口后实施（已满足）；D6 预置=快捷键随平台。

## 1. 交付物

| # | 项 | 落点 |
|---|---|---|
| 1 | 左栏 core 13→5（模型接口/外观/通知与桌面/用量与资源/数据与维护） | `types.ts` retier+relabel、`SettingsNav.tsx` NAV_GROUPS |
| 2 | 「高级」折叠组默认收起（7 子项：治理与决策/推理档位/联网与代理/远程与计算/快捷键/运行时与诊断/实验特性），深链进入自动展开 | `SettingsNav.tsx`（派生默认=当前分区 tier） |
| 3 | 深链归一 `general→maintenance`（配置迁移并入数据与维护；ExternalImportPanel 随迁） | `types.ts` `normalizeInitialSection`（单点，页面+面板双侧消费） |
| 4 | 全局设置快捷键随平台（macOS Cmd+, / Win Ctrl+,） | `App.tsx` keydown |
| 5 | 页面内 UpdateCard（主进程推送驱动；版本/下载/稍后/关闭/下载完成→安装；设置内手动检查降折叠 details） | `UpdateCard.tsx`（复用 useAutoUpdate，零新 IPC）+ App.tsx 挂载 |
| 6 | models「能力渠道」折叠块（BLOCK-454 槽位显化：检索后端 SearXNG 默认/deepseek 可选 + OCR none 默认/deepseek/local 留接口） | `ChannelPreferencePanel.tsx`（REST /api/web-access + /api/ocr-access 直连） |
| 7 | settingsSearch 索引随 retier 同步（general 关键词并入 maintenance，搜索可达不回退） | `settingsSearch.ts` + 索引顺序对齐 |

## 2. HK-01 红→绿

- 红：`SettingsNav.test.tsx` 重写（6 契约）+ `UpdateCard.test.tsx`（3）+ `ChannelPreferencePanel.test.tsx`（3）先行 → 5 红。
- 绿：12/12 组件契约；设置域邻域 **126/126**（29 文件）+ 组件目录全量 **248/248**；settingsSearch 8/8。
- 实机腿（9223 离屏）：`ui704-live` **11/11 allPass**（core 5 组逐项/高级收起与展开/深链归一/深链自动展开/能力渠道/UpdateCard 缺席/Cmd+, 导航）+ 截图 5 张（全页 PNG，非元素级裁剪如实标注）；instance 跑完立即 kill、未设 PETRI_TEST_ONSCREEN；证据 `live-flow.json` + `shots/`。

## 3. 门禁

theme-token-contract **19/19**（新增 CSS 棘轮合规改写：font-size token 化/边框 border-card 语义位/accent 不动/z-index 用 --petri-z-raised；small 棘轮 3 文件按「次级元信息合法 sm 域」先例登记带理由）；ui:audit:check PASS（台账 UI-704 条目同步；BLOCK-332 债 35=上限压线：live-missing 13/blocked 22）；quality:types PASS；eslint 0 error（6 warning 为既有面板 security 提示族）；BLOCK-332 棘轮契约 5/5。

## 4. 诚实边界（不代签）

- 宽窄视口观感 / 卡片与折叠块视觉 / UpdateCard 真机推送观感 = **pending_human_eye，需用户裁决**（D8 同款「待外部确认」）；台账 UI-704 保持 in_progress；截图为全页非元素级裁剪。
- BLOCK-332 债总额 35 已达上限（总债不增达成）：后续 UI 包新增条目必须先补腿或以已 verified 条目出籍腾位。

## 5. R1 机制显化对照

- BLOCK-454 的 W2/W3 渠道此前「已实现但不可见」（REST 面在、UI 无落点）→ 能力渠道折叠块把检索/OCR 渠道变成用户可感可切（R1 显化）；更新从「设置里找」变「页面内主动出现」（P4 方案择优 + P5-b）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
