'use strict';

/**
 * core/packages/shared-config/config-schema.js — 配置键注册表与校验/优先级单源（BLOCK-199 P1-1）。
 *
 * 为什么放这一层（架构规则决定，不是偏好）：`.dependency-cruiser.cjs` 的 R3 禁 `core→src`、
 * R5 禁 `src→core/petri-server`，R4 注释明写 `core/packages/**` 是前后端合法共享层。配置键注册表
 * 要被后端 helper、Electron 主进程、设置 UI 三方同源消费，唯一合规落点就是这里
 * （先例：`core/packages/shared-telemetry/funnel-events.js`，BLOCK-186 同理由）。
 *
 * 三条设计约束：
 *  1. **纯函数、零 require**：不 import 后端模块，也不引第三方校验库（本仓零 zod/ajv；新依赖默认拒）。
 *     需要外部事实（如决策接点的阈值注册表）一律由调用方**注入**，避免这里长出第二份数值真相。
 *  2. **只声明形状，不复制数值**：阈值/门限的默认值与证据仍在 `decision-thresholds`，本表只声明
 *     "这个键是什么类型、能被谁改、怎么算合法"。
 *  3. **未知键语义单源**：`读不炸、写不进` —— 读侧宽松（只产 diagnostics 报告），写侧 fail-closed。
 *     这条统一掉了 P0 测绘发现的两处不一致（decision-config 读侧静默丢、写侧 throw）。
 */

/** 生效层名（高→低）。各族实际胜负由 CONFIG_FAMILIES[].precedence 决定，不假设全局同一顺序。 */
const CONFIG_LAYERS = Object.freeze(['override', 'env', 'file', 'default']);

const DIAGNOSTIC_CODES = Object.freeze({
  UNKNOWN_KEY: 'unknown-key',
  TYPE_MISMATCH: 'type-mismatch',
  OUT_OF_RANGE: 'out-of-range',
  NOT_ALLOWED: 'not-allowed',
  READ_ONLY: 'read-only',
  ALIAS_USED: 'alias-used',
});

/**
 * 族定义：precedence 是**该族自己的现有胜负关系**（逐族实码读来，见 block199-config-compat 基线），
 * 统一实现不得改写它。envTruth 区分三族语义：
 *  · 'boolean-force' —— env '1'/'true' 强制开、'0'/'false' 强制关（feature-flags）
 *  · 'one-zero'      —— 只认 '1'/'0'，别的字面量不干预（decision-config envValue 现状）
 *  · 'numeric'       —— env 是数值（generation/cost-cap），非数值即视为未设置
 * 注：decision-config 的 env='1' 在运行时**实际强制开**，与其文件头注释相反（C-32 已登记）；
 * 本表照现状记账，不在本包改胜负。
 */
const CONFIG_FAMILIES = Object.freeze({
  'feature-flags': {
    store: 'file:feature-flags.json#flags',
    precedence: ['env', 'file', 'default'],
    envTruth: 'boolean-force',
  },
  'decision-points': {
    store: 'file:decision-config.json#points',
    precedence: ['env', 'file', 'registry'],
    envTruth: 'one-zero',
  },
  'generation': {
    store: 'file:ai-settings.json#generation',
    precedence: ['env', 'file'],
    envTruth: 'numeric',
  },
  'cost-cap': {
    store: 'file:ai-settings.json#costCapCny',
    precedence: ['env', 'file'],
    envTruth: 'numeric',
  },
  // —— BLOCK-200 两族（地基的第一个真实新消费者）——
  // keymap：键位是渲染进程事实（离开 KeyboardEvent 组合串无意义），故**无 env 层**——
  // env 覆盖键位会造出"设置页显示 A、实际按 B"的第三种真相；文件即唯一用户覆盖层。
  'keymap': {
    store: 'file:keymap.json#bindings',
    precedence: ['file', 'default'],
    envTruth: null,
  },
  // reasoning：档位默认值与协议映射（此前硬编码在 thinking-level.js 的 switch 里）。
  'reasoning': {
    store: 'file:ai-settings.json#reasoning',
    precedence: ['file', 'default'],
    envTruth: null,
  },
  // —— BLOCK-202 两族（阶段 A 速赢 III：网络代理 / 审批与编排）——
  // network：代理与自签 CA。**这是"往 env 里写"的源头**（applyNetworkEnv），不是 env 消费者，
  // 故无 env 层；noProxy 生效时强制并入 localhost/127.0.0.1（本地回环永不走代理）。
  'network': {
    store: 'file:network.json',
    precedence: ['file', 'default'],
    envTruth: null,
  },
  // runtime：全局审批默认档位 + 派生并发/深度 + 工具曝光黑名单。
  // 并发/深度保留 env 覆盖（PETRI_SPAWN_* 是既有部署面，env 优先），审批默认为纯文件。
  'runtime': {
    store: 'file:runtime-policy.json',
    precedence: ['env', 'file', 'default'],
    envTruth: 'numeric',
  },
  // —— BLOCK-203 W4a P1（runlist W4a 的第一个真实消费者：BLOCK-86 的多端偏好落点）——
  // 外观三键此前由 `routes/user-prefs.js` 自写 sanitize（枚举集合 + fontScale 钳位）——
  // 那是第 N 份同构校验，也是"设置改了不生效"病根的同族。**无 env 层**：外观没有部署面需求，
  // 加 env 会造出"设置页显示 A、实际按 B"的第三种真相（与 keymap 同一理由）。
  'user-prefs': {
    store: 'file:user-prefs.json',
    precedence: ['file', 'default'],
    envTruth: null,
  },
  // —— BLOCK-203 W4a P3：技能治理偏好（BLOCK-177 的 disabled / uninstalledSources 账本）——
  // 写入面**不是 HTTP**（IPC `skills:set-disabled`），故漂移门的 400 规则对它不适用，
  // 由 `NON_HTTP_WRITE_FAMILIES` 单独登记（见 test/block199-config-drift.test.mjs）。
  'skills-prefs': {
    store: 'file:skills-prefs.json',
    precedence: ['file', 'default'],
    envTruth: null,
  },
  // —— BLOCK-203 W4a P4：用户 Agent 规则（BLOCK-160 ORC-1 的 rules[]）——
  // **集合型落点**：条目字段用 `<item>.` 前缀登记（数组没有稳定键，绝对点路径会逼每个落点
  // 自带遍历器——W4 要清的正是这个）。读写两侧共用 `sanitizeItem`/`diagnoseItem`。
  'agent-rules': {
    store: 'file:agent-rules.json#rules',
    precedence: ['file', 'default'],
    envTruth: null,
  },
  // —— BLOCK-203 W4a P5：第三方 MCP server 清单（BLOCK-156/163 的 servers[]）——
  // `maxItems` 是**集合级**上限（不是条目字段）：条目数上限属于"这份清单"的性质，
  // 塞进任何单条字段里都表达不了。条目级上限（args 条数）走字段 domain.maxItems。
  'mcp-servers': {
    store: 'file:mcp-servers.json#servers',
    precedence: ['file', 'default'],
    envTruth: null,
    maxItems: 50,
  },
  // —— BLOCK-204（runlist W5）：MCP 逐工具策略 ——
  // 与 `mcp-servers`（连什么）分开：这里是"连上之后，每个工具怎么对待"（启用/超时/合同模式）。
  // `projectionLimit` 是标量（投影上限），`<item>.*` 是逐工具条目（集合形状复用 P4 实现）。
  'mcp-tool-policy': {
    store: 'file:mcp-tool-policy.json#tools',
    precedence: ['file', 'default'],
    envTruth: null,
  },
  // —— BLOCK-205（runlist W6）：记忆与压缩策略 ——
  // 全是文件根标量（无嵌套袋）；提取/嵌入模型只登记不可写（改模型=换向量维度=重嵌入）。
  'memory-policy': {
    store: 'file:memory-policy.json',
    precedence: ['file', 'default'],
    envTruth: null,
  },
  // —— BLOCK-206（runlist W7a）：子智能体 profile（派发缺省值的声明）——
  // **不是权限系统**：不动 policy/审批/四档；profile 的并发只能"收紧" runtime 族的上限。
  'subagent-profile': {
    store: 'file:subagent-profiles.json#profiles',
    precedence: ['file', 'default'],
    envTruth: null,
  },
  // —— BLOCK-207（runlist W7b）：项目信任级 ——
  // 只做"进入四档判定前的天花板"，**不是第二套权限系统**（判定/审批/用户规则一字不动）。
  'trust-policy': {
    store: 'file:trust-policy.json#projects',
    precedence: ['file', 'default'],
    envTruth: null,
  },
  // —— BLOCK-210（runlist W7e）：历史留存/归档 ——
  // 默认全 0/空 = **不删、不移**（零行为变化）；删除只可能在显式 allowDelete 且 dryRun=false 时发生。
  'data-retention': {
    store: 'file:data-retention.json',
    precedence: ['file', 'default'],
    envTruth: null,
  },
});

