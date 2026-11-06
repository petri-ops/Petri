---
capability: holistic-evaluation-2026-11-06
status: reference
goal: 以当前 Git HEAD、机械门禁、源码证据、用户链路和既有验收证据为准，对 Petri Desktop 做十一维度全量评估，并为下一阶段优化蓝图提供唯一事实基线。
acceptance:
  - 十一维度均有当前证据、评分、缺口与优化目标
  - 机械门禁与定向测试结果落 acceptance/evaluation-2026-11-06/mechanical-baseline.json
  - 高杠杆发现逐条附 file:line、影响与修法
  - HEAD 已交付与未知 WIP 分账，未知 WIP 原样保留
reopen: 源码、基线、证据或工作区变化后按报告 §6 重跑受影响门禁
---

# Petri Desktop 全量评估报告（2026-11-06）

> 形态：**评估（EVALUATION / HOLISTIC REVIEW）**，承接 `docs/Petri-Desktop-Evaluation-Report-2026-11-05.md`，不替代其历史结论。
> 本轮目标不是复述“有哪些功能”，而是回答：**功能是否真的可达、错误是否可见、证据是否可复跑、结构是否还能长期演进、用户是否感觉可靠且顺畅**。
> 阶段纪律：项目长期处于 G0 开发期；本评估不外推 packaged/Provider/GA，也不把发布资格相关事项列为缺口。

---

## §0 执行摘要

### 0.1 一句话结论

Petri 已经从“功能很多”走到“能力面机械自洽且多数用户链路可达”，但**核心 Agent 主链仍存在若干静默失败与单源缺口，体验层仍存在错误不可见、能力位未贯通、键盘与长列表边界不足，质量门禁当前也并未持续全绿**。下一阶段应从“继续加功能”转为“把真实链路、错误语义、证据门禁和结构单源修到可信”。

### 0.2 本轮新增的结论

1. **功能面矩阵已自洽**：115 个工具、115 份契约、168 个 IPC 通道、285 个路由端点，`P1=0 / P2=0 / P3=2`；能力地图按 16 个能力域生成，明确 G0 边界。
2. **但“矩阵可达”不等于“端到端可靠”**：Agent 主链的 `errorsAsRejections` 在生产调用链被丢弃，流式网络中断的整轮重试契约未落地；上下文预算是一次性 latch；压缩、摘要、降级分类存在多套语义。
3. **当前质量门禁不是全绿**：`quality:lint` 有 2 个错误，`gate:code-size` 失败，`quality:perf` 连续三次为 FAIL/PASS/FAIL，定向测试 1551 通过 / 6 失败 / 7 取消 / 4 跳过；全量测试任务被 SIGTERM 中断，不能宣称通过。
4. **安全底盘有机械门禁，但执行准入仍有边界缺口**：`quality:secret`、`quality:arch`、`gate:arch-cycles` 通过；同时 `file-dialog` 写通道缺少 sender guard，审批决策与执行侧 capability token 未闭环，部分 DB/产物真值链依赖引用而非哈希链。用户关于 `workspace_exec` 黑名单默认放行的裁决保持不变，本报告只评估风险提示、审计、严格开关和其余边界。
5. **用户体验基础较完整，但“可信体验”未闭合**：UI 台账按标题计 494 `verified` / 52 `in_progress` / 7 `cancelled`；主题 token 契约 17/17；但 UI-694/695 仍缺实机观感，同步失败、viewer 降级、实验开关加载失败、隐藏层键盘焦点和长列表 DOM 预算仍有缺口。
6. **文档治理采样发现计数漂移，本轮交付时已同步**：采样时 `docs:check` PASS，注册表 488 项、托管 Markdown 471 项，而 `coverage.documentCount=429`、`managedMarkdown=163`；登记两份新文档后已同步为 490/473 并复跑 `docs:check` PASS。仍余 AUDIT-LOG 85KB 超建议阈、旧 P1 条目需逐条核销。
7. **工作区存在在制改动**：HEAD 为 `fe44fceb`，工作树有 22 个已跟踪修改、10 个未跟踪项、335 行新增 / 61 行删除；它们集中在模型链、Agent loop、提示词和新增测试。本轮没有修改、提交、暂存或清理这些 WIP，所有结论均按“HEAD 已交付”与“WIP 候选”分账。

### 0.3 评分口径

下列分数是**十一维证据锚定评分**，用于比较优化前后，不与上轮“工程 A / 产品 B”的粗粒度评级直接换算。5 分表示当前证据下该维度可长期托重，1 分表示核心链路尚不可信；没有证据的项目扣分而不是给分。

| 维度 | 当前 | 主要依据 | 下一阶段目标 |
| --- | ---: | --- | ---: |
| 功能完整性 | 4.2 | 115 工具/168 IPC/285 路由；矩阵 P1/P2=0；8 任务套件 7/8、T6 波动 | 4.6 |
| 性能表现 | 3.5 | 冷启动约 540ms、长会话约 20–36ms、大目录约 12–20ms；性能门间歇红；全量套件未完成 | 4.3 |
| 代码质量 | 3.3 | types PASS、secret/arch PASS；lint 2 errors、code-size FAIL、13 存量环、2296 warnings | 4.4 |
| 可维护性 | 3.2 | `runLoop` 1675 行单函数、源码扫描契约、重复 DB/版本常量、488 文档与活跃账本 | 4.3 |
| 可扩展性 | 4.2 | 16 域 facade、MCP 单入口、11+3 Skills、插件 Manifest v1；源解析与元数据有分叉 | 4.7 |
| 安全性 | 3.4 | 密钥/架构/权限基础门禁通过；sender guard、审批重放、token 边界与路径来源有缺口 | 4.5 |
| 用户界面与交互体验 | 3.7 | 494 verified、主题 17/17、结果宿主统一；52 in_progress、静默降级、a11y/长列表缺口 | 4.5 |
| 错误处理与边界情况 | 3.1 | 多处空 catch、静默重试/降级、失败不发 done、flag 语义冲突、压缩失败无事件 | 4.5 |
| 测试覆盖 | 3.7 | 定向 1568 项、EAR 43.5%、负测文化；但 6 红/7 取消、全量 SIGTERM、基线漂移 | 4.6 |
| 文档完善度 | 4.3 | docs:check PASS、能力地图自动生成；采样发现计数漂移并已同步，仍有旧票未核销与账本过大 | 4.7 |
| 依赖与架构合理性 | 3.7 | R1–R5 无违规、无新环、无生产密钥；但双 DB 根、native ABI、13 存量环、补丁堆叠 | 4.5 |

