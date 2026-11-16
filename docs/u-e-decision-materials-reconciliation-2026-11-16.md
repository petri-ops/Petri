---
capability: u-e-decision-materials-reconciliation-2026-11-16
status: reference
goal: 交接执行队列③——U 类 7 项与 E 类人眼的决策材料/测试路线逐项核对与补齐；不代答、不冒充、不改默认语义。
acceptance:
  - U 类 7 项逐项标明现有材料路径与终态（已有材料只做指针，缺材料补六段一页）
  - E 类人眼路线核对覆盖与签字槽状态，全程 pending_human_eye
  - 每项标注证据锚点（file:line），不足处如实标缺口
reopen: 用户裁决后按候选另立切片；人眼签字后按路线回写台账
---

# U 类 7 项 + E 类人眼：决策材料 / 测试路线对账清单（2026-11-16）

> **状态**：本文是**决策输入与对账清单**，不是验收证据，`evidenceClass: decision-material`。U 类各项 `pending_user_ruling`、E 类各项 `pending_human_eye`；`verdict` 禁用 PASS/verified/completed。Agent 不代答、不替签、不改默认语义。
> 发令：主控提示词 2026-11-16 执行队列③「U 类 7+ 项、E 类人眼项：出决策材料/测试路线，标终态」。
> 事实来源：`acceptance/m-blueprint-2026-11-11/m7/gap-ledger.json`（原档终态）+ `m5a` 证据 + 各工作包 plan + 当次只读核对（2026-11-16）。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 0. 总账（逐项状态）

| # | U 类项 | 原档终态 | 现有材料 | 本次动作 |
| --- | --- | --- | --- | --- |
| 1 | U-04 档位收敛（M-43） | pending_user_ruling | `docs/post-h9-k1-decision-material.md` 决策 B（`:65-95`，六段齐全，不代答/不改默认） | 已有，指针引用，不重造 |
| 2 | TypeScript 双版本（M-65） | pending_user_ruling | `docs/post-h9-k4-decision-material.md`（`:6,14,18-69`，六段齐全，不改 package.json） | 已有，指针引用，不重造 |
| 3 | npm workspaces 迁移评估（M-66） | pending_user_ruling | 仅 gap-ledger note（`:480-484`） | 本次补一页（§3） |
| 4 | test:changed 长耗时拆片范围（M-59） | external-blocked + 需用户裁决范围 | 仅 gap-ledger note（`:431-435`） | 本次补一页（§4） |
| 5 | evals 接入 closeout（M-58） | W + owner 收口后裁决 | gap-ledger note（`:424-428`）+ block-430 plan note | 本次补一页（§5） |
| 6 | MCP 白名单默认（M5-A W5） | done-partial + pendingUserRuling | `m5a-evidence.json:49-55` + block-434 plan `:72` | 本次补一页（§6） |
| 7 | CP-16/17/18 注记冲突对账 | U 类待裁决 | BLOCK-449 s0/s5 登记 + 两处冲突原档 | 本次补一页（§7） |

E 类人眼：见 §8，已有 canonical 路线，签字槽全空，本次只核对覆盖与登记状态。

---

## 1. 已有材料核对（不重造）

- **U-04 档位收敛**：`docs/post-h9-k1-decision-material.md`「决策 B · tools_only / IDE accessMode 档位」六段（现状 `:67-71` / 候选 `:73-79` / 风险 `:81-83` / 推荐 `:85-87` / 证据 `:89-91` / 补腿条件 `:93-95`）齐全，`:13` 明确 `pending_user_ruling` + 不代答 + `verdict` 禁用 PASS/verified/completed，`:77` 推荐维持现状、`:95` 未裁决前不改 `permissions.js`/`contracts.js` 默认语义。**材料合格，无需补。**
- **TypeScript 双版本**：`docs/post-h9-k4-decision-material.md` 六段（`:18-69`）齐全，`:14` `pending_user_ruling`、`:8` 不改任何 `package.json` 版本/锁文件、`:59` 裁决后才改版本并重打锁文件。旁证 `acceptance/m-blueprint-2026-11-11/m6/F/m6-f-view.json:3-19`（`uMaterial.status=pending_user_ruling`、`defaultChanged=false`）。**材料合格，无需补。**

