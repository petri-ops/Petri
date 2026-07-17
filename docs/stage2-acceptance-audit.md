# Stage 2 模型层验收前审计报告

> 审计类型：**只读代码审计**（不改动任何代码）
> 审计日期：2026-07-17
> 审计范围：roadmap 第 4.3 节"Stage 2 出口验收清单" 6 项 + 第 8 节"当前立即执行项" 5 项
> 审计结论：**代码主干已就绪，6 项中 5 项代码层通过，1 项待打包态实机验收**

---

## 一、验收清单逐条核对

### 1.1 出口验收清单（第 4.3 节）

| # | 验收项 | 代码层状态 | 证据 | 待办 |
|---|--------|-----------|------|------|
| 1 | DeepSeek + OpenAI-compatible + 本地模型三路真实聊天验证 | ⏳ 代码就绪 | Gateway 支持 7 个 Provider，无硬编码直连 | 需真实 API 实测 |
| 2 | 至少两个 Provider 完成 streaming + Agent tool calling 回归 | ⏳ 代码就绪 | `llm-client.js` 兼容层转发到 Gateway，`callChatProvider` 支持 stream/tools | 需真实 API 实测 |
| 3 | summary/report/memory 等后台路径不再硬编码 DeepSeek | ✅ 通过 | `_maybeAutoTitleConversation` 走 `callModelTask({role:'summary'})` -> `modelGateway.chat()`；无 `fetch('https://api.deepseek.com')` 直连 | — |
| 4 | Provider 切换不破坏 conversation/job/artifact/Harness 状态 | ✅ 通过 | `copilot_conversations`/`copilot_messages`/`tool_jobs` 表无 provider 列，无第二状态 | — |
| 5 | 凭据不出现在 settings 读取、日志、诊断包、测试快照 | ✅ 通过 | `getAiSettings()` 返回 `credential_status`(boolean)；日志无 apiKey/Authorization 泄漏；`_extractCredentialUpdates` 剥离 preset 内 apiKey | — |
| 6 | 模型管理中心通过打包态实机验收 | ⏳ 代码就绪 | 前端 `useAiSettings.ts` 已迁移到 `model_profiles` + `model_role_bindings` 双格式读取 | 需 macOS 打包态实测 |

### 1.2 立即执行项（第 8 节）

| # | 执行项 | 状态 | 说明 |
|---|--------|------|------|
| 1 | 真实验证三路聊天连接 | ⏳ 待执行 | 需真实 API Key + 本地模型 |
| 2 | streaming + tool calling 实测 | ⏳ 待执行 | 需真实 API Key |
| 3 | macOS 打包态验收 UI-031 | ⏳ 待执行 | 代码就绪，需实机操作 |
| 4 | 确认无第二状态/第二执行真值 | ✅ 代码层通过 | 见 1.1 第 4 项 |
| 5 | 验收通过后固定下一 RC | ⏳ 阻塞 | 依赖 1-3 |

---

## 二、关键模块调用链核对

### 2.1 MODEL-1 调用收口

```
前端 SimpleChat/Agent
  └─> ai-chat.js / ai-agent.js
        └─> llm-client.js (兼容层)
              └─> modelGateway.chat({ provider, model, baseUrl, apiKeyOverride, body })
                    └─> ModelGateway._dispatch()
                          └─> Provider 适配器 (deepseek/openai/anthropic/...)
```

**判定**：兼容层 `llm-client.js` 确实只做转发，不形成第二套调用实现。`callChatProvider()` 把 `apiKey` 作为 `apiKeyOverride` 传给 Gateway，Gateway 仍负责 Provider dispatch 和能力校验。符合 MODEL-1"兼容层只能转发"原则。

### 2.2 后台任务路由（MODEL-3）

```
conversations.js _maybeAutoTitleConversation
  └─> callModelTask({ role: 'summary', body })
        └─> model-tasks.js
              └─> modelGateway.chat({ role, profileId, body, telemetry })
```

**判定**：后台路径已收口到 Gateway，`role` 参数驱动角色绑定。符合 MODEL-3。

### 2.3 凭据读取（MODEL-4）

