# 意图预设 + 任务感知自动参数 · 实现证据（2026-11-25）

> 发令：owner 裁决 msg_b9d146535752「行——按推荐 A 执行」（材料见 INTENT-PRESET-RULING-MATERIAL.md）。
> 红线：策展常量、agent 不可自写参数、env 后门不动、底层 provider/DB/思考档位零改、零新依赖。

## §1 实现面（核码真源）

| 组件 | 改动 | 边界 |
|---|---|---|
| `helpers/generation-intent.js`（新） | PRESETS 四档常量 + 本地关键词判定 + 优先级链解析（纯函数） | 零依赖、零外发、agent 无写入口 |
| `helpers/ai-settings.js` | `getGenerationDefaults(context)` 带 context 时启用三层链；无 context 走原路径（零突变）；save 白名单加 intentPreset | env 最高不变；旧 generation 键兼容 |
| `agent-runner.js:655` | 注入 `{userText: latestUserText(messages), taskKind: kind}` | 行数 1038 不变（棘轮） |
| `routes/ai-settings-api.js` | GET 回传存储层 intentPreset（覆盖档读取） | 其余字段沿用原 sanitized 视图 |
| `config-schema.js` | 注册 `generation.intentPreset`（oneOf 四档）+ code-size grow 留因 | 配置归属扩展、非 provider 链 |
| `GenerationDefaultsPanel.tsx` | 裸温度/预算滑杆→意图 select（写 intentPreset） | 老裸值映射最近档展示；观感零代签 |

## §2 优先级链（实测）

env `PETRI_LLM_TEMPERATURE/MAX_TOKENS`（最高，专家后门） > `generation.intentPreset`（用户意图覆盖） > 旧 `generation.temperature/maxTokens` 裸值（今天行为零突变） > 自动档（本地规则判意图，失败落平衡 0.4）。
- 自动档四档：精准 0.2 / 平衡 0.4 / 创作 0.8 / 长文（temperature=0.4 + `maxTokens='adaptive'` 交 loop 既有 `resolveOutputBudget` 自适应）。
- 实测微调：未调整（按裁决值）；如需 ±0.1 内微调须留因并回报（令④）。

## §3 行为切换点（单列，请 owner 知悉）

1. **默认档由固定 0.4 改为按任务意图选档**——这是 owner 要的自动化，不是 bug；判定失败一律落平衡 0.4（今天行为零意外）。
2. 用户在设置页选意图后写入 `generation.intentPreset`，下轮任务生效（运行中的回复保持当前设置）。
3. 长文档只给"预算放大"信号（`maxTokens='adaptive'` 不写死），实际输出预算仍由 loop 的 `resolveOutputBudget(contextWindow, configured)` 按上下文窗口自适应——推理模型思考段不饿死正文。
4. 判定/选档在 getGenerationDefaults(context) 返回 `source` 字段（env/intent_override/legacy_generation/auto）随 toolCtx.generationDefaults 可查——本包**未新增 incident 写入**（材料中的 incident 建议未在裁决硬范围内，不冒充已实现）；agent 不可通过工具面改自己的生成参数。

## §4 验证

- HK-01 纯函数 5/5（四档/判定/优先级链/忽略 agent 自报/长文自适应）+ 集成 5/5（真实 ai-settings 文件：无 context 零突变、自动档、旧值兼容、env 最高、意图覆盖）+ 前端面板 2/2 + 后端邻域 27/27（含 config 8/8）。
- 全静态门绿：types/lint(0 error)/arch/frontend-deps/ts-syntax/arch-cycles/code-size/docs/ui；code-size grow 登记 config-schema.js 一处留因。
- HMR：Vite 3000 服务 GenerationDefaultsPanel/DesktopSettingsPanel 均 200；owner PID 87539/87617/87762 未变、未重启。

## §5 边界与未动

- env 后门、底层 provider/回退链、DB schema/迁移、思考档位 `reasoning` 键与 ReasoningDefaultsPanel、工具/审批/审计链、loop 状态机、SSE 协议：零改。
- 零新依赖、观感零代签 pending_human_eye 待 owner 实机重试；WIP/owner 实例零触碰。
