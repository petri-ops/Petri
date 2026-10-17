---
capability: agent-competitiveness
goal: BLOCK-195 = 竞争力 8 维**锚点化复测**（评估报告 §5.1 阶段 2 出口判据的最后一条腿）。现状事实：`docs/agent-competitiveness-program.md` §1 的 8 维分数（2026-10-12）是**静态代码推断**产物，而 §5.1 出口判据明写「8 维复评每维有实机/DOM 锚点」，评估报告 §2 标尺行更进一步钉死「**未经 DOM/实机抽样不得定分**」；同一条款还给了合格线「无维 <3」。CP-19 收官后（总纲 19 包全闭环）那套推断值已确定过时——既可能低估（D4 预算环、D6 取消、D7 编排可视等新能力已落地），也可能高估（部分能力位仍为占位）。本包把 8 维从"一次性人工研判"改成**一条命令可复跑的测量**：声明式锚点清单（复用现存测试/评测/实机 flow，零第二套探针）→ 复跑器逐条执行并按**预先公布的映射规则**出分 → 证据 JSON 入 `acceptance/block-195/` → 总纲 §1 翻为测量值并点名无锚点位。做完阶段 2 出口判据两腿齐（评测基线七包在册 + 8 维锚点在册），可注记闭合。
acceptance:
  - **P0 定分规则先行公布（本包反拟合红线）**：分数量表沿用 0–5 与一位小数；每维拆成「能力点位」（取自总纲 §1 判词 + §2 差距矩阵条目），点位三态=`anchored-green`（有机械锚且复跑通过）/ `anchored-red`（有锚但复跑失败=能力缺失或回归）/ `unanchored`（无机械锚）。**分数 = 5 × anchored_green 点位数 ÷ 点位总数**，`unanchored` 计入分母不计入分子（无证据不给分）；与 2026-10-12 推断值并列呈现差值与逐条归因。规则在跑任何锚点**之前**写入本 plan 并随立项提交，禁止事后调整映射或点位集合来凑分；若某维测得 <3（低于 §2 合格线），**如实呈报**并列为进入阶段 3 前的用户裁决项，不调分、不为凑分新增无意义锚。
  - P1 声明式清单 + 复跑器：`evals/anchors/competitiveness-8d.json`（8 维 × 点位 × 锚点，每条含 `cmd` 复跑命令、`tier`∈{unit,frontend,evals,live,probe}、`asserts` 断言点、`path` 证据指针）+ `scripts/block195-anchors.mjs`（逐条执行收 pass/fail/skip；skip 与"环境不可用"分档，**不计入 green**；每维聚合出分；写 `acceptance/block-195/anchors-latest.json`；`--check` 棘轮=锚点条目缺失/命令失效/由绿转红即 exit 非零）。契约测钉：清单结构零 volatile、映射函数纯计算、无锚不给分、skip 不冒绿、命令存在性校验（清单里每条 `path`/测试文件必须真实存在，防"幽灵锚点"）。
  - P2 补界面层缺失锚（只补测量，不改产品行为）：实码核实 `frontend/src/components/copilot/ContextBudgetBar.tsx` 已渲染真实数值（pct/消息 tokens/窗口/分布/待机 0% 空环/上次缓存/窗口未知诚实提示）却**零测试**（`grep -rln ContextBudgetBar frontend/src --include=*.test.tsx` 命中 0）→ 补 `ContextBudgetBar.test.tsx` 组件测作 dim2/dim5 的 DOM 锚；其余缺口点位按 P0 规则如实记 `unanchored`，不硬造锚。
  - P3 实机/DOM 抽样：跑选定 dev-verify flow（真 Chromium 腿，覆盖界面维度）；dev 栈或调试端口不可用时按**环境档**如实标注（沿用 BLOCK-184 `tier:'env'` 先例——不算 PASS 也不算缺陷），并在报告与总纲点名"该维实机腿待补"。**禁止**把 jsdom 层断言冒充真界面抽样。
  - P4 回写：总纲 §1 评分卡翻为「测量值 / 2026-10-12 推断值 / 差值归因 / 每维锚点指针 / 无锚点位清单」（§4 与 §2 不改写，只加指针）；评估报告 §5.1 阶段 2 行与 §5.3 注记闭合出口判据；`docs/pending-work-backlog.md` 队列态同步；`npm run closeout` 十三门 + `test:changed --base=<194 收口提交>` 实覆盖。
  - 完成语义：`node scripts/block195-anchors.mjs` 一条命令复跑 8 维全部锚点并出分；每维至少给到「锚点层级 + 分数 + 无锚点位」三件；阶段 2 出口判据以证据（而非叙述）注记闭合。