/**
 * 键位组合串语法（`Mod+K` / `Mod+Shift+B` / `Ctrl+Tab`）。
 * `Mod`=Mac 用 Cmd、其他平台用 Ctrl（跨平台键位的唯一可移植写法）。
 * **强制至少一个修饰键**：裸键绑定会在输入框里劫持打字，属不可接受默认（D-1 敏感项最保守）。
 * 语法的**权威实现是 `frontend/src/lib/appKeymap.ts` 的编解码器**（它才需要解析事件）；
 * 本表正则只是写侧的边界守卫，二者由 `frontend/src/lib/appKeymap.drift.test.ts` 对账
 * （串行化产物必须过本正则 + 编解码器拒的畸形串本正则也必须拒），沿用
 * `src/ipc/channels.js` ↔ `preload.js` 字面量副本 + 双向守护测的本仓先例。
 * **修饰键必须按规范序且不重复**（Mod→Ctrl→Alt→Shift）：早前写成 `(?:Mod|Ctrl|Alt|Shift)\+)+`
 * 会放行 `Mod+Mod+K`，被该漂移测当场抓出——编解码器拒的串后端却收=垃圾能进盘。
 * 存储侧只可能是编解码器的规范化产物，按规范序收紧无副作用。
 */
const KEYMAP_COMBO_RE = /^(?:Mod(?:\+Ctrl)?(?:\+Alt)?(?:\+Shift)?|Ctrl(?:\+Alt)?(?:\+Shift)?|Alt(?:\+Shift)?|Shift)\+(?:[A-Za-z0-9]|F(?:[1-9]|1[0-2])|Tab|Enter|Escape|Backspace|Delete|Home|End|PageUp|PageDown|Space|Up|Down|Left|Right|[\][,./\-;'=`\\])$/;
const KEYMAP_COMBO_PATTERN = KEYMAP_COMBO_RE.source;

/**
 * 键注册表。字段：
 *  · `key` 全局唯一可寻址路径（族内逻辑名，不含落点方言）
 *  · `family` / `path`（该族存储内的相对路径）
 *  · `type`：boolean | number | string | object
 *  · `domain`：数值区间/枚举/取整规则（可选）
 *  · `envKeys`：真实存在的环境变量别名（契约测扫源码验不存在的幽灵别名）
 *  · `aliases`：**历史/外部**同义键名，命中即产 ALIAS_USED（不静默接受，也不双写）
 *  · `mutable`：用户可改（true）还是代码侧校准专属（false → 写侧给 READ_ONLY）
 *  · `ui`：'settings' 有设置表面 / 'none' 显式登记为不可 UI（漂移门据此判缺口）
 *  · `dropInvalid`：现状行为标记——数值域不合法时是丢键（generation）还是报错（feature-flags 类型）
 */
const CONFIG_KEYS = Object.freeze([
  // —— feature flags（helpers/feature-flags.js:23-45；默认全 true 是 2026-09-18 裁决）——
  {
    key: 'flag.server_history_assembly', family: 'feature-flags', path: 'server_history_assembly',
    type: 'boolean', envKeys: ['PETRI_SERVER_HISTORY_ASSEMBLY'], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    key: 'flag.session_compaction', family: 'feature-flags', path: 'session_compaction',
    type: 'boolean', envKeys: ['PETRI_SESSION_COMPACTION'], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    key: 'flag.agent_resilience', family: 'feature-flags', path: 'agent_resilience',
    type: 'boolean', envKeys: ['PETRI_AGENT_RESILIENCE'], aliases: [],
    mutable: true, ui: 'settings',
  },
  // —— 决策接点运行时开关（helpers/decision-config.js RUNTIME_POINTS；阈值数值不在本表复制）——
  {
    key: 'point.topic-shift.enabled', family: 'decision-points', path: 'topic-shift.enabled',
    type: 'boolean', envKeys: ['PETRI_JEV_TOPIC_SHIFT'], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    key: 'point.knowledge-guard.enabled', family: 'decision-points', path: 'knowledge-guard.enabled',
    type: 'boolean', envKeys: ['PETRI_JEV_KNOWLEDGE_GUARD'], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    key: 'point.marker-celltype.enabled', family: 'decision-points', path: 'marker-celltype.enabled',
    type: 'boolean', envKeys: ['PETRI_JEV_MARKER_GUARD'], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    key: 'point.intent-route.enabled', family: 'decision-points', path: 'intent-route.enabled',
    type: 'boolean', envKeys: ['PETRI_JEV_INTENT_ROUTE'], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    key: 'point.tool-route.enabled', family: 'decision-points', path: 'tool-route.enabled',
    type: 'boolean', envKeys: ['PETRI_JEV_TOOL_ROUTE'], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    // BLOCK-199 P4② 收编的接点（此前是 RUNTIME_POINTS 外的隐藏开关）；默认关=零出站零行为变化
    key: 'point.report-guard.enabled', family: 'decision-points', path: 'report-guard.enabled',
    type: 'boolean', envKeys: ['PETRI_JEV_REPORT_GUARD'], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    // 阈值数值本身受校准门约束：可改（设置页热调）但"改默认值"须先重校准 → mutable=true + 证据在注册表
    key: 'point.*.threshold', family: 'decision-points', path: '<point>.threshold',
    type: 'number', domain: { min: 0, max: 1 }, envKeys: [], aliases: [],
    mutable: true, ui: 'settings',
  },
  // —— 生成参数（helpers/ai-settings.js:315-329；env 数值覆盖文件，域外丢键）——
  {
    key: 'generation.temperature', family: 'generation', path: 'temperature',
    type: 'number', domain: { min: 0, max: 2 }, envKeys: ['PETRI_LLM_TEMPERATURE'],
    aliases: [], mutable: true, ui: 'settings', dropInvalid: 'drop-key',
  },
  {
    key: 'generation.maxTokens', family: 'generation', path: 'maxTokens',
    type: 'number', domain: { min: 256, max: 1000000, integer: 'floor' }, envKeys: ['PETRI_LLM_MAX_TOKENS'],
    aliases: [], mutable: true, ui: 'settings', dropInvalid: 'drop-key',
  },
  // —— 成本上限（helpers/cost-cap.js:14-26；>0 且两位小数）——
  {
    key: 'cost.capCny', family: 'cost-cap', path: 'costCapCny',
    type: 'number', domain: { minExclusive: 0, round: 2 }, envKeys: ['PETRI_TASK_COST_CAP_CNY'],
    aliases: [], mutable: true, ui: 'settings', dropInvalid: 'to-null',
  },
  // —— 键位（BLOCK-200 P0-1；一个应用级命令一条，值为规范化组合串）——
  // **逐命令显式登记而不用 `<command>` 占位**：占位形会让 `nav-typo` 这类未知命令 id 静默进盘
  // （写侧「未知键拒绝」这条地基能力对键位族就空转了）。命令 id 的真相在前端命令源
  // （`frontend/src/lib/appKeymap.ts` 的 `KEYMAP_COMMANDS`），两侧集合等价由
  // `appKeymap.drift.test.ts` 双向钉——与 `src/ipc/channels.js` ↔ `preload.js` 同一先例。
  ...['palette.toggle', 'nav-home', 'nav-projects', 'nav-knowledge', 'nav-review', 'nav-settings',
    'command-center.popOut', 'workspace.toggleTerminal', 'workspace.toggleRight', 'thinking.cycle',
  ].map((id) => ({
    key: `keymap.${id}`, family: 'keymap', path: id,
    type: 'string', domain: { pattern: KEYMAP_COMBO_PATTERN }, envKeys: [], aliases: [],
    mutable: true, ui: 'settings',
  })),
  // —— 推理档位（BLOCK-200 P0-5；此前硬编码在 thinking-level.js:38/41/44/73-85）——
  {
    key: 'reasoning.defaultLevel', family: 'reasoning', path: 'defaultLevel',
    type: 'string', domain: { oneOf: ['off', 'standard', 'high'] }, envKeys: [], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    // Anthropic 要求 budget_tokens ≥1024 且 < max_tokens；上限取模型侧已知最大窗口，防"设了发不出去"
    key: 'reasoning.anthropicHighBudgetTokens', family: 'reasoning', path: 'anthropicHighBudgetTokens',
    type: 'number', domain: { min: 1024, max: 128000, integer: 'floor' }, envKeys: [], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    // 中性档位→上游实参的映射。值词表按协议不同，**合法集合的真相在 reasoning-defaults.js**
    // （本表只声明形状，与"阈值数值受校准门约束"同一分工），写侧由 helper 逐协议校验。
    key: 'reasoning.mapping.<protocol>.<tier>', family: 'reasoning',
    path: 'mapping.<protocol>.<tier>',
    type: 'string', domain: { pattern: '^(?:none|(?:reasoning_effort|enable_thinking|thinking):[a-zA-Z0-9]+)$' },
    envKeys: [], aliases: [], mutable: true, ui: 'settings',
  },
  // —— BLOCK-202 network：代理与自签 CA（空串=不使用；凭据/密码不进本族）——
  {
    key: 'network.httpProxy', family: 'network', path: 'httpProxy',
    type: 'string', domain: { pattern: '^(?:https?://[^\\s]+)?$' }, envKeys: [], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    key: 'network.httpsProxy', family: 'network', path: 'httpsProxy',
    type: 'string', domain: { pattern: '^(?:https?://[^\\s]+)?$' }, envKeys: [], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    // 逗号分隔的 NO_PROXY 追加项；生效时还会强制并入 localhost/127.0.0.1（本地回环不走代理）
    key: 'network.noProxy', family: 'network', path: 'noProxy',
    type: 'string', domain: { pattern: '^[^\\s]*$' }, envKeys: [], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    // 自签 CA 文件路径（PEM）。只存路径不存证书内容；文件不存在时 apply 阶段给诊断且不设 env。
    key: 'network.caFile', family: 'network', path: 'caFile',
    type: 'string', domain: { pattern: '^[^\\s]*$' }, envKeys: [], aliases: [],
    mutable: true, ui: 'settings',
  },
  // —— BLOCK-202 runtime：审批默认档位 / 派生并发与深度 / 工具曝光黑名单 ——
  {
    // 全局默认档位：仅当请求上下文没给 accessMode 时生效（显式传值永远优先，四档语义零改动）
    key: 'runtime.approvalDefaultMode', family: 'runtime', path: 'approvalDefaultMode',
    type: 'string', domain: { oneOf: ['read', 'plan', 'workspace-write', 'full'] }, envKeys: [], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    // 与 PETRI_SPAWN_CONCURRENCY_LIMIT 同域（1-8）；env 存在时 env 优先（既有部署面）
    key: 'runtime.spawnConcurrency', family: 'runtime', path: 'spawnConcurrency',
    type: 'number', domain: { min: 1, max: 8, integer: 'floor' },
    envKeys: ['PETRI_SPAWN_CONCURRENCY_LIMIT'], aliases: [], mutable: true, ui: 'settings',
  },
  {
    key: 'runtime.spawnMaxDepth', family: 'runtime', path: 'spawnMaxDepth',
    type: 'number', domain: { min: 1, max: 3, integer: 'floor' },
    envKeys: ['PETRI_SPAWN_MAX_DEPTH'], aliases: [], mutable: true, ui: 'settings',
  },
  {
    // 逗号分隔的工具名白名单：非空时模型只看到这些工具（仍受黑名单二次收窄与策略/审批约束）。
    key: 'runtime.toolAllow', family: 'runtime', path: 'toolAllow',
    type: 'string', domain: { pattern: '^[a-z0-9_,\\s]*$' }, envKeys: [], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    // 逗号分隔的工具名黑名单：只影响"模型可见的工具面"（曝光层），不是安全边界——
    // 审批/策略层照常生效；空串=不屏蔽。
    key: 'runtime.toolDeny', family: 'runtime', path: 'toolDeny',
    type: 'string', domain: { pattern: '^[a-z0-9_,\\s]*$' }, envKeys: [], aliases: [],
    mutable: true, ui: 'settings',
  },
  // —— 外观偏好（BLOCK-203 W4a P1；原 `routes/user-prefs.js:16-44` 自写 sanitize）——
  // 域值必须与前端 `themes/accents.ts` 的 AccentId 集合、`ThemeProvider.tsx` 的 THEME 集合一字不差
  // （历史上"曾漏 blue"就是两份集合各自维护的后果；现由 `test/block203-user-prefs.test.mjs` 双向钉）。
  // **fontScale 的现状语义是"钳位"不是"拒绝"**（5 → 1.4）：钳位由 helper 在送校验**前**完成，
  // 这里的域只声明边界。改成拒绝会把既有客户端的越界值从"被夹住"变成"写失败"（行为回归）。
  {
    key: 'userPrefs.theme', family: 'user-prefs', path: 'theme',
    type: 'string', domain: { oneOf: ['system', 'light', 'dark'] }, envKeys: [], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    key: 'userPrefs.fontScale', family: 'user-prefs', path: 'fontScale',
    type: 'number', domain: { min: 0.8, max: 1.4 }, envKeys: [], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    key: 'userPrefs.accent', family: 'user-prefs', path: 'accent',
    type: 'string', domain: { oneOf: ['teal', 'blue', 'violet', 'rose', 'amber'] }, envKeys: [], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    // BLOCK-208（W7c 收窄）：动效开关。system=跟随 prefers-reduced-motion（默认，零行为变化）
    key: 'userPrefs.motion', family: 'user-prefs', path: 'motion',
    type: 'string', domain: { oneOf: ['system', 'full', 'reduced'] }, envKeys: [], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    // BLOCK-208：密度**只登记不接线**（会牵动全站间距 token，属单独立项）；先让键可寻址，
    // 免得下次接线时要再改一次 schema 形状。
    key: 'userPrefs.density', family: 'user-prefs', path: 'density',
    type: 'string', domain: { oneOf: ['comfortable', 'compact'] }, envKeys: [], aliases: [],
    mutable: true, ui: 'none',
  },
  // —— 技能治理账本（BLOCK-203 W4a P3；原 `shared-backend/skill-prefs.js` 无任何形状校验）——
  // `disabled.<id>` 不是布尔映射而是对象 `{ at, reason? }`，`uninstalledSources.<id>` 并存
  // `{ sourceDir, at }`。`findEntryByPath` 只寻址标量 ⇒ 按**点路径**逐字段登记，
  // 读取侧用 `flattenOneLevel` 摊平后诊断。
  // `owner:'code'` = 代码自写字段：读侧**不报 READ_ONLY**（否则每次 doctor 都是假警报），
  // 写侧仍拒绝用户改（版本号/时间戳不许用户改，也不许为了消噪音把 mutable 改成 true）。
  {
    key: 'skills.version', family: 'skills-prefs', path: 'version',
    type: 'number', envKeys: [], aliases: [], mutable: false, owner: 'code', ui: 'none',
  },
  {
    key: 'skills.disabled.<id>.at', family: 'skills-prefs', path: 'disabled.<id>.at',
    type: 'string', envKeys: [], aliases: [], mutable: false, owner: 'code', ui: 'none',
  },
  {
    key: 'skills.disabled.<id>.reason', family: 'skills-prefs', path: 'disabled.<id>.reason',
    type: 'string', envKeys: [], aliases: [], mutable: true, ui: 'none',
  },
  {
    key: 'skills.uninstalledSource.<id>.sourceDir', family: 'skills-prefs', path: 'uninstalledSources.<id>.sourceDir',
    type: 'string', envKeys: [], aliases: [], mutable: false, owner: 'code', ui: 'none',
  },
  {
    key: 'skills.uninstalledSource.<id>.at', family: 'skills-prefs', path: 'uninstalledSources.<id>.at',
    type: 'string', envKeys: [], aliases: [], mutable: false, owner: 'code', ui: 'none',
  },
  // —— 用户 Agent 规则（BLOCK-203 W4a P4；原 `helpers/agent-user-rules.js:63-80` 内联校验）——
  // 条目字段路径以 `<item>.` 开头，`findItemFieldEntry` 按精确字符串寻址（不走占位段匹配，
  // 避免"任意字段都能活"）。`scope` 目前只有 global（BLOCK-160 语义），保留但登记成枚举，
  // 将来加项目级作用域时这里是唯一改动点。
  {
    key: 'agentRules.version', family: 'agent-rules', path: 'version',
    type: 'number', envKeys: [], aliases: [], mutable: false, owner: 'code', ui: 'none',
  },
  {
    key: 'agentRules.<item>.id', family: 'agent-rules', path: '<item>.id',
    type: 'string', domain: { pattern: '\\S' }, envKeys: [], aliases: [], mutable: true, ui: 'settings',
  },
  {
    key: 'agentRules.<item>.matcher.type', family: 'agent-rules', path: '<item>.matcher.type',
    type: 'string', domain: { oneOf: ['path-glob', 'command-token'] }, envKeys: [], aliases: [], mutable: true, ui: 'settings',
  },
  {
    key: 'agentRules.<item>.matcher.pattern', family: 'agent-rules', path: '<item>.matcher.pattern',
    type: 'string', domain: { pattern: '\\S' }, envKeys: [], aliases: [], mutable: true, ui: 'settings',
  },
  {
    key: 'agentRules.<item>.action', family: 'agent-rules', path: '<item>.action',
    type: 'string', domain: { oneOf: ['deny', 'require-ack'] }, envKeys: [], aliases: [], mutable: true, ui: 'settings',
  },
  {
    key: 'agentRules.<item>.scope', family: 'agent-rules', path: '<item>.scope',
    type: 'string', domain: { oneOf: ['global'] }, envKeys: [], aliases: [], mutable: true, ui: 'settings',
  },
  {
    key: 'agentRules.<item>.note', family: 'agent-rules', path: '<item>.note',
    type: 'string', envKeys: [], aliases: [], mutable: true, ui: 'settings',
  },
  {
    key: 'agentRules.<item>.createdAt', family: 'agent-rules', path: '<item>.createdAt',
    type: 'string', envKeys: [], aliases: [], mutable: false, owner: 'code', ui: 'none',
  },
  // —— 第三方 MCP server 清单（BLOCK-203 W4a P5；原 `helpers/mcp-settings.js:36-59` 内联校验）——
  // `env` 是**对象透传**：键名由用户决定（动态命名空间），值落盘前经 `mcp-env-crypto` 加密；
  // 导出**不含 env**（凭据不随配置迁移，D-2），故这里只声明容器形状、不逐个 env 键登记。
  {
    key: 'mcpServers.version', family: 'mcp-servers', path: 'version',
    type: 'number', envKeys: [], aliases: [], mutable: false, owner: 'code', ui: 'none',
  },
  {
    key: 'mcpServers.savedAt', family: 'mcp-servers', path: 'savedAt',
    type: 'string', envKeys: [], aliases: [], mutable: false, owner: 'code', ui: 'none',
  },
  {
    key: 'mcpServers.<item>.id', family: 'mcp-servers', path: '<item>.id',
    // 空白与斜杠会破坏 id 作为键/路径段的可用性（同类约束见 skills-prefs 的 SKILL_ID_RE）
    type: 'string', domain: { pattern: '^[^\\s/\\\\]+$' }, envKeys: [], aliases: [], mutable: true, ui: 'settings',
  },
  {
    key: 'mcpServers.<item>.command', family: 'mcp-servers', path: '<item>.command',
    type: 'string', domain: { pattern: '\\S' }, envKeys: [], aliases: [], mutable: true, ui: 'settings',
  },
  {
    key: 'mcpServers.<item>.args', family: 'mcp-servers', path: '<item>.args',
    type: 'array', domain: { maxItems: 64 }, envKeys: [], aliases: [], mutable: true, ui: 'settings',
  },
  {
    key: 'mcpServers.<item>.env', family: 'mcp-servers', path: '<item>.env',
    type: 'object', envKeys: [], aliases: [], mutable: true, ui: 'settings',
  },
  {
    key: 'mcpServers.<item>.autoConnect', family: 'mcp-servers', path: '<item>.autoConnect',
    type: 'boolean', envKeys: [], aliases: [], mutable: true, ui: 'settings',
  },
  {
    key: 'mcpServers.<item>.transport', family: 'mcp-servers', path: '<item>.transport',
    type: 'string', domain: { oneOf: ['stdio', 'http'] }, envKeys: [], aliases: [], mutable: true, ui: 'settings',
  },
  // —— MCP 逐工具策略（BLOCK-204 / W5）——
  // `ui: 'none'`：v1 不提供逐工具设置页（plan §2 已声明）；漂移门按 `NO_UI_FAMILIES` 显式登记，
  // 不是"漏了挂面"。`contractMode` 只覆盖喂给既有四档判定的合同输入，不改判定实现。
  {
    key: 'mcpPolicy.projectionLimit', family: 'mcp-tool-policy', path: 'projectionLimit',
    type: 'number', domain: { min: 1, max: 200, integer: 'floor' }, envKeys: [], aliases: [],
    mutable: true, ui: 'none',
  },
  {
    key: 'mcpPolicy.<item>.tool', family: 'mcp-tool-policy', path: '<item>.tool',
    type: 'string', domain: { pattern: '^mcp_[A-Za-z0-9_-]+$' }, envKeys: [], aliases: [],
    mutable: true, ui: 'none',
  },
  {
    key: 'mcpPolicy.<item>.enabled', family: 'mcp-tool-policy', path: '<item>.enabled',
    type: 'boolean', envKeys: [], aliases: [], mutable: true, ui: 'none',
  },
  {
    key: 'mcpPolicy.<item>.timeoutMs', family: 'mcp-tool-policy', path: '<item>.timeoutMs',
    type: 'number', domain: { min: 1000, max: 600000, integer: 'floor' }, envKeys: [], aliases: [],
    mutable: true, ui: 'none',
  },
  {
    key: 'mcpPolicy.<item>.contractMode', family: 'mcp-tool-policy', path: '<item>.contractMode',
    type: 'string', domain: { oneOf: ['auto', 'read-only', 'mutating'] }, envKeys: [], aliases: [],
    mutable: true, ui: 'none',
  },
  // —— 记忆与压缩策略（BLOCK-205 / W6）——
  // `ui:'none'`：v1 无设置页（`NO_UI_FAMILIES` 显式登记）。域只声明边界；默认值在
  // `helpers/memory-policy.js` 的 `DEFAULTS`（逐字等于接线前的模块常量，基线测冻结）。
  {
    key: 'memoryPolicy.compactionTriggerTokens', family: 'memory-policy', path: 'compactionTriggerTokens',
    type: 'number', domain: { min: 2000, max: 200000, integer: 'floor' }, envKeys: [], aliases: [],
    mutable: true, ui: 'none',
  },
  {
    key: 'memoryPolicy.compactionMinMessages', family: 'memory-policy', path: 'compactionMinMessages',
    type: 'number', domain: { min: 4, max: 500, integer: 'floor' }, envKeys: [], aliases: [],
    mutable: true, ui: 'none',
  },
  {
    key: 'memoryPolicy.compactionKeepRecent', family: 'memory-policy', path: 'compactionKeepRecent',
    type: 'number', domain: { min: 2, max: 200, integer: 'floor' }, envKeys: [], aliases: [],
    mutable: true, ui: 'none',
  },
  {
    key: 'memoryPolicy.compactionSummaryBudgetChars', family: 'memory-policy', path: 'compactionSummaryBudgetChars',
    type: 'number', domain: { min: 5000, max: 500000, integer: 'floor' }, envKeys: [], aliases: [],
    mutable: true, ui: 'none',
  },
  {
    key: 'memoryPolicy.memoryTopK', family: 'memory-policy', path: 'memoryTopK',
    type: 'number', domain: { min: 1, max: 20, integer: 'floor' }, envKeys: [], aliases: [],
    mutable: true, ui: 'none',
  },
  {
    key: 'memoryPolicy.memoryThreshold', family: 'memory-policy', path: 'memoryThreshold',
    type: 'number', domain: { min: 0, max: 1 }, envKeys: [], aliases: [],
    mutable: true, ui: 'none',
  },
  {
    key: 'memoryPolicy.memoryMaxChars', family: 'memory-policy', path: 'memoryMaxChars',
    type: 'number', domain: { min: 100, max: 10000, integer: 'floor' }, envKeys: [], aliases: [],
    mutable: true, ui: 'none',
  },
  {
    key: 'memoryPolicy.autoFactTtlDays', family: 'memory-policy', path: 'autoFactTtlDays',
    type: 'number', domain: { min: 1, max: 3650, integer: 'floor' }, envKeys: [], aliases: [],
    mutable: true, ui: 'none',
  },
  {
    key: 'memoryPolicy.decayBatchLimit', family: 'memory-policy', path: 'decayBatchLimit',
    type: 'number', domain: { min: 1, max: 2000, integer: 'floor' }, envKeys: [], aliases: [],
    mutable: true, ui: 'none',
  },
  // —— 子智能体 profile（BLOCK-206 / W7a）——
  // `concurrency` 的 domain 必须与 `runtime.spawnConcurrency` **逐字相等**（block206 测对账）：
  // profile 只提供"更严的缺省"，不许出现第二套并发上限数字。
  {
    key: 'subagentProfile.default', family: 'subagent-profile', path: 'default',
    type: 'string', envKeys: [], aliases: [], mutable: true, ui: 'none',
  },
  {
    key: 'subagentProfile.<item>.name', family: 'subagent-profile', path: '<item>.name',
    type: 'string', domain: { pattern: '^[a-z0-9][a-z0-9-]*$' }, envKeys: [], aliases: [],
    mutable: true, ui: 'none',
  },
  {
    key: 'subagentProfile.<item>.role', family: 'subagent-profile', path: '<item>.role',
    type: 'string', domain: { pattern: '\\S' }, envKeys: [], aliases: [], mutable: true, ui: 'none',
  },
  {
    key: 'subagentProfile.<item>.model', family: 'subagent-profile', path: '<item>.model',
    type: 'string', domain: { pattern: '\\S' }, envKeys: [], aliases: [], mutable: true, ui: 'none',
  },
  {
    key: 'subagentProfile.<item>.concurrency', family: 'subagent-profile', path: '<item>.concurrency',
    type: 'number', domain: { min: 1, max: 8, integer: 'floor' }, envKeys: [], aliases: [],
    mutable: true, ui: 'none',
  },
  {
    // 只收 inherit：汇报门是全局接点（report-guard.js），逐子任务覆盖会改其契约 ⇒ 属 reopen
    key: 'subagentProfile.<item>.reportGuard', family: 'subagent-profile', path: '<item>.reportGuard',
    type: 'string', domain: { oneOf: ['inherit'] }, envKeys: [], aliases: [], mutable: true, ui: 'none',
  },
  // —— 项目信任级（BLOCK-207 / W7b）——
  // `defaultLevel` 默认 `inherit` = 零行为变化：**不配置就不干预任何项目**。"最保守"在这里的
  // 正确形态是"默认不动"，不是"上线即把所有项目降级"（那会把存量用户的任务直接打断）。
  {
    key: 'trustPolicy.defaultLevel', family: 'trust-policy', path: 'defaultLevel',
    type: 'string', domain: { oneOf: ['inherit', 'trusted', 'untrusted'] }, envKeys: [], aliases: [],
    mutable: true, ui: 'none',
  },
  {
    key: 'trustPolicy.<item>.project', family: 'trust-policy', path: '<item>.project',
    type: 'string', domain: { pattern: '\\S' }, envKeys: [], aliases: [], mutable: true, ui: 'none',
  },
  {
    key: 'trustPolicy.<item>.level', family: 'trust-policy', path: '<item>.level',
    type: 'string', domain: { oneOf: ['inherit', 'trusted', 'untrusted'] }, envKeys: [], aliases: [],
    mutable: true, ui: 'none',
  },
  // —— 历史留存/归档（BLOCK-210 / W7e）——
  {
    key: 'retention.historyDays', family: 'data-retention', path: 'historyDays',
    type: 'number', domain: { min: 0, max: 3650, integer: 'floor' }, envKeys: [], aliases: [],
    mutable: true, ui: 'none',
  },
  {
    // 空串 = 不归档（只在显式设置后才有归档动作）
    key: 'retention.archiveDir', family: 'data-retention', path: 'archiveDir',
    type: 'string', envKeys: [], aliases: [], mutable: true, ui: 'none',
  },
  {
    key: 'retention.maxBytesPerDir', family: 'data-retention', path: 'maxBytesPerDir',
    type: 'number', domain: { min: 0, max: 1e12, integer: 'floor' }, envKeys: [], aliases: [],
    mutable: true, ui: 'none',
  },
  {
    // 只登记不可写：模型 id 与向量维度（EMBEDDING_DIM=1024）绑定，单方面换模型会让已存向量全部失效。
    key: 'memoryPolicy.embeddingModel', family: 'memory-policy', path: 'embeddingModel',
    type: 'string', domain: { oneOf: ['text-embedding-v3'] }, envKeys: [], aliases: [],
    mutable: false, owner: 'code', ui: 'none',
  },
  {
    key: 'mcpServers.<item>.url', family: 'mcp-servers', path: '<item>.url',
    // 只有 transport=http 时才有意义；"http 必带 url"是**条目级**关系，由落点语义校验（域表达不了）
    type: 'string', domain: { pattern: '^https?://\\S*$' }, envKeys: [], aliases: [], mutable: true, ui: 'settings',
  },
]);

const KEY_INDEX = new Map(CONFIG_KEYS.map((entry) => [entry.key, entry]));

function findKeyEntry(key) {
  return KEY_INDEX.get(key) || null;
}

/** 按族+族内存储路径查键声明（`<x>` 占位段参与匹配，段数必须一致）。 */
function findEntryByPath(family, storagePath) {
  const actual = String(storagePath || '').split('.');
  for (const entry of CONFIG_KEYS) {
    if (entry.family !== family) continue;
    if (entry.path === storagePath) return entry;
    const pattern = entry.path.split('.');
    if (pattern.length !== actual.length) continue;
    let matched = true;
    for (let i = 0; i < pattern.length; i++) {
      // 占位段（`<point>`/`<command>`/`<protocol>`/`<tier>`）匹配任意非空实际段
      if (pattern[i].startsWith('<') && pattern[i].endsWith('>')) {
        if (actual[i] === '') { matched = false; break; }
        continue;
      }
      if (pattern[i] !== actual[i]) { matched = false; break; }
    }
    if (matched) return entry;
  }
  return null;
}

/**
 * 集合条目的字段寻址（BLOCK-203 W4a P4）：按**精确字符串**匹配 `<item>.<field>`，
 * 不走 `findEntryByPath` 的占位段匹配——占位段会让任意字段名都"注册"成功，
 * 等于把写侧的未知字段拒绝能力空转（`keymap` 族当年就是为了这个才逐命令显式登记）。
 */
function findItemFieldEntry(family, fieldPath) {
  const target = `<item>.${fieldPath}`;
  return CONFIG_KEYS.find((entry) => entry.family === family && entry.path === target) || null;
}

/** 该族已登记的条目字段路径（不含 `<item>.` 前缀）。 */
function itemFieldPaths(family) {
  return CONFIG_KEYS
    .filter((entry) => entry.family === family && entry.path.startsWith('<item>.'))
    .map((entry) => entry.path.slice('<item>.'.length));
}

function setNested(target, dottedPath, value) {
  const parts = dottedPath.split('.');
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cursor[parts[i]] || typeof cursor[parts[i]] !== 'object' || Array.isArray(cursor[parts[i]])) {
      cursor[parts[i]] = {};
    }
    cursor = cursor[parts[i]];
  }
  cursor[parts[parts.length - 1]] = value;
}

