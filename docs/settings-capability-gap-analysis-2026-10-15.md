# 设置体系能力对照与差距分析（ZCode / Codex / Petri）· 2026-10-15

> **性质**：reference 态对照研究（非 active 工作包）。方法：三路只读探查（reference/ZCode 设置全量清点、reference/codex `config.schema.json` 全量解析、Petri 设置面 JSX 实读盘点）+ 交叉比对。参照库均 Apache-2.0，**模式借鉴零代码拷贝**。
> **纪律**：G0 开发期 · 不外推 packaged/Provider/GA；本文件不承载运行时证据。缺口建议=候选工作包，立项须用户裁决 + 三件套登记。
> **全量数据源**：ZCode ≈150 项（`packages/shared/src/validationAppSettings.ts` + `adapters/src/config/schema.ts`）；Codex 103 顶层键 / 195 definitions / 1402 字段路径（`codex-rs/core/config.schema.json`）；Petri 8 分区 ≈60 项（`DesktopSettingsPanel/**`）。

---

## 0. 结论摘要

| # | 结论 | 依据 |
|---|---|---|
| 1 | **Petri 设置面「治理深、入口浅」**：模型渠道（11 类控件）+ 决策原语（14 项）配置深度超过两端对照，但 `general` 仅 3 项、无快捷键面、无设置搜索、无统一导出/重置 → 用户「找不到、改不动、搬不走」 | §4 盘点 + §5 矩阵 |
| 2 | **最大结构性缺口=配置治理层**：ZCode 三层落点 + zod schema 驱动；Codex 九层优先级（−10…50）+ profile + requirements 约束层 + strict 校验；Petri 六个分散文件 + localStorage 双写 + SQLite，**无优先级模型、无 schema、无 profile、无 unknown-key 诊断** | §1 架构对比 |
| 3 | **可感缺口按价值排序**：①快捷键自定义 ②全局审批档位/工具黑白名单 ③设置搜索+导出重置 ④模型推理档位与压缩阈值 ⑤代理配置（隧道/网关场景刚需） | §6 优先级表 |
| 4 | **Petri 独有优势项**（两端都弱）：决策原语五接点阈值+台账回放、成本硬熔断、记忆生命周期治理面、审批指纹放行——这些是「可信与透明即能力」魂面，**不需补齐，只需解决可发现性** | §5 矩阵「Petri 更强」列 |
| 5 | 落地建议：**三阶段**（速赢 4 项 → 结构 3 项 → 治理 4 项），全部 G0 内闭环，不触碰 G1+ | §7 |

---

## 1. 配置体系架构对比（先看架构，再看项）

| 维度 | ZCode | Codex | Petri |
| --- | --- | --- | --- |
| 配置层数 | 3 层：桌面 `~/.zcode/v2/setting.json` / agent `~/.zcode/cli/config.json`+`<repo>/.zcode/config.json` / localStorage 轻量偏好 | 9 层带数值优先级（Packaged −10 < MDM 0 < System 10 < Enterprise 15 < User 20 < User+profile 21 < Project 25 < SessionFlags 30 < Legacy 40/50）——**项目层高于用户层**（易踩坑） | 6+ 落点无优先级：`user-prefs.json` / `ai-settings.json`(+`ai-credentials.json`/Keychain) / `decision-config.json` / `agent-rules.json` / `feature-flags.json` / `mcp-servers.json` + localStorage 双写 + SQLite（记忆/决策台账/技能偏好） |
| Schema 驱动 | zod `appSettingsSchema` + `.default()` 内联默认 + preprocess 迁移链 + 逐字段容错 | `schemars` 从 Rust 类型自动导出，根 `additionalProperties:false`，strict 校验基于 serde 忽略字段追踪（无需手写白名单） | 无 schema 层（TS 类型 + 手写校验）；无 unknown-key 诊断 |
| Profile | 子智能体 profile（15 字段）+ 模型/供应商模板 | `profiles.*` 38 键命名档（层内二级覆盖，deny_unknown_fields） | 无 |
| 托管约束层 | — | `ConfigRequirementsToml`（只能收窄不能放宽） | 无（用户规则层最接近） |
| 扩展资源作用域 | user / workspace 两级 + `.agents/*` 只读兼容 fallback，优先级 user>workspace>plugin | user / project / plugin / marketplace | user 为主（`.petri/MEMORY.md` 项目级）+ 领域包 |
| 快捷键 | 24 命令唯一源 + 用户覆盖 + 冲突检测 + 恢复默认 | 169 键位 / 11 分组 + vim 四层，`KeybindingsSpec` 单键/和弦/数组 | **无快捷键设置面**（仅命令面板 `Cmd+K` 真命令源） |
| 默认值策略 | 缺失即默认+显式关闭优先；一次性迁移标记位；坏文件隔离 `setting.json.corrupt-<ts>`；MCP 单 server 失败降级 warning 跳过 | 逐键 impl Default；strict 报「首个出错层」；大量 legacy 字段接受但忽略 | 部分具备（feature-flags env 锁定 409、unknown 回落 general） |
| 导入导出 | 设置同步向导（17 种外部 Agent × 5 类资源 × copy/symlink） | —（TOML 手写） | 仅模型渠道 JSON/CSV 导出导入 |

---

## 2. ZCode 设置项全量清单（≈150 项 · 按组）

