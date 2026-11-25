---
capability: harness-invisible-issues-optimization
status: active-queued
kind: assessment-and-queue
canonical: false
truthDomain: harness-invisible-issues
entrypoint: docs/README.md
registeredAt: 2026-11-25
owner: main-agent
phase: G0
---

# Harness「用户看不到但伤体验」问题核对清单与优化队列（2026-11-25）

> 性质：只读评估 + 排期建议材料，**非工作包、不占串行槽位、不自动开工**。任何项开工仍需 owner 发令。
> 缘起：owner 要求「全面审核这些用户看不到、影响体验的问题，核对好了安排到优化中」。
> 方法：代码现读核真（core/ + frontend/src/ 全量 grep + 关键文件 Read）对照既有审计报告，**区分已修 / 仍在 / 观察态**，不照搬旧报告结论。
> 红线：零新依赖、不碰 owner dev 实例、他方 WIP 零触碰、观感零代签、G0 边界不外推 Provider/GA。

## §1 核对结论总表

| # | 问题 | 口径 | 现读真值（2026-11-25） | 判定 |
|---|---|---|---|---|
| A1 | 静默吞错 | 用户点了没反应、无提示无留痕 | core+src 全量 **493 处**空 catch；`error-log.js`2、`config-schema.js`11、`capability-provisioning.js`7、`judge-core.js`7 等 | **仍在·真问题** |
| A2 | 架构债「能用但难改」 | 改动成本/风险持续抬高 | 架构审计 5.3/10；`console` 319:59 → **288**（自有代码 ratchet 口径 core/+src/，A2 两波治理后：wave1 48 处 console→logger 收敛、wave2 拆 5 纯函数）；`agent-runner.js` 聚宝盆 1366→**1038** 行（−129，facade 兼容） | **两波已治理**（queue7 Done；残余见 A2 后续债） |
| A3 | 自进化 lesson 投毒 | agent 被自己的失败反馈带坏 | 红线是**路径白名单**（`harness-redline.js`），挡源码不挡语义注入；`.petri/LEARNINGS.md` 在白名单且注入 prompt；EVO 的 reopen 只有「事后停环审计」 | **仍在·无事前机械门** |
| A4 | 终止判定只观测不改写 | 「做完了」由 agent 自说自话 | P2 `goal-verifier` 已接线但只发 verdict 事件、`decisionVerifier=null` 未动（裁决2待 owner） | **仍在·待裁决** |
| A5 | 外部监督器缺位 | 进程死/会话断无人接管 | `U-EXTERNAL-SUPERVISOR.md` status=pending_user_ruling，推荐 C 先行（只告警不动作） | **待 owner 拍板** |
| B1 | z-index 军备竞赛 | Toast 在最需要时被压住不可见 | 裸 `z-index:N` **94 处**，无语义档位 token | **仍在** |
| B2 | 间距/圆角 token 名存实亡 | 视觉一致性（低影响） | 裸 px 间距 **1055 处**（审计时 1718，已改善）；`var(--petri-space-)` 现 **1645 处**（审计时仅 2）— 治理已大幅推进 | **大部分已修·收尾项** |
| B3 | 长列表零虚拟化 | 规模上来后左栏卡 | react-window/virtual 仍 0 处；C-01 为观察态，重开条件=会话≥400 或节点>10k | **观察态·未触发** |
| B4 | 键盘 focus 缺失面 | 键盘用户聚焦零反馈 | `welcome.module.css` / `RouteErrorBoundary.tsx` grep `focus-visible` 零命中 | **仍在·低体量** |
| B5 | 死组件/死 CSS | 错误范式误导后人 | `PageHeader`/`WorkbenchEmpty` 仍零引用；~375 行死 CSS | **仍在·低体量** |

## §2 已修项（不重复排查，附证据）

