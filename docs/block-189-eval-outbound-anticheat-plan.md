---
capability: evaluation
goal: BLOCK-189 = 评测基线 v2 第二切片·出站请求归一化断言 + capture/replay 哨兵防作弊 + 禁 sleep 门（评估报告 §5.1 阶段2 出口判据四件套之「判据三件套（禁 sleep）+ mock capture/replay 防作弊」两条）。§4.1 ZCode 判词：replay 断言出站请求含哨兵串=防作弊核心；§4.2 Codex：判据三件套=事件流谓词+出站请求归一化断言+文件系统产物断言（禁 sleep）。P0 勘察=三件套缺**出站归一化断言**这一条腿（现有 17 判据 kind 覆盖事件谓词+文件产物，但无 kind 读 mock.captured 出站记录）；无 sleep-断言（已事件驱动）但无机械门守。用户「行！继续」发令 2026-10-16，承接「我不希望人参与」→ 验收全自动化无人眼。
acceptance:
  - P1 出站归一化断言（防作弊核心）：新判据 kind `outbound_contains`（归一化后的 mock.captured 出站全集含指定值→证出站真发生）；runGoldenTask 经 outboundProvider 参数把 mock.captured 注入 evaluateCriterion ctx（缺 outbound 上下文时该 kind 红，fail-closed）；复用 BLOCK-188 normalizeContextString 做出站归一化（同一条易变值清单，杜绝第二套归一化真相）
  - P2 哨兵防作弊：golden 任务注入 per-run 哨兵（=任务唯一标识如 `evals-${task.id}`，天然进 system 上下文）；契约测证明「伪造成功事件但无对应出站」→ `outbound_contains(哨兵)` 红、「真实出站」→ 绿；即 ZCode「replay 断言出站含哨兵串」防作弊姿势在 mock 层落地
  - P3 禁 sleep 机械门：新增测/门扫描 evals/suites/*.json 判据 + harness 判据实现，禁止 PASS 条件依赖 wall-clock 睡眠（当前 poll/timeout 皆为有界安全网非断言根据，如实标注）；把「禁 sleep」从口头纪律转可执行
  - 门禁：docs:check/ui:audit:check（纯基建免 UI-###）/契约单测（outbound_contains 命中/未命中/fail-closed 三态 + 哨兵防作弊红绿对 + 禁 sleep 门）/evals:run golden+smoke 复跑绿不回归/test:changed 全绿
  - 完成语义：三件套第三腿（出站归一化断言）在册；哨兵防作弊可证伪（无出站即红）；禁 sleep 成机械门；不回归现有 17 判据与 golden/smoke 套件
reopen: 评测 v2 后续切片各自独立立项——capture **两态的真实录制态**（record 真实 provider 响应入 fixture，需 provider 凭据，G0 real 面独立评估）；catalog 五列化；**formal-admission 门控棘轮（含「判据门控口径」架构裁决须用户拍板，本包不碰 PASS/FAIL 语义）**；LLM-as-judge real；竞争力 8 维复测随包
status: active
---

# BLOCK-189 — 出站归一化断言 + 哨兵防作弊 + 禁 sleep 门（评测 v2 第二切片）

- 状态：`active`（2026-10-16 用户「行！继续」发令，为评测 v2 第二切片；承接「我不希望人参与」→ 全自动化）
- 前序：BLOCK-187（黄金路径回归门）+ BLOCK-188（context_snapshot 棘轮）均 completed，同属 evals harness 演进线。

## 1. 立项自检（产品个性纪律问句）

「本地可审计/证据自证体现了吗？」——防作弊（anti-cheat）= 不信任被测循环「自报」的事件流，而用**归一化出站请求**独立核验「agent 真的发出了这个请求」。这是把「质量声明」变成「本机可重放的证据链」，正是 Petri 证据自证魂的评测面落地，非复刻厂商 A/B。

## 2. 范围（P0 勘察定位，2026-10-16）

| 面 | 实况（勘察） | 本包处置 |
| --- | --- | --- |
| 三件套·事件谓词 | 已有 tool_used/event_present/tool_succeeded/policy_denied/task_completed/tool_error… 充分 | 不动 |
| 三件套·文件产物 | 已有 file_contains/genui_fragment_resolves | 不动 |
| 三件套·**出站归一化断言** | **缺**：无任何 kind 读 `mock.captured`（现 captured 已存 model/messages/tools） | P1 新增 `outbound_contains` |
| 哨兵防作弊 | mock 已捕获真实出站；无哨兵断言机制 | P2 per-run 哨兵 + 红绿对测 |
| capture/replay 两态 | replay 态=脚本化 mock（已确定）；**真实录制态需 provider** | 本包落 replay-断言防作弊；真实录制 reopen |
| 禁 sleep | 无 sleep-断言（poll/timeout 皆有界安全网）；**无机械门** | P3 立门 |

## 3. 非范围（红线）

- **不碰判据门控口径 / PASS-FAIL 晋升语义**：formal-admission 架构裁决（报告 §5 2b「架构裁决 1」）须用户拍板，属独立切片；本包只**加**判据 kind 与门，不改现有任务判定。
- **不做真实 provider 录制**：capture 两态的 record 侧需 provider 凭据，G0 独立评估，本包只做 mock 层 replay 哨兵断言。
- **不引第二归一化真相**：出站归一化**复用** BLOCK-188 `normalizeContextString`（同一易变值清单），绝不复制一套。
- **不建第二 runner / 度量真相**：判据跑在现有 evals harness/runGoldenTask 上。
- **G1+ 不外推**：不碰 packaged/Provider/GA。

## 4. 执行方案

- **P1 出站断言 kind**：`runGoldenTask({api, tmpDir, task, outbound})` 增 `outbound`（evals-run 传 `mock.captured`）→ evaluateCriterion ctx.outbound；新 kind `outbound_contains{value, minTimes?}`：在 `outbound.map(normalizeContextString(JSON.stringify(r)))` 拼接文本中判 `value` 在场；无 ctx.outbound→红（fail-closed）。
- **P2 哨兵**：golden first-success 的 system 天然含 `evals-golden-first-success`（项目名）作哨兵；契约测构造「有 events 无 outbound」→ `outbound_contains('evals-golden-first-success')` 红、「outbound 在场」→ 绿，实证防作弊可证伪。
- **P3 禁 sleep 门**：`test/block189-eval-discipline.test.mjs`——扫 `evals/suites/**/*.json` 判据 kind 集合 ∉ {依赖时钟} + 扫 harness evaluateCriterion 无 criterion PASS 直接读 `Date.now()` 差值作条件；违规即红。
- **P4 收口**：closeout 全链 + 五件套回写 → completed。

## 5. 回退路径与并行隔离

- 回退：新 kind 纯增量，不改 17 现有 kind 语义；evals-run 传 outbound 为 additive 参数（缺省不注入→旧任务不受影响）。
- 并行隔离：触碰面=`scripts/lib/evals-harness.mjs`（runGoldenTask 加 outbound 形参 + outbound_contains kind）/`scripts/evals-run.mjs`（传 mock.captured）/新 `test/block189-*.test.mjs`/`evals/suites/golden/first-success.json`（哨兵注释或 criteria 增一条 outbound_contains）；当前唯一 active 包。
- 环境纪律：复用隔离后端 harness，无 dev 栈依赖、无人眼。
