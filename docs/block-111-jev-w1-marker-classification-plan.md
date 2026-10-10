# BLOCK-111-JEV-W1-MARKER-CLASSIFICATION 计划：marker→细胞类型判别二跳（决策内化弧 W1-1）

**Plan ID**：`BLOCK-111-JEV-W1-MARKER-CLASSIFICATION`
**状态**：`completed（2026-09-22 当日立项当日收口：P0 校准 gate.passed（104 条语料，θ=0.55：adoptedAccuracy 1.0/coverage 0.9125/trap 0%）→ P1 接线（契约 14/14 + test:changed 159 项 0 红）→ P2 A/B 生产路径 gate.passed（gatedAccuracy 1.0 / endToEnd 0.925 ≥ legacy 0.8375）+ 实机 flow block111-marker-live **7/7**。D-1~D-5 按推荐先行留痕（§7.2/§7.3，用户评审可翻）。本包=决策判断模式内化弧 W1 队列第 1 点（逐点立项）；W1 队列 2~5 点仍需各自单独裁决；弧线底稿=docs/planning/decision-primitive-internalization-arc.md §W1）`
**立项日期**：2026-09-22
**最后更新**：2026-09-22（立项登记 active/P0-LAUNCH。用户裁决原话「1」——AskUserQuestion 菜单选项 1「Jev W1 决策内化」，选项描述列明首序三候选「marker 判别/意图路由/工具预路由，逐点立项」；首点按弧线 §W1 预登记队列次序取第 1 点。W0=BLOCK-110 已整包 completed（closeout 十门全绿，提交至 4dbfeff7），W0 证据门绿。）
**责任轨道**：BLOCK（后端决策接点 + 校准 harness + REST 契约 additive，跨 P 阶段串行）
**上游文档**：`docs/planning/decision-primitive-internalization-arc.md`（W1 队列与全程约束）· `docs/planning/typesafe-jev-system-one-research.md` §6.1 #4（接入点盘点）· `docs/block-110-jev-decision-integration-plan.md`（W0 载体，其 wrapper/校准 harness/A-B 方法论为本包直接复用资产）

## 0. 立项来源与用户裁决留痕

- 弧线规划（2026-09-21）：用户提出「判断的思想引入了 后期必然要内化进项目的 早点做规划」——`decision-primitive-internalization-arc.md` 登记为规划弧，W1+ 启动均需用户裁决。
- W0 收口（2026-09-22）：BLOCK-110 整包 completed，closeout 十门全绿（提交至 4dbfeff7）——W1 开门条件「W0 证据门绿」成立（P1 话题漂移 A/B：coverage 100% accuracy 0.99；P2 实机腿 7/7）。
- **本包启动裁决（2026-09-22）**：用户裁决「1」（AskUserQuestion 菜单选项 1「Jev W1 决策内化」）。结构裁决沿用弧线预登记纪律：**每点独立 PoC 门、不打包、逐点立项**——本包只覆盖 W1 队列第 1 点，队列第 2~5 点（意图路由/工具预路由/测试失败归因/增量测试选择）仍需各自单独裁决。

## 1. 范围与非范围

### 1.1 范围（in-scope）

把 W0 已验证的「决策原语二跳」模式复制到 marker→细胞类型判别接点：现行硬编码规则表命中无置信度、无概率、多候选无仲裁；目标=规则表降级为**候选生成器**，Jev/决策原语（choice 题型）在候选集内补全概率分布与 confidence，阈值门控后向 `/api/ai/interpret` 消费方提供带置信度的细胞类型提示。

| 阶段 | 内容 | 核心落点 |
| --- | --- | --- |
| P0 | 校准基线 + 题型/阈值评审 | marker 判别中文/符号语料 ≥100 样本（构建法见 §3 D-3）+ confidence-accuracy 曲线 + 阈值初值 + D-1~D-5 逐项裁决；证据落 `acceptance/block-111/` |
| P1 | 接线 + 降级契约 | `core/petri-server/helpers/interpret.js` `lookupCellType` 旁路二跳（规则表候选生成 → `askDecision` choice → 阈值门控 → additive 输出）；`routes/ai-legacy.js` `cellTypeHints` additive 契约扩展；降级路径测试钉住 |
| P2 | 实机验收 + 收口 | dev Electron 实机 `/api/ai/interpret` 全链断言（真实 Jev 轮次 + 降级态 + 杀开关）+ A/B 对账 + closeout 十门 |

