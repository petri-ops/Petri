# BLOCK-81 — Composer 思考级别（供应商推理档位）+ 供应商设置页 Endpoint 网格修复

> 状态：`active`（2026-09-11 立项；同日用户裁决「冲」→ P0-LAUNCH，先做 UI-342 endpoint 网格修复）
> 立项日期：2026-09-11
> truthDomain: `block-81-thinking-level-endpoint`
> 来源：用户提问「如果用 zcode 会显示供应商模型提供的思考级别，我们的项目没有这种思考级别的选项，你能调研一下怎么回事，可以补充吗？另外供应商的设置界面有细节上的瑕疵——Base URL 输入窗口有些宽了，连通性测试下面有些窄了，导致文字重合。整体再看一下，可以立个新的 block?」

## 1. 立项来源与用户诉求

- **诉求 A（思考级别）**：ZCode composer 有「思考级别 Ctrl+T」控件（🧠 开启 ⌄），我方 composer 没有；要求调研原理并评估补充。
- **诉求 B（设置页瑕疵）**：设置页「API Endpoint」渠道行布局缺陷——Base URL 输入过宽、连通性测试列过窄导致文字重合（截图实锤：「已连接」在面板右缘被裁切；删除垃圾桶图标每行独占一行）。
- 用户裁决原话：**「整体再看一下 可以立个新的block?」**——按单包收纳，本计划即承载面。

## 2. 调研结论 A：ZCode 思考级别是怎么回事（2026-09-11 核实）

**原理**：思考级别不是模型"显示"出来的，是**客户端控件 + 请求参数映射**——客户端知道当前模型是否支持推理（能力元数据），支持才渲染档位控件；用户选中的档位随每次请求映射为该供应商 API 的思考参数发出。各上游参数形状不同：

| 上游 | 思考参数 | 形状 |
|---|---|---|
| OpenAI 兼容（GPT-o 系/中转通用） | `reasoning_effort` | `"low" \| "medium" \| "high"`（新系含 `minimal`） |
| GLM 开放平台 | `thinking` | `{"type": "enabled" \| "disabled"}` |
| Qwen / DashScope | `enable_thinking` | `true \| false`（Hybrid 思考模型） |
| Anthropic 协议 | `thinking` | `{"type": "enabled", "budget_tokens": N}` |
| DeepSeek 官方 | 无参数 | 思考 = 独立模型 `deepseek-reasoner`，非请求参数 |

**我方现状（HEAD 面代码事实）**：

- **展示侧已就绪**：UI-272 已渲染 `reasoning_content` 思考段——`copilotClient.ts:1106-1109` 解析流式 `delta.reasoning_content` → `conversationRunStore.ts:599-606` 按迭代聚合 `reasoningByIteration` → 随消息展示并经 meta 持久化。上游自己开了思考时我方已能显示。
- **请求侧全缺**：全仓无 `reasoning_effort` / `enable_thinking` / `thinking` 请求参数（grep 实证）；agent 请求体固定 `temperature: 0.4 + max_tokens: 16384`（`core/biof3-server/routes/ai-agent/chat.js:655-666`）。这就是「没有这种选项」的直接原因。
- **管道已通（关键利好）**：请求体一路透传——`ai-agent/chat.js` 构造 `reqBody` → 网关合并 `...(profile.parameters) ...(body)`（`core/shared-backend/llm-providers/model-gateway.js:181-185`）→ deepseek 适配层 `...(body)` 展开（`deepseek.js:267-277`）→ 上游。**只要 body 带上思考参数就会直达上游，后端无需新建链路**。anthropic / dashscope 适配层同构需逐一核对。
- **能力位已有**：`MODEL_CAPABILITIES` 含 `'reasoning'`（`model-profile.js:18`），渠道可声明；用户截图 4 渠道全走 OpenAI 兼容协议（DeepSeek 系 / gemini 系中转 / GLM 系 scnet / sensenova），上游思考参数各异。
- **可行性结论：可以补充，量级中小**（对标 BLOCK-79 当日包体量）；风险集中在「各上游参数名不一 + 严格网关对未知参数 400」。

## 3. 调研结论 B：Endpoint 网格缺陷根因（UI-342，已实锤）

**根因 = 8 个内容元素 vs 7 条网格列定义**：

- 表头 8 个 span：协议/供应商/Base URL/Key/默认模型/上下文/连通性/空（`DesktopSettingsPanel.tsx:575-584`）；
- 渠道行 8 个子元素：select/input/input/key-field/select/input/测试按钮/删除按钮（`:615-747`）；
- 但 `grid-template-columns` 只定义 **7 列**：`0.9fr/0.75fr/2fr/1.25fr/1.25fr/96px/32px`（`desktop.css:565-572`）。

