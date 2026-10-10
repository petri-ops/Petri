# BLOCK-112-COPILOT-INTENT-ROUTING 计划：copilot 发送前意图路由（决策内化弧 W1-2）

**Plan ID**：`BLOCK-112-COPILOT-INTENT-ROUTING`
**状态**：`completed（2026-09-22 当日立项当日收口：P0 校准 gate.passed（117 条四类语料，overall argmax 98.3%、θ=0.70 chitchat recall/precision 1.0、task 零误采纳、P50 277ms）→ P1 提交链挂钩+chitchat 快路径（契约 13/13）→ P2 实机 flow block112-intent-live 6/6（闲聊快路径 delta 无工具事件+回复落库标记 / 任务正常 loop）；closeout 十门全绿。D-1~D-5 按推荐定版；弧线底稿=docs/planning/decision-primitive-internalization-arc.md §W1）`
**立项日期**：2026-09-22
**最后更新**：2026-09-22（整包收口 completed，closeout 十门全绿；快路径回复 meta.chitchatFastPath 权威标记；两次提交复用活跃会话语义已实测确认（flow 清理幂等）。立项登记 active/P0-LAUNCH。队列次序=arc §W1 预登记：1 marker（BLOCK-111 已 completed）→ 2 本包 → 3 工具预路由 → 4 测试归因 → 5 增量测试选择。）
**责任轨道**：BLOCK（后端提交链挂钩 + 决策接点校准 + chitchat 快路径新增面，跨 P 阶段串行）
**上游文档**：`docs/planning/decision-primitive-internalization-arc.md` §W1-2 · `docs/planning/typesafe-jev-system-one-research.md` §6.1 #5 · W1-1 载体 `docs/block-111-jev-w1-marker-classification-plan.md`（wrapper/校准方法论复用）

## 0. 立项来源与用户裁决留痕

- 弧线规划（2026-09-21）：用户「判断的思想引入了 后期必然要内化进项目的 早点做规划」。
- W1-1 收口（2026-09-22）：BLOCK-111 当日整包 completed（closeout 十门全绿）。
- **本包启动裁决（2026-09-22）**：用户裁决原话「开 按顺序都做完」——W1 队列 2~5 点全数授权，按 arc §W1 预登记顺序逐点串行立项；每点仍走完整立项/校准/收口。

## 1. 范围与非范围

### 1.1 范围（in-scope）

研究底稿 §6.1 #5：copilot 发送前意图路由——现状发送链（`routes/ai-agent/chat.js` POST /api/ai/agent）零预处理，一切判断交给 agent loop 大模型。本包在提交链挂钩决策原语（choice 四类意图分类），并对「闲聊陪伴」类消息提供**轻量直答快路径**（省 agent loop 一次带全量工具/系统提示词的大模型往返）；其余类维持现行为。

| 阶段 | 内容 | 核心落点 |
| --- | --- | --- |
| P0 | 意图语料 + choice 校准 | 中文用户消息语料 ≥100 条（四类标注，构建法见 §3 D-2）+ confidence-accuracy 曲线 + θ 初值 + D 项评审；证据 `acceptance/block-112/` |
| P1 | 提交链挂钩 + chitchat 快路径 | `core/petri-server/helpers/intent-router.js`（决策接点，唯一接入 askDecision）+ `routes/ai-agent/chat.js` 分支（guard 显式开 + 门控采纳才分流）+ `helpers/chitchat-fast-path.js`（callModelTask 直答 → run_started/delta 事件回放 → markAgentTaskDone → 会话落库）；降级五态测试钉住 |
| P2 | 实机验收 + 收口 | dev-verify flow `block112-intent-live`（真实 Jev：闲聊走快路径 delta+done、任务走正常 loop、杀开关全走 loop）+ closeout 十门 |

**快路径事件契约（逐字镜像 agent-runner 已有形状，零前端改动）**：
`appendAgentTaskEvent(taskId, 1, 'run_started', {event:'run_started', taskId, kind, at})` →
`appendAgentTaskEvent(taskId, 2, 'delta', {choices:[{delta:{content: reply}}]})` →
`markAgentTaskDone(taskId)`。SSE 订阅端按既有终态机制收 done+[DONE]；会话 assistant 消息照常落库。

### 1.2 非范围（exclusions）

- **task/knowledge_qa/result_studio 三类不改变行为**——PoC 动作只对 chitchat 生效；三类分类结果仅进校准证据与观测，类目分流动作（如知识问答检索分流）留后续逐项裁决。
- 不做流式直答（v1 单 delta 非流式；流式留后续）。
- 不动 agent loop / history-assembly / 前端发送链（`conversationRunStore` 零触碰——研究底稿指出的挂点在**后端侧**，前端不持 key 红线）。
- 不动 legacy 分支（410 已退役面）。
- W1 队列 3~5 点各自独立立项。

