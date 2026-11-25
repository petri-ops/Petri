# 能力渠道简化方案（2026-11-25 · owner 已批阶段一+二并落地 · 阶段三未做）

> 拍板：主人「现在的模型多模态了。我觉得没有必要保留，直接都支持即可。你梳理确定一下。继续」——架构级简化梳理令，先方案后动码。
> 执行授权：owner「按你的推荐来，冲吧」（msg_884f86238075）→ 按 §五「全按序走」执行阶段一→二；阶段三（roles.vision 槽位退役）**不做**。
> 方法：六能力×八角色逐项核码消费面（文件:行 在案），区分「多模态可直接全支持」与「砍了会静默坏」——**vision 与 embedding 不同质，不能混为一谈**。
> 已知交互：本方案与已探索的「批量清除+预填开关」包（msg_e2bf920e780f 授权）存在替代关系——结论见 §五（建议叫停转型）。

## 一、判定表（6 能力 × 8 角色逐项）

### 能力（ModelCapability 6 类，`model-types.ts:30` / 后端 `model-profile.js` MODEL_CAPABILITIES）

| 能力 | 判定 | 核码理由（消费面） |
|---|---|---|
| chat | **保留**（发送链硬过滤） | `useEndpointProfilesEditor.ts:177-179`：保存时 chat_model_presets 只保留「未声明或声明含 chat」的渠道——砍掉过滤=全保留，无破坏但属行为面改动；建议改为不过滤（全保留），**可简化** |
| streaming | **可简化**（传输面参数，无独立 gating） | 仅协议映射层消费，无 UI 开关、无角色耦合；从声明数组退役不影响任何 gating |
| tools | **必须保留** | 多模态≠函数调用：loop 工具链（loop-orchestrator 50 上限工具循环）依赖模型真支持 function calling；砍掉 gate=文本模型进 agent 模式静默失败（工具调用 400 循环），比诚实报错更差。渠道默认含 tools（providerDefaults `model-types.ts:56,61`）是「假定现代模型支持」的既定口径，**逐模型覆盖仍需保留**给不支持 tools 的模型 |
| vision | **可砍（主人判断成立的唯一主项）** | 消费面全核码：①composer 贴图/拖图前置门 `attachments.ts:97,169`（visionConfigured+chatVisionCapable 双位）②识图换绑选择器过滤 `VisionRoleBinding.tsx:33` ③visionInline 单通道路由 `chat.js:84-91`。三处砍掉后的行为=贴图直接放行、识图选择器不再过滤、图片直接进请求体——多模态模型直接支持 ✓；文本模型收图=上游报错（诚实报错优于前置封锁，与主人「直接都支持即可」哲学一致）。**注意与 embedding 的本质差异**：vision 失败=单次请求报错（可见、可换模型重试）；embedding 失败=知识库静默写入错误向量（不可见、不可逆污染） |
| embedding | **必须保留（砍了会静默坏）** | `embedding-availability.js:22`：knowledge space/AI 记忆启用判定=`model_role_bindings.embedding` 绑定渠道解析含 embedding——砍掉判定=所有模型被视为可向量化 → chat 模型被拿去算 1024 维向量 → `/embeddings` 端点整批拒收或产出无意义向量 → **知识空间与 AI 记忆静默坏掉**（无报错、污染持久化）。`EmbeddingRoleBinding.tsx:14,33` 选择器同过滤。多模态论据不适用：embedding 是另一种推理端点，不是模态 |
| reasoning | **保留（可隐藏默认）** | 思考档位控件 gating（`SimpleChat.tsx:522` reasoningSupported+Ctrl+T :541）：给非思考模型发思考参数=上游 400（BLOCK-455 探测器存在的根因=上游会拒绝思考参数）。思考≠模态，主人「多模态」论据不覆盖；**可保留判定但默认隐藏控件**（现状已如此：未声明时档位控件不出现，零可见成本）——无需动码 |

### 角色（ModelRole 8 个，`model-types.ts:52-58`）

