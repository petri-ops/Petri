---
capability: ui555-live-evidence
goal: 给 UI-555 三个只有单测的面补上 dev Electron 实机证据——文件预览划词动作条（复制/加入对话/加入速记/侧聊/批注不可用）、图片预览（多图导航/缩放预设/保存契约）、计划批准卡的「继续讨论」调整意见真正上行到模型请求；证据足则把 UI-555 从 in_progress 升为 verified。
acceptance:
  - 划词动作：在文件预览里用真实 DOM Range 选中文字 → 动作条可见且含 5 项（批注禁用并给出理由）；「加入对话」产生 composer 引用 chip，发送后 **mock provider 请求体**含 `【引用 preview-note.md】` + 原文；「加入速记」落库（`sourceKind=selection`，`sourceRef` 指向文件）；「侧聊提问」打开悬挂会话面；「复制」捕获到与选区一致的文本（离屏焦点受限时如实标注 clipboard 实写状态）。
  - 图片预览：拖入两张真实 PNG → 两张缩略图 → 打开预览显示 `1/2` → 下一张变 `2/2` → 200%/50% 缩放预设生效（标签与 transform 同源）→ 保存锚点带原文件名与图片源。
  - 计划反馈：合成 draft 计划（夹具）渲染批准卡 → 输入调整意见 → 点「继续讨论」→ **mock provider 请求体**含该意见 + 计划标题/planId；计划仍为 `draft`（不误批准）；空反馈不发送（由既有单测锁定）。
  - 实机：隔离栈（:3001 后端 + :3000 Vite + :9223 Electron 离屏测试实例 + 临时数据根 + mock provider），亮/暗各一轮；断言报告落 `acceptance/ui-555/` 与 `acceptance/block-251/`；截图不可得时如实 `unavailable`。
  - 门禁：定向 Node/前端测试 + `npm run closeout` 十三门 + canonical 回写 + 本地提交（不推送）。
status: completed
---

# BLOCK-251 · UI-555 实机腿补证

> **一句话**：把「代码与单测绿」升级为「用户真的能在屏幕上划词、翻图、写计划意见，而且意见真的到了模型请求里」。

## 0. 交接摘要（换 agent 先读这一节）

- **背景**：BLOCK-246 交付了 C12 划词动作生产者、C11 图片预览、B2 计划反馈，但只有纯函数/组件单测。其中划词动作的 `WorkspaceFilePreview` 接线（`usePreviewSelection` + `onMouseUp`）没有任何组件测试，属于最需要实机补位的一格。
- **实机姿势**：沿用 BLOCK-246/250 的隔离栈（端口空闲 fail-fast、绝不杀未知进程、离屏、mock provider、临时数据根、`PETRI_TEST_INSTANCE=1`）。
- **证据口径**：DOM 断言（宽高/可见/disabled/计数器）+ **mock provider 请求体**（引用块与计划意见真的上行）+ REST（速记条目、计划状态）。不看「按钮画出来了」就收。
- **夹具**：两张图片用程序生成的最小 PNG；计划用合成 draft（直接写隔离库，报告标注 synthetic），避免依赖真实模型产出计划。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 范围与判据

| 面 | 用户路径 | 判据 |
| --- | --- | --- |
| 划词动作 | 打开 `preview-note.md` → 拖动选中一段 → 动作条 | 5 项动作；批注 `disabled` 且有理由；四项可用动作可逐项触发 |
| 加入对话 | 动作条「加入对话」→ 发送 | chip 可见 + 请求体含 `【引用 preview-note.md】` 与原文 |
| 加入速记 | 动作条「加入速记」 | 提示可见；REST 速记条目 `sourceKind=selection`、`sourceRef` 含文件名、正文含选中文字 |
| 侧聊提问 | 动作条「侧聊提问」 | `side-chat-dock` 打开；可收起 |
| 复制 | 动作条「复制」 | 捕获文本与选区一致；离屏窗口若无法真实写系统剪贴板，如实标注 |
| 图片预览 | composer 拖入两张图片 → 点缩略图 | `sc-preview-counter` 1/2 → 2/2；← 键回 1/2；缩放 200%/50% 标签与 `transform` 同步；保存锚点 `download`/`href` 正确 |
| 计划反馈 | 合成 draft 计划 → 输入意见 → 继续讨论 | 请求体含意见 + planId；计划仍 draft；回合后卡片重新出现 |
| 非范围 | 真实模型计划生成、真实系统剪贴板写盘证明、保存实际写盘（只验锚点契约，避免污染用户 Downloads）、PDF 批注 |

