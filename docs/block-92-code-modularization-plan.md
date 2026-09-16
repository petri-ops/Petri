# BLOCK-92-CODE-MODULARIZATION 工作包计划（巨型文件模块化二期）

**最后更新**：2026-09-16
**状态**：`active`（P3 Wave B 页面/面板族已收口：8 提交 53eb2e6e / 87c618c6 / 3f8ba2f3 / 465b0a3c / 910fa6b0 / 2eeffb51 / 162e5a5d / 9fa0947d——project-workspace 1695→1160、ResultArtifactShell 1469→1246、ReviewMode 1429→1310 + useWorkingTreeReview 774→633、DesktopSettingsPanel 973→616、PluginStorePanel 971→789、home 895→739、useSkillStore 743→536、ResultStudioChangeSetPanel 717→530。P2 Wave A copilot 族已收口（3 提交，copilot 族 1347/1226/2024→690/220/1584）。门禁模式：每文件 tsc 0 + 受影响面定向 vitest 拆前基线逐项对账 + 棘轮 --check 绿；台账总行数 33296→29083。**归属更正**：B-5/B-6/B-7 提交信息所记「三套件存量红」实为门禁 shell cwd 伪影（vitest 误从仓库根运行丢 '@/' 别名），自 frontend/ 复验 27/27 全绿，非测试债。下一阶段 P4 Wave C（core 9 文件：拆前必须先存各文件受影响 Node 套件基线，g0-chf0-science 存量红家族逐项对照归属，D8 例外按先例登记归 G0-RS）。）
**Plan ID**：`BLOCK-92-CODE-MODULARIZATION`
**用户裁决原话**：「需要新建一个block用来优化项目代码  主要目的是让巨大代码文件模块化 你能安排一下吗 一定要确保没问题」（2026-09-16）
**家法先例**：`docs/block-9-mega-file-refactor-plan.md`（一期：project-workspace.tsx 3222→4 文件、`_data.ts` 2157→3 文件、buildPreviewTable 抽取）+ `docs/block-9-1-main-js-split-plan.md`（main.js 2450→611 装配器 + `src/ipc/` 域模块），两者均 2026-08-16 当日收口 completed。

---

## 0. 定位与启动门槛

本包是 BLOCK-9 / BLOCK-9.1 的**二期延续**：以 2026-09-16 新行数证据重新入册旧 BLOCK-9.2~9.6 未启动候选中仍然成立的部分，并纳入一期未覆盖的 core / src 大文件。**纯代码组织重构**，不修改任何行为。

**启动门槛（P1 开工前必须全部满足）**：

1. 工作区 UI-386 在制 WIP 已收编（提交或用户显式裁决处置）——本包第一拆分目标 SimpleChat.tsx 与该 WIP 文件面直接重叠；
2. 用户显式裁决启动（本登记为 planned，active 槽位保持空）。

## 1. 代码事实基线（2026-09-16 实测 wc -l @ 工作树，含未提交 UI-386 改动；非测试、非 *.d.ts；P1 启动时重测固化）

### 前端（frontend/src，≥700 行，12 文件）

| 文件 | 行数 | 模块（development-module-map） | 备注 |
| --- | --- | --- | --- |
| components/copilot/SimpleChat.tsx | 2024 | W-03 | **P6 绑定源**；UI-38x 连续迭代面；UI-386 WIP 在树 → 波内最后拆 |
| pages/project-workspace.tsx | 1694 | W-02 | 已有 `project-workspace/` 子目录范式（RightFileTree 等）可延续 |
| components/workspace-panels/ResultArtifactShell.tsx | 1469 | W-04 | |
| components/desktop/WorkingTreeReview/ReviewMode.tsx | 1429 | W-04/审阅 | |
| components/copilot/conversationRunStore.ts | 1334 | W-03 | |
| components/copilot/copilotClient.ts | 1224 | W-03 | |
| components/desktop/DesktopSettingsPanel.tsx | 973 | W-01 | 旧 9.4 目标（1515）已被 sections/ 演进部分消化，残余幅度缩小 |
| components/desktop/PluginStorePanel.tsx | 971 | W-01 | |
| pages/home.tsx | 895 | — | |
| components/desktop/WorkingTreeReview/useWorkingTreeReview.ts | 774 | W-04/审阅 | |
| hooks/useSkillStore.ts | 743 | — | 旧 9.5（singleton store） |
| components/result-studio/ResultStudioChangeSetPanel.tsx | 717 | W-04 | |

### core（core/，≥1500 行，9 文件）

| 文件 | 行数 | 备注 |
| --- | --- | --- |
| shared-backend/result-changeset-service.js | 2783 | 全仓最大 |
| biof3-server/helpers/tools-executor.js | 2711 | loop/agent 族测试面 |
| biof3-server/db.js | 2194 | |
| shared-backend/result-studio-repository.js | 2009 | |
| biof3-server/agent-tools/workspace-tools.js | 1800 | |
| biof3-server/mcp/registry.js | 1699 | |
| shared-backend/result-studio-lifecycle.js | 1692 | |
| shared-backend/result-replay-service.js | 1630 | |
| shared-backend/git-adapter.js | 1549 | |

### src/（Electron 主进程）

| 文件 | 行数 | 备注 |
| --- | --- | --- |
| ipc/working-tree-review.js | 966 | BLOCK-9.1 后新增长大的最大主进程文件 |

**旧候选归宿**：9.2 SimpleChat→本包 Wave A（成立）；9.3 plugin-manager→已被后续演进消化（现 562 行，**销号不再立项**）；9.4 DesktopSettingsPanel→Wave B 缩幅（成立）；9.5 useSkillStore→Wave B（成立）；9.6 IPC channel 常量集中→Wave D 机制项（成立）。

## 2. 范围