## 2. 现状与目标

- 现状：每条消息（含「你好」「谢谢」）都创建 agent task → runAgentLoop 全量系统提示词 + 74 工具 defs + 全历史 → 大模型一次往返。闲聊陪伴类消息付出等价任务执行的 token/延迟成本。
- 目标：guard 开启时，提交链先经决策原语四类分类；`chitchat` 且 confidence ≥ θ 才进入快路径（小系统提示词 + 尾部历史 ≤8 条 + 无工具的直答），其余一律现行链。guard 关/缺 key/分类失败/低置信 → 零行为变化。

## 3. P0 预登记裁决项（D-1~D-5，均有推荐）

- **D-1 类目集**：choice 四类 `chitchat`（闲聊寒暄/情绪陪伴/身份问答/致谢）/ `task`（分析执行/代码/文件/跑流程）/ `knowledge_qa`（概念/方法/领域知识问答）/ `result_studio`（结果库与 RS 面板操作指令）。推荐：四类定版（类目集为包内契约；动作面 PoC 只挂 chitchat）。
- **D-2 分类 state**：仅最近一条用户消息（trim ≤600 字），不含历史——v1 最小面（省 token；边界=指代延续消息分类难度上升，靠 θ 门控兜底）。推荐照此。
- **D-3 门控阈值**：单阈值 θ（confidence ≥ θ 且 argmax=chitchat 才分流）。P0 曲线定初值；预期偏保守（θ≈0.85——误路由代价=真任务被直答，属用户可见伤害；漏路由代价=多花一次往返，无害）。推荐：θ 取 corpus 内「task 类零误采纳」的最高覆盖档。
- **D-4 默认开关位**：默认关 + 显式开 `PETRI_JEV_INTENT_ROUTE=1`（同 W1-1/W0-P2 先例；本接点误路由直接改变用户可见行为，必须保守侧）。推荐照此；P2 实机零回归后翻默认另行裁决。
- **D-5 快路径直答形态**：`callModelTask({role:'explanation'})` 非流式单次调用（复用既有任务通道与模型设置），系统提示词=轻量陪伴面（格物助手身份+简洁中文+无工具），历史取 effectiveMessages 尾部 ≤8 条。推荐照此；流式直答另裁。

## 4. 关闭语义

- 正常完成：P0 证据门 → P1 → P2 实机 + closeout 十门 → completed。
- **PoC 失败语义（诚实收缩）**：P0 校准不达标（overall argmax accuracy < 0.80 或 θ 下 chitchat 采纳精度 < 0.95 或 task 误采纳 > 0）→ 本包收缩关闭，仅冻结 W1-2 点（弧线其余点不受影响）；负结果登记回 arc。
- key 失效/供给不可用：降级契约回退现行为，本包转 🟡 延期。

## 5. 验收门禁清单

| 门禁 | 预期 |
| --- | --- |
| P0 校准证据 | `acceptance/block-112/calibration.json`（≥100 样本四类，argmax accuracy/θ 曲线/chitchat 采纳精度/task 误采纳计数）+ 语料入库 |
| P1 契约测试 | `test/block112-intent-routing.test.mjs`：分类接点降级五态（guard 关零出站/no_key/timeout/校验失败/低置信→一律走现行 loop）/快路径事件契约（run_started→delta→markAgentTaskDone 顺序与载荷形状）/会话 assistant 落库/并发槽释放/错误回退 loop |
| P2 实机 | dev-verify flow `block112-intent-live`：真实 Jev 分类 + 真实模型直答——闲聊消息产出快路径 task（delta 文本在场 + 任务 done + 会话落库）且不带工具往返、任务消息走正常 agent loop（工具事件在册）、杀开关下全部走 loop；证据 `acceptance/block-112/` |
| 收口链 | `npm run closeout` 十门全绿；impact-map 登记 `block112-copilot-intent` 规则；UI 台账零登记（无 UI 行为变化面——快路径呈现复用既有 task 时间线） |

**预期节奏**：P0+P1 一次会话、P2 同会话收口（对标 BLOCK-111 当日节奏）。

## 6. 红线与风险

- 决策必经 `helpers/decision-api.js`（pin jev-1.13.0）；key 不入仓。
- **guard 关=提交链逐字节等价**（分类调用零发生）；任何降级形态回退现行 runAgentLoop，提交端点永不因决策 API 失败而失败。
- 快路径不绕过任何既有安全面：任务仍走 createAgentTask/并发槽/会话归属（联邦委托、subagent 校验等提交链前置检查全部先于分类分支执行）。
- 风险：闲聊/任务边界模糊语料（语料构建显式含边界样本并定 gold 判据）；中文 CJK 短板（语料全中文实测）；快路径直答质量（P2 实机人工核看直答文本；不达预期=诚实收缩只关动作面、分类证据保留）。
