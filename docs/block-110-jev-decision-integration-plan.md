# BLOCK-110-JEV-DECISION-INTEGRATION 计划：Jev/System One 决策模型融合

**Plan ID**：`BLOCK-110-JEV-DECISION-INTEGRATION`
**状态**：`active（P0 完成——2026-09-22：wrapper/降级契约/校准 harness 三件全落地（a539e6c8，另一会话实现）+ overrides 缺省 hotfix（校准 harness 实测抓真）+ 中文校准 gate.passed=true（topic-shift 200 条 decidedAccuracy=1.0 coverage=0.98 阈值 YES≥0.85/NO≤0.5；retrieval 60 条 1.0/1.0 阈值 YES≥0.5/NO≤0.15）。待用户评审：D-A 数据出站分级终裁 + P1 启动裁决。评审材料见 §P0-评审）`
**立项日期**：2026-09-21
**最后更新**：2026-09-22（启动登记 active/P0-LAUNCH，启动动作三件套完成：DOC-REGISTRY planned→active + AUDIT-LOG 启动行 + roadmap 状态行；26 个已收口提交推送 origin）。2026-09-21（立项登记 planned；技术底稿= `docs/planning/typesafe-jev-system-one-research.md`；**本包=决策判断模式内化弧的 W0**，后续弧线见 `docs/planning/decision-primitive-internalization-arc.md`——W1+ 启动均需用户裁决，本包收口不等于弧线授权）

## 0. 立项来源与用户裁决留痕

- 技术调研（2026-09-21，本会话）：TypeSafe Jev 官方 109 页文档全量调研 + 17 篇 cookbook 提炼 + Gewu 7 区域接入点排查，沉淀为 `docs/planning/typesafe-jev-system-one-research.md`（kind: reference）。
- 用户裁决原话（2026-09-21）：「现在集中到jev和项目的融合中来 是否要做个或多个block来优化项目」。
- 结构裁决（2026-09-21，AskUserQuestion）：包结构=「一个 BLOCK 分阶段（推荐）」；P3 工具预路由=「列入包内选做阶段（推荐）」（P2 收口后另行裁决是否执行）。
- key 裁决（2026-09-21，用户原话）：「key暂时保留等我们的项目走到一定的阶段我再替换」——测试 key 暂用，轮换时点用户定；**任何阶段 key 不入仓**（`quality:secret` fail-closed 红线），P0 起走服务端 env 注入。

## 1. 范围与非范围

### 1.1 范围（in-scope）

把 TypeSafe Jev（System One 决策 API）接入 Gewu 后端，按「地基 → 最小 PoC → 检索增强 → 选做预路由」四阶段推进：

| 阶段 | 内容 | 核心落点 |
| --- | --- | --- |
| P0 | 接入地基 + 中文校准基线 | 新增 `core/biof3-server/helpers/decision-api.js`（裸 HTTPS wrapper）+ 中文语料 confidence-accuracy 校准 harness |
| P1 | 话题漂移判断 noul 直替（PoC） | `core/biof3-server/helpers/conversations.js` `_maybeDetectTopicShift` |
| P2 | 知识库检索二跳过滤/重排 + 注入检测 | `core/biof3-server/helpers/knowledge-space.js`（`VECTOR_THRESHOLD` 之上加语义层） |
| P3（选做） | MCP 工具下发前两跳预路由 | `core/biof3-server/agent-runner.js` 工具下发链（`:614` resolveToolDefsForContext 处挂钩） |

P0 交付三件事：① wrapper（超时/指数退避重试 429,529 遵循 retry-after/响应校验仿 jev-ultrafast `validate_choice`：choice∈ids、概率归一 ±0.02、argmax 一致）；② 降级契约（缺 key、网络失败、校验失败一律回退现行为，降级路径必须有测试钉住）；③ 校准 harness（topic-shift ≥100 条中文标注样本 + 检索相关性样本，产出 confidence-accuracy 曲线与阈值初值，证据落 `acceptance/block-110/calibration.json`）。P0 收口含一次评审裁决（阈值初值、题型定版、降级策略细节）。

**P0 评审预登记裁决项（2026-09-21 立项讨论沉淀，启动评审时逐项裁）**：

- **D-A 数据出站分级**：项目现状已有第三方出站（DashScope 嵌入 `knowledge-ingest.js`、DeepSeek 解读 `interpret.js`），Jev 为新增接收方而非首次出站；须裁①全 provider 统一数据分级表 ②P1 state 最小化（仅最近 N 条消息）③P2 检索内容出站是否默认关闭+用户显式开启 ④远期 ZDR/本地化定位。
- **D-B provider 可替换性**：wrapper 接口不绑定 `api.typesafe.ai` 域名与官方 SDK 形状，未来本地模型/开源权重可直接换入，接点零改动——列入 P0 验收（单测：base URL 可配置、响应契约与域名解耦）。