/**
 * 集合条目消毒（单一实现，读写两侧共用）：
 *  · 只保留**已登记**的字段并重建嵌套形状（未知字段 → 诊断 + 不落盘）；
 *  · 值按注册表校验（类型/枚举/正则/SQL 注入面之外的一切形状）；
 *  · 读侧调用时只用 `.diagnostics`（宽容报告），写侧用 `.item`（重建后再落盘）。
 * @returns {{item:object|null, diagnostics:Array}}
 */
/** 诊断 + 归一化单个字段（条目内部用）；返回是否写入。 */
function applyItemField(family, field, value, target, diagnostics) {
  const entry = findItemFieldEntry(family, field);
  if (!entry) {
    diagnostics.push({ code: DIAGNOSTIC_CODES.UNKNOWN_KEY, path: field, family, message: `未注册的条目字段 ${field}（写侧拒绝，读侧忽略）` });
    return false;
  }
  if (!entry.mutable && entry.owner !== 'code') {
    diagnostics.push({ code: DIAGNOSTIC_CODES.READ_ONLY, path: field, family, message: `${entry.key} 属代码侧校准专属，用户不可写` });
    return false;
  }
  const check = validateValue(entry, value);
  if (!check.ok) {
    diagnostics.push({ code: check.code, path: field, family, message: check.message });
    return false;
  }
  setNested(target, field, check.normalized);
  return true;
}

