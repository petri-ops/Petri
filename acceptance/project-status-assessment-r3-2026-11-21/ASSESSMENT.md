# Petri Desktop 项目系统评估 R3（2026-11-21）

> 口径：全部现读真源。基准：R2=`c3242e8c`（9/20）→ R3 批次终点=本报告落档时的 HEAD（S8 收口 commit，
> 待 closeout:full 终轮绿灯后定格；R2→R3 之间 = R2 清偿批 S1–S8 共 8+ commit，区间 `d3780338..HEAD`）。
> 性质：R2 清偿批的批内自评（无人值守预授权），R4 复评仍按周期由评估 Agent 出具。
> 门禁原始输出：`gates/`（本轮现采；*.log 落盘不入库为仓库 *.gitignore 惯例，退出码经 exit-codes.tsv 可追溯）。
> **closeout:full 终轮=CLOSEOUT: PASS（21 阻塞门全绿+2 report 门 OK，零 SKIP）**；此前 10 轮逐门揭出并清偿的
> 被掩盖存量红与契约演进全记录于 `../r2-remediation/s8/RULINGS-closeout-contracts.md`（test:changed exit-2
> 与 lint 增量缓存长期遮蔽 post-h9/EAR/lint:ledger 四族存量红，S8 一并清偿——链路恢复真实）。

---

## 1. 执行摘要

**一句话结论**：R2 问题清单 **P0×4 + P1×9 + P2×3 全部清偿**（P3 候选池按裁决只登记不启动），
收口链从「每个包都 fail-fast」恢复到 **closeout:full 全链可绿**；期间 S2 修工具揭出三处被 exit-2
掩盖的存量红（post-h9 契约族），一并按契约演进清偿；S3 自伤回归（c53 manifest 整写丢 9 条外部登记）
被 closeout:full 第二轮抓住并根修——**门禁链在真实工作，这是本批最有价值的副产物**。

**四维评分（判据见 §3–§6）**

| 维度 | R2 | R3 | 一句话判据 |
|---|---|---|---|
| D1 进度 | 3 | **4** | R2 扣分点全部关闭：默认身份面默认可见（S5）+ 三槽位归位 + V0 基线契约 17/17；G0 常态下主线路径无未达出口 |
| D2 交付质量 | 2 | **4** | 八门基线 3P/5F → closeout:full 全链绿 + post-h9 契约 186/186 + 定向套件全绿；未跑范围如实登记（全量 workspace 套件留给 CI） |
| D3 风险与阻碍 | 2 | **4** | P0/P1/P2 全闭环；遗留=观感签字 3 项（用户动作）+ B-11 WIP 断点与笔锋版清退（owner）——均为已登记移交，无未闭环 P0/P1 |
| D4 资源与协作 | 2 | **4** | 脏文件 33 项分类处置完成、AUDIT-LOG compact 同批提交、9223 清零+TTL 机械防复发、任务账 7→1、8 commit 待 push |
| **总分** | **9/20（45%）** | **16/20（80%）** | 首次量化趋势：**+7**（R1 未打分 → R2 基线 → R3 首次可比） |

---

## 2. R2 问题清单闭环表（逐项 → 执行波次 → commit → 出口证据）