**后果链**：第 7 列（32px，原删除列位）被「连通性」测试按钮占用 → `已连接` 文字在 32px 轨道里溢出/重合（截图右缘裁切实锤）；第 8 个元素（删除按钮）自动放置换行到下一行行首 → 垃圾桶每行独占一行；表头「连通性」标签同样压在 32px 窄列上。

**修复方向**：显式 8 列 + 宽度再平衡——Base URL 从 `2fr` 收窄（用户点名过宽），连通性列给足 `~84px`（容纳 ✓已连接），删除 `32px` 独立成列，`min-width: 1040px` 随 8 列复核微调。纯 CSS 一处 + 台账回写。

## 4. 设计裁决 D1-D7（✅ 2026-09-11 用户裁决确认，可进 P1）

- **D1 档位集合与命名** ✅ **裁决：三档「关闭 / 标准 / 高」**（默认=标准且不发任何参数，行为零变化；需思考才发参）。备选「对齐 ZCode 两态」未采纳。
- **D2 协议映射表** ⏳：中性档位 → 上游参数的映射落在后端单点（`ai-agent/chat.js` reqBody 构造处或 provider 层）；初版映射=§2 表。DeepSeek 原生渠道诚实降级：无思考参数可发（reasoner 是独立模型），控件对该渠道隐藏或提示「切换模型」。
- **D3 容错策略** ⏳：双保险——①仅对声明 `capabilities.reasoning` 的渠道默认发参；②上游 400 且错误文案含 unknown/invalid parameter 关键词时，去参重试一次（与既有 fallback 链不叠加，去参重试优先）。
- **D4 持久化层级** ✅ **裁决：会话级**（composer 控件即会话态，随会话恢复；对齐 ZCode 体感）；渠道级默认（`profile.parameters`）作后续候选不进本期。
- **D5 UI 形态** ✅ **裁决：composer `sc-model-picker-pair` 旁新增档位按钮**（brain icon + 当前档位 + ⌄ 菜单），`composerNarrow` 降级为纯图标；快捷键 Ctrl+T 对齐 ZCode 习惯。
- **D6 思考段展示** ⏳：默认沿用 UI-272 展示面零改动；实机若发现思考段过长干扰阅读，再加折叠策略（不进本期承诺）。
- **D7 网格列宽终值**（UI-342 内部裁决，无需用户）：8 列显式定义 + §3 修复方向的具体数值。✅ 已落地（`5b3b677c`，flow `ui342-endpoint-grid` 实机 6/6）。
- **D8 设置页窄容器自适应** ✅ **裁决：两行式自适应**（用户 2026-09-11；不收起左栏/右栏）——P0 实机发现设置面板与左右栏共用宽度，`<1058px` 容器下 8 列表格需横向滚动；改为**容器查询**驱动的两行式堆叠布局（每格显示自身标签），宽容器仍为 8 列表格。登记为 **UI-344**。

## 5. 阶段划分（P0–P3 串行，每阶段独立提交 + 定向测试）

| 阶段 | 内容 | 出口 |
|---|---|---|
| **P0 抓真修 + 裁决** | ① UI-342 endpoint 网格修复（独立小提交：8 列显式 + Base URL 收窄 + 连通性列加宽，实机截图核验列对齐）；② D1-D6 裁决落表呈用户 | 网格实机核验过；裁决确认 |
| **P1 后端透传 + 映射 + 容错** | ① `/api/ai/agent` 请求体增 `thinkingLevel` 中性字段（additive，缺省不发参零行为变化）；② D2 映射表落后端单点；③ D3 容错（400 去参重试一次）；④ anthropic/dashscope 适配层透传核对 | 后端定向测试绿；不发参路径零回归 |
| **P2 composer 控件** | UI-343：D5 档位按钮 + 菜单 + Ctrl+T + 会话级持久化（D4）+ 不支持渠道隐藏/降级；`composerNarrow` 图标态 | 控件在真实多渠道配置下表现正确 |
| **P3 实机验收 + 收口** | 真实渠道 开/关 思考对比：`reasoning_content` 出现与内容差异、400 容错路径触发、UI-272 展示面核对；UI 台账回写；整包收口 | 验收证据 `acceptance/block-81/` + completed |

## 6. 非范围（exclusions）

- 不做思考预算数值级滑杆（`budget_tokens` 自定义数值）——只做档位枚举。
- 不做渠道级/全局级思考默认值管理面（`profile.parameters` 直编辑属既有设置面，后续候选）。
- 不做流式思考段的新展示设计（沿用 UI-272；折叠策略如需另立加映）。
- 不新增 npm 依赖。
- 不外推 packaged/Provider/GA（G0 纪律）。

## 7. 依赖与协同

- 无硬前置；按单工作包串行纪律排队（当前无 active 包，队列候选 BLOCK-70/AGENT-WORKBENCH/G0-RS/G0-SDC 并存，启动顺序待用户裁决）。
- UI-272（reasoning_content 展示）是消费面前提，已 completed，本包只喂流量不改其契约。

## 8. 验收门

