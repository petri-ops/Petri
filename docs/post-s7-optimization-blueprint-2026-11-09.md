---
capability: post-s7-optimization-blueprint-2026-11-09
status: active
goal: 以 2026-11-09 当前 HEAD、当次机械门禁、四路只读源码实证与既有验收证据为唯一事实基线，对十一维度做全量评估，并把剩余缺口转成不设工作量上限、但设证据上限的分阶段优化计划；核心目标是优化项目、增强使用体验。
acceptance:
  - 十一维度均有当前源码锚点、复核评分、剩余缺口与优化目标
  - 逐条改进点可追溯到本次当次门禁读数或只读源码实证，不编造证据
  - 每个阶段有目标、具体改进点、优先级、依赖、blocker 分类与出口判据
  - 本文件是多包程序文档（kind=living-plan），不占单包串行槽位；各 H 阶段各自注册 work-package 占槽
  - 未取数的门禁与未闭合的证据如实标注，不写成通过
reopen: 源码、基线、门禁读数、工作区状态或 active 工作包变化后，先重跑 §1.2 门禁与受影响维度复核，再执行对应阶段
---

# S7 之后全量评估与下一阶段优化蓝图（2026-11-09）

> 用户裁决依据：「全面评估项目的各个方面，我需要了解每一个细节，并据此建立一份蓝图，作为下一阶段的工作计划。不要设定工作量上限，核心目标就是优化项目、增强使用体验。」
> **定位**：本文件是第三轮方向蓝图，承接 [`next-stage-optimization-blueprint-2026-11-06.md`](./next-stage-optimization-blueprint-2026-11-06.md)（W0–W7，已由 NSO 全程序 BLOCK-359～374 收尾，status=completed）与 [`post-nso-optimization-blueprint-2026-11-06.md`](./post-nso-optimization-blueprint-2026-11-06.md)（S0–S7，已由 BLOCK-375～382 及 BLOCK-383 实机腿批执行收尾）。**不重复旧发现、不改写旧评分、不新建第二份当前状态真相**；只登记「到 2026-11-09 为止仍未闭合」的事实与下一阶段候选工作包。
> **形态**：`active` 程序文档（`kind=living-plan`，多包并列于一个程序之下，不占单包串行槽位）。每个 H 阶段各自是一个正式 work-package，按单工作包串行纪律逐阶段发令与收口；正式 BLOCK 编号在发令时按 `$petri-project-governance` 分配（2026-11-09 起 H0→BLOCK-385，其后 H1–H7 依次 386–392）。
> **阶段纪律**：G0 开发期常态 · 不外推 packaged/Provider/GA。

---

## §0 执行摘要

### 0.1 一句话结论

Petri 已完成「能力面机械自洽 → 核心链路静默失败收敛 → 证据链大规模闭合」三段跃迁，当次 15 门静态/性能门禁逐门取样全绿；**下一阶段的瓶颈已从「有没有实现」转为「兑现度、可感知体验与结构债务」**：执行准入仍停在 observe、四类失败事件前端零消费、消息/会话/结果库仍全量 DOM、五个巨型文件靠例外续期、真实任务成功证据因环境因仍为 0/8、AUDIT-LOG 与 backlog 存在账本滞后。主线不是继续加能力，而是**把已交付的机制对到真实生产路径、把用户能感知的失败态与长列表体验补完、把结构债按可验证切片逐刀清掉**。

### 0.2 本轮新增结论（相对 S7 / BLOCK-383）

1. **当次静态面全绿且可复跑**：`docs:check` 515 注册、`ui:audit:check` 632 UI 编号、`quality:surface` P1=0/P2=0/P3=2、`gate:code-size` 24 文件 23476 行、`quality:knip:check` 330 键冻结、`quality:lint` 0 error / 2312 warning、`quality:types` 0 error、`quality:arch` R1–R5 无违规、`gate:arch-cycles` 13 存量环在册无新环、`skills:check` 11+3。S7 时的两红门（code-size / knip）已持续保持归零，不是本轮抬基线换来的。
2. **`quality:perf` 当次连续 5×5 全绿**：cold_start 554ms / long_conversation 22ms / big_project_tree 13ms / packaged_start 489ms，四场景均在「相对容差 + 绝对噪声地板」双判据内；BLOCK-383 的 5×5 结论在本次会话独立复现（负测契约 `test/block350-perf-gate.test.mjs` 10 项在册）。但**冷启动五段分解与 DOM/帧率判据仍未进 closeout**。
3. **证据资产化读数下降但门未红**：`quality:ear` 当次 881/2117 = **41.6%**（阈值 40% PASS；manifest 冻结 43.3%），较 S7 的 42.7% 下降，原因是 acceptance 分母从约 2060 增至 2117（BLOCK-383 一批 76 件证据入册），不是证据丢失；**45% 蓝图目标仍未达**，不得写成达标。
4. **当前唯一 active 工作包 = `BLOCK-384`（兄弟仓清偿批，2026-11-09 用户授权）**：其 plan、`DOC-REGISTRY.json` 条目与 `README.md` 入口均为**未提交在制**（`?? docs/block-384-sibling-pack-clearance-plan.md`、`M docs/DOC-REGISTRY.json`、`M docs/README.md`）。同时 `npm run state` 报「串行槽位空闲」，与 registry 的 `status: active` 存在**口径差异**，属 H0 对账项；本蓝图全程零触碰其文件面。
5. **真实任务成功证据仍为空**：BLOCK-383 `acceptance/post-nso-2026-11-08/task-suite-round1.json` 8 任务 0/8，逐条为 ECONNRESET×6 / api key invalid / 出网 ETIMEDOUT / HTTP 550 环境因；`humanEyePending` 8 仍待人眼。机械判据、UI 实机腿与真实任务成功是三类不同证据，不得互相冒充。
6. **执行准入是「内核已就绪、闭环未落地」**：`core/shared-backend/execution-admission.js:42-114` 的 issue/verify/consume 完整，但 `verifyAndConsumeExecutionToken` 全仓仅被 `test/nso-s2-execution-admission.test.mjs` 调用；`agent-tool-interceptor.js:389-400` 缺省 `enforcement=observe`，三执行入口无生产消费点。这是当前最大的「已实现 ≠ 已生效」缺口。
7. **UI 实机腿已闭合但体验债未闭合**：BLOCK-383 flow 8/8（UI-700/701 → verified），但 `ToastProvider.tsx:35,64-70` 的 4 秒提示无回看区、`SimpleChat.tsx:1536` / `LeftPanel.tsx:443,654,662` / `ResultsLibrary.tsx:58-94` 仍全量 DOM、`LeftPanel.tsx:442,559` 树无 roving tabindex、`role="slider"` 全仓零命中、`CenterPanel.tsx:203-209` 双层同名 layout 仍在。
8. **账本与台账存在可机械修复的滞后**：AUDIT-LOG 83KB > 50KB 建议阈且 L88 单条 10031B；README 最新两行（380/379）未用反引号，不匹配 `scripts/docs-roll-index.mjs:22` 的 `ENTRY_RE`；`post-nso-optimization-blueprint` registry 仍 `planned` 但正文 S0–S7 已收尾；backlog 中 BLOCK-349～354 仍写 planned 而 README 已 completed；`test/impact-map.json` 存在重复 id `block337-governance-runtime`。

### 0.3 评分口径与本次复核

沿用全量评估 §0.3 的**证据锚定评分**（5 = 当前证据下可长期托重，1 = 核心链路不可信；无证据扣分而不是给分）。前三列沿用既有 canonical，第四列是本轮四路只读源码实证 + 当次门禁读数的独立估值，**并列呈现、差异逐条归因，不回溯修改历史分数**。

| 维度 | 评估时 | NSO 后 | S7 复核 | 本次复核 | 目标 | 本次归因 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 功能完整性 | 4.2 | 4.3 | 4.4 | 4.4 | 4.7 | 平；功能面 P1/P2=0，8 任务套件仍 0/8（环境因），无新增成功证据 |
| 性能表现 | 3.5 | 3.8 | 3.8 | **3.9** | 4.5 | +0.1；perf 连续 5×5 当次独立复现全绿；DOM/五段分解未入门禁 |
| 代码质量 | 3.3 | 3.6 | 3.7 | **3.8** | 4.5 | +0.1；15 门逐门全绿、lint 0 error、knip 330 冻结；2312 warnings 与 16 例外仍在 |
| 可维护性 | 3.2 | 3.5 | 3.6 | 3.6 | 4.4 | 平；实例化单源已交付，但 `loop-orchestrator.js` 1579 行、三处装配点、多份版本常量仍在 |
| 可扩展性 | 4.2 | 4.5 | 4.5 | 4.5 | 4.8 | 平；16 域 facade / MCP 单入口在位，插件源装配仍三处 |
| 安全性 | 3.4 | 4.0 | 4.2 | 4.2 | 4.6 | 平；全局 sender 门与链哈希已闭合，ADMISSION 仍 observe、FK 分裂未裁决 |
| 用户界面与交互体验 | 3.7 | 3.7 | 3.8 | **3.9** | 4.6 | +0.1；BLOCK-383 UI 腿 8/8、UI-700/701 verified；32 条证据债、DOM 预算、布局单源、slider 语义仍在 |
| 错误处理与边界情况 | 3.1 | 3.5 | 3.7 | 3.7 | 4.6 | 平；SSE 三态闭合，但四事件前端零消费、reason-code 仅约 25 码、3 处 `onEvent:()=>{}` 与空 catch 仍在 |
| 测试覆盖 | 3.7 | 4.1 | 4.2 | 4.2 | 4.7 | 平；658 Node + 359 前端测试、分片归因体系在位；145 未映射、38 残红、人眼 8 项 pending |
| 文档完善度 | 4.3 | 4.5 | 4.6 | 4.6 | 4.8 | 平；docs:check PASS 515、coverage 单写入器；账本超阈、入口行格式、backlog 滞后仍在 |
| 依赖与架构合理性 | 3.7 | 3.9 | 4.0 | 4.0 | 4.6 | 平；R1–R5 PASS、13 环受控；三套依赖树、版本漂移、13 环未消亡 |

