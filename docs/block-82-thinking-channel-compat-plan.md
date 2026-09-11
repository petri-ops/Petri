# BLOCK-82-THINKING-CHANNEL-COMPAT · 思考渠道兼容（sensenova reasoning 字段归一 + 能力位闭环）

> 状态：`completed`（P0–P3 当日完成 · 2026-09-12）
> 依据：BLOCK-81 遗留候选（`docs/block-81-thinking-level-endpoint-plan.md` notes）+ P3 渠道 probe 实机证据（`acceptance/block-81/block-81-p3-channel-probe-live.json`）
> truthDomain：`block-82-thinking-channel-compat`

## 1. 背景与依据（代码事实）

BLOCK-81 P3 渠道 probe 实测（2026-09-11）：sensenova（`token.sensenova.cn/v1`，sensenova-6.8-flash-lite）
**接受 `reasoning_effort` 参数**（200，high 档思考更活跃 finishReason=length），但其上游思考段
字段名为 **`reasoning`**，而我方解析面只认 `reasoning_content` → sensenova 渠道思考段整段丢失。

解析面断点（本包修复对象，共 3 处，全在 OpenAI 兼容路径）：

| 位置 | 现状 | 影响 |
| --- | --- | --- |
| `core/shared-backend/llm-providers/deepseek.js` 流式 delta（~L395） | 只认 `delta.reasoning_content` | sensenova 流式思考段丢弃 |
| `core/shared-backend/llm-providers/deepseek.js` 非流式信封（~L374） | 只认 `message.reasoning_content` | sensenova 非流式思考段丢弃 |
| `core/shared-backend/llm-providers/io-transcript.js` L61 | 只认 `message.reasoning_content` | io-transcript 记录面丢失 |

请求侧断点：dev 栈 `ai-settings.json` 中 sensenova profile `capabilities=["chat","streaming","tools"]`
**未声明 `reasoning` 能力位** → `thinkingParamsFor` 能力位门控（thinking-level.js L71）不发参。
probe 已实测该渠道接受参数，开启有据。

## 2. 范围

**范围内**：
1. 解析归一：上述 3 处 `reasoning_content` 解析点增加 `reasoning` fallback（**`reasoning_content` 优先**，
   缺失才取 `reasoning`；后端归一后照旧 emit `reasoning_content`，前端/下游零改动）。
2. dev 栈 sensenova profile 能力位补 `reasoning`（有 probe 证据支撑的配置改进；改动可逆、如实登记）。
3. 契约测试：归一规则单测（优先级/fallback/双字段并存）+ 既有 thinking-level 测试回归。
4. 实机验收：sensenova 真渠道两档对比（standard=零思考参数；high=发参且思考段被归一解析、
   前端思考行可见），验收脚本与证据落 `acceptance/block-82/`。

**范围外（登记候选，不动）**：
- 思考行渲染位置（当前仅挂执行记录内）——UI 展示设计需用户裁决。
- 其他渠道思考参数形状（GLM 系 `thinking:{type}`，BLOCK-81 已登记渠道级声明候选）。
- Anthropic / dashscope-native 路径（本包只动 OpenAI 兼容路径，三处断点均在该路径）。
- 新 npm 依赖：0。

## 3. 阶段

| 阶段 | 内容 | 门禁 |
| --- | --- | --- |
| P0 | 立项：plan + DOC-REGISTRY + AUDIT-LOG 启动行 | docs:check |
| P1 | 解析归一 3 处 + 契约测试 | 定向测试全绿 + tsc 0 |
| P2 | 实机验收：dev 栈 + sensenova 真渠道两档对比 | flow allPass + 证据落盘 |
| P3 | 收口：closeout + canonical 回写 | npm run closeout 全绿 |

## 4. 验收标准

- sensenova 渠道：standard 档请求体零思考参数（additive 红线不变）；high 档上游收到
  `reasoning_effort: high` 且**思考段以 `reasoning_content` 形态完整到达前端**（归一生效）。
- deepseek 渠道回归：`reasoning_content` 主路径行为零变化（优先级单测覆盖）。
- 治理门禁：`npm run closeout`（hygiene → docs:check → ui:audit:check → test:changed）。
- 本包不涉 UI 代码改动 → 无新 UI-### 编号；dev Electron 边界内 verified 为当前阶段最高证据等级。

## 5. 进度记录

- 2026-09-12 **整包收口 completed（P0–P3 当日完成；提交 34a30816 / 3fb91012 / a9078d72 / bf6916a5）**。**P1 解析归一**：`deepseek.js` 流式 delta + 非流式信封（`pickReasoningText`：reasoning_content 优先 / reasoning 兜底）+ `io-transcript.js` `normalizeResponse` 记录面（reasoning_content 为字符串含空串时行为与既有契约完全一致）；下游事件/记录面保持 reasoning_content 单一形状，前端零改动；契约测试 `test/block82-reasoning-field-compat.test.mjs` 5/5（sensenova 形状 / DeepSeek 主路径回归 / 双字段优先级 / 非流式信封 / 记录面），相邻回归 provider-streaming + block37-io-transcript 全绿。**P2 实机验收 11/11 allPass**（`scripts/block82-thinking-compat-live.cjs`，`acceptance/block-82/`，sensenova 真渠道两轮对话）：C0 能力位声明 / C1 standard 零思考参数（BLOCK-81 additive 红线回归）/ C2 high 上游收到 reasoning_effort=high（能力位门控放行）/ C3 high 思考段 136 字归一落库 meta.reasoningByIteration（修复前恒 0）/ C4 standard 思考段 307 字同样归一（默认路径同受益）/ C5 内容主路径零破坏。**能力位**：dev 栈 sensenova profile capabilities 补 `reasoning`（probe paramAccepted=true 有据；运行数据不入库，本行留痕）。**验收脚本抓真两处（断言精度）**：①会话 transcript 为会话级归档（混标题生成等辅助调用，走默认渠道不涉档位）→ 档位断言只看 sensenova 记录；②聚合记录面 message 本就不保留思考段（思考段走事件流路径进 meta）→ 如实登记不虚设断言（首轮曾误把同会话 deepseek 标题记录的 53 字计为 sensenova 思考段，已修正）。**收口门禁**：hygiene ✅ + docs:check 229 ✅ + ui:audit:check ✅ + test:changed 27/29（2 红=P6 canonical evidence 源绑定 `p6_current_source_tree_not_exact` detail=[test/impact-map.json]，HEAD 基线同败 11/2——存量漂移自 TEST-INFRA-DEBT-2 起，重采属 G0-RS 范围，如实登记例外）；impact-map 顺手清三处存量 unknown（dev-verify 探针证据 / block-79 / ui-341，test-affected 16/16 恢复全绿）。范围守住：思考行渲染位置等范围外三项未动。G0 开发期常态 · 不外推 packaged/Provider/GA。
- 2026-09-12 **立项（P0-LAUNCH）**：用户裁决「规划一下……串起来完成长周期阶段性任务」（休息期授权，
  范围=BLOCK-81 已登记遗留候选，边界清晰无歧义）。代码事实：解析断点 3 处（deepseek.js×2 +
  io-transcript.js×1，全 OpenAI 兼容路径）+ dev 栈 sensenova profile 未声明 reasoning 能力位；
  请求侧支撑证据=BLOCK-81 probe（paramAccepted=true）。范围外显式排除渲染位置（用户裁决项）。
  G0 开发期常态 · 不外推 packaged/Provider/GA。
