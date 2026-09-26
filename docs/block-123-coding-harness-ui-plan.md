# BLOCK-123 — 通用编码 harness 使用界面主线（P0 端到端任务对账）

> 立项：2026-09-26（active，P0-LAUNCH；用户裁决「你来定」授权，方向裁决原话见 §1）。
> 能力：`coding-harness-ui`（capability front-matter 已带）。
> 阶段定位：G0 开发期 · 产品主线（方向裁决收口 product-strategy-review-2026-09 §6 观察期约定）。

---
capability: coding-harness-ui
goal: 用户在 Gewu 工作台里用一句自然语言驱动 agent 完成一次真实的通用编码任务（改代码→跑验证→审阅→提交），全链路无断点、反馈完整
acceptance:
  - P0 缺口清单落盘（六环节走查证据 acceptance/block-123/）
  - 后续缺口项逐项 UI-### 登记串行清偿
reopen: 方向裁决回摆生信旗舰倾斜时本主线让位（参照 product-strategy-review-2026-09 §4）
status: active
---

## 1. 一句话目标与方向来源

用户在 Gewu 工作台里，用一句自然语言让 agent 完成一次**真实的通用编码任务**——改代码、跑验证、审阅 diff、提交——全链路无断点、每个环节有反馈。

方向裁决（2026-09-26，用户原话）：「我觉得不行 这个属于垂直领域的扩展 现在需要的仍旧是通用编码harness使用界面作为开发主要工作项 重新思考」+ 委派「你来定」。该裁决收口 `product-strategy-review-2026-09.md` §6 观察期约定（2026-09-03 方向开放 → 通用编码面为开发主线）；§7「底座别再加厚」重新解释=不加厚底座机制（chat/流式/loop 红海标配），加厚的正是**使用界面**。

## 2. 范围与非目标

**范围内**：通用编码任务全链路的使用体验——指令理解、文件读写、命令执行、验证反馈、diff 审阅、提交。
**明确不做（反目标）**：
- 不预设架构手术（存量四件套 UI 是对账对象不是推倒对象）；
- 红海标配面（chat UI/流式输出/agent loop）不加厚；
- 垂直生信域不回摊（转候选池 C-15，重开条件在案）；
- 参数确认卡等已被裁决取消的形态不复活（AGENT-WORKBENCH 修订 2：agent 主导）。

## 3. 存量资产盘点（2026-09-26 勘察，防重复开发）

- **工具面**：workspace_list/find/search/read/**write/replace**（编辑）+ **workspace_exec/exec_background**（命令执行）+ process_status/stop + system_info + todo_write + plan（多步计划）+ verify_state——通用编码工具链**清单层面完备**。
- **UI 面**：工作台四件套俱全——RightFileTree + 文件标签页（useWorkspaceFileTabs）+ TerminalPanel + RightPanel 审阅 tab（WorkingTreeReview/ReviewMode 1310 行 verified，projectId 感知，accept/reject/revertFile IPC 全链）；SimpleChat（plan 审批流 usePlanApprovalFlow、steering、工具活动条）。
- **结论**：缺口不在清单，在**体验闭环**——工具齐但串联体验未经验证，这正是 P0 要用真实任务走出来的。

## 4. 阶段划分

| 阶段 | 内容 | 出口 |
| --- | --- | --- |
| P0（本阶段） | **端到端任务对账**：dev 栈测试实例上跑一个真实通用编码任务，六环节逐项记录断点/缺工具/缺反馈 → 缺口清单落盘 | 走查证据 acceptance/block-123/ + 缺口清单入本 plan §5 |
| P1..Pn | 缺口逐项串行清偿（AGENT-WORKBENCH 修订 3 同款：每项启动前先对照当前代码对账是否已被覆盖） | 每项独立 UI-### 登记 + 实机证据 |

**P0 六环节走查协议**（探针 `scripts/block123-p0-coding-walkthrough.mjs`，复用 block121 flow 驱动姿势：真实 chat + context.accessMode='full' + 测试实例 CDP）：

1. **S1 播种**：临时项目 + 植入带 bug 的小脚本与测试文件（git init，供审阅环节 diff）；
2. **S2 指令**：真实 chat 下达修复任务（「修掉 utils.js 的 bug：divide(1,0) 应抛错而非返回 Infinity；改完跑 `node utils.test.js` 验证并报告结果」）；
3. **S3 读取与编辑**：观察 agent 是否用 workspace_read → workspace_replace/write（SSE 事件流取证工具调用序列）；
4. **S4 执行验证**：是否调 workspace_exec 跑测试、结果是否真实回传并进入回答；
5. **S5 反馈面**：CDP 实机——文件树/标签页是否反映变更、审阅 tab 是否出现该项目的 diff、chat 回答是否引用真实执行输出；
6. **S6 审阅与提交**：审阅 tab 能否看到该变更并可 accept/commit（能走通走到哪一步，断点如实记录）。

每环节记录三类判定：**通（有证据）/ 涩（能走但反馈弱或绕路，记具体表现）/ 断（走不通，记报错与现场）**。产出=缺口清单（编号 G-01..），每条带 file:line 或截图证据指针。

## 5. P0 缺口清单（走查后回填）

（P0 执行后回填；本节为占位锚点。）

## 6. 边界与风险

- 测试实例隔离（start-test-instance.sh），不污染用户实例；临时项目 A6 清理必达（block121 同款 cleanup 链）。
- 并行会话：UI-44x 会话曾在本机活动——本包触达面=工作台 UI + agent-tools workspace/session 域，提交前照常核对 git status，不碰他包 WIP。
- G0 开发期常态 · 不外推 packaged/Provider/GA；单工作包串行纪律不变。