**综合**：三升八平零降，全部差值可归因到具体提交或当次读数；**没有任何一维靠文档宣称得分**。距「每维 ≥4.4」的蓝图出口仍有 7 个维度未达，主要卡在结构债与真实任务证据，不是卡在功能数量。

---

## §1 事实基线与证据边界

### 1.1 三轴口径

| 轴 | 事实 |
| --- | --- |
| 已交付基线 | `main` HEAD `23db1f15`（BLOCK-383 实机腿批收口），含 post-NSO S0–S7 全部交付与 11-08 实机腿批 |
| 在制候选（零触碰） | 已跟踪 3 项：`docs/DOC-REGISTRY.json`、`docs/README.md`、`docs/block-370-nso-w3b-plan.md`（并发写入者 / BLOCK-384）；未跟踪 10 项：`docs/block-384-sibling-pack-clearance-plan.md`、`assets/`、`petri-logo-concepts*`、`model3d/enclosure-*.scene3d.json`、`scripts/backfill-artifact-chain.mjs`、`tmp-block342-live/`、`tmp-review/`、`docs/pelican-bicycle.html`、`acceptance/nso-2026-11-06/wave-0/full-test-shards/summary-1793978091259.json` |
| 当前 active | `BLOCK-384`（兄弟仓 C-46①/C-49 清偿），其登记与 plan 均未提交；`npm run state` 的「串行槽位空闲」指向 `g0-current-work-package` truthDomain 空缺，两者口径需 H0 对账 |
| 本轮动作 | 只读核查、四路子代理源码实证、当次门禁逐门取样、形成评估与 planned 蓝图；**未改任何产品代码、未提交、未暂存、未清理 WIP** |
| 证据等级 | 当次命令输出 > Git/源码 > acceptance JSON > canonical 文档；历史「全绿」不自动复用 |

> 取样副作用已复原：`quality:surface` 会刷新两份 generated 产物的 `generatedAt`，本轮已把 `acceptance/functional-audit-2026-11-04/surface-matrix.json` 与 `docs/functional-surface-matrix-2026-11-04.md` 逐字复原为会话起始值，避免把无关时间戳带进并发写入者的提交。

### 1.2 当次机械门禁真值（2026-11-09，逐门串行取样）

| 门禁 | 结果 | 读数 |
| --- | --- | --- |
| `docs:check` | PASS | 515 registered；AUDIT-LOG 83KB > 50KB 建议级、L88 10031B 超长行 |
| `ui:audit:check` | PASS | Git 历史 632 个带实现证据 UI 编号 |
| `hygiene:check` | PASS | 无死链 / CRLF / 控制字节 / 桥退化；untracked 仅列出 |
| `quality:secret` | PASS | 生产面 0，fixture 豁免在册 |
| `quality:arch` | PASS | R1–R5 无违规，cruise 全新 |
| `quality:surface` | PASS | tools 115/115、ipc 168、routes 285、storageKeys 20、P1=0 / P2=0 / P3=2 / dirty=0 |
| `quality:ear` | PASS | 881/2117 = 41.6%（阈值 40%；manifest 43.3%；45% 目标未达） |
| `gate:code-size` | PASS | 24 文件 23476 行 = 基线 23476；生效例外 16；预算 700 行 |
| `quality:knip:check` | PASS | 保留面 330 键冻结，无新增 |
| `gate:arch-cycles` | PASS | 13 存量环在册，无新环 |
| `gate:css-modules` | PASS（WARN×2） | plain CSS 11 个全在白名单 13 内；`LoginModal.css` / `PageHeader.css` 已移除可收缩 |
| `quality:lint` | PASS | 0 errors / 2312 warnings（抑制基线内） |
| `quality:types` | PASS | `tsc --noEmit` 0 errors |
| `quality:perf` | PASS | 连续 5 次采样全绿；554 / 22 / 13 / 489 ms |
| `skills:check` | PASS | 11 内置 + 3 领域包 |
| `test:changed` / `closeout` | **未取数** | 工作区含并发在制文件，按定向纪律本轮不跑聚合门；**不得表述为通过或全绿** |

> 本表是**逐门取样**，不是 `npm run closeout` 聚合结果；`closeout` 固定 5 门 + 11 个 `--gate` = 16 阻塞门（另有 `skills:check` 作第 17 项 `--report` 非阻塞门），其中只有 `gate:arch-cycles` / `quality:arch` / `quality:knip:check` 带域跳过语义，且 SKIP 不算 PASS。
> `test:all:sharded` 当前最近归因仍为 `acceptance/post-nso-2026-11-06/stage-0/shard-attribution.json`：run0 387 fail → final 38（349 根修），残红 16 C-46 + 1 P6 + 1 S1 专项 + 20 环境档；S7 §3.3 与该文件口径差异（18 条明细 vs 38 拆账）按「0 未归因 fail」降级解释，不写成 0 fail。

### 1.3 既有评估链与不重复原则

- 事实基线链：[`Petri-Desktop-Holistic-Evaluation-2026-11-06.md`](./Petri-Desktop-Holistic-Evaluation-2026-11-06.md)（十一维全量评估 + 24 条发现台账）→ [`next-stage-optimization-blueprint-2026-11-06.md`](./next-stage-optimization-blueprint-2026-11-06.md)（W0–W7）→ [`post-nso-optimization-blueprint-2026-11-06.md`](./post-nso-optimization-blueprint-2026-11-06.md)（S0–S7，26 条 G-xx 缺口）→ [`block-382-post-nso-s7-final-report.md`](./block-382-post-nso-s7-final-report.md)（十一维复评 + 待人工 11 项）→ 本文（H0–H7）。
- 已由 NSO / post-NSO / BLOCK-383 闭合的项（errorsAsRejections 全链、增量摘要、SSE task.failed、FK OFF 三面一致、链哈希 UPDATE、file: 注册制、字号宪章、prefs 重放、空 flags、inert、能力位、UI-697～701 实机腿、perf 连续判据、coverage 单写入器、C-45 压缩配对）**不再列为改进点**；本蓝图只登记 HEAD 上仍可复核到的缺口。
- AUDIT-LOG 中已由用户裁决的延期/资格类 🟡 项按既有裁决态保留，不属于本蓝图工作面，不重复登记、不推动状态变化。

### 1.4 证据等级与不可外推边界

五类证据不得互相冒充：①行为/契约测试；②机械门禁；③DOM 与 CDP 实机；④人眼观感；⑤真实任务成功。本蓝图所有 `verified` 级表述必须有对应类别的当前证据；`quality:surface` 的「矩阵可达」不等于「任务成功」；`quality:perf` 的毫秒读数不等于用户观感；`closeout` 绿不等于 UI 在场（黑屏先例见 dev-infra §9 三面齐判定）。

---

## §2 十一维度详尽分析

> 每维按「已兑现证据 → 当前缺口（带 `file:line`）→ 优化目标」三段展开；锚点来自本轮四路只读源码实证（2026-11-09，HEAD `23db1f15`），未确认项显式标注。

### 2.1 功能完整性 — 4.4 / 5

**已兑现**：`core/petri-server/agent-tools/tool-defs.js:13-49` 16 域 facade 汇编工具 schema；`core/petri-server/mcp/registry.js:532,825,949-952` 与 `src/mcp-server.js:27,35` 的 `listTools()` / `callTool()` 单入口；`src/ipc/channels.js:3-8` 168 通道集中注册 + `test/ipc-channels-registry.test.mjs` 双向集合相等门；`scripts/functional-surface-audit.mjs:354-366` 机械计数 285 路由 / 47 模块 / 0 未挂载；`docs/capability-map.md` 由矩阵确定性生成并带 G0 越界宣称守卫；BLOCK-345 computer-use 三断链、BLOCK-346 功能面 P1/P2 清零均已收口。

**当前缺口**：
- `acceptance/functional-audit-2026-11-04/surface-matrix.json:11,26-36` — `ipcUnusedInRenderer=165`（含 `agent:task-done`）只登记不判红；`petri_token`、`petri.simplechat.extraRenderers` 两个 storage key 只读不写（P3×2）。「定义先于用户入口」的沉积仍在。
- `scripts/functional-surface-audit.mjs:420-424,547` — 零消费端点检测是「业务段子串命中前端语料」的宽松启发式；路由正则只数 `app.(get|post|put|patch|delete)`，无 `router.*` / 动态挂载兜底扫描。
- `src/preload.js:87-99` 与 `src/ipc/channels.js:258-260` — 2 个通道（`computer-use:pip-frame/pip-status`）无 preload 包装（PiP 独立 preload，属可解释例外但无机械豁免留痕）。
- `acceptance/post-nso-2026-11-08/task-suite-round1.json:512-533` — 8 任务 0/8、`humanEyePending` 8 条；「结构化可达」与「用户任务成功」之间的证据链仍空。

**优化目标**：P3 逐件销号或 `retain-with-reason`；表面矩阵增加动态挂载与消费方检测可信度负测；把 8 任务套件变成「连续 3 次 8/8 + 人眼判据落盘 + T7 无 windowOverride」的连续证据；新增能力必须先有用户入口、审批、错误态与回归证据。

### 2.2 性能表现 — 3.9 / 5