| R2 编号 | 现象 | 处置 | commit | 出口证据 |
|---|---|---|---|---|
| P0-1 | 水印两方案并存、终版未裁、4 PNG 被删、9223 遗留 9h | 终版=留 AI 版（预置裁决 R2）：极简变体 10 文件原样留证→三文件回退 HEAD→PNG 复原→9223 kill→flow 对齐终版复刻 canonical 12 断言 fresh 12/12 | `d3780338` | `r2-remediation/s1/`；ui:audit 1→0 |
| P0-2 | 断点 17 档未收敛 | census 现读 20 档非 WIP 值→自然聚 4 簇→锚点 520/768/960/1200（众数+JS 单源优先）→15 文件 24 处替换→登记表 21→12→同套 635/635 | `c13d453f` | `s6/RULINGS-breakpoints.md`；UI-719 |
| P0-3 | 状态色三套并存 | success 绿收敛 status 家族形态（bare/-fg/-bg 与 error/warning 同构）；删 `--petri-success` 零别名；14 处按角色替换；单源契约锚 | `56e8d5e6` | `s6/RULINGS-status-color.md`；styles 62/62 |
| P0-4 | 目标分 4.4 未裁 | 采纳为方向性门槛；现读静态复评 4.0（缺口 0.4 明示）；不伪造不放宽 | `60a1e426` | `s6/RULINGS-target-score.md` |
| P1-1 | code-size 30 条 + A2 归属误判 | `--write` 显式重打 16 文件（逐文件归属留痕：custom.css/Icon.tsx=视觉链引入，他包 14 文件移交 owner）；A2 GATE-LEDGER 更正 | `60329c8d` | gate:code-size 1→0 |
| P1-2 | design-context 契约 2 fail | 写死 BLOCK-465 断言→中性结构判据（契约漂移第④类）+ 双生成器重生成 | `60329c8d` | 17 tests 15/2→17/17 |
| P1-3 | A0 身份面默认不可见 | 默认 accent→celadon-ink（ruling.json 现读）+ welcome 问候区消费 0→3 + 迁移保留 + 实机 10/10 | `6bcd86f4` | UI-718；`s5/live/` 截图 |
| P1-4 | 三槽位 active 漂移 | BLOCK-503/505/506 → completed/CLOSED（材料在盘核对 + 先例四件套同步） | `c048c93f` | registry active work-package=0 |
| P1-5 | U 材料 status 漂移 | flip ruled + rulingPointer；消费测试契约追上 6/6 | `c048c93f` | `s4/` |
| P1-6 | test:changed exit 2 | 三层登记债清偿（裸文件名→全路径 / e03 漏登记 / 27 证据面三规则） | `1d8bc5a7` | exit 2→0 |
| P1-7 | user-assets 误判 | 保护清单陈旧（58053d77 已有意入库）移除 10→9 + guard 提示 + 回归测试 | `1d8bc5a7` | gate 1→0；guard 4/4 |
| P1-8 | silent-catch 2 处 | 误报豁免留因（外层已计 _writeFailures） | `1d8bc5a7` | gate 1→0 |
| P1-9 | 7 条失败任务 | 逐条归属 + prune | `1d8bc5a7` | open/failed 7→1（a4r3 SIGTERM 留档老化） |
| P2-1 | AUDIT-LOG 超阈未 compact | archive WIP 核对=机械搬移产物→同批提交 + 本批回写 | `c048c93f` | docs:check PASS 663 |
| P2-2 | 9223 生命周期无守护 | TTL 看门狗（4h+代币防误杀+端口现查+双端）+ HK-01 契约 + 行为实测 | `3f4e6344` | `s7/`；test-instance-ttl 3/3 |
| P2-3 | 33 项脏文件未归类 | 逐项归类：本批面提交 / 他包证据保留登记（block462/463/472 刷新） / 用户资产零触碰 / tmp owner 清 | `c048c93f` | `s4/RULINGS.md` §R-S4-4 |
| P3-1 | 候选池 | 只登记不启动（裁决不变） | — | 维持候选池 |

**S8 期间揭出并清偿的额外债**（被 test:changed exit-2 长期掩盖）：

| 发现 | 处置 | 证据 |
|---|---|---|
| 保护清单计数锚 10（S2 已合法 9） | 演进为关键成员在册 + 上界 | `s8/RULINGS-closeout-contracts.md` §1 |
| K-07 reader 找已摘除 registry 条目（11-19 D5 起） | 演进为 `deregistered` 摘除态语义 | §2 |
| K-15 canonical triage 38/15/23 → 36/13/23（11-20 签字批演进未同步） | 测试/DEBT_CEILING/adjudicator 三处同步 + 改锚常量 | §3 |
| K-22 knip 上限 350 vs 实际 352（两批扩容漏同步）+ 50 新键 | 350→402 + 50 键定性入册（8 flows 动态入口 / 39 探针 / 2 留证 / 1 笔锋版回退形态） | §4 |
| **c53 manifest 整写丢 9 条外部登记（S3 自伤回归）** | 生成器改合并语义（根修）+ 历史清单重建 + 双生成器重生成，c53 三套 28/28 | §5 |

---

## 3. 门禁矩阵（S0 基线 → R3 现读）

| 门 | S0 基线（2026-11-21 07:19） | R3 现读 | 变化 |
|---|---|---|---|
| docs:check | 0 PASS(663) | 0 PASS(663) | 维持 |
| ui:audit:check | 1 FAIL | 0 PASS | ✅（S1+UI-718/719 回写） |
| hygiene:check | 0 PASS | 0 PASS | 维持 |
| test:changed:list | 2 FAIL（工具错） | 0 PASS | ✅（S2） |
| quality:types | 0 PASS | 0 PASS | 维持 |
| gate:code-size | 1 FAIL（30 条） | 0 PASS | ✅（S3 --write） |
| gate:user-assets | 1 FAIL | 0 PASS | ✅（S2） |
| gate:silent-catch | 1 FAIL | 0 PASS | ✅（S2） |
| gate:post-h9-contracts | （未在基线；现读 182/4 红） | **186/186** | ✅（S8 契约演进） |
| gate:ui-breakpoints | （未在基线） | 0 PASS（非 WIP 9 档在册） | ✅（S6b） |
| quality:knip:check | （未在基线） | 0 PASS（402 键定性在册） | ✅（S8 --update） |
| c53 契约三套 | 15/17 | **28/28** | ✅（S3 演进+S8 根修） |
| closeout:full | （未跑过全链绿；R2 时点必然 fail-fast） | **PASS 全绿 21 门+2 report 零跳过**（第 11 轮，gates/s8-closeout-full-11.log） | ✅ |

