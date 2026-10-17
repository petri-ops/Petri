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
status: completed
---

# BLOCK-199 — 配置 schema 层与统一配置服务（阶段 3 · B1 地基）

- 状态：`completed`（2026-10-17 当日立项当日收口·零人参与·closeout 十三门全绿；**地基 + 四族接线 + 三缺陷清偿 + 漂移门在册，14 落点收编 4 处 = 阶段 3 B1 交付，B1b 未做**）
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
- **不迁移磁盘形状、不改文件名、不改键名**（改名会破坏旧文件兼容＝本包验收条款明禁）。剩余 **10 处**落点留 B1b/B2，**不宣称全部统一**（原写「11 处」与 §12「14−4=10」自相矛盾，2026-10-17 由 BLOCK-203 P0 核对更正；B1b 已拆为 W4a/W4b 两片）。
- **不改任何阈值数值、不改 judge 校准键与模型名**（BLOCK-119/194 红线；P4① 只改"读取时机"，默认值一字节不动）。
- **零新依赖**（DEPENDENCY-CHANGE-CHECKLIST 默认答案=不；复用本仓已有三份手写 schema 子集的形态）。
- 不做设置搜索/导出/按区重置（P0-3 是**下游挂件**，本包只交付其载体）。
- 不做 profile 多套配置同步（只到"命名覆盖层雏形"），不做 i18n/hooks（⛔ 待裁决项）。
- 不改 `accessMode` 语义与 guard 判定；不改凭据取数链（192 裁决）。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 5. 落位与形状

- `core/packages/shared-config/schema.js`：键注册表 + 纯函数 `validate`/`diagnose`/`resolveWithLayers`（**放这里的原因=架构规则**：R4 明写 `core/packages/**` 是前后端合法共享层，R5 禁 `src→core/petri-server`，注册表要被设置 UI、主进程、后端三方同源消费，只有这一层合规）。
- ~~`core/petri-server/config/config-service.js`：后端侧落点适配器（文件/SQLite/env 接线），既有 `feature-flags`/`decision-config`/`ai-settings` 的读取函数**内部改接**它，对外签名与返回形状零破坏。~~ **实际交付形态（2026-10-17 BLOCK-203 P0 核对更正）**：该文件**从未创建**（`git ls-files` 零命中、目录不存在）；收编改由**各族 helper 直接 `require` schema 函数**实现（`ai-settings.js:26`、`config-transfer.js:21`、`cost-cap.js:19`、`decision-config.js:7`、`feature-flags.js:22`、`keymap.js:25`、`network-config.js:23`、`reasoning-config.js:23`、`runtime-policy.js:23` 共 9 处），对外签名与返回形状同样零破坏。**后续包不得假设存在该适配器**；W4a/W5/W6 沿用"族 helper + schema 函数"形态，不补建第二抽象。
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

## 7. 进度（2026-10-17 本轮落地的切片，剩余点名不藏）

**已落**：
- P0 测绘：§0（14 落点／4 root／6 回落链／零校验依赖／三份可抽用的既有 schema 子集）+ §0.2.1 第四条矛盾登记转 C-32。
- 拆前基线：`test/block199-config-compat.test.mjs` 8/8 绿（**冻结文件**——重构后它红了就是改了用户可感行为，回退实现而不是改测试）。
- P1 地基：`core/packages/shared-config/config-schema.js`（纯函数零 require 零第三方；只声明形状，阈值数值与证据仍在 `decision-thresholds` 不复制）+ `test/block199-config-schema.test.mjs` 8/8（含 env 别名真实性全仓扫描、共享层纯度与零依赖核验）。
- P2 首族接线：`feature-flags` 的优先级与 env 三态解析改由 schema 单源提供（默认值与标签留本模块，属行为数值非形状）；双向漂移对账进契约测；连既有 `feature-flags.test.mjs` 合计 **26/26 绿** ⇒ 接线未改行为。
- P2b 四族声明全部实接（2026-10-17 同日续推）：`decision-config` 启用档、`feature-flags`、`ai-settings` generation、`cost-cap` 的优先级与形状全改由 schema 单源提供；三处胜负关系**逐字保真**并由拆前基线复验（基线 8/8 · decision-config 消费者面 41/41 · generation/cost-cap 面 30/30 · `test:changed --base=4f2d1941` 116 项 114pass/0fail/2skip）。
  两条刻意保留的边界写进代码注释而不是悄悄改行为：① generation 的「env 一旦存在就赢，哪怕值非法也直接丢键、不回落文件」；② decision-points 的 threshold/gates **不走通用层**（默认值与证据绑在 `decision-thresholds`，改值须先重校准——通用 schema 只声明形状，不裁决校准数值）。顺带更正 `cost-cap.js` 文件头「硬熔断」措辞（实测是提示级诚实收尾）。
- P4① 缺陷清偿（红→绿）：`tool-router.js` 采纳阈值从模块加载冻结改为调用时读运行时；`test/block199-threshold-runtime.test.mjs` 5/5 含"改回 0.11 立即再生效"与"无 stored 覆盖时仍按 θ=0.8 判"（校准数值未动）。
- 门禁侧：`quality:arch` 无违例（1469 模块）、`quality:knip:check` 保留面零新增（地基不是死文件）；`test:changed --base=22acc389` 113 项 111pass/0fail/2skip。
- 测绘副产物入册：`feature-flags`/`decision-config` **此前无任何 impact-map 规则覆盖**（改它们会 fail-closed 升级全量），已由 `block199-config-schema-service` 规则补上盲区。

