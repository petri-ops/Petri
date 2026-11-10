---
capability: block-399-post-h9-k3-experience
status: active
goal: 按第四轮蓝图 §4 K3 把「发生了什么、能用什么、为什么不能用」的体验面逐件定终态；可机械验证的用契约/棘轮门钉死，人眼与实机边界出材料不代答。
acceptance:
  - 四事件投影链有反向契约测与负测（事件发出但无消费点必红）
  - 布局单源（B-11）有防回退契约，几何/人眼双证边界如实登记
  - 内联样式颜色/z-index 债有新增即红的棘轮门 + 负测，且不改产品 CSS/不重打 debt 基线
  - debt 35 逐件机械分诊，22 人眼项不得被标 verified，人眼路线签字缺席如实标注
  - docs:check / ui:audit:check / 定向 test:changed / closeout 全绿
reopen: 用户完成人眼路线签字、或 CDP 实机栈可用后，按 §5 补腿条件逐件重开
---

# BLOCK-399 · post-H9 K3 用户可感知体验收官

> 状态：active · P0-LAUNCH
> 发令：用户 2026-11-10 预授权连续工作「K0→K7 全部推完，全程零参与」。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## §1 立项自检（产品个性 · 强制问句）

**与 ZCode/Codex 的差别形态**：①**本地可审计**——四事件/布局/颜色债的判定全部由仓内脚本从源码与台账复算；②**治理透明**——人眼未签字、断线注入 flow 缺席、颜色替换需观感 diff 一律写成边界材料与补腿条件，不代答、不拿 DOM 断言冒充视觉绿（`$petri-css-theme` 视觉验收红线）；③**证据自证**——新增机械门自带篡改负测，「代码层已交付」与「用户看得见」分级标注。形态上是「通用 agent 可靠性维度的失败可见性」，不是领域内容。

## §2 运行时核实（三处声明需校准）

| 蓝图声明 | 实码核实 | 处置 |
| --- | --- | --- |
| K-14「四事件前端零直接消费」 | **部分过时**：BLOCK-394 B-07 已交付 `copilotClient/runHealthEvents.ts`（四码→文案+严重度，4/4 契约），`agentTaskStream.ts:436-449` → `onAgentStatus` → `conversationRunStore.ts:390-395` 的 `statusMessage` 单通道，`StreamReconnectBanner.tsx` 消费；但 `SimpleChat/ToastProvider` 无四码专属可见 UI（toast 历史回看未接四事件），`trajectory-events.js` 只分类摘要不 emit | 加反向契约防回退；toast 历史接线/真实 SSE 观感标 L/E |
| K-16「布局非单源、同名 class 双定义、两处 resize handle」 | **已交付**：BLOCK-395 B-11 `workspaceSessionInner composes: workspaceSessionLayout`，`.workspaceSessionLayout` 基础定义仅 `project-workspace.module.css:1555`；`FloatCardResizeHandle` 单定义（`FloatCardResizer.tsx:48`）双挂载（`CenterPanel.tsx:263,297`）；剩余同名均在 `@media` 响应式覆写，属正常 | 加防回退契约；几何量测/人眼双证标 L/E |
| K-17「颜色/z-index 未走 token」 | **成立且门有盲区**：4 族 .tsx 内联硬编码颜色约 52 处、`App.tsx:158,162` 内联 zIndex 78/79 仍在；`theme-token-contract.test.ts:116` 的 `CSS_FILES()` 只扫 `.css`，`h10/color-baseline.json` 30 文件 354 处全为 CSS 面，**零 .tsx** → 内联字面量不受「新增即红」约束 | 新增内联样式债棘轮门（冻结当前计数，新增即红）；颜色值替换需人眼暗色 diff → deferred |

另核实：`CommandPalette.tsx:217-243` 无 Tab 分支 → 缺显式 focus trap（真 a11y 缺口，需独立 UI 切片 + 读屏）；`docs/post-s7-h7-human-eye-route.md:70-79` 签名区全空 → **无签字记录**；SSE 断线注入三态实机 flow 全仓 0 命中（`post-s7-cdp-event-projection.cjs:3-8,72` 自证是合成 DOM 断言、非真实 RST 注入）。