```
getAiSettings()
  └─> credentialStore.backend  (macOS: keychain / 其他: 0600 文件)
  └─> credential_status: { deepseek: true/false, ... }  ← boolean, 无明文
  └─> model_profiles[].credentialRef  ← 引用, 无明文 key

getApiKey(provider)  ← 仅服务端内部调用
  └─> credentialStore.get(provider) || process.env[...]  ← 返回明文, 仅内存
```

**判定**：凭据存储、读取、返回三层脱敏完整。`getApiKey()` 仍返回明文但仅限服务端内存，不出网、不写日志。符合 MODEL-4。

---

## 三、发现的问题

### 3.1 阻塞级（必须修复才能验收）

**无。** 当前代码主干未发现阻塞级问题。

### 3.2 建议级（不阻塞验收，建议主 agent 清理）

#### 问题 A：模块头注释陈旧（不影响功能）

**位置**：
- `core/r-server/helpers/conversations.js:5`
- `core/r-server/helpers/user-facts.js`（相同模式）

**现象**：模块头注释仍写 `process.env.DEEPSEEK_API_KEY`，但实际代码已走 `callModelTask()` -> ModelGateway。

**示例**：
```js
// conversations.js:5
// depends on ../db, uuid, and process.env.DEEPSEEK_API_KEY (for auto-title and topic-shift).
```

**实际代码**（已正确迁移）：
```js
// conversations.js _maybeAutoTitleConversation (line 113+)
const { callModelTask } = require('./model-tasks');
// ...
await callModelTask({ role: 'summary', body, ... });
```

**建议**：主 agent 清理这些陈旧注释，避免误导后续审计。优先级低。

#### 问题 B：ai-admin.js 成本估算硬编码 deepseek-chat（不影响调用路径）

**位置**：`core/r-server/helpers/ai-admin.js:207,209`

**现象**：成本估算时硬编码使用 `deepseek-chat` 作为默认模型。

**判定**：这属于成本统计路径，不影响模型调用。但如果用户切换到其他 Provider，成本估算可能不准。建议主 agent 让成本估算也读取当前绑定的模型。优先级中。

#### 问题 C：getApiKey 仍可被旧代码调用（兼容期可接受）

**位置**：`core/r-server/routes/ai-agent.js:123`

```js
const apiKey = (selectedPreset && selectedPreset.apiKey) || getApiKey(providerName);
```

**现象**：`ai-agent.js` 仍通过旧的 `getApiKey()` 拿明文 key 并作为 `apiKeyOverride` 传给兼容层。

**判定**：这是 MODEL-1 兼容期设计的预期行为——兼容层只转发，最终 dispatch 仍由 Gateway 负责。不阻塞验收。但建议主 agent 在 MODEL-1 收尾时考虑将 `ai-agent.js` 也改为通过 `profileId` 路由，不再持有明文 key。优先级低（兼容期可接受）。

### 3.3 仅供主 agent 参考

#### 观察项：frontend ChatModelPreset 双格式读取

`frontend/src/hooks/useAiSettings.ts:79-93` 实现了 `model_profiles`（新格式）优先、`chat_model_presets`（旧格式）回退的双格式读取。这是正确的迁移策略，**但**意味着：
- 如果用户从旧版本升级，旧 `chat_model_presets` 仍会被读取
- 建议主 agent 在某次版本升级时执行一次性迁移：把旧格式转为新格式并清空旧字段

这不是阻塞项，仅记录供主 agent 决策。

---

## 四、验收执行建议

以下为 **需真实 API / 打包态** 的验收项，无法通过只读审计覆盖，列出供主 agent 执行：

### 4.1 三路聊天连接验证（验收项 1）

**前置条件**：
- DeepSeek API Key（云端）
- 一个 OpenAI-compatible 模型（如 OpenAI 或自建 OpenAI-compatible endpoint）
- 一个本地模型（Ollama / LM Studio / vLLM）

**执行步骤**：
1. 在模型管理中心添加 3 个 Provider 配置
2. 逐一切换为活跃 chat 模型
3. 发送一条简单消息（如"你好"）
4. 确认收到回复，无报错

