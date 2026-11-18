# BLOCK-477 收口报告 — C-47 连翻页惰性/回弹复现与归因

- 日期：2026-11-18
- 发令：用户「开始 C-47」（「先复现并归因，归因成立才立票修复，不猜测性修复」）
- 阶段：**G0 开发期常态 · 不外推 packaged / Provider / GA**
- 状态：**归因成立（reproduced_and_attributed）· 修复未实施 · C-47 票保持 open**

## 1. 三态结论

**`reproduced_and_attributed`** —— 根因已归因，证据三重闭环。C-47 从 BLOCK-358 的
`observed_not_reproduced` 正式推进到「已归因」。本包**不改一行产品代码**，不销票。

## 2. 根因（源码事实 + 状态机 + 实机三重证据）

本地项目文件树有两条冲突的状态更新路径：

| 路径 | 代码位置 | 行为 |
| --- | --- | --- |
| 用户点击「加载更多」 | `RightFileTree.tsx:168-178` `loadMoreRoot` | 从 `rootMore.done` 续拉一页，`setTree(prev => [...prev, ...page.entries])` → 200 加到 400 |
| 本地 2s 轮询 | `RightFileTree.tsx:268-270` `setInterval(refreshFiles, 2000)` | 每 2 秒无条件调 `refreshFiles()` |
| 轮询的副作用 | `RightFileTree.tsx:180-185` `refreshFiles` | `fetchDirPage('', 0)` 覆盖 `setTree(rootPage.entries)` 并把 `rootMore.done` 重置回 200 |

即：`loadMoreRoot` 刚 append 的第 2 页，会在 ≤2s 内被下一次轮询用 offset=0 的第一页**整体覆盖**。
用户看到的「第二次点击惰性/回弹」＝增长后被拉回、或点击恰好落在回弹窗口内表现为 `grew=false`。

**三处模式可被脚本机械提取并逐项在场**（`scanSourceAnchors`，任一缺失即 fail-closed 判红）。

## 3. 证据

| 证据 | 结果 |
| --- | --- |
| `test/block477-filetree-repro.test.mjs` | **5/5 绿**（HK-01 缺席红→绿；含负测「修复版不回弹」+ 篡改源码目录判缺失 fail-closed） |
| 状态机 `simulatePaging` | 520 文件：起始 200 → 首击 400 → 轮询 200，`rebound=true / inert=true`；负测 `pollResets=false` 不回弹 |
| **CDP 实机分相位采样**（`scripts/block477-filetree-live.cjs`，9223 离屏，520 文件夹具） | baseline **200** → 点击 300ms **400** → 1200ms **400** → 2600ms **200**；`hidden=false`（轮询真触发）；`reboundAfter2s=true` |
| 机器结论 | `acceptance/block477-filetree-attribution/repro-conclusion.json` + `block477-live-result.json` |
| 截图 | `acceptance/block477-filetree-attribution/block477-filetree-repro.png` |

实机腿相对 BLOCK-349 的增量：349 在点击后固定等 2500ms 单次采样，只见 `200→200`，无法区分
「首击未生效」与「生效后被轮询拉回」；本包按 300/1200/2600ms 分相位采样，捕捉到 `400→200` 的
回弹轨迹，补上了 358 缺失的 GUI 级归因证据。

## 4. 口径诚实

- 状态机是源码语义抽象，不冒充 GUI 真值；GUI 级由 CDP 实机腿独立佐证，两者一致。
- `fixed` 未发生：本包只做复现与归因，**归因成立 ≠ 已修复**。
- 不碰观感：C-47 是功能行为（分页状态），不涉及任何 pending_human_eye 项。
- 9223 测试实例探针跑完已立即 kill，无窗口残留。

## 5. 修复票候选（供用户裁决，未开工）

C-47 已具备立修复票条件。建议修复方向（**仅建议，未实施**）：

- **方向 A（最小、推荐）**：让 `refreshFiles` 在轮询路径只做活动文件签名对账，**不重建树、不重置 `rootMore`**；
  把"整树重拉 + 游标归零"限定在真正的结构变更事件（`projectWorkspaceChanged`、切项目、手动刷新）。
  需保留 UI-399/UI-451 的刷新语义与 SSH 项目差异。
- **方向 B**：轮询前以 `rootMore.done` 为 offset 恢复已加载页数（保状态），代价是每次轮询多拉前 N 页。

两者都属产品代码写面，需用户显式发令另立修复票后实施，本包不预判。

## 6. DoD

源码锚定 + 状态机 + 实机三证据 + 机器结论落盘 + 契约 5/5 + 门禁绿 + 六件套回写 + 显式路径提交。
修复实施、销票均不在本包。G0 开发期常态 · 不外推 packaged / Provider / GA。