### 2.1 基本设置（general，30 项）
| 设置项 | 作用 | 可选值/范围 | 默认 |
|---|---|---|---|
| localePreference 界面语言 | UI 语言 | system / zh-CN / en-US | system |
| interfaceMode 界面模式 | 编程/办公呈现 | coding / office | coding |
| proactiveSuggestionsEnabled 主动任务推荐 | 办公模式推荐 | bool | 关 |
| terminalInheritSystemProfile 继承系统终端 Profile | 终端环境字体继承 | bool | true |
| terminalFontFamily 终端字体 | 覆盖终端字体 | 字体名 | 自动 |
| integratedTerminalShell 集成终端 Shell | Win 下 Bash 用 shell | auto / shell{id,dialect,path} | auto |
| nativeSearchEnhancementsEnabled 增强 Find/Grep | 注入 bfs/ugrep | bool | true |
| httpProxy / httpProxyNoProxy / httpProxyCaCertPath | 代理/绕过/自定义 CA | URL / host 列表 / PEM 路径 | 空 |
| desktopChromiumHardwareAccelerationEnabled | 硬件加速 | bool | true |
| receivePreviewUpdates / autoDownloadAndInstallUpdates / skippedElectronUpdateVersions | 预览通道/自动安装/跳过版本 | bool / bool / Record | false/false/{} |
| closeToTrayOnWindows 关闭驻留托盘 | Win 关闭到托盘 | bool | true |
| keepAwakeWhileRunning 保持机器运行 | 防休眠 | bool | false |
| zcodeInteractionBehavior 交互行为 | 运行中输入：排队/引导 | queue / guide | queue |
| askUserQuestionAutoResolutionEnabled 提问自动继续 | 5 分钟无人答自动继续 | bool | true |
| modelIoFullRetentionEnabled 完整保留 Model I/O | 不轮转不裁剪 | bool | false |
| messageStreamShowReasoning / messageStreamShowTodos | 思考过程/待办展示 | bool | true / false |
| toolGroupingExplore/Terminal/ChangesEnabled | 工具分组聚合（Explore/Terminal/Changes） | bool×3 | true/true/false |
| dynamicWorkflowMode 动态工作流 | 工作流模式 | disabled / onDemand / alwaysOn | 跟随服务端 |
| taskAutoArchiveEnabled / taskAutoArchiveOlderThanDays | 自动归档/保留天数 | bool / 1–365 | false / 7 |
| dataBaseDir 数据目录 | 数据根路径 | 路径 | homedir |
| desktopZoomLevel / desktopWindowSize | 缩放/窗口尺寸 | −3…5 / w≥480,h≥640 | 自动 |
| onboardingOccupation / onOpenOnboardingDialog | 引导画像/重跑引导 | 16 项枚举 / 按钮 | null |
| recentProjects / startPlanRecommendationDismissed | 最近项目/推荐关闭 | string[]≤10 / bool | [] / false |

### 2.2 编辑器与工作区（4 项 · 无编辑器设置）
| 设置项 | 作用 | 取值 | 默认 |
|---|---|---|---|
| .zcodeignore 工作区搜索忽略 | 搜索/索引忽略（gitignore 语法，可从 .gitignore 同步/恢复） | 文本 | 模板 |
| hooks 逐条信任 | 工作区 hook 未信任需审核 | 逐 hook | 未信任 |
| （无 tabSize / autoSave / formatOnSave） | ZCode 无编辑器组 | — | — |

### 2.3 AI 模型与推理（40 项 · 最深的一组）
| 设置项 | 作用 | 可选值 | 默认 |
|---|---|---|---|
| provider.name / group / visibility / logo | 供应商显示名/分组/显隐/Logo | 串 / standard-personal\|zai-family\|bigmodel-family / visible\|hidden / builtin | — |
| api.type 协议类型 | 供应商 API 协议 | anthropic-messages / openai-chat-completions / openai-responses | — |
| api.baseUrl / api.headers | 端点/自定义头 | URL / Record | — |
| access.apiKey / apiKeyManagementUrl | 密钥（凭据服务托管）/取 key 链接 | 串 / URL | — |
| access.mode 账号模式 | 订阅/套餐类别 | start-plan\|individual-coding-plan\|team-coding-plan\|off-peak\|highspeed | — |
| useSubscription 使用订阅 | 走订阅额度 | bool | — |
| builtinModelIds / personalModelIds / modelOrder | 内建/自建模型与排序 | string[] | — |
| modelId / modelDisplayName / model.enabled | 模型标识/展示名/启停 | 串 / 串 / bool | — |
| properties.contextWindow | 上下文窗口 | 正整数 | — |
| optionSpecs.maxOutputTokens + map | 输出上限与映射 | {max,map} | — |
| optionSpecs.reasoningLevel + reasoningLevelMapping | 推理档位序列与上游映射 | {values[],map} | — |
| supportsToolCall / supportsJsonSchemaOutput / supportsNativeWebSearch / supportsMidConversationSystem / requiresMfjsToolSchema | 模型能力位 | bool×5 | — |
| inputFormat / outputFormat | 输入模态（text/image/video/audio/pdf）/输出 | 多选 | — |
| providerFamilyDomain / providerFamilyConnectionSelections | 账号域/每 family 唯一连接 | zai\|bigmodel / Record | {} |
| enabledBuiltinAgentCliProviders | 内置 agent CLI 启用集 | 归一化数组 | 默认集 |
| zcodeEndpointOrigin | 端点覆盖（开发） | URL | — |
| modelStream.idleTimeoutMs / network.timeout | 流空闲超时/网络超时 | 正数 | — |
| modelAnomalyGuard.toolCallWarningThreshold / repeatedToolCallWarningThreshold / maxBudgetWarningsPerTurn | 异常守卫阈值 | 正整数 | — |

