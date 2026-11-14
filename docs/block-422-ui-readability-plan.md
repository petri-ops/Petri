---
capability: block-422-ui-readability
status: completed
goal: 把「读起来别扭」的两处真实问题修掉——宽屏聊天内容贴边、三级文字对比度差 0.1 不达标；改完用户能直接看出来。
acceptance:
  - 宽屏下消息区保持 860px 阅读宽并居中，窄屏回落 18px 保底
  - WCAG AA 机械可算对比度 32 对全部 ≥4.5:1（原 1 对 4.40:1）
  - 零新增依赖、零放宽基线、未撤销任何既有裁决
  - 实机实测 + 截图对照，观感仍标 pending_human_eye 等用户验收
---

# BLOCK-422 · 可读性修正（可见排版改善）

> **起因**：用户 2026-11-11 验收反馈「没有看到软件界面有什么明显的变化」。BLOCK-421 是布局单源重构（computed style 逐字等价 ⇒ 零视觉变化），本包才动**用户能看见**的两处。
> **授权**：用户同轮「做布局重构」选择 + 既有 D4 出口「无障碍零严重项（机械可算部分）」；不改配色语言、不动断点档位数、不撤销 2026-10-30 中栏裁决。
> **truthDomain**：`block-422-ui-readability`。

## 1. 范围

1. **消息阅读宽度**：`.sc-messages` 的 `padding` 改为 `2px max(18px, calc((100% - 860px) / 2)) 0` —— 宽屏时内容收到 860px 并居中，窄屏回落 18px 保底（不改 DOM、不加包裹层、无 `!important`）。
2. **对比度达标**：`--petri-text-tertiary` 亮色 `#71717a → #6b6b73`（subtle 表面 4.40:1 → **4.81:1**，同 zinc 色相仅加深）；同步 `gate:ui-a11y` 的 token 对账表（门会抓「改了源码没同步表」）。

## 2. 非范围

- 不改主题色板结构、不改断点档位数、不动暗色 tertiary（暗色 5.94:1 已达标）。
- 不改字号/行高/字重/圆角/阴影等视觉语言（那需要独立的视觉改版裁决与真人观感签字）。
- WIP 文件布局层以外的规则零改动。

## 3. 判据与证据

| 判据 | 当次读数 |
| --- | --- |
| 中栏宽 | 1018px（右栏回到默认 340） |
| 消息区宽 | **860px**（`scrollWidth=860`），两侧各 85px 留白 |
| padding 保底 | 18px（窄屏回落生效） |
| 对比度 | 32 对全部 ≥4.5:1（原 `light tertiary on subtle` 4.40 → **4.81**） |
| 门禁 | `gate:ui-a11y` PASS、`gate:ui-program` 6/6、`gate:code-size` 锚点下降重打、`theme-token-contract` 19/19 |

证据：`acceptance/ui-design-assessment-2026-11-11/d2-refactor/gate-readout.json`（§readability）与 `workspace-after-readable.png`。

## 4. 完成语义

两条改动均有实机读数与截图 ⇒ `completed`；**观感本身仍 `pending_human_eye`**，等用户验收签字，不写 verified。

G0 开发期常态 · 不外推 packaged/Provider/GA。
