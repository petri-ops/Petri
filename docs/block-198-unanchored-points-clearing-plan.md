---
capability: agent-competitiveness
goal: BLOCK-198 = 竞争力 8 维**无锚点位清偿批**（把"分数缺口"分成"没做"与"没测"两类，可离线证的后者补锚转绿，前者如实保持无锚并点名）。现状事实：BLOCK-195 收口后清单仍有 10 个 unanchored 点位压低定分，其中 1 个是环境档（`7-result-loop-live` 需 R 运行面），其余 9 个是**零机械锚**。BLOCK-196 已证明这批点位里藏着"有实现无断言"（D16 卡片自取数自 BLOCK-174 就落地，补锚当场撞出一个 win32 跨会话安全缺陷）。本包对余下 9 个逐点实码普查并按三分类处置，**只补测量与更正判词，不为凑分动产品**。
acceptance:
  - P0 普查逐点给分类判定与 `path:line` 证据（已完成，见 §0），子代理结论**必须主代理逐条抽验后才写入清单**（BLOCK-195 曾两次纠正子代理错路径）。
  - P1 挂现存锚转绿：`4-cost-breaker`/`4-worktree-safety`/`8-delegation-realtime` 三点位的能力已有真实断言，直接把对应测试挂为锚——**同时必须按实码更正 claim 文本**（成本上限是"提示级诚实收尾"不是硬中止；委托回传是"事件流叠加 + 轮询兜底"不是替代轮询），错位记分比不给分更有害。
  - P2 补断言转绿：`1-prompt-layering`（静态前缀跨 context 逐字节恒定 + 缓存命中/失效计量真实发生）、`3-recursive-tree`（有界多级派生：depth 内可生孙、越界 `spawn_depth_exceeded` 拒）、`7-split-compare`（分屏比例 clamp/键程/持久化）——新增断言必须是该行为本身的断言，不得用相邻断言顶替。
  - P3 如实保持无锚：`2-ann-layering`（无 ANN 索引、无召回质量基线）、`8-relay-topology`（只有平铺点对点，全仓无多跳中继实现）、`5-slash-execute`（skill/template 条目只注入文本模板，"结构化即执行"要锚先得把 `executeSlashCommand` 抽成可测单元=产品改动，越本包红线）——三点位**保持 unanchored 计分母**，并把各自缺口点名转候选。
  - P4 复测与回写：带 dev 栈 + 9223 测试实例全层级复跑 `node scripts/block195-anchors.mjs`，`--update` 显式提升棘轮基线，`--check` 对账通过、零 anchored-red；总纲 §1 与评估报告 §5.3 ④ 行按新测量值回写；closeout 十三门 + 五件套。
  - 完成语义：每个点位状态要么由**真断言**支撑转绿，要么由**实码缺失证据**支撑保持无锚并点名；清单里不存在"看起来有锚但测的不是那件事"。
reopen: 三处真缺口各自独立立项（ANN 召回质量基线 recall@3 / >2 节点中继拓扑 / 斜杠即执行抽单元与 chip v2）；`7-result-loop-live` 待 R 运行面具备后复跑；判词若再被实测推翻按本包先例就地更正。
status: completed
---

# BLOCK-198 — 竞争力无锚点位清偿批（有实现无断言普查）

- 状态：`completed`（2026-10-17 当日立项当日收口·零人参与；6 点位转有点位、4 处 claim 按实码更正、3 处真缺口保持无锚转候选；均值 4.1→4.6·零 anchored-red·closeout 十三门）
- Plan ID：`BLOCK-198-UNANCHORED-POINTS-CLEARING` · 前序：BLOCK-195（清单与复跑器）/ BLOCK-196（D16 先例）

## 收口交付记录（2026-10-17 实跑证据）

**一条命令复跑定分（带 dev 栈 + 9223 测试实例，132s，证据 `acceptance/block-195/anchors-latest.json`）**：

