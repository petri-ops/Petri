---
capability: block506-large-context-benchmark-research
status: active
phase: MATERIAL
goal: 大上下文处理对标研究（用户发令「ZCode 或 deepseek harness 是这么做的吗？理清楚并学习」）——回答三问：①Petri 需要做什么吗 ②「大上下文拆两步喂」能安排吗 ③ZCode/deepseek harness 怎么做的。结论：Petri 四件套已在册且经实测校准（分页读取/microcompact/auto-compact/流式看门狗），停滞根因=provider 直连中途停摆（BLOCK-505 已核实）非缺机制；唯一值得列的产品增强候选=「读→摘要委托子 agent 化」（对标 ZCode Explore 模式），pending_user_ruling，建议先观察频率再裁决。
acceptance:
  - 对标事实分层标注：ZCode harness 一手观察（本会话即运行于该 harness，可观察其工具行为）/ deepseek 侧公开机制（prefix caching）/ Petri 代码现读（行号在案）——不冒充、不臆断
  - Petri 现状四件套逐一给代码锚（workspace-tools.js:20-21 / agent-resilience.js microcompact / D3 阈值公式注释自证对标 / stream-stall-watchdog.js 全文）
  - 缺口与候选分级（P0 已落提示词纪律/P1 子 agent 读摘要委托候选 pending/P2 无需动），裁决点显式列出不代答
  - docs 门禁 + closeout 定向 + 六件套 + commit/push；docs-only 零运行时
reopen: 停滞频率数据积累后裁决是否立项 P1；ZCode/deepseek 机制有新事实时更新对标
supersedes: 无（研究材料；BLOCK-505 提示词纪律为其 P0 层落地）
---

# BLOCK-506 · 大上下文处理对标研究（ZCode/deepseek harness 怎么做 · Petri 学什么）

日期：2026-11-19 · 触发：用户三问「Petri 需要做什么吗 / 拆两步喂能安排吗 / ZCode 或 deepseek harness 是这么做的吗？理清楚并学习」· 前置：[BLOCK-505 根因核实](./block505-review-prompts-2026-11-19.md)（停滞=deepseek 直连对超大上下文请求的中途停摆，三层直连豁免已在位，非代理问题）

## 0. 一句话结论

**Petri 不缺大上下文的基础机制**——分页读取、microcompact、auto-compact、流式看门狗四件套全部在册且其中两项经真实事故校准；「人工拆两步喂提示词」是这四件套之外的**规避手段**（已落 BLOCK-505 纪律层），不是缺陷补偿。对标后唯一的实质性产品缺口是「**读→摘要委托子 agent**」（ZCode Explore 模式）：主上下文只收摘要、重读任务派出去——列为候选 P1，**建议先积累停滞频率数据再裁决是否立项**（直连后的频率尚未定型）。

## 1. Petri 现状（四件套 · 代码现读锚）

| 机制 | Petri 形态 | 代码锚 | 对标状态 |
| --- | --- | --- | --- |
| 分页读取护栏 | read_file 默认 240 行/上限 1000 行，单行 500 字符截断 | `agent-tools/workspace-tools.js:20-21,323,363` | ✅ 已有（对标 Read offset/limit，Petri 更保守） |
| microcompact | 接近窗口时折叠旧消息组 | `helpers/agent-resilience.js` maybeMicrocompactBody（BLOCK-98） | ✅ 已有 |
| auto-compact | 阈值公式化（有效窗口−min(21K,maxOutput)−min(13K,8%)）+ 9 章节摘要模板 | `helpers/agent-resilience.js`（D3 注释自证「ZCode 200K 常数不硬抄」——**已对标过一轮**） | ✅ 已有且本地化 |
| 流式看门狗 | 90s 首 token / 60s 连续无 token 两段；心跳不续命；reasoning_delta 续命；零可见输出自动重试一次 | `llm-providers/stream-stall-watchdog.js` 全文（BLOCK-338，注释含 2026-11-05 误杀校准案底） | ✅ 已有且实测校准 |

## 2. 对标学习（分层标注置信度）

### ZCode harness（一手观察 · 本会话即运行于该 harness）