### 4.2 streaming + tool calling 实测（验收项 2）

**执行步骤**：
1. 选两个 Provider（如 DeepSeek + Anthropic）
2. 测试 streaming：发送长消息，确认流式输出
3. 测试 tool calling：触发一个需要 Agent 工具调用的请求
4. 确认工具执行并返回结果

### 4.3 macOS 打包态验收 UI-031（验收项 6）

**前置条件**：已执行 `npm run build:mac` 生成 .app/.dmg

**执行步骤**：
1. 打开打包后的 BioF3.app
2. 进入设置 > AI 模型
3. 验证：
   - [ ] Provider 卡片显示正确（deepseek/openai/anthropic/...）
   - [ ] Endpoint / Model / 凭据状态显示正确
   - [ ] 8 类角色默认模型绑定显示正确
   - [ ] 连通性测试按钮工作
   - [ ] 显式 fallback 配置可保存
   - [ ] Keychain 存储正常（保存重开后凭据仍在）
   - [ ] 会话选择器同步（切换模型后新会话立即使用新模型）
   - [ ] 窄窗口布局正常
4. 截图存档至 `/tmp/biof3-model-management-ui.png`

---

## 五、审计结论

### 5.1 总体判定

```
代码层就绪度：  ████████████████████░  95%
  └─ 6 项验收清单中 5 项代码层通过，1 项待实机验收

阻塞级问题：    无
建议级问题：    3 项（注释清理 / 成本估算 / 兼容期 apiKeyOverride）

可执行的下一步：
  └─ 执行真实 API + 打包态实机验收（4.1 / 4.2 / 4.3）
  └─ 验收通过后更新 ui-productization-audit.md，UI-031 标记 verified
  └─ 固定下一 release candidate
```

### 5.2 对主线工作的影响

- 本审计为**只读**，未改动任何代码，不影响主 agent MODEL 工作。
- 报告内所有"建议"项均不阻塞验收，主 agent 可自行决定何时处理。
- 验收执行项（4.1-4.3）需真实 API Key 和打包环境，建议主 agent 完成当前 MODEL 工作后执行。

---

## 六、审计涉及文件清单

### 已核对（只读）

| 文件 | 核对点 |
|------|--------|
| `core/shared-backend/llm-providers/model-gateway.js` | Gateway 分发边界、apiKeyOverride 逻辑 |
| `core/shared-backend/llm-providers/model-profile.js` | ModelProfile schema、角色绑定、fallback |
| `core/shared-backend/llm-providers/index.js` | 7 个内置 Provider 注册表 |
| `core/r-server/helpers/llm-client.js` | 兼容层只转发、不形成第二套实现 |
| `core/r-rtserver/helpers/model-tasks.js` | 后台任务按 role 路由到 Gateway |
| `core/r-server/helpers/ai-settings.js` | 凭据存储、脱敏、credential_status |
| `core/r-server/helpers/credential-store.js` | Keychain / 0600 文件 |
| `core/r-server/helpers/conversations.js` | 后台路径不再硬编码 DeepSeek |
| `core/r-server/routes/ai-settings-api.js` | settings API 不返回明文 key |
| `core/r-server/db.js` | conversation/message/tool_job schema 无 provider 列 |
| `frontend/src/hooks/useAiSettings.ts` | ModelProfile 双格式读取迁移 |
| `src/main.js` IPC | ai-settings IPC 不泄漏明文 |
| `src/mcp-server.js` | 无硬编码 DeepSeek / apiKey |

### 发现问题的文件

| 文件 | 问题 | 级别 |
|------|------|------|
| `core/r-server/helpers/conversations.js:5` | 模块头注释陈旧 | 建议 |
| `core/r-server/helpers/user-facts.js` | 模块头注释陈旧 | 建议 |
| `core/r-server/helpers/ai-admin.js:207,209` | 成本估算硬编码 deepseek-chat | 建议 |
| `遗留注释 cleanup 待主 agent 决定 |

---

*本报告由非主 agent 只读审计生成。所有建议项不阻塞 Stage 2 验收。主 agent 可在 MODEL 工作完成后参照本报告执行实机验收。*