reopen: 若测得维度出现 `anchored-red`（回归或缺口坐实）→ 按缺口各自独立立项修复；实机腿若因环境未跑成 → 环境具备后复跑并更新 §1；竞争力标尺换代/对标代际变化时本清单随总纲重估。
status: completed
---

# BLOCK-195 — 竞争力 8 维锚点化复测（阶段 2 出口收口批）

- 状态：`completed`（2026-10-17 用户「是的 就要全自动」=把首包选择权也交给我，按 §5.1 队列头自决；当日立项当日收口，closeout 十三门全绿）

## 0. 测量结果（`node scripts/block195-anchors.mjs` 实跑，非叙述）

53 点位 · 55 锚点 · 46 条唯一命令 · 用时 128s · **anchored-red 0** · 证据 `acceptance/block-195/anchors-latest.json` · 棘轮基线 `evals/anchors/baseline.json`（`--check` 对账通过）。

| 维 | 测量 | 2026-10-12 推断 | Δ | 绿/无锚 | 无锚点位（=证据缺口，点名不藏） |
| --- | --- | --- | --- | --- | --- |
| 1 推理循环韧性 | **4.3** | 3.5 | +0.8 | 6/1 | D2 系统提示 cache 分层 |
| 2 上下文与记忆 | **4.2** | 2.5 | +1.7 | 5/1 | D3 记忆分层与 ANN 质量基线 |
| 3 编排与多智能体 | **4.3** | 2.5 | +1.8 | 6/1 | D5 递归多级派生实跑链 |
| 4 治理与信任 | **3.6** | 3.0 | +0.6 | 5/2 | D11 成本硬熔断、D10 工作树安全网 |
| 5 呈现与交互 | **4.4** | 3.0 | +1.4 | 7/1 | D15 斜杠即执行 |
| 6 表达面 Gen UI | **4.2** | 3.5 | +0.7 | 5/1 | D16 卡片自取数数据绑定 |
| 7 数据资产面 | **3.3** | 3.5 | **−0.2** | 4/2 | 成果回路实机腿（本机缺 R 运行面=环境档）、D18 分屏对照 |
| 8 协作与多端 | **3.3** | 3.0 | +0.3 | 4/2 | CP-16 委托实时流回传、>2 节点中继拓扑 |
| **均值** | **4.0** | ≈3.1 | — | 42/11 | §2 合格线「无维 <3」**达成** |

结论两句话：**静态推断系统性低估**（CP-19 十九包收官后 dim2/3/5 各 +1.4~+1.8，因为那些能力已落地而卡没更新）；**唯一往下走的 dim7 不是产品退步**，而是证据缺口——它的实机腿需要 R 运行面（本机未装，记 `env` 不记绿）与 D18 分屏对照（无锚），按「无证据不给分」自然压低。

## 0.1 六处自纠（都是我这侧的探针/机制问题，逐条留痕）

1. **规范调用姿势**：清单初版用裸 `node --test`，而本仓库规范（`test:all`）带 `--test-force-exit --test-timeout=120000`；`block166-gen-ui-guest-bridge.test.mjs` 断言全过但进程不退出 → 被我 180s 超时误判成红。修=清单命令统一加规范旗。
2. **live 前置写反**：`ui341-welcome-chat` 我按「主实例 9222」写前置，而 dev-verify 的永久红线是**探针禁导航用户主窗**，该腿要 9223 测试实例。起 `scripts/start-test-instance.sh` 后该腿真绿（dim5 4.4 里有它一份）。
3. **环境档不是回归**：`block121-result-loop` 需 R 运行面与 deseq2 工具目录（`A0b/A1/A2g` 三条必失）。新增 `precondition.fsExists` 预检：缺=记 `env`（不给分也不算产品红），在=真跑真判。
4. **自己撞出的机制漏洞**：`POINT_RANK` 里 `red(0) < unanchored(1)`，意味着**把红点位的锚删掉就记成"改善"**——删锚比修产品便宜。补「同点位锚点集合收缩=回归」并加契约测堵死。
5. **复跑会覆写他包证据**：dev-verify flow 的证据落点在 `acceptance/ui-341/`、`acceptance/block-99/`（属 UI-341/BLOCK-99 的验收资产）。本包每次跑完 `git checkout` 还原它们，自己的测量证据只留在 `acceptance/block-195/`。
6. **`--check` 半层级护栏**：带 `--tier=` 过滤的对账会让被过滤的锚"看起来被移除"而造出假回归 → 直接拒（fail-closed），对账必须跑全层级。

