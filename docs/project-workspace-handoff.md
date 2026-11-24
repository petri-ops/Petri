最后更新：2026-11-24（**BLOCK-511 全景修复包收口（completed）**：S0–S6 六阶段串行独立提交；§2 十二缺陷 11 已修 + 1 遗留（web_fetch pin-IP 按授权登记）；门禁 W5a/code-size/tracked-consistency/棘轮留因/CI 11 门全清；HK-01 逐项红→绿；实机 S4 10/10 + S6 4/4（零 CSP 违规/SSE/排队刷新保留），9223 离屏跑完即 kill。**接手先读**=acceptance/panoramic-remediation-2026-11-24/REMEDIATION.md + S1–S6-EVIDENCE.md；**观感零代签**（UI-723 因 3D 卡未实机保留 in_progress）。**存量红两门**=lint:ledger / EAR（S0 基点已红、本包零触碰基线，不凑绿）。串行槽位空。G0 开发期常态 · 不外推 packaged/Provider/GA。）

---

# 工作区交接（Workspace Handoff）

## 恢复顺序（接手 Agent 必读）

1. `docs/AUDIT-LOG.md`（处理 🔴/🟢 未决项——当前无未决；🟡 区为延期/待评估不阻塞）
2. `npm run state`（分支 / WIP / active 工作包两层语义）
3. `docs/next-steps-roadmap.md` + 本文档（重点：§当前待办分类清单）
4. `AGENTS.md` 为唯一工程指令；事实优先级：当次命令输出 > Git/源码 > 证据 JSON > canonical 文档

## 当前事实快照（2026-11-18 现读 · 五步串行全收口 + 治理机械档）

> 本节是交接快照，不是第二真相源；终态以 Git / registry / evidence 原档为准。历史快照原文已搬移 `docs/archive/checkpoints/project-workspace-handoff-through-2026-11-18.md`（链 34 条 + 旧快照段）。

- `main` @ 本批 HEAD（见下方提交）；串行 active 工作包=无（BLOCK-477 / C-47 复现归因收口后槽位回空；BLOCK-476 / C-53 P7 亦已收口；P0 465 / P1 465 / P2 471 / P3 472 / P4 473 / P5 474 / P6 475 / P7 476 全 completed，C-53 UI-DESIGN-QUALITY 八阶段全收口）；C-47 已归因（reproduced_and_attributed，根因=2s 轮询覆盖续拉页），修复票候选方向 A/B 待用户显式发令、票保持 open；下游 Polyfork S7 只读收集待发令。G0 开发期常态 · 不外推 packaged/Provider/GA。
- **S1–S5 五步串行全部收口**（2026-11-18）：BLOCK-465（C-53 P0/P1 设计基线+上下文包）→466（W11 P3 流式首切片）→467（3D P4 对账+Gym 编排）→468（基础设施清偿）→469（img2threejs 借形封装）。每步 HK-01 红绿 + 六件套回写 + 定向 closeout PASS；证据落各自 acceptance/。
- **自动化机制落地**：方案 A——`petri-project-governance/references/NEXT-PHASE-PROMPT-HANDOFF.md`（阶段收口自动落档下一阶段提示词纪律，自动落档草案/不自动发令）；下一阶段提示词=`docs/next-phase-e2e-prompt-2026-11-18-b2.md`（C-53 P2–P7 + Polyfork 只读收集，§2 自包含正文）。
- **下游待发令**：C-53-P2（Jev 现读 confidence 0.58~0.95，advice-only，需用户发令）；Polyfork 授权结论；post-h9 D5 原件处置。观感 pending_human_eye 零代签：UI-706/707/709/710 + E 类人眼 22 条 + C-53 P7 人眼收口。
- **既有红（归属清晰，非债务）**：`quality:perf` packaged_start 边界抖动（G0 噪声，closeout SKIPPED 不算 PASS，不重打基线）；`test-affected.test.mjs:90` block464 evidence gap（测试面存量）；`g0-start-audit` G0-START-09 正则文本已不在本文件（历史残留，非本批破坏）。
- 环境：Node 24（fnm）；9223 离屏实例纪律（跑完即 kill、禁 PETRI_TEST_ONSCREEN）；Jev cloud 已修（`--supply=cloud` 直接可用，四脚本带 NODE_USE_ENV_PROXY=1）；无窗栈 `PETRI_DB_PATH`/`PETRI_LOCAL_DATA_DIR` 指向 `.petri-dev-user-data/data` + :3001 后端 + vite :3000。
- **已收敛**：handoff 头部链经 `npm run handoff:compact` 只保留最近 1 条，历史 34 条原文搬移归档（幂等）；`npm run audit:compact` 同构管理 AUDIT-LOG。

