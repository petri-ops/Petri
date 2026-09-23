# BLOCK-119-OUTPUT-JUDGE-HARNESS 计划：输出评判 Harness 工程

**Plan ID**：`BLOCK-119-OUTPUT-JUDGE-HARNESS`
**状态**：`active（P0-LAUNCH）`
**立项日期**：2026-09-24
**责任轨道**：BLOCK（LLM 输出语义合格性评判 / 三态推进门 / 稳定性探针 / harness 工程）
**上游文档**：`docs/block-118-dev-decision-tooling-plan.md`（dev 工具化与可观测性地基）· `docs/planning/typesafe-jev-system-one-research.md`（技术底稿）· `docs/planning/decision-primitive-internalization-arc.md`（W4 工程制度内化方向）

## 0. 立项来源与用户裁决留痕

- 用户命题（2026-09-24）：「无论是限定提示词还是多轮会话给出的结果、推进下一步的节奏，都应该从准确性/稳定性/功能实现契合度上给出判断，目的是做好 harness 的工程」。
- 主 Agent 提案（本 plan）→ 用户裁决原话：「**行 你懂我 继续推进吧**」——方案整体获批，三个预留裁决点全按推荐：P2 试点=子智能体汇报门；评判供给=Jev 云；RETRY=带判词重试 1 次。
- 并行声明：沿用 BLOCK-118 用户并行裁决先例与同款隔离边界（UI-437 v5.1x 会话独占 frontend/copilot 与 ui-audit 台账面，本包零触碰；提交按路径分批）。

## 1. 诚实边界（方案成立的前提）

- **执行真相永不下放**：功能准确性（代码对不对）的唯一裁决=测试/tsc/门禁/flow（Layer 0）；结构合法性=确定性校验器（A 型永不模型化）。本 harness 补的是**语义合格性**：契合度（对题）、忠实性（不编造，需 reference 锚定）、完备性（目标达成）。
- **稳定性是测出来的不是判出来的**：k 次重放 + 一致率统计（BLOCK-110/111 A/B 方法论固化），非单次判断。
- 无 reference 锚定的「泛泛好坏」判词**只观测不门控**（fluency bias）。
- 评判门 fail-open：Jev 失败/低置信=放行+记账，绝不比现状更差；RETRY 上限 1 次，ESCALATE 上限 1 次。
- **隐私红线**：校准语料与证据只存指针（conv/record 索引）+ 哈希 + 分数；transcript 原文不离开 gitignored `.biof3-dev-user-data/`（区别于 BLOCK-110 公开语料先例——本点语料源是真实会话记录）。

## 2. 架构：三态推进门

```
LLM 输出（限定提示词 or 多轮会话结果）
 → [L0 结构校验]（确定性，零模型；不过=确定性拒绝/重试）
 → [L1 评判门 judgeOutput()]：一次 Jev 调用并行多题
     fit: score 1-5（契合度：输出 vs 请求）
     faithful: noul（忠实性：仅当提供 reference 才出题与门控）
     goal_N: noul × 目标数（完备性：每目标一道）
 → 三态路由：PASS（推进）/ RETRY（带未过维度判词重试 1 次）/ ESCALATE（升级推理或转人工）
```

## 3. 范围

| 阶段 | 内容 | 落点 |
| --- | --- | --- |
| P0 | 内核 + 校准 | `scripts/lib/harness/judge-core.mjs`（judgeOutput/buildJudgeRequest/parseVerdict 三态）+ `scripts/lib/harness/stability-core.mjs`（probeStability：k 次重放一致率/方差，界=2/3 多数）+ `scripts/block119-build-judge-corpus.mjs`（llm-transcripts 结果信号挖掘：下一条用户消息含纠错/不满词=弱负例、会话终止或新话题=弱正例、跨会话 mismatch=硬负例；语料只存指针）+ `scripts/block119-judge-calibrate.mjs`（fit 维度 θ 扫描，判据沿 block115：precision≥0.80/coverage≥0.50）+ 注册表 `output-judge` 接点（仅校准过的维度落门控值，未校准维度缺键=observe-only）+ 契约 `test/block119-output-judge.test.mjs` |
| P1 | 开发侧接线 | `npm run output:judge`（block119 CLI：--transcript/--output+--request/--reference/--goals，输出三态判词+逐维度分；probeStability --probe k）+ gewu-dev-infra 指引（多轮会话关键结论/收口声明前跑评判门；限定提示词脚本接稳定性探针）+ impact-map 登记 + dogfood 证据 |
| P2 | 产品侧单点试点 | 子智能体汇报门（UI-433 汇报收敛面）：汇报文本在回传父级前过 judgeOutput（goals=子任务需求要点），fail-open + RETRY×1（带判词）+ ESCALATE（原样透传，仅标注）；默认关+显式开（BIOF3_JEV_REPORT_GUARD=1，D-4 先例）；decision_log 记账观测。试点证据（采纳率/误拦率/延迟增量）合格才谈横向复制，不合格停在 P1 |

## 4. 非范围（exclusions）

- 不替代任何 Layer 0 门禁（测试/impact-map/收口链/tsc/lint）。
- 不做无 reference 的泛泛质量门控；不做生成类任务的模型化。
- 不横向铺开产品运行时评判点（每点另立）。
- 0 npm 新依赖；不改 decision-api.js 客户端契约。

## 5. 验收门禁清单

1. 契约：`test/block119-output-judge.test.mjs`（三态路由/降级 fail-open/observe-only 维度/门控=注册表/语料指针零原文/稳定性探针一致率）全绿；block116 契约随注册表扩展全绿。
2. 校准：fit 维度在 ≥100 条真实语料上 θ 曲线落档（`acceptance/block-119/`，只存指针+分数）；不可采纳也如实落负裁决。
3. dogfood：对真实输出跑一轮 output:judge + 一份 probeStability 报告，证据落 `acceptance/block-119/`。
4. P2：默认关状态下产品行为零变化（契约承载）；显式开启后 flow 或实机证据一轮。
5. 门禁：定向测试 + test:changed 0 红 + docs:check + secret/arch/types 绿。

## 6. 完成语义与风险

- `completed`：P0~P2 落地且门禁逐项对账；fit 校准不可采纳=合法完成态（judge-core 降级 observe-only，如实登记）。
- 风险：fit 弱标签噪声（纠错词表误伤）→ 语料 dry 先验 + 精度门兜底；评判质量不足 → 负裁决落档不硬凑；agent-runner 触碰面谨慎（汇报门挂在收敛点，默认关）。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