| 角色 | 判定 | 理由 |
|---|---|---|
| 默认聊天 / 复杂规划 / 低成本摘要 / 报告生成 / 结果解释 / Agent 工具调用 | **保留原样** | 偏好槽位（哪个模型服务哪用途），与能力声明解耦；chat 门槛见能力行 |
| 视觉理解（vision） | **保留槽位、去掉能力过滤** | 简化后 `VisionRoleBinding.tsx:33` 过滤撤除 → 槽位列全部模型，用户自选；语义从「声明了视觉的模型」退化为「用户指定处理图片的模型」 |
| 语义向量（embedding） | **必须保留（含过滤）** | `embedding-availability.js:22` 知识/记忆硬依赖；选择器过滤是防静默污染的最后防线 |

## 二、能力数组简化方案

**目标形态**：`capabilities` 数组退役为「tools + embedding」两个真硬门的载体；vision 从声明面整体退役；reasoning 探测面保留但不再进声明数组。

**分阶段路径**（每阶段独立可回退）：
1. **阶段一（前端呈现简化，纯前端）**：①composer 贴图门改「始终放行图片」（attachments.ts 双位门退役，visionInline 逻辑保留——图片照发、失败诚实报错）②识图换绑选择器撤除能力过滤（列全部模型）③渠道详情能力表（视觉/思考列）隐藏，保留向量列+思考探测钮。
2. **阶段二（声明面收窄，前后端）**：模型能力数组收窄为 `['tools'] | ['tools','embedding']` 两种有效形态（chat/streaming 不再是声明位）；MODEL_CAPABILITIES 白名单同步；旧数据迁移=vision/reasoning 位丢弃、embedding 位保留。
3. **阶段三（可选项，需再次裁决）**：roles.vision 槽位退役（识图改走 active model 直通）——影响 BLOCK-155 单通道路由语义，建议观察阶段一二运行后再议。

**对聚合网关的影响**：网关 /models 名单杂乱（claude/gpt/gemini 混挂）时，现状推断预填会误报能力；简化后不再有「预填误报」问题（声明面退役），代价=文本模型收图时上游报错（诚实失败）。**净收益为正**：误报声明导致的静默幻觉路由（把图发给不能看的模型还被标记成功）比诚实报错更危险。

## 三、与 BLOCK-518（批量清除+预填开关）的衔接：**建议叫停转型**

- 探索结论：清除判据（与预填模式集合相等的物化条目）可确定性实现（纯函数已绿 10/10，未提交已回滚）。
- **叫停理由**：简化落地后 modelCapabilities 覆写表整体退役，「逐项清除推断」失去对象——简化迁移=一次性清除全部物化覆写（比逐条清除更彻底且无判据歧义）。
- **转型**：迁移步骤并入本方案阶段二（旧数据迁移规则）；BLOCK-518 未立项未登记（仅探索 WIP 已回滚），无废包残留。

## 四、配置面方案

| 配置面 | 处置 |
|---|---|
| 渠道详情逐模型能力表（视觉/思考列） | 阶段一隐藏（保留向量列+思考探测钮） |
| composer 贴图/拖图 | 始终放行（撤双位门） |
| 识图模型换绑选择器 | 撤过滤列全部模型（槽位保留） |
| 向量模型换绑选择器+可用性判定 | 保留不动（防静默污染） |
| 思考档位控件+探测钮 | 保留（未声明默认隐藏，现状零成本） |
| 语音模型优先级/回退 | 已派 U 类材料（`voice-local-runtime/U-DECISION-MATERIAL.md`），本方案只登记不重复 |

## 五、实施顺序建议（每阶段独立立项，未获口令不开工）

阶段一（纯前端，S~M）→ 阶段二（前后端声明收窄+迁移，M）→ 观察期 → 阶段三（可选项，需再裁）。

红线：阶段二动 MODEL_CAPABILITIES 白名单时同步后端镜像与跨源矩阵契约（model-capabilities.test.ts）；知识空间/记忆回归必跑；诚实报错替代前置封锁需在设置页留说明文案（主人过目）。

## 六、拍板口令

- 「阶段一做」= 前端呈现简化立项（含阶段二设计文档）；「全按序走」= 阶段一→二连批（阶段三另议）；「先等」= 维持现状。