**已兑现**：`scripts/block350-perf-gate.mjs:25-49,58-88` 双判据 + 连续 5 次采样 + 最差轮口径；`test/perf-baseline.json:10-75` 四场景中位 546/20/12/429ms 与绝对噪声地板；`test/block350-perf-gate.test.mjs:16-108` 10 项负测（植入慢样本必红）；`core/petri-server/loop-orchestrator.js:222-225,749,780` 上下文预算每轮化 + 每轮成本熔断 + 每轮 trim；`frontend/src/pages/project-workspace.module.css:1045-1048,1256-1260` 会话/结果库行 `content-visibility`；teardown 进程组回归已交付。

**当前缺口**：
- `frontend/src/components/copilot/SimpleChat.tsx:1536` `displayMessages.map` 全量渲染；`workspace-panels/LeftPanel.tsx:443,654,662`、`ResultsLibrary.tsx:58-94` 同型；**消息列表未覆盖 `content-visibility`，无统一视口窗口化与 DOM 节点上限**。
- `package.json:177` closeout 链只有 `quality:perf`（毫秒阈值）；DOM 节点断言仅在 `scripts/block95-a2-frame-live.cjs:84`（<20000，独立脚本非门），冷启动五段分解仅在 `scripts/block101-startup-timeline-live.cjs:5`（四段口径），均不入链。
- `acceptance/post-nso-2026-11-08/block383-live-legs-live-darwin.json:37-41` — UI-699-1 结果库行 cv 实机腿仍 `pending: no rows with real data`；perf 5×5 的机器可读日志在 acceptance 目录未确认（结论见 AUDIT-LOG 与 plan 叙述）。
- 请求体五类占比（工具定义 / 系统提示 / 消息 / 工具结果 / 输出预留）无同源可核对读数。

**优化目标**：四场景连续 5 次 PASS 常态可复跑；冷启动五段（require / 迁移 / 后端 health / SPA 200 / CDP 页面）与 DOM/帧率判据入门禁；长会话节点数有实测上限；真实数据腿补上 cv 读数。

### 2.3 代码质量 — 3.8 / 5

**已兑现**：当次 `quality:types` 0、`quality:lint` 0 error、`quality:secret` 生产面 0、`quality:arch` R1–R5 PASS、`gate:code-size` PASS、`quality:knip:check` 330 键冻结；`frontend/src/styles/theme-token-contract.test.ts` 17 个 `it()` 全绿；数值 `fontSize:` 仅剩 XTerm API 两处豁免（`pages/window/TerminalWindowPage.tsx:76`、`hooks/useTerminalTabs.ts:154`）；负测文化成熟（perf / chain-hash / ipc-trust / EAR / 表面矩阵检测可信度）。

**当前缺口**：
- `quality:lint` 仍有 **2312 warnings**（抑制基线内），其中 `security/detect-object-injection` 在测试与生产面广泛存在；基线只许收缩不许放宽，尚未设分域消亡里程碑。
- `acceptance/block-92/size-baseline.json:22,43,57,134` — `SimpleChat.tsx` 2079 行（例外授予时 1653）、`project-workspace.tsx` 1221、`ReviewMode.tsx` 1429、`workspace-tools.js` 1583；`scripts/code-size-ledger.mjs:41,107-118` 的 16 条生效例外中 15 条 `expires=2026-12-31`，靠到期续期维持。
- `core/petri-server/loop-orchestrator.js:1579`（70.3KB）**既不在 24 项 MANIFEST，也不在 17 条白名单**，是尺寸门的最大盲区；`test/loop-orchestrator-subdomains.test.mjs:131,134` 行数锚仍写 1572，落后现值 7 行。
- 颜色字面量仍在 `ContextBudgetBar.tsx:38-54,66,113,188,249`、`OrchestrationGraph.tsx:22-26`、`ChatArtifactCard.tsx:43,149,186,239`、`PluginStorePanel.tsx:244,252,346`。
- `gate:css-modules` 白名单 13 项 vs 实际 11 项，消失项只 WARN 不红。

**优化目标**：红门保持归零且不靠抬基线；巨型文件有真实拆分路线与行数只减锚；`loop-orchestrator.js` 纳管；颜色字面量按主题 token 阶梯收敛；warnings 按域设只减棘轮。

### 2.4 可维护性 — 3.6 / 5

**已兑现**：`core/shared-backend/db-connection-policy.js:31-37,101-109` 的 `resolveDbPath` + `openDatabase` 已收编三处连接（BLOCK-379）；`src/main.js:854-856` will-quit closeAll + WAL checkpoint；`scripts/docs-governance.mjs:241-256,880-899` coverage 单写入器与 `COVERAGE_COUNT_DRIFT` 门；`helpers/reason-codes.js` 封闭词表；BLOCK-366 第二真相清理（ERROR_I18N 死码 / 恒 null 桩 / 重试分类单源 / token 账本死口径）。

**当前缺口**：
- `core/petri-server/loop-orchestrator.js` 1579 行单文件；`test/loop-orchestrator-subdomains.test.mjs:126-157` 仍用 `readFileSync(...).split('\n').length` 行数锚、`test/release-contract.test.mjs:97,109` / `test/block199-config-drift.test.mjs:182` / `test/nso-w5b-second-truth.test.mjs:46-72` 仍用 `src.includes(...)` 保护实现细节而非行为。
- `src/database/branch-db.js:34-40` 的 `getDatabasePath()` 自行 `path.join(dataDir,'petri.db')`，不认 `PETRI_DB_PATH`；`src/migration-runner.js:36-49` 的 `requireDbConnectionPolicy()` 双候选与 `src/database/_db-singleton.js:46-49` 的 `resolveCore` 是两套路径解析入口。
- 版本常量多源：`core/petri-server/helpers/artifact-truth.js:5`、`core/shared-backend/result-studio-contracts.js:33`、`core/shared-backend/delivery-manifest.js:9` 三份各自 `=1`；`scientific-replay-package.js:721`、`artifact-truth.js:431`、`helpers/tools-executor.js:1271`、`plugin-loader.js:373`、`mcp/registry/run-plugin-script.js:689` 硬编码 `artifactSchemaVersion: 1`；`agent-tools/registry.js:134` / `agent-tools/plugin-loader.js:22` / `agent-tools/tool-execution.js:9` 各自定义 `CONTRACT_VERSION='1.0.0'`；前端 `lib/artifact-selection.ts:95,198,239,489` 硬编码 `contractVersion: 1`。
- `core/petri-server/mcp/registry.js:357-384`、`core/petri-server/server.js:109-120`、`plugin-loader.js:749-769` 三处插件源装配；`agent-tools/tool-metadata.js` 的 `TOOL_METADATA` 与 `agent-tools/registry.js:306` 的 `CONTRACTS` 双表需跨表一致性锚。
- `docs/AUDIT-LOG.md` 83KB（>50KB 建议阈）且 L88 单条 10031B；`docs/README.md:1-2` 最新两行无反引号，不匹配 `scripts/docs-roll-index.mjs:22` 的 `ENTRY_RE`。

**优化目标**：主链按职责拆为可单测单元（拆前拆后同套绿）；实例化/版本/插件源/工具元数据四处单源；源码扫描契约逐步换成事件、状态机、错误码断言；账本只留活跃广播。

### 2.5 可扩展性 — 4.5 / 5

**已兑现**：16 域 facade、MCP `listTools`/`callTool` 单入口、168 通道集中注册表、Manifest v1 插件契约、`mcp/registry.js:354-384` 插件源委托 `plugin-loader.js:738-759`、`registry.js:546,552` 工具名双形状、source enum 由 `SOURCE_PRIORITY` 派生、`plugin-loader.js:127-147,462-495` entryScript 确定性与 boolean/file/directory 显式映射、`mcp/registry-health.js` degraded 逐工具透传、`skills:check` 11+3 契约齐。

**当前缺口**：
- `knip.json:38` 把 `core/**/*.js` 全设 entry，动态点（`agent-tools/plugin-loader.js:152`、`learning.js:617`、`mcp/registry.js:305-335`）无法判死导出 → 330 键保留面是上界不是精确债。
- `scripts/block357-capability-map.mjs:20`、`scripts/block352-shelf-audit.mjs:29-30`、`scripts/functional-surface-audit.mjs` 三份矩阵各自生成，无同源生成器与「人工改动判红」联动。
- `acceptance/block-118/corpus-doc-suggest.json:2284` 仍列已删的 `helpers/circuit-breaker.js`（语料化石）。
- 插件源装配三处（见 2.4）；`test/impact-map.json` 存在重复 id `block337-governance-runtime`（L6 与 L7128），规则数 357 的口径需脚本复核。

**优化目标**：动态入口显式注册；三矩阵同一生成器重建；影响图去重与规则口径机械可复算；任何新货架/工具仍走既有单入口与审批元数据。

### 2.6 安全性 — 4.2 / 5

**已兑现**：`src/ipc/_ipc-trust.js:104-143` 一次性全局 `ipcMain.handle/on` 信任补丁；`_ipc-trust.js:25-30,43-49,83-90` `file:` sender 显式注册制（PiP 在 `src/main/computer-use-pip.js:75-79` 登记）；`src/ipc/_workspace-roots.js:26-44` + `file-dialog.js:21,53-55,389-393,443-448` 主进程 realpath 反查登记根 + 写通道双 guard；`agent-tool-interceptor.js:380-385` capabilityEvidence 唯一签发点与 `mcp/` 全树零出现（两轴分离）；`result-studio-repository.js:71-89,188-205,924-928` + `scripts/verify-artifact-chain.mjs:29-75` 链哈希 UPDATE 覆盖与独立复算；`delivery-manifest.js:135,156-172` manifest 双哈希 + `prevManifestHash`；`helpers/message-trimmer.js:69-97,160-174` tool 消息原子性与孤儿丢弃负测；`workspace-tools/internals.js:44-81` per-call 令牌与默认放行裁决保持。