### 1.2 非范围（exclusions 与红线）

- **红线：BLOCK-109 文件面零触碰**——`ai-agent/chat.js`、`loop-orchestrator.js`、`conversationRunStore.ts` 事件投影链在 BLOCK-109 收口前不改一行；P3 的 agent-runner 挂钩也只能在 BLOCK-109 收口后动手。
- **0 npm 新依赖**：不引入 `typesafe-sdk` / `@typesafe-ai/sdk`，Node 侧裸 HTTPS 自实现（依赖裁决见 §2）。
- 不做浏览器 agent 类功能（jev-ultrafast 形态）。
- 不动已判「不适合」的确定性决策点：loop 决策（`loop-orchestrator.js`）、执行策略（`agent-execution-policy.js`）、verify_state（`verify-dispatch.js`）、auto-title（生成类）。
- 前端零改动零持 key：P1/P2 全部落在 core/biof3-server 服务端。
- marker→细胞类型判别（`interpret.js`，研究文档候选点 4）**不在本包**——留候选池，需要时另行立项。
- G0 阶段纪律：不外推 packaged/Provider/GA。

## 2. 依赖裁决（DEPENDENCY-CHANGE-CHECKLIST 四问）

- **替代方案审过**：① 官方 SDK vs 裸 HTTP——cookbook 全部裸 HTTP，SDK 价值（类型/重试）可自实现且 core 侧已有同款先例；选裸 HTTP，**0 npm 新依赖**。② 用 Jev vs 维持现状（大模型 JSON 分类/硬阈值）——P1 即 A/B 对比项，数据说话，不预设 Jev 必赢。
- **许可证与维护度**：TypeSafe 为 SaaS API 服务（HTTP 契约），无包 license/传递依赖问题；模型版本 pin `jev-1.13.0`（不用 `jev-latest` 别名，阈值校准绑定版本）。
- **影响面**：仅 core 服务端新增出站调用；不进前端 bundle、不碰 native ABI、不影响启动路径；速率限制（官方声明动态调整）由重试 + 降级吸收。
- **退出成本**：全部接点经唯一 wrapper `decision-api.js`，移除=删 wrapper + 各接点回退原路径（每处降级路径即退出路径，P0 起测试钉住）。
- **用户裁决留痕**：2026-09-21 结构裁决（§0）；key 暂保留裁决原话见 §0。

## 3. 阶段验收门禁

### P0 地基 + 校准
- wrapper 单元测试：合法响应放行 / 非法响应（概率不归一、choice 非 argmax、超时、429/529）重试与拒收 / 缺 key 降级——`test/block110-decision-api.test.mjs` 全绿。
- 校准证据：`acceptance/block-110/calibration.json`（样本数、阈值、accuracy 曲线）+ topic-shift 中文样本 ≥100。
- P0 评审裁决记录进本 plan（D 项列表）。

### P1 话题漂移直替（PoC 门）
- 契约不变：`_maybeDetectTopicShift` 返回 `{shifted, reason}` 形状不变，调用方零改动。
- noul 双阈值三区间（初值 YES≥0.8 / NO≤0.2，中间带=回退大模型路径或维持原判，P0 评审定）。
- A/B 对账：Jev 路径 vs 现大模型路径在同批 ≥100 条样本上的一致率、延迟（P50/P95）、成本——证据 `acceptance/block-110/p1-ab.json`。
- **失败语义**：若中文 accuracy 低于现路径或置信区间不可用 → 整包诚实收缩：P1 负结果报告 + P2/P3 不启动 + wrapper 去留另裁决，包以收缩语义关闭（见 §5）。

### P2 知识库二跳
- 行为红线：延续「无 key 诚实降级」家法（`knowledge-tools.js` 先例）；`VECTOR_THRESHOLD=0.55` 第一道硬阈值保留，Jev 只做其上的二跳（重排分数 + injection noul 拦截），注入拦截阈值 P0 评审定。
- 检索契约测试 + 注入样本拦截实测（cookbook `classifying_rag_passages` 场景复刻）。
- 实机腿：knowledge-space 检索预览 dev-verify flow 断言。

### P3 工具预路由（选做——P2 收口后用户另行裁决是否执行）
- 两跳渐进披露（cookbook `skill_suggestion` 模式）：族级 Choice → 子集下发；`open_tool` 提示词映射表（agent-runner `:490-495`）由路由结果替代。
- 行为基线：现有工具调用 E2E 场景全数保留（BLOCK-109 P2 工具元数据化交付复用）。
- 本阶段启动前必须在 plan 状态头补记用户裁决。

## 4. 完成语义