**综合判断**：工程底盘仍强，产品可用性已具备，但“可信与透明即能力”没有完全兑现；最该补的是**失败可见性、单一真相源、执行准入闭环、持续全绿的门禁、以及用户可感知的错误/能力位**。

---

## §1 事实基线与证据边界

### 1.1 双轨口径

| 轴 | 事实 |
| --- | --- |
| 已交付基线 | `main` HEAD `fe44fceb`，最近提交包含 UI-695、exec 默认放行、p6 源绑定、BLOCK-355～358 收口链 |
| 在制候选 | 22 个已跟踪修改 + 10 个未跟踪项；主要涉及 `agent-loop-control.js`、`loop-orchestrator.js`、`model-gateway.js`、`anthropic.js`、流式看门狗、提示词和 3 个新增测试 |
| 本轮动作 | 只读核查、门禁取样、测试复跑、形成评估与 planned 蓝图；未改产品代码、未提交、未清理 WIP |
| 证据等级 | 当次命令输出 > Git/源码 > acceptance JSON > canonical 文档；历史“全绿”不自动复用 |

### 1.2 当次机械门禁

| 门禁 | 当前结果 | 判读 |
| --- | --- | --- |
| `npm run state` | 无 🔴/🟢 未决；active canonical 槽位显示 `G0-LF` | 与 handoff 顶部“无 active 工作包”存在口径漂移，需治理对账 |
| `git status` | 22 M、10 ??；`git diff --stat` 335+/61- | 全量门禁结果受 WIP 影响，不能直接描述为纯 HEAD 资格 |
| `docs:status` / `docs:check` | 采样 PASS；Registered 488 / Managed Markdown 471；交付后 490/473，`docs:check` PASS | 采样时 coverage 字段为 429/163，本轮治理批已同步为 490/473；仍需生成器化防回潮 |
| `ui:audit:check` | PASS；626 个 UI 编号有实现证据 | 只检查同步，不证明每个 verified 都有当前实机视觉证据 |
| `hygiene:check` | PASS；无死链/CRLF/控制字节/真 symlink 退化；36 项 untracked 仅列出 | 用户资产与临时目录不判失败，也不得代删 |
| `quality:secret` | PASS；生产面 0，fixture 豁免 9 | 密钥面健康 |
| `quality:arch` | PASS；R1–R5 无违规 | 前后端/主进程边界机械守住 |
| `quality:surface` | PASS；tools 115/115、IPC 168、routes 285、storageKeys 20、P1=0/P2=0/P3=2、dirty=9 | 功能面定义/契约/handler/元数据自洽；2 个 P3 是 storage read-never-written |
| `quality:ear` | PASS；881/2026 = 43.5%（manifest 43.3%） | 证据资产化达标且棘轮未回退 |
| `gate:arch-cycles` | PASS；13 个存量环在册，无新环 | 架构环受控但存量债仍应设消亡路线 |
| `gate:css-modules` | PASS；11 个 plain CSS 全在 13 项白名单，2 个可收缩 | 样式面受控 |
| `quality:types` | PASS；0 errors | 前端类型面健康 |
| `quality:lint` | **FAIL**；2 errors / 2296 warnings | `frontend/src/components/copilot/SimpleChat/modelConfigAndCollapse.test.tsx:40-41` 两处不必要类型断言 |
| `quality:knip:check` | PASS；327 键保留面无新增 | 死代码棘轮未放宽 |
| `gate:code-size` | **FAIL** | `core/petri-server/agent-tools/workspace-tools.js` 1636 > 基线 1619，且内容指纹未重打；另有 `PluginStorePanel.tsx` 例外可移除 |
| `quality:perf` | 三次当次复跑 **FAIL / PASS / FAIL** | long_conversation 34ms / 32ms / 36ms，阈值 32ms；低耗时纯百分比判据不稳定，不是 34ms 产品性能退化 |
| `skills:check` | PASS；11 内置 + 3 领域包 | 产品 Skill 契约齐 |
| `config:doctor` | PASS；未知键 0 / 非法值 0 / env 遮蔽 0 | 9 个可选配置缺文件为默认未配置，不属缺陷 |
| `theme-token-contract` | PASS；17/17 | 海军蓝 token 与暗色覆盖形态守住 |
| `npm run test:changed` | **FAIL**；1568 tests，1551 pass / 6 fail / 7 cancelled / 4 skipped，43.5s | 见 §4.4 分类；含 WIP、脏树证据绑定、存量基线和外部 pack 环境 |
| `npm run test:all:workspace` | **未完成**；task `exitCode=143 / SIGTERM`，约 40 分钟后被中断 | 不宣称通过或产品挂起；需要独立、有界、可复跑的全量套件策略 |
| `c48-full-rebuild` 历史任务 | exit 1，真因是 CodeBuddy `safe-delete` 批量删除守卫拦截 `dist/mac-arm64` 5473 项 | 属工具链环境中断，不是产品构建失败，不能与 C-48 已验收结论混算 |

完整机器摘要见 `acceptance/evaluation-2026-11-06/mechanical-baseline.json`。

### 1.3 用户任务级证据

- `acceptance/block-348/results.json:512-516`：基线 6/8、0 干预；`results-t7-rerun.json:21-33` 实锤 C-45 tool 消息配对破坏。
- `acceptance/block-355/t7-rerun-c45-fix.json:19-88`：C-45 修复后 T7 单任务 completed，49 次工具调用、compaction=1、20 项 FACT 全收、0 干预；但为窗口覆写 20000 的冻结场景，不是自然长会话。
- `acceptance/block-356/results-v2final.json:520-523`：全套 v2 两次 7/8、0 干预；T6 因 `synthesis.md` 缺 `TURING-9` 判红，T7 48 次调用且压缩触发。
- `acceptance/block-356/results-v2final.json:531-538`：8 个任务的 `humanEyePending`、`toolSelectJudge`、`artifactJudge` 仍待人工填写；机械判据通过不能冒充人眼验收。
- 真实 Provider 证据只覆盖 `deepseek-flash` / `deepseek-chat`；本轮不外推 Provider 矩阵。

---

## §2 十一维度详尽分析

### 2.1 功能完整性 — 4.2 / 5

**已验证优势**