**当前缺口**：
- **P0**：`core/shared-backend/execution-admission.js:42-114` 内核齐备，但 `verifyAndConsumeExecutionToken` 全仓仅被 `test/nso-s2-execution-admission.test.mjs:11-62` 调用；`agent-tool-interceptor.js:389-400` 缺省 `observe`，`PETRI_EXEC_ADMISSION==='1'` 是全仓唯一读取点，`:401` 签发失败静默 catch；`helpers/tools-executor.js`、`mcp/registry/run-plugin-script.js`、`helpers/remote-execution/ssh-direct-runner.js` 三执行入口无生产消费点。
- **P0（待裁决）**：`core/petri-server/db/connection.js:24-25` `foreign_keys=OFF` vs `src/database/_db-singleton.js:86-90` `ON`；`db-connection-policy.js:14-16` 刻意不把 FK 纳入 canonical pragma 并记「179 fail 已回退 / 独立大包清偿」。
- `delivery-manifest.js:159-165` 上一份 manifest 损坏时空 catch 令 `prev=null`「链在本书新起」，断链静默；`scripts/verify-artifact-chain.mjs:74-75` 的 `legacy_unhashed` 默认「登记不判红」，仅 `--strict` 失败。
- `src/plugin/zip.js:14-18` 解压仅 `extractZip(zipPath,{dir})` 一行，未见 entry 名穿越 / 总字节 / 文件数校验；全仓未见针对不可信工具结果的 prompt injection 隔离防线（**未确认**：只读检索未覆盖所有输入面）。
- `_ipc-trust.js` 仍保留 `PETRI_IPC_FILE_SENDER_EXEMPT_IDS` env 豁免口；`helpers/approval-request-store.js:35-41` once/task 审批是任务内内存 Map，不跨进程。

**优化目标**：策略判定与真正执行焊成一条可审计闭环（三入口出示并消耗一次性凭据）；FK 真相由用户裁决后统一；产物链默认 strict 且断链不静默新起；解压与输入面补 fail-closed 负测。

### 2.7 用户界面与交互体验 — 3.9 / 5

**已兑现**：BLOCK-383 `acceptance/post-nso-2026-11-08/block383-live-legs-live-darwin.json:6-48` 8/8 allPass（重放横幅实机文案「HTTP 503（30 秒后自动重试，第 1/3 次）」、空 flags 段、折叠 inert、孤儿 px 零命中、树语义）；UI-700/701 → verified；`themes/ThemeProvider.tsx:301-308,121-125` prefs 失败固定 `role="status"` + 30s×3 有界重放；`settings/ExperimentalFeaturesSection.tsx:180-196,234-236` 空 flags 与拉取失败原因+重试；`workspace-panels/CenterPanel.tsx:107-111` / `LeftPanel.tsx:167-170` inert 双写；`LeftPanel.tsx:442,559` tree/treeitem + aria-expanded；`settings/ExternalImportPanel.tsx:139-140,142,156,235` fieldset/legend/label/live region；`viewerRegistry.ts:117,155` 降级 reasonCode。

**当前缺口**：
- `components/common/ToastProvider.tsx:35,64-70,108-127` — DEFAULT_DURATION=4000 后从 state 删除，仅 viewport `aria-live`，**无历史/回看区**；`SimpleChat.tsx:253,938`、`BottomTerminal.tsx:91` 同型；`ResultArtifactShell.tsx:912-913` viewer 降级原因仅 `role="note"`（非 alert/status/live region）；`ExternalImportPanel.tsx:235` 单条 message 替换无回看。
- `SimpleChat.tsx:1536` / `LeftPanel.tsx:443,654,662` / `ResultsLibrary.tsx:58-94` 全量 DOM；`content-visibility` 仅两处且消息列表未覆盖。
- `LeftPanel.tsx:442,559,577-583` 全文无 `tabIndex`，onKeyDown 仅 Enter/Escape 重命名 → **树 roving tabindex / 方向键缺失**；`ArtifactPinPane.tsx:203-216` 分屏 handle 用 `role="separator"` 却带 aria-valuenow/min/max + tabIndex（`ArtifactPinPane.ratio.test.tsx:12` 自注「该是 slider」），全仓 `role="slider"` 零命中。
- `workspace-panels/CenterPanel.tsx:203-209` 外层与内层同名 `workspaceSessionLayout` 双层嵌套，`:262,296` 两处重复挂 `FloatCardResizeHandle`；`pages/project-workspace.module.css:1546,2836` 同名 class 两处定义，文件 172KB。
- `acceptance/block-332/ui-ledger-triage.json:2-12` 段解析口径：sections 496 / uniqueIds 487，verified 452、debt 32（live-missing 7 + blocked 25）、closed 12；BLOCK-383 已翻 UI-700/701，但 `scripts/ui-ledger-triage.mjs:35,58-59` 的 `STATUS_RE` 会把「按纪律不标 verified」（UI-694 / UI-663）误计为 verified，**机械计数不可信**。UI-694/695/697/698/699 五条仍待人眼或特定 UI 态实机。
- `components/copilot/copilotClient/agentTaskStream.ts:163-166` 仅 `onStreamReconnecting` 回调，SimpleChat 目录零消费 → SSE 重连/重放无独立横幅（**未确认**）。

**优化目标**：任何状态下用户都知道「发生了什么、能用什么、为什么不能用」，且失败可回看；界面元素不随数据量线性膨胀；键盘与读屏路径完整；UI 台账每条 debt 终态为 verified / cancelled / retain-with-reason。

### 2.8 错误处理与边界情况 — 3.7 / 5

**已兑现**：`loop-orchestrator.js:1484-1503`、`routes/ai-chat.js:329-338`、`copilotClient/agentTaskStream.ts:437-448,607-609` 的 done / error / `task.failed{reason,reasonCode}` 三态生产与消费；`helpers/llm-client.js:55-59,78-80` → `model-gateway.js:220,275-280,315-316` → `deepseek.js:336` / `anthropic.js:259` 的 `errorsAsRejections` 全链；`message-trimmer.js:69-97,160-174,241-243` + `helpers/agent-resilience.js:255-257` tool 配对原子性；`helpers/tool-cancel-registry.js:23-47` 协作取消；`helpers/trajectory-events.js:57-61,211-221` 四事件生产者与轨迹分类。

**当前缺口**：
- `src/preload.js:66-70`、`routes/ai-chat.js:328-338`、`_ipc-trust.js:110`、`agent-tool-interceptor.js:401`、`llm-providers/io-transcript.js:12-13`、`routes/ai-agent/chat.js:372`、`routes/ai-agent/resume.js:254`、`agent-tools/spawn-agent-tools.js:503` — 空 catch / `res.write` 吞错 / 3 处生产 `onEvent: () => {}` 仍在。
- `helpers/trajectory-events.js` 四类事件（`compaction_failed` / `trim_skipped` / `provider_retry` / `stream_stall`）在 `frontend/src` **零直接消费**（仅 `task.failed` 有消费者）；用户侧看不到「压缩失败 / 修剪跳过 / 首 token stall」。
- `helpers/reason-codes.js:19-27,29-66,68-91` 封闭词表仅约 25 码（只注册 `stream_stalled`）；`agent_run_failed`、`stream_stalled_first_token` 与四事件码未注册，走「未注册原因码」回退文本；`test/block324-reason-taxonomy.test.mjs:34-42` 的契约扫描只锁 agent-tool-policy 的 deny/allow 字面量。
- `core/shared-backend/delivery-manifest.js:159-165` 断链静默新起；`core/shared-backend/execution-admission.js:68-85` 的 token 过期/重放/`execution_token_ctx_rewritten` 仅有单元负测、无生产校验者。
- 64MB 上限分散在 mesh / 语义校验 / 远端读预算 / mmap / transcript 轮转，无单一入口；`src/plugin/zip.js:14-18` 解压无条目级校验（见 2.6）。

**优化目标**：所有失败有结构化原因码 + 可见 UI/轨迹态 + 明确可重试或不可重试；空 catch 按「真缺陷修 / 化石删 / 误报豁免」三分法清零并转机械门禁；四事件接通前端投影；reason-code 覆盖全生产面。

### 2.9 测试覆盖 — 4.2 / 5

**已兑现**：`test/*.test.mjs` 658 个 + `*.test.cjs` 5 个 + `frontend/src/**/*.test.ts(x)` 359 个（只读探查口径）；`test/impact-map.json` 357 条规则、`test/impact-map-coverage-baseline.json` 145 条未映射棘轮只减不增、`test/nso-w5-impact-coverage.test.mjs:22-42` 新测试不挂规则即红；`scripts/test-all-shards.mjs:35,43-53` 三段分片（node-core 默认串行、每片 45min 有界、exit 124/125 = unknown 不写 PASS）；红绿先行与负测文化（stream RST / ipc-trust / exec-token / chain-hash / perf / EAR / 表面矩阵）。

**当前缺口**：
- `acceptance/post-nso-2026-11-06/stage-0/shard-attribution.json` final 38 残红（16 C-46 + 1 P6 + 1 S1 + 20 环境档）；`acceptance/nso-2026-11-06/wave-0/full-test-shards/` 最新汇总仍 `exit=1 / allPassed=false`。
- 145 条未映射测试按 `acceptance/post-nso-2026-11-06/stage-0/unmapped-decay-plan.json` 八簇消亡未推进；`test/impact-map-coverage-baseline.json` 注释仍写「147 个」而实为 145。
- 源码扫描契约（见 2.4）；`test/loop-orchestrator-subdomains.test.mjs:134` 行数锚 1572 落后实际 1579。
- `acceptance/post-nso-2026-11-08/task-suite-round1.json:512-533` 8 项 `humanEyePending` 与 toolSelectJudge / artifactJudge 仍为占位；`results-v2final.json` 判据表冻结但无人眼确认记录。
- 本轮因并发在制未跑 `test:changed` / `closeout`，**不得复用 S7 的「16 门全绿」作为本次现场证据**。