---

## 4. D1 进度（4/5）

- R2 三扣分点：①身份面默认不可见 → **已关闭**（S5：默认 celadon-ink + data-accent/surface 在场 + welcome 墨字/落印消费 + 实机截图；A0/A1/V5/B 四包成果从「素材入库」变「用户默认看得见」）②三槽位漂移 → **已归位** ③V0 基线契约红 → **17/17**。
- 视觉升级全链 19 commit + R2 清偿 8 commit，COMPLETION-PLAN 诊断的「素材加了界面没变」根因消除。
- 未达 5 的原因（诚实）：造型/水印/默认身份面**审美签字 in_progress**（无偏好覆盖不代签）；B-11 WIP 面断点待 owner 收口——两者均为已登记的用户/owner 动作，非本批出口缺口。

## 5. D2 交付质量（4/5）

- closeout:full 从「不可用」（test:changed exit 2 + code-size/user-assets/silent-catch/design-context 四红必然 fail-fast）恢复到**全链可绿**；post-h9 契约 186/186；HK-01 红绿先行覆盖全部四个新契约（defaultIdentity 6 / status-color 3 / test-instance-ttl 3 / 断点同套 635）。
- 未达 5 的原因（诚实）：①全量 `npm run check` / `test:all:workspace` 按定向纪律未跑（留给 CI/发布前），**不得表述为全量通过**；②knip 保留面 352→402（50 键定性入册）是登记而非消减——其中 `GlobalWatermark.tsx` 为真死代码（终版裁决产物），保留=回退形态，清退移交 owner。

## 6. D3 风险与阻碍（4/5）

- P0×4/P1×9/P2×3 全闭环（§2 表）。遗留移交清单（全部已登记，无悬空）：
  ① 观感签字 3 项：造型/水印审美、默认身份面审美（UI-718/719 in_progress，无偏好覆盖不代签）；
  ② BLOCK-395 B-11 WIP 面断点 5 档（owner 收口后并入 4 档）；
  ③ `GlobalWatermark.tsx`+`watermark.css` 笔锋版清退（水印 owner）；
  ④ block463-workbench-live.cjs 加载即自执行缺陷（dev-infra owner，verify 任意运行被连带执行）；
  ⑤ P3 候选池（用户逐包发令）。
- 未达 5 的原因：以上 5 项未清零；且本轮 break性改动（默认档/断点/状态色）的行为影响面靠定向基线+实机断言背书，未做全量人工回归（G0 定向纪律内）。

## 7. D4 资源与协作（4/5）

- 脏文件 33→分类闭环（本批面 5 commit 入库；他包 block462/463/472 证据刷新保留登记；用户资产/tmp 零触碰）；AUDIT-LOG compact 两轮执行（活跃台 113KB 为「当前待处理项全量保留」设计性超阈，非失控增长）；9223 遗留清零并机械防复发；任务账 7→1。
- 未达 5 的原因：①待 push commit 8+ 个（push 留发令，用户一句口令）；②AUDIT-LOG 活跃台超阈警告仍在（可考虑「当前待处理项」分诊归档的治理演进，未擅动）；③并发会话（他包）仍在写入 acceptance 证据面（block463 churn 持续），零触碰策略正确但 churn 未绝。

---

## 8. 复盘跟进

- **趋势机制生效**：R2=9/20 首基线 → R3=16/20（+7），四维全升；R4 复评若 D2/D4 停滞即触发专项复盘（R2 §9.d 规则）。
- **本批新沉淀的治理改进**：①TTL 看门狗=「跑完 kill」从纪律变机械门；②c53 生成器合并语义=「生成器不得整写共享登记面」；③契约测自匹配教训=「git grep 型契约测必须排除自身」；④K-15/K-22 判据改锚常量=「钉值演进只动一处」。
- **复评触发**：用户 push 后 / 任一观感签字 / B-11 owner 收口。

## 9. 边界与诚实声明

- G0 开发期常态 · 不外推 packaged/Provider/GA；所有 verified 均限 dev Electron / 9223 离屏边界。
- 观感零代签：造型/水印/默认身份面审美 in_progress；E 类人眼槽零代填。
- 未验证范围：全量 workspace 套件与 `npm run check`（定向纪律）；packaged 态（G1+）。
- 本报告为批内自评（无人值守预授权）；R4 复评建议由独立评估会话出具以避免自评偏置。
- 他包 WIP 与用户资产零触碰；全部 break性改动有行为基线同套对账 + 独立可 revert commit。
