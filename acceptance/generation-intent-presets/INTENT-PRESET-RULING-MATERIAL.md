# 意图预设 + 任务感知自动参数 · 四问裁决材料（先材料后实现）

> 发令：Orca bb8dddaf msg_0604663bd2f3（owner 判断升级：「大部分用户并不清楚这个有什么用处，我觉得这 agent 应该自动化处理」）。
> 性质：**正式方案材料，零代码改动**。owner 回「行/不行」后才动实现。观感零代签、底层 provider 链零变化、零新依赖、旧 generation 键兼容、env 后门不动。

## §0 核码真源（非猜测）

| 事实 | 真源 | 对方案的含义 |
|---|---|---|
| 默认偏好 UI | `GenerationDefaultsPanel.tsx`，只含 temperature/max_tokens 两项 | 不含思考档位；owner 原描述里的"思考档位"是面板旁注泛指 |
| 存储键 | `ai-settings.json` 的 `generation` 键；API `/api/ai/generation-defaults`（ai-settings-api.js:168/176） | 旧键兼容读取=保留该键作"意图覆盖"或底层缺省 |
| 注入点 | `agent-runner.js:655 getGenerationDefaults()` → `toolCtx.generationDefaults` → `loop-orchestrator.js:671-679` 每轮单次解析 | 自动档在此处选预设，改动面单点 |
| 预算自适应 | `resolveOutputBudget(contextWindow, configured)`（agent-tools/agent-loop-control.js:314） | 长文档只调 configured 输入，不动自适应公式 |
| 优先级现状 | `ai-settings.js:415-417`：env `PETRI_LLM_TEMPERATURE/MAX_TOKENS` > generation 键 > 内置 0.4/16384 | 新优先级 env > 意图覆盖 > 自动档，沿用同一解析点 |
| 现成意图信号 | ①`intent-router.js` 四类意图（chitchat/task/knowledge_qa/result_studio）但**默认关+外部 Jev decision API**；②`plan-intent.js` 本地纯函数正则（只判"先计划后执行"）；③`agent-runner.js:652 taskKind`（primary/subagent，非用户意图） | 自动档判定需本地零依赖方案；不能复用默认关的 Jev 路由做默认行为 |

## §1 改什么（含注入点改动面 + 两案对比）

### 1.1 三层机制（替代裸参数面板）

| 档 | 行为 | 用户感知 |
|---|---|---|
| 自动档（默认） | loop 发请求前按**任务意图**选策展预设（精准/平衡/创作/长文），用户零感知 | 无 UI，默认生效 |
| 覆盖档（可选 UI） | 设置页以「意图选择」（精准/平衡/创作/长文）替代裸 temperature/maxTokens 滑杆；用户选意图不选参数 | 一个下拉 |
| 专家档（保留） | `PETRI_LLM_TEMPERATURE` / `PETRI_LLM_MAX_TOKENS` env 后门，最高优先级 | 不变 |

### 1.2 策展预设（候选值，需 owner 拍板具体数值）

- 精准 `0.2` / 平衡 `0.4`（=现内置缺省，零行为漂移基线）/ 创作 `0.8` / 长文 `maxTokens=上下文窗口上限（走 resolveOutputBudget 现有自适应，temperature=0.4）`。
- 全部为**有界常量表**，代码内固定；agent 不可写、不可改、不可通过工具调用覆盖（红线）。
- 数值确定前请 owner 确认四档取值；若不做创作/精准细分，可先只上"平衡默认 + 长文预算"两档（最小可用）。

### 1.3 注入点改动面（单点）

- `agent-runner.js:655` 把意图判定结果（纯函数算出的 preset id）随 toolCtx 传给 loop；
- `loop-orchestrator.js:671-679` 按优先级链解析：env > 意图覆盖 > 自动档预设，`resolveOutputBudget` 口径不变；
- `ai-settings.js` 解析函数保持 env 最高优先的语义，新增"意图覆盖"中间层；旧 `generation` 键读值路径不删（兼容读取）。
- **不动**：provider/回退链、DB schema、思考档位 `reasoning` 键、工具执行与审批链。

### 1.4 任务意图判定两案对比（请 owner 选）

| 案 | 机制 | 优点 | 缺点 | 与红线相容 |
|---|---|---|---|---|
| **A. 本地规则分层判定（推荐）** | 本地纯函数：①用户最近一条文本关键词（参考 `plan-intent.js` 零依赖正则）②taskKind ③工具序列（写/跑→精准、长文档→长文、开放式生成→创作），优先级固定，确定性可审计 | 零新依赖、零外发、确定性强、可单测、与本地主权/全链可审计同哲学 | 规则覆盖面有限，新意图需加规则（但预设只有四档，边际成本小） | ✅ agent 不自写参数（判定是代码规则，非模型自报） |
| B. agent 首请求声明意图模式 | 让模型在请求里带 `intent=creative` 等字段，loop 据此选档 | 语义灵活、覆盖长尾 | 模型自报可被提示词诱导到高 creativity/大预算 → **自我强化回路风险**；与 A3 注入防护/外部监督器"只观测"哲学冲突；依赖模型配合，不可审计 | ❌ 触碰"agent 不可自写生成参数"红线 |