---

## 2. npm workspaces 迁移评估（M-66）

### 现状（实证）
- 根 `package.json` 与 `frontend/package.json` 是无 workspaces 的两个独立包：`root.workspaces=undefined`、`frontend.workspaces=undefined`，包名分别 `petri-desktop` / `petri-desktop-frontend`（当次 `node -e` 读数）。
- 原档 `gap-ledger.json:480-484` `terminal: pending_user_ruling`，note「workspaces 迁移评估需用户裁决」。
- 缺口：`docs/block-432-m6-engineering-debt-plan.md:21` 把评估列入 F 组，但 `m6/F/m6-f-view.json:6` 的 `uMaterial.topic` 只含「typescript 双版本统一 / ADMISSION / FK / 虚拟列表依赖」，**workspaces 不在其中**；7 份既有决策材料全文无 workspaces 六段。

### 候选
| 候选 | 做法 | 后果 |
| --- | --- | --- |
| **A1（推荐）** | 维持两独立包，不迁移；把依赖重复面用只读对账表登记 | 零风险、零锁文件震荡；依赖升级需两处同步的既有成本保留 |
| A2 | 迁 npm workspaces，根 `workspaces` 含 frontend | 统一依赖解析与 hoist；需重打根/前端锁文件、改 CI 安装口径、验证 Electron 打包 `node_modules` 布局，属结构性工程 |
| A3 | pnpm/yarn workspaces | 引入新包管理器依赖，违反零新增依赖倾向，G0 不取 |

### 风险
A2 改 `node_modules` 布局会影响 Electron 打包 ABI 与 `quality:arch` 依赖方向；未裁决前不得静默迁移。A1 的"两处同步"是已知成本，非缺陷。

### 推荐
**A1**：本批不动包结构；若用户裁决 A2，另立工程包，前置=锁文件重打 + CI/打包验证 + 依赖方向门复跑。

### 证据
当次只读 `node -e` 读数（workspaces 字段缺失）；`gap-ledger.json:480-484`；`m6/F/m6-f-view.json:6`。

### 补腿条件
用户裁决 A2 时需给出 hoist 范围、锁文件策略、packaged 验证矩阵；裁决 A1 则本项销号。

---

## 3. test:changed 长耗时拆片范围（M-59）

### 现状（实证）
- `test:changed = node scripts/test-affected.mjs --run`、`test:changed:list = node scripts/test-affected.mjs --json`（当次 npm scripts 读数）；另有 `test:all:sharded = node scripts/test-all-shards.mjs --all`。
- 原档 `gap-ledger.json:431-435` `terminal: external-blocked`，note「test:changed 长耗时拆片需用户裁决范围；本轮保持定向优先」。
- 当次 `npm run closeout` 中 `test:changed` 单门实测 **131.3s**（BLOCK-451 收口笔录在案）——耗时属实，但拆片范围（按域/按 shard / 门级超时）未裁决。

### 候选
| 候选 | 做法 | 后果 |
| --- | --- | --- |
| **A1（推荐）** | 维持定向优先 + 现有 120s 测试超时，拆片范围交 CI（发布前） | 开发态不改行为；长耗时由 CI 分片吸收 |
| A2 | 给 `test:changed` 加门级超时 + 按域拆片 | 收口更快反馈；需裁决域边界与超时阈值，改动测试基建 |
| A3 | 全面切 `test:all:sharded` | 偏离定向优先纪律，开发态全量，不取 |

### 风险
A2 的超时阈值若过短会把环境慢误判为产品失败（违反"exit 124/125=unknown"纪律）；域边界错误会漏测。未裁决前不静默改 `test-affected.mjs`。

### 推荐
**A1**：本批不动测试基建；A2 需用户裁决超时值与域划分后另立包。

### 证据
`gap-ledger.json:431-435`；当次 npm scripts 读数；`docs/block-451-...plan.md` §7 closeout 131.3s 读数。

