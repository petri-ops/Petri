---
capability: config-schema-service
goal: BLOCK-199 = 阶段 3 结构地基首包「配置 schema 层 + 统一配置服务」（专项分析 P1-1）。现状事实：全仓配置落点 14 处、4 个互不相同的 data root、**六份各自手写的 env>文件>默认 回落链**、零校验类依赖（zod/ajv 都没有），且**不存在"用户写了不存在的键名会被发现"的任何机制**——未知键在 `ai-settings` 里整坨透传永久存活，在 `decision-config` 读侧静默跳过、写侧却 throw，同一族两种语义。已核实三个"设置改了不生效"级真缺陷（见 §0.2）。本包建单一真值源：声明式键注册表（schema）+ 统一优先级模型 + unknown-key 诊断 + 旧落点兼容读（不迁移磁盘形状），并收编三族做垂直切片；其余落点留 B1b/B2 切片。
acceptance:
  - P1 schema 单源：`core/packages/shared-config/schema.js`（零依赖，前后端共享层——R4 明写 `core/packages/**` 合法、R5 只禁 `src→core/petri-server`，故注册表必须放这里才能被设置 UI 与后端同源消费）声明每个键的 `path/type/枚举或区间/默认来源/env 别名/落点/是否可热改/证据`；契约测=注册表形状自检 + 重复键零容忍 + 每个 env 别名必须真实出现在代码里（源码扫描，防幽灵别名）。
  - P2 统一优先级模型：`resolve(key, {override, env, file, default})` 单实现，替换六份手写链；优先级次序**逐族与迁移前对账**（不改变任何族的现有胜负关系，只把实现收成一份）。契约测=每族一条"env 赢文件、文件赢默认"的表驱动断言。
  - P3 unknown-key 诊断与写侧拒绝：写路径必过 schema，未知键/类型不符/越界返回结构化 `diagnostics[{code,path,message}]` 而非静默丢弃；**读侧保持宽松**（旧文件里已存在的未知键不得导致启动失败，只报告）——`未知键读不炸、写不进` 是本包的诚实边界。
  - P4 三缺陷修复（红→绿先行）：①`tool-router.js:22` 模块加载时 `thresholdForPoint('tool-route')` 冻结成常量并在 `:96` 参与判定，而同族 `intent-router.js:81` 用的是 `runtime.threshold ?? CONST`——**设置页改阈值落盘成功、回显正确、判定值永不变**；改为运行时读取（默认数值一个字节不改，校准红线不破）。②`report-guard.js:21` 直读 `PETRI_JEV_REPORT_GUARD === '1'`，该键不在 `decision-config.RUNTIME_POINTS`（现仅 5 键）→ 设置页不可见、不可持久化、且开关语义与他点（env '0' 杀 + defaultOn）不一致；纳入注册表并保持"默认关"。③theme/fontScale 双写里 REST 推送是 `void fetch(...).catch(()=>{})`（`ThemeProvider.tsx:111`）——服务端失败静默、本地已生效、跨端读到旧值；改为可观测（失败留痕并回滚到服务端真相或显式提示，二者选一，不静默）。
  - P5 漂移门（schema ↔ UI ↔ IPC 一致）：源码扫描测钉"设置面出现的每个键必须在注册表里、注册表里 `mutable` 的键必须有 UI 或明确登记为不可 UI"；沿用 `src/ipc/channels.js` + `test/ipc-channels-registry.test.mjs` 的双向守护模式（本仓最成熟的注册表先例）。
  - P6 兼容与回退：旧落点文件**不迁移不改形状**，`config-service` 只是读写封装；对三族做"迁移前后逐键值相等"对账测；`npm run closeout` 十三门 + 五件套回写。
  - 完成语义：本包交付的是**地基 + 三族收编 + 三个缺陷清偿**，不宣称"全部 14 落点已统一"；剩余落点在 §4 点名留后续切片。
reopen: B1b 切片（user-prefs/mcp-settings/skill-prefs 收编 + 四 data root 脑裂根治）、B2 切片（P1-2 MCP 逐工具策略、P1-3 记忆/压缩设置面）、P0-3 设置搜索与导出（其实现载体正是本包）；profile 只做到"命名覆盖层雏形"，多端同步待产品决策。
status: active
---

# BLOCK-199 — 配置 schema 层与统一配置服务（阶段 3 · B1 地基）