### 2.4 Agent 行为（45 项）
| 设置项 | 作用 | 可选值 | 默认 |
|---|---|---|---|
| permission.mode 权限模式 | 会话审批策略 | build / edit / plan / yolo / guarded / auto | 依入口 |
| permission.allowedTools / disallowedTools | 工具白/黑名单 | string[] | — |
| autoApproveHighRisk / allowMediumRiskInAuto | 高风险自动批准/自动模式放开中风险 | bool | — |
| features.compact / rewind / subagent / memory / skill / mcp | 六大能力总开关 | bool | 关 |
| memoryEnabled + memory.use | 记忆总开关 | bool | false |
| toolConcurrency.maxConcurrency | 工具并发上限 | 正数 | — |
| storage.dir / storage.sessionDbPath | 会话数据目录/DB 路径 | 路径 | — |
| AgentProfile ×15：name/description/modelSelection/color/maxTurns/tools/disallowedTools/skills/mcpServers/memory(user\|project\|local)/background/injectAgentsMd/systemPrompt/source | 子智能体声明式 profile | 见左 | 继承/全部 |
| hooks.enabled / timeoutMs / maxOutputBytes | hooks 总开关+超时+输出截断 | bool/正数 | 关 |
| hooks.events（7 事件）SessionStart/UserPromptSubmit/PreToolUse/PermissionRequest/PostToolUse/PostToolUseFailure/Stop | 事件绑定 | 多选 | — |
| hooks.type / matcher / async / shell / timeout / statusMessage | 单 hook 定义 | process\|command / 串 / bool / 路径 / 秒 / 串 | — |
| logging.level / logging.format | 日志级别/格式 | debug\|info\|warn\|error / text\|json | — |
| ui.locale / ui.theme | CLI 语言/主题 | auto\|en-US\|zh-CN / auto\|dark\|light | — |
| performanceMode 性能模式 | 精简渲染（localStorage） | bool | false |

### 2.5 快捷键（24 命令 + 覆盖表）
openCommandCenter(`Cmd/Ctrl+k`,`Cmd/Ctrl+Shift+p`)｜openSettings(`,`)｜findInTask(`f`)｜toggleSidebar(`b`)｜switchTheme(`Cmd/Ctrl+Shift+l`)｜toggleTerminal(`j`)｜toggleSidePane(`Cmd/Ctrl+Alt+b`)｜previous/nextConversation(`[`/`]` 配 Shift)｜navigateBack/Forward(`[`/`]`)｜openModelMenu(`Ctrl+m`)｜cycleSessionMode(`Ctrl+Shift+m`)｜cycleThoughtLevel(`Ctrl+t`)｜newTask(`n`)｜openWorkspace(`o`)｜closeActiveContext(`w`)｜zoomIn/Out/Reset(`=`/`-`/`0`)｜composerSend(`Enter`)｜composerInsertNewline(`Shift+Enter`)｜toggleInterfaceMode(`Cmd/Ctrl+Shift+u`)｜openOnboarding(`Cmd/Ctrl+Shift+o`)｜**shortcutBindings 覆盖表**（Record，冲突检测 + 恢复默认）

### 2.6 主题与外观（9 项）
theme(system|zai-dark|zai-light，默认 zai-dark)｜uiFontSizePx(12–20，默认 14)｜interfaceMode｜codePreview.lightTheme/darkTheme(shiki 主题集)｜showLineNumbers(true)｜wrapLongLines(false)｜fontSizePx(12–20，默认 12)｜（accent/圆角/z-index/动效/密度=设计 token，**非用户可配**）

### 2.7 隐私与安全（4 项 + 2 强制）
embeddedBrowserAllowInsecureCertificates(false)｜httpProxyCaCertPath｜hooks 信任审查｜API Key 托管（凭据服务，非明文 setting.json）｜Model I/O 脱敏（强制始终脱敏）｜（无用户可见遥测/崩溃/留存开关）

### 2.8 扩展与集成（35 项）
MCP：name/type(stdio|http|sse)/command+args+cwd/env/url+headers/oauth(client_credentials|authorization_code)/protocolVersion(auto|legacy|2026-07-28)/timeoutMs/enabled(true)｜插件：plugins.enabled/dirs/enabledPlugins/extraKnownMarketplaces(6 源)/options/suppressedBuiltins｜技能：skills.enabled/includeInstructions/metadataBudget/roots/逐技能 enable｜slash command 逐条 enable｜ComputerUse 总开关+输入框按钮显隐｜浏览器控制+视口偏好｜**外部 Agent 配置导入（17 种 × 5 类资源 × copy/symlink）**｜远程资源同步（RemoteMcp/Plugin/Skill Sync）