## §3 交付（机械可验证子集）

1. `scripts/lib/post-h9-k3-experience.mjs`：四事件投影链裁决器、布局单源裁决器、内联样式债统计器、debt 35 分诊器（纯函数 + 只读扫描，供负测注入）。
2. `test/post-h9-k3-experience.test.mjs`：反向契约（事件发出但无消费点必红）、布局防回退、内联债新增即红、debt 人眼项不冒 verified，逐条篡改负测。
3. `docs/post-h9-k3-decision-material.md`：E 类（人眼路线签字/暗色对比/读屏/长内容三态）+ L 类（SSE 断线注入三态 flow、四块几何量测）+ focus trap 独立切片的一页材料与补腿条件。
4. UI 台账 `docs/ui-productization-audit.md`：本阶段无 UI 组件改动，只追加「K3 分诊结论」说明行，**不改任何 UI-### 状态词、不重打 debt 棘轮**（35 上限零放宽）。

## §4 范围 / 非范围 / 风险

- **范围**：见 §3 四项 + K-14/15/16/17 逐件终态 + 门禁取证。
- **非范围**：不改产品 CSS / 布局层（`$petri-css-theme` §5）、不替换颜色值（需人眼 diff）、不改 `CommandPalette.tsx`（需 UI-### 同步与读屏）、不代签人眼路线、不把合成 CDP DOM 断言冒充真实 RST 注入、不新增 UI truth / 通知中心、不动 10 项用户资产与蓝图原件、不撤销既有用户裁决。
- **依赖**：K0（判据校准）、K1（四事件映射既有交付）、K2（数据面稳定）。
- **风险**：内联债门若把 TSX 类型/测试文件误计入 → 用排除表与负测钉死；debt 分诊若把人眼项误标 verified → 负测直接判红。

## §5 补腿条件（E/L/U 边界）

| 边界 | 补腿条件 | 归属 |
| --- | --- | --- |
| 人眼路线签字 | 用户按 `docs/post-s7-h7-human-eye-route.md` 六组路线实测并填签名区（确认人/日期/覆盖勾选/结论）；Agent 不代答 | E · pending_human_eye |
| 暗色对比/层级/长消息换行/Toast 历史层级 | 人眼过目 + 截图 diff（DOM 几何不等于视觉绿） | E |
| VoiceOver 读屏（viewer 降级 / slider / treeRoving） | 真机读屏确认；路线 `:52` 明写当前预期「不通过」作补腿基线 | E |
| SSE 断线注入三态实机 flow | 独立 L 类 flow：真实 RST 注入 → reconnecting/timeout/recovered 三态断言 + 截图 + 人眼过目 | L |
| 四块几何量测 | CDP `getBoundingClientRect` 四块无重叠/同行同宽/不溢出 + 拖到两倍/缩到一半 + 人眼过目 | L + E |
| CommandPalette focus trap | 独立 UI 切片：Tab 循环 + 组件契约 + UI-### 同步 + 读屏 | A + E |
| 颜色值 token 化 | 人眼暗色 diff 通过后按 token 阶梯逐族替换，内联债棘轮只减不增 | A + E |

## §6 touchSurface / sharedBaselines

- `touchSurface`: `docs/block-399-*.md`、`docs/post-h9-k3-decision-material.md`、`docs/ui-productization-audit.md`（仅说明行）、`scripts/lib/post-h9-k3-*`、`test/post-h9-k3-*`、`acceptance/post-h9-2026-11-10/k3/**`、canonical 六件套。
- `sharedBaselines`: `eslint-suppressions.json` / knip / silent-catch / `acceptance/block-332/ui-ledger-triage.json` / `test/ui-ledger-status-contract.test.mjs` 的 `DEBT_CEILING` 全部零改动。

## §7 验收门禁与证据

`npm run docs:check` / `npm run ui:audit:check` / `npm run test:changed` / `npm run closeout`；证据 `acceptance/post-h9-2026-11-10/k3/` 四字段齐备，E 类材料 `evidenceClass: decision-material`。
