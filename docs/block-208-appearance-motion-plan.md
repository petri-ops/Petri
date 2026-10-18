---
capability: appearance-motion-toggle
goal: BLOCK-208 = runlist W7c（阶段 4 C-3，**范围收窄**）＝ **动效用户开关**（`system`/`full`/`reduced`）：设置面可选、服务端偏好持久化、`<html data-motion>` 生效、CSS 按开关与 `prefers-reduced-motion` 双双降级。原列的「预览专项 / 通知 / 密度 / 性能」四项**本包不做**（理由见 §0：2e3 原本只点名"预览专项+动效开关"，而预览专项需要独立的代码预览面设计与截图证据批；密度档会牵动全站间距 token，属跨面改动）。
acceptance:
  - P0 基线：`theme-token-contract.test.ts` 现有 11 组契约全绿（本包只加 motion 规则，**不新增颜色 token、不改现有 token 值**）；`prefCache.drift.test.ts` 与 `user-prefs` 族对账继续成立。
  - P1 schema：`user-prefs` 族加两键——`userPrefs.motion`（`system`|`full`|`reduced`，默认 `system`）、`userPrefs.density`（`comfortable`|`compact`，默认 `comfortable`，**只登记不接线**：密度属 reopen，先让键可寻址，避免下次再改 schema 形状）。
  - P2 缓存：`prefCache.ts` 加 `petri-motion` 键 + 枚举 + 读写；与注册表逐项对账（drift 测扩展）。
  - P3 应用：`ThemeProvider` 把 `data-motion` 写到 `<html>`；`system` 时跟随 `prefers-reduced-motion`（CSS 媒体查询负责，JS 只写 `data-motion="system"`）；跨端同步走既有 `/api/user/prefs`（与服务端偏好同一条链）。
  - P4 CSS：新增 `styles/motion.css`（或并入 custom.css）：`[data-motion='reduced']` 与 `@media (prefers-reduced-motion: reduce)` 双双把 `animation-duration`/`transition-duration`/`scroll-behavior` 降级；**只用时长与行为，不引入任何颜色/尺寸 token**。
  - P5 设置面：设置页「常规」节加「动效」三档选择（系统/完整/精简），保存走既有 `setPreference`→`/api/user/prefs` 链（与其他外观偏好同一路径，不新开 API）。
  - P6 证据：`motion.test.tsx`（三档 → `<html data-motion>` + 非法值回落 system）+ `prefCache.drift` 扩展 + token 契约测绿；**9223 实机腿**：三档切换后 `getComputedStyle` 的 animation/transition 时长对比（reduced 命中降级规则）。UI 台账按实机结果记 `verified`；实机腿未跑则记 `in_progress` 并如实说明。
  - 完成语义：动效开关**可配且真的生效**；不承诺"全站所有动效都被这一个开关管住"——第三方/内联动画不在覆盖范围，验收只针对本仓 CSS 定义的过渡与动画。
reopen: 预览专项（代码预览面 + 截图证据批）；密度档接线（token 级间距体系）；对比度档；通知偏好；性能（降级渲染开关）；动效开关对第三方动画的覆盖。
status: completed
---

# BLOCK-208 · 阶段 4 C-3（收窄）：动效用户开关

执行序位置=`docs/stage-3-4-execution-runlist.md` 的 **W7c**（W0–W7b 已 completed）。用户发令：2026-10-18「可以的 按照你的建议来 冲完W7c」。

## 0. 为什么收窄

- 评估报告 2e3 原文只点名「**预览专项 + 动效开关**」（2-3k / 1-2 轮），而 runlist W7c 行把五项都列进了标题——标题不是范围承诺。
- **预览专项**需要独立的代码预览面设计与截图证据批（design charter），塞进本包会让"动效开关"这个可独立验收的小件失去验收边界。
- **密度档**会牵动全站间距 token（跨面改动 + 视觉回归面大），正确做法是单独立项。
- 因此本包交付：**动效开关（可配 + 生效 + 证据）**；`density` 只登记键（可寻址、不接线），其余四项进 reopen。

## 1. 红线（design charter · `$petri-css-theme`）

- **不新增颜色 token、不改现有 token 值**；只加"时长/行为"规则（`animation-duration`/`transition-duration`/`scroll-behavior`）。
- 禁模板与 fallback 回潮：不写真色值、不用 `var(--color-*)`、不写 slate 字面量。
- 暗色覆盖块特异性纪律照旧（本包不新增暗色块）。
- `theme-token-contract.test.ts` 必须绿；`prefCache.drift` 与注册表对账必须绿。

## 2. 落地记录（2026-10-18）

- **P1**：`user-prefs` 加 `motion`（接线）+ `density`（仅登记、`ui:'none'`）⇒ 注册表 **16 族 / 86 键**。
- **P2**：`prefCache.ts` 加 `petri-motion` 键、`MotionMode` 枚举、读写函数；`prefCache.drift.test.ts` 扩到 7 例（枚举与注册表逐项相等）。
- **P3**：`ThemeProvider` 增 `motion`/`setMotion`，`<html data-motion>` 注入；跨端走既有 `applyRemotePrefs`/`pushPrefs`（未新开 API）。
- **P4**：CSS **复用既有 `global.css` 的 reduced-motion 块**（不写第二份）：新增 `html[data-motion='reduced']` 通道 + 媒体查询改 `html:not([data-motion='full'])` 以允许用户显式覆盖系统；功能性过渡豁免同步覆盖两个通道。
- **P5**：设置页「常规」节新增 `MotionControl`（三档；单文件、面板只 +1 行，code-size 棘轮回 670 基线）。
- **P6 证据**：`motion.test.tsx` 3/3 + `prefCache.drift` 7/7 + `theme-token-contract` 17/17；**9223 实机腿未跑**（见 §3）。
- **抓真两处**：①首版把降级规则写进 `custom.css`，与 `global.css` 既有块**重复实现**，且 motion 棘轮当场抓到字面量 `transition-duration: 0.001ms` → 改为复用既有块与 `var(--petri-duration-fast)`；②面板加控制后 code-size 671 > 基线 670 → 删空行回 670 并重打指纹（未抬基线）。

## 3. 未完成（如实登记）

- **9223 实机腿未跑**：三档切换后的 `getComputedStyle` 动画/过渡时长对比未取证 ⇒ UI-525 记 `in_progress`，本包**不以 verified 表述**。
- 预览专项 / 密度接线 / 对比度档 / 通知 / 性能：进 reopen（见 front-matter）。