## 当前待办分类清单（2026-11-15 读数 · 2026-11-16 交接落册）

> 事实来源：`acceptance/m-blueprint-2026-11-11/m7/gap-ledger.json` + `m4/m5a` 原档 + AUDIT-LOG 🟡 区当次核对。本节是交接快照，不是第二真相源：各项终态以各自 evidence 原档为准；清偿时在对应工作包收口并增量更新本节。

### 一、等外部条件（0 项）

> **2026-11-16 用户裁决销号**：P6 pressure 腿重采（原 BLOCK-448/449 唯一 external 原册，依赖 `r-enrichment` 生信 capability bundle）经用户显式裁决「生信层面的垂直领域不是当下的需求，清理掉」→ **从活跃待办销号**，不再作为解锁动作追踪。
> - **销号依据 = 用户裁决，不是 bundle 恢复**。`r-enrichment` bundle HTTP 404 是历史事实（probe 2026-11-15T07:37Z / 2026-11-16T08:12Z 均 404，`NoSuchBucket` / `x-oss-ec=0015-00000101`），原样保留、不改写。
> - `docs/block-448-p6-recovery-driver-syntax-plan.md` §7.3 的原补腿条件（bundle 恢复 → `npm run g0:result-studio:p6:update` → `closeout:full` 三连）作为历史证据原样保留，**不冒充已执行、不冒充 P6 通过**。
> - 下游影响：P6 pressure 腿不再纳入当前验收范围；P6 恢复腿（BLOCK-448 active-crash PASS + BLOCK-449 崩溃注入 31/31）与 Result Studio 状态（implemented_unverified / experimental、RS-P7 deferred）均不变。

附注：dev 库本体 4 组 seq 碰撞行将在下次后端启动时由 BLOCK-450 重排逻辑自愈（副本已验证），无需人工动作。

### 二、等用户裁决（U 类，Agent 不可代答）——**2026-11-16 已全部裁决销号（0 项待裁决）**

> **用户裁决**：「U 类 7 项 都行 按你的建议自主搞完 尽可能不要我参与进来」→ 逐项采纳推荐，7 项推荐均为"维持现状"，故全部**维持现状、无需另立切片、销号**。销号≠实现完成：零产品代码/配置/默认语义改动，gap-ledger 与 plan 证据原档历史终态原样保留不改写。逐项裁决表与重开条件见 `docs/u-e-decision-materials-reconciliation-2026-11-16.md` §9。

| 项 | 来源 | 裁决 |
| --- | --- | --- |
| ~~U-04 档位收敛（IDE `accessMode` / `tools_only` 强制）~~ | gap-ledger M-43 | 采纳 B1 维持现状 → 销号 |
| ~~TypeScript 双版本决策（`^5.9.3` vs `^5.5.4`）~~ | M-65 | 采纳 D1 保持 → 销号 |
| ~~npm workspaces 迁移评估~~ | M-66 | 采纳 A1 维持两独立包 → 销号 |
| ~~test:changed 长耗时拆片范围~~ | M-59 | 采纳 A1 维持定向优先 → 销号 |
| ~~evals 接入 closeout~~ | M-58 | 采纳 A1 不接阻塞链 → 销号 |
| ~~MCP 白名单默认~~ | m5a 原档 | 采纳 A1 维持仅显式 env → 销号 |
| ~~竞争力纲 CP-16/17/18 注记冲突对账~~ | BLOCK-449 S0 | 采纳 A1 只登记不改原档 → 销号 |

### 三、可执行候选（有实现路径，需用户发令）