**优化目标**：三段分片各自有 exit.json 与完整日志、0 未归因 fail；145 条按簇消亡且禁盲挂；行为契约替代源码扫描；人眼判据集中落盘；每个新机械门自带负测。

### 2.10 文档完善度 — 4.6 / 5

**已兑现**：`docs:check` PASS 515 注册 / 498 托管；`scripts/docs-governance.mjs:241-256,456,880-899` coverage 单写入器 + `COVERAGE_COUNT_DRIFT` + `UNREGISTERED_DOCUMENT`；`scripts/docs-roll-index.mjs` 按月滚动；`npm run audit:compact` 幂等入 closeout 首步；acceptance 与解释文档分离；BLOCK-381 后 post-nso 证据带 `sourceCommit / capturedBy / generatedAt` 增量面。

**当前缺口**：
- `docs/AUDIT-LOG.md` 83KB > 50KB 建议阈、L88 10031B 超长行；`docs/README.md:1-2` 两条最新入口行无反引号，不匹配 `ENTRY_RE`，跨月滚动会漏识别；`docs/DOC-REGISTRY.json` 顶层 `lastUpdated:"2026-11-06"` 与 coverage 内 `2026-11-09` 不一致。
- `POST-NSO-OPTIMIZATION-BLUEPRINT-2026-11-06` registry 仍 `status: planned` 但正文 S0–S7 已由 BLOCK-375～383 收尾（与 11-06 首份蓝图的 S0 对账先例同型）；`docs/pending-work-backlog.md` 中 BLOCK-349～354 仍写 planned 而 README 已 completed；`project-workspace-handoff.md` 与 `next-steps-roadmap.md` 的「最后更新」链含多条被取代的恢复要点。
- 证据元数据 `platform` / `command` 在 post-nso stage-0 未作为字段落地；`docs/block-381-post-nso-s6-governance-plan.md` §2 的 skills manifest sha256 小批与 `docs:roll-index --check` 完全脚本化未清偿。
- `npm run state` 报「串行槽位空闲」而 registry 有 `BLOCK-384 status:active`（`truthDomain` 不同层），恢复者需同时读两处才不误判。

**优化目标**：单一真相可机械恢复；`docs:reconcile` 候选逐件复核；README 入口行格式机械化；证据元数据齐 `sourceCommit / platform / command / generatedAt`；下一 Agent 只读 `state + AUDIT-LOG + roadmap + handoff + active plan` 即可接手。

### 2.11 依赖与架构合理性 — 4.0 / 5

**已兑现**：`.dependency-cruiser.cjs:36,43` 仅两处 `pathNot` 例外桥（R3 `src/main/env-coordinator.js`、R4 `core/packages/`）；`quality:arch` R1–R5 PASS 且 `scripts/lib/arch-cruise.mjs:25-31` 单轮共享 cruise；`gate:arch-cycles` 13 存量环在册无新环；`gate:css-modules` 白名单受控；`package.json:279` Electron 精确 44.7.0；零新增依赖提案。

**当前缺口**：
- 5 份 package.json 手工同步（根 11 deps / 15 devDeps、frontend 39 / 14、core/petri-server 7、core/shared-backend 0、core/packages/shared-copilot 0），根无 `workspaces` 字段，仅靠 `package.json:14` postinstall；`scripts/install-core-deps.mjs:13-25,37-40` 只装 core/petri-server 并只 rebuild `better-sqlite3` 一个 native 模块。
- 版本漂移：`package.json:270` typescript `^5.9.3`（放在 dependencies）vs `frontend/package.json:72` `^5.5.4`；`uuid ^9.0.1` vs `^9.0.0`；`better-sqlite3` / `archiver` / `pdfjs-dist` 同版本重复声明；`node-pty 1.1.0-beta34` 预发布钉扎、`occt-wasm 5.11.0` + `occt-import-js 0.0.23` 同族双包。
- FK 分裂（见 2.6）；`acceptance/block-109/arch-cycles-baseline.json:4-17` 13 环含 `agent-runner→loop-orchestrator→agent-tools/*` 与 `registry↔tool-defs`，无按簇消亡里程碑。
- `frontend/src/components/workspace-panels/CenterPanel.tsx:203-209` 布局非单源（见 2.7）；`gate:css-modules` 白名单 13 项未收缩。

**优化目标**：不新增依赖；版本与 native ABI 由单一清单 + 机械对账守住；13 环按簇消亡并逐簇 `--update` 下调基线；FK 策略与运行时一致；布局与样式单源。

---

## §3 剩余缺口总台账（按优先级 · 带 blocker 分类）

分级沿用评审纪律：**P0** = 正确性 / 安全 / 契约破坏 / 当前门禁真红；**P1** = 可靠性 / 体验 / 可维护性实质影响；**P2** = 长期演进与清理。blocker 分类决定该项能否由 Agent 直接开工：`A` Agent 可做（需立项发令）· `L` 需实机/CDP 腿 · `E` 需人眼 · `U` 需用户裁决 · `S` 需兄弟仓授权 · `V` 环境依赖（凭据 / 出网 / 平台）。

| ID | 级 | 锚点 | 现象 | blocker | 阶段 |
| --- | --- | --- | --- | --- | --- |
| B-01 | P0 | `docs/DOC-REGISTRY.json` BLOCK-384 / `npm run state` | active 口径不一致；在制登记未提交，恢复者易误判槽位 | A | H0 |
| B-02 | P0 | `task-suite-round1.json:512-533` | 8 任务 0/8 全为环境因；真实任务成功证据为空 | V + L | H0 / H7 |
| B-03 | P0 | `shard-attribution.json` / `p4r-*` 16 红 | C-46 / C-49 兄弟仓根因，全量分片 38 残红主体 | S（BLOCK-384 在制） | H0 |
| B-04 | P0 | `execution-admission.js:42-114` / `agent-tool-interceptor.js:389-401` | 内核齐备但三入口无生产消费点，enforcement 仍 observe | U + A | H1 |
| B-05 | P0 | `db/connection.js:24-25` / `_db-singleton.js:86-90` | FK OFF/ON 分裂，179 违约未清偿 | U | H1 |
| B-06 | P0 | `zip.js:14-18` / 工具结果输入面 | 解压无条目级校验；prompt injection 防线未确认 | A | H1 |
| B-07 | P0 | `ToastProvider.tsx:35,64-70` / 四事件前端零消费 | 4s 提示消失无回看；失败对用户不可见 | A | H2 |
| B-08 | P0 | `preload.js:66-70`、`ai-chat.js:328-338`、`spawn-agent-tools.js:503` 等 | 空 catch / 3 处 `onEvent:()=>{}` / 签发失败静默 | A | H2 |
| B-09 | P1 | `SimpleChat.tsx:1536`、`LeftPanel.tsx:443,654,662`、`ResultsLibrary.tsx:58-94` | 三面全量 DOM，无节点上限与视口窗口化 | A + L | H3 |
| B-10 | P1 | `LeftPanel.tsx:577-583`、`ArtifactPinPane.tsx:203-216` | 树 roving tabindex / slider 语义缺失 | A + L | H3 |
| B-11 | P1 | `CenterPanel.tsx:203-209,262,296`、`project-workspace.module.css:1546,2836` | 双层同名 layout + 两处 resize handle，布局非单源 | A + L | H3 |
| B-12 | P1 | `ui-productization-audit.md` / `ui-ledger-triage.mjs:35,58-59` | 32 条 debt 未终态；`STATUS_RE` 误计 verified | A + E | H3 |
| B-13 | P1 | `ResultArtifactShell.tsx:912-913`、`ExternalImportPanel.tsx:235` | 降级/回执非 live region，单条 message 无回看 | A | H2 |
| B-14 | P1 | `agentTaskStream.ts:163-166` | SSE 重连/重放仅回调无独立横幅（未确认） | A + L | H2 |
| B-15 | P1 | `reason-codes.js:19-91` | 封闭词表约 25 码，四事件与 `agent_run_failed` 未注册 | A | H2 |
| B-16 | P1 | `loop-orchestrator.js:1579`、`SimpleChat.tsx` 2079 等五件 | 巨型文件大拆片未做；`loop-orchestrator` 未纳尺寸门 | A | H4 |
| B-17 | P1 | `artifact-truth.js:5` 等三份常量 + 5 处硬编码 + 前端 4 处 | schema / contractVersion 多源 | A | H4 |
| B-18 | P1 | `mcp/registry.js:357-384`、`server.js:109-120`、`plugin-loader.js:749-769` | 插件源装配三处 | A | H4 |
| B-19 | P1 | `branch-db.js:34-40`、`migration-runner.js:36-49` | DB 路径解析第二入口 / `PETRI_DB_PATH` 不认 | A | H4 |
| B-20 | P1 | `release-contract.test.mjs:97`、`nso-w5b-second-truth.test.mjs:46-72` 等 | 源码扫描契约未换行为断言 | A | H4 |
| B-21 | P2 | `impact-map-coverage-baseline.json`（145） | 未映射测试八簇消亡未推进；impact-map 重复 id | A | H0 / H4 |
| B-22 | P2 | `block350-perf-gate.mjs` / `block101-startup-timeline-live.cjs:5` | 冷启动五段分解与 DOM/帧率判据未入 closeout | A + L | H5 |
| B-23 | P2 | `SurfaceMatrix` / `capability-map` / `shelf-audit` 三生成器 | 三矩阵非同源，人工改动不判红 | A | H5 |
| B-24 | P2 | 5 份 package.json / `install-core-deps.mjs` | 三套依赖树、版本漂移、native ABI 只对 better-sqlite3 | A | H4 |
| B-25 | P2 | `arch-cycles-baseline.json:4-17` | 13 存量环无按簇消亡里程碑 | A | H4 |
| B-26 | P2 | `knip.json:38` / 动态 require 三处 | 330 键保留面是上界不是精确债 | A | H4 |
| B-27 | P2 | `AUDIT-LOG.md` 83KB / L88 10031B / README L1-2 | 账本超阈 + 超长行 + 入口行反引号缺失 | A | H6 |
| B-28 | P2 | registry `POST-NSO-...planned` / backlog 349–354 | 已完成计划与 backlog 注记滞后 | A | H6 |
| B-29 | P2 | acceptance 证据元数据 | `platform` / `command` 未作字段落地；skills manifest sha256 小批 | A | H6 |
| B-30 | P2 | `quality:ear` 41.6% / manifest 43.3% | 45% 目标未达；负值来自分母增长，需负测守住 | A | H6 |
| B-31 | P2 | `quality:lint` 2312 warnings / css white-list 13 vs 11 | warnings 与可收缩白名单无消亡棘轮 | A | H4 |
| B-32 | P2 | 颜色字面量 4 族 / `ContextBudgetBar.tsx` 等 | 主题 token 阶梯未覆盖全部硬编码色 | A | H3 |
| B-33 | P2 | `quality:surface` P3=2 / `ipcUnusedInRenderer=165` | 定义先于入口的沉积未逐件裁决 | A | H5 |
| B-34 | P2 | `task-suite` humanEyePending 8 / T7 windowOverride | 人眼判据与自然长任务未落盘 | E + V | H7 |