## 0.2 阶段 2 出口判据对账（本包的收口意义）

§5.1 阶段 2 出口两条腿：①评测基线 v2 在册——BLOCK-188/189/190/191/192/193/194 七包已闭合；②8 维复评每维有实机/DOM 锚点——本包交付，53 点位全部带 `derivesFrom` 指回总纲，8 维每维至少有 DOM/evals/live 层锚（dim7 的 live 腿受本机环境限制记 `env`，其余层级仍给分）。**两条腿齐 → 阶段 2 出口达成**，阶段 3（配置 schema 统一服务）入口条件成立。门禁：契约测 10/10 · 新增 `ContextBudgetBar.test.tsx` 6/6 · `test:changed --base=f7ae1066` · `npm run closeout` 十三门全绿。


## 1. 为什么这是队列头（不是我又挑一个舒服的包）

§5.1 阶段 2 出口判据两条腿：①评测基线 v2 四件套+真实面在册——**已由 BLOCK-188/189/190/191/192/193/194 七包闭合**；②8 维复评每维有实机/DOM 锚点——**唯一未落**。且总纲 ④ 行明写「竞争力 8 维复测：不单开包，并进 ②/③ 收口批」——本包就是它指定的那个收口批载体。阶段 3 的入口条件（「阶段 2 出口达成」）挂在这条腿上，不做完就开阶段 3 是跳出口。

## 2. 立项自检（对标不改魂）

差别形态：竞品的"竞争力自评"通常是路演口径（PPT 打勾）；Petri 这里把自评**降级为可复跑测量**——分数由公开公式从机械锚导出，任何人 `node scripts/block195-anchors.mjs` 就能重算，点位无锚就不得分（证据自证 + 本地可审计）。借的是行业 8 维标尺这个形，长出来的是「自评必须能被别人一键复算」的自有形态。

## 3. 非范围（红线）

- **不为凑分动产品**：本包只补测量锚与定分；发现 `anchored-red` 的产品缺口一律如实定分 + 点名 + 独立立项候选，不在本包内顺手实现（阶段纪律：不提前做后续能力）。
- **不新建第二套探针**：优先复用现存 `test/*.test.mjs`、`frontend/src/**/*.test.ts(x)`、`evals` 判据与 `dev-verify` flow；只有界面点位**完全无断言**时才新写组件测（P2 那条即是）。
- **不改判据语义**：188/189/190/191/192/193/194 既有门与 BLOCK-119 judge-core 零触碰（只作为锚点被引用）。
- **不伪造抽样**：jsdom ≠ 真 Chromium；实机腿跑不成就是环境档，明写不掩盖。
- **不改映射规则**：P0 公布的公式与点位集合即定稿，跑完不回溯调参。
- **G1+ 不外推**：不碰 packaged/Provider/公证。

## 4. 执行

P1 清单+复跑器（rubric 已在本文件先公布）→ P2 补 ContextBudget 等缺失锚 → P3 全量复跑与实机抽样定分 → P4 总纲/评估报告回写 + closeout 五件套。

## 5. 并行隔离与证据位置

触碰面=新 `evals/anchors/competitiveness-8d.json` / 新 `scripts/block195-anchors.mjs` / 新 `test/block195-anchors.test.mjs` / 新 `frontend/src/components/copilot/ContextBudgetBar.test.tsx` / 新证据目录 `acceptance/block-195/` / `docs/agent-competitiveness-program.md` §1（测量值回写，带指针）/ `docs/Petri-Desktop-Evaluation-Report-2026-10-15.md`（§5.1 注记，reference 文档的进度注记制）/ `docs/pending-work-backlog.md` / impact-map / 五件套台账。**只读引用**：全部现存测试、evals 套件与 baselines、dev-verify flows、judge-core。零 dev 栈依赖为默认（实机腿按环境档尽力跑），零人眼。
