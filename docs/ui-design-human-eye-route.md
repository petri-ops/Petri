---
capability: ui-design-human-eye-route
status: active
goal: 界面设计优化程序的 E 类人眼验收路线与集中签字槽（Agent 不代答）。
acceptance:
  - 22 条 pending_human_eye 逐条有步骤/输入/每步预期/证据留存点
  - 暗色观感、读屏、SUS/树测试真人样本路线在册
  - 签字槽全空，状态 pending_human_eye，绝不写 verified
---

# UI 人眼验收路线与签字槽（canonical · 2026-11-11）

> **状态**：全部 `pending_human_eye`。本文件是**路线与签字槽的唯一集中处**；U 类裁决材料在 `docs/ui-design-ia-decision-material.md`，V 类补腿条件同文件 §7。
> **既有路线复用**：`docs/post-s7-h7-human-eye-route.md` 已含 32 条 debt 人眼子集 / 长内容三态 / 分屏键盘读屏的逐步路线，本文件**不另立第二份逐条路线**，只做索引、增量与集中签字槽。
> **证据规则**：人眼验收证据 = 本路线原文 + 人的明确签字记录（日期、覆盖断言、结论）。DOM/CDP 读数、组件测试、机械门禁、静态评分**均不冒充**人眼观感。Agent 不代答、不替签、不写 `verified`。
> G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 路线索引（复用，不复制）

| 路线 | 来源 | 覆盖 |
| --- | --- | --- |
| E-01 树测试寻路（6 步，寻路 ≥80% / 首击 ≥70% / ≤3 点击） | `docs/ui-design-ia-decision-material.md` §6 | IA 收敛后的入口可达性 |
| E-02 22 条 UI 台账 `pending_human_eye` 集中过目（5 步） | `docs/ui-design-ia-decision-material.md` §6 + `docs/post-s7-h7-human-eye-route.md` | debt 22 条逐条终态 |
| E-03 SUS / UMUX-Lite 观感评分 | `docs/ui-design-ia-decision-material.md` §6 | 真人样本 + 外部量表平台（V 类） |
| 长内容三态 / 元素级裁剪截图 / `min-width:0` 祖先链 | `docs/post-s7-h7-human-eye-route.md` + `docs/ui-design-acceptance-checklist-v1.md` §2/§3 | D2 几何降级项 |
| 四块几何（无重叠 / 同行同宽 / 不溢出 / 祖先右缘 ≤ 可视列） | `docs/ui-design-acceptance-checklist-v1.md` §2 | D2 实机降级项 |

## 2. UI 程序增量人眼项（D1–D4 引入）

| # | 项 | 步骤 | 输入 | 每步预期 | 证据留存点 |
| --- | --- | --- | --- | --- | --- |
| H-01 | 页头 bare 形态（UI-D1） | 1 打开 `/extensions` 2 切到项目工作区 3 对比顶栏品牌 chip 与分隔线 | 同一窗口尺寸、亮色 | 1 独立页无品牌 chip/分隔线 2 工作区恢复 3 切换无跳动 | 两张顶栏裁剪截图 `H-01-{1,2}.png` + 口述 |
| H-02 | 768px 阈值对齐观感（UI-D2） | 1 窗口拖到 769px 2 拖到 768px 3 观察侧栏与投影抽屉 | 投影模式 `data-projection=1` | 1 未触发 2 恰好触发 3 无 1px 抖动 | 769/768 两态截图 + 控制台读数 |
| H-03 | 暗色 hover 收敛（UI-D3） | 1 切暗色 2 悬停 5 类元件 3 观察提亮档位 | 暗色 + 各主题色 | 5 类悬停同一档、无灰 hover、无层级倒挂 | 暗色悬停截图对 `H-03-dark-hover.png` |
| H-04 | selected 专用 token（UI-D3） | 1 指挥中心选中卡片 2 切主题色 3 切亮/暗 | 4 主题色 × 明暗 | 选中态描边/底色随 accent 且可辨识，无「选中＝hover」混淆 | 8 态截图矩阵 `H-04-selected-*.png` |
| H-05 | WCAG 对比度观感（UI-D4） | 1 亮色 2 找到三级文字置于 subtle 表面 3 判断是否影响阅读 | 实测 4.40:1（<4.5，大字 3:1 适用） | 人判定该处是否为大字/是否需调色 | 元素级裁剪截图 + 判定记录 |
| H-06 | focus-visible 键盘路径（UI-D4） | 1 Tab 遍历 12 个缺口文件的元件 2 记录焦点可见性 3 VoiceOver 朗读 | 仅键盘、亮暗各一轮 | 焦点环可见、朗读顺序与标签正确 | 逐文件勾选表 + 录音/逐句记录 |
| H-07 | 八态矩阵观感（UI-D4） | 1 逐格触发 32 格 2 记录缺失/不一致 | 清单 v1 §1 | 每格呈现与判据一致，空格写 `cancelled` 理由 | 32 格勾选表 `H-07-matrix.md` |
| H-08 | 22 条 debt 逐条签字（E-02） | 按 §1 索引路线逐条走 | 见既有路线 | 每条 `verified` 或 `cancelled` + 理由 | `acceptance/block-332/ui-ledger-triage.json` 同批回写 |

## 3. 签字槽（Agent 不填写）

| 路线 | 覆盖断言 | 签字人 | 日期 | 结论 |
| --- | --- | --- | --- | --- |
| E-01 树测试 | 寻路 ≥80% / 首击 ≥70% | ______ | ______ | ______ |
| E-02 22 条 debt | 逐条 verified / cancelled | ______ | ______ | ______ |
| E-03 SUS / UMUX-Lite | 样本量 + 分值 | ______ | ______ | ______ |
| H-01 页头 bare | 亮/暗两态无跳动 | ______ | ______ | ______ |
| H-02 768px 对齐 | 769/768 边界精确 | ______ | ______ | ______ |
| H-03 暗色 hover | 5 类同一档 | ______ | ______ | ______ |
| H-04 selected | 8 态矩阵可辨识 | ______ | ______ | ______ |
| H-05 对比度观感 | 4.40:1 处是否需调色 | ______ | ______ | ______ |
| H-06 focus-visible | 12 文件 + VoiceOver | ______ | ______ | ______ |
| H-07 八态矩阵 | 32 格逐格 | ______ | ______ | ______ |
| H-08 22 条终态 | 台账同批回写 | ______ | ______ | ______ |

> 签字槽全空 ⇒ 以上全部保持 `pending_human_eye`；D5 逐件终态化时不得写成 `done` 或 `verified`。
