---
capability: block-378-post-nso-s3-experience
status: completed
goal: S3 体验可信化收官——把「看起来能用」升级为「任何状态下用户都知道发生了什么」；字号宪章/失败可见/a11y 对称/能力位链机械面全部落地，实机腿与重前端切片如实分级。
acceptance:
  - 字号宪章：豁免外数值 fontSize 0 残留；theme-token-contract 17/17
  - 失败可见收尾：prefs 重放队列（有界）+文案如实；空 flags 显示「当前无可配置实验开关」
  - a11y：LeftPanel 折叠态 inert
  - 能力位链：钉住按钮接 viewerAdapter 能力位并给原因
  - 实机腿与重前端切片（DOM 窗口化/布局单源/UI-697~701 实机走查）如实登记不冒进
reopen: 实机会话恢复后按 UI-701 待补清单执行
---

# BLOCK-378 · S3 体验可信化收官（post-NSO 蓝图 §9）

> 承载蓝图 §9。发令：用户预授权连续工作模式。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 交付对账（§9 逐项）

| 蓝图项 | 结果 | 证据 |
| --- | --- | --- |
| §9.1 能力位链 | ✅ 机械面 | 钉住接 viewerAdapter 能力位+原因 title（ResultArtifactShell）；canSelect/canExport 位既有消费面在案（BLOCK-175/151） |
| §9.2 失败可见收尾 | ✅ | prefs 重放队列 30s×3（ThemeProvider.tsx；useEffect 卸载清理）；空 flags「当前无可配置实验开关」（ExperimentalFeaturesSection loaded 态） |
| §9.3 a11y 对称 | ✅ 机械面 | LeftPanel 折叠 inert；roving tabindex/把手 slider=树控件重切片（待发令，与实机腿同批） |
| §9.4 字号宪章 | ✅ | 9 文件 20 处收敛（10→xs/11→xs/12→sm/13→sm/16→lg）；XTerm 两处豁免；契约 17/17；tsc 0 |
| §9.5 DOM 预算 | ⏸ | content-visibility 起步已在（W3b）；窗口化+节点上限=重切片待发令（CDP 实测前提） |
| §9.6 UI 台账终态化 | ⏸→S3 后批 | UI-697/698/699/700/701 实机腿集中一次（机器会话恢复后）；分诊棘轮在案 |
| §9.7 视觉四件套 | ⏸ | 归实机批 |
| §9.8 布局单源 | ⏸ | CenterPanel CSS 重构=独立切片待发令（同类规则 >3 判据已满足） |

## 2. 门禁终态

theme 17/17；ThemeProvider 5/5；ExperimentalFeaturesSection 10/10；LeftPanel 17/17；tsc 0；ui:audit PASS（UI-701 in_progress 入账）。

## 3. 未清偿（不冒进）

DOM 窗口化切片 / CenterPanel 布局单源 / 树 roving tabindex+把手 slider / UI-697~701 实机腿——均需实机会话或独立切片发令；已在 UI-701 待补清单登记。