- `docs/functional-surface-matrix-2026-11-04.md:8-16`：115 个工具定义、115 份契约、116 份调度元数据、168 个 IPC 通道、285 个路由端点、20 个设置键；P1/P2 清零。
- `docs/capability-map.md:14-33`：16 个能力域按用户可理解的方式生成，明确“可达=定义+契约+handler+元数据+至少一档放行”，并声明不承诺任务成功率。
- `docs/functional-surface-matrix-2026-11-04.md:37-151`：浏览器、computer-use、知识空间、3D、worktree、Result Studio、MCP、Skills、workflow、联网检索等均有逐工具可达性。
- `acceptance/block-352/shelf-matrix.json`：三货架 21 项判定 17A / 4D / 0S，零空壳；4 个 detour 逐件保留外部条件，不伪造直连。
- `docs/capability-map.md:7-12`：能力地图严格限定 G0 dev Electron 边界，不外推发布态。

**缺口**

- 功能面矩阵是“结构化可达性”，不是用户任务成功；8 任务套件仍 7/8，T6 波动未归因到稳定根因。
- `docs/functional-surface-matrix-2026-11-04.md:13` 有 2 个 preload 缺包装、165 个前端零消费通道；虽矩阵判 P3，但说明 IPC 面存在大量“定义先于用户入口”的沉积。
- `docs/functional-surface-matrix-2026-11-04.md:30-31`：两个 storage key 只读取不写入（`petri_token`、`petri.simplechat.extraRenderers`），属于兼容残留或第二通道信号，需逐件裁决。
- C-46 属兄弟仓，C-47 观察未复现且根因未归因，O-1 屏幕观感仍需人工确认；它们不应被本仓代码改动“假装清偿”。

**优化目标**：保持 P1/P2=0，将 P3 逐件销号或显式裁决；把 8 任务套装改成“连续多次 8/8 + 人眼判据落盘 + 无 windowOverride 的自然长任务”；新增能力必须先有用户入口、审批、错误态和回归证据，不允许只增加工具数量。

### 2.2 性能表现 — 3.5 / 5

**已验证优势**

- `quality:perf` 四场景基线：冷启动约 540–588ms、长会话 20–36ms、大目录 12–20ms、packaged_start 517–635ms；三绿一红时其余场景稳定。
- `acceptance/block-350-perf-report.md` 已把性能门接入 closeout；`quality:ear` 43.5% 证明证据引用面在位。
- `scripts/test-affected.mjs` 的 map 校验已 memoize，历史 closeout 从约 14min 降至约 3min。

**缺口**

- 低耗时场景用 `median 20ms × 1.6 = 32ms` 的纯百分比阈值，样本 32/34/36ms 正好跨在边界；三次采样 FAIL/PASS/FAIL，说明门本身不稳定。
- 全量 Node + 前端测试任务 40 分钟后 SIGTERM，当前没有“可完成、可归因、有界”的全量套件证据。
- `core/petri-server/loop-orchestrator.js:222,767-809`：上下文预算只在首次修剪前计算，之后每轮仍追加消息但不再估算/发 `token_budget`，长任务内存与请求体持续膨胀。
- `core/petri-server/helpers/conversation-compaction.js:116-132,191-197`：重复压缩把已摘要历史与旧摘要再次全量送入模型，摘要输入随会话线性增长，触发次数也线性增长，token 成本呈 O(n²) 风险。
- `frontend/src/components/copilot/SimpleChat.tsx:1539`、`frontend/src/components/workspace-panels/LeftPanel.tsx:439,650,658`、`ResultsLibrary.tsx:58-95`：消息/会话/结果库仍全量 DOM 渲染，缺少统一视口预算。

**优化目标**：`quality:perf` 改“绝对上限 + 相对容差 + 连续 5 次 PASS + 负测仍红”；上下文预算每轮计算并每轮发事件；压缩改增量摘要；DOM 预算以实测节点数和滚动帧率为触发器，不先引入新依赖。

### 2.3 代码质量 — 3.3 / 5

**已验证优势**

- `quality:types` 0 errors；`quality:secret` 生产面 0；`quality:arch` R1–R5 PASS；`quality:knip:check` 327 键冻结；theme token 17/17。
- `src/ipc/channels.js:3-8` 与 `test/ipc-channels-registry.test.mjs:81-107` 维护 IPC 通道单源；`src/main/security-hardening.js:88-133,263-305` 对 webview 与权限默认拒绝。
- 负测文化成熟：`test/block355-trimmer-atomicity.test.mjs` 复刻旧算法判红，`quality:ear` 含删证据/跌破棘轮负测，功能面矩阵含检测可信度负测。

**缺口**

- `frontend/src/components/copilot/SimpleChat/modelConfigAndCollapse.test.tsx:40-41`：两处 `as HTMLSelectElement` 不必要类型断言，`quality:lint` 当前红；2296 条存量 warnings 虽在抑制基线，仍压低可读性。
- `core/petri-server/agent-tools/workspace-tools.js` 当前 1636 行超过 1619 棘轮且指纹未重打，`gate:code-size` 红。
- `core/petri-server/loop-orchestrator.js:173-1673` 中 `runLoop` 是 1675 行单函数，文件内 30+ `BLOCK-*` 加映注释，符合“补丁堆积”信号；`agent-tools/index.js` 再导出约 40 个符号。
- `test/agent-runner-loop-orchestrator.test.mjs:33-80` 与 `test/loop-orchestrator-subdomains.test.mjs:44-56` 用源码 `includes`/行数当契约，且部分断言保护未消费死参；`test/loop-orchestrator-subdomains.test.mjs:149-160` 的 1250 行上限与实际 1675 行冲突。
- `core/petri-server/helpers/circuit-breaker.js` 全仓零消费；`model-gateway.js:110-118` 与 `provider-reliability.js:3-6` 各有一套可重试错误分类。
- `core/petri-server/helpers/system-prompt.js:67-104` 仍有 web/学习时代错误文案，经 `localizeToolResult` 进入桌面工具结果；`:257-261` 是恒返回 `null` 的桩。

**优化目标**：lint 0 error、code-size PASS 且例外只减不增、行数棘轮按实测重打只许下降；源码扫描契约逐步换行为契约；死熔断/死参/legacy 文案/恒 null 桩集中清理。

### 2.4 可维护性 — 3.2 / 5

**已验证优势**

- `docs/document-governance.md:22-36` 明确唯一事实分工；`docs:check` 488 项注册 PASS；`docs/README.md` 有按月滚动的可发现入口。
- `npm run state`、`closeout`、`docs:reconcile`、`hygiene:check`、`test:changed:list` 已把会话恢复、收口、卫生与影响范围机械化。
- `src/ipc/channels.js`、功能面矩阵、能力地图、UI 台账、EAR manifest 均强调单一真相或自动生成器。

**缺口**

