---
capability: q9-onboarding-role-reveal
goal: Q9 K9——首启角色揭示：首次启动时用一屏说清「格物是什么、能帮你做什么」，一次确认后不再打扰；偏好持久化。
acceptance:
  - `userPrefs.roleRevealSeen`（默认 false，注册表 93→94 键）。
  - 欢迎页首启渲染角色揭示（分析数据 / 写代码 / 整理知识 + 本地运行/透明治理一句），`role=dialog` 可访问；「开始使用」后关闭并写回 true。
  - 已看过（true）不渲染；读取失败按「未知」处理且不渲染（不因后端抖动反复打扰）。
  - 组件/偏好测试 ≥5；类型/主题门禁；9223 离屏实机腿（首启浮层/关闭后不再出现 + 亮/暗截图）；closeout 十三门。
reopen: 分步引导（选模型/装运行时）、数据导入、角色形象动画、从设置重新播放、按语言/主题定制插画。
status: completed
---

# BLOCK-227 · Q9 续项（垂直切片）：首启角色揭示

> 用户裁决：2026-10-21「Q9 余项和 Q-DOMAIN P4 data model 按顺序做完」。
> 母纲：`docs/qoder-essence-absorption-plan.md` §6-Q9（K9 首启角色揭示/数据导入；本包只做角色揭示）。

## 1. P0 实码勘察

| 面 | 现状 | 结论 |
| --- | --- | --- |
| 欢迎页 | `pages/welcome.tsx` 610 行：问候 + 项目选择 + 内嵌 SimpleChat + 快捷 chips | 无任何首启角色介绍 |
| 偏好 | `user-prefs` 支持布尔 | 新增 `roleRevealSeen` 即可 |
| 既有引导 | BLOCK-213 P3 只有一句空态文案 + ⌘K 提示 | 不建立「能做什么」心智 |
| 页面体积 | welcome.tsx 不在 code-size 棘轮 | 可加 2 行挂载 |

## 2. 范围

1. `userPrefs.roleRevealSeen`（默认 false）。
2. `useRoleRevealPreference`（读 `/api/user/prefs`；`dismiss` 写回 true，失败可见）。
3. `FirstRunRoleReveal` 组件：浮层 + 三张角色卡（分析数据 / 写代码 / 整理知识）+ 一句「跑在你机器上、每一步可审阅」+「开始使用」；Esc/遮罩不关闭（必须显式确认，避免误触跳过）。
4. 挂载到欢迎页根节点（已看过不渲染）。
5. 测试 + 9223 实机腿 + closeout。

## 3. 非范围（reopen）

分步引导（模型/运行时）、数据导入、角色动画、设置内重播、语言/插画定制。

## 4. 红线

- 首启只出现一次；默认不阻塞已有项目直达（已看过/读取失败时不渲染）。
- 不收集任何数据；文案不承诺未实现能力。
- 浮层必须可键盘操作（按钮可聚焦，Esc 不关闭=防止误跳过）。

## 5. 验收门禁

- `node --test test/block201-settings-baseline.test.mjs`（94 键）。
- 前端 `useRoleRevealPreference.test.ts`、`FirstRunRoleReveal.test.tsx`、`welcome` 回归。
- `test:changed` + `theme-token-contract` + `quality:types` + `gate:code-size`。
- 9223 离屏实机腿 `acceptance/block-227/`；`npm run closeout` 十三门 PASS。

## 6. 完成语义

`completed` 需：偏好/组件/挂载/测试/实机腿/closeout。**明确声明**：只做角色揭示，不做分步引导与数据导入。

## 7. 收口（2026-10-21）

**结论：BLOCK-227 Q9 K9 首启角色揭示 completed。**

### 7.1 交付

- `userPrefs.roleRevealSeen`（默认 false，注册表 93→94 键）。
- `useRoleRevealPreference`：读取失败不展示（未知≠首次）；`dismiss` 先关本端再写回 true，失败给可见错误但不重弹。
- `FirstRunRoleReveal`：欢迎页一次性浮层（标题/一句话定位/三张角色卡：分析数据、写代码、整理知识/本地执行与可审阅说明/「开始使用」）；必须显式确认（无遮罩/Esc 误跳过）。
- 挂载欢迎页根节点；已看过不渲染。

### 7.2 验证

- 前端 **7/7**（useRoleRevealPreference 4 + FirstRunRoleReveal 3）；配置基线 4/4（94 键）。
- 9223 离屏实机腿 **7/7**：首启浮层三卡 → 亮/暗截图 → 显式确认关闭 → 偏好落盘 true → 刷新不再出现；`acceptance/block-227/`。
- `theme-token-contract` 17/17；`quality:types` 0；`quality:lint` 0 error；`gate:code-size` PASS。
- `npm run closeout` 十三门 PASS（收口时执行）。

### 7.3 边界（reopen）

- 不做分步引导（选模型/运行时）、数据导入、角色动画、设置内重播、语言/插画定制。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
