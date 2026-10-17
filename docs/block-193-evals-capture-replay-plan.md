---
capability: evaluation
goal: BLOCK-193 = 评测基线 v2 第五切片·capture/replay **真实录制态**（真模型响应可离线零 API 成本重放，且重放不得伪装成模型质量）。P0 实码勘察对上游转述做两处更正，且更正直接改写设计骨架：①「real 模式模型响应**零留存**」**不成立**——BLOCK-37 起 `core/shared-backend/llm-providers/io-transcript.js` 就是**生产级模型 I/O 记录器**，`core/shared-backend/llm-providers/model-gateway.js:267` 的 `chat()` 在流式与非流式**两条分支之后统一** `_emitTranscript`（`vision()` 另有 365 一处），落盘 `<PETRI_LOCAL_DATA_DIR>/llm-transcripts/<conversationId>.jsonl`，逐条含 `request.messages` 全量 + `response{content,reasoningContent,toolCalls,finishReason,usage}` + provider/model/role/durationMs（本机实文件已核：`~/Documents/Petri-Local/llm-transcripts/*.jsonl`，provider=deepseek 在场）。而 `spawnIsolatedBackend` 正把 `PETRI_LOCAL_DATA_DIR` 指到 tmpDir、收口又 `fs.rmSync(tmpDir)`——**真实缺口是「留存随临时目录被销毁、未入仓可重放」，不是「没有留存」**。②因此本包**不新建录制代理、不写第二套 SSE 解析器**：那等于给生产记录器做影子副本（治理红线「不得为省事引入第二执行器/第二真相」），录制态=**收割现成台账 + 投影为可重放回合**。另核：ZCode 转述的「replay 需放宽 188 快照条件 `if (backend.ok && mock)`」在本设计下**不成立**（replay 复用 `startMockProvider`，`mock` 天然在场）；而「报告/基线落点不分 provider 会互相覆盖」**为真**且是假绿通道，必须同批修。
acceptance:
  - P1 收割与投影（新 `scripts/lib/evals-recording.mjs`，纯函数 + 薄文件 IO）：`snapshotTranscriptCounts(tmpDir)` 与 `readNewTranscriptRecords(tmpDir, before)` 按「文件名→行数」差分定位**本任务新增**的 transcript 记录（任务串行跑，故差分即归属；**不依赖时钟、不依赖 conversationId 命名**，避开 BLOCK-189 禁 sleep 纪律的时钟敏感面）；`projectTranscriptToTurn(record)` 把 `response.toolCalls` 投影为 mock 回合 `{toolCalls:[{name,arguments}]}`、否则 `{content,finish}`；`response` 缺失/`error` 非空 → 该条**不投影并计数**（诚实边界，不编造回合）；`projectTranscriptToOutbound(record)` 投影 `{model,messages,tools}` 形状供 189 归一化出站断言消费。
  - P2 入库双闸（用户定案约束①②）：写 `evals/recordings/real/<taskId>.json` 前——①**密钥扫描**：复用 `scripts/secret-scan.mjs` 导出的**同一 PATTERNS 单源**（不复制模式集），命中即拒绝写入且只报模式名与文件、绝不回显内容；②**合成任务闸**：`task.id` 必须存在于 `evals/suites/<suite>/*.json` 且该任务转录的出站消息里**逐字含仓库自写 prompt**，否则拒录——这条是「只录合成任务、不含用户数据」的机械兑现，不是口头承诺。产物只存语义回合与计数，**不搬** `frames`/`usage`/`params`（tools 全量 schema），体积因而与 transcript 单条 8MB 上限脱钩。
  - P3 replay 与哨兵（约束③）：`--provider=replay` 把录制回合喂给**既有** `startMockProvider` 投递（零新 provider 实现），报告 `measures=recorded-replay`；**replay 态任务若判据里没有任何 `outbound_contains` → 直接判红**（罐头假绿闸）；同时给 real 三用例补 `outbound_contains` 哨兵，并让 real 模式的 `ctx.outbound` 由转录投影供给（顺带兑现 ZCode 耦合点 1「real 现在 outbound=null 故不能带该判据」——修完 real 层也能出站自证）。
  - P4 产物命名隔离：报告与基线按 **(suite, provider)** 分 namespace（现状 `acceptance/evals/<suite>-latest.json` 与 `evals/baselines/<suite>.json` 不分 provider，回放报告会覆盖 real-latest 并把真模型棘轮比到回放数上=**假绿通道**）；`evals-gate.mjs` 加同口径 `--provider`，且保持 191 的「基线写仅 `--update`」源码门不破。
  - 门禁：契约测 `test/block193-capture-replay.test.mjs`（差分归属/投影两态/缺 response 不编造/密钥闸拒写且不外泄/合成闸拒录/哨兵闸/**假绿反证**=罐头回合配空 outbound 必红）+ 实机录制一次（真模型，用户「验收一律选彻底那条」）+ `--provider=replay` 离线复跑绿 + `evals:gate --suite=real` 回归 0 + smoke/golden 零回归 + `test:changed --base=<192 收口提交>` + `npm run closeout` 十三门。
  - 完成语义：一条命令录制（真模型一次）→ 一条命令**零 API、零凭据**离线重放绿；录制产物零密钥、零用户数据、可人审；哨兵证明重放确实走过出站路径。
reopen: LLM-as-judge real 模式（判词与 real 基线耦合，provider 依赖切片）；竞争力 8 维复测（蓝图明定随包不单开）；orchestration 类多 agent 任务的录制（转录归属需 conversation 血缘口径，本包只录 real 套件单 agent 形态）。
status: active
---

# BLOCK-193 — capture/replay 真实录制态（评测 v2 第五切片）

- 状态：`active`（2026-10-16 用户「可以呀 按上面这个定案开建 BLOCK-193」发令；P0 实码勘察后按更正事实立项）

## 1. 立项自检（对标不改魂）

差别形态在这里写得最实：ZCode 的 capture/replay 是**自建录制层**（自己拦 HTTP、自己存、自己放）；Petri 的录制态**坐在生产记录器上**——同一条 `_emitTranscript` 既服务用户可审计的 `llm-transcripts` 取证面（BLOCK-37/38 中断续跑摘要）又服务评测重放，**零第二实现**，且本地断网可跑、逐条可人审（本地主权 + 证据自证）。借的是「replay 断出站哨兵防罐头假绿」这个形，长出来的是「录制=既有 I/O 台账的投影，不是新增采集面」这个own形态。

## 2. 范围（P0 实码核对，非台账转述）

| 面 | 实况（已核） | 处置 |
| --- | --- | --- |
| 响应留存 | `model-gateway.js:267` 流式/非流式统一 `_emitTranscript` → tmpDir/llm-transcripts 已在写 | 收割，不新建采集 |
| 留存去向 | `evals-run.mjs:120` `fs.rmSync(tmpDir)` → 随临时目录销毁 | 任务级差分提取后入仓 |
| 投递机制 | `startMockProvider` 已是「有序回合队列的本地 SSE server」，`captured` 同步记出站 | replay 直接复用，零新 provider |
| 密钥位置 | `deepseek.js:30/120/523` 只发 `Authorization: Bearer`，body 无 key | 转录天然无 key，仍加结构闸防形状漂移 |
| real 出站 | `evals-run.mjs:64` `outbound: mock ? mock.captured : null` → real 恒 null，`outbound_contains` 必红 | real 的 outbound 改由转录投影供 |
| 落点命名 | 报告/基线按 suite 单键，provider 不入名 | 加 (suite,provider) namespace |
| 快照条件 | `if (backend.ok && mock)` | replay 走 mock → 无需放宽（转述的耦合点在此不成立） |

## 3. 非范围（红线）

- **不写录制代理/第二 SSE 解析器**：与生产 `io-transcript` + `stream-aggregate` 重复即红线。
- **不外泄 key 与用户数据**：转录只取语义回合；写前密钥扫描 + 合成任务闸双过，任一不过就不入库。
- **不冒充模型质量**：replay 的 `measures=recorded-replay`，测的是回放管道与判据评估，不进 real 基线。
- **不改判定语义**：PASS=全 criteria 过；188/189/190/191/192 既有行为零回归；不动 `fixtureFiles`/`requiresFixture` 词汇（191 的 fixture=任务工作区输入，本包产物命名统一叫 **recording/录制态**，避免撞词）。
- **不录 smoke/golden**：已有手写确定性脚本，录制不增值。
- **G1+ 不外推**：不碰 packaged/Provider 商务面/公证。

## 4. 执行

P1 收割与投影纯函数 → P2 双闸 + 产物落盘 → P3 runner 三态（mock/real/replay）与哨兵闸 → P4 namespace + 契约测 → 实机录制与 replay 复验 → closeout 十三门 + 五件套回写。

## 5. 并行隔离

触碰面=`scripts/lib/evals-recording.mjs`（新）/`scripts/lib/evals-harness.mjs`（real outbound additive）/`scripts/evals-run.mjs`+`scripts/evals-gate.mjs`（三态与 namespace）/`scripts/secret-scan.mjs`（导出 PATTERNS + main 守卫，扫描行为不变）/`evals/suites/real/*.json`（补哨兵判据）/新 `evals/recordings/real/`/新 `test/block193-*.test.mjs`/impact-map/五件套台账。真模型调用只在 P3 录制时发生一次，零 dev 栈依赖、零人眼。