## 2. 实现清单

- `scripts/block251-ui555-live.mjs` — 隔离栈 + mock provider（请求体留档）+ 项目/会话/合成 draft 计划夹具 + 亮暗报告。
- `.agents/skills/petri-dev-infra/dev-verify/flows/ui555-preview-live.cjs` — 三段实机断言链 + 有界截图。
- `test/impact-map.json` — 新脚本/flow/证据目录 → 三个面的既有单测。
- `frontend/src/components/copilot/SimpleChat.tsx` — 实机抓真的缺陷修复：`PlanApprovalCard` 的 `onApprove` 必须转发第二参数（feedback）；`test/plan-feedback-wiring.test.mjs` 机械守卫。
- `docs/ui-productization-audit.md` — UI-555 证据补全后升 `verified`。

## 3. 阶段与状态

| 阶段 | 状态 | 产出 |
| --- | --- | --- |
| P0 立项 | ✅ | 本计划 + 注册 + 影响面规则 |
| P1 实机 harness | ✅ | `scripts/block251-ui555-live.mjs` + flow `ui555-preview-live.cjs` |
| P2 亮色轮 | ✅ | `acceptance/ui-555/ui555-preview-live.json` **27/27** |
| P3 暗色轮 | ✅ | `acceptance/ui-555/ui555-preview-live-dark.json` **27/27** |
| P4 收口 | ✅ | UI-555 verified + canonical + closeout + 提交 |

## 4. 验证记录

- **亮色轮 27/27 · 暗色轮 27/27**（`acceptance/ui-555/`，同份 `acceptance/block-251/`；四张截图
  `ui555-selection-bar-{light,dark}.png` / `ui555-image-preview-{light,dark}.png`，亮暗主题可辨）。
- **划词**：真实 DOM Range 选中 → 动作条 5 项、批注 `disabled` 且带「文本批注暂不支持」理由 →
  引用 chip（`preview-note.md`）→ 发送后请求体含 `【引用 preview-note.md】` + 原文 →
  速记 REST 条目（`sourceKind=selection`、`sourceRef=preview-note.md`、正文含选区）→ 侧聊 dock 打开/收起 →
  复制捕获文本与选区一致（**离屏窗口真实写系统剪贴板失败，clipboardReal=false，如实标注；捕获的是产品传给
  `navigator.clipboard.writeText` 的载荷**）。
- **图片**：Canvas 生成两张 16×16 真 PNG 拖入 → 两张缩略图 → 预览 `1/2` → 下一张 `2/2` → ← 键回 `1/2` →
  200%/50% 缩放标签与 `transform` 同步 → 保存锚点 `download=ui555-red.png`、`href=data:image/png;base64,…`
  （只验契约，不点写盘以免污染用户 Downloads）→ 移除附件清空。
- **计划反馈（实机抓到真缺陷）**：宿主 `SimpleChat` 写成 `onApprove={(action) => handlePlanApprove(action)}`，
  把卡片传出的第二参数 `{feedback}` 丢掉 → 意见永远到不了 hook，卡片单测与 hook 单测都绿却端到端失效。
  已改为转发 `(action, options)`，并新增 `test/plan-feedback-wiring.test.mjs`。修复后：意见进入 mock 请求体
  （含 planId）、计划仍 `draft`、回合结束后卡片重新出现。
- **夹具**：合成 draft 计划（`plan_ui555_live`，报告标 synthetic）；mock provider 3 次调用；隔离栈 + 离屏。

## 5. 非范围

- 不新增产品能力；不改三处组件行为（发现真缺陷另记 AUDIT-LOG）。
- 不做真实模型计划生成；合成 draft 仅为批准卡数据源夹具。
- 不碰 G1+ 事项。
