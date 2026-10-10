# TypeSafe Jev（System One）技术调研与 Petri 落地评估

```yaml
kind: reference
status: reference
registeredAt: 2026-09-21
owner: research
tags: [typesafe, jev, system-one, decision-model, ai-agent, routing, guardrails, rag]
```

> 本文是技术调研参考，不构成工作包，不改变 `next-steps-roadmap.md` 的当前优先级；
> 是否启动任何落地项以 roadmap / 工作包正式裁决为准。
> 调研日期：2026-09-21。资料镜像：`D:\<workdir>\typesafe-docs\`（官方 docs.typesafe.ai 全部 109 页 markdown）；
> 参考实现 clone：`D:\<workdir>\jev-ultrafast\`。

## 0. TL;DR

- **Jev** 是 TypeSafe AI 于 2026-09-10 发布的第一个「System One（系统一）」模型：不做文本生成，只对输入 state 评估结构化问题，返回**带校准概率的类型化答案**（choice / score / noul + probabilities + confidence），官方宣称在判断类任务上比前沿 LLM 快 40~200×、便宜 40~400×。
- API 是单一 endpoint（`POST /v1/systemone`），一次请求可并行混合任意多道问题（加问几乎不增延迟）；只收输入 token（$42/Btok，$0.042/Mtok），输出免费。
- 官方生态齐全但生态圈很小（发布仅一周）：Python/JS 官方 SDK、Claude Code agent skill、17 篇带量化数据的 cookbook、4 篇架构 pattern、1 个浏览器 agent 参考实现（browser-use/jev-ultrafast）。
- **核心心法一条**：模型只做原子化窄判断，阈值、组合、权重、执行全部留在代码；confidence 是「敢不敢做」的第二轴，低置信转人工。
- **Petri 落地**：排查出 7 个候选接入点，top 3 为——① copilot 话题漂移判断（现有大模型 JSON 分类的毫秒级直替，`conversations.js`）；② 知识库检索相关性重排（`knowledge-space.js` 的 0.55 硬阈值之上加语义二跳）；③ 70+ MCP 工具下发前预路由（`agent-runner.js`）。中文能力初步实测可用但需自建语料校准。

## 1. Jev 与 System One 心智模型

| 维度 | 自回归 LLM（System Two） | Jev（System One） |
| --- | --- | --- |
| 输出 | 自由文本，逐 token 生成 | 类型化答案 + 概率分布 + confidence |
| 延迟 | 秒级 | 多数查询约 100ms（官方称 150ms 内可实时） |
| 成本 | 输入+输出均计费 | 仅输入计费，输出免费 |
| 幻觉 | 可能编造内容 | 无法编造选项外的值；非法输出可被代码拒收 |
| 适用 | 生成、推理、长文 | 分类、选择、评分、是非判断 |

- 训练路线：RLCD（Reinforcement learning for Calibrated Decisions）——优化目标是「决策 + 校准概率」。概率是**群体统计校准**（P=0.2 的事件约 20% 发生），不保证单次正确。
- 设计哲学「Machine Native Intelligence」：面向软件调用而非人类对话。**代码拥有工作流，模型只提供可编程的常识**（"Code owns the workflow; the model supplies programmable common sense"）。
- 不可 fine-tune：所有账户同一权重，无按客户 LoRA；定制全靠 state + questions 表达。不用客户数据训练；企业可签 ZDR。

## 2. API 速查

### 2.1 Endpoint 与请求/响应

```
POST https://api.typesafe.ai/v1/systemone      Authorization: Bearer <API_KEY>
GET  https://api.typesafe.ai/v1/models
```

```jsonc
// 请求
{
  "model": "jev-latest",              // 或 pin 版本 jev-1.13.0
  "state": "任意文本 / JSON object / array",   // 所有问题的共同评估对象
  "questions": {
    "route":     { "type": "choice", "instructions": "...", "criteria": {"keyA": "描述", "keyB": "描述"} },
    "severity":  { "type": "score",  "instructions": "...", "criteria": ["1级描述", "2级描述", "3级描述"] },
    "is_urgent": { "type": "noul",   "instructions": "是否紧迫" }
  }
}
// 响应（answers 按 questions 的 key 原样返回）
{ "model": "jev-1.13.0",
  "answers": {
    "route":     { "type": "choice", "choice": "keyA", "confidence": 0.78, "probabilities": {"keyA": 0.85, "keyB": 0.15} },
    "severity":  { "type": "score", "score": 1.0, "confidence": 1.0, "legend": {"0": "...", "1": "...", "2": "..."}, "probabilities": {"0": 0.0, "1": 1.0, "2": 0.0} },
    "is_urgent": { "type": "noul", "noul": 0.98 }
  },
  "usage": { "input_tokens": 392, "output_tokens": 65 } }