**同日续推落到收口（此段原写「未落」，完成事实见 §8 表，不留陈旧断言）**：P3 写侧统一拒绝 + `config:doctor` 用户可见出口；P4② `report-guard` 收编进 `RUNTIME_POINTS` + 注册表；P4③ `ThemeProvider` 跨端写失败可见化（`prefsSync`，台账 UI-513 记 in_progress）；P5 漂移门四向对账全量；P6 兼容收尾 + closeout 十三门 + 五件套回写。

**注册表覆盖率=4/4 族实接、14 落点中收编 4 处**；其余 10 处落点与 4 条 data root 脑裂根治属 **B1b（runlist W4）**，本包不得表述为「配置已统一」。


## 8. 收口交付记录（2026-10-17 实跑，非叙述）

| 项 | 交付 | 证据 |
| --- | --- | --- |
| 地基 | `core/packages/shared-config/config-schema.js`：4 族 13 键注册表 + 校验/优先级/未知键诊断/写侧守卫/env 遮蔽，**纯函数零 require 零第三方** | `test/block199-config-schema.test.mjs` 8/8（含 env 别名全仓真实性扫描与共享层纯度扫描） |
| 拆前基线 | 三族既有胜负关系与形状冻结（**此后不许改测试**） | `test/block199-config-compat.test.mjs` 8/8 |
| 四族接线 | feature-flags（首族）、decision-config 启用档、ai-settings generation、cost-cap 全改由 schema 提供形状与优先级 | 基线 8/8 + 消费者面 41/41 + generation/cost-cap 30/30 + `test:changed --base=8ef88029` 238 项 236pass/0fail |
| 写侧守卫 + 出口 | `commitGuard`（未注册键/非法值/只读键拒绝，null 仍清键）；`generation-defaults` 写路径从「静默丢键」改 **400 + 结构化诊断**；`npm run config:doctor` 打印未知键/非法已存值/env 遮蔽 | `test/block199-write-guard.test.mjs` 6/6；本机实跑=0 未知键 0 非法值 0 遮蔽、两落点尚未创建（读不落盘） |
| 缺陷① | `tool-router` 采纳阈值改调用时读运行时——**设置页热调真的改判定**；无 stored 覆盖时仍按校准 θ=0.8（数值未动） | `test/block199-threshold-runtime.test.mjs` 5/5（红→绿；含「改回 0.11 立即再生效」） |
| 缺陷② | `report-guard` 收编进 `RUNTIME_POINTS` + 注册表：默认关与 env 0/1 语义一字未改，新增能力=设置页可显式开并落盘，env=0 仍一票否决 | `test/block199-report-guard-point.test.mjs` 4/4 |
| 缺陷③ | `ThemeProvider` 跨端写失败可见化（`prefsSync` 状态 + 控制台留痕；本端仍立即生效不回滚，15s 拉取继续收敛服务端真相） | `frontend/src/themes/ThemeProvider.sync.test.tsx` 4/4 + 既有面 9/9；台账 **UI-513 in_progress**（提示文案尚未接，不标 verified） |
| 漂移门 | 注册表族 ↔ 设置面承载 ↔ 写路由 4xx ↔ `RUNTIME_POINTS` 集合 四向对账 + envKey 同源 | `test/block199-config-drift.test.mjs` 5/5 |

**漂移门落地当天就抓到一处真实漂移**：我把 `report-guard` 收进 `RUNTIME_POINTS` 却没在注册表登记——正是该门要堵的「注册表外隐藏开关」缺陷类，当场补登记。

**门禁与例外留痕**：`npm run closeout` 十三门全绿。过程中三门各抓到我一处问题并各自修掉：①`quality:lint` 11 errors（测试里 act 套无 await 的 async 箭头 + 对 BodyInit 隐式字符串化）；②`quality:knip:check` 抓出 `PrefsSyncState` 是**无消费方的导出**→取消导出（等设置面真接上再导出），台账已记；③`ui:audit:check` 两次判 `frontend/src/themes/**` 属 UI 面→补 UI-513 台账行同行提交（**不编造 verified**，提示文案未接就记 in_progress）。**教训固化**：含反引号/正则的台账改动必须落盘脚本执行——本会话两次被 bash 吞掉反引号（一次 lint、一次台账文字）。

**未做（不得被本包表述为已完成）**：其余 **10 处落点未收编**（`user-prefs`/`mcp-settings`/`skill-prefs`/主进程窗口态/**renderer localStorage 那一套**/SQLite `site_settings` 等）与 **4 条 data root 脑裂根治** = B1b；`config:doctor` 尚未接设置面提示；`ai-settings` 顶层未知键仍是「报告不拒」（拒它会破坏设置页整坨写入，须与 B1b 一并设计）；C-32（env=1 与注释相反）只登记未改。注册表覆盖率=**4/14 落点**。