### 1.2 非范围（exclusions）

- **`callDeepSeekSimple` / `buildInterpretPrompt` 零触碰**——B 型生成链路，决策原语红线（arc §3.3）。
- **`CELL_MARKERS` 规则表内容不重构不扩充**——A 型资产保留原状，本包只改它的**角色**（唯一候选生成器）；规则表内容维护另行裁决。
- `cellTypeHints` 既有字符串契约不破坏（additive 扩展，形态见 D-2）；前端消费面重构不在本包。
- W1 队列第 2~5 点（copilot 意图路由 / 工具两跳预路由 / 测试失败归因分类器 / 增量式测试选择建议）——各自独立立项。
- W2 平台化（decision_log 台账 / 阈值配置中心 / 校准工具化）——W1 复制 ≥2 点后才评估。
- 单细胞分析主链路（聚类/注释算法）不动——本包只影响 `/api/ai/interpret` 提示层。

## 2. 现状与目标

### 2.1 现状（file:line 已核实）

- `core/petri-server/helpers/interpret.js:19` `CELL_MARKERS`：22 条基因组合→细胞类型映射（CellMarker 2.0 + PanglaoDB 高频条目精选）。
- `interpret.js:52-66` `lookupCellType(markers)`：对每条规则数交集（`matches >= 2 && matches > bestScore`），取最高分命中返回**裸字符串**；无并列仲裁（先到先得）、无置信度、无概率；无命中返回 `null`。
- 唯一生产消费点 `core/petri-server/routes/ai-legacy.js:27`：`POST /api/ai/interpret` 对每个 cluster 的 topMarkers 查表 → `cellTypeHints`（cluster→类型名字符串）与模型解读文本并列返回；模型失败时 hint 串进 fallback 文本。
- 痛点：跨类型共有基因（如 GZMB 同时命中细胞毒性 T 与 NK 语境）时命中分并列无仲裁；用户看不到「这个推断有多可信」；规则表外的新型细胞类型提示完全丢失（这是 B/C 型边界内的固有损失，本包不追）。

### 2.2 目标形态（W0 同构二跳）

```
markers[] ─→ 规则表候选生成（A 型，零出站）：候选集 = matches≥2 的细胞类型集
   ├─ 候选集为空 ─→ 直接返回 null（维持现行为，不出站）        ← A 型边界：无候选不问模型
   └─ 候选集 ≥1 ─→ askDecision(choice)：state=markers 面板，
                    criteria=候选集（模型只挑不造，arc 红线）
                    ├─ !ok（no_key/超时/校验失败/杀开关）──→ 回退现行 lookupCellType 字符串（零行为变化）
                    └─ ok：argmax + probabilities + confidence
                         ├─ confidence ≥ θ_high ─→ 采纳（additive 附置信度，形态见 D-2）
                         ├─ θ_low ≤ confidence < θ_high ─→ 维持现行字符串（无置信度）   ← 中间带回退
                         └─ confidence < θ_low ─→ 维持现行字符串
```

## 3. P0 预登记裁决项（D-1~D-5，P0 评审时逐项裁，均有推荐）

