# Stage 2 验收包（模型层 · P-07）

把 Stage 2 出口剩余的 3 条用户门控项做成可直接执行的验收工具：

| 出口项 | 工具 | 形态 |
|---|---|---|
| 4. 真实聊天连通（DeepSeek + 一个云 OpenAI-compatible + 一个本地模型） | `live-provider-check.mjs` | 自动（真实网络） |
| 5. ≥2 Provider 真实 streaming + Agent tool calling | `live-provider-check.mjs` | 自动（真实网络） |
| 6. 打包态 UI-031 实机验收 | `UI-031-packaged-acceptance.md` | 人工清单 |

> 这两个是**手动运行的验收工具**，不进单元测试套件，CI 也不会跑（需要真实凭据和真实网络）。

## 安全约束

- 密钥**只从环境变量读**，脚本从不硬编码、从不打印 secret。
- 不修改仓库代码，不碰 `api-failover-proxy/`，不改版本号，不 push。
- 建议隔离设置目录：`BIOF3_LOCAL_DATA_DIR=/tmp/biof3-accept`（Keychain 仍是全局，验完清理测试条目）。

## 第 4/5 条：live-provider-check.mjs

### 运行

```bash
# 从仓库根目录执行
node acceptance/stage2/live-provider-check.mjs
```

无任何配置时，脚本打印用法并以 0 退出。

### 环境变量

`ACCEPT_TARGETS` 选择要跑的目标（逗号分隔，默认 `deepseek,openai-compatible,local`）。
只有同时提供必需变量的目标才会被激活。

DeepSeek：
- `DEEPSEEK_API_KEY`（必需）
- `DEEPSEEK_MODEL`（默认 `deepseek-chat`）

云 OpenAI-compatible：
- `OPENAI_COMPAT_BASE_URL`、`OPENAI_COMPAT_MODEL`（必需）
- `OPENAI_COMPAT_API_KEY`（云端一般需要）
- `OPENAI_COMPAT_PROVIDER`（默认 `openai`；纯本地免 Key 才用 `openai-compatible`）

本地模型（Ollama / LM Studio / vLLM）：
- `LOCAL_BASE_URL`、`LOCAL_MODEL`（必需）
- `LOCAL_PROVIDER`（默认 `ollama`；可填 `lmstudio` / `vllm`）
- `LOCAL_API_KEY`（一般为空）

### 示例

```bash
ACCEPT_TARGETS=deepseek,openai-compatible,local \
DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" \
OPENAI_COMPAT_BASE_URL=https://api.example.com/v1 \
OPENAI_COMPAT_MODEL=gpt-4o-mini \
OPENAI_COMPAT_API_KEY="$OPENAI_COMPAT_API_KEY" \
LOCAL_PROVIDER=ollama LOCAL_BASE_URL=http://127.0.0.1:11434/v1 LOCAL_MODEL=qwen2.5 \
node acceptance/stage2/live-provider-check.mjs
```

### 每个目标验证三项

1. `chat` — 非流式请求返回非空内容。
2. `streaming` — `chatStream` 逐块发出 `content_delta`。
3. `tool-calling` — 提供 `get_weather` 工具，模型回出 `tool_calls`。

### 退出码

- `0`：所有已配置目标 chat + streaming 通过，且 ≥2 个目标 tool calling 成功。
- `1`：任一目标 chat/streaming 失败，或 tool calling 成功数 < 2。

工具调用失败可能是**模型能力弱**（非代码问题）：请用具备 tool calling 能力的模型复验。

### 注意

- 本地 `127.0.0.1` 必须**直连**，别被系统代理劫持。
- 有些兼容云不暴露 `/models`，UI 里的“测试”按钮会失败，但真实 chat 可能正常 —— 以本脚本的真实 chat 结果为准。
- `fallback` 默认关闭：某 Provider 失败应报错而非静默换模型，这是**预期行为**。

## 第 6 条：UI-031-packaged-acceptance.md

打包态人工清单，逐项截图留证。必须跑**打包 `.app`**，不是 dev server。

## 全绿之后

1. 更新 `docs/ui-productization-audit.md`：UI-031 `in_progress → verified`（同一提交附证据）。
2. `npm run ui:audit:check` 通过。
3. 更新交接文档、决定下一 RC，按“6 条完成后再 push”一次性推送。发布仍需单独授权。