- **正常完成**：P0→P2 验收门禁全绿 + P3 裁决留痕（执行则其门禁亦全绿）+ `npm run closeout` 聚合绿 + DOC-REGISTRY `completed` + roadmap/AUDIT-LOG 收口行。
- **收缩完成（PoC 失败）**：P1 A/B 不过关 → 负结果结论落本 plan §6 + research 文档回写实测数据，包关闭；不视为失败项目，视为校准了「Jev 在中文场景不适用」的候选池事实。
- 任一阶段可中断：进度回写本状态头，恢复按 plan 对账。

## 5. 证据位置

- `acceptance/block-110/`：calibration.json、p1-ab.json、实机 flow 断言输出。
- 测试：`test/block110-*.test.mjs`；`test/impact-map.json` 增补映射。
- 实机：dev-verify flow `block110-<stage>-live`（P1 起每阶段 ≥1 条腿，真实 key 小流量）。

## 6. 启动条件（对账 LAUNCH-CHECKLIST）

- [ ] BLOCK-109 收口（active 槽位释放）。
- [ ] 启动时复核：AUDIT-LOG 无 🔴 阻塞、git 无未知 WIP、用户确认开跑。
- [ ] 启动动作：DOC-REGISTRY `planned → active`（phase: P0-LAUNCH）+ AUDIT-LOG 启动登记行 + roadmap 状态行更新。

## 7. 技术底稿

接入点 file:line、题型选择、8 条设计规律、jev-1.13 短板清单、cookbook 对标（`consistency_noul`/`classifying_rag_passages`/`rerank_typesafe`/`skill_suggestion`）全部见 `docs/planning/typesafe-jev-system-one-research.md` §6-§7，本 plan 不复制。

## 8. 关键工程约束（实现期自检）

1. **中文先验不足是最大风险**：官方明示 CJK 非等效；P0 校准不过关则不走 P1（失败语义 §4）。
2. **阈值必须绑版本**：pin `jev-1.13.0`；官方升级导致分布漂移时阈值须重校准（plan 状态头记录）。
3. **Noul 无 confidence**：门控用双阈值三区间实现，不从 noul 派生 confidence。
4. **概率不跨题型搬**：jev-1.13 已知短板（research 文档 §3.8）——noul 与同义 Choice 概率不可比。
5. **禁止把 Jev 用于生成**：reason 字段等生成类输出仍由现路径承担；Jev 只回判断。

## P0 收口记录（2026-09-22 深夜）

**交付对账**：①wrapper `helpers/decision-api.js`（a539e6c8，另一会话实现；本会话 hotfix 一处——`askDecision` 的 overrides 解构缺 `= {}` 默认，生产调用方〔校准 harness〕零 overrides 必抛，校准实测抓真，回归钉入 test/block110-decision-api 16/16）；②降级契约=测试钉住（no_key/invalid_request/auth_failed/rate_limited/overloaded/timeout/network_error/invalid_response 全型，15→16 用例全绿）；③校准=真实 API 实测（key 经 jev.env 服务端 env 注入，不入仓）。

**校准证据**（`acceptance/block-110/calibration.json`，model=jev-1.13.0，gate.passed=true）：

| 域 | 样本 | 推荐阈值初值 | decided | coverage | decidedAccuracy |
| --- | --- | --- | --- | --- | --- |
| topic-shift（noul） | 200（100/100 平衡） | YES≥0.85 / NO≤0.50 | 196 | 0.98 | **1.00** |
| retrieval（choice） | 60（30/30 平衡） | YES≥0.50 / NO≤0.15 | 60 | 1.00 | **1.00** |

官方明示 CJK 非等效——中文首校准即达 decidedAccuracy=1.0，远超 P0 判据（≥0.85/≥0.85）。语料 sha256 与逐样本结果见 calibration-samples/corpus 文件。

**P0 评审裁决项状态**：
- 阈值初值：按上表推荐（P1 双阈值三区间直接采用；P2 注入拦截阈值建议另行以注入样本实测后定，校准语料未含对抗样本）。
- 题型定版：topic-shift=noul（P1 形状）；relevance=choice（P2 形状）——概率不跨题型搬（§8-4）。
- 降级策略：按已实现契约（缺 key/auth/网络/校验失败一律 `{ok:false}` 回退，永不 throw；重试仅 429/529/超时，遵循 Retry-After）。
- D-B provider 可替换性：**测试实证**（baseUrl 指向本地 server 全链路通，契约不绑域名）。
- **D-A 数据出站分级：待用户终裁**——①P1 state 最小化（仅最近 N 条消息，N=?）②P2 检索内容出站是否默认关闭+用户显式开启 ③远期 ZDR/本地化。此项裁决后 P1 方可启动。