- **D-1 题型**：choice（候选=规则表命中集，`matches≥2` 边界沿用现行；候选唯一时是否仍出站问 confidence？）——推荐：唯一候选也出站（一次调用补全 confidence 与分布，interpret 低频无成本压力）。
- **D-2 消费契约形态**：`cellTypeHints` 保留字符串不动 + additive 新增 `cellTypeHintsDetailed`（`{cluster, type, confidence, probabilities, adopted}`[]，仅决策路径样本进入）——推荐此形态（零破坏、可回放、老前端零感知）。
- **D-3 校准语料构建法**：≥100 样本，全部由公开发表 marker 知识构建（CellMarker/PanglaoDB 同源），**零用户数据出站**（D-A 分级=一般）；构成=①每类型典型全面板/部分面板/加噪面板（正样本）②跨类型歧义面板（并列命中，gold=生物学正确主导型）③陷阱面板（gold ∉ 候选集，正确行为=低置信回退，占比 10~15%）④候选集为空样本（断言零出站，不进 choice 指标）。格式镜像 `acceptance/block-110/corpus-topic-shift.json`（kind/domain/version/note/count/samples）。
- **D-4 默认开关位**：默认关+显式开（`PETRI_JEV_MARKER_GUARD=1`，同 W0-P2 知识库二跳先例）vs 默认开+杀开关（同 W0-P1 话题漂移先例）——推荐：**默认关+显式开**（`/api/ai/interpret` 是用户可见科学提示面，可信度敏感；P0 校准 accuracy ≥0.95 且 P2 实机零回归后，翻默认另行裁决）。
- **D-5 阈值初值与门控语义**：P0 曲线产出后定（预期 θ_high≈confidence 且 accuracy ≥0.95 的最低置信带；θ_low 取显著低于 chance 的下界）；中间带维持现行无置信度字符串——推荐双阈值三区间，与 W0-P1 同构。

## 4. 关闭语义

- **正常完成**：P0 证据门（accuracy 门过 + D 项裁决齐）→ P1 接线 → P2 实机 + closeout 十门 → completed。
- **PoC 失败语义（诚实收缩）**：P0 校准 accuracy 不达标（choice argmax accuracy < 0.90 或 confidence-accuracy 曲线与对角线系统性背离）→ 本包按 §4 收缩关闭，**仅冻结 W1 队列第 1 点**（弧线其余点不受影响，区别于 W0 失败的全弧冻结）；负结果与失败形态登记回 arc 文档与候选池。
- 中途 key 失效/供给不可用：按降级契约回退现行为，本包转 🟡 延期而非硬推。

## 5. 验收门禁清单（收口时逐项对账）

| 门禁 | 预期 |
| --- | --- |
| P0 校准证据 | `acceptance/block-111/calibration.json`（≥100 样本，confidence-accuracy 曲线 + 阈值初值 + 分桶正确率）+ `corpus-marker-celltype.json` 语料入库 |
| P0 评审 | D-1~D-5 逐项用户裁决留痕（本节或 §3 追加） |
| P1 契约测试 | `test/block111-marker-classification.test.mjs`：候选生成边界（空集零出站/唯一候选/并列仲裁）/降级五态（no_key/timeout/校验失败/杀开关/网络失败均回退现行字符串）/响应校验拒绝伪造候选（choice ∉ criteria 必拒）/D-2 additive 契约形状 |
| P1 A/B 对账 | `scripts/block111-p0-ab.mjs`（镜像 `block110-p1-ab.mjs` 方法论）：Jev 二跳 vs 现行 lookupCellType 在语料上的 accuracy/一致率/延迟；门限=accuracy ≥0.95 且不低于现行基线 |
| P2 实机 | dev-verify flow `block111-marker-live`：真实 Jev 轮次 `/api/ai/interpret` cellTypeHintsDetailed 在场 + 杀开关回退态 + 无 key 降级态 + 老契约字符串零变化；证据 `acceptance/block-111/` |
| 收口链 | `npm run closeout` 十门全绿；impact-map 登记 `block111-jev-w1-marker` 规则；UI 台账：无 UI 行为变化则零登记（additive 后端字段） |

**预期节奏**：P0+P1 一次会话、P2 实机同会话或次会话收口（对标 BLOCK-110 当日 P0→P2 节奏）。

## 6. 红线与风险

