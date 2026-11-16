最后更新：2026-11-16（**v0.0.1 初版本机打包安装完成**：版本 0.0.1-rc.7→0.0.1（去 rc，commit `3ce3ca73`、tag `v0.0.1`），build:mac-arm64 exit=0，DMG 198M 装到 `/Applications/Petri.app`，启动进程树完整；换标批 WIP 原样入包未提交；本机试用≠发布。用户裁决 P6 销号 + 交接队列①~④全部走完：用户显式裁决「生信层面垂直领域非当下需求，清理掉」→ P6 pressure 腿从活跃待办销号、移入 §五已裁决延期/挂起（历史 404 事实与 BLOCK-448 原补腿条件原样保留，不冒充通过）；外部条件 **1→0**。①probe 仍 404→②BLOCK-451 M-55 completed→③U 类 7+E 类人眼材料核对补齐（`docs/u-e-decision-materials-reconciliation-2026-11-16.md`，全批终态 pending 不变）→④next:suggest。**用户裁决 U 类 7 项全部销号**（「都行 按你的建议自主搞完」→ 7 项均采纳维持现状推荐、销号≠实现完成，原档终态不改写，见对账文档 §9）。**E 类 3 条可过目项已终态化**：UI-200 用户本人确认 verified；UI-695/331 用户授权自动化 flow 8/8 allPass verified（`acceptance/ui-695-331-modelcfg-time/`），其余 19 条前序已 verified/cancelled 或无需过目。待办现为 外部 **0** / U 类裁决 **0（7 项已销号）** / 可执行候选 **0** / E 类人眼 **0（22 条已核销，3 条本次终态化）** / 延期挂起（含 P6 销号）/ G1+ 出籍。**全清单清零**。串行槽位空闲。G0 开发期常态 · 不外推 packaged/Provider/GA.）｜**并集校正 2026-11-16（接手当次读数）**：HEAD 已前进至 `4d3ef9c1`（交接落册提交）；工作区存在「换标批 v4 定稿」tracked WIP（19 图标 + `src/main/desktop-shell.js`）+ `icons/icon-tray.png`，零触碰；`r-enrichment` bundle 11-16T08:12Z 复探仍 404（NoSuchBucket, ec=0015-00000101）⇒ probe 分支走 ②；候选层级校正=QODER/竞争力纲等 3 项为规划大纲（非可执行候选），M-55 为唯一可执行候选。

---

# 工作区交接（Workspace Handoff）

## 恢复顺序（接手 Agent 必读）

1. `docs/AUDIT-LOG.md`（处理 🔴/🟢 未决项——当前无未决；🟡 区为延期/待评估不阻塞）
2. `npm run state`（分支 / WIP / active 工作包两层语义）
3. `docs/next-steps-roadmap.md` + 本文档（重点：§当前待办分类清单）
4. `AGENTS.md` 为唯一工程指令；事实优先级：当次命令输出 > Git/源码 > 证据 JSON > canonical 文档

## 当前事实快照（2026-11-16 交接时点）

- `main` @ `4d3ef9c1`（交接落册提交；原快照 `398b6dc4` 已被其覆盖）；**tracked 树非干净**：19 个 `icons/*` 图标 + `src/main/desktop-shell.js`（「换标批 v4 定稿」tray 图标 template 适配）为在制 WIP，零触碰零提交；**13 项 untracked 用户资产/前会话产物零触碰零提交**（在 12 项基础上新增 `icons/icon-tray.png`：委托子层透明底托盘图标，属换标批 WIP 的一部分，零触碰）。原 12 项=`assets/`、`petri-logo-concepts*`、`tmp-block342-live/`、`tmp-review/`、`model3d/`、`scripts/backfill-artifact-chain.mjs`、evals smoke JSON×2、NSO shard summary、`docs/post-h9-optimization-blueprint-2026-11-10.md` 受保护原件。
- 串行槽位空闲；BLOCK-449（M7 §8 第 3/5 条补腿收口）与 BLOCK-450（M2 尾巴清偿）已收口，M 程序可自主执行项清零。
- 无窗栈可无头启动：`PETRI_DB_PATH`/`PETRI_LOCAL_DATA_DIR` 指向 `.petri-dev-user-data/data` + `R_SERVER_PORT=3001` 起 `node core/petri-server/server.js`；vite `:3000`；9223 离屏实例走 `scripts/start-test-instance.sh`（禁 `PETRI_TEST_ONSCREEN`，跑完立即 kill）。

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