| 维 | 本包前（196 加映后） | 本包后 | 变化 |
| --- | --- | --- | --- |
| 1 推理循环韧性 | 4.3 | **5.0** | +0.7（`1.1-prompt-layering` 补锚转绿） |
| 2 上下文与记忆 | 4.2 | 4.2 | 0（`2.2-ann-layering` 真缺失，保持无锚） |
| 3 编排与多智能体 | 4.3 | **5.0** | +0.7（`3.3-recursive-tree` 补锚转绿） |
| 4 治理与信任 | 3.6 | **5.0** | +1.4（`4.4-cost-breaker` + `4.4-worktree-safety` 挂现存锚转绿） |
| 5 呈现与交互 | 4.4 | 4.4 | 0（`5.5-slash-execute` 真缺口，保持无锚） |
| 6 表达面 Gen UI | 5.0 | 5.0 | 0（196 已封项） |
| 7 数据资产面 | 3.3 | **4.2** | +0.9（`7.7-split-compare` 补锚转绿；`7.7-result-loop-live` 仍属环境档） |
| 8 协作与多端 | 3.3 | **4.2** | +0.9（`8.8-delegation-realtime` 挂现存锚转绿；`8.8-relay-topology` 真缺失） |
| **均值** | 4.1 | **4.6** | 机械锚 56 → **62** · 零锚点位 10 → **4**（3 真缺口 + 1 环境档）· **anchored-red 0** |

棘轮基线 `evals/anchors/baseline.json` 已 `--update` 显式提升，随后 `--check` 全层级对账通过（无后退·改善 0，改善已被 --update 消费入基线）。

**三处新增断言的真实内容**（不是把相邻测试改名挂上）：
- `test/block198-prompt-layering.test.mjs` 4/4 — 断静态前缀跨三种 context **逐字节恒定**、动态段只追加其后、运行身份段留在恒定前缀内、`staticBuilds` 只在显式失效后 +1 而换 context 只增 `staticCacheHits`、分段报告的 `base` 段长度==前缀长度（预算计量与分层不得是两套真相）。
- `test/block198-spawn-depth.test.mjs` 5/5 — 断派生判定链四条真分支：缺省 `maxDepth=1` → `parent_not_primary`；放开 3 → 1 代子**不再被深度/身份拒**（停在 `parent_not_running`，因此**绝不进入派发、零模型调用**）；`maxDepth=2` 越界 `spawn_depth_exceeded`；2 代链在 3 下同样越界（代数按父链实算）；缺省值仍是 1。
- `frontend/src/components/workspace-panels/ArtifactPinPane.ratio.test.tsx` 5/5 — 断键盘 ±5 步长、栅格列宽随比例同步、**钳在 20–80**（连按 20/40 次不越界）、持久化写入与下次挂载恢复、坏值（999/非数）回落缺省且不把 `NaN` 塞进 `grid-template-columns`。未改 BLOCK-140 那份冻结契约文件，另册新增。

**四处 claim 按实码更正**（不更正就是错位记分）：成本上限触发的是诚实收尾 system 提示、循环里无 `break/return` ⇒ 不是硬中止；委托是 SSE 镜像**叠加在 5s 轮询之上**、轮询兜底未被替代；分屏比例可调已落地但①分隔件是 `role="separator"`+`aria-value*` 而非 slider（读屏不播报滑杆值）②`canCompare` 没接进钉住入口（`ResultArtifactShell.tsx:1019` 只按 `previewLoading` 禁用）；递归派生断到**判定链**，端到端实跑派发链未锚、写进 claim 不外推。

**自纠两处**：①测写红过一次——`spawn_agent` 是 async，我没 await 就断言 Promise 对象（`res.ok===undefined`），先用一次性调试脚本证实行为与预期一致（`g1`→`spawn_depth_exceeded`、`c1`→`parent_not_running`）再修测，不猜；②批量正则改源码把自己改出语法错（`() async () =>`），教训=源码改动逐处 Edit 而非正则批处理。另：本次复跑 flow 又覆写了 `acceptance/ui-341/`、`acceptance/block-99/` 两处他包证据，跑完即 `git checkout` 还原，本包证据只留 `acceptance/block-195/` 与 `acceptance/evals/`。