- 采样时 `docs/DOC-REGISTRY.json:12-14` 的 `documentCount=429`、`managedMarkdown=163` 与 `docs:status` 的 488/471 漂移；本轮交付已同步为 490/473 与 `2026-11-06`，但仍缺脚本化生成以防回潮。
- `docs/AUDIT-LOG.md` 85KB > 50KB 建议阈，L118 单条约 3732B；旧 P1 条目（11-04）与 BLOCK-346“P1 清零”结论需要逐条核销，不能按日期覆盖。
- `npm run state` 显示 `G0-LF` active，而 handoff 顶部仍有“无 active 工作包”的历史声明；当前优先级与活包槽位需 canonical 对账。
- `src/migration-runner.js:39,56` 与 `src/database/_db-singleton.js:73-90`、`core/petri-server/db/connection.js:15-29` 各自开库/pragma；`artifact-truth.js:5`、`result-studio-contracts.js:33`、`delivery-manifest.js:9` 三处版本号常量独立。
- `core/petri-server/mcp/registry.js:375-395` 与 `plugin-loader.js:19-28,707-719` 的插件源解析分叉；`plugin-loader.js:741-791` 与 `:793-838` 两套近重复装载函数。

**优化目标**：coverage 字段由脚本维护；AUDIT-LOG 只保留活跃广播；DB path/pragma/version/插件源/错误分类全部单源；`runLoop` 按 init/provider/tools/decision/finalize 拆分，行为基线前后同套测试绿。

### 2.5 可扩展性 — 4.2 / 5

**已验证优势**

- `core/petri-server/agent-tools/tool-defs.js:13-49` 以 16 域 facade 汇编，消费方只认 facade；MCP `registry.js:544-561` 是 listTools/callTool 单入口。
- `scripts/skill-scaffold.mjs:129-191` 对 11 个内置 Skill 与 3 个领域包 Skill 共用目录/版本/格式校验；`skills:check` PASS。
- `plugin-loader.js:307-387` 把 plugin.json + tool-definition.json 归一为 PetriPluginManifest v1；未登记新 Skill 会让 check 故意失败。
- `docs/capability-map.md:3-5` 由功能矩阵确定性生成并有越界宣称守卫；`docs/block-357-report.md:9-20` 的 4 个 detour 逐件保留触发条件。

**缺口**

- `core/petri-server/mcp/registry.js:388-395` 硬编码 `PETRI_PLUGINS_DIR || ~/Documents/Petri-Local/plugins`，漏 `PETRI_LOCAL_DATA_DIR` 单源路径；packSources 也仅在 dataDir 存在时加载。
- `core/petri-server/mcp/registry.js:557-560` 只从 `t.function.name` 取名，而 MCP 条目是 `{name,...}`，导致动态插件/Skill 工具拿不到 `executionMetadata` 保守缺省。
- `core/petri-server/mcp/registry.js:79` 的 `skill_discover.source` enum 缺 `pack`，与 `core/shared-backend/skill-registry.js:22,586` 和 shelf matrix 的三条 pack 记录冲突。
- `core/petri-server/plugin-loader.js:114-120` 未找到同名脚本时静默执行 `files[0]`，且 readdir 未排序；`:441-449` 注释支持 boolean/file/directory，实现除 number/integer/enum 外一律映射 string。
- `mcp/registry.js` 多处 try/catch 仅 warn，初始化失败仍对外宣称可用；`shelf-matrix.json` 是一次性静态证据，没有像能力地图一样的生成器一致性负测；`resources/skills/manifest.json` 部分 artifacts `sha256:null`。

**优化目标**：插件源、工具名、source enum、inputSchema 类型由单源常量派生；`listTools` 全量契约快照入门禁；初始化失败汇总为 health/degraded；shelf matrix 与 detour 复判生成器化；不新增依赖。

### 2.6 安全性 — 3.4 / 5

**已验证优势与用户裁决边界**

- `quality:secret` 生产面 0；`quality:arch` R1–R5 PASS；`src/main/security-hardening.js:88-133,263-305` 对 webview/session/permission 默认拒绝。
- `src/ipc/_sender-guard.js:8-14` 明确要求每个 `ipcMain.handle` 首行校验 sender；`agent-tool-policy.js:385-411` 与 `command-risk-rules.js:14-23` 保留档位、动态防护与 deny/ask 判定。
- `core/petri-server/agent-tools/workspace-tools.js:711-748` 体现用户裁决：sudo/rm/git push/curl|sh 默认放行并回传 `riskWarnings`，`PETRI_EXEC_STRICT_DENYLIST=1` 可一键收紧。**本蓝图不撤销、不重写该裁决**，只补齐可见性、审计与其余边界。

**缺口**

- `src/ipc/file-dialog.js:430-455` 的 `workspace:write-text-file` 丢弃 `_event`，没有 sender guard；`:442-450` 只校验相对 renderer 传入的 `workspacePath` 不越界，root 本身仍由渲染层指定。
- `core/petri-server/helpers/approval-request-store.js:35-70` 的 once/task 放行是模块内存 Map + 指纹；执行侧若从 HTTP、MCP 或 SSH runner 绕过同一拦截器，或审批后参数被改写，审批与执行不再闭环。需要一次性 capability token 校验并消耗，不改变 exec 默认放行裁决。
- `workspace-tools.js:695-710` 的 `PETRI_WORKSPACE_EXEC_TOKEN` 是进程级 env 且命中即跳过后续风险正则；本仓源码未发现明确签发者，token 是否可被子进程 `env`/`printenv` 读取复用标为 **⏳ 待验证**。应改为 per-call `handlerOptions` 注入并避免下沉到子进程 env。
- `src/migration-runner.js:39,56` 使用裸 `new Database(dbPath)`，无 WAL/busy_timeout/foreign_keys；`src/database/_db-singleton.js:111-120` 提供 `closeAll`，但 `src/main.js:838-843` before-quit 只关后端，生产侧无调用点。
- `core/shared-backend/result-studio-contracts.js:302-317,376` 的 revision 只有 `parentRevisionIds` 与单产物哈希格式校验，没有链哈希；`delivery-manifest.js:56` 的 sha256 取自 provenance 而非重算产物字节，manifestHash 只能证明记录自洽。
- `test/ipc-channels-registry.test.mjs:20-41,81-87` 的 CONSUMERS 为固定清单，注册表→preload 用 `includes` 子串；preload 新增未登记通道或新 IPC 模块手写字面量不会稳定判红。

**优化目标**：所有写 IPC 经注册包装器强制 sender guard + root 由主进程 project store 反查；policy→capability token→executor 三入口强制校验；DB 单连接工厂与退出 checkpoint；revision/manifest 链哈希和产物重算；IPC 双向集合相等门禁。

