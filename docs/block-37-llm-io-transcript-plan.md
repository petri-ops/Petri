# BLOCK-37 — 模型 I/O 信息流（全量捕获 + 本地持久化 + 会话级查看器）

> status: completed · truthDomain: `block-37-llm-io-transcript` · registered: 2026-09-02
> owner: main agent · branch: main（单工作包串行，前置 BLOCK-36 已 completed）
> 收口 2026-09-02：P1–P4 全部完成，UI-274 verified，证据 `acceptance/ui-274/`（4 截图 + evidence.json）。

## 1. 背景（用户需求 + 已调查事实）

用户：「每次和模型交互都会打包整个消息发送到模型端口，发送的消息是什么格式？这份消息以及模型提供商返回的完整消息能否做成信息流保存下来？」——用户裁决「按所有模型调用都存的方案立项」。

已核实的现状：
- 请求为 OpenAI 兼容 chat-completions 格式：`messages[]`（system / user / assistant+tool_calls / tool 四种角色）+ `tools` schema + 采样参数，每轮迭代全量重发完整历史（长任务后几轮请求体积显著）。
- 响应为 SSE 逐帧 delta（`content` / `reasoning_content` / `tool_calls`）+ usage 帧 + `[DONE]`，provider 层聚合为完整 `{choices:[{finish_reason, message}]} + usage`。
- **唯一收口点**：[model-gateway.js](../core/shared-backend/llm-providers/model-gateway.js) `ModelGateway` 的流式分支（provider.chatStream + onEvent）与非流式分支（provider.chat），覆盖 DeepSeek / DashScope / Anthropic 全部 provider 与 agent 任务 / 普通对话全部调用方。
- 现有 `task_events` 只落工具调用/结果事件，不含模型请求与响应原文；`conversation` 消息表只存清洗后的正文。

## 2. 方案（P1–P4 串行）

**P1 捕获 + 持久化（后端）**
- 新模块 `core/shared-backend/llm-providers/io-transcript.js`：
  - `createIoTranscriptSink({ dataDir })` → `record(call)` 追加式写 JSONL，按会话分文件：`<dataDir>/llm-transcripts/<conversationId>.jsonl`；无 conversationId 的调用归 `unattributed.jsonl`。
  - 每条记录：`{ ts, conversationId, iteration?, traceId, model, provider, request: { messages 全量, params }, response: { content, reasoning_content, toolCalls, finishReason, usage, frames, framesTruncated }, error?, sizeBytes, truncated }`。
  - 截断纪律：单条记录硬上限 8MB——超限时先丢 raw SSE 帧（保留聚合响应，即「返回的完整消息」仍完整），再丢 request.messages 中段（保首尾 + 诚实 `truncated` 标记）；写失败静默吞掉（fire-and-forget），绝不影响模型调用主链路。
- [model-gateway.js](../core/shared-backend/llm-providers/model-gateway.js) 两个分支埋点：包装 `onEvent` tee 原始帧；结果/错误终态后异步落盘。traceId 从 telemetry 取，conversationId 从 options 透传（调用方已有）。

**P2 只读端点（后端）**
- `core/biof3-server/routes/ai-agent/llm-transcripts.js`：
  - `GET /api/ai-agent/llm-transcripts?conversationId=` → 索引（ts/model/iteration/usage/sizeBytes/error 摘要，不含正文）。
  - `GET /api/ai-agent/llm-transcripts/record?conversationId=&ts=`（或 traceId）→ 单条完整记录。
  - 路径安全：conversationId 白名单校验（拒 `..`、`/`、空），文件不存在返回诚实空态。

**P3 前端信息流查看器（UI-274）**
- 会话级「模型 I/O」查看器：按时间倒序列出本会话全部模型调用（时间 / 模型 / 轮次 / tokens / 体积 / 错误标记），点击展开单条——请求 messages 按角色折叠树 + 响应聚合正文（含 reasoning / tool_calls / usage），SSE 帧数与截断标记诚实呈现。
- 入口：会话区现有工具区 icon 按钮（按需打开，不常驻，符合「界面干净」裁决）；样式全 token 化（`--biof3-*`，白底细边框风格）。
- 只读：不提供任何重放/编辑/删除。

**P4 实机收口**
- dev Electron：发起 agent 任务 + 普通对话各一轮 → 验证 jsonl 落盘内容与请求/响应一致（对照后端日志）→ 查看器索引/详情/截断标记 → 截图存 `acceptance/ui-274/` + evidence.json。

## 3. 范围与非范围

**非范围**：敏感信息脱敏（本地数据不外发，明文保存即需求本身）、历史会话回填（只存新调用）、raw 帧级回放 UI（存聚合响应已满足「完整消息」）、跨设备同步、SQLite 新表（JSONL 文件，避免膨胀主库）、G1+ 阶段事项（packaged/Provider/GA）。

**不变量**：0 新依赖；模型调用主链路零阻塞（落盘 fire-and-forget）；provider 协议转换逻辑不动（只在 gateway 埋点）。

## 4. 验收判据

- P1：node --test——sink 写入/分文件归档/8MB 截断纪律/写失败不抛；gateway 埋点流式+非流式各一用例（mock provider）。
- P2：node --test——索引/详情/路径安全/空态。
- P3：vitest——查看器索引渲染/详情展开/截断标记；tsc 0。
- P4：实机证据 `acceptance/ui-274/`。
- 门禁：`npm run docs:check` + `npm run ui:audit:check` 每提交必跑。

## 5. 完成语义

P1–P3 完成且门禁全绿 → 提交（UI-274 in_progress）；P4 实机证据齐 → UI-274 verified + 本 plan status completed + DOC-REGISTRY/AUDIT-LOG 同步。

G0 开发期常态 · 不外推 packaged / Provider / GA。