### 补腿条件
用户裁决 A2 需给超时阈值、域划分、unknown 分流规则；否则 A1 销号。

---

## 4. evals 接入 closeout（M-58）

### 现状（实证）
- `package.json` 现有 evals 脚本：`evals:run/gate/record/replay/judge/catalog/admission`（当次读数）；`package.json` **当次 HEAD-clean**（BLOCK-430 时"在制 WIP"前提已消失，但接线仍需裁决）。
- 原档 `gap-ledger.json:424-428` `terminal: W`，note「evals 接 closeout 需改 package.json（在制 WIP），owner 收口后由用户裁决」。
- `docs/block-430-m4-eval-observability-plan.md:22-24,58` 记录当时零触碰与补腿条件；当次 `evals:run --suite smoke --provider=mock` 历史读数 1/9（ECONNRESET，无窗栈未起）——本批未复跑，不冒充当次读数。

### 候选
| 候选 | 做法 | 后果 |
| --- | --- | --- |
| **A1（推荐）** | 不接 closeout 阻塞链；保留为独立 `--report` 门禁（已知红/环境相关不阻塞） | 不引入环境抖动到收口；evals 仍每轮可选跑并留读数 |
| A2 | 把 `evals:gate` 接进 closeout `--report` | 收口摘要可见 evals 读数，不改变退出码；需裁决与报告级门禁语义一致 |
| A3 | 接成阻塞门禁 | mock 档 ECONNRESET 类环境红会卡收口，违反 fail-open/报告级纪律，不取 |

### 风险
A3 会让环境性失败升为产品失败；A2 需确认 `evals:gate` 读数稳定（BLOCK-430 曾 REUSED_EXISTING_EVIDENCE）。未裁决前不改 closeout 链。

### 推荐
**A1**：本批不接线；A2 需用户裁决报告级接入方式。

### 证据
`gap-ledger.json:424-428`；`package.json` evals scripts 当次读数 + HEAD-clean；block-430 plan `:22-24,58`。

### 补腿条件
用户裁决 A2 需给门禁级别（阻塞/报告）与 REUSED 证据处置规则；否则 A1 销号。

---

## 5. MCP 白名单默认（M5-A W5）

### 现状（实证）
- `m5a-evidence.json:49-55`：W5 `terminal: done-partial`、已接线 `adjudicateStdioConfig`（注入硬字符恒拒 + `PETRI_MCP_COMMAND_ALLOWLIST` 显式生效）；`:54` `pendingUserRuling` 明确「把 node/npx/python3 白名单设为默认拒绝会收窄产品能力面（生态常见 uvx/bun/docker），属 U 类，本包不静默启用」。
- `docs/block-434-m5-wiring-closeout-plan.md:72` 同义登记：未设 env 时保持既有语义，回归面（任意已装命令可用）不破。

### 候选
| 候选 | 做法 | 后果 |
| --- | --- | --- |
| **A1（推荐）** | 维持现状：白名单仅显式 env 生效，默认不收窄 | 生态兼容（uvx/bun/docker）保留；注入硬字符恒拒已生效，安全基线不降 |
| A2 | 默认白名单设为 node/npx/python3 | 收窄攻击面；但 Docker/uvx/bun MCP 生态失效，属产品能力面变更，需用户裁决 |
| A3 | 完全移除白名单能力 | 撤销已交付判据，不取 |

### 风险
A2 会把"未设 env 任意命令可用"改为 fail-closed，改变既有用户可感语义；必须显式裁决才可翻默认。

### 推荐
**A1**：本批不翻默认；安全 hardening 已由注入恒拒 + 显式白名单覆盖。A2 若裁决，另立包并给白名单清单与迁移告知。

### 证据
`m5a-evidence.json:49-55`；`docs/block-434-m5-wiring-closeout-plan.md:72,74,96`。

### 补腿条件
用户裁决 A2 需给默认白名单集合与生态迁移方案；否则 A1 销号。

---

## 6. CP-16/17/18 注记冲突对账