> 合计 34 项：P0 8 项、P1 12 项、P2 14 项。凡 `U` / `E` / `S` / `V` 类，Agent 不得自行开工或代答；遇到即停线出材料，按 §5.3 推进下一可开工项。

---

## §4 阶段蓝图（H0–H7）

> H = Horizon（第三轮波次），与已收官的 W0–W7（NSO）、S0–S7（post-NSO）明确区分。**不设工作量上限，但设证据上限**：任何没有当前证据的「完成 / 通过 / 可信」都不得写入收口报告。

### H0 · 可信起点与在制收口（P0）

**目标**：让 BLOCK-384 在制、环境因阻断点、账本口径和全量分片残红全部有可恢复的终态，为后续所有阶段提供干净、可复跑的起点。

**依赖**：无（但串行上必须等 BLOCK-384 收口）。**blocker**：S / V / A。

**具体改进点**：
1. **在制协同（B-01）**：BLOCK-384 的 plan / registry 条目 / README 入口 / AUDIT-LOG 启动登记由其所有者收口；本阶段只做只读对账，零触碰 `docs/DOC-REGISTRY.json`、`docs/README.md`、`docs/block-384-*.md` 的未提交内容；把 `npm run state` 的 `g0-current-work-package` 槽位与 registry `truthDomain` 两层的语义写进 `scripts/workspace-state.mjs` 输出，避免恢复者误判。
2. **兄弟仓清偿验收（B-03）**：等 BLOCK-384 交付后复跑 `p4r-invariants` / `deseq2-multifactor-design` / `p4r-baseline` / `block218` 四族与 `g0:result-studio:p6:update`；P6 源绑定重算按 dev-infra 纪律要求「仓库完全静默」窗口；残红逐件归因落 `acceptance/<阶段>/h0-shard-attribution.json`。
3. **全量分片 38 → 0 未归因（B-03/B-21）**：20 条环境档按 `block48` AX 会话档 / `block63` 平台门显式 skip 并留原因；16 条 C-46 随兄弟仓清偿转绿；1 条 P6、1 条 S1 专项各自补腿；三段分片 `task:run` 有界、exit.json 与完整日志齐备，超时结论为 unknown 不写 PASS。
4. **影响图消亡第一批（B-21）**：按 `unmapped-decay-plan.json` 八簇挂规则 → 删基线条目 → 定向绿，禁一次性盲挂；先修 `block337-governance-runtime` 重复 id，脚本口径复核 357 规则。
5. **治理对账（B-01/B-28）**：`POST-NSO-OPTIMIZATION-BLUEPRINT-2026-11-06` 的 `planned` 与正文 S0–S7 已收尾冲突按 11-06 首份蓝图先例裁定；AUDIT-LOG 当前待处理 🟡 逐件核对结论（不改行为、不代裁决）；backlog 349～354 滞后注记修正。
6. **干净树基线（B-01）**：WIP 全部有 owner / Plan ID 后跑 `closeout:full`（全量转义）连续 3 次 16 门 PASS，`test:changed` 0 fail / 0 cancelled，skip 均有显式原因。

**出口判据**：BLOCK-384 收口提交落定；`closeout:full` 干净树连续 3 次 16 门 PASS；`test:all:sharded` 三段 0 未归因 fail；`docs:reconcile` 候选逐件复核；WIP 清单零未知 owner。
**证据目录**：`acceptance/post-s7-2026-11-09/h0/`（门禁摘要、分片 exit.json、WIP 归属 JSON、对账决策记录）。

### H1 · 执行准入与数据真相最后一公里（P0 · 含用户裁决）

**目标**：把「策略判定」与「真正执行」焊成一条可审计闭环，让 FK 与产物链只有一份运行时真相。

**依赖**：H0（干净树 + 分片归因稳定）。**blocker**：U + A。

**具体改进点**：
1. **ADMISSION 全调用面审计（B-04）**：先出「三执行入口 × 全部调用路径 × 审批档 × 越界路径」审计表，交用户裁决默认档（`observe` → `enforce` 或保持）；裁决前不改默认语义。
2. **三入口消费闭环（B-04）**：`helpers/tools-executor.js`、`mcp/registry/run-plugin-script.js`、`helpers/remote-execution/ssh-direct-runner.js` 接 `verifyAndConsumeExecutionToken`；参数改写 / 过期 / 跨 task 重放 / 跨进程四类拒绝各落生产路径负测（现仅有单元负测）；`agent-tool-interceptor.js:401` 签发失败改显式降级事件而非静默 catch。
3. **FK 全量切换（B-05）**：179 违约逐表清偿独立大包，后端 `foreign_keys` 与 `db-connection-policy.js` canonical pragma 归一；迁移连接同 pragma；三面一致性门扩展为四腿（含迁移连接）。**须用户显式裁决后开工**。
4. **产物链默认严格（B-06/B-08）**：`scripts/verify-artifact-chain.mjs` 的 `legacy_unhashed` 由「登记不判红」改默认 strict（先出存量清单与迁移路径）；`delivery-manifest.js:159-165` 上一份损坏不得静默新起，改显式 `manifest_chain_broken` 原因码；产物字节 sha256 全覆盖并含篡改负测。
5. **输入面 fail-closed（B-06）**：`src/plugin/zip.js` 补 entry 名穿越 / 总字节 / 文件数上限与拒绝原因码；对不可信工具结果做一次 prompt-injection 面盘点（只读），结论决定是否需要隔离层，不预设实现。
6. **解压/路径/审批负测族（B-06）**：新增测试走真实调用链，禁止手工注入掩盖断链；重复类缺陷按评审 skill「回归→门禁转化」写进 gate 注释。

**出口判据**：三入口必须出示并消耗一次性凭据（四类拒绝负测在生产路径可复跑）；FK 全量回归 0 fail 且策略与运行时一致；链校验器 strict 模式 0 红；ADMISSION 与 FK 的裁决记录留痕。
**证据目录**：`acceptance/post-s7-2026-11-09/h1/`。

### H2 · 用户可感知的失败态与错误语义（P0/P1）

**目标**：任何失败都有结构化原因码、可见界面态、可回看历史，以及明确的「可重试 / 不可重试」。

**依赖**：H0；与 H1 共享错误码面须串行。**blocker**：A + L。

**具体改进点**：
1. **统一错误回看区（B-07/B-13）**：`ToastProvider.tsx` 4 秒提示在消失时写入有界通知历史（上限、去重、可关闭、可回看），不新建第二套通知中心；`ResultArtifactShell.tsx:912-913` 的 `role="note"` 改 `role="alert"`/`status` + live region；`ExternalImportPanel.tsx:235` 单条 message 替换改可回看列表。
2. **四事件前端投影（B-07）**：`compaction_failed` / `trim_skipped` / `provider_retry` / `stream_stall` 从 `trajectory-events` 接到会话轨迹面与通知历史，每条带 reasonCode + 重试/复核入口；补「事件发出但 UI 不消费」的反向契约测。
3. **空 catch 清零（B-08）**：按真缺陷修 / 化石删 / 误报豁免三分法处置 8 处生产空 catch 与 3 处 `onEvent:()=>{}`；新增「生产路径空 catch 静态扫描」机械门（第二次出现即转门，写清映射）。
4. **reason-code 覆盖（B-15）**：把 `agent_run_failed`、`stream_stalled_first_token`、四事件码与断链码纳入 `helpers/reason-codes.js`；`test/block324-reason-taxonomy.test.mjs` 扫描范围由 agent-tool-policy 扩到生产面全部 `reasonCode:` 字面量，新增未注册即红。
5. **SSE 重连横幅（B-14）**：`agentTaskStream.ts:163-166` 的 `onStreamReconnecting` 接可见横幅（与已有重放横幅同族，不建第二通道）；断线/重放/耗尽三态有实机 flow 断言。
6. **边界回归（B-08）**：token 过期/重放/ctx 改写从单元负测升到执行入口集成负测；64MB 上限由分散常量收进单一入口并逐值对账。