### 2.7 用户界面与交互体验 — 3.7 / 5

**已验证优势**

- `docs/ui-productization-audit.md:3-17`：UI-694/695 把设置五段、侧聊档位提示、钉住预览、模型快捷配置、折叠时机任务级化；但二者仍是 `in_progress`，明确缺实机腿。
- `frontend/src/components/workspace-panels/ResultArtifactShell.tsx:751-765` 产物失效有 `role="alert"`、重试与“让 Agent 检查”双出口；`frontend/src/themes/ThemeProvider.tsx:99-118,141-165,203-224` 支持明暗/字号/accent/motion 与跨端拉取。
- `frontend/src/components/settings/ExternalImportPanel.tsx:195-209,219-223` 危险操作两步武装、按 applyId 回滚；`SimpleChat.tsx` 模型配置下沉输入框，折叠按 run 收口。
- UI 台账按标题计 494 `verified` / 52 `in_progress` / 7 `cancelled`；theme token 17/17；`ui:audit:check` 626 个编号有实现证据。

**缺口**

- `frontend/src/themes/ThemeProvider.tsx:122-139,265-267` 偏好写服务端失败只进 context + `console.warn`，全 src 无 UI 消费；`:155` 拉取失败静默 catch。用户会以为跨端已保存却无从归因。
- `frontend/src/components/result-studio/viewerRegistry.ts:99-113,151-163` 使用“kind 或扩展名任一命中”，report/pdf/video 排在最前；`preview===false` 直接 binary 且不带原因。`kind='report'` 的 `.pdf`/`.mp4`/`.svg` 可能被塞进 HTML 预览，降级也无法解释。
- `frontend/src/components/result-studio/ResultStudioSurface.tsx:31-45,110-127`：Canvas 已按 `canCompare` 门控，导航仍无条件渲染“审查修改”；钉住入口也未消费能力位，形成点击后静默回落。
- `frontend/src/components/workspace-panels/CenterPanel.tsx:105-133`：非 chat 模式的会话层仅 `aria-hidden` + CSS 隐藏，SimpleChat 常驻挂载，输入框与按钮仍可 Tab 聚焦。
- `frontend/src/components/settings/ExperimentalFeaturesSection.tsx:132-169`：feature-flags 拉取失败静默且 `flags.length===0` 直接返回空片段，后端未就绪时整段开关凭空消失。
- `ExternalImportPanel.tsx:138-160,185,229`：radio 组无 fieldset/legend、textarea 只有 placeholder、`String(...)` 把对象补丁显示成 `[object Object]`、回滚结果无 live region。
- `LeftPanel.tsx:556-561,595-599,659-665` 项目树/SSH 状态点/会话行使用 div/span/li + onClick，缺 tree 语义、roving tabindex 与 aria-expanded；消息、会话、结果库全量 DOM 渲染；`ResultsLibrary.tsx:72` 等仍有硬编码 `fontSize:11`，字号缩放不跟随。

**优化目标**：能力位一条链贯通 viewer/Canvas/ContextBar/钉住；所有 catch 产生可见 UI 态 + 重试 + 原因；隐藏层 `inert`、树控件 role/tabIndex、分隔件 slider；消息/会话/结果库统一 DOM 预算；UI-694/695 和 52 条 in_progress 按证据终态化；视觉验收坚持元素级截图 + 几何四量测 + 长内容/窄窗口三态。

### 2.8 错误处理与边界情况 — 3.1 / 5

**已验证优势**

- `src/main/security-hardening.js`、审批卡、Artifact Truth、MCP override 四重校验、功能面 P1/P2 清零、EAR 负测、perf 负测都体现 fail-closed 或诚实降级。
- `block356` 对 T6 口令波动如实登记 7/8，不放宽判据；`block357` 对 4 个 detour 保留外部依赖，不伪造直连。
- `block358` 对 C-47 观察未复现、根因未归因时明确“不猜测性修复、不销票”。

**缺口**

- `core/petri-server/loop-orchestrator.js:1009` 传 `errorsAsRejections: true`，但 `helpers/llm-client.js:59-74` 未把该键透传到 `ModelGateway`，`model-gateway.js:220,275` 重建 options 时也不含它；真正读取它的是 `deepseek.js:336`。`test/block109-stream-retry.test.mjs:93-151` 只直连 provider 覆盖，生产 Agent 链路的流中 RST 仍 resolve-with-error，`callProviderWithNetworkRetry`（`loop-orchestrator.js:141-161`）只 catch throw，整轮重试未生效。
- `loop-orchestrator.js:1592-1600` 失败时只 `_emit({error})`，`emitDone()` 依赖 `modelFinalized`；SSE 客户端是否只靠 task 轮询兜底标为 ⏳ 待验证。`agent-fallback.js:197` 降级续跑任务用 `onEvent: () => {}`，增量正文/进度不进原 SSE 流。
- `model-gateway.js:377-379` 首 token stall 抑制 error，`llm-client.js:79-81` 静默重试一次，用户与观测面看不到重试。
- `conversation-compaction.js:38-44,178-211` 与 `message-trimmer.js:188-190` 的空 catch 均无事件、无计数；`loop-orchestrator.js:848-856` 压缩失败仍可能注入“上面有摘要”的 system note（`message-trimmer.js:251`），对模型形成不实声明。
- `helpers/model-fallback-policy.js:19-34,46-49` 先判可降级再判 `NON_DEGRADABLE_RE`，`cancelled: timeout` 等复合错误可能误判；`agent-fallback.js:80-81,104-122` 是否在用户取消后自动续跑标为 ⏳ 待验证。请求级 gateway 可 A→B→C，任务级只取首个候选，降级分类与候选集两套真相。
- `feature-flags.js:28-31` 三开关默认全 true，`conversation-compaction.js:176` 的 `resilienceOn = !b2 && ...` 默认恒 false，而 `chat.js:236,253-258` 仍按 resilience 渲染视图并传 `resilienceEnabled:true`；`maxOutput` 未透传，输出预算不预留。
- `main.js:641-645` 迁移失败仅打日志仍启后端；MCP registry 多处初始化 warn 后继续对外可用；CSS/设置面多个 catch 静默。

**优化目标**：所有失败有结构化原因码、可见事件/UI态、可重试或明确不可重试；重试/降级/压缩/裁剪统一决策结构；流中故障有全链 RST 集成测试；用户取消、401、多绑定 fallback 均有负测；SSE done/error 收尾契约化。

### 2.9 测试覆盖 — 3.7 / 5

**已验证优势**