- 状态：`active`（2026-10-17 主代理按队列头自决立项；用户授权原话「非常好 尽可能的推进更多的内容 不要问我所有工作决策你来定」，并指定本轮要开"跨度比较大的任务"）
- Plan ID：`BLOCK-199-CONFIG-SCHEMA-SERVICE` · 专项分析：`docs/settings-capability-gap-analysis-2026-10-15.md` §6 **P1-1** / §7 阶段 B **B1**

## 0. P0 勘察结果（两路只读盘点 + 主代理逐条实码抽验；BLOCK-195 曾两次纠正子代理错路径，本次全部结论我都自己读到行号才写）

### 0.1 落点测绘

| 维度 | 实测 |
| --- | --- |
| 持久化落点 | **14 处**：SQLite `site_settings`（全仓唯一行式 KV 表，`core/petri-server/db/schema.js:303`）+ 三个整坨 JSON 列（`execution_targets.runtime_json:451`、`gen_ui_widget_state.state_json:503`、`users.permissions:296`）+ 七个 JSON 文件族（`ai-settings.json`、`mcp-servers.json`、`feature-flags.json`、`agent-rules.json`、`decision-config.json`、`user-prefs.json`、`skills-prefs.json`）+ 主进程侧窗口/路由态（`window-manager-state.json` 等） |
| data root | **4 条互不相同的解析链**：`PETRI_LOCAL_DATA_DIR‖~/Documents/Petri-Local`（`ai-settings.js:24-26`）、`PETRI_DECISION_CONFIG_PATH‖LOCAL_DATA_DIR‖cwd/data`（`decision-config.js:31-35`）、`PETRI_USER_DATA_DIR‖~/.petri`（`skill-prefs.js:26-38`）、Electron userData（`src/main.js:79-81`，可被 `PETRI_ELECTRON_USER_DATA_DIR` 改写）——`system-prompt.js:274-276` 注释自认「BLOCK-85 脑裂家族」 |
| 回落链实现 | **六份各自手写**：feature-flags / decision-config / ai-settings(generation) / cost-cap / user-prefs / extraRenderers，每份自己写 env>文件>默认 + 自己的静默丢弃策略 |
| 环境变量 | ~110 个（`PETRI_*` 族 + 裸名 `R_POOL_SIZE`/`TYPESAFE_*`/`DEEPSEEK_API_KEY`），唯一写点 `src/main/env-coordinator.js:256-345`，集中读 `config-helper.js:169-209`；`core/petri-server/.env.example` 仍列 `DEEPSEEK_API_KEY` 而 `ai-settings.js:196-199` 已禁 env 兜底 ⇒ **示例文件已失效**（文档骗人） |
| 校验与未知键 | **零校验类依赖**（root deps 24、core 7 均无 zod/ajv/joi；frontend 只有 `@codemirror/lang-json` 编辑器语法包）⇒ 新依赖被拒，必须零依赖手写。**已存在三份互不复用的手写 JSON-Schema 子集引擎**：`mcp/_validate-tool-args.js:44-176`（含 `additionalProperties:false` 报 unknown property）、`shared-backend/skill-schema.js`、`scripts/lib/gate-report-schema.mjs:100-177`——骨架可抽用，不重造第四套 |
| 命名风格 | 六套并存（snake 扁平 / camel / kebab 点段 / snake flag / localStorage 三分隔符混用 `petri-theme`·`petri:notify-on-done`·`petri.fileTree.showHidden` / `domain:action` 通道）；同一参数多名实例：chat provider=`llm_provider`⇄`chat_provider`⇄`PETRI_LLM_PROVIDER`，字号=`petri-font-scale`⇄`fontScale`，模型=`chat_model_presets`(v1)⇄`model_profiles`+`model_role_bindings`(v2) |
| 可直接复用的注册表先例 | `src/ipc/channels.js`（**模式最成熟**：注册表⊆preload 双向由 `test/ipc-channels-registry.test.mjs` 守护）· `decision-thresholds.js:36-115`（每键硬绑 `evidence` 文件＝**schema 与证据绑定的本仓先例**）· `decision-config.js:21-29 RUNTIME_POINTS` · `feature-flags.js:23-45`（`FLAG_DEFAULTS`+`FLAG_META` 双表）· `model-profile.js:12-41` · `decision-config.js:120-127 GATES_INVARIANTS`（跨键不变量） |

### 0.2 三个已核实真缺陷（本包清偿，不是"顺手优化"）