function sanitizeItem(family, raw) {
  const diagnostics = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { item: null, diagnostics: [{ code: DIAGNOSTIC_CODES.TYPE_MISMATCH, path: '', family, message: '条目必须是对象' }] };
  }
  const paths = itemFieldPaths(family);
  const topLevel = new Set(paths.filter((p) => !p.includes('.')));
  const containers = new Set(paths.filter((p) => p.includes('.')).map((p) => p.split('.')[0]));
  const item = {};
  for (const [key, value] of Object.entries(raw)) {
    if (topLevel.has(key)) {
      // 顶层字段：动态容器（`env`）按 object 类型整体透传，不做逐键登记
      applyItemField(family, key, value, item, diagnostics);
      continue;
    }
    if (containers.has(key) && value && typeof value === 'object' && !Array.isArray(value)) {
      // 一层嵌套（`matcher.pattern`）：逐子键精确寻址，未登记的子键照样报未知
      for (const [inner, innerValue] of Object.entries(value)) {
        applyItemField(family, `${key}.${inner}`, innerValue, item, diagnostics);
      }
      continue;
    }
    diagnostics.push({ code: DIAGNOSTIC_CODES.UNKNOWN_KEY, path: key, family, message: `未注册的条目字段 ${key}（写侧拒绝，读侧忽略）` });
  }
  return { item, diagnostics };
}