> **候选层级校正（2026-11-16 接手并集）**：`npm run state` 报的 3 项「排队候选」（POST-H9 优化蓝图 / 竞争力纲 / QODER 吸收）——其中后两者 `status: planned`，是**规划大纲**不是可立即开工的单项；QODER §6.5 串行队列已清零、竞争力纲 CP-1~22 全闭环，二者需用户显式裁决另立子包，不构成「可执行候选」。本节唯一可执行候选 = M-55。

| ~~M-55 SSE 真实端点行为测试腿 + 挂 impact-map rule~~ | **2026-11-16 已由 BLOCK-451 收口 completed**（解锁=:3001 无头栈可起；7 契约测试 HK-01 红绿 + 真实回放证据 allPass + impact-map 单一归属；证据=acceptance/block-451/）。本节已无可执行候选，串行槽位空闲。 |

> **执行队列③已完成（2026-11-16，交接流程动作非工作包）**：U 类 7 项 + E 类人眼的决策材料/测试路线逐项核对与补齐，落 `docs/u-e-decision-materials-reconciliation-2026-11-16.md`（registry `U-E-RECON-2026-11-16`）。结论=2 项已有合格材料（U-04→post-h9-k1 决策 B、TS 双版本→post-h9-k4，指针引用不重造）+ 5 项补六段一页决策材料（workspaces / test:changed 拆片 / evals closeout / MCP 白名单默认 / CP 冲突对账）+ E 类 canonical 路线核对（签字槽全空、无材料缺口）。**全批终态不变**：U 类 `pending_user_ruling`、E 类 `pending_human_eye`，Agent 不代答、不替签、不改默认语义、零产品代码改动。batch 收口后交接执行队列①~④全部走完。

### 四、等人眼签字（E 类，不代答）——**2026-11-16 交接 22 条已核销（0 待过）**

> 核对结论（`docs/e-class-human-eye-guide-2026-11-16.md`）：22 条中 11 条前序已 verified、2 条 cancelled、6 条无实机面/等环境（保持 in_progress 非债）、**3 条本次终态化**——UI-200 用户本人确认 verified；UI-695/331 用户授权按 BLOCK-349 口径自动化 flow 8/8 verified。Agent 未代签，UI-200 结论出自用户本人。
- UI 设计专项签字槽（BLOCK-415~423）：路线材料在册（`docs/post-s7-h7-human-eye-route.md`、`docs/ui-design-human-eye-route.md`）；本交接未对其余签字槽代签。
- M-42 / M-44（M6 期自动人眼路线 + 对比度观感确认）：保持 `pending_human_eye`（不在本次 22 条内核销，属设计专项签字槽）。

### 五、已裁决延期/挂起（条件触发，非欠账）

**P6 pressure 腿重采（2026-11-16 用户裁决「生信垂直领域非当下需求，清理掉」→ 活跃待办销号；历史 external 404 事实与 BLOCK-448 §7.3 原补腿条件原样保留，不冒充通过；重开条件=用户重新裁决需求 + bundle 恢复）** · Windows 代码签名（待证书）· i18n 抽离（待国际化决策）· C-34 Claude 缓存断点（待 G1+ 预算）· CP-19 数据桥 WS 化（宜整段设计）· **G0 `macos-arm64: qualified` 视觉证据唯一性问题**（2026-07-27 裁决暂不发布故挂起；**重开条件=任何对外发布前必须先处理**）· G0-RS-P7 重资格（G1+）。

### 六、G1+ 出籍（阶段禁区，不算待办）

Provider 矩阵 / 公证签名 / GA / packaged 三轴对齐 / 远程发布 / `qualificationEligible` —— G0 开发期常态 · 不外推。

### 七、已过时注记（后续进展覆盖，随 audit:compact 自然归档）

M-14（lint errors 属在制 WIP——BLOCK-449 T1 已清账，warnings 2445 基线守住）；M-46 干净树三连部分（BLOCK-449 达成，P6 残腿归第一节）。

### 八、零触碰区与按纪律未跑（非债务）

- 12 项 untracked（第一节快照所列）——处置权在用户。
- `npm run check` / `npm run test:all:workspace` / `test:all:sharded`——按定向优先纪律留发布前 / CI，不是缺口。