```

### 2.2 三种题型选择规则

| 题型 | 选项/量表 | 响应 | 用途 |
| --- | --- | --- | --- |
| **Choice** | `criteria` map，**≤255 项**（列表不全加 `other` 逃生舱） | `choice` + 全分布 `probabilities`（和=1）+ `confidence` | 无序分类；分布可直接当排序器（行级语义搜索） |
| **Score** | `criteria` 有序数组，**2~10 级**，模型只看描述不看编号 | `score`（Σ级号×概率，可落在级间）+ `legend` + 分布 + `confidence` | 有序量表；「级即动作」时可免拟合阈值 |
| **Noul** | 是/否判断（可给 true/false 描述） | 仅 `noul`（P(yes)，**无 confidence 无分布**） | 门控信号、0.5=不确定而非中等 |

- `confidence` 是分布形状的统计量，公式 `(N×max − 1)/(N − 1)`（全押=1.0，越平均越低）；**它不保证答案正确**，官方允许弃用其定义、自行从 probabilities 计算。
- instructions / criteria 都接受 string | object | array；对象字段名自定（`what` / `not_for` / `examples` 等），模型看得到全部内容；用反引号路径（`` `tickets[0].message` ``）指 state 嵌套字段。**问题 id 不发给模型**——完整语义必须写进 instructions。

### 2.3 配额与定价（jev-1.13.0，2026-09 档）

- 价格：**$42 / Btok 输入**（$0.042/Mtok），输出免费。速率：250,000 tokens/s、1,200 req/min——**官方声明随时无通知调整**。上下文：64k tokens/请求，其中 state + 最长单问 ≤32k。纯文本输入，不支持图片/音视频。
- 错误码：401（key 无效）、422（体校验）、429（限速）、529（过载）；429/529 指数退避重试。别名 `jev-latest` / `jev-preview` 当前都指向 `jev-1.13.0`——**调过阈值的场景必须 pin 版本号**。
- 语言：英文最准；**CJK「可处理但不等效」**，非英文负载必须用自有内容实测并重点依赖 confidence 路由。

### 2.4 官方 SDK

| | Python `typesafe-sdk` | JS/TS `@typesafe-ai/sdk` |
| --- | --- | --- |
| 要求 | Python ≥3.10（httpx、pydantic≥2.12、tenacity） | Node 20+，ESM/CJS/d.ts |
| 客户端 | `TypeSafeClient` / `AsyncTypeSafeClient`（支持 with） | `new TypeSafeClient()` → `client.systemOne({state, questions})` |
| 问题构造 | `Choice(...)`/`Score(...)`/`Noul(...)` 对象或原生字典（前向兼容） | `choice()/score()/noul()` 辅助函数，泛型绑定 criteria 字面量键，答案类型自动推断 |
| 重试默认 | max 2 次、0.5s 起指数退避至 5s、jitter 0.25、重试 {408,429,5xx}、尊重 Retry-After、总预算 30s | 同风格 OpenAI 式 `APIPromise` |
| 版本线 | 0.5.7(09-14)→0.6.0(09-15)→0.7.0(09-18, response_model) | 0.5.7(09-11)→0.6.0(09-15) |
| 环境变量 | `TYPESAFE_API_KEY`（必填）、`TYPESAFE_BASE_URL`、`TYPESAFE_DEFAULT_MODEL`、`TYPESAFE_LOG_LEVEL` | 同 |

## 3. jev-1.13 已知短板（官方 jaggedness，9 条，2026-09-17 复核）

这是选型评审最重要的一节——官方自己承认的坑：

1. **字面阅读**：按字面而非意图理解，否定词/隐含条件照字面执行；需要解释的地方就是缺了半句 instruction。
2. **不是计算器**：计数不可靠（字符/词频/列表项，误差随规模增长）——**能写代码数的一律代码数**；禁止用 score 期望值反推精确数量级。
3. **日期当文本**：先后、间隔、窗口比较不可靠；改法=模型只做部件抽取（枚举 Choice + not-stated 逃生舱），日历运算在代码。
4. **间接引用降准**：双重否定、属性之属性、多跳推理；减少跳数、按名指涉。
5. **大 state 含无关细节是干扰项**：先在代码里检索/过滤，或先用 Noul 过滤相关性。
6. **对抗性内容**：state 不默认视为恶意，注入文本可左右答案；criteria 要显式，上线前测对抗样本。
7. **instructions 与 criteria 矛盾会变差**：criteria 应视为 instruction 的延伸。
8. **跨题型概率不可比**：noul=0.22 vs 同义 Choice 的 P(yes)=0.01 实测并存；`P(refund)+P(not_refund)` 可为 1.19——勿跨题型搬阈值、勿假设恒等式。
9. **不能生成**：链式 Choice 逼它生成就又差又慢；抽取类任务应由 regex/生成模型出候选、Jev 挑选。

## 4. 官方生态地图

### 4.1 Cookbooks（17 篇，均带可跑代码与量化数据）

| 篇 | 一句话 | 题型组合 | 量化效果 |
| --- | --- | --- | --- |
| parallel_questions | 13 问合 1 请求 vs 拆 13 请求 | 混合 | 答案不变；**12.2× 便宜、10.0× 快** |
| rerank_typesafe | BM25 短名单后逐对 Noul 重排 | noul | top-1 5%→18%，top-10 38%→62% |
| llm_guardrails | LLM 输入/输出双向安检一次过 | 4 noul + 1 score | 10 prompt + 5 reply 全部正确分流 |
| function_calling | 闭集函数参数变 Choice + stated Noul | choice+noul | 10 函数 28 参数映射 |
| intent_routing(pattern) | 意图 Choice + 复杂度 Score 一请求 | choice+score | 低置信/高复杂度转人工，订单查询零 LLM |
| skill_suggestion | 从 182 个 agent 技能中渐进式选 1 | choice+noul 两跳 | 错载技能 16.8%→7.3% |
| classifying_rag_passages | 检索后 4 项体检：相关/证据/矛盾/注入 | 4 noul/passage | 排名第 1 的注入贴文被拦 |
| citation_check | 抓幻觉引用：字符串匹配 + 语境 Choice | choice | conf≥0.8 自动判定，4/4 植入失败全抓获 |
| classification_using_confidence | 75 类分类 + confidence 上卷宽标签 | choice | 自信半区 90% 对，总正确 39→48/60 |
| consistency_choice / consistency_noul | 同题 ×15 次稳定性 vs LLM | choice / noul | 标签复现率 90.8%（门控后 99.2%）；noul std 0.0102 低于所有 LLM |
| date_extraction | 模型抽部件、代码做日历 | 7 choice | 6 例全对；未提及的日期标 review 而非编造 |
| entity_alignment | 知识图谱对齐：Score 级即动作 | score+3 noul | 无阈值拟合，三动作路由 |
| hierarchical_classification | 深层级分类 beam 搜索 | choice/节点 | beam 4/4 vs greedy 2/4，并行问几乎不增延迟 |
| sde_cascade | 小模型抽取 + Jev 验错 + 触发才升级大模型 | noul 门控 | cascade 前沿压过所有单模型 |
| semantic_find | 218 行级语义搜索 + 无答案检测 | choice+noul | Noul exists 补 Choice「概率和恒为 1」的盲区 |
| pre_parsed_value_extraction | regex 出候选、Jev 只挑不造 | choice | 原样复制候选 span，杜绝编造 |
| autoformat | 纯文本重建 Markdown 结构 | noul+choice | 2 请求 0.8s $0.0003 |

### 4.2 Patterns（4 篇架构模式）

1. **Speculative fan-out**：一请求全发含投机问题（分支专属的），代码只读选中分支的答案——多余问题边际成本≈0，省一整轮往返。
2. **Confidence-gated routing**：答案说「做什么」，confidence 说「敢不敢」：只读操作低阈值即执行，高风险动作高阈值、否则反问用户。
3. **Composite scoring**：复杂判断拆多个独立 Score，代码归一化后按角色加权——一次回答服务多条下游。
4. **Intent routing**：意图分类 → 确定性代码 / 专家 LLM / 人工三路分流，中间不带含糊。

### 4.3 Agent skill

`typesafe-ai/skills`（Claude Code：`claude plugin marketplace add typesafe-ai/skills` + `claude plugin install typesafe@typesafe-ai`；其他 agent：`npx skills add typesafe-ai/skills --skill typesafe-ai`）。教学内容：识别「prompt-and-parse 能换成结构化决策」的位置；select-from-candidates 优于 generate；"Typed output guarantees the interface, not truth"。

### 4.4 参考实现 browser-use/jev-ultrafast（本地 `D:\<workdir>\jev-ultrafast\`）

总计 850 行 Python + 107 行 JS 的浏览器 agent，7.1 秒完成真实 Google Flights 搜索。架构五件套：

- **动态索引动作空间**（`model.py:action_space`）：每次观察生成编号元素表；一次 systemone 请求 = `operation` Choice + 每个可执行操作一个投机 `<op>_target` Choice。
- **响应校验**（`model.py:validate_choice`）：choice∈ids、概率键完备、[0,1] 有限、和≈1(±0.02)、choice 是 argmax；**只校验被选中操作的 target head**，未用的投机 head 不可能触发动作。
- **DOM 快照与节点身份**（`snapshot.js`）：WeakMap（节点→稳定 id）+ Map（id→活引用）；`marker` 语义指纹做新鲜度守卫，取代「数 DOM mutation」。
- **执行前安全检查**（`browser.py`）：isConnected、disabled、几何、遮挡检测（`elementFromPoint`）；**模型输出永远不成为 selector/坐标/JS**。
- **文本生成 cache**（`agent.py:106-118`）：TYPE_TEXT 才调小 LLM 生成字段值，输入指纹不变则复用，成功执行即失效。

实测（2026-09-21，中国网络直连无需代理）：英文 noul 1.45s / 中文 choice+noul 0.71s 均通；中文路由满 confidence 正确。

## 5. 设计规律（落地前记住的 8 条）

1. **原子化拆问 + 单请求批答**：一个模糊大判断拆成多个窄问题全塞一次请求；state 只发一份（batching 实测 12× 省钱 10× 提速）。
2. **模型判断、代码决策**：所有 if/阈值/权重/日历在代码；改政策=改常数，不是改 prompt；阈值可版本化、可 code review。
3. **probabilities/confidence 是一等接口**：门控转人工、降级回答（窄类上卷宽类，零第二跳）、组合置信度（取 min）。
4. **投机问题免费预取**：可能用不上的问题照发，代码按分支取用。
5. **代码先干粗活，模型只补语义**：字符串匹配、regex 候选、嵌入检索在代码侧；模型只答代码答不了的问题，且永远选不出候选外的值。
6. **每个闭集留逃生舱**：`none` / `out_of_range` / `uncertain`；Choice 配 Noul exists 补「无答案」盲区。
7. **题型对号入座**：闭集标签→Choice；P(yes)→Noul；有序等级且级即动作→Score。
8. **级联摊薄成本**：Jev 当路由/验证器/特征器，贵模型只处理被标记的少数样本；同一次回答喂多个下游。

## 6. Petri 接入点盘点（file:line 已核实）

排查范围：agent 聊天链路、MCP 工具层、前端 copilot、知识库、产品 skills、Result Studio、其他判断类逻辑。

### 6.1 适合落地的候选（按「落地价值 × 改造成本」排序）

| # | 决策点 | 位置 | 现状 | 题型 | 说明 |
| --- | --- | --- | --- | --- | --- |
| 1 | **copilot 话题漂移判断** | `core/petri-server/helpers/conversations.js`（`_maybeDetectTopicShift`，约 :222-251） | 每 5 条消息调大模型返回 `{"shifted": bool, "reason"}` JSON | **noul** | 现成大模型分类调用，Jev 毫秒级直替、契约一致、改动最小的 PoC 首选 |
| 2 | **知识库检索相关性重排/过滤** | `core/petri-server/helpers/knowledge-space.js`（`VECTOR_THRESHOLD=0.55` :32，过滤 :421，RRF 融合 :292-320） | 0.55 硬阈值 + 规则式 RRF，无语义二跳 | **noul/score** 对 top-K chunk | rerank cookbook 的 top-1/top-10 提升数据直接背书；顺带加注入检测 noul |
| 3 | **MCP 工具下发前预路由/裁剪** | `core/petri-server/agent-runner.js`（全量下发 :614；system prompt 硬编码 open_tool 映射 :490-495）；`agent-tools/tool-defs.js` ~70+ 工具 | 全量 function-calling defs 交大模型自选，仅 knowledge-console 一处白名单收窄 | **choice**（先选工具族再裁剪） | 降低 token 与误选率的最大杠杆；skill_suggestion cookbook 的两跳渐进披露可直接套用 |
| 4 | **marker→细胞类型判别** | `core/petri-server/helpers/interpret.js`（`CELL_MARKERS` :19，`lookupCellType` :52） | 硬编码基因组合规则表，无置信度、覆盖有限 | **choice/score**（候选=规则表命中的细胞类型） | 科学价值高、边界清晰；模型只挑不造，规则表继续当候选生成器 |
| 5 | **copilot 发送前意图路由** | `frontend/src/components/copilot/conversationRunStore.ts`（现状：发送前零预处理） | 一切决策都在后端大模型 | **choice**（闲聊/任务/知识问答/RS 操作） | 属新增能力：闲聊直答或检索分流，省一次大模型往返；注意前端不持 key，路由须在后端 |

### 6.2 评估过、明确不适合的

- loop 决策/修复策略（`loop-orchestrator.js`）与执行策略（`agent-execution-policy.js`）——确定性规则状态机，规则本身就是契约。
- `verify-dispatch.js` 的 verify_state 字段比对——确定性校验。
- 自动标题（`conversations.js`）与结果解读（`interpret.js` 的 `callDeepSeekSimple`）——生成类任务，非 Jev 范围。
- 产品 skills 匹配（`resources/skills/` 仅 3 个内置技能，`mcp/registry.js:151-166` 子串规则）——规模太小，不值得；技能库扩大后再评估。
- 敏感路径判断（`agent-tool-policy.js:108`）——规则明确。

### 6.3 工程前提（落地前必须满足）

1. **key 只放 core/petri-server 服务端**（进程内 env），绝不进前端/preload/desktopBridge——与 `quality:arch` IPC 边界纪律一致；现有 `callModelTask({role})`（`helpers/model-tasks.js:32`）是现成的任务调用口，Jev 可作为新 provider/role 接入 `model-gateway.js` 的 role→profile 路由 + fallback 体系。
2. **阈值用自有数据校准**：先画 confidence-accuracy 曲线再定门控线；pin `jev-1.13.0` 而非别名。
3. **中文 PoC 先行**：官方明示 CJK 非等效；候选点 1/2 的语料都在中文语境，先各跑 ≥100 条标注样本。
4. **降级路径**：Jev 不可用/超时时回退现行为（大模型分类/硬阈值），不得让决策 API 成为单点故障。
5. SDK 直连 HTTP 均可；Node 侧若引入 `@typesafe-ai/sdk` 需评估依赖（core 侧已有 httpx 风格的重试先例可对照自实现，cookbook 均为裸 HTTP 调用）。

## 7. 建议路线（供裁决，不构成承诺）

- **PoC（1 个候选点）**：话题漂移 noul 直替——改动面最小（单 helper 函数内），直接对比现有大模型分类的延迟/成本/一致性；同时用中文语料校准 noul 双阈值（如 YES=0.8 / NO=0.2，中间带维持现行为）。
- **第二批**：知识库 top-K 重排（每 chunk 一问 noul/score，K=6 规模成本可忽略）+ 注入检测；marker→细胞类型（规则表作候选生成器，Jev 补置信度）。
- **第三批**：工具预路由两跳（族 Choice → 子集下发），需先在 agent-runner 增加路由挂钩，改动面最大，放最后。
- 每批独立可回退，逐批进 roadmap 正式立项。

## 8. 本地资料索引与实测记录

- 文档镜像：`D:\<workdir>\typesafe-docs\`（109 篇 .md，含全部 cookbook/pattern/sdk/api；索引 `llms.txt`）。
- 参考实现：`D:\<workdir>\jev-ultrafast\`（browser-use/jev-ultrafast @ 1231850）。
- 实测记录（2026-09-21，直连）：① 英文 urgency noul → 0.98（301 in/23 out tok）；② 中文客服消息 choice+noul → route=technical confidence 1.0、urgent=0.98（433 in/56 out tok）；③ GET /v1/models → jev-latest / jev-preview（均指 jev-1.13.0，2026-09-10 发布）。
- 安全注记：测试所用 API key 曾在会话中明文出现，已建议在 console.typesafe.ai 撤销轮换；**本仓库任何文件不得写入真实 key**（`quality:secret` 门禁 fail-closed）。