/** 读侧条目诊断（同一实现的薄别名；doctor / 落点读侧用）。 */
function diagnoseItem(family, raw) {
  return sanitizeItem(family, raw).diagnostics;
}

/** 类型与数值域校验：返回归一化值或结构化诊断码（不抛错——抛不抛由调用侧语义决定）。 */
function validateValue(entry, raw) {
  if (!entry) return { ok: false, code: DIAGNOSTIC_CODES.UNKNOWN_KEY, message: '未注册的键' };
  if (entry.type === 'boolean') {
    if (typeof raw !== 'boolean') return { ok: false, code: DIAGNOSTIC_CODES.TYPE_MISMATCH, message: `${entry.key} 需要 boolean` };
    return { ok: true, normalized: raw };
  }
  if (entry.type === 'number') {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n)) return { ok: false, code: DIAGNOSTIC_CODES.TYPE_MISMATCH, message: `${entry.key} 需要有限数值` };
    let v = n;
    if (entry.domain && entry.domain.integer === 'floor') v = Math.floor(v);
    if (entry.domain && entry.domain.round != null) v = Math.round(v * 10 ** entry.domain.round) / 10 ** entry.domain.round;
    const d = entry.domain || {};
    if (d.min != null && v < d.min) return { ok: false, code: DIAGNOSTIC_CODES.OUT_OF_RANGE, message: `${entry.key} 需 ≥ ${d.min}` };
    if (d.max != null && v > d.max) return { ok: false, code: DIAGNOSTIC_CODES.OUT_OF_RANGE, message: `${entry.key} 需 ≤ ${d.max}` };
    if (d.minExclusive != null && v <= d.minExclusive) return { ok: false, code: DIAGNOSTIC_CODES.OUT_OF_RANGE, message: `${entry.key} 需 > ${d.minExclusive}` };
    return { ok: true, normalized: v };
  }
  // `object`/`array` 是"原样通过"型：只做浅层容器判断，内容由各自落点按语义处理
  // （mcp-servers 的 `args: string[]` 与 `env: Record<string,string>` 就是这类）。
  if (entry.type === 'object') {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, code: DIAGNOSTIC_CODES.TYPE_MISMATCH, message: `${entry.key} 需要对象` };
    return { ok: true, normalized: raw };
  }
  if (entry.type === 'array') {
    if (!Array.isArray(raw)) return { ok: false, code: DIAGNOSTIC_CODES.TYPE_MISMATCH, message: `${entry.key} 需要数组` };
    const maxItems = entry.domain && entry.domain.maxItems;
    if (maxItems != null && raw.length > maxItems) {
      return { ok: false, code: DIAGNOSTIC_CODES.OUT_OF_RANGE, message: `${entry.key} 最多 ${maxItems} 项（实得 ${raw.length}）` };
    }
    return { ok: true, normalized: raw };
  }
  if (entry.type === 'string') {
    if (typeof raw !== 'string') return { ok: false, code: DIAGNOSTIC_CODES.TYPE_MISMATCH, message: `${entry.key} 需要 string` };
    if (entry.domain && Array.isArray(entry.domain.oneOf) && !entry.domain.oneOf.includes(raw)) {
      return { ok: false, code: DIAGNOSTIC_CODES.NOT_ALLOWED, message: `${entry.key} 只接受 ${entry.domain.oneOf.join('/')}` };
    }
    // pattern 是**写侧边界守卫**（语法权威在别处的编解码器，两由漂移测对账）；此处不建全局 RegExp
    // 以免 `lastIndex` 状态污染，且域外串一律 NOT_ALLOWED 而非静默丢。
    if (entry.domain && typeof entry.domain.pattern === 'string' && !new RegExp(entry.domain.pattern).test(raw)) {
      return { ok: false, code: DIAGNOSTIC_CODES.NOT_ALLOWED, message: `${entry.key} 语法不符（${entry.domain.pattern}）` };
    }
    return { ok: true, normalized: raw };
  }
  return { ok: false, code: DIAGNOSTIC_CODES.TYPE_MISMATCH, message: `${entry.key} 声明了未知类型 ${entry.type}` };
}