| 旧审计问题 | 现读真值 | 证据 |
|---|---|---|
| `CommandPalette.tsx:10` 误引 4312 行聊天 CSS（首屏 391KB） | **已修**：现第 10 行为 `useKeymapSafe`，无 `import './simple-chat.css'` | `CommandPalette.tsx:1-11` |
| `.drawerError` 亮色对比度 1.45:1 | **已修**：BLOCK-161 W1 改 `--petri-status-error-*`，明暗自适应 | `CodeReviewDrawer.module.css:100-107` |
| `--petri-text-muted` 2.56/3.78 不达标（正文 92 处） | **已修**：BLOCK-161 W1 → 亮 5.3 / 暗 5.94 | `custom.css:91,266` |
| hover-only 显形致键盘焦点不可见、Tab 困陷左栏 | **已修**：补 `:focus-within` | `project-workspace.module.css:1014` |
| Cmd+K 传空数组死功能 | **已修**：`useAppCommands` 返回真实导航/项目/会话/技能命令表 | `App.tsx:115,248`；`useAppCommands.ts:36-90` |

## §3 优化队列建议（单工作包串行，逐项发令）

> 按「用户可感知度 × 修复体量 × 风险」排序；仅建议，不自动开工。

| 序 | 项 | 体量 | 风险 | 建议形态 |
|---|---|---|---|---|
| 1 | A1 静默吞错分级治理：用户路径 catch 留痕（落 incident-log + reasonCode），内部降级保 fail-soft 但补注释；先覆盖 `agentTaskApi.ts` / `tools-executor` / `agent-runner` / `conversation-adapter` | M | 低（可观测 additive） | 可自推，零新依赖 |
| 2 | B4 键盘 focus 补齐 + B5 死代码清理 | S | 低 | 可自推 |
| 3 | B1 z-index 六档语义 token 替换（94 处） | S–M | 低 | 可自推，需观感人眼 |
| 4 | A5 外部监督器 C 先行（只告警不动作，接 OB-003/004/007） | M | 中（控制面边界） | **待 owner 拍板口令** |
| 5 | A3 lesson 投毒事前机械门（注入前语义校验/频率异常熔断） | L | 高（碰自进化链） | **待 owner 裁决，先出方案** |
| 6 | A4 `decisionVerifier` 默认值行为裁决 | M | 高（改终止语义） | **待 owner 裁决** |
| 7 | A2 架构债专项（console 治理扩面 + 聚宝盆拆解） | L | 中 | 待资源，独立大包 |
| 观察 | B2 间距收尾 / B3 虚拟化 | S / M | 低 | C-01 触发条件满足再开 |

## §4 owner 裁决记录（2026-11-25 · 主人「按照你的建议来」）

| 项 | 裁决 | 理由 |
|---|---|---|
| A5 外部监督器 | **C 先行**（只告警不动作，接 OB-003/004/007） | 先把进程死/会话断从不可见变可见，零控制面扩张；拿真实事故频次再决 A/B |
| A3 lesson 投毒机械门 | **先出方案，不动手** | 碰自进化链属高风险，当前只有事后停环；先有方案再决定是否加事前门 |
| A4 `decisionVerifier` 默认值 | **暂不改，维持 `null`** | 改终止语义属行为面大改，G0 阶段无新证据支持；继续观测 verdict 事件 |
| 队列执行 | **按 §3 序执行** | 单工作包串行，逐项发令；先 A1 静默吞错分级治理 |

## §4b A3 机械门 D1–D5 裁决记录（2026-11-25 · 主人「按建议来，以解决问题优化产品为主」）

| # | 裁决点 | 裁决 | 理由 |
|---|---|---|---|
| D1 | 注入边界落地候选②（事后 frequency_rebound 判据提前为注入前冻结） | **行** | 复用既有判据、零新依赖，不动红线表与 EVO reopen；关闭 A3 缺口的最小机械门 |
| D2 | `degrade`（频率持平）是否也冻结 | **不行** | 样本稀疏时持平多属数据不足，全冻误伤学习效率 |
| D3 | 冻结是否回写 lesson DB status | **不行** | 状态收口仍走既有 rollbackLesson，避免两套语义冲突 |
| D4 | `.petri/LEARNINGS.md` 回读注入是否纳入本门 | **不行** | 当前无回读路径，为潜在面预留，接时另票 |
| D5 | `.petri/MEMORY.md` 是否加同类频率门 | **不行** | 该面已有审批门且属事实面，套频率判据语义错配 |

## §5 执行进度