**范围内**：上表 22 个文件（22/12/9/1 分布见 §1）的模块化拆分 + 两项机制交付：

- **M1 行数台账**：只读报告脚本（`scripts/code-size-ledger.mjs`），输出 JSON + 人读摘要，P1 落基线证据 `acceptance/block-92/size-baseline.json`；
- **M2 行数棘轮**：对标 BLOCK-83 D7 棘轮先例——对已拆文件「只减不增」，超基线即红；接入整包收口门禁。

**非范围（exclusions，写死）**：

- `core/biof3-server/loop-orchestrator.js`——已有行数门 <1250（现状 1241），本包零触碰，防门缝纠缠；
- <700 行文件一律不拆（IPC 常量集中机制项除外，其按"跨文件机制"入册而非按行数）；
- 一切行为 / 性能 / 架构语义变更；一切重构工具与新依赖（沿用一期"不引入 jscodeshift/ts-morph"裁决）;
- P6 源绑定证据重采（D8 例外族归 G0-RS）；Result Studio P7（deferred）；
- UI-386 在制文件面（SimpleChat.tsx / WorkspaceSummaryCard.* / events.ts / conversationRunStore.ts / project-workspace.module.css / SubAgentsBar.*）：收编前零触碰；
- BLOCK-88（工程师协作，排队中）：启动时如文件面重叠，按届时边界协调。

## 3. 原则（继承一期家法 + 增补）

1. **不修改行为**：只搬代码 + 引入模块边界，0 业务逻辑差异；diff 审查标准=纯移动 + re-export。
2. **不引入新依赖**。
3. **向后兼容**：原 import 路径保留 re-export 兼容层（一期 `project-workspace.tsx` 先例），消费方与测试 import 零改动。
4. **测试零语义改动**：优先通过 re-export 免改测试；确需路径级机械更新的，单独提交并如实登记。
5. **单文件独立闭环**：一文件一提交，可中断可续作；拆前存受影响测试基线 → 拆后复跑对账（红必须归属：存量基线 vs 本包引入，禁静默）。
6. **P6 绑定源登记**：触碰 SimpleChat.tsx 等 P6 绑定源后，写入门回绿 / 存量证据重算门按 D8 例外族转红，如实登记（UI-373 先例），重采归 G0-RS。
7. **模块地图标注**：每文件拆分提交按 `docs/development-module-map.md` 标注主模块（W-01~W-04）。

## 4. 阶段划分（每波独立验收、独立收口）

| 阶段 | 内容 | 验收门禁 |
| --- | --- | --- |
| P0 立项登记 | plan + DOC-REGISTRY + README 入口 + roadmap 排队 + AUDIT-LOG 登记（本次完成） | docs:check + ui:audit:check |
| P1 机制先行 | M1 台账脚本 + 基线固化 + impact-map 映射登记 | 脚本可复现（两次运行同输出）+ docs:check |
| P2 Wave A 前端 copilot 族 | conversationRunStore.ts → copilotClient.ts → **SimpleChat.tsx（最后，硬门槛=UI-386 已收编）** | tsc 0 + copilot 族定向 vitest 全绿 + 台账刷新 |
| P3 Wave B 前端页面/面板族 | project-workspace.tsx → ResultArtifactShell → ReviewMode+useWorkingTreeReview → DesktopSettingsPanel → PluginStorePanel → home → useSkillStore → ResultStudioChangeSetPanel | 同上 + 受影响面 test:changed 全绿 |
| P4 Wave C core 族 | §1 core 9 文件逐个拆分（每文件独立提交） | 受影响 Node 定向全绿（loop/agent 族、result-studio 族、tools-executor 族按文件对号）+ 拆前基线对账 |
| P5 Wave D src/ 族 + IPC 常量 | working-tree-review.js 拆分 + IPC channel 常量集中（旧 9.6）+ M2 棘轮接入 | 主进程相关定向测试 + 棘轮门绿 |
| P6 整包收口 | closeout 四门 + dev-verify 冒烟 + 行数终账 | `npm run closeout` + `npm run verify -- app-health` + `ui341-welcome-chat`（SimpleChat 端到端冒烟）+ `workspace-file-ops` 全部 allPass + 终账 vs 基线逐文件对表 |

**完成语义**：整包 `completed` = 已启动波次全部收口 + 行数终账落 `acceptance/block-92/`；未启动波次必须经用户显式裁决 `deferred` 并回写本状态头，不允许「半拆无主」状态跨包存续。

## 5. 风险与红线

- **SimpleChat.tsx 三重敏感**：全仓最大前端文件 + P6 绑定源 + UI-38x 高频迭代面 → 波内最后拆 + UI-386 收编硬门槛；拆分窗口若与新的在制 UI 包撞期，暂停该文件拆分并上报裁决。
- **core 族存量基线红**：`g0-chf0-science`（本机无 R）等既有红家族 → 每文件拆前必须先存基线，拆后逐项对照归属，杜绝把存量红记成本包引入或反向掩盖。
- **环境纪律**：默认 node=fnm v24；Wave C/D 后端文件变更须重启 dev 栈（拆分纯搬运一般不需重启，凡涉运行验证时预告用户窗口闪动）。
- **诚实边界**：本包交付=代码组织与可维护性，**不宣称**任何性能/行为收益；G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 收口预期预先声明（对账清单）

- P1：台账脚本落仓 + `acceptance/block-92/size-baseline.json` 存证；
- P2~P5：每波门禁实况数字（tsc / 定向测试 x/x / 台账前后行数）记入本文件状态头与 AUDIT-LOG 行；
- P6：closeout 四门绿 + dev-verify 冒烟 3 flow allPass + 终账表（22 文件拆分前后行数 + re-export 层清单 + 未拆文件归属裁决记录）。