/**
 * env 文本 → 该族实际生效的三态（true/false/null=不干预）。
 * 严格照现状语义：feature-flags 认 '1'/'true'/'0'/'false'，decision-config 只认 '1'/'0'。
 */
function resolveEnvEntry(family, rawEnv) {
  if (rawEnv == null || rawEnv === '') return null;
  const spec = CONFIG_FAMILIES[family] || {};
  const truth = spec.envTruth;
  // 无 env 层的族（keymap/reasoning）不接受环境变量干预：否则 '1' 会被下面解释成布尔真值，
  // 造出"设置页显示 A、实际按 B"的第三种真相。
  if (!(spec.precedence || []).includes('env')) return null;
  if (truth === 'numeric') {
    const n = Number(rawEnv);
    return Number.isFinite(n) ? { layer: 'env', value: n } : null;
  }
  if (rawEnv === '1' || (truth === 'boolean-force' && rawEnv === 'true')) return { layer: 'env', value: true };
  if (rawEnv === '0' || (truth === 'boolean-force' && rawEnv === 'false')) return { layer: 'env', value: false };
  return null;
}

/**
 * 统一优先级取值：按族 precedence 找第一个"存在"的层；不改变任何族的胜负关系。
 * @param {string} family
 * @param {{env?:*, file?:*, defaults?:*}} layers 由调用方（后端适配器）提供
 */
