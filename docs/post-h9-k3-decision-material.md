---
capability: post-h9-k3-decision-material
status: reference
goal: 汇总 K3 的 E（人眼）/ L（实机 CDP）边界，给出一页决策材料与补腿条件，Agent 不代答、不伪造证据。
acceptance:
  - 人眼路线未签字的事实与后果逐项写明
  - SSE 断线注入三态 flow 缺席、合成 DOM 断言不得冒充 RST 注入
  - 颜色/布局/focus trap 的独立切片条件写明
reopen: 用户完成人眼签字或 CDP 实机栈可用后按补腿条件重开
---

# post-H9 K3 边界材料：人眼 / 实机 / 独立切片

> 状态：E 类 `pending_human_eye` + L 类 `deferred`。本材料是决策输入，不是验收证据；
> `evidenceClass: decision-material`，`verdict` 禁用 PASS/verified/completed。
> 生成：BLOCK-399（2026-11-10）。阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 一、现状（实证）

| 项 | 事实 | 证据 |
| --- | --- | --- |
| 人眼路线 | `docs/post-s7-h7-human-eye-route.md:70-79` 签名区全空：确认人/日期/覆盖勾选/结论均无填写；`:81` 明写「签名区为空时相关条目保持 pending_human_eye」 | file:line |
| UI 台账 debt | 35 条 = live-missing 13 + blocked 22；其中 21 条 `external:true` 属 V/U 类（真实数据、packaged、隧道、凭据、用户裁决），不可由 Agent 补 | `acceptance/block-332/ui-ledger-triage.json:6-12,80-215` |
| 四事件可见性 | 代码层已接线：`runHealthEvents.ts` 四码映射 → `agentTaskStream.ts:436-449` → `onAgentStatus` → `conversationRunStore.ts:390-395` `statusMessage` → `StreamReconnectBanner.tsx`。但 `ToastProvider` 历史未接四事件，`trajectory-events.js` 只分类摘要不 emit | file:line |
| SSE 断线注入 | 全仓 dev-verify/flows 123 文件 + `scripts/post-s7-*.cjs` 精确搜 `RST/断线注入` **0 命中**；`post-s7-cdp-event-projection.cjs:3-8,72` 自证是「页面内合成 SSE 事件 + 自建三态 DOM」，不是真实 RST 注入；`h10/cdp-event-projection.json` 的 `humanEyeEquivalent=false / visualVerified=false` | file:line |
| 布局 | B-11 已交付：内层 `workspaceSessionInner composes: workspaceSessionLayout`，基础定义唯一，`FloatCardResizeHandle` 单定义双挂载 | `project-workspace.module.css:1551-1555` / `CenterPanel.tsx:203-213,263,297` |
| 内联样式债 | 4 族 .tsx 内联颜色 55 处 + 内联 zIndex 5 处；CSS 面 30 文件 354 处冻结门只扫 `.css`，内联字面量原本不受约束 | `h10/color-baseline.json` / K3 基线 |
| focus trap | `CommandPalette.tsx:217-243` 只有 Arrow/Enter/Escape，无 Tab 分支；`:250` 有 `aria-modal` 但焦点可逃出 | file:line |

## 二、候选

| 候选 | 做法 | 后果 |
| --- | --- | --- |
| **C1（推荐）** | 保留人眼项 `in_progress`/`pending_human_eye`；把可机械验证的防回退契约、内联债棘轮门、debt 分诊做成证据；E/L 项出材料并跳到下一可开工项 | 不代答、不伪造；满足蓝图 §5.3 与「证据上限」；35 条逐件有终态 |
| C2 | 用 CDP 合成 DOM 断言把 22 条人眼项翻 `verified` | **禁止**：DOM/几何断言 ≠ 视觉观感（`$petri-css-theme` 视觉验收红线），且 `cdp-event-projection.json` 自己写 `humanEyeEquivalent=false` |
| C3 | Agent 代填签名区 | **禁止**：路线文档明写「本文件不含任何 Agent 代答」；签名证据只能出自人 |
| C4 | 立即改产品 CSS/颜色值/focus trap 凑「体验改进」 | 需人眼暗色 diff、四块几何量测、UI-### 台账同步与读屏；在本会话硬做会把未过目改动写成 verified，违反证据上限 |

## 三、风险

- 把 `verdict=measured` 的 CDP 读数当视觉绿 → 五类证据互相冒充，正是蓝图 §1.4 禁止项。
- 重打 `DEBT_CEILING`（35）或 `ui-ledger-triage.json` 让台账「看起来全绿」→ 属放宽基线，红线禁止；本包零改动。
- 在 dev 双后端/无窗口纪律下盲起实机栈跑 RST 注入 → 可能污染干净树、产生不可复现读数；须按 `$petri-dev-infra` 无窗口 + 9223 离屏 + 跑完即 kill 的姿势另立切片。

## 四、推荐

**C1**：本包只做机械子集（反向契约 22/22、内联棘轮门、布局防回退、debt 分诊、四类不变量裁决）。E/L 项按下表补腿条件另立切片，逐项保持未闭合状态直到真人确认或实机证据落盘。

## 五、证据（当前）

- `acceptance/post-h9-2026-11-10/k3/k3-experience-truth.json`（四类不变量裁决）
- `acceptance/post-h9-2026-11-10/k3/k3-inline-style-baseline.json`（冻结基线）
- `acceptance/post-h9-2026-11-10/k3/k3-debt-triage.json`（35 条逐件分诊）
- `test/post-h9-k3-experience.test.mjs`（22 条契约含「伪造人眼签字必红」负测）

## 六、补腿条件（逐项）

| 边界 | 需要什么 | 谁解锁 |
| --- | --- | --- |
| 人眼路线签字 | 用户按路线六组实测，填确认人/日期/覆盖勾选/结论，截图落 `acceptance/post-s7-2026-11-09/h7/human-eye/` | U（人）· E |
| 暗色对比/层级/长消息换行/Toast 历史层级 | 人眼过目 + 截图 diff；DOM 几何只作结构证据 | E |
| VoiceOver 读屏（viewer 降级 / slider / treeRoving） | 真机读屏；路线 `:52` 明写当前预期「不通过」作补腿基线 | E |
| 32 条 debt 人眼子集 | 逐条读屏与观感，外部条件项如实记「环境不可得」不判通过 | E + V |
| SSE 断线注入三态 | 独立 L 类 flow：真实 RST 注入 → reconnecting/timeout/recovered 三态断言 + 截图 + 人眼过目；禁止复用合成 DOM 断言 | L + E |
| 四块几何量测 | CDP `getBoundingClientRect` 无重叠/同行同宽/不溢出 + 拖到两倍/缩到一半 + 人眼过目 | L + E |
| CommandPalette focus trap | 独立 UI 切片：Tab/Shift+Tab 循环 + 组件契约 + UI-### 台账同步 + 读屏 | A + E |
| 颜色值 token 化 | 人眼暗色 diff 通过后按海军蓝 token 阶梯逐族替换，内联棘轮只减不增、每族一负测 | A + E |
| 四事件接 Toast 历史与重试/复核入口 | 复用 `ToastProvider.history`（不建第二通知中心），每条带 reasonCode；补「事件发出但 UI 不消费」实机断言 | A + L |

## 边界声明

本材料覆盖 K3 的 E/L 边界与一处真 a11y 缺口（focus trap），**未裁决/未签字前不生效**，不写 verified/completed，不冒充行为测试、机械门禁、CDP 实机、人眼观感或真实任务成功中的任一类。按蓝图 §5.3，K3 不停线空等，队列推进到 K4。