### 2.9 通知/统计/迁移（6 项）
notificationEnabled / notificationSoundEnabled｜UsageStatsSection（App + Coding Plan 双 Tab）｜MigrationSection（Claude 历史迁移）｜AutomationsSection（Beta，分区已隐藏）

---

## 3. Codex 配置项全量清单（103 顶层键 · 按组 · 摘关键项）

> 全量字段路径 1402 条（`profiles.*` 镜像约 700 条），权威源 `codex-rs/core/config.schema.json`；以下为按组摘录的关键键，**未列出的同组键属同类枚举/结构体**。

### 3.1 基本运行（~20 键）
model_provider｜oss_provider｜openai_base_url｜chatgpt_base_url｜profile｜analytics.enabled(true)｜feedback.enabled(true)｜**history.persistence(save-all/none，默认 save-all)**｜**history.max_bytes**｜notify(外部命令)｜check_for_update_on_startup(true)｜suppress_unstable_features_warning｜log_dir｜sqlite_home｜**allow_login_shell(true)**｜allow_symlinked_codex_home｜**background_terminal_max_timeout(300000ms)**｜notice.*(12 一次性提示)｜file_opener(vscode/insiders/windsurf/cursor/none)｜instructions｜developer_instructions｜include_*_instructions×4｜personality(已废弃)
**遥测 OTEL 全套**：otel.environment(dev)｜otel.exporter(none 默认)｜otel.metrics_exporter(statsig)｜**otel.log_user_prompt(false)**｜**otel.log_agent_responses(false)**｜otel.log_guardian_assessments(false)｜otel.tool_result.max_bytes(2048)｜otel.span_attributes/tracestate｜features.network_proxy.*(14 键：mode/domains/unix_sockets/socks5/credential_broker/dangerously_allow_*)｜features.respect_system_proxy / system_proxy_fallback

### 3.2 模型与推理（~30 键）
model｜**review_model**｜model_context_window(90% 有效)｜model_catalog_json｜**model_providers.\***：name/base_url/env_key/env_key_instructions/wire_api(responses)/query_params/http_headers/env_http_headers/request_max_retries/stream_max_retries/stream_idle_timeout_ms/websocket_connect_timeout_ms/supports_websockets/supports_standalone_web_search/requires_openai_auth/model_catalog_url/auth.*(外部命令取 token)/aws.*/gateway_oauth.*｜**model_reasoning_effort(minimal…xhigh)**｜plan_mode_reasoning_effort｜**model_reasoning_summary(auto/concise/detailed/none)**｜model_verbosity(low/medium/high)｜service_tier(default/priority/flex)｜hide_agent_reasoning(false)/show_raw_agent_reasoning｜**model_auto_compact_token_limit + _scope(total/body_after_prefix)**｜**model_post_turn_compact_threshold_percent**｜compact_prompt / experimental_compact_prompt_file｜**tool_output_token_limit**｜model_instructions_file｜features.token_budget.*(8)/rollout_budget.*(5)｜agents.default_subagent_model

### 3.3 Agent 行为与审批（~45 键）
**approval_policy** = on-request | **{granular}** | never；**granular.sandbox_approval / rules / mcp_elicitations（必填 bool，false=自动拒绝而非弹窗）** / request_permissions(false) / skill_approval(false)｜approvals_reviewer(user/auto_review/guardian_subagent)｜**sandbox_mode(read-only/workspace-write/danger-full-access，默认 read-only)**｜sandbox_workspace_write.network_access(false)/writable_roots[]/exclude_slash_tmp/exclude_tmpdir_env_var｜**projects.\*.trust_level(trusted/untrusted)**｜web_search(disabled/cached/indexed/live，默认 cached) + context_size + allowed_domains + location｜tools.update_plan.enabled / experimental_request_user_input｜**~/.codex/rules/\*.rules（allow/prompt/forbidden 三态）**｜**permissions.\* 命名权限档**（description/extends/filesystem/network/workspace_roots）｜**hooks.<12 事件>**（matcher + handler type(command/mcp_tool/prompt/agent) + async/timeout/statusMessage/additionalContextLimit + hooks.state.trusted_hash）｜**agents.\***（enabled/max_depth/max_concurrent_threads_per_session/interrupt_message/default_subagent_model/default_subagent_reasoning_effort + 角色 config_file）｜features.multi_agent_v2.*(22)｜auto_review.*(6) / features.guardianv2.*(19)

### 3.4 TUI / 键位 / 环境（~90 键）
tui.theme｜alternate_screen｜**animations(true)**｜**effects.{effort,progress,shimmer,starfield,title,welcome}(true×6)**｜copy_on_select｜mouse_scroll_speed(1.0)｜right_click_paste｜**vim_mode_default(false)**｜raw_output_mode｜notifications(true)+notification_method(auto/osc9/bel)+**notification_condition(unfocused/always)**｜status_line/status_line_use_colors｜terminal_title｜show_tooltips/auto_recap/fullscreen_transcript｜**rendering.{lists,math,mermaid,tables}**｜resume_cwd / session_picker_view / agents_overview_grouping / pet｜**tui.keymap.\*（11 组 169 键：global15/editor17/chat10/agents12/approval8/list10/pager11/composer5/vim_normal36/vim_operator20/vim_search4/vim_text_object9）**｜shell_environment_policy.{inherit(core/all/none), include_only, exclude, set, filters, ignore_default_excludes}