function resolve(family, layers = {}) {
  const spec = CONFIG_FAMILIES[family];
  if (!spec) throw new Error(`config_family_unknown:${family}`);
  for (const layer of spec.precedence) {
    const value = layer === 'env' ? layers.env : layer === 'file' ? layers.file : layer === 'registry' ? layers.registry : layers.defaults;
    if (value !== undefined && value !== null) return { layer, value };
  }
  return { layer: null, value: null };
}

/**
 * 一层嵌套对象的诊断：注册表按 `a.b.c` 路径声明，而有些族的存储形状天然嵌套
 * （`reasoning.mapping.<protocol>.<tier>`）。摊平一层后再走 `diagnoseObject`，
 * 这样诊断面不必为每个嵌套族另写一份读法（也不静默跳过嵌套键）。
 */
function flattenOneLevel(obj) {
  const flat = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return flat;
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [inner, leaf] of Object.entries(value)) {
        if (leaf && typeof leaf === 'object' && !Array.isArray(leaf)) {
          for (const [deepest, token] of Object.entries(leaf)) flat[`${key}.${inner}.${deepest}`] = token;
        } else {
          flat[`${key}.${inner}`] = leaf;
        }
      }
      continue;
    }
    flat[key] = value;
  }
  return flat;
}

/**
 * 未知键/别名诊断：读侧只报告不拒（旧文件里有未知键不得炸启动），写侧据 ok=false 拒绝落盘。
 * @param {Array<{path:string}>|undefined} knownPaths 族内允许的存储路径（由适配器按实际形状给出）
 */
