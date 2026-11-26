# conv_99208eb5-6b7 错误分析 · 回归排查（owner「有错误 dev这个 你看看」）

> 只读核真：dev DB `.petri-dev-user-data/data/petri.db`（incidents / copilot_messages.meta_json.toolActivities）+
> `.petri-dev-user-data/data/llm-transcripts/conv_99208eb5-6b7.jsonl`（10 行）。会话数据零改。

## §0 会话总览

- 会话 2026-11-26 15:46:09 → 16:15:01Z（约 29 分钟），deepseek-flash，4 条消息（user×3 / assistant×1）。
- 首轮（15:46–15:47）正常执行 12 次工具活动（含 vision）；15:47:30 用户取消一次调用。
- 16:14:44 与 16:15:01 两条用户消息各触发一次 agent run，**均在 190ms / 238ms 内 http_error 失败**，无 assistant 落库。
- incidents 3 条：#19 `request_canceled`（todo_write）、#20/#21 `agent_run_failed`（harness_catch）。

## §1 错误清单与根因

| # | 时间 | 错误 | 证据 | 判定 |
|---|---|---|---|---|
|19|15:47:30.836|`request_canceled` / `todo_write`|toolActivity status=denied、messageKey=`agent_tool.request_canceled`、「请求已取消；该调用未执行」；首轮长跑 55.2s 后发生|**非回归**：用户主动取消，门正常拒绝未执行|
|20|16:14:45.190|`agent_run_failed` / `harness_catch`|incident.normalized=`Invalid 'tools[<n>].function.name': string does not match pattern. Expected '^[a-zA-Z0-9_-]+$'`；transcript `error=http_error`、190ms、frames=0、response=null|**回归（今日内置化）**|
|21|16:15:01.451|同上|同一错误、238ms、request_id 不同|**回归（同上）**|

**根因**：今日 `7f25f80e4` 把 `generate.image/video/model3d` 展开进 `TOOL_DEFS` 后，provider 工具投影
（`registry.js::projectProviderDefinition`）原样下发内核规范名；点号 `.` 违反 OpenAI 兼容 provider 的
`function.name` 正则 `^[a-zA-Z0-9_-]+$`，DeepSeek 在请求组装期直接 400 → 每条 agent run 未进入迭代即失败。
此前 `bb6064233` 虽定义了同样名字，但从未进入 `TOOL_DEFS`，所以不触发——这正是今天新增能力引入的回归。

## §2 与今日改动对照（逐项排除）

| 今日改动 | 是否相关 | 依据 |
|---|---|---|
| fullscreen 状态机 / native 全屏 | 否 | 纯渲染层；错误发生在后端 provider 请求组装期（190ms、frames=0） |
| 凭据后端统一 file / Ark key 绑定 | 否 | 错误文本是工具 schema 校验，非凭据/鉴权（若为 key 问题会是 401 且 message 不同） |
| 意图预设 / prompt-enhance 重试层 | 否 | 两轮均无 prompt enhance 活动；错误发生在首条 LLM 请求 |
| 创作包插件（P0-P3） | **是** | 仅当 generate.* 进入 TOOL_DEFS 后 tool 名才下发 provider；#20/#21 时间晚于 owner 重启加载内置修复 |
| 右栏合并 / 面板埋点 | 否 | 无 UI 面参与后端请求 |
| tool-route 九域收窄修复（a97790f0c） | 否 | 错误是 name 格式校验，发生在路由/收窄之后的下发阶段；且该修复本身不含改名字段 |

首轮 15:46–15:47 能正常迭代（12 工具活动）而后两轮立刻 400，与「owner 在这两轮之间重启后端、加载了含 generate.* 的新注册表」的时间线一致。

## §3 修复（HK-01 红绿）

- `core/petri-server/agent-tools/registry.js`：新增 `toProviderToolName`（非法字符→`_`）/ `fromProviderToolName`（可逆映射回内核规范名）；`projectProviderDefinition` 用投影名。
- `core/petri-server/agent-tools/agent-loop-control.js`：`parse()` 两处取 `fn.name` 后回填规范名再执行/查元数据；history 中 `tool_calls` 保留 provider 原名（审计不失真）。
- 效果：provider 侧看到 `generate_image/video/model3d`（合法），内核仍用 `generate.image/video/model3d`，handler/contract/活动/审批零改名。
- HK-01 `test/provider-tool-name-sanitize.test.mjs` 红 2/2 → 绿 2/2（全部 provider 名合法 + 可逆映射 + handler 可取）；连跑 `generate-builtin-tools` 共 6/6 绿。
- 实测 provider 工具清单 123 个、非法名 0 个、generate 投影名 4 个（含既有 `generate_methods`）。

## §4 防再犯机制对照

- 配置错不重试引导 / 工具契约三铁律：本会话未触发（错误在 LLM 请求层，模型尚未拿到工具清单），无法据此判定效果。
- 新防再犯钉：provider 工具名正则恒等测试进 `test:changed` 范围；后续任何新增工具若名字含非法字符即红，不再等到 owner 实机才发现。

## §5 待 owner 操作

工具注册表在后端启动期冻结，本次修复仍需**重启后端**。重启后同样两条消息应正常进入迭代；可用
`GET /api/ai/tool-approval-policy` 验收工具名（该端点显示内核规范名）与预算。
status: analysis_complete · regression_fixed · pending_owner_restart；会话数据只读未改。