1. **`tool-route` 阈值改了不生效**：`core/petri-server/helpers/tool-router.js:22` 在模块加载时 `const TOOL_ROUTE_THRESHOLD = thresholdForPoint('tool-route')` 冻结，`:90/:96` 全程用该常量；而同族 `intent-router.js:81` 是 `runtime.threshold ?? INTENT_ROUTE_THRESHOLD`（运行时）。⇒ 设置页改阈值落盘成功、UI 回显正确、**判定值永不变**，且同族两种口径=后来者不知道该抄哪个。
2. **`report-guard` 是注册表外的隐藏开关**：`core/petri-server/helpers/report-guard.js:21` 只认 `process.env.PETRI_JEV_REPORT_GUARD === '1'`；实测 `RUNTIME_POINTS` 仅 `topic-shift,knowledge-guard,marker-celltype,intent-route,tool-route` 五键 ⇒ 设置页不可见、不可持久化，且语义与他点相反（他点 env '0' 是杀开关，这里必须 ='1' 才开）。
3. **theme 跨端写失败静默**：`frontend/src/themes/ThemeProvider.tsx:111` 用 `void fetch(...).catch(()=>{})` 推服务端 ⇒ 本地已生效、服务端可能没收到、另一个实例读到旧值，用户无任何线索。

### 0.2.1 第四条已核实矛盾（**本包只登记不改**，转候选 C-32）

`decision-config.js` 文件头注释明写「env='1' **不在运行时强制开**（避免 UI 关不掉）——envOverride 字段如实暴露给 UI 提示」，但 `getPointRuntime` 的实现是 `enabled: env === 'off' ? false : env === '1'→'on' ? true : …`。实测（`test/block199-config-compat.test.mjs` 第六条已把它作为**现状**钉住）：文件里 `{knowledge-guard:{enabled:false}}` + `PETRI_JEV_KNOWLEDGE_GUARD=1` ⇒ `enabled=true`。后果是治理语义反了：**用户在设置页显式关掉某个守卫，只要环境里残留 `PETRI_JEV_*=1` 它就又开了**，UI 只能显示 `envOverride:'on'` 却关不动。

不改的理由不是回避，而是本包 §4 已自我约束「不改变任何族的现有胜负关系」，且拆前基线必须能钉住现状——改了它等于同时改动验收锚与被验收物。处置：compat 测先把现状钉成基线（已完成），矛盾转候选 **C-32**（含"env=1 降级为首载种子、env=0 保留杀开关"的修法与所需回归面），由独立包在漂移门就绪后再动。



### 0.3 不该合并的东西（防止把「统一」做成「一锅烩」）

凭据存储（`credential-store.js`，`ai-settings.js:11` 明写密钥永不入明文快照——合并即安全回归）· `gen_ui_widget_state`/`last_probe_json`（会话运行态）· `plugins/installed.json`·`packs/installed.json`·`federation/{peers,grants}.json`（装配与授权清单，不是键值配置）· `accessMode` 每请求态（`agent-execution-policy.js:13-19`，UI 是权威、不落盘正是设计）。本包**只收编"用户可改行为参数"这一族**。

## 1. 为什么这是队列头（以及为什么它值得"跨度大"）

阶段 2 已于 BLOCK-195 出口、BLOCK-198 又把竞争力测量的无锚残余收敛到 4 个（3 真缺口 + 1 环境档），测量面已经可信。专项分析 §7 阶段 B 明写「**先地基再挂件**：P1-1 配置 schema+统一服务 → P1-2 MCP 逐工具策略 → P1-3 记忆/压缩设置面」，且 P1-1 是 P0-3（设置搜索/导出/按区重置）的**实现载体**——地基不做，后面每个挂件都要再抄一遍六份回落链。§0.2 三个缺陷也证明这不是抽象洁癖：**用户已经改了设置而系统没生效**，属于治理透明与本地主权魂面的实证失效。

## 2. 立项自检（对标不改魂）

差别形态：Codex 是 9 层 TOML + strict、ZCode 是 zod + 三层，两者都只做"能不能解析"。Petri 这里 schema 每键硬绑**证据与生效性**——unknown-key 必须报给用户看、mutable 键必须有 UI 或显式登记为不可 UI、阈值改动受校准门约束（`decision-thresholds` 的 evidence 绑定先例）。即"**配置可审计 + 设置必然生效**"，不是把别家的多层配置文件抄一遍。体现本地主权：全部诊断在本地生成，无任何上报。