- 定向测试 1568 项、1551 通过，43.5s；`test:changed:list` 当前映射 58 个改动文件到 151 个测试，可复现。
- `quality:ear` 43.5%、`quality:surface` P1/P2=0、`quality:knip:check` 冻结、`quality:secret` 生产面 0、`theme-token-contract` 17/17。
- BLOCK-355 负测复刻旧 trimmer 判红；BLOCK-351 EAR 删除证据/跌破棘轮负测；BLOCK-350 perf 阈值公式/基线齐备/fail-closed 负测；BLOCK-357 能力地图越界宣称守卫。
- `npm run verify -- --list`、dev-verify flow、离屏 9223、亮/暗实机证据覆盖大量 UI 增量。

**缺口**

- `test:changed` 当次 6 个失败、7 个取消、4 个跳过；失败分类见 §4.4。全量 workspace 测试被 SIGTERM，不能宣称 `test:all:workspace` 通过。
- `test/block116-decision-platform.test.mjs:277-282`、`test/block157-skill-visibility.test.mjs:41-45`、`test/tool-activity-labels.test.mjs:22-25` 仍把工具数硬编码为 114，实际 115；说明工具注册数基线没有单一来源。
- `test/block325-model-surface-budget.test.mjs:23-28` 实测 `systemPromptChars 1083 > 993`，与 WIP 提示词增长有关，需由 WIP 所有者显式重打基线并留因。
- `test/domain-neutrality.test.mjs:20-34` 命中 `FederationJobs.tsx` 的 `deseq2` 存量红；AUDIT-LOG 已登记需裁决“改 UI 文案”或重扫基线，不得擅自放宽棘轮。
- `test/g0-rs-p6-product-acceptance.test.mjs:682-692` 因脏树报 `p6_current_source_tree_not_exact`；`test/p4r-invariants.test.mjs:113-118` 因外部 pack demo 数据/格式依赖失败并取消 7 个子测试。
- `test/loop-orchestrator-subdomains.test.mjs` 可能未登记 impact-map；源码扫描契约保护实现细节而非行为；部分“冻结场景”用合成预算而非真实 20000 窗口。
- `acceptance/block-356/results-v2final.json:531-538` 8 任务的人眼/工具选择/产物判据仍 pending；机械绿不等于质量验收完成。

**优化目标**：工具数、模型面、领域词、代码体量等基线由生成器/单源常量派生；未知测试文件 fail-closed；全量套件分片、有界、可复跑；真实 20k 窗口长任务无需 windowOverride；人眼判据集中一次补齐并落证据。

### 2.10 文档完善度 — 4.3 / 5

**已验证优势**

- `docs:check` PASS；488 注册文档、471 托管 Markdown；`docs/README.md` 有编号入口；`document-governance.md` 定义唯一事实分工与退出码契约。
- `docs/capability-map.md` 自动生成且明确 G0 边界；`docs/functional-surface-matrix-2026-11-04.md` 逐工具完整；`docs/Petri-Desktop-Evaluation-Report-2026-11-05.md` 保留上一轮 A/B 评级与增量修订。
- UI 台账有 538 个编号条目与 BLOCK-346 T8 五类分诊；AUDIT-LOG 活跃项与处理记录分区明确；acceptance 证据与解释文档分离。

**缺口**

- 采样时 `docs/DOC-REGISTRY.json:12-14` 计数漂移，本轮已同步 coverage 与两份新文档；`docs:check` 仍提示 AUDIT-LOG 85KB 与 1 条超长行，生成器化缺口保留。
- `docs/AUDIT-LOG.md:73-78` 仍有 11-04 的功能面 P1 条目，而 11-05 roadmap 顶部记载 BLOCK-346 已 P1 清零；需逐件核销状态，不可按日期推定。
- `npm run state` 报 `G0-LF` active，handoff 顶部有“无 active 工作包”旧段；`next-tasks-2026-11-05.md` 仍包含阶段跃迁建议，不应在本蓝图中当作当前任务。
- `docs/README.md` 部分条目状态文字（active/planned/completed）与 registry 当前状态不同步，说明人工编号入口容易漂移。
- 部分证据引用的是一次性 acceptance JSON，缺自动刷新触发器；`shelf-matrix.json` 未生成器化，detour 复判时点没有机械触发。

**优化目标**：coverage 字段与 README 近期条目脚本化；AUDIT-LOG 自稳 + 旧票核销；canonical roadmap/handoff/active 槽位一致；能力地图、货架矩阵、UI 台账的状态变化均有生成器和负测；长报告只保留结论与证据指针。

### 2.11 依赖与架构合理性 — 3.7 / 5

**已验证优势**

- `quality:arch` R1–R5 PASS；渲染进程不直引 electron/node，后端不引主进程，前端不引后端实现，core packages 共享层合法。
- `gate:arch-cycles` 13 个存量环在册、无新环；`gate:css-modules` 白名单受控；无新依赖提案。
- `package.json:258-290` 根运行依赖 11 个，Node >=24，Electron 44.7.0；`frontend/package.json:20-74` 前端依赖以 React 18/Vite 8/CodeMirror/xterm/three/pdfjs/exceljs 为主，均有明确产品用途。
- `electron-builder` afterPack 与 C-48 已处理 asar core 路由、better-sqlite3 ABI 与重签；本轮不重跑发布级矩阵。

**缺口**

- `package.json:262` 的 `better-sqlite3` 使用 caret；`src/main.js:568-592,638-646` 与 `build/afterPack.js` 对 dev/packaged ABI 分治，native minor 升级可再次造成双根漂移；应精确锁版本并启动时断言 ABI/版本。
- `src/migration-runner.js:39,56`、`src/database/_db-singleton.js:73-90`、`core/petri-server/db/connection.js:15-29` 三处连接策略与路径来源分裂；`PETRI_LOCAL_DATA_DIR` 与 `PETRI_DB_PATH` 可指向不同库。
- `src/migration-runner.js:66-77` 用字典序 `sort()` + `parseInt` 定序，无重号/非法名校验。
- `core/petri-server/mcp/registry.js:295-297` 动态 `path.join(R_SERVER/SHARED_BACKEND)` require 绕开静态依赖图，Knip/types 难覆盖。
- `frontend/src/components/workspace-panels/CenterPanel.tsx:199-207` 双层同名 `workspaceSessionLayout` 嵌套；CSS 容器几何历史上多次补丁堆叠，需遵守布局层“重构而非追加”、单一真源文件和四块几何量测。
- `docs/ck05-sqlite-evaluation.md:13` 自列 core 侧多处各自开库；`arch-cycles` 已有“已消亡环”提示，应按簇设存量环消亡里程碑。