## 七、落地记录（2026-11-25 · BLOCK-518 转型包）

**授权**：owner「按你的推荐来，冲吧」（msg_884f86238075）= 按 §五「全按序走」执行阶段一+二；阶段三不做。前任 claude chat 空转、HEAD 无实现提交，本批从零落地。

**阶段一（纯前端）**：
- `frontend/src/components/copilot/SimpleChat/attachments.ts` — `visionConfigured+chatVisionCapable` 双位门退役（含 imageInputAllowed/videoInputAllowed/VISION_NOT_CONFIGURED_NOTICE/hasImagePayload/hasVideoPayload），`onPaste`/`onDrop` 图片与视频始终放行；`useComposerDrop.ts` 与 `SimpleChat.tsx` 同步撤门参数、撤 `/ai/settings` vision_configured 取数 effect；`auto-model.ts` 的 UI-614 图片入口门（imageVisionCapable）一并退役。
- `VisionRoleBinding.tsx` — 撤 vision 能力过滤，候选=全部 (渠道, 模型) 对；槽位保留（阶段三另议）。
- `EndpointRowDetail.tsx` — 视觉/思考列隐藏，向量列 + 思考探测钮保留；探测结果只展示诚实证据，不再物化 reasoning 声明位；`ModelSelectorControls.tsx` 思考合并下拉随声明位撤除（选择器显示保留）。

**阶段二（前后端）**：
- `core/shared-backend/llm-providers/model-profile.js` — `MODEL_CAPABILITIES=['tools','embedding']`；`ROLE_CAPABILITY` 收敛（agent→tools、embedding→embedding 硬门；chat 族/vision→null 撤门）；归一收窄渠道数组与 modelCapabilities 覆写（旧数据 vision/reasoning 位丢弃、embedding/tools 必留）；BLOCK-518 批量清除转型销账=收窄后为空的物化覆写条目整条清除；默认档案 dashscope-vision 不再自动注入；inferCapabilities/inferModelCapabilities 同口径收窄。
- 前端镜像 `model-capabilities.ts` 同步推断；`useEndpointProfilesEditor.ts` 的 chat_model_presets 撤 chat 位过滤；`providerDefaults` 改为 ['tools']。
- `vision-inline.js` — chatVisionInlineCapable 撤 vision 声明判据，provider 协议形态单判（openai-family/anthropic 内联；dashscope 原生协议不内联）；`ai-settings.js` 退役 vision 能力补声明写面（改绑保留）。
- **已知行为面**：reasoning 不再是声明位 → composer 思考档位控件与网关思考参数注入门按既有「未声明不发参」口径休眠；探测钮保留作证据展示。此为声明面收窄的明示后果，非缺陷。

**HK-01 红绿先行**：新契约测试 `test/block518-capability-narrowing.test.mjs` 11 红 → 实现后全绿；前端 attachments/VisionRoleBinding/EndpointRowDetail 测试按新契约红→绿。

**验证**：后端契约 52/52（block518+model-profile+block455+block224+ui638+block155）+ 相邻 39/39（thinking-level-injection/block454-p5/block456/block201）+ 前端定向 31/31（attachments/auto-model/model-capabilities/VisionRoleBinding/EndpointRowDetail）；`quality:types` 0；Jev test:suggest 追加 3 文件（conf 0.99）已跑；HMR 只读核对=Vite 服务新源 + owner 窗口 `/settings` 无旧 UI 标记，3000/3001/9222 三进程未触碰。

**证据/台账**：AUDIT-LOG 2026-11-25 条；UI 台账同批注记（UI-614/706/476 呈现面变化、状态不翻）；证据明细=`acceptance/model-capability-simplification/EVIDENCE.md`。closeout 链 audit:compact/hygiene/docs:check/ui:audit:check 全 PASS，test:changed 1311/6（6 红=工具基线 118/120 族 4 + W5b 1 + P6 证据源绑定 1，均非本包实现缺陷、归属见 EVIDENCE.md）；code-size 指纹随包重打。G0 开发期常态 · 不外推 packaged/Provider/GA。