### 3.5 项目上下文（~25 键）
**project_doc_max_bytes(32768)**｜project_doc_fallback_filenames[]｜**project_root_markers([".git"])**｜AGENTS.md + AGENTS.override.md（root→cwd 分层拼接 + 并发祖先探测上限 256）｜skills.config[]（name/path/enabled）+ bundled.enabled + include_instructions + max_context_tokens + 特性门（skill_search/skip_host_skill_discovery/skill_mcp_dependency_install/skill_env_var_dependency_prompt）｜plugins.\*.enabled + plugins.\*.mcp_servers.\*（enabled_tools/disabled_tools/default_tools_approval_mode）｜**apps/connectors 策略**（default_tools_enabled/destructive_enabled/open_world_enabled/approvals_reviewer/omit_tools_from）｜marketplaces.\*｜**memories.\*（14 键：use/generate/dedicated_tools/dual_write/version(v1/v2)/extract_model/consolidation_model/各上限）**｜goals.max_goal_token_budget

### 3.6 隐私与安全（~20 键）
**cli_auth_credentials_store(file/keyring/auto/ephemeral)**｜mcp_oauth_credentials_store(auto/file/keyring)｜features.secret_auth_storage / credential_masking｜forced_login_method(chatgpt/api)｜forced_chatgpt_workspace_id｜**mcp_servers.\*.default_tools_approval_mode(auto/prompt/writes/approve)** + tools.\*.{approval_mode, output_token_limit}｜mcp_servers.\*.auth(oauth/chatgpt/ema_auth) + oauth.\*｜mcp_enterprise_managed_auth.idp｜network_proxy danger 开关（默认 false）｜windows.sandbox(elevated/unelevated/mxc) + 沙箱后端选择｜computer_use.default_app_access + 按应用粒度授权（macOS bundle_ids / Windows aumid）｜browser_use.default_origin_policy + origins.\*｜memories.disable_on_external_context

### 3.7 扩展与集成（~30 键）
mcp_servers.\*：command/args/url/env/env_http_headers/env_vars[]/http_headers/http_headers_helper/bearer_token_env_var/environment_id/enabled/required/**enabled_tools/disabled_tools**/tools.\*策略/**startup_timeout_sec**/**startup_readiness(connection/catalog)**/**tool_timeout_sec**/tool_input_schema_max_bytes(5000)/supports_parallel_tool_calls/omit_tools_from(code_mode/deferred/direct)｜mcp_oauth_callback_port/url｜mcp_optional_startup_grace_ms(1000)｜features.enable_mcp_apps / mcp_2026_07_28 / non_prefixed_mcp_tool_names｜features.code_mode.\*(7) / responses_websockets(_v2) / realtime_conversation / remote_models / remote_compaction_v2｜realtime.\*(type/version/transport/voice 34 音色)｜audio.\*｜cloud.skills / orchestrator

### 3.8 多层配置机制（~20 键 · Codex 独有）
ConfigLayerSource 9 变体 precedence −10…50（**项目层 25 > 用户层 20**；企业托管 15 < 用户）｜build_cli_overrides_layer（`-c a.b.c=v`）｜feature 布尔↔table 自动互转（is_structured_feature_path）｜merge_toml_values 深合并｜ConfigLayer{name,version,disabled_reason}｜CloudConfigFragment｜profiles.\*（38 键，deny_unknown_fields）｜**config_error_from_ignored_toml_fields（strict 校验基于 serde 忽略字段追踪）**｜unknown_feature_toml_value_field / unknown_tui_toml_value_path 定向诊断｜first_layer_config_error_from_entries（首个出错层优先）｜ConfigRequirementsToml（托管约束层，「只能收窄」）

---

## 4. Petri 现状全量清单（8 分区 ≈60 项）

### 4.1 常规 general（**3 项**）
theme(system/light/dark，system)｜界面字号 80–140% step5（100%）｜accent 5 档 teal/blue/violet/rose/amber（teal）

### 4.2 模型接口 models（11 类 ≈40 控件 · 深度最强区）
temperature(0–2 step.1，空=0.4)｜max_tokens(≥256 step256，空=16384)｜识图模型角色绑定｜逐渠道：协议(openai-compatible|anthropic)/供应商名/Base URL/Key(密码框+credential_updates)/默认模型/上下文(64K/128K/1M 文本)/能力位 reasoning+vision｜连通性测试｜删除渠道｜**Agent 自动容错(bool false)** + **Agent 备用模型多选**｜添加渠道｜**导出 JSON/CSV（含 Key 明文需确认）** + **导入配置（按 id/baseUrl 合并）**｜8 类角色绑定（chat/agent/planner/vision/embedding/summary/report/explanation）

### 4.3 计算与数据 compute
默认执行目标（本机/SSH 别名/fed:peerId）｜SSH 别名注册 + 探测/移除｜联邦节点探活（2 分钟在线窗）｜本地数据目录（**只读**+打开目录）｜运行环境包 R/Python 清单（只读）｜回收站（恢复/永久删除/清空）

### 4.4 用量与资源 usage
**任务成本熔断（¥，0/空=不熔断）**｜30 天调用/Token/缓存/成本｜供应商速率(tok/s+延迟)｜机器资源快照（CPU/内存/磁盘/活跃 Job，10s 刷新）｜按模型 TOP20 成本归因｜决策调用观测 7 天｜最近 20 条决策回放