- **模型只挑不造**：criteria 只能来自规则表命中集，模型不得新增候选（响应校验层机械保证：choice ∉ criteria 即 invalid_response 降级）。
- **决策 API 唯一接入**：必经 `helpers/decision-api.js` `askDecision`（0 npm 新依赖，pin `jev-1.13.0`）；退出路径=删接点回退现行。
- **key 不入仓**：`TYPESAFE_API_KEY` 只从服务端 env（`.petri-secrets` source 入栈，quality:secret 红线）。
- **降级必有**：任何失败形态回退现行 `lookupCellType` 字符串，`/api/ai/interpret` 永不因决策 API 失败而失败。
- **A 型规则零模型化**：不把「是否命中」本身交给模型；规则表匹配始终是候选生成前置门。
- 风险：基因符号人鼠同源歧义（Corpus 覆盖）、Jev CJK 短板（本接点 state 以基因符号为主、候选名为中文——P0 语料含中文候选名样本实测该项）、低频接点观测样本少（P2 以 harness 语料为主要证据面，实机只验链路）。

## 7. P0 评审稿（2026-09-22 实测完成，D-1~D-5 待用户裁决）

### 7.1 实测证据（`acceptance/block-111/calibration.json`，gate.passed=true）

- 语料：104 条（canonical 22 / partial 19 / noisy 22 / ambiguous 17 / trap 12 / empty 12），choice 可评估 92（trap 占 13%），零候选边界 12 条验证「空集零出站」；**0 API 失败**；`--dry` 候选推导一致性全绿（规则表 matches≥2 语义与 lookupCellType 同源）。
- **未门控 argmax top-1 accuracy = 0.975**，对照现行规则表基线（lookupCellType 首个最高分命中）**0.8375**——差距全部来自歧义面板（canonical/partial/noisy 三层全 100%，ambiguous 0.8824）。
- **置信度分离**：gold∈候选样本均值 0.916 vs trap（双细胞）均值 0.23。
- **阈值扫描**：θ=0.50 → coverage 0.925 / adoptedAccuracy 0.9865 / trap 误采纳 8.3%；**θ=0.55 → coverage 0.9125 / adoptedAccuracy 1.0 / trap 误采纳 0**；θ=0.60 → coverage 0.90 / 1.0 / 0。
- **2 个 argmax 失误（如实登记）**：mc-amb-02（CD8 vs 细胞毒性 T/NK，conf 0.11）、mc-amb-12（NK vs 细胞毒性 T/NK，conf 0.51）——均落在「细胞毒性 T/NK」重叠带，且置信度均低于 θ → 门控正确路由回退，**门控后零错误进入采纳集**。
- 延迟 P50 301ms / P95 721ms；input tokens 44,836（92 次，约 487/次）；模型 pin jev-1.13.0。

### 7.2 裁决项（推荐已按数据定版）

| 项 | 推荐裁决 | 依据 |
| --- | --- | --- |
| **D-1 题型** | choice，唯一候选也出站（补 confidence） | partial 2 基因子集 accuracy 1.0 / conf 1.0，出站成本约 487 token/次、P50 301ms，interpret 低频无压力 |
| **D-2 消费契约** | `cellTypeHints` 字符串不动 + additive `cellTypeHintsDetailed: {cluster, type, confidence, adopted, probabilities}[]`（仅决策路径样本进入） | 零破坏、可回放；`adopted=false` 即回退样本（type=现行规则表结果） |
| **D-3 语料构建法** | 按 §3 D-3 交付定版（104 条，构建法与 gold 判据见 corpus note） | 实测通过；语料与校准证据同入库 |
| **D-4 默认开关位** | **默认关 + 显式开 `PETRI_JEV_MARKER_GUARD=1`**（同 W0-P2 先例）；P2 实机零回归后翻默认另行裁决 | 用户可见科学提示面，可信度优先；未门控歧义 88.2% 说明回退路径必须常备 |
| **D-5 阈值** | **单阈值 θ_high=0.55**（conf≥0.55 采纳附置信度，否则回退现行字符串） | θ=0.55 为 coverage≥0.85 约束下 adoptedAccuracy=1.0 + trap 误采纳=0 的最高覆盖档；choice 题型 confidence 天然单门控，W0-P1 noul 的三区间双阈值不适用（题型差异，非偏差），中间带回退语义由「<θ 即回退」承接 |

**P0 结论**：证据门通过（accuracy 1.0@0.55 ≥ 0.95 门、coverage 0.9125 ≥ 0.85 门、trap 0% ≤ 5% 门）。D-1~D-5 用户裁决后进 P1。