| # | 机制 | 观察 | 置信度 |
| --- | --- | --- | --- |
| Z1 | Read 工具分页：默认 2000 行上限 + offset/limit 参数 | 第一手（本会话工具行为） | 高 |
| Z2 | **重读委托子 agent（Explore 模式）**：大文件/大面积检索派子 agent，子 agent 自带独立上下文读原文，主上下文只收其结论摘要 | 第一手（本会话即有该 agent 类型可用） | 高 |
| Z3 | auto-compact：接近窗口自动「compacting conversation」摘要折叠 | 第一手（会话内可见行为） | 高 |
| Z4 | 模型流停滞时中止+保留工具结果+提示重试 | 第一手（本项目会话多次观察到其保护行为） | 高 |

→ **映射**：Z1↔Petri 分页读取（已有）；Z3↔Petri auto-compact（已有）；Z4↔Petri 流式看门狗（已有且更精细——两段式+封闭续命集）；**Z2 是 Petri 未见的唯一形态**（`sideTask`/`subAgent` 于 core 零检索命中；BLOCK-244 A7 sideTask 曾交付但形态与存续待查）。

### DeepSeek 侧（公开机制 · 二手）

| # | 机制 | 说明 | 置信度 |
| --- | --- | --- | --- |
| D1 | 自动前缀缓存（prefix caching） | 相同前缀的重复请求命中缓存，大 prefill 重试成本大降——与 Petri「零可见输出自动重试一次」天然配合，重试已是最小成本 | 中（公开文档级，未实测） |
| D2 | 推理模型思考期只发 reasoning_delta | Petri 看门狗已续命该事件（2026-11-05 校准）；思考期不再有静默误杀 | 高（有校准案底） |
| D3 | 服务端偶发中途停摆 | 本次停滞的核实根因（直连状态下同位重复出现）；客户端无法治，只能重试/换渠道/报渠道方 | 高（本会话实测） |

## 3. 缺口与候选分级（裁决点 · 不代答）

| 级别 | 内容 | 价值(V)/风险(R)/成本(C)/依赖(D) | 建议 |
| --- | --- | --- | --- |
| **P0** | 提示词纪律：大读取任务拆两步喂（已落 [BLOCK-505](./block505-review-prompts-2026-11-19.md) 注记） | V=立即可用降低 prefill 暴露 / R=零 / C=零 / D=无 | ✅ 已落地，无需再动 |
| **P1（候选）** | **读→摘要委托子 agent 化**（对标 Z2 Explore）：重读任务派子 agent，主上下文只收摘要 | V=主上下文持续瘦身、间接降低大 prefill 暴露频率（对标不改魂：摘要回传本身就是可审计的本地产物）/ R=子 agent 结果保真边界需设计（摘要丢失原文细节）/ C=中等（复用既有任务派生面，1-2 票）/ D=需先核实 BLOCK-244 A7 sideTask 存续形态 | **pending_user_ruling——建议先观察直连后的停滞频率，频繁再立项** |
| P1'（候选） | 渠道 fallback 策略：反复 stream_stalled 时自动/半自动切 sensenova 或本地渠道 | V=停滞体验兜底 / R=失败语义与成本语义需裁决 / C=中等 / D=无 | pending_user_ruling（与前项互斥可并行，二选一即可） |
| P2 | 分页/压缩/看门狗 | — | ✅ 已存在，无需动（不要为「展示架构」重做健康部位） |

## 4. 学习结论（回答三问）

1. **Petri 需要做什么吗？** 修复层面**不需要**——四件套齐、两次实测校准、停滞根因已核实为 provider 直连中途停摆（非缺机制）。产品增强层面只有 P1/P1' 两个候选，**建议先观察频率再裁决**。
2. **「拆两步喂」能安排吗？** 已安排——P0 层落在 BLOCK-505 纪律注记（提示词设计层），零代码。它是 Z2 缺位时的手工补救，不是长期方案。
3. **ZCode/deepseek 是这么做的吗？** ZCode 靠 Z1-Z4 四件套制度化（其中 Z2 子 agent 委托是 Petri 唯一缺的形态）；deepseek 靠 D1 缓存（帮重试）+ D3 服务端稳定性（帮不了，只能绕）。Petri 的四件套与 ZCode 的 Z1/Z3/Z4 一一同构且各有本地化改造（阈值公式化、封闭续命集、两段式判死）——**「借形不改魂」在基础设施层已经成立**。

G0 开发期常态 · 不外推 packaged/Provider/GA。