### 4.5 决策原语 decisions（14 项 · 治理密度最高）
规则：匹配器类型(path-glob|command-token)/匹配模式/动作(require-ack|deny)/备注/作用域(global 硬编码)｜决策模型：端点 URL(默认 api.typesafe.ai)/API Key(不回显)/模型 pin(Jev jev-1.13.0)/一键预设 Jev·Laya｜5 接点启用(topic-shift/knowledge-guard/marker-celltype/intent-route/tool-route) + 5 阈值(0–1 step.05，可一键还原)｜记忆：单条遗忘/纠错 superseded/清除摘要/审批记录只读

### 4.6 运行时与诊断 diagnostics（**零可配置项**）
本地服务进程快照（5s 轮询）｜R/Python 就绪徽标｜打开日志目录/系统终端

### 4.7 实验特性 experimental（4 项）
任务完成桌面通知｜Agent 工作台 ResultCard 渲染｜会话历史后端拼装 B1｜长会话自动压缩 B2｜Agent 长任务韧性

### 4.8 隐私与维护 maintenance（3 项）
开启错误反馈（匿名遥测，默认 false）｜应用更新（检查/下载/安装四态）｜导出诊断日志

### 4.9 落点与接口面
持久化：`user-prefs.json`(+localStorage 双写) / `ai-settings.json`(0600) / `ai-credentials.json`或 Keychain / `decision-config.json` / `agent-rules.json` / `feature-flags.json` / `mcp-servers.json`（CAP-2 加密）/ SQLite（记忆三层 + decision_log + 技能偏好 + 回收站状态）
HTTP：`/api/ai/settings`(+test) `/api/ai/generation-defaults` `/api/ai/agent-rules` `/api/ai/decisions/*` `/api/ai/agent/cost-cap` `/api/user/prefs` `/api/feature-flags` `/api/mcp/servers*` `/api/remote-targets*` `/api/federation/peers*` `/api/ai/facts|memories|memory-audit` `/api/harness/resource-snapshot` `/api/ai/agent/guard-events`
IPC：`aiSettings:*`（5 通道）`petri:agent-workbench-flags` `data:*` `harnessCapabilities:list` `diagnostic:export` `updater:*` `terminal:*` `skills:*` `mcpConfig:*` `telemetry:report` `ssh:register-host`

---

## 5. 差距矩阵（按能力域 · Petri vs 两端）

| 能力域 | ZCode | Codex | Petri 现状 | 差距判定 | 价值 |
|---|---|---|---|---|---|
| 快捷键自定义 | 24 命令+冲突检测 | 169 键位 11 分组 | **无设置面**（仅 Cmd+K 面板） | 🔴 缺失 | ★★★★★ 用户可感强、与命令面板同源 |
| 设置搜索/过滤/重置 | 分区导航+恢复默认 | TOML 手改 | **无搜索、仅决策阈值单点还原** | 🔴 缺失 | ★★★★ 8 分区+散落文件下找回成本高 |
| 全景导出/导入 | 17 种外部 Agent 导入向导 | — | 仅模型渠道 JSON/CSV | 🔴 缺失 | ★★★★ 迁移与备份刚需 |
| 配置 schema/优先级/profile | zod+三层 | 9 层+profile+requirements | **无** | 🔴 缺失 | ★★★★ 多 agent/多端一致性的地基 |
| 全局审批档位选择器 | permission.mode 6 档 | approval_policy+Granular | 逐条用户规则，无全局档位 | 🔴 缺失 | ★★★★★ 治理透明魂面直击「重机制轻入口」 |
| 工具白/黑名单 | allowed/disallowedTools | enabled_tools/disabled_tools+逐工具策略 | 投影上限 40 硬编码，用户不可配 | 🔴 缺失 | ★★★★ |
| 并发/深度/轮数上限 | toolConcurrency.maxConcurrency | agents.max_depth/max_concurrent | env 固定（并发缺省 3/深度 1） | 🟡 部分（env 隐藏） | ★★★ 需暴露为设置 |
| 子智能体 profile | 15 字段声明式 | agents.\* 角色 config_file | 无（模型可选 + 并发缺省） | 🔴 缺失 | ★★★★ 编排可解释性 |
| hooks 配置面 | 7 事件+逐条信任 | 12 事件+trusted_hash | 无（BLOCK-124 曾判「纯开发设施不产品化」） | 🟡 需重新裁决 | ★★★ |
| 项目/工作区信任 | workspace hooks 信任 | projects.\*.trust_level | 无 | 🔴 缺失 | ★★★★ 本地 agent 安全基线 |
| 命名权限档 | — | permissions.\* extends 继承 | 无 | 🟡 可延后 | ★★ |
| 模型推理档位/映射 | reasoningLevel+映射表 | reasoning_effort/summary/verbosity/service_tier | 仅「思考能力」能力位 checkbox | 🔴 缺失 | ★★★★ |
| 压缩策略可配 | features.compact 开关 | 阈值+scope+百分比+prompt 覆盖+工具输出预算 | env flag + 0.85 硬编码 | 🔴 缺失 | ★★★★ |
| 记忆深度设置 | 总开关+metadataBudget | memories 14 键（提取/整合模型+上限+双写） | 生命周期治理面板（衰减/纠错/审计） | 🟡 Petri 更强（治理）缺可配 | ★★★ |
| 上下文窗口设置 | properties.contextWindow | model_context_window(+scope) | 有（文本框 64K/128K/1M） | ✅ 已有 | — |
| 工具输出 token 预算 | — | tool_output_token_limit | 无 | 🟡 | ★★ |
| Web 搜索策略 | 模型能力位 | 模式+context_size+域名白名单+定位 | 无 | 🟡 | ★★ |
| 代理/网络 | httpProxy+noProxy+CA+浏览器证书 | network_proxy 14 键+系统代理 | **无** | 🔴 缺失 | ★★★★★ 隧道/网关/企业代理刚需 |
| 凭据存储位置 | 凭据服务托管 | cli_auth_credentials_store(keyring/file/auto/ephemeral) | Keychain/加密文件自动 | 🟡 可选暴露 | ★★ |
| 历史留存/自动归档 | taskAutoArchive+天数+history | history.persistence+max_bytes | 回收站手动 | 🔴 缺失 | ★★★ |
| 数据目录可配 | dataBaseDir | CODEX_HOME/log_dir/sqlite_home | **只读展示** | 🔴 缺失 | ★★★ 多盘用户刚需 |
| 外观（预览/通知/动效/密度） | 代码预览 4 项+通知 2 项+性能模式 | tui.effects 6 项+通知方式/时机+渲染开关+vim | theme/字号/accent（design charter 棘轮在役） | 🟡 部分 | ★★★ |
| MCP 深度策略 | type/OAuth/protocolVersion/timeout | 逐工具 approval+白黑名单+超时+readiness+企业 IdP | stdio 连接+投影上限+执行语义四档（用户不可配） | 🟡 部分 | ★★★★ |
| 外部 Agent 配置导入 | 17 种 × 5 类 | — | 无 | 🔴 缺失 | ★★★★ 迁移成本 |
| 遥测/日志透明开关 | 无用户可见 | analytics/feedback/OTEL 全套（prompt 记录默认 false） | 错误反馈 toggle（默认 false） | 🟡 可深化 | ★★★ 「可审计」卖点可做成本地开关 |
| 更新策略 | 预览通道/跳过版本/自动安装 | check_for_update_on_startup | 四态检查/下载/安装 | 🟡 可深化 | ★★ |
| i18n | localePreference | — | 无（D-04 deferred） | ⛔ 阻塞于产品决策 | — |
| 决策原语/成本熔断/记忆审计 | 无 | 无 | **Petri 独有** | ✅ 更强 | 差异化守 |