**裁决回填（2026-09-22）**：用户裁决原话「继续 按推荐的进行」——D-1~D-5 全部按 §7.2 推荐定版（含 D-4 默认关+显式开、D-5 θ=0.55 维持；θ=0.60 备选不采纳，未来如采纳须先重校准）。§7.3「先行留痕待评审」状态自此闭环。

**P0 评审处置（2026-09-22）**：AskUserQuestion 裁决未应答（非拒绝），按仓库「预置推荐按推荐先行留痕、评审可翻」先例（BLOCK-100/107 D 项同款）以 §7.2 推荐值进入 P1——D-4 推荐方向=默认关，生产行为零变化，属最保守侧；D 项均为单点常量（阈值/env 开关/字段形状），用户后续翻裁决成本一行。已在状态头与本行留痕，P2 收口前用户可改。

### 7.3 P1 落地记录（2026-09-22）

- `core/petri-server/helpers/interpret.js`：新增 `MARKER_DECISION_THRESHOLD=0.55` / `deriveMarkerCandidates`（lookupCellType 同语义全命中集）/ `buildMarkerDecisionRequest`（P0 校准同形，单源）/ `isMarkerGuardEnabled`（`PETRI_JEV_MARKER_GUARD=1`）/ `lookupCellTypeWithConfidence`（永不 throw，五态降级）；`lookupCellType` 原函数零改动（回退目标）。
- `core/petri-server/routes/ai-legacy.js`：guard 关=原路径逐字节等价（零新键）；guard 开=`cellTypeHints` 照旧 + `cellTypeHintsDetailed`（`{cluster,type,confidence,adopted,probabilities?}`）additive。
- `scripts/block111-p0-calibrate.mjs`：候选生成与请求组装改引 interpret.js 单源（删本地副本），`--dry` 回归绿。
- 契约 `test/block111-marker-classification.test.mjs` **14/14 绿**（现行契约钉/候选推导/请求形状/guard 关零出站/零候选零出站/no_key/timeout×3/http_error/network_error/伪造候选拒收/采纳/低于阈值回退/阈值边界 0.55/歧义陷阱端到端）；`npm run test:changed` 路由 **159 项 0 红 3 skip**；impact-map 登记 `block111-jev-w1-marker` 规则。

### 7.4 P2 落地记录（2026-09-22，当日收口）

- **A/B 生产路径**（`scripts/block111-p1-ab.mjs`，guard=1 + 真实 key，92 choice 可评估 + 12 零候选边界）：legacyBaseline **0.8375** / coverage **0.9125** / gatedAccuracy **1.0** / endToEnd **0.925** ≥ legacy ✓ / 零候选边界 **12/12** 直返 null；gate.passed=true（`acceptance/block-111/p1-ab.json`）。**诚实登记（轮间方差）**：本轮 1/12 双细胞陷阱被采纳（trapFalseAdoption 8.3%，校准轮为 0%）——θ=0.55 位于该陷阱置信度（≈0.5-0.6 漂移带）边缘；采纳态附带 confidence 与 probabilities 呈现、且 D-4 默认关（显式开才生效），风险有界；若用户裁决收紧，θ=0.60（校准 coverage 0.90）为备选档，**改阈值必须先重校准**。
- **实机腿** flow `block111-marker-live` **7/7 allPass**（dev 栈以 `PETRI_JEV_MARKER_GUARD=1` + jev.env 重启；证据 `acceptance/block-111/block111-marker-live-live.json`）：M0 端点 200 / M1 detailed 四簇在场 / M2 canonical T adopted=true conf=1 / M3 双细胞簇模型给 conf 0.5 < 0.55 → adopted=false（正确回退，模型行为留痕）/ M4 零候选簇 {type:null} / **M5 老契约 cellTypeHints 深等于规则表预期（零变化）** / M6 canonical B adopted=true conf=1。
- 降级五态（缺 key/超时/http 错/网络错/杀开关）由契约测试覆盖（单后端进程无法运行中翻 env，flow 头注已注明）。