**出口判据**：每个失败态可在 UI 与轨迹面查到原因码并可回看；四事件端到端契约全绿；空 catch 静态门绿；reason-code 扫描零漏注册；SSE 三态实机 flow 全绿。
**证据目录**：`acceptance/post-s7-2026-11-09/h2/`。

### H3 · 体验收官：DOM 预算 / 可访问性 / 布局单源（P1）

**目标**：界面不随数据量线性膨胀，键盘与读屏路径完整，布局只有一个真源。

**依赖**：H1/H2 的错误契约稳定。**blocker**：A + L + E。

**具体改进点**：
1. **零依赖视口预算（B-09）**：消息 / 会话 / 结果库三面统一 `content-visibility` + 有界分页或视口窗口化；先用 CDP 量测 ≥400 条会话的节点数与滚动帧率作为重开条件，**不引入虚拟列表依赖**（新增依赖走 `DEPENDENCY-CHANGE-CHECKLIST`，默认不增）。
2. **a11y 收官（B-10）**：`LeftPanel` 树补 roving tabindex + 方向键展开/折叠；`ArtifactPinPane` / `FloatCardResizer` 的 `separator` 改 `slider` 语义并补 aria 值域契约；补一条「隐藏层不可 Tab + 树可键盘展开 + 分隔件可键盘调宽」的 a11y 冒烟 flow。
3. **布局单源（B-11）**：按 `petri-css-theme` 纪律做「布局层重构而非追加」——`CenterPanel.tsx:203-209` 双层同名 layout 收成单一 `XxxLayout.module.css`，删除 `project-workspace.module.css` 重复 class 与死 fallback，两处 `FloatCardResizeHandle` 合并；四块几何量测 + 拖到两倍 / 缩到一半自查，DOM 几何绿不得替代视觉绿。
4. **主题收敛（B-32）**：4 族颜色字面量按海军蓝 token 阶梯替换，`theme-token-contract.test.ts` 保持 17/17 并扩展颜色字面量扫描；XTerm 数值 API 两处豁免保留留痕。
5. **UI 台账终态化（B-12）**：先修 `scripts/ui-ledger-triage.mjs:35,58-59` 的 `STATUS_RE` 误判（「按纪律不标 verified」不得计 verified），再按 A/B/C/D/E 分诊 32 条 debt；CDP 可代行的补腿，人眼项（UI-694/695/697/698/699）生成详细测试路线集中一次人工确认，**Agent 不代答**；每条终态为 verified / cancelled / retain-with-reason。
6. **视觉验收四件套（B-12）**：元素级截图过目、可视列边界 + 祖先链溢出量测、长内容三态、flex/grid 祖先链 `min-width:0`。

**出口判据**：CDP 实测节点数 / 帧率有读数且设上限；a11y 冒烟 flow 全绿；布局单源几何量测 + 人眼过目双证；台账 debt 按契约不回弹；截图不可得如实 `screenshot_unavailable`。
**证据目录**：`acceptance/post-s7-2026-11-09/h3/`。

### H4 · 架构去补丁：大拆片与单源收编（P1）

**目标**：降低读者需要持有的概念数，把「保护实现细节的测试」换成「保护行为的测试」。

**依赖**：H1/H2 契约抽取完成。**blocker**：A。

**具体改进点**：
1. **W5b 逐刀纪律（B-16）**：`loop-orchestrator.js` 五段（init / provider / tools / decision / finalize）、`SimpleChat.tsx`、`workspace-tools.js`、`project-workspace.tsx`、`ReviewMode.tsx` 按「一切片 = 一会话 + 拆前拆后同套定向测试绿」推进；每刀后 `gate:code-size` 例外只减不增，行数锚随交付刷新（修 `loop-orchestrator-subdomains.test.mjs:134` 落后锚）；`loop-orchestrator.js` 纳入尺寸门 MANIFEST，不靠例外续期。
2. **版本常量单源（B-17）**：三份 `=1` 与 5 处 `artifactSchemaVersion:1`、三处 `CONTRACT_VERSION='1.0.0'`、前端 4 处 `contractVersion:1` 收进单一 registry；注意 BLOCK-379 已澄清的「intent 域 / studio 域双版本」不得误并；跨语言逐值对账门。
3. **插件源与工具元数据单源（B-18）**：三处装配收敛为单一 `loadPlugins(sourcePlan)`；`TOOL_METADATA` / `CONTRACTS` 双表合一或由同一生成器输出，删跨表一致性补丁测试。
4. **DB 路径单源（B-19）**：`branch-db.js:34-40` 接入 `resolveDbPath`，`migration-runner.js:36-49` 双候选收敛到 `resolveCore` 单桥；`PETRI_DB_PATH` 四腿一致性门。
5. **测试有效性（B-20/B-21）**：源码 `includes` / 行数断言逐文件换成事件、状态机、错误码、恢复行为断言；145 条未映射按簇消亡剩余部分；`test/impact-map.json` 去重并补「重复 id 即红」契约。
6. **依赖与环（B-24/B-25/B-26/B-31）**：5 份 package.json 的版本漂移与重复声明出「单一清单 + 机械对账」方案（**不新增依赖**、默认不改锁文件；改版本须走依赖升级评审与前后同套绿）；13 存量环按簇设里程碑，每消一簇 `--update` 下调基线；动态 require 三点改静态注册；lint 2312 warnings 与 css 白名单 13→11 设分域只减棘轮。

**出口判据**：主链拆分为行为可测单元且行数只减锚不落后；版本/插件源/DB 路径各有单一真源并有漂移负测；源码扫描契约数量显著下降或有明确遗留理由；环与 knip 保留面只减不增；任何 scoped 重构带拆前拆后同套绿基线。
**证据目录**：`acceptance/post-s7-2026-11-09/h4/`。

### H5 · 性能与规模化实测（P1/P2）

**目标**：从「毫秒门稳定绿」升级为「长会话、长列表、大项目、冷启动都有持续预算与实机读数」。

**依赖**：H3（DOM 预算）、H4（结构稳定）。**blocker**：A + L。

**具体改进点**：
1. **五段分解入门禁（B-22）**：`scripts/block101-startup-timeline-live.cjs` 的四段口径扩为 require / 迁移 / 后端 health / SPA 200 / CDP 页面五段，接入 `quality:perf` 或独立 closeout 门；dev-infra「三面齐 + 编排器 stdout 指纹」纪律写进断言。
2. **DOM / 帧率判据（B-09/B-22）**：把 `scripts/block95-a2-frame-live.cjs:84` 的 20000 节点上限升为可复跑门，补 ≥400 条会话的滚动帧率读数；重开条件量化，不用猜测性优化。
3. **perf 证据机器可读（B-22）**：连续 5×5 采样日志落 acceptance 并带 sourceCommit / platform / command；负测「植入慢样本必红」每轮复跑；四场景基线变化留因。
4. **请求体五类占比（B-22）**：工具定义 / 系统提示 / 消息 / 工具结果 / 输出预留每轮可核对，与 `token_budget`、`ai_usage`、`ContextBudgetBar` 同源（不允许「显示一套、请求一套」）。
5. **三矩阵同源与 P3 销号（B-23/B-33）**：功能矩阵 / 能力地图 / 货架矩阵同一生成器输出，人工改动判红；`quality:surface` 补 `router.*` 与动态挂载扫描 + 消费方检测可信度负测；165 个零消费通道与 2 个 storage key 逐件销号或 `retain-with-reason`。
6. **自然长任务（B-34 前置）**：T7 去掉 `windowOverride=20000`，在真实默认窗口触发压缩，20 项 FACT 全收、0 干预；attempt 级 token / cache / duration / 模型归因记录随行。

**出口判据**：四场景连续 5 次 PASS + 负测红；五段读数与 DOM/帧率读数可复跑；三矩阵可一键重建且人工改动判红；T7 自然窗口长任务成功。
**证据目录**：`acceptance/post-s7-2026-11-09/h5/`。

### H6 · 治理台账与证据运营（P2）

**目标**：任何 Agent 换模型 / 换会话后都恢复同一份真相，证据不随文档更新被悄悄升格。

**依赖**：全阶段增量；每阶段同步少量回写。**blocker**：A。

**具体改进点**：
1. **账本自稳与入口合规（B-27）**：`audit:compact` 保持 closeout 首步幂等；L88 10031B 超长行原文迁 `docs/archive/checkpoints/` 并在台账留指针；README 两条新入口行补反引号使 `ENTRY_RE` 命中；`docs:roll-index --check` 完全脚本化并接入 `docs:check` / closeout。
2. **canonical 对账（B-28）**：registry 的 `POST-NSO-...planned` 状态、backlog 349～354 注记、roadmap/handoff 顶部「最后更新」链的被取代段逐件复核；`DOC-REGISTRY.json` 顶层 `lastUpdated` 与 coverage 内日期统一由单写入器生成。
3. **证据元数据（B-29/B-30）**：acceptance 证据统一带 `sourceCommit / platform / command / generatedAt`；skills manifest 的 `sha256:null` 补齐或显式 `unavailable+reason`；EAR 45% 目标按「分子增长 + 负测守住」推进，不靠缩分母达标；历史 PASS 只在 source/dependency digest 相同且同平台同门契约时复用。
4. **交接协议（B-01）**：每阶段收口同批回写 plan / registry / README / roadmap / handoff / AUDIT-LOG / UI 台账；说明 WIP 保留、未跑门禁、外部依赖与人工项；`npm run state` 与 registry 的 active 两层语义在输出中显式标注。