**优化目标**：不新增依赖；native 版本精确锁定 + ABI 断言；pathResolver/connectionFactory/schemaVersion registry 单源；动态 require 收编；布局与 CSS 容器单一真源；存量环按簇逐批消亡，禁止新增环。

---

## §3 高杠杆发现台账

> 分级沿用评审纪律：P1=正确性/安全/契约破坏或生产路径回归；P2=可靠性/性能/可维护性实质影响；Minor=清理与风格。所有“⏳”项不假装已实证。

| ID | 级别 | 证据 | 现象 | 影响 | 修法 |
| --- | --- | --- | --- | --- | --- |
| F-01 | P1 | `loop-orchestrator.js:1009` + `llm-client.js:59-74` + `model-gateway.js:220,275` + `deepseek.js:336` | `errorsAsRejections` 生产链被丢弃 | 流中 RST 不重试，直接 fatal；测试只直连 provider | 网关链路透传或默认开启；补全链 SSE RST 集成测试 |
| F-02 | P1 | `loop-orchestrator.js:222,767-809` | 上下文预算一次性 latch | 首次修剪后不再计量/裁剪，UI 停更，长任务涨破窗口 | 每轮估算、每轮事件、trim 幂等；连续两轮增长负测 |
| F-03 | P1 | `feature-flags.js:28-31` + `conversation-compaction.js:176` + `chat.js:236,253-258` | compaction 视图/摘要/阈值三套语义 | 9 章节 resilience 摘要默认不可达，输出预算不预留 | `resolveCompactionMode()` 单源 + `maxOutput` 透传 + 4 组合矩阵 |
| F-04 | P1 | `workspace-tools.js:695-710` | 进程级 exec token 命中即跳过风险正则；签发者/可读性 ⏳ | 可能形成能力绕过，且不改变用户默认放行裁决 | per-call 注入、不下沉子进程 env、显式审计 + 契约测试 |
| F-05 | P1 | `file-dialog.js:430-455` + `_sender-guard.js:8-10` | 写 IPC 无 sender guard、root 由渲染层指定 | 非主窗 webContents 可能触发 workspace 覆写 | `ipcMain.handle` 包装器强制 guard；main 进程反查 project root |
| F-06 | P1 | `approval-request-store.js:35-70` + `run-plugin-script.js:466-479` | 审批决策未在 executor 侧重放/消耗 | 异步/旁路入口或参数改写后审批与执行脱钩 | 一次性 capability token + fingerprint/ctxSnapshot/expiresAt |
| F-07 | P1 | `mcp/registry.js:388-395` | 插件 installed root 绕开 plugin-loader 单源 | dev/pack 环境装了读不到、pack 工具不投影 | 改调 `resolveInstalledPluginsDir()` / `resolveDefaultPluginSources()` |
| F-08 | P1 | `mcp/registry.js:557-560` | MCP 工具名只认 `t.function.name` | 动态插件/Skill 无 executionMetadata 保守缺省 | 复用双形状取名 helper；listTools 全量元数据快照门禁 |
| F-09 | P1 | `viewerRegistry.ts:99-113,151-163` | kind/extension OR 匹配且 report/pdf/video 优先；preview=false 无原因 | 错 viewer、能力丢失、静默 binary 降级 | 扩展名优先、kind 兜底、降级 reason 上抛 Shell |
| F-10 | P1 | `ThemeProvider.tsx:122-139,265-267` | prefs 同步失败无 UI 消费 | 本端生效/他端旧值，用户以为已保存 | 统一 `prefsSync.failed` 内联告警 + 重试 |
| F-11 | P2 | `test:changed` 全量日志 | 6 红 / 7 取消 / 4 跳过，含基线漂移、脏树、pack 夹具 | 当前定向门不可信 | 逐类归因、基线单源、脏树证据隔离、外部 pack 显式降级 |
| F-12 | P2 | `quality:perf` 三次日志 | 34/32/36ms 对 32ms 阈值 FAIL/PASS/FAIL | 门禁持续可过性不足 | 绝对上限+相对容差双判据，连续 5 次 PASS，负测仍红 |
| F-13 | P2 | `modelConfigAndCollapse.test.tsx:40-41`、`workspace-tools.js:1636` | lint 2 errors、code-size 棘轮红 | closeout 当前不能全绿 | 删除不必要断言；按合法增长或清理重打体量基线 |
| F-14 | P2 | `conversation-compaction.js:38-44,116-132,178-211` | 压缩静默失败且重复全量摘要 | token 成本 O(n²)、失败不可观测 | `compaction_failed` 事件、增量摘要、输入长度有界测试 |
| F-15 | P2 | `message-trimmer.js:162,188-190,251,295` | 无 id 孤儿 tool、静默跳过、假摘要 note、死统计 | provider 400 与模型被误导 | 返回实际 dropped 集、仅摘要成功注入 note、统一 token 账本 |
| F-16 | P2 | `model-fallback-policy.js:19-34,46-49` + `agent-fallback.js:80-81,104-122` | 可降级判定先于不可降级；请求/任务候选两套 | 取消后误续跑 ⏳、A→B→C 连环 | 结构化错误码、不可降级优先、候选解析器单源、三个负测 |
| F-17 | P2 | `plugin-loader.js:114-120,441-449` | 脚本入口静默 files[0]、boolean 被映射 string | 可能跑错脚本、MCP schema 校验漂移 | 显式 entryScript/fail-closed；类型映射与 SOURCE_PRIORITY 派生 |
| F-18 | P2 | `CenterPanel.tsx:105-133`、`LeftPanel.tsx:556-665`、`ExternalImportPanel.tsx:138-160` | 隐藏层可 Tab、树无语义、表单无 label/live region | 键盘/读屏用户误操作、错误回执不可见 | `inert`、tree/treeitem+roving tabindex、label/fieldset/live region |
| F-19 | P2 | `src/migration-runner.js:39,56,66-77`、`main.js:838-843` | 迁移裸连接、无退出 closeAll、文件名排序无校验 | SQLITE_BUSY、WAL 残留、迁移错序 | pathResolver/connectionFactory、will-quit checkpoint、版本数值排序+重号 fail-fast |
| F-20 | P2 | `result-studio-contracts.js:302-317,376`、`delivery-manifest.js:56` | revision 为引用链、manifest sha 取自 provenance | 父版本元数据改动不留痕，导出不能自证全链 | prevChainHash/chainHash、产物字节重算、独立校验器 |
| F-21 | P2 | `test/ipc-channels-registry.test.mjs:20-41,81-87` | CONSUMERS 固定清单 + includes 单向守护 | 新通道/新模块漂移不红，注释可假绿 | 正则抽 preload 全量字面量做双向集合相等、glob 枚举 |
| F-22 | P2 | `docs/DOC-REGISTRY.json:12-14`、`docs/status` | 采样时 coverage 429/163 vs 实际 488/471；本轮已同步为 490/473 | 机器台账计数漂移已手工修正，但防回潮机制仍缺 | 由 docs:status 生成 coverage，README 近期条目同步，加入计数一致性负测 |
| F-23 | Minor | `loop-orchestrator.js:173-1673`、`circuit-breaker.js`、`system-prompt.js:67-104,257-261` | 巨型函数、死熔断、legacy 文案与恒 null 桩 | 读者概念数上升、第二重试真相 | 行为基线后拆分、删死代码、错误文案单源 |
| F-24 | Minor | `docs/AUDIT-LOG.md:73-78`、roadmap 顶部 | 旧 P1 条目未逐件核销 | 旧账可能误导下一包 | 按 BLOCK-346 结论逐行 ✅ / retain-with-reason |