**P3 兑现**：三处真缺口**没有**为转绿造锚，保持 unanchored 计分母并各自转候选（C-29 斜杠即执行 / C-30 ANN 记忆分层与召回质量基线 / C-31 >2 节点中继拓扑）。

## 0. P0 普查结果（9 点位三分类，证据均经主代理实码抽验）

| 点位 | 判定 | 实码证据（主代理复核过） | 处置 |
| --- | --- | --- | --- |
| `1.1-prompt-layering` | 有实现，核心性质未断言 | `core/petri-server/helpers/system-prompt.js:409-438` `buildStaticTemplate` + `STATIC_CACHE:51` + `invalidateStaticCache:56`；`test/ck04-section-budgets.test.mjs` 只断分段计量对账 | **P2 补断言**：静态前缀跨 context 恒定、缓存命中/失效计量 |
| `2.2-ann-layering` | **真缺失** | `core/petri-server/helpers/memory-vectors.js:111-127` 暴力全表 JS cosine（无 ANN 索引）；`docs/block-94-knowledge-space-pro-plan.md:186` 已裁决不引入 sqlite-vec；全仓 grep `recall\|MRR\|nDCG` 零命中（`block95-b3-cache-baseline.cjs` 是 prompt cache，语义无关） | **P3 保持无锚** + 转候选 |
| `3.3-recursive-tree` | 有实现无断言 | `core/petri-server/agent-tools/spawn-agent-tools.js:50` `resolveSpawnMaxDepth`、`:236-253` 沿 `parentTaskId` 上溯计代数、越界 `spawn_depth_exceeded`；`test/block173-w3-contracts.test.mjs:48-59` 只断 env 解析与钳制 | **P2 补断言**：depth 内生孙 + 越界拒（store 桩） |
| `4.4-cost-breaker` | 有实现有断言，**判词错** | `core/petri-server/helpers/cost-cap.js`（sanitize/resolve/isCostCapExceeded）+ `core/petri-server/loop-orchestrator.js:685-698`（超限发 `cost_cap_exceeded` 并注入"请停止调用工具"的 system 提示，**无 break/return**）；`test/block176-w6-contract.test.mjs:23-57` 真断纯函数与接线 | **P1 挂现存锚**，claim 改"成本上限触发诚实收尾（提示级，非强制中止）"，真硬中止缺口转候选 |
| `4.4-worktree-safety` | 有实现有断言，清单没挂上 | `core/shared-backend/workspace-checkpoint.js:50-106` `createCheckpoint`（临时索引 read-tree/write-tree/commit-tree，零副作用、捕获未跟踪）+ `rollbackToCheckpoint`；`test/block176-checkpoint.test.mjs` 真 git 临时仓库 4 项 | **P1 直接挂** |
| `5.5-slash-execute` | 混合：动作族即执行有实现无断言，chip v2 真缺失 | `frontend/src/components/copilot/SimpleChat.tsx:1306-1380`（UI 动作族真执行；skill/template 只写模板进 composer）；`slashSources.ts:8-9` 原文「结构化 chip 注入通道留 v2」；`executeSlashCommand` 无测试且不可独立渲染测 | **P3 保持无锚**（锚它要先抽单元=产品改动，越红线） + 转候选 |
| `7.7-split-compare` | 有实现无断言；`canCompare` 门控未接线 | `frontend/src/components/workspace-panels/ArtifactPinPane.tsx:45-90` `clampRatio` 20–80 + localStorage `petri.pinSplitRatio` + pointer 拖拽 + 键盘 ±5 + `role=slider`；`viewerRegistry.ts:63` table `canCompare=true` 但钉住按钮只 `disabled={previewLoading}`（`ResultArtifactShell.tsx:1019`）；`ArtifactPinPane.test.tsx` 只断钉住/mode | **P2 补断言**（slider/键程/clamp/持久化），claim 记"门控未接线"残余 |
| `8.8-delegation-realtime` | 有实现有断言，**判词错** | `core/petri-server/agent-tools/federation-tools.js:95-130` `mirrorPeerTaskEvents`（订对端 SSE 镜像写本地 `task_events`），`:191` 在轮询**前叠加**、`:14 DELEGATE_POLL_INTERVAL_MS=5_000` 轮询保留；`test/block176-w6-contract.test.mjs:60-125` mock SSE 断 iter/done 镜像、delta 跳过、坏帧容忍、seq 续号 | **P1 挂现存锚**，claim 改"事件流叠加 + 轮询兜底"（不是替代） |
| `8.8-relay-topology` | **真缺失** | `core/shared-backend/federation-peers.js:31-41,128-158` 按 baseUrl 平铺 upsert 的**点对点直连**清单；全 `core/` grep `relay\|多跳\|nextHop\|viaPeer\|forwardDelegate\|hop` 无实义命中；现存联邦测试全是 1 指挥席 + 1 对端拓扑 | **P3 保持无锚** + 转候选 |