- P0：endpoint 网格实机截图核验（8 列对齐、无文字重合、无垃圾桶换行）+ `model-endpoint-transfer.test.ts` 回归。
- P1：后端定向测试（映射表/容错/缺省零变化三面）+ `tsc` 0。
- P2：composer 组件定向测试 + `tsc` 0。
- P3：实机断言（真实渠道开/关思考对比）落 `acceptance/block-81/`；UI-342/343 台账同提交回写；`npm run docs:check` + `npm run ui:audit:check`。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| 各上游思考参数名/形状不一，映射错发 | D2 映射表后端单点 + 定向测试锁定；未识别渠道默认不发参 |
| 严格网关对未知参数 400 | D3 去参重试一次 + 仅 reasoning 声明渠道发参双保险 |
| DeepSeek 原生无思考参数被误当缺陷 | D2 诚实降级：控件隐藏或「切换 deepseek-reasoner」提示 |
| 思考开启后思考段刷屏 | D6 默认沿用 UI-272，超长折叠留加映口 |
| 发参改变既有会话行为 | 缺省档=不发参数，请求体逐字节零变化；定向测试锁定缺省路径 |

## 10. 治理边界

- 单一真相：思考档位只有会话态一处（D4 裁决后落定），不建第二份档位存储；映射表只在后端单点。
- additive 红线：不发参路径请求体零变化；既有 UI-272 契约零改动。
- 启动前置：无 🔴 阻塞；workspace 干净；当前无 active 包。

## 11. 进度记录

- 2026-09-11 **P1 切片 2：渠道级 reasoning 声明面（UI-343）落地**：用户裁决「渠道级开关」——endpoint 网格新增第 9 列「思考」复选框（读写 `profile.capabilities` 的 `reasoning`），列宽 minmax(72px,0.55fr)，表头/渠道行 min-width 与容器查询阈值同步 1060→1146；flow `ui342-endpoint-grid` 改为自适应推导（列数/标签数/形态判据全部实测，形态用轨道数判定），实机双形态各 6/6。**P1 剩余**：注入点接线（ai-agent/chat.js reqBody + copilot chat 路径）+ 400 去参重试落地。G0 开发期常态 · 不外推 packaged/Provider/GA.
- 2026-09-11 **P0 出口达成 + P1 切片 1（映射内核）落地**：① P0＝UI-342 网格修复（8 列显式，实机 6/6，`5b3b677c`）+ UI-344 窄容器两行式自适应（容器查询 + 标签 span，实机双形态 6/6+6/6，`280cb42c`；用户裁决「改布局而非收侧栏」）；D1/D4/D5 用户裁决确认（三档「关闭/标准/高」/ 会话级 / 模型选择器旁+Ctrl+T），D8 新增。② P1 切片 1＝**思考档位映射内核** `core/shared-backend/llm-providers/thinking-level.js`（单一映射点：中性档位 → 上游参数；`standard`＝不发参数保证零行为变化；能力门控 `capabilities.reasoning`；按 **protocol** 映射 openai-compatible→`reasoning_effort` / anthropic-messages→`thinking` / dashscope-native→`enable_thinking`）+ `isUnknownParameterError()` 去参重试判据（正反例覆盖，避免把鉴权/额度/模型不存在误判为参数问题）+ 定向测试 `test/thinking-level.test.mjs` **8/8**；impact-map 新增 `block81-thinking-level` 规则。**诚实边界（写进代码注释）**：OpenAI 兼容协议无真「关闭」档（off→`minimal`）；GLM 系 `thinking:{type}` 形状经 OpenAI 兼容接入时无法从协议识别 → 靠 D3 去参重试兜底（待渠道级「思考参数形状」声明根治）。③ **P1 剩余（下一步）**：注入点接线（`routes/ai-agent/chat.js:655` 与 copilot chat 路径的 reqBody）+ 400 去参重试落地 + **渠道级 reasoning 能力位声明面**（P0 实机发现：`capabilities.reasoning` 目前 UI 无处声明 → 控件将永不出现，需在 endpoint 网格加「支持思考档位」开关，与 P2/UI-343 协同）。G0 开发期常态 · 不外推 packaged/Provider/GA.
- 2026-09-11 **立项登记（planned）**：用户两截图提问（ZCode 思考级别 + 设置页布局瑕疵）→ 主 Agent 调研核实：①思考级别=客户端控件+请求参数映射，我方展示侧 UI-272 已就绪、请求侧全缺、但网关→provider 透传管道已通（`model-gateway.js:181` + `deepseek.js:267`），补齐=控件+映射+容错，量级中小；②endpoint 网格 8 元素 vs 7 列定义实锤（`desktop.css:565-572`），连通性挤 32px 窄列文字重合、删除按钮换行。D1-D7 待 P0 评审。plan + DOC-REGISTRY planned + README 112 + roadmap。G0 开发期常态 · 不外推 packaged/Provider/GA。