function diagnoseObject(family, obj, lookup) {
  const diagnostics = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return diagnostics;
  for (const [path, value] of Object.entries(obj)) {
    const entry = lookup(family, path);
    if (!entry) {
      diagnostics.push({ code: DIAGNOSTIC_CODES.UNKNOWN_KEY, path, family, message: `未注册的配置键 ${path}（读侧忽略，写侧拒绝）` });
      continue;
    }
    for (const alias of entry.aliases || []) {
      if (alias === path) diagnostics.push({ code: DIAGNOSTIC_CODES.ALIAS_USED, path, family, message: `${path} 是 ${entry.key} 的历史别名` });
    }
    // `owner:'code'` 的键是代码自写的事实（版本号/时间戳/来源目录）：读侧**不报** READ_ONLY，
    // 否则每次读盘都把"正常状态"报成问题（doctor 会把它们归进"非法已存值"，天天假警报）。
    // 写侧仍拒绝（见 commitGuard）——不报≠可改。
    if (!entry.mutable && entry.owner !== 'code') {
      diagnostics.push({ code: DIAGNOSTIC_CODES.READ_ONLY, path, family, message: `${entry.key} 由代码侧校准专属，用户不可写` });
    }
    const check = validateValue(entry, value);
    if (!check.ok) diagnostics.push({ code: check.code, path, family, message: check.message });
  }
  return diagnostics;
}

/**
 * 写侧守卫（BLOCK-199 P3）：注册表内键的补丁必须**逐项可校验**——未知键/类型不符/越界/只读键
 * 一律拒绝并回结构化诊断（"写不进"）。与读侧的宽松（`diagnoseObject` 只报告）配对成一条规则。
 * `null` 值=清键（既有语义，透传不误拒）；未出现的键不校验不改写。
 */
function commitGuard(family, patch, lookup, options = {}) {
  const diagnostics = [];
  const normalized = {};
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, normalized, diagnostics: [{ code: DIAGNOSTIC_CODES.TYPE_MISMATCH, family, path: '', message: '写入补丁必须是对象' }] };
  }
  for (const [path, value] of Object.entries(patch)) {
    if (value === null && !options.rejectNull) continue; // 清键语义：放行且不写值
    const entry = lookup(family, path);
    if (!entry) {
      diagnostics.push({ code: DIAGNOSTIC_CODES.UNKNOWN_KEY, family, path, message: `未注册的配置键 ${path}，拒绝写入（不再静默存活）` });
      continue;
    }
    if (!entry.mutable) {
      const why = entry.owner === 'code' ? '由代码自写（版本号/时间戳/来源），用户不可写' : '属代码侧校准专属，用户不可写';
      diagnostics.push({ code: DIAGNOSTIC_CODES.READ_ONLY, family, path, message: `${entry.key} ${why}` });
      continue;
    }
    const check = validateValue(entry, value);
    if (!check.ok) {
      diagnostics.push({ code: check.code, family, path, message: check.message });
      continue;
    }
    normalized[path] = check.normalized;
  }
  return { ok: diagnostics.length === 0, normalized, diagnostics };
}

/**
 * env 遮蔽可见化：列出"文件里写了值，但同时有 env 变量正在盖住它"的键——
 * 这类遮蔽是"设置页改了却看不到效果"的根因（BLOCK-199 P0 缺陷族），必须可诊断而非静默。
 */
function envShadowedKeys(family, fileObj, env, lookup) {
  const out = [];
  if (!fileObj || typeof fileObj !== 'object') return out;
  const spec = CONFIG_FAMILIES[family];
  if (!spec || spec.precedence[0] !== 'env') return out;
  for (const [path, value] of Object.entries(fileObj)) {
    const entry = lookup(family, path);
    if (!entry || !entry.envKeys || entry.envKeys.length === 0) continue;
    const hit = entry.envKeys.find((k) => env && env[k] != null && env[k] !== '');
    if (!hit) continue;
    const envResolved = resolveEnvEntry(family, env[hit]);
    if (!envResolved) continue; // env 值不被该族承认（例如非 1/0/true/false 字面量）→ 不构成遮蔽
    out.push({ family, path, envKey: hit, envValue: env[hit], fileValue: value, overrides: envResolved.value !== value });
  }
  return out;
}

module.exports = {
  CONFIG_LAYERS,
  CONFIG_FAMILIES,
  CONFIG_KEYS,
  DIAGNOSTIC_CODES,
  KEYMAP_COMBO_PATTERN,
  KEYMAP_COMBO_RE,
  findKeyEntry,
  findEntryByPath,
  validateValue,
  resolveEnvEntry,
  resolve,
  diagnoseObject,
  diagnoseItem,
  sanitizeItem,
  findItemFieldEntry,
  itemFieldPaths,
  flattenOneLevel,
  commitGuard,
  envShadowedKeys,
};