- [x] 队列 1 — A1 静默吞错分级治理 ✅ Done（item 29；提交 721dc1edc 落独立分支 petri-ops/codex-a1-silent-error，未并主线未 push；HK-01 5/5、基线 402→362、零新依赖；扩面待令）
- [x] 队列 2 — B4 focus + B5 死代码 ✅ Done（item 30；提交 6a3fa87ff 落独立分支 petri-ops/b4-focus，未 push；HK-01 6/6；核真发现死组件/多数死CSS已前批删除，仅删尚活 .navbar__* 84行，WorkbenchEmpty.module.css 因测试引用保留；UI-727 in_progress）
- [x] 队列 3 — B1 z-index 语义 token ✅ Done（item 31；提交 6120456e6 落独立分支 petri-ops/b1-zindex，未 push；104 处裸值全量 token 化、裸残留 0、HK-01 6/6；新增 chrome 档、Toast 升最高；观感 pending_human_eye 零代签，UI-728 in_progress）
- [x] 队列 4 — A5 外部监督器 C 先行 ✅ Done（item 32；提交 450483bc3 落独立分支 petri-ops/codex-harness-invisible-a5，未 push；HK-01 10/10、红线扫描零命中、隔离栈 3911 实机双路径验证；只观测不动作、零外发；U 材料 status 保持 pending_user_ruling 未擅翻）
- [x] 队列 5 — A3 机械门方案 ✅ Done（item 33；仅方案零代码改动，落 A3-LESSON-GUARD-DESIGN.md；真注入入口 agent-runner.js:321-323→system-prompt.js:540-542；推荐候选②注入边界 frequency_rebound 冻结）
- [ ] 队列 5.5 — A3 D1 落地（注入边界 frequency_rebound 冻结）——待发令
- [x] 队列 7 — A2 架构债专项 ✅ Done（两波已落地 origin/main：wave1 console→logger 7 文件 48 处 ratchet 335→287；wave2 agent-runner 1038 行 5 纯函数迁 helper+facade；HK-01 现基实测绿；后续债 automation-store 注入消 arch 环待发令）
- [x] 队列 6 — A4 decisionVerifier 裁决 ✅ 留档（按 §4 裁决维持 `null` 不改；goal-verifier 继续只发 verdict 事件观测；改终止语义属行为面大改，G0 无新证据不动。无 worker，无代码改动）

#### 队列 6 A4 裁决留档 · BLOCK-520 P2 观测钩子对齐补记（2026-11-25）

- **裁决**：A4「`decisionVerifier` 默认值行为」维持 `null` 不改（§4 owner「按建议来」裁决；本轮并行派工 msg_39e08fd3c346 复核留档）。改终止语义属行为面大改，G0 阶段无新证据支持，不擅动。
- **与 P2 已落地观测钩子的边界对齐**（真源=`acceptance/harness-observability/P2-EVIDENCE.md` §OB-008 / commit `438ed96c0`）：
  - `goal-verifier.js:28` 的 `createGoalVerifier({goals,todos})` 返回与 decisionVerifier 同构 verdict；经 `loop-orchestrator.js` 的可选 `goalVerifier` 钩子在终止判定点（complete/finalize）**观测调用并 emit `goal_verdict` 事件**——**只观测、不改写 decision**；
  - `agent-runner.js` 的 `decisionVerifier = null` 不变（P2 HK-01 机械守护断言在场）；`spawn-agent-tools.js` 仅在有 goals/todoRefs 时构造钩子，无目标=null 零变化。默认全程未传 → 零行为变化。
  - 因此 A4「维持 null」与 P2「goal-verifier 仅观测」**同一边界**：终止判定不被 verdict 改写，只在事件面多一路可审计观测。后续若要让 verdict 进入 decision，属新行为裁决（推翻本裁决），须 owner 亲裁，不在本轮范围。
- **范围**：纯文档留档，零产品代码改动；与 D1 worker（独立 worktree `codex-a3-d1-lesson`，改 agent-runner/lesson-frequency 面）文件面零冲突，本轮不触碰其文件。G0 开发期常态 · 不外推 packaged/Provider/GA。
- [x] 队列 7 — A2 架构债专项（已完成两波：console 治理 + agent-runner 聚宝盆拆解，见执行进度）

status: active-queued — 4 项裁决已按「主人裁决：按建议来」落定，按 §3 序逐项发令开工；单工作包串行。
