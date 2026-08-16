# Model Provider 调用链审计（MODEL-1）

> **吸收声明**（2026-08-16 GATES-4 batch 2）：本审计为只读审计记录，已被当前 G0 阶段纪律 `qualificationEligible:false` 与 [`next-steps-roadmap.md`](../../next-steps-roadmap.md) §"后续决策入口"（x64 Runtime、Provider 矩阵为 P7+ 候选）吸收；本文件保留为追溯。


更新：2026-07-17

主模块：`P-07 模型网关与 AI Provider`

阶段来源：`docs/v1-productization-roadmap.md` Stage 2 / MODEL-1

## 当前结论

当前代码已有 `core/shared-backend/llm-providers/` 抽象雏形，但尚未形成唯一模型事实链：

- DeepSeek chat adapter 已支持 OpenAI-compatible 非流式、流式和 tool calling；只有主会话与 Agent 的部分路径使用它。
- DashScope embedding、vision 各有原生 adapter；业务调用仍存在直接实现或固定实例。
- 前端 `chat_model_presets` 只影响会话模型选择，不覆盖摘要、记忆、报告、解释、视觉和 embedding 等后台任务。
- `llm-providers/index.js` 提供 registry API，但启动时没有注册现有 Provider，不能作为可靠运行时入口。
- OpenAI 和 Ollama 目前只是设置页的“未来支持”选项，没有 adapter；Anthropic 尚未接入。
- 多个业务模块仍固定 `getApiKey('deepseek')`、`deepseek-chat`、`api.deepseek.com`；Embedding 和 Vision 固定 DashScope。

## 现有入口与迁移角色

| 现有入口 | 当前实现 | MODEL-1 目标角色 |
| --- | --- | --- |
| `/api/ai/chat` | 当前 active chat preset + 部分直接 DeepSeek 请求 | `chat` |
| `/api/ai/agent`、`agent-runner.js` | preset + Provider adapter | `agent` / `planner` |
| `chat-summary.js`、`user-facts.js` | 直接 DeepSeek HTTPS | `summary` |
| `conversations.js` 自动标题/主题切换 | 直接 DeepSeek fetch | `summary` |
| `methods-export.js` | 直接 DeepSeek HTTPS | `report` |
| `interpret.js`、`ai-legacy.js` | 直接 DeepSeek HTTPS | `explanation` |
| `agent-tools/learning.js` | 固定 DeepSeek | `explanation` |
| `memory-vectors.js` | 直接 DashScope embedding | `embedding` |
| `agent-tools/vision-tools.js` | 固定 DashScope vision | `vision` |

## MODEL-1 固定 contract

`ModelProfile` v1 保存以下非敏感配置：

- `provider`、`protocol`、`model`、可选 `baseUrl`
- `credentialRef`，只引用凭据，不内嵌 API Key
- `capabilities`：`chat`、`streaming`、`tools`、`vision`、`embedding`、`reasoning`
- `roles` 与可选 `parameters`

任务通过角色解析 Profile：`chat`、`agent`、`planner`、`vision`、`embedding`、`summary`、`report`、`explanation`。不满足能力的 Profile 必须在发请求前返回标准诊断；不得静默换模型。

兼容规则：旧 `chat_model_presets` 可以迁移为 Profile；旧调用函数只能转发 Gateway，不得保留第二套 HTTP 实现。模型层只决定推理请求，不改变 `run_tool → tool_job → artifact truth`。

## 后续顺序

1. 建立 Model Gateway，并将现有 DeepSeek/DashScope adapter 注册为基线。
2. 逐入口迁移，补 role/capability/兼容 contract 测试。
3. 升级设置页为 Model Profile + 任务角色绑定，保留旧设置兼容读取。
4. MODEL-1 全绿后进入 MODEL-2：OpenAI-compatible、自定义 Base URL、本地 Ollama/LM Studio/vLLM、Anthropic 原生协议。