---

## 6. 优先级建议表

| 优先级 | 功能 | 参照 | 现状 | 实现价值 | 体量 | 依赖/风险 |
|---|---|---|---|---|---|---|
| **P0-1** | 快捷键设置面（键位录制+冲突检测+恢复默认） | ZCode 24 命令 / Codex 11 分组 | 无 | 命令面板已有真命令源，增设面即得可感自定义；办公场景刚需 | 小-中 | 需快捷键冲突与菜单 accelerator 双向对账 |
| **P0-2** | 全局审批档位选择器 + 工具白/黑名单 + 并发/深度暴露为设置 | Codex approval_policy+Granular / ZCode permission.mode | 逐条规则 | 直击「治理重入口浅」；把四档×动态判定从机制变可操作 | 中 | 既有语义零破坏（BLOCK-180 审批资源/指纹放行链） |
| **P0-3** | 设置搜索 + 分区过滤 + 全景导出/导入/按区重置 | ZCode 恢复默认/导入向导 | 无 | 8 分区散列下找回与备份成本高；导出含凭据须沿用安全确认 | 小-中 | 导出含 Key 明文 → 沿用 models 导出既有确认+脱敏策略 |
| **P0-4** | 代理设置（httpProxy/noProxy/CA） | ZCode 3 项 / Codex network_proxy | 无 | 隧道/网关/企业代理场景真需求（项目已有隧道经验） | 小 | 需重启生效提示；与网关本地回环互不干扰 |
| **P0-5** | 模型推理档位（reasoning effort 档位+映射） | ZCode reasoningLevel 映射 / Codex effort×summary×verbosity | 仅能力位 checkbox | 与已有 vision/reasoning 能力位同源；直接影响质量与成本 | 小-中 | maxTokens 下限教训（≥8192）需校验 |
| **P1-1** | 配置 schema 层 + 统一配置服务（优先级模型+unknown-key 诊断+profile 雏形） | Codex 9 层+strict / ZCode zod | 无 | 多 agent/多端/未来设置同步的地基；也是 P0-3 的实现载体 | 大 | 触及全部设置落点，需单独包与迁移窗口 |
| **P1-2** | MCP 逐工具策略面（白名单/超时/审批档位/启用） | Codex tools.\* / ZCode timeout+enabled | 硬编码 | 扩展中心四货架已有底座，用户可配是自然延伸 | 中 | 执行语义四档与审批门须一致 |
| **P1-3** | 记忆与压缩设置面（压缩阈值/策略、记忆提取模型与上限、记忆作用域） | Codex memories 14 键+压缩 5 键 / ZCode compact+metadataBudget | env+硬编码 | 「证据自证/可审计」魂面可配化；BLOCK-172 只做了展示环 | 中 | 压缩阈值影响 evals 判据，需与评测基线对齐 |
| **P2-1** | 子智能体 profile 声明式配置面 | ZCode AgentProfile 15 字段 | 无 | 编排可解释性；CP-8/CP-9 已有底座 | 中 | 与并发/汇报门默认值对账 |
| **P2-2** | 项目/工作区信任级别 + 命名权限档 | Codex trust_level / permissions.\* | 无 | 本地 agent 安全基线；与用户规则层协同 | 中-大 | 信任模型需与 hooks/扩展裁决一并 |
| **P2-3** | 外观扩展：代码/结果预览专项 + 通知方式/时机 + 动效/密度/性能模式 | ZCode 4+2+1 / Codex effects 6+通知 3+渲染 4 | theme/字号/accent | 质感补齐；design charter 棘轮需扩档 | 小-中 | 触碰 design charter=须证据批 |
| **P2-4** | 外部 Agent 配置导入（Codex/ZCode → Petri） | ZCode 17 种 × 5 类 | 无 | 迁移体验；一次性降低切换成本 | 中 | 合规：只读解析他人配置，不拷贝实现 |
| **P2-5** | 数据目录可配 + 历史留存/自动归档策略 | ZCode dataBaseDir+taskAutoArchive / Codex history.\* | 数据目录只读 | 多盘用户刚需 | 小 | 迁移既有数据需备份与回退路径 |
| **P2-6** | hooks 配置面（需重新裁决产品化定位） | ZCode 7 事件 / Codex 12 事件 | 无 | 生态扩展性 | 中 | BLOCK-124 曾判「不产品化」，重开需用户裁决 |
| **⛔** | i18n 资源层 | ZCode localePreference | 无（D-04 deferred） | — | 大 | **阻塞于产品决策**，不并入本路线 |

