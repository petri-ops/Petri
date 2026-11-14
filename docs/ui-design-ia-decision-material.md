---
capability: ui-design-ia-decision-material
status: active
goal: 汇总界面设计优化程序中需用户裁决的 U 类事项与人眼验收 E 类路线，Agent 不代答。
acceptance:
  - 每项 U 有现状/候选/风险/推荐，状态 pending_user_ruling，默认语义不变
  - 22 条人眼项有人测路线（步骤/输入/每步预期/证据留存点）与签字槽，状态 pending_human_eye
  - 零新增依赖
---

# UI 设计优化程序 · U 类决策材料与 E 类人测路线（v1）

> **状态**：U = `pending_user_ruling`（未裁决前不生效）；E = `pending_human_eye`（未签字前不写 verified）。
> 本文是材料与路线的单一存放处，D1 立项、D4 扩面、D5 逐件终态化时同批回写；不另立第二份。
> G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. U-01 · `/projects`、`/review` 是否新增左栏可见入口

| 项 | 内容 |
| --- | --- |
| 现状 | 两页左栏 `QuickActions` 无入口（`LeftPanel.tsx:339-368`）；可达路径 = 命令面板 `nav-projects`/`nav-review` + 快捷键 `Mod+Shift+P`/`Mod+Shift+R` + `/review` 另有右栏 workSurface tab。评估报告 IA-P1 判为「弱可达」。 |
| 候选 A | 新增两个 QuickAction：可达性提升，但左栏「工作台」分组从 3 项变 5 项，与 D1「重复入口收敛」目标相抵，且改动他方 CSS WIP 引用的组件（样式文件零触碰但组件结构变化需实机）。 |
| 候选 B | 不新增，改为在欢迎页/命令面板显著位提示 + 显式 `cancelled` 留因；保持左栏密度，零 UI 结构改动。 |
| 候选 C | 只补 `/review`（审阅是高频开发动作），`/projects` 保持命令面板入口。 |
| 风险 | A 会改变既有导航语义与视觉密度（需实机+人眼）；B 的「弱可达」结论无法由机械证据推翻，只能由人测裁定；C 是不对称取舍，需说明理由。 |
| **推荐** | **B**（本程序采用，但不等于替用户裁决）：以显式 `cancelled` 留因达成「孤儿页 = 0 或有显式留因」，把是否新增可见入口留给裁决；默认语义完全不变。 |
| 状态 | `pending_user_ruling` — 未获裁决前不新增任何左栏入口。 |

## 2. U-02 · 评分卡出口阈值

| 项 | 内容 |
| --- | --- |
| 现状 | `baseline.json.staticScores.targetPerDimension=4.4`（建议值），综合 ≈3.6；报告 §4.1 写「出口（建议，需用户裁决）：A/B/C/D 各 ≥4.4 且无 P0 未闭合」。 |
| 候选 | ①维持 4.4 为硬门槛；②按维设不同门槛（如 D 维现状 4.5 已过，抬到 4.6）；③不设门槛，只出 Before/After 对照与逐维归因。 |
| 风险 | ①可能因人眼/裁决项未闭合导致程序永远无法达标（而静态分本身可复算）；②引入第二套口径，与清单 v1 §5 冲突；③最诚实但无「达标」结论。 |
| **推荐** | **③**：D5 只出同套评分卡 Before/After 逐维可比表，静态分不冒充观感分，不做达标宣称。 |
| 状态 | `pending_user_ruling` — 本程序不擅自把 4.4 当硬门槛。 |

## 3. U-03 · 是否引入 axe / Storybook / 视觉回归依赖（D3/D4 前置）

| 项 | 内容 |
| --- | --- |
| 现状 | 评估 §1.4：`axe-core` 仅在 docs 3 处提及、不在依赖清单；Storybook / Style Dictionary / Chromatic / Percy / Pa11y / Lighthouse 未见。已有 vitest + happy-dom + @testing-library。 |
| 候选 | ①零新增依赖，用现有 vitest 写可算断言（对比度纯函数、focus-visible 静态覆盖）；②引入 `axe-core`（+ 可能的 jest-axe 适配）；③引入视觉回归（Chromatic/Percy，需出网与账号）。 |
| 风险 | ①覆盖不了真实读屏与像素回归，须如实标边界；②新增依赖走 DEPENDENCY-CHANGE-CHECKLIST（默认「不增」）且需用户裁决，lockfile 面与 CI 成本上升；③出网/凭据属 V 类。 |
| **推荐** | **①**：零新增依赖，机械可算部分自研纯函数 + 负测，不可算部分如实标 `pending_human_eye` / `external-blocked`。 |
| 状态 | `pending_user_ruling` — 本程序不擅自引入任何依赖。 |

## 4. U-04 · 断点档位数（D2 前置）

| 项 | 内容 |
| --- | --- |
| 现状 | 17 个互不统一阈值（见清单 v1 §4）；报告 §3 D2 目标「≤4 档」。 |
| 候选 | ①收敛到 4 档（具体值待定）；②收敛到 3 档；③只做 JS/CSS 常量单源与 767/768 对齐，不改档位语义。 |
| 风险 | 改档位会改变真实响应式行为，需实机几何 + 观感签字（E 类）；不改则「≤4 档」出口不达成。 |
| **推荐** | **③ + 材料**：D2 先做单源与对齐（可逆、零行为变化），档位数收敛留裁决。 |
| 状态 | `pending_user_ruling` — 不擅自改产品响应式语义。 |

## 4b. U-06 · `/projects`、`/review` 是否纳入页头 bare 形态