候选锚测复跑（离线）：`block176-w6-contract` + `block176-checkpoint` + `block173-w3-contracts` = **15/15 绿**。

**诚实性条款（本包的自我约束）**：把"相邻断言"当"该行为的锚"=错位记分，比不给分更有害。因此 `5-slash-execute` 不挂 `slashSources.test.ts`（那测的是模板注入不是即执行），`4-cost-breaker` 与 `8-delegation-realtime` 挂锚时**必须同步更正 claim**，否则分数涨在没交付的地方。

## 1. 为什么这是队列头（不是我又挑一个舒服的包）

BLOCK-196 已经证明这批"无锚"里藏着**有实现无断言**，而且补锚是一次低成本高命中动作（那次顺手撞出一个真安全洞）。本包把这条例外规则变成常规工序：零 API、离线可复跑、每点位结论必须落到 `path:line` 或"未找到"。排在阶段 3 结构地基之前是因为它**不给产品加东西、只把已有能力变得可证**，做完 8 维定分口径的残余缺口全部点名清楚（哪些是没做、哪些是环境档），阶段 3 的立项判断才不被过时分数误导。

## 2. 立项自检（对标不改魂）

差别形态：行业里"竞争力自评"的分是 PPT 打的；这里每一分都要指回一条**别人能一键复算**的机械锚，而本包的价值在于把"没测"与"没做"分开——**宁可少给分，不给错分**（证据自证 + 治理透明）。三处真缺口保持无锚并转候选，就是这条纪律的落地。

## 3. patch 还是 refactor（判定=逐点 patch，拒绝一处越界重构）

P1=清单挂接 + claim 更正（不动代码）；P2=往现存测试文件补断言（`ck04-section-budgets`、`block173-w3-contracts`、`ArtifactPinPane.test.tsx`），是被测模块既有导出的直接断言，不改产品实现；`5-slash-execute` 若要真锚需把 `executeSlashCommand` 从 1664 行的 `SimpleChat.tsx` 抽出=产品侧重构，**本包拒绝**（同 BLOCK-195 红线：不为凑分动产品），转独立候选。

## 4. 范围与非范围

**范围**：`evals/anchors/competitiveness-8d.json`（3 处 claim 更正 + 6 个点位挂锚）；三个测试文件补断言；`test/impact-map.json`；总纲 §1/§2 与评估报告 §5.3 注记；棘轮基线显式提升；三处真缺口转 `pending-work-backlog.md` 候选。
**非范围（红线）**：不改任何产品实现与判据语义；不把相邻断言顶替该行为的锚；不为转绿放宽 `--check`/环境等价规则；`7-result-loop-live` 属环境档不冒充绿；不碰 G1+。

## 5. 执行与证据位置

P1 挂现存锚 + claim 更正 → P2 补三处断言 → P3 三点位保持无锚并登记候选 → P4 带 dev 栈 + 9223 测试实例全层级复跑（证据 `acceptance/block-195/anchors-latest.json`，本包共用该复跑器与证据目录，不新建第二套测量面）→ `--update` 提升基线 → `--check` 对账 → closeout 十三门 + 五件套回写。