---

## §4 当前红项归因与证据边界

### 4.1 代码与门禁真红

- `quality:lint` 2 errors：已定位到 UI-695 测试断言，属可立即修复的质量真红。
- `gate:code-size` 体量/指纹红：`workspace-tools.js` 当前 1636 行，需判断是合法增长后重打，还是先做 scoped 重构；不得临时放宽。
- `quality:perf` 间歇红：门判据设计问题，不改产品性能结论；必须双判据加固并保留负测。
- 定向测试工具数 114→115、systemPrompt 993→1083、领域词 `deseq2`：均属基线/契约漂移或需裁决项，不能为过门擅自放宽棘轮。

### 4.2 脏树与环境导致的红

- `p6_current_source_tree_not_exact`：当前 22 M + 10 ?? 属预期证据绑定红，不能重打 P6 证据掩盖。
- `p4r-invariants` deseq2 demo 夹具失败并取消 7 个子测试：外部 pack/示例数据依赖，按环境类如实登记。
- `c48-full-rebuild exit=1`：CodeBuddy safe-delete 守卫阻止批量删除 `dist/mac-arm64`，属工具链环境中断。
- 全量测试 `exit=143/SIGTERM`：被运行器空闲超时终止，结论是“未完成/未知”，不是全绿，也不直接定性为产品挂起。
- `config:doctor` 9 个 ENOENT：可选配置文件尚未创建，默认生效值清晰、env 无遮蔽，不列缺陷。

### 4.3 外部与人工边界

- C-46 属兄弟仓，需用户授权；本仓不伪造修复。
- C-47 观察未复现，根因未归因，保持 open。
- O-1 屏幕观感/点击体感需要人工实机确认；DOM、进程、REST 证据不能代答。
- 8 任务的 `toolSelectJudge` / `artifactJudge` / `humanEyePending` 仍需人工判据落盘。
- G0 开发期常态，不外推 packaged/Provider/GA。

### 4.4 定向测试失败分类

| 类 | 用例 | 处置 |
| --- | --- | --- |
| 基线漂移 | tool count 114 vs 115（3 个测试）、systemPrompt 993 vs 1083 | 单源工具计数 + 由 WIP 所有者显式重打 model-surface 基线并说明 |
| 存量棘轮 | `FederationJobs.tsx::deseq2` 领域中性 | 用户裁决改文案或按工具重扫，不擅自放宽 |
| 脏树证据绑定 | P6 source tree not exact | 隔离 WIP 后复跑，不重打证据 |
| 外部环境 | p4r-invariants deseq2 夹具 | 兄弟仓/夹具就位后复跑，或诚实 skip 并打印原因 |
| 质量真红 | lint 2 errors、code-size FAIL、perf 设计抖动 | 进入蓝图 Wave 0 |
| 未完成 | full workspace SIGTERM | 分片、有界、可复跑策略，不宣称通过 |

---

## §5 产品个性与优化红线

1. **通用 agent 主线不收缩**：编排/知识/工具/模型计量/可靠性五维仍是核心；3D、SVG、生信等场景能力是放大器，不把产品缩成垂直工具。
2. **本地主权**：不把推理循环、工具、记忆、编排搬到云端；新增可观测性优先落本地事件/SQLite/证据包。
3. **可信与透明即能力**：审批、规则、ack、血缘、原因码、失败可见性是差异化卖点，不是合规负担。
4. **证据自证**：每项优化必须有行为测试 + 可复跑命令 + 当前证据；机械绿、DOM 几何绿、人眼验收、真实任务成功四类证据不得互相冒充。
5. **零第二真相**：不新建第二 executor/Job/Artifact/Workflow/项目状态/UI truth；优先抽单源纯函数与注册包装器。
6. **用户裁决不回退**：exec 默认放行保持；本蓝图只补风险提示、审计、严格开关可发现性、per-call token 与其余执行边界。
7. **不新增依赖**：所有优化默认复用 React 18、Vite、better-sqlite3、现有 MCP SDK、dev-verify 与机械门禁；新增依赖必须另走治理检查单和用户裁决。
8. **单工作包串行**：蓝图中的每个 Wave 是候选工作包，需用户逐波发令；本轮只产出 `planned` 蓝图，不启动实现。
9. **保护 WIP**：Wave 0 只建立 HEAD↔WIP 清单，由 WIP 所有者决定提交或回退；Agent 不覆盖、不暂存、不删除。
10. **G0 边界**：不外推 packaged/Provider/GA，不把发布资格相关事项写成待办。

---

## §6 复跑命令

```bash
npm run state
npm run docs:status && npm run docs:check
npm run ui:audit:check
npm run hygiene:check
npm run quality:secret
npm run quality:arch
npm run quality:surface
npm run quality:ear
npm run gate:code-size
npm run gate:arch-cycles
npm run gate:css-modules
npm run quality:lint
npm run quality:types
npm run quality:knip:check
npm run quality:perf
npm run skills:check
npm run config:doctor
cd frontend && npx vitest run src/styles/theme-token-contract.test.ts
node scripts/test-affected.mjs --report /tmp/petri-eval-test-plan.json
npm run test:changed
```

> `npm run closeout` 本轮未跑：当前工作区含他人 WIP，且 closeout 首步 `audit:compact` 会改写 AUDIT-LOG/归档；评估批不应扰动在制状态。蓝图中 Wave 0 收口时再在干净树上运行完整 closeout。

---

*本报告的结论仅覆盖当前 HEAD + 明确列出的 WIP 范围。后续任何产品代码、基线或证据变化都必须重新执行 §6 中受影响的命令，不复用本轮 PASS。*