### 现状（实证）
- 两处注记：① vision 母纲 `docs/agent-competitiveness-program.md:172-174` 记 W6 `completed`（2026-10-29 承接评估判销，「CP-16/17/18 未立项」系 10-21 漏检已更正；「W6 无剩余工作，竞争力纲全波次闭环」）；② work-package `docs/block-176-competitiveness-wave6-plan.md:1-11` frontmatter `status: completed`，CP-16/17/18 在范围与验收契约内。
- BLOCK-449 S0 登记：`acceptance/block-449/s0-fact-baseline.json:66` 判 `AGENT-COMPETITIVENESS-PROGRAM` `excluded`，理由「kind=vision 方向母纲；剩余 CP 项（联邦委托 v2 等）登记为需用户裁决单独立项（U 类）」；`s5-decision-log.json:8`「竞争力纲剩余与母纲剩余均 U 类待裁决」。
- 冲突实质：W6 包与母纲都标 completed，但"剩余 CP 项"是否还存在、是否等于 CP-16/17/18，两处注记口径需用户对账裁决。Agent 不自行判定覆盖关系。

### 候选
| 候选 | 做法 | 后果 |
| --- | --- | --- |
| **A1（推荐）** | 维持两处原档不动，登记冲突为待用户对账；竞争力纲视作 reference 母纲，不再自动开工 | 零撤销裁决；剩余项不被误当已完成偷偷开工 |
| A2 | 用户裁决"W6 全覆盖、无剩余 CP" → 在两处注记补一致结论并销号 | 需用户确认联邦委托 v2 等已由 BLOCK-176/183 覆盖 |
| A3 | 用户裁决"仍有剩余" → 另立 U 类子包排队 | 需给具体 CP 项与验收边界 |

### 风险
任一侧自行改注记都可能撤销 10-29 评估判销或 BLOCK-176 收口结论；必须显式裁决。

### 推荐
**A1**：本批只登记冲突、不改两处原档；A2/A3 由用户裁决后另立对账或子包。

### 证据
`agent-competitiveness-program.md:172-174`；`block-176-competitiveness-wave6-plan.md:1-11`；`acceptance/block-449/s0-fact-baseline.json:66`、`s5-decision-log.json:8`；`pending-work-backlog.md:28`。

### 补腿条件
用户裁决 A2/A3 需明确联邦委托 v2 等剩余 CP 项的归属与验收边界；否则 A1 保持登记态。

---

## 7. E 类人眼路线核对（不代答、不替签）

- **canonical 路线**：`docs/ui-design-human-eye-route.md`（status active）含 E-01 树测试 / E-02 22 条 debt 过目 / E-03 SUS/UMUX-Lite + H-01~H-08 增量项，每项有步骤/输入/每步预期/证据留存点（`:30-39`）；签字槽 11 行全空（`:43-55`），`:57` 明确全空即保持 `pending_human_eye`，不得写 done/verified。
- **既有路线复用**：`docs/post-s7-h7-human-eye-route.md`（32 条 debt 子集 / 长内容三态 / 分屏键盘读屏），本批不另立第二份逐条路线。
- **终态核对**：22 条 UI 设计专项签字槽 + M-42/M-44（`gap-ledger.json` `pending_human_eye=2`）均保持 `pending_human_eye`；本批未签字、未改任何台账状态词。
- **缺口**：无材料缺口；唯一缺口是**人的签字本身**（处置权在用户，Agent 不代行）。

---

## 8. 本批边界与终态声明

- 本批**零产品代码改动**、零默认语义改动、零台账状态词改动；只新增本对账文档。
- U 类 7 项终态维持 `pending_user_ruling`（第 4 项原档另带 external-blocked、第 5 项另带 W，均不改）；E 类维持 `pending_human_eye`。
- 用户裁决任一项后，按各材料"补腿条件"另立切片；裁决前不得据本材料开工。
- 换标批 WIP（19 图标 + `desktop-shell.js` + `icon-tray.png`）与 12+ untracked 用户资产零触碰。

G0 开发期常态 · 不外推 packaged/Provider/GA。