## 3. patch 还是 refactor（判定=**scoped refactor**，信号已满足）

判定依据（治理 skill 的三条信号全部命中）：同一处（配置读取）已在堆**第六份**同构实现；需要既有概念的第二个变体（每加一个设置就再抄一遍 env>文件>默认）；补丁要靠绕过/复制已有知识才能完成。故按 BLOCK-92 先例执行**拆前基线、拆后对账**：P6 的"逐键值相等"对账测就是行为基线，绿了才算拆对。范围严格限定在 §0.3 那一族 + 三个缺陷点，**不顺手重构凭据/清单/运行态**—— purity 指更少结构而非新结构。

## 4. 范围与非范围

**范围（三族垂直切片）**：`feature-flags` / `decision-config`+`decision-thresholds` / `ai-settings` 的 `generation`+`costCapCny` 子族。加 schema 单源、优先级模型单实现、unknown-key 诊断、P4 三缺陷、P5 漂移门。
**非范围（红线）**：
- **不合并** §0.3 清单里的东西（凭据/会话运行态/装配清单/每请求态）。
- **不迁移磁盘形状、不改文件名、不改键名**（改名会破坏旧文件兼容＝本包验收条款明禁）。剩余 11 处落点留 B1b/B2，**不宣称全部统一**。
- **不改任何阈值数值、不改 judge 校准键与模型名**（BLOCK-119/194 红线；P4① 只改"读取时机"，默认值一字节不动）。
- **零新依赖**（DEPENDENCY-CHANGE-CHECKLIST 默认答案=不；复用本仓已有三份手写 schema 子集的形态）。
- 不做设置搜索/导出/按区重置（P0-3 是**下游挂件**，本包只交付其载体）。
- 不做 profile 多套配置同步（只到"命名覆盖层雏形"），不做 i18n/hooks（⛔ 待裁决项）。
- 不改 `accessMode` 语义与 guard 判定；不改凭据取数链（192 裁决）。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 5. 落位与形状

- `core/packages/shared-config/schema.js`：键注册表 + 纯函数 `validate`/`diagnose`/`resolveWithLayers`（**放这里的原因=架构规则**：R4 明写 `core/packages/**` 是前后端合法共享层，R5 禁 `src→core/petri-server`，注册表要被设置 UI、主进程、后端三方同源消费，只有这一层合规）。
- `core/petri-server/config/config-service.js`：后端侧落点适配器（文件/SQLite/env 接线），既有 `feature-flags`/`decision-config`/`ai-settings` 的读取函数**内部改接**它，对外签名与返回形状零破坏。
- 契约测：`test/block199-config-schema.test.mjs`（注册表形状/重复键/幽灵别名零容忍/优先级表驱动）、`test/block199-unknown-key.test.mjs`（读不炸写不进 + 结构化 diagnostics）、`test/block199-threshold-runtime.test.mjs`（P4①② 红→绿：改配置即改判定）、`test/block199-config-drift.test.mjs`（P5 漂移门源码扫描）。前端侧 `ThemeProvider` 失败可观测走前端测 + 实机腿（dev 栈可用则跑，不可用按环境档如实登记，沿用 BLOCK-184/195 先例）。

## 6. 验收门与证据位置

| 门 | 判据 | 证据 |
| --- | --- | --- |
| 拆前基线 | 三族"迁移前后逐键值相等"对账测**先写先绿**（旧实现上跑），再动实现 | `test/block199-config-compat.test.mjs` |
| schema 契约 | 注册表自检 + 每键证据/落点/可改性齐 + 幽灵别名零容忍 | `test/block199-config-schema.test.mjs` |
| 生效性 | P4 三缺陷各自红→绿（改阈值真的变判定 / report-guard 进注册表且默认关 / theme 写失败不静默） | `test/block199-threshold-runtime.test.mjs` + 前端测 |
| 兼容 | 旧文件不迁移可读、含未知键不炸启动 | `test/block199-unknown-key.test.mjs` |
| 漂移 | schema↔UI↔IPC 双向对账 | `test/block199-config-drift.test.mjs` |
| 收口 | `test:changed` + `npm run closeout` 十三门 + 五件套 | AUDIT-LOG 收口行 |

**如实登记条款**：包完成时若三族之外的落点仍未收编，写明"地基已交付、覆盖率=3/14 族"，不得表述为"配置已统一"。