---

## 7. 分阶段落地方案（G0 内 · 建议形态）

### 阶段 A · 速赢层（价值即时可见 · 建议合并为一个工作包）
**范围**：P0-1 快捷键面 + P0-3 设置搜索/导出重置 + P0-4 代理设置 + P0-5 推理档位。
**理由**：四项目零/低依赖、互不冲突、全部命中「用户可感完成度」判词；P0-3 为 P1-1 预留入口形态。
**门禁**：红绿先行（键位冲突/导出脱敏/代理生效/档位映射契约）+ UI 台账条目 + closeout 十一门。
**验收**：键位可改可冲突可恢复默认；8 分区可搜索；含凭据设置可导出（沿用安全确认）可按区重置；代理三项可配并提示重启；reasoning 档位可选且映射可编辑。
**体量**：小-中 ×4，可按预授权整波连打。

### 阶段 B · 结构层（地基）
**范围**：P1-1 配置 schema+统一服务 → P1-2 MCP 逐工具策略 → P1-3 记忆/压缩设置面。
**理由**：先地基再挂件；P1-3 完成后与评测基线 v2 的 context/压缩判据天然对齐。
**门禁**：schema 契约测试 + 迁移幂等 + unknown-key 诊断 + 旧落点兼容回归（读旧文件不迁也能跑）。
**验收**：单一真值源；键路径可寻址；schema 与 UI 字段一致（漂移即红）；MCP 逐工具策略与执行语义四档一致；压缩/记忆参数可配且有事件可观测。
**体量**：中-大，建议拆两个包（B1 配置地基、B2 扩展与上下文设置）。

### 阶段 C · 治理层（纵深）
**范围**：P2-1 子智能体 profile + P2-2 信任级别/权限档 + P2-3 外观扩展 + P2-4 外部配置导入 + P2-5 数据目录/留存。
**理由**：机制已在库（CP-8/9、用户规则层、design charter），本阶段只做可配置面与纵深；hooks（P2-6）与 i18n（⛔）待裁决后再排。
**门禁**：默认语义零破坏断言（全部新增项默认=现状）；敏感项（信任/权限档）默认值最保守且可审计留痕。
**体量**：中 ×5，可按季度节奏逐项。

### 排队与纪律建议
- 阶段 A 建议作为**新的 active 工作包**与 BLOCK-184 串行（二者文件面零交叠：BLOCK-184 只动台账与证据，A 动设置面组件与新路由）；
- 每包发令前置条件照旧：dev 栈在跑 + 用户裁决 + 三件套登记 + 立项自检问句（形态须长出本地可审计/治理透明/证据自证之一）；
- i18n 与 hooks 两项**不并入本路线**，保持待裁决登记。

---

## 8. 显式边界

- **模式借鉴零拷贝**：ZCode/Codex 均 Apache-2.0；本文件所列皆为设计模式对照，落地时在对应 plan 注明灵感来源，不搬源码/文档段落；
- **不外推 G1+**：签名/公证/GA/Provider 不在本路线；
- **既有语义零破坏**：所有新增设置默认=现状，涉审批/执行语义须红绿钉住；
- **i18n 阻塞**：D-04 仍 deferred，产品决策前不强行抽离；
- **hooks 重开条件**：BLOCK-124「纯开发设施不产品化」定性需用户显式改判方可重开。

---
*G0 开发期常态 · 不外推 packaged/Provider/GA。本文件为 reference 对照研究；落地以各工作包 plan/acceptance 为准。*