| 项 | 内容 |
| --- | --- |
| 现状 | `isStandalonePagePath`（`shared.tsx`）决定顶栏是否隐藏品牌 chip 与左区分隔线（`TitleBarLeftZone.tsx:20`、`TitleBarCenterZone.tsx:104`）。清单原有 `/skills /knowledge /backend /plugins /settings` + `/`，其中 `/backend` 已退役、`/skills /plugins` 已重定向。UI-D1 只清残留并补 canonical `/extensions`，未把 `/projects`、`/review` 纳入。 |
| 候选 A | 把两页纳入 bare（与「所有独立页」概念一致，消除报告 IA-P2 的漂移）。 |
| 候选 B | 维持现状（两页保留品牌 chip 与分隔线），只做清单与现存路由对账。 |
| 风险 | A 会改变两页顶栏视觉形态，需元素级截图 + 人眼签字（E 类），且 `/review` 另有右栏 dock 宿主，形态需一并考虑；B 的「清单不含所有独立页」只能靠文档留因，不能宣称完全对齐。 |
| **推荐** | **B + 材料**：本程序采用 B（零视觉形态变化），A 留给裁决；D5 把本项标 `pending_user_ruling`，不写 done。 |
| 状态 | `pending_user_ruling` — 未获裁决前 `STANDALONE_PATHS` 不含这两条路径。 |

## 5. U-05 · i18n 范围

继承 AUDIT-LOG 2026-08-10 🟡 既有裁决「i18n 资源抽离 deferred，待产品明确国际化范围」。本程序不触及、不撤销、不重启；状态 `pending_user_ruling`（既有裁决）。

## 6. E 类人测路线（签字槽在 §8）

### E-01 · 树测试寻路（对应报告 IA-P1 / §4.2）

| 步骤 | 输入 / 操作 | 每步预期 | 证据留存点 |
| --- | --- | --- | --- |
| 1 | 冷启动应用，不阅读任何提示 | 记录首屏可见入口清单 | 截图 `E-01-step1.png` + 口述记录 |
| 2 | 任务「找到全部分析项目库」 | ≤3 次点击可达 `/projects` | 点击序列 + 每步截图 |
| 3 | 任务「审阅当前工作树变更」 | ≤3 次点击可达审阅面，能说明是路由页还是右栏 tab | 点击序列 + 终态截图 |
| 4 | 任务「打开扩展中心的 MCP 服务货架」 | ≤3 次点击可达 | 点击序列 + 终态截图 |
| 5 | 任务「改一个键盘快捷键」 | ≤3 次点击可达设置节 | 点击序列 + 终态截图 |
| 6 | 汇总 | 寻路成功率 ≥80%、首击正确率 ≥70% | 记录表 `E-01-result.md` |

- 判据：报告 §4.2「树测试寻路成功率 ≥80%、首击正确率 ≥70%」；**真人样本**不可由静态门或 DOM 断言替代。
- 状态：`pending_human_eye`。

### E-02 · 22 条 UI 台账 `pending_human_eye` 集中过目

来源 `acceptance/block-332/ui-ledger-triage.json`（debt 35 = 13 live-missing + 22 blocked），既有路线 `docs/post-s7-h7-human-eye-route.md` 在册并为本程序复用（不另立第二份路线）。

| 步骤 | 输入 / 操作 | 每步预期 | 证据留存点 |
| --- | --- | --- | --- |
| 1 | 打开既有路线文档，按 §「分屏键盘读屏」逐条走 | 每条有实际界面状态 | 逐条勾选 + 截图编号 |
| 2 | 暗色模式下重复观感项（hover/selected/层级） | 无「灰 hover / 层级倒挂」 | 暗色截图对 |
| 3 | 长内容三态（清单 v1 §3） | 完整容纳 / 框内滚动且滚动条可见 / ≤900px 不越界 | 三态元素级裁剪截图 |
| 4 | VoiceOver 朗读关键路径 | 焦点顺序与标签可读 | 录音或逐句记录 |
| 5 | 22 条逐条终态 | 每条写 `verified` 或 `cancelled` + 理由 | 台账同批回写 + 签字 |

- 状态：`pending_human_eye`；Agent 不代答、不写 `verified`。

### E-03 · 观感评分（SUS / UMUX-Lite）

报告 §2.2 UX-P2「无用户侧量化基线」。真人样本与外部量表平台属 V/E 混合：量表内容可由 Agent 准备，样本与签字只能由人产生。状态 `pending_human_eye` + `external-blocked`（真人样本与外部平台），补腿条件见 §7。

## 7. V 类补腿条件

| 项 | 阻塞 | 重开判据 |
| --- | --- | --- |
| 真实任务 / 外部量表平台 / 联网 CVE | 凭据或端点不可达 | 凭据在 keychain 且端点可达后按既有 `dev-verify` flow 重跑；超时 `exit 124/125` = unknown，不冒充成功 |
| 9223 离屏实机几何与元素级截图 | dev 栈未在跑 / CDP 不可达 | `PETRI_TEST_ONSCREEN` 一律不设；截图失败标 `screenshot_unavailable`，不靠开窗换证据 |

## 8. 签字槽（Agent 不填写）

| 路线 | 覆盖断言 | 签字人 | 日期 | 结论 |
| --- | --- | --- | --- | --- |
| E-01 树测试 | 寻路 ≥80% / 首击 ≥70% | ______ | ______ | ______ |
| E-02 22 条人眼 | 逐条 verified / cancelled | ______ | ______ | ______ |
| E-03 SUS / UMUX-Lite | 样本量 + 分值 | ______ | ______ | ______ |
| U-01～U-06 裁决 | 逐项裁决原文 | ______ | ______ | ______ |

> 无签字时，本文件所有 U/E 项保持 `pending_user_ruling` / `pending_human_eye`，D5 逐件终态化时不得写成 `done` 或 `verified`。