**推荐 A**：本地规则判定，agent 只提供输入文本/工具动作（既有数据），不声明自己的参数策略。B 案若 owner 坚持，须另出防自我强化的裁决材料（本材料不建议）。

## §2 风险

1. **行为切换面**：默认档由固定 0.4/16384 变为意图相关，部分任务输出风格/长度会变（这是 owner 要的自动化，不是 bug）。缓解：平衡档=0.4 作为兜底，判定失败一律落平衡档（零意外）；切换日志写 incident（脱敏 reasonCode=preset_selected + 档位，不写用户文本）。
2. **与思考档位 ReasoningDefaultsPanel 的关系**：二者是**不同键、不同维度**——`generation`（温度/预算）vs `reasoning`（思考档位/预算）。本方案只动前者；推理模型思考段与正文的预算竞争由 `resolveOutputBudget` 既有自适应承接，长文档预设只给更大 configured 值，不改自适应公式。若 owner 希望"思考档位也随意图自动选"，属另一议题，需单列（本材料不含）。
3. **误判风险**：本地规则可能把"写一份总结"判精准还是平衡？→ 规则表须逐条可测，宁可落平衡（0.4）；四档判定用显式关键词白名单 + 兜底，不做模糊推断。
4. **老用户设过裸值的兼容**：旧 `generation.temperature/maxTokens` 仍读，作为"意图覆盖的等价优先级"（高于自动档、低于 env）——老用户行为不突变；UI 迁移时把旧数值映射为最接近的预设档展示（如 0.2→精准、0.4→平衡、0.8→创作、其它→自定义保留旧值）。

## §3 边界（哪些不动）

- env 后门 `PETRI_LLM_TEMPERATURE/MAX_TOKENS` 语义与优先级不变（最高）。
- 底层 provider 链、fallback/回退、DB schema、迁移脚本零改。
- 思考档位 `reasoning` 键与 ReasoningDefaultsPanel 零改（同文件不同键）。
- agent 不可自写生成参数：预设表是代码常量，工具面无任何写入口（与 A3 注入防护、外部监督器只观测同哲学）。
- 工具调用/审批/审计链、loop 状态机、SSE 协议零改。
- 零新依赖；旧 `generation` 键兼容读取；观感零代签（新 UI 仍 pending_human_eye）。

## §4 迁移（旧键 / env / 意图覆盖共存规则）

优先级链（自上而下，先命中即停）：

1. **env**：`PETRI_LLM_TEMPERATURE` / `PETRI_LLM_MAX_TOKENS` 存在 → 直接用（专家档，最高，零变化）。
2. **意图覆盖**：设置页新 UI 选了意图（写 `generation.intentPreset`，老 `generation.temperature/maxTokens` 数值作为兼容只读映射展示）→ 用该预设档。
3. **旧裸值兼容**：无 `intentPreset` 但有旧 `generation.temperature/maxTokens` → 按旧值直接用（=今天行为，零突变）；UI 上标"旧版自定义值，建议改用意图选择"。
4. **自动档（默认）**：以上都没有 → 本地规则判意图 → 四档预设（判定失败落平衡 0.4）。

老配置零丢失：迁移不改/不删 `generation` 旧键；新 UI 仅写 `intentPreset` 字段（同键内 additive），旧值保留可回滚。

## §5 请 owner 回

**「行」** = 按推荐方案 A（本地规则判定）+ 四档预设值（0.2/0.4/0.8/长文自适应）出实现包；
**「不行，改」** = 给方向（改档位值 / 改两案选择 / 先只做两档 / 思考档位也纳入），本材料不动手等明确裁决。

status: pending_user_ruling（本件为方案材料，Agent 不代答、不写实现代码）

## §6 终形态更新（owner 终裁 msg_b8392b7ee460）

owner 原话：「后面会变成软件 设置成环境变量会很奇怪 这个环境变量就不用了吧」——**env 后门（PETRI_LLM_TEMPERATURE/MAX_TOKENS）已移除**。上文 §0/§1/§3/§4 中记载的 env 层是裁决当时的设计，作为决策留痕保留；终形态优先级链为 **意图覆盖 > 旧 generation 兼容 > 自动档**（无 env 层），`source` 枚举去掉 'env'。能力通道变化：原先靠 env 调参的场景改走 config/API（generation.intentPreset）或旧 generation 键，intentPreset 与旧键兼容读取均保留。配置 schema 的 generation envKeys 清空，其它 family 的通用 env 遮蔽机制不变。