**出口判据**：`docs:reconcile` 候选逐件复核、`docs:check` PASS、coverage 与 status 一致、无第二 active canonical；每阶段有 acceptance 目录、复跑命令、负测和交接笔录；未跑 / 跳过 / 复用证据如实标注。
**证据目录**：`acceptance/post-s7-2026-11-09/h6/`。

### H7 · 真实任务终验与人眼验收（P2/P3）

**目标**：把「机械判据绿、UI 实机腿绿」升级为「真实用户任务连续成功且人眼确认」。

**依赖**：全阶段；有效凭据与出网可用。**blocker**：V + E + L。

**具体改进点**：
1. **8 任务套件连续 3 次 8/8（B-02）**：凭据更新与出网恢复后按冻结判据表复跑 ×3，0 干预、0 伪造判据；T6 波动先归因到稳定根因；环境因逐条留时间线而非笼统记「失败」。
2. **人眼判据集中过目（B-34）**：按 dev-infra 无人化验收阶梯第 4 级，自动生成详细测试路线（步骤 / 输入 / 每步预期 / 证据留存点），人照路线实测并明确回复确认；证据 = 路线原文 + 人的确认记录（日期、覆盖断言），**Agent 不代答**。
3. **真实 provider 长任务（B-02/B-34）**：attempt 级记录（token、cache、duration、模型归因、重试原因）随 dev-verify flow 落盘；T7 无 windowOverride 的自然长会话。
4. **十一维复评**：按 §0.3 口径给出「评估时 / NSO 后 / S7 / 本次复核 / 终验」五列，差值逐条归因，跑完不回溯调参；未达证据的项不写 completed / verified。

**出口判据**：连续 3 次 8/8；人眼确认记录在案；真实长任务 attempt 级证据齐；复评表差值可回溯到提交或读数。
**证据目录**：`acceptance/post-s7-2026-11-09/h7/`。

---

## §5 优先级矩阵与发令顺序

### 5.1 优先级定义

| 级 | 判据 | 阶段 |
| --- | --- | --- |
| **P0** | 正确性 / 安全 / 契约破坏 / 当前门禁真红 / 用户可见的失败不可见 | H0、H1、H2（部分） |
| **P1** | 可靠性、体验、可维护性的实质影响 | H2（部分）、H3、H4、H5（部分） |
| **P2** | 长期演进、债务清理、证据运营 | H5（部分）、H6、H7 |

### 5.2 发令顺序

```text
[BLOCK-384 在制收口（他方，本蓝图不触碰）]
        ↓
H0 发令 → 干净树 closeout:full ×3 + 分片 0 未归因 fail
        ↓
H1 发令（含 U 类裁决：ADMISSION 档位 / FK 全量切换）
        ↓  ← 若裁决未下，按 §5.3 跳到 H2，不空等
H2 发令 → 失败可见性 / 原因码 / 空 catch 清零
        ↓
H3 发令 → DOM 预算 / a11y / 布局单源 / 台账终态化
        ↓
H4 发令 → 大拆片（W5b 逐刀）/ 四处单源 / 环与依赖
        ↓
H5 发令 → 五段分解 / DOM 判据 / 三矩阵同源 / 自然长任务
        ↓
H6 发令 → 账本自稳 / canonical 对账 / 证据元数据
        ↓
H7 发令 → 连续 8/8 / 人眼判据 / 十一维终验
```

阶段内可分多个正式工作包，但**同一时间只有一个 active 工作包与一个进行中阶段**；H1 与 H2 共享执行/错误码语义必须串行；H3 与 H4 若后续发现共享文件或 `sharedBaselines`，按 registry 三判据自动排队，不并行抢文件面。

### 5.3 停线条件

1. 遇到 `U` 类（用户裁决）：出「一页决策材料」（现状、候选、风险、推荐、证据），停线等发令；队列推进下一可开工项，不空等。
2. 遇到 `E` 类（人眼）：自动生成测试路线，绝不代答；未确认的台账保持 `in_progress`。
3. 遇到 `S` 类（兄弟仓）：只登记指针与本仓归因，不越权改兄弟仓。
4. 遇到 `V` 类（凭据 / 出网 / 平台）：如实标注环境因与补腿条件，不把 0/8 写成产品缺陷，也不把「未跑」写成通过。
5. 干净树门禁未绿、并发 WIP 未收口、或证据 source binding 未稳定时，不做 P6 重算类写盘取证（dev-infra P6 纪律）。

---

## §6 验收协议

### 6.1 不变量与红线

1. **通用 agent 主线不收缩**：编排 / 知识 / 工具 / 模型计量 / 可靠性五维仍是核心，领域包是放大器；对标只借形态，本地主权 / 治理透明 / 证据自证三点必须长出自己的形态优势。
2. **本地主权**：推理循环、工具、记忆、编排、证据全留用户机器；可观测性优先落本地事件、SQLite、JSONL 与 acceptance。
3. **零第二真相**：不新建第二 executor、Job、Artifact、Workflow、项目状态、UI truth、DB 连接源、插件源解析器、评分器、通知中心或台账。
4. **用户裁决不回退**：`workspace_exec` 黑名单默认放行保持不变；只加强风险提示、审计、严格模式可发现性与其余执行准入边界。
5. **零新增依赖**：默认复用 React 18 / Vite / better-sqlite3 / MCP SDK / dev-verify / 既有门禁；新增依赖须走 `DEPENDENCY-CHANGE-CHECKLIST` 与用户裁决。
6. **保护 WIP**：当前 3 个已跟踪在制 + 10 个未跟踪项（含 BLOCK-384 在制）只登记、不覆盖、不暂存、不清理、不代提交。
7. **证据自证**：行为测试 / 机械门禁 / DOM 与实机 / 人眼观感 / 真实任务成功五类不得互相冒充；无证据不给分、不写 verified。
8. **单工作包串行**：planned 蓝图不占串行槽位；正式编号发令时分配。
9. **G0 开发期常态 · 不外推 packaged/Provider/GA**。

### 6.2 每个正式工作包的最小 DoD

- 独立 plan：范围 / 非范围 / 依赖 / 风险 / `touchSurface` / `sharedBaselines` / 验收 / 完成语义。
- 红绿先行：新行为契约与缺陷修复先落失败测试再写实现；纯重构用拆前拆后同套绿作行为基线。
- 当次证据：命令输出、exit code、acceptance JSON、实机/视觉证据、负测、未覆盖范围。
- 门禁：`docs:check` + `ui:audit:check` + 定向 `test:changed` + 本阶段专项门 + `closeout`；干净树上只跑一次全量门禁。
- canonical 回写：registry / README / roadmap / handoff / AUDIT-LOG / UI 台账同批；未达证据不写 verified / completed。
- 收口报告：P1 修复清单、P2 留痕、外部/人工/环境边界、WIP 保留状态、下一步唯一建议。

### 6.3 明确不做

- 不新增功能域或工具族充进度；不把「加能力」当作优化。
- 不为过门放宽 lint / types / knip / code-size / model-surface / domain-neutrality / perf / EAR 基线；重打必须显式留因与负测。
- 不把 DOM 断言、机械判据或进程 health 冒充视觉观感、人眼质量或真实任务成功。
- 不在 C-46 / C-49 兄弟仓授权范围外改兄弟仓；不在并发 WIP 未收口时批量移动、删除、暂存或提交文档。
- 不撤销任何既有用户裁决；不引入第二套评分卡或第二份当前状态真相。
- 不启动阶段跃迁，不外推发布资格事项。

---

## §7 与既有 canonical 的关系与复跑命令

- 本蓝图是 `active` 程序文档，**不替代** `docs/next-steps-roadmap.md` 的当前立即任务；各 H 阶段由自己的 work-package plan 占串行槽位、按 §4 出口判据收口。当前立即任务以 active H 阶段工作包与 canonical roadmap 为准。
- 事实基线 = 本文 §1.2 当次门禁 + 四路只读源码实证；`docs/Petri-Desktop-Holistic-Evaluation-2026-11-06.md` 与 `docs/block-382-post-nso-s7-final-report.md` 的评分与收尾笔录保持原样，不被本文改写。
- 源码 / 基线 / 证据 / 工作区变化后，先重跑 §1.2 门禁与受影响维度复核，再执行对应阶段；不把旧读数当现场证据。
- 发令后按 `$petri-project-governance` 分配正式工作包编号、登记 registry 与 AUDIT-LOG；本文件只保留波次、目标与验收，不记录每日进度。

**复跑命令（只读/取样）**：

```bash
npm run state                  # 分支 / WIP / AUDIT-LOG 未决 / active 口径
npm run docs:check             # 注册表与 coverage
npm run ui:audit:check         # UI 台账同步
npm run quality:surface        # 功能面矩阵（会刷新 generatedAt，注意复原）
npm run quality:ear            # EAR 读数
npm run gate:code-size         # 尺寸棘轮
npm run quality:knip:check     # 死代码保留面
npm run gate:arch-cycles       # 存量环
npm run quality:arch           # R1–R5
npm run quality:lint           # 0 error 口径
npm run quality:types          # tsc 0 error
npm run quality:perf           # 连续 5 次采样
npm run skills:check           # 产品 Skill 契约
npm run test:all:sharded       # 三段分片（有界，exit 124/125 = unknown）
npm run closeout:full          # 干净树冷启动全量收口
npm run ui:audit:triage        # UI 台账段解析口径（写 acceptance 证据，跑前看 WIP）
npm run docs:reconcile         # 孤立 / 归档 / 保留候选（只读）
```

> 本次未跑 `test:changed` 与 `closeout` 聚合门（工作区含并发在制），逐门取样结果不等于 closeout PASS；任何收口声明须在干净树上重跑 `closeout:full` 取证。

---

*本蓝图不设工作量上限，但设证据上限：任何没有当前证据的「完成」「通过」「可信」都不得写入收口报告。*
