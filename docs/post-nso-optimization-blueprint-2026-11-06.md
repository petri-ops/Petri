---
capability: post-nso-optimization-blueprint-2026-11-06
status: completed
goal: 以 NSO 全程序收尾后的当前 HEAD 为唯一事实基线，对十一维度做独立证据复核，并把剩余缺口转成不设工作量上限、但设证据上限的分阶段优化计划；核心目标是优化项目与增强使用体验。
acceptance:
  - 十一维度均有当前源码锚点、复核评分、剩余缺口与阶段目标
  - 每个阶段有目标、逐条改进点（含 file:line 锚点）、优先级、依赖与出口判据
  - 全部改进点可追溯到本次四路只读实证或当次门禁读数，不编造证据
  - 本文件保持 planned，不把任何阶段自动翻为 active，不启动实现
reopen: 源码、基线、门禁读数或工作区状态变化后，先重跑 §3 门禁与受影响维度复核，再执行对应阶段
---

# NSO 之后下一阶段优化蓝图（2026-11-06）

> 用户裁决依据：「全面评估项目的各个方面，我需要了解每一个细节，并据此建立一份蓝图，作为下一阶段的工作计划。不要设定工作量上限，核心目标就是优化项目、增强使用体验。」
> **本文件定位**：2026-11-06 上午已产出 [`Petri-Desktop-Holistic-Evaluation-2026-11-06.md`](./Petri-Desktop-Holistic-Evaluation-2026-11-06.md)（十一维全量评估）与 [`next-stage-optimization-blueprint-2026-11-06.md`](./next-stage-optimization-blueprint-2026-11-06.md)（W0–W7 蓝图）；该蓝图已由 NSO 全程序十六包（BLOCK-359～374，40 笔提交）执行收尾。**本蓝图承接其后，是「NSO 之后」的新一轮方向计划**，不重复旧发现、不改写旧结论、不新建第二份当前状态真相。
> **形态**：`planned` 方向蓝图，不是 active 工作包。每一阶段是候选工作包，按单工作包串行纪律逐阶段发令；正式编号在发令时按 `$petri-project-governance` 分配。
> **阶段纪律**：G0 开发期常态 · 不外推 packaged/Provider/GA。

---

## §1 北极星与完成定义

### 1.1 一句话目标

把 Petri 从「NSO 后核心链路显著收敛」推进到 **「任何模型、任何执行入口、任何界面状态下，任务都能跑完；失败都有原因、可见、可复跑；结构不再靠例外与补丁维持」**。

### 1.2 不变量（红线）

1. **通用 agent 主线不收缩**：编排 / 知识 / 工具 / 模型计量 / 可靠性五维仍是核心，领域包是放大器。
2. **本地主权**：推理循环、工具、记忆、编排、证据全部留在用户机器；可观测性优先落本地事件、SQLite、JSONL 与 acceptance。
3. **可信与透明即能力**：审批、规则、ack、血缘、原因码、失败可见性是差异化能力，不是合规负担。
4. **证据自证**：行为测试 / 机械门禁 / DOM 与实机 / 人眼观感 / 真实任务成功五类证据不得互相冒充；无证据不给分。
5. **零第二真相**：不新建第二 executor、Job、Artifact、Workflow、项目状态、UI truth、DB 连接源、插件源解析器、评分器或台账。
6. **用户裁决不回退**：`workspace_exec` 黑名单默认放行保持不变；只加强风险提示、审计、严格模式可发现性与其余执行准入边界。
7. **零新增依赖**：默认复用 React 18、Vite、better-sqlite3、MCP SDK、dev-verify 与既有门禁；新增依赖另走治理检查单与用户裁决。
8. **保护 WIP**：当前工作区 4 个已跟踪修改 + 9 个未跟踪项（并发写入者 / 用户资产 / 临时目录）只登记、不覆盖、不暂存、不清理。
9. **单工作包串行**：同一时间只有一个 active 工作包与一个进行中阶段；阶段内可分多个正式包，但不得为提速并行抢文件面。
10. **G0 开发期常态 · 不外推 packaged/Provider/GA**：本蓝图不列发布资格、公证签名、Provider 矩阵、远程发布事项。

### 1.3 总体出口（蓝图级，非当前已达成）

| 指标 | 当前实测 | 蓝图出口 |
| --- | --- | --- |
| `closeout` 全门 | 本轮 9 门取样 7 PASS / 2 FAIL | 干净树连续 3 次 16 门 PASS |
| `gate:code-size` | FAIL（3 项违规） | PASS 且例外只减不增 |
| `quality:knip:check` | FAIL（新增 1 处） | PASS，保留面逐批下调 |
| `test:changed` | 存量红项在册 | 0 fail / 0 cancelled；skip 均有显式原因 |
| 全量分片 | node-core `exit=1 / allPassed=false` | 三段各自有 exit.json、完整日志、0 fail |
| 功能面矩阵 | P1=0 / P2=0 / P3=2 / dirty=0 | P1/P2 保持 0，P3 逐件销号或 retain-with-reason |
| UI 台账 | 485 唯一编号：450 verified / 12 closed / 7 live-missing / 25 blocked / 32 debt（triage 口径） | 每条 in_progress 终态化；3 条人工实机腿补齐 |
| 8 任务套件 | 7/8，T6 波动，8 项人眼判据 pending | 连续 3 次 8/8、0 干预、T7 无 windowOverride、人眼判据落盘 |
| EAR | 42.9%（manifest 43.3%） | ≥45% 且新增证据由负测守住 |
| 文档真相 | docs:check PASS（504 注册 / 487 托管），AUDIT-LOG 79KB 超阈 | coverage 单写入器、active 槽位唯一、账本自稳 |
| 十一维复核 | 见 §2 | 每维 ≥4.4，且无维靠文档宣称得分 |

> 这些是**出口判据**，不是当前状态。任何阶段未完成都不得把总出口写成 completed / verified。

---

## §2 十一维度复核（本次独立证据锚定）

**口径**：与全量评估 §0.3 同口径（证据锚定，5 = 当前证据下可长期托重，1 = 核心链路不可信）。「评估时」与「NSO 后」两列沿用 [`Petri-Desktop-Holistic-Evaluation-2026-11-06.md`](./Petri-Desktop-Holistic-Evaluation-2026-11-06.md) §0.3 / §0.4；「本次复核」列是四路只读源码实证 + 当次门禁读数的独立估值，**与终评分并列呈现、差异逐条归因**，不回溯修改历史分数。

| 维度 | 评估时 | NSO 后 | 本次复核 | 目标 | 复核归因（一句话） |
| --- | ---: | ---: | ---: | ---: | --- |
| 功能完整性 | 4.2 | 4.3 | 4.3 | 4.7 | 115/115 工具矩阵自洽，但非 deepseek 流式 profile 的 RST 仍不重试、有 fallback 绑定时优先降级 |
| 性能表现 | 3.5 | 3.8 | 3.7 | 4.5 | 双判据门已落地，但重复压缩仍 O(n²)、消息列表仍全量 DOM、连续 5 次 PASS 缺失 |
| 代码质量 | 3.3 | 3.6 | 3.5 | 4.5 | lint/types 已清，但 code-size 与 knip 当次真红，巨型文件靠例外到期续期 |
| 可维护性 | 3.2 | 3.5 | 3.4 | 4.4 | 五处单源已交付，但 `runLoop` 仍约 1397 行、三处 `new Database` 未收编 |
| 可扩展性 | 4.2 | 4.5 | 4.5 | 4.8 | 插件源/工具名/source enum/health 已闭环；动态 require 与三套依赖树仍在 |
| 安全性 | 3.4 | 4.0 | 3.7 | 4.6 | 全局门与链哈希已落地，但 HTTP/MCP/SSH 三执行入口无 token、全局门放行任意 `file:` sender |
| UI 与交互 | 3.7 | 3.7 | 3.8 | 4.6 | W3/W3b 已补 viewer 三段式、失败可见、a11y 与 cv 起步；3 腿人工实机与字号宪章未闭环 |
| 错误处理 | 3.1 | 3.5 | 3.4 | 4.6 | 四类事件已发但前端零消费，空 catch / SSE 无 `task.failed` / 首 token stall 抑制仍在 |
| 测试覆盖 | 3.7 | 4.1 | 3.9 | 4.7 | 650 Node + 359 前端测试与红绿文化在位，但全量分片 exit=1、148 未映射、8 项人眼 pending |
| 文档完善度 | 4.3 | 4.5 | 4.4 | 4.8 | docs:check PASS 与 coverage 机械校验已交付，但双写入器、79KB 账本、active 口径冲突仍在 |
| 依赖与架构 | 3.7 | 3.9 | 3.8 | 4.6 | R1–R5 PASS、迁移定序已立，但 FK 真相冲突、三套依赖树、13 存量环未消亡 |

**综合判断**：NSO 把「静默失败面」从主链大幅收敛，但**收尾时的证据链没有全部闭合**——若干评分所依赖的机制在源码里是「部分落地」或「仅测试链路落地」。下一阶段的主线不是继续加能力，而是**兑现度核验 + 最后一段闭环 + 体验收官**：把「已交付」逐项对到真实生产路径、把红门清干净、把用户真正能感知的失败态与长列表体验补完。

### 2.1 功能完整性

- 已兑现：`scripts/functional-surface-audit.mjs` 按 `git show HEAD` 统计，当次 `quality:surface` = tools 115/115、ipc 168、routes 285、storageKeys 20、P1=0 / P2=0 / P3=2 / dirty=0；`docs/capability-map.md` 由矩阵确定性生成并带越界宣称守卫。
- 仍缺口：`core/shared-backend/llm-providers/anthropic.js:253-258` 流中断仍 `return {error}`，`core/petri-server/helpers/llm-client.js:45-57` 兼容入口不透传开关；`core/shared-backend/llm-providers/model-gateway.js:376-386` 有 fallback 绑定时仅终局 attempt 抛 rejection，而全链 RST 集成测试 `test/nso-w1-stream-retry-full-chain.test.mjs:142` 固定 `disableFallback:true`。`helpers/agent-fallback.js:197` 的 `onEvent: () => {}` 让降级续跑正文不回原流。
- 优化目标：全 provider、全绑定组合下流中故障都有确定行为；「矩阵可达」升级为「任务成功率有连续证据」。

### 2.2 性能表现

- 已兑现：`scripts/block350-perf-gate.mjs:38-49` 双判据（相对容差 + 绝对地板）fail-closed；`test/perf-baseline.json` 四场景阈值；`frontend/src/pages/project-workspace.module.css:1047,1259` 会话行/结果库行 `content-visibility`；`test/nso-w6-task-runner-teardown.test.mjs` 真实进程组回归。
- 仍缺口：`helpers/conversation-compaction.js:100-120` 全表 SELECT + 全量 coveredRows 作摘要源，仅尾部裁 60000 字 → 会话翻倍时摘要输入线性增长、触发次数线性增长；`SimpleChat.tsx:1536` `displayMessages.map` / `LeftPanel.tsx:440,651` / `ResultsLibrary.tsx:59` 仍全量节点；`block350-perf-gate.mjs:58-66` 单次比较、无连续 5 次 PASS；`scripts/block350-perf-collect.mjs:62-80` 冷启动仍单段总时长，五段分解未落地。
- 优化目标：增量摘要输入有界；DOM 节点数有上限与实机读数；性能门稳定绿且负测仍红。

### 2.3 代码质量

- 已兑现：`quality:types` 0 error、`quality:secret` 生产面 0、`quality:arch` R1–R5 PASS、theme token 17/17；`test/nso-w5b-second-truth.test.mjs` 钉死 13 死码与恒 null 桩缺席。
- 仍缺口：当次 `gate:code-size` FAIL——`ResultArtifactShell.tsx` 内容指纹漂移、`result-studio-repository.js` 1763 > 基线 1751 且指纹漂移；`quality:knip:check` FAIL——新增 1 处 `.agents/skills/petri-dev-infra/dev-verify/flows/nso-w3-visual-live.cjs` 未定性；`acceptance/block-92/size-exceptions.json` 的 `SimpleChat.tsx`(2079) / `workspace-tools.js`(1583) 例外靠 2026-12-31 到期续期。
- 优化目标：红门归零且不是靠抬基线；巨型文件有真实拆分路线；knip 新增项按三分法（真缺陷/化石/误报豁免）逐件留因。

### 2.4 可维护性

- 已兑现：`core/shared-backend/db-connection-policy.js:31-87` 导出 resolveDbPath / applyCanonicalPragmas / orderMigrationFiles，三消费方共用；`src/main.js:854-856` will-quit closeAll；`scripts/docs-governance.mjs:238-253` coverage 机械校验。
- 仍缺口：`loop-orchestrator.js:173-1569` 仍约 1397 行 `runLoop`，仅 `agent-tools/context-budget-step.js` 一片；`src/migration-runner.js:61,78`、`src/database/_db-singleton.js:82`、`core/petri-server/db/connection.js:20` 三处各自 `new Database`；`artifact-truth.js:431`、`result-studio-repository.js:1044`、`result-replay-service.js:257` 硬编码 `contractVersion=1`；`docs/AUDIT-LOG.md` 79KB 超 50KB 阈且 L114 单条 3732B。
- 优化目标：策略与实例化同源；主链按职责拆为可单测单元；账本只保留活跃广播。

### 2.5 可扩展性

- 已兑现：`mcp/registry.js:354-384` 插件源委托 `plugin-loader.js:738-759`；`registry.js:546,552` 工具名双形状；source enum 含 pack；`plugin-loader.js:127-147,462-495` entryScript 与类型映射；`mcp/registry-health.js:11-31` degraded 账本逐工具透传。
- 仍缺口：`knip.json:38` 把 `core/**/*.js` 全设 entry，动态点（`agent-tools/plugin-loader.js:152`、`learning.js:617`、`mcp/registry.js:305-335`）无法判死导出；`scripts/block357-capability-map.mjs:20` 与 `scripts/block352-shelf-audit.mjs:29-30` 三份矩阵非同源生成；`acceptance/block-118/corpus-doc-suggest.json:2284` 仍列已删的 `helpers/circuit-breaker.js`。
- 优化目标：动态入口显式注册；三矩阵同一生成器重建，人工改动判红。

### 2.6 安全性

- 已兑现：`src/ipc/_ipc-trust.js:87-106` 全局包装 `ipcMain.handle/on`；`src/ipc/file-dialog.js:373-400` realpath + 登记根精确比对；`workspace-tools/internals.js:61-98` per-call 令牌与 riskWarnings（默认放行裁决不变）；`src/migrations/022_artifact_chain_hash.sql` + `scripts/verify-artifact-chain.mjs` 链哈希与独立复算；`test/nso-w2-*.test.mjs` 安全负测族。
- 仍缺口：`helpers/tools-executor.js:39,1779-1786`、`mcp/registry/run-plugin-script.js:36,74-81`、`helpers/remote-execution/ssh-direct-runner.js:21-22` 三执行入口无 approval/token 概念 → HTTP/MCP/SSH 旁路；`agent-tool-interceptor.js:383-386` 的 `capabilityEvidence` 仅为审计字段，无签名级拒绝；`_ipc-trust.js:56` 任意 `file:` sender 放行、`file-dialog.js:442` 仍丢 `_event`；`result-studio-repository.js:899-901` 改业务列不重算 chain_hash 而校验器把缺链行的存量数据直接判断链；`delivery-manifest.js:50-58` sha256 取自 provenance 而非产物字节；`test/nso-b4-mcp-subject.test.mjs:29` 是 `|| true` 恒真断言。
- 优化目标：策略判定与执行焊成一条可审计闭环；任何旁路必须出示并消耗一次性凭据；产物与导出可自证全链。

### 2.7 用户界面与交互体验

- 已兑现：`viewerRegistry.ts:113-155` 扩展名→kind→兜底三段式 + 降级 reasonCode；`ResultArtifactShell.tsx:911-916` 展示降级原因；`ThemeProvider.tsx:120-139,272-280` prefsSync 失败告警条；`ExperimentalFeaturesSection.tsx:131-146,174-183` 拉取失败原因与重试；`CenterPanel.tsx:105-113` inert；`LeftPanel.tsx:439,556` tree 语义；`ExternalImportPanel.tsx:138-154,234-235` fieldset/live region；实机 `acceptance/nso-2026-11-06/wave-3b/nso-w3-visual-live-darwin.json` 6/6 可达腿。
- 仍缺口：`ResultArtifactShell.tsx:1012` 钉住仅 `disabled={previewLoading}`，canCompare 未接线到钉住/分屏；`ThemeProvider.tsx:122-139,155` push 失败无重放却宣称「恢复后自动重试」；`ExperimentalFeaturesSection.tsx:174-175` status=ok 但 flags 为空时整段开关消失；`LeftPanel.tsx:164-168` 左栏收起无 inert；全仓仍 22 处数值 `fontSize`（W3b 只收敛 12 处）；UI-697/698/699 仍 in_progress，binary 降级原因 / inert / 结果库行 cv 三腿待人工实机。
- 优化目标：任何状态下用户都知道「发生了什么、能用什么、为什么不能用」，且界面元素不随数据量线性膨胀。

### 2.8 错误处理与边界情况

- 已兑现：`helpers/reason-codes.js:19-66` 封闭原因码注册表；`context-budget-step.js:148` `compaction_failed`；`helpers/llm-client.js:81-87` `provider_retry` → `loop-orchestrator.js:860-868` `agent_status`；`routes/ai-agent/events.js:87-99,113-151` failed→error / done / res.end。
- 仍缺口：`conversation-compaction.js:41-43,202,222-227` `.catch(() => {})`；`ThemeProvider.tsx:95,155`、`feature-flags.js:63-65`、`mcp/registry.js:535-537,825-827` 静默；`trim_skipped` 全仓 0 命中，三个失败事件在 `frontend/src` 0 消费且 `trajectory-events.js:50-52` 未注册；`model-gateway.js:387-392` 首 token stall 不发 error；`loop-orchestrator.js:1484-1496,1525` 失败只发 error 不发 done、无 `task.failed`，客户端靠 500ms 轮询补发；`chat.js:252-258` 视图直读 `isResilienceEnabled` 且未传 `maxOutput`。
- 优化目标：所有失败有结构化原因码 + 可见 UI/轨迹态 + 明确可重试或不可重试；SSE 三态契约化。

### 2.9 测试覆盖

- 已兑现：`test/` 下 650 个 `*.test.mjs`、前端 359 个 `*.test.ts*`；`test/impact-map-coverage-baseline.json` 冻结 148 条未映射并只挡增量；红绿先行与负测文化（stream-retry / ipc-trust / exec-token / chain-hash / perf）。
- 仍缺口：`acceptance/nso-2026-11-06/wave-0/full-test-shards/summary-1793978091259.json` node-core `exit=1 / allPassed=false`；model-surface、p6 源绑定、p4r-invariants(C-46)、UI 债棘轮、NEXT-03 仍红或取消；`acceptance/block-356/results-v2final.json:64-67,531-539` 8 项 humanEyePending 与 toolSelectJudge / artifactJudge 全为占位文案；`test/loop-orchestrator-subdomains.test.mjs` 等仍以源码 `includes`/行数为契约；全链 RST 测试固定 `disableFallback:true` 未覆盖启用绑定。
- 优化目标：全量分片可完成可归因；基线由单源生成；行为契约替代源码扫描；人眼判据集中落盘。

### 2.10 文档完善度

- 已兑现：`docs:check` PASS（504 注册 / 487 托管 Markdown）；`scripts/docs-governance.mjs:821-831` coverage 生成/校验；`scripts/docs-roll-index.mjs` 按月滚动；`audit:compact` 入 closeout 首步幂等自稳；acceptance 与解释文档分离。
- 仍缺口：`DOC-REGISTRY.json:12` 的 `coverage.documentCount` 与 `:10264` 顶层 `documentCount` 并存，`docs-roll-index.mjs:212-213` 写顶层、`docs-governance.mjs:828` 写 coverage → 双写入器可静默漂移；`scripts/docs-roll-index.mjs:241-243` 的 `--check` 未接 docs:check / closeout；AUDIT-LOG 79KB 与 1 条 3732B 超长行；`DOC-REGISTRY.json:1482-1485` G0-LF active 对 `project-workspace-handoff.md:2` 「无 active」，旧蓝图 status=planned 但正文 §2a 已收尾；acceptance 证据普遍缺 sourceCommit / 命令 / 平台元数据。
- 优化目标：单一真相可机械恢复；证据可复跑归因；下一 Agent 只读 `state + AUDIT-LOG + roadmap + handoff + active plan` 即可接手。

### 2.11 依赖与架构合理性

- 已兑现：`.dependency-cruiser.cjs:16-52` R1–R5 无违规；`gate:arch-cycles` 13 存量环在册无新环；`gate:css-modules` 白名单受控（13 plain / 92 module）；`package.json:279` Electron 精确 44.7.0，lock 精确 better-sqlite3 12.11.1；零新增依赖提案。
- 仍缺口：`db-connection-policy.js:14-16` 头注称 FK 已回退 OFF，而 `core/petri-server/db/connection.js:22` 与 `src/database/_db-singleton.js:90` 实际 ON、`test/db-singleton.test.mjs:216-231` 断言 ON → 运行时行为与策略真相相反，179 fail 回归结论未落地；`core/petri-server/db/connection.js:51-57` 后端句柄无退出收敛；`build/afterPack.js:80-83` PROBE_UNAVAILABLE 静默返回首候选且无单测；`core/petri-server/package.json:10-18` 另有独立依赖树与 lock；`package.json:264,291` 用 `^` / `>=` 范围版本。
- 优化目标：不新增依赖；策略与运行时一致；native 版本精确锁定 + ABI 断言；存量环按簇消亡。

---

## §3 当次机械门禁真值（2026-11-06 晚，HEAD `a2354ffb`）

| 门禁 | 结果 | 读数 |
| --- | --- | --- |
| `docs:check` | PASS | 504 registered；AUDIT-LOG 79KB > 50KB 建议级、L114 3732B 超长行 |
| `ui:audit:check` | PASS | 630 个带实现证据的 UI 编号 |
| `hygiene:check` | PASS | 无死链/CRLF/控制字节/真 symlink 退化；untracked 仅列出 |
| `quality:secret` | PASS | 生产面 0，fixture 豁免在册 |
| `quality:arch` | PASS | R1–R5 无违规，cruise 全新 |
| `quality:surface` | PASS | tools 115/115、ipc 168、routes 285、storageKeys 20、P1=0/P2=0/P3=2、dirty=0 |
| `quality:ear` | PASS | 881/2056 = 42.9%（manifest 43.3%） |
| `gate:code-size` | **FAIL** | `ResultArtifactShell.tsx` 指纹漂移；`result-studio-repository.js` 1763 > 1751 + 指纹漂移 |
| `quality:knip:check` | **FAIL** | 新增 1 处：`nso-w3-visual-live.cjs` 未定性 |

> 取样为串行九门，不是 `closeout` 全门；`quality:lint` / `quality:types` / `test:changed` / `closeout` 未在本轮取数，不得表述为已验证通过。全量分片最新汇总为 `exit=1`，同样不得写成全绿。
> `quality:surface` 为生成器命令，本次运行刷新了 `docs/functional-surface-matrix-2026-11-04.md` 与 `acceptance/functional-audit-2026-11-04/surface-matrix.json` 的 `generatedAt` 时间戳（各 1 行，判定内容零变化）；两文件在会话起始即为并发写入者的在制状态，本次未覆盖其任何实质内容。

---

## §4 剩余缺口总台账（按优先级）

分级沿用评审纪律：P0 = 正确性 / 安全 / 契约破坏或当前门禁真红；P1 = 可靠性 / 体验 / 可维护性实质影响；P2 = 长期演进与清理。

| ID | 级 | 锚点 | 现象 | 归属阶段 |
| --- | --- | --- | --- | --- |
| G-01 | P0 | `gate:code-size` / `quality:knip:check` 当次读数 | 两项红门未清偿；巨型文件靠例外续期 | S0 |
| G-02 | P0 | `wave-0/full-test-shards/summary-1793978091259.json` | 全量分片 node-core exit=1，148 未映射存量 | S0 |
| G-03 | P0 | `anthropic.js:253-258`、`llm-client.js:45-57`、`model-gateway.js:376-386` | 非 deepseek / 有 fallback 绑定时流中断不整轮重试 | S1 |
| G-04 | P0 | `agent-fallback.js:197`、`loop-orchestrator.js:1484-1496` | 降级正文吞掉；SSE 缺 `task.failed`，失败靠轮询 | S1 |
| G-05 | P0 | `conversation-compaction.js:100-120,222-227`、`chat.js:252-258` | O(n²) 全量摘要、后台压缩静默失败、视图/阈值非单源 | S1 |
| G-06 | P0 | `tools-executor.js:39`、`run-plugin-script.js:36`、`ssh-direct-runner.js:21-22` | 三执行入口绕过 approval/token | S2 |
| G-07 | P0 | `_ipc-trust.js:56`、`file-dialog.js:442` | 任意 `file:` sender 放行；写 handler 仍丢 `_event` | S2 |
| G-08 | P0 | `db-connection-policy.js:14-16` vs `db/connection.js:22` | FK 真相冲突，179 fail 未清偿 | S2 |
| G-09 | P0 | `result-studio-repository.js:899-901`、`verify-artifact-chain.mjs:44-47` | 链哈希不覆盖 UPDATE；校验器把存量缺链行判断链 | S2 |
| G-10 | P1 | `delivery-manifest.js:50-58` | 产物 sha256 取自 provenance，无字节重算与篡改负测 | S2 |
| G-11 | P1 | `trajectory-events.js:50-52`、`frontend/src` 0 命中 | 四类失败事件前端与轨迹面不可见 | S1 |
| G-12 | P1 | `ResultArtifactShell.tsx:1012`、`ThemeProvider.tsx:155`、`ExperimentalFeaturesSection.tsx:174` | 钉住能力位、prefs 重放、空 flags 三处体验断链 | S3 |
| G-13 | P1 | `LeftPanel.tsx:164-168`、22 处数值 fontSize | 折叠态可 Tab、字号宪章未闭环 | S3 |
| G-14 | P1 | `SimpleChat.tsx:1536`、`LeftPanel.tsx:440,651` | 消息/会话/结果库仍全量 DOM 节点 | S3 |
| G-15 | P1 | UI-697/698/699 与 `wave-3b` 三腿 pending | 人工实机观感证据缺 | S3 |
| G-16 | P1 | `loop-orchestrator.js:173-1569` | 主链仅拆一片，1397 行单函数 | S4 |
| G-17 | P1 | `migration-runner.js:61,78`、`_db-singleton.js:82`、`db/connection.js:20` | 三处 `new Database` 未收编 | S4 |
| G-18 | P1 | `db/connection.js:51-57`、`afterPack.js:80-83` | 后端句柄无退出收敛；构建期探针不可用静默放行 | S4 |
| G-19 | P2 | `block350-perf-gate.mjs:58-66`、`block350-perf-collect.mjs:62-80` | 连续 5 次 PASS 与启动五段分解缺 | S5 |
| G-20 | P2 | `knip.json:38`、动态 require 三处 | 死代码保留面冻结失真 | S4 |
| G-21 | P2 | `DOC-REGISTRY.json:12 / :10264`、`docs-roll-index.mjs:241-243` | coverage 双写入器、README 滚动无门禁 | S6 |
| G-22 | P2 | `DOC-REGISTRY.json:1482-1485` vs handoff:2 | active 槽位口径冲突 | S6 |
| G-23 | P2 | `acceptance/nso-2026-11-06/` 元数据 | 证据缺 sourceCommit / 命令 / 平台，三生成器非同源 | S6 |
| G-24 | P2 | `results-v2final.json:531-539` | 8 任务人眼 / 工具选择 / 产物判据全 pending，7/8 | S7 |
| G-25 | P2 | `arch-cycles-baseline.json:4-18`、13 存量环 | 无按簇消亡里程碑 | S4 |
| G-26 | P2 | AUDIT-LOG 79KB / L114 3732B | 账本超阈与超长行 | S6 |

---

## §5 阶段总览

| 阶段 | 名称 | 优先级 | 核心目标 | 依赖 | 覆盖缺口 |
| --- | --- | --- | --- | --- | --- |
| S0 | 可信起点：红门与 WIP 归零 | **P0** | 门禁真红清偿、全量分片收口、canonical 对账 | 无 | G-01/02/22 |
| S1 | Agent 主链最后一公里 | **P0** | 全 provider 故障语义、压缩单源、事件全链可见 | S0 | G-03/04/05/11 |
| S2 | 执行准入与数据自证 | **P0** | 三入口 token、全局门精确化、FK 裁决、产物链闭环 | S0；与 S1 共享执行语义须串行 | G-06/07/08/09/10 |
| S3 | 体验可信化收官 | **P1** | 能力位/失败态/DOM 预算/字号/人工实机腿 | S1/S2 契约稳定 | G-12/13/14/15 |
| S4 | 架构去补丁与测试有效性 | **P1** | 主链拆分、实例化单源、动态入口、环消亡 | S1/S2 契约抽取完成 | G-16/17/18/20/25 |
| S5 | 性能与规模化 | **P2** | 稳定性能门、启动五段、请求体/DOM 预算实测 | S1/S3/S4 | G-05/14/19 |
| S6 | 治理台账与证据运营 | **P2** | 单写入器、生成器同源、证据元数据、账本自稳 | 全阶段增量；每阶段同步少量回写 | G-21/22/23/26 |
| S7 | 真实任务终验 | **P3** | 连续 8/8、自然长任务、人眼判据落盘 | 全阶段 | G-24 |

**执行纪律**：阶段内可分多个正式工作包，每包必须有独立 plan、registry 登记、AUDIT-LOG 启动/收口行、acceptance 证据目录、impact-map 登记、红绿先行与 closeout。不得为了并行提速提前实现后续阶段契约。

---

## §6 S0 · 可信起点：红门与 WIP 归零（P0）

**目标**：把「收尾时仍有真红门、全量测试未完成、canonical 口径冲突」变成干净、可复跑、可归因的起点。

**具体改进点**

1. （P0）`gate:code-size` 三项违规逐件裁决：`ResultArtifactShell.tsx` 与 `result-studio-repository.js` 指纹漂移属并发写入者未随提交重打 → 由其提交后 `--write` 留因；`result-studio-repository.js` 1763 > 1751 属合法增长还是补丁堆积须先判定，合法则重打并说明，否则先 scoped 重构。**不得临时放宽预算**。
2. （P0）`quality:knip:check` 新增的 `nso-w3-visual-live.cjs` 按三分法定性：dev-verify flow 属动态入口 → 显式登记保留理由；真死码则删除；误报则重扫入库。保留面只减不增。
3. （P0）当前 4 M + 9 ?? 建机器可读清单，标注归属（并发写入者 UI 台账 / 生成器时间戳 / 用户资产 / 临时目录），**不覆盖、不暂存、不清理**；由所有者决定提交或回退。
4. （P0）全量分片收口：node-core / frontend / 长时实机三段各自 `task:run` 有界记录 exit.json；对 `exit=1` 逐件归因（model-surface、P6 源绑定、p4r C-46、UI 债棘轮、NEXT-03），超时结论为未知而非 PASS。
5. （P0）148 条 impact-map 存量未映射设分簇消亡计划；未知生产路径保持 fail-closed。
6. （P0）canonical 对账：`G0-LF active` 与 handoff「无 active」、旧蓝图 `planned` 与正文已收尾、`README` 状态文字与 registry 当前态，逐件裁定唯一表述；本蓝图登记后同步 `DOC-REGISTRY.coverage`。
7. （P1）`docs:check` 的 AUDIT-LOG 79KB / L114 3732B 走 `audit:compact` 幂等自稳，超长行原文迁专项 plan 只留指针。

**出口判据**：干净树 `closeout:full` 连续 3 次 16 门 PASS；全量三段 exit.json 齐且 0 fail；`git status` 无未知 WIP 或每个 WIP 有 owner/Plan ID 且文件面不相交；`docs:check` / `ui:audit:check` / `hygiene:check` PASS。

---

## §7 S1 · Agent 主链最后一公里（P0）

**目标**：让流中断、压缩、降级、取消、终整理在任何 provider / 绑定组合下都给出**确定、可见、可恢复**的行为，并把已发出的失败事件真正送到用户面前。

**具体改进点**

1. （P0）`errorsAsRejections` 补齐 `anthropic.js` 与 `llm-client.js` 兼容入口；`model-gateway.js:376-386` 在「可重试错误 + 有 fallback 绑定」时明确优先级（先整轮重试后降级，或反之但必须单一决策结构）；补启用绑定的 RST 集成用例，不再固定 `disableFallback:true`。
2. （P0）`classifyProviderFailure` / `resolveFallbackCandidates` 单源：合并 `model-gateway.js:193-198` 与 `model-fallback-policy.js:67-78` 两套候选解析；不可降级优先、结构化错误码优先；补 cancelled+timeout / 401+api_error / 多绑定上界三负测。
3. （P0）`conversation-compaction.js` 改真增量摘要：只合并 `rowid > covers_rowid` 的行，输入长度有界；删全表 SELECT；补「会话翻倍但单次摘要输入有界」断言。
4. （P0）后台压缩 `.catch(() => {})` 改发 `compaction_failed{reason}`；`chat.js` 统一经 `resolveCompactionMode()` 取视图/阈值并透传 `maxOutput`；四种 flag 组合矩阵测试。
5. （P0）SSE 三态契约：定义 `done / error / task.failed` 与终态字段；`loop-orchestrator.js:1484-1496` 失败分支给显式终态，不依赖 500ms 轮询；`agent-fallback.js:197` 的空 `onEvent` 至少把新 taskId、状态与最终正文投影回原会话。
6. （P0）失败事件全链可见：注册 `trim_skipped`，把 `compaction_failed` / `provider_retry` / `trim_skipped` 纳入 `trajectory-events.js` 分类与前端轨迹面；`model-gateway.js:387-392` 首 token stall 不发 error 改带 `reasonCode` 的可观测事件。
7. （P1）`message-trimmer` / `context-budget-step.js:205-207` 的 `console.log` 异常改 `trim_skipped` 事件；补 trim 幂等的「连续两轮增长再次触发」端到端行为用例。
8. （P1）`provider-reliability` / `model-gateway` 的可重试分类与熔断（当前 CircuitBreaker 在 core/src 零生产消费）逐件裁决：接线或按化石删除，并在 Knip 保留面留因。
9. （P1）`test/loop-orchestrator-subdomains.test.mjs` 等源码 `includes`/行数断言逐步换成事件、状态机、错误码、恢复行为断言。

**出口判据**：全 provider + 全绑定组合的流中故障行为测试绿；三事件在轨迹面与 UI 可查；无静默 catch；增量摘要输入长度有界；SSE 客户端不靠轮询判终态。

---

## §8 S2 · 执行准入与数据自证（P0）

**目标**：在保持用户 exec 裁决的前提下，把「策略判定」与「真正执行」焊成一条可审计闭环，让数据库与产物链的状态可自证。

**具体改进点**

1. （P0）三执行入口接入同一决策结构：`tools-executor.js`、`mcp/registry/run-plugin-script.js`、`remote-execution/ssh-direct-runner.js` 在执行边界校验并消耗一次性 capability token（fingerprint + ctxSnapshot + expiresAt + taskId）；参数改写、过期、跨 task 重放、旁路调用一律拒绝。
2. （P0）`capabilityEvidence` 从审计字段升级为可校验凭据；把 `test/nso-b4-mcp-subject.test.mjs:29` 的 `|| true` 恒真断言换成行为负测，并把扫描覆盖到 `mcp/registry/` 子目录；两轴分离（MCP trust 轴 vs capability token 轴）契约不变。
3. （P0）`_ipc-trust.js:56` 收紧为「主窗 webContents 精确比对 + 显式豁免清单」；`file-dialog.js:442` 写 handler 补模块内 guard；补真实写通道端到端拒绝负测（当前测试用合成通道 `x:write`）。
4. （P0）FK 裁决：以 `db-connection-policy.js` 为唯一策略真相，消除头注 OFF 与运行时 ON 的冲突；若维持 ON，须先清偿 179 条违约数据并给出迁移/回填与 fail-fast 依据；若回退 OFF，须两处代码、测试断言、头注同批一致，并留完整回归证据。
5. （P0）链哈希覆盖后续 UPDATE：`result-studio-repository.js:899-901` 等业务列变更重算 chain_hash；`scripts/verify-artifact-chain.mjs:44-47` 把「存量缺 chain_hash」与「真断链/篡改」分流（历史行显式 `legacy_unhashed` 不判篡改）；补端到端改 DB 行触发 fail-closed 的负测。
6. （P1）`delivery-manifest.js:50-58` 与 `routes/harness/scientific-task.js:194` 重算产物字节 sha256，纳 `prevManifestHash`；导出包带根哈希与独立校验器；补篡改负测。
7. （P1）`core/petri-server/db/connection.js` 后端句柄接入退出收敛（closeAll + `wal_checkpoint(TRUNCATE)`），补真实进程回归。
8. （P1）`build/afterPack.js:80-83` PROBE_UNAVAILABLE 改 fail-closed 或显式登记豁免并补单测。
9. （P1）`workspace-tools/internals.js:44-46` 自述 execToken 全仓无签发者 → 裁决该特权通道是保留（补签发者与审计）还是删除（避免不可达的假安全面）；**默认放行裁决不变**。
10. （P1）`mcp/registry.js:535-537,825-827` 等 warn 后继续的点统一汇入 `registry-health` 的 degraded，初始化失败不得对外宣称完整可用。

**出口判据**：三入口 token 消耗与四类拒绝负测全绿；写 IPC 精确 sender 门与真实通道负测绿；FK 代码/测试/文档三面一致；链哈希与 manifest 可由独立校验器复算且篡改留痕。

---

## §9 S3 · 体验可信化收官（P1）

**目标**：把「看起来能用」升级为「任何状态下用户都知道发生了什么、能用什么、为什么不能用」，并让界面不随数据量线性膨胀。

**具体改进点**

1. （P1）能力位一条链贯通：`canSelect/canCompare/canExport` 从 `viewerRegistry` 一路上抛到 Canvas、ContextBar、导航、钉住（`ResultArtifactShell.tsx:1012`）、导出；禁用给具体原因，禁止静默回落。
2. （P1）失败可见性收尾：`ThemeProvider.tsx` push 失败补重放队列并更正「恢复后自动重试」文案；`ExperimentalFeaturesSection.tsx:174-175` status=ok 且 flags 空时展示「当前无可配置实验开关」而非消失；统一 `role=alert/status` + 原因码 + 重试入口。
3. （P1）a11y 对称：`LeftPanel.tsx:164-168` 折叠态补 `inert`；树控件 roving tabindex / `aria-expanded`；分屏把手 `slider`；补隐藏层不可聚焦与树可键盘展开的离屏实机 flow。
4. （P1）字号宪章：剩余 22 处数值 `fontSize` 收敛到 token（XTerm 等数值 API 按 W3b 先例逐项豁免留痕）；亮/暗/字号/accent/motion 四轴端到端视觉取证；theme token 17/17 守住。
5. （P1）DOM 预算：`SimpleChat.tsx:1536` / `LeftPanel.tsx:440,651` / `ResultsLibrary.tsx:59` 从「content-visibility 跳渲染」升级为窗口化 + 节点上限（零依赖，先分页后虚拟）；用 CDP 实测 ≥400 条会话、`>10k` 节点、滚动帧率与首屏时间定义重开条件。
6. （P1）UI 台账终态化：485 唯一编号中 7 live-missing / 25 blocked / 32 debt 按 A/B/C/D/E 分诊；CDP 可代行的补腿，缺真实数据/环境的显式条件腿，纯人眼项集中一次人工路线；UI-697/698/699 三条 pending 实机腿逐条取证（binary 降级原因 / inert / 结果库行 cv）。
7. （P1）视觉验收四件套：元素级截图、可视列边界 + 祖先链溢出量测、长内容三态、flex/grid 祖先链 `min-width:0`；DOM 几何绿不得替代视觉绿；截图不可得如实 `screenshot_unavailable`。
8. （P2）布局单一真源：`CenterPanel.tsx` 双层同名 layout 与历史补丁规则按 CSS 主题纪律重构（同类规则 >3 即重构），四块几何量测留证。

**出口判据**：能力位、降级、同步失败、空 flags 都有可见原因与可操作出口；隐藏层不可 Tab；窄窗口无溢出；每条 in_progress 终态为 verified / cancelled / retain-with-reason。

---

## §10 S4 · 架构去补丁与测试有效性（P1）

**目标**：降低读者需要持有的概念数，把「保护实现细节的测试」换成「保护行为的测试」，并让存量债按簇消亡。

**具体改进点**

1. （P1）`runLoop` 五段拆分：init / provider / tools / decision / finalize，先冻结逐段输入输出行为基线，再拆为可单测函数；同套定向测试拆前拆后双绿（BLOCK-92 先例）。主编排文件目标 <600 行，不靠抬基线通过。
2. （P1）`SimpleChat.tsx`(2079) 与 `workspace-tools.js`(1583) 给真实拆分路线与到期前消亡计划，不续期例外；`acceptance/block-92/size-exceptions.json` 例外逐项销号。
3. （P1）实例化单源：抽 `connectionFactory`，三处 `new Database` 收编；`contractVersion` 三处硬编码收进 registry；`artifact-truth.js:431` 的 `|| 1` 兜底改显式版本解析。
4. （P1）`knip.json:38` 的全 `core/**/*.js` entry 与动态 require 三处（`agent-tools/plugin-loader.js:152`、`learning.js:617`、`mcp/registry.js:305-335`）改显式静态注册表；Knip 保留面在清理后 `--update` 下调。
5. （P1）13 存量环按簇设里程碑，每消一簇下调基线一次；新增环保持红；CSS 13 plain 白名单逐件收缩。
6. （P1）行为测试替代源码扫描：`test/agent-runner-loop-orchestrator.test.mjs`、`test/loop-orchestrator-subdomains.test.mjs` 的行数/`includes` 断言换成事件与状态机断言；未登记测试全部进 impact-map 且 fail-closed。
7. （P2）`acceptance/block-118/corpus-doc-suggest.json:2284` 清陈旧语料；`provider-reliability.js:15-50` 的 CircuitBreaker 接线或删除。
8. （P2）补丁 vs 重构门禁：同一处第二次叠条件/flag/特例时，工作包必须先给 scoped 重构方案与行为基线，否则评审不批准再垫一层；重复缺陷第二次出现即转机械门禁并写映射。

**出口判据**：主链拆为行为可测单元；源码扫描契约清零或留明确理由；impact-map 覆盖全部测试；存量环 / Knip 保留面 / code-size 例外只减不增。

---

## §11 S5 · 性能与规模化（P2）

**目标**：从「有基线」升级为「长会话、长列表、大项目、启动全链都有持续预算和稳定门」。

**具体改进点**

1. （P2）`quality:perf` 连续 5 次 PASS 判据与采样日志；负测植入慢样本仍红；四场景绝对上限 + 相对容差逐场景复核。
2. （P2）冷启动五段分解：require / 迁移 / 后端 health / SPA 200 / CDP 页面各段可复跑读数，避免「后端绿但屏幕黑」；与 dev 栈三面齐就绪判据对齐。
3. （P2）每轮 `token_budget` 与 `computeContextBreakdown` 同源；工具定义 / 系统提示 / 消息 / 工具结果 / 输出预留五类占比可核对；超阈值自动裁剪并留事件。
4. （P2）重复压缩输入长度、模型调用次数、token 曲线实测，设「会话翻倍但单次摘要输入有界」断言。
5. （P2）DOM 预算按 S3 的 CDP 实测数据设机械上限与棘轮，长列表滚动帧率入证据。
6. （P2）listener / poller / socket / DB / 后台进程 teardown 全覆盖；全量测试不再因孤儿进程 SIGTERM。
7. （P2）token、cache、duration、模型归因按单次 attempt 记录；`ai_usage`、轨迹、ContextBudgetBar 同源，不允许「显示一套、请求一套」。
8. （P2）C-47 文件树复击惰性观察只在有可复现步骤后归因；分页、软上限、轮询收敛统一状态机。

**出口判据**：四场景连续 5 次 PASS；冷启动五段读数可复跑；20k 窗口自然长任务无 provider 400 与静默 fatal；全量测试完成且无孤儿进程。

---

## §12 S6 · 治理台账与证据运营（P2）

**目标**：让任何 Agent 换模型 / 换会话后都能恢复同一份真相，且证据不会随文档更新被悄悄升格。

**具体改进点**

1. （P2）coverage 单写入器：合并 `DOC-REGISTRY.json` 顶层 `documentCount` 与 `coverage.documentCount`，`docs-roll-index.mjs` 与 `docs-governance.mjs` 写同一字段；补计数一致性负测。
2. （P2）`docs-roll-index.mjs --check` 接入 `docs:check` 与 `closeout`；README 当月条目脚本化，跨月滚动后入口直链不切断。
3. （P2）active 槽位唯一：`state` / DOC-REGISTRY / roadmap / handoff 的 active Plan ID 与阶段一致；G0-LF 常驻态与「无 active」表述由治理批裁定，不任选对实现方便的一份。
4. （P2）AUDIT-LOG 自稳：`audit:compact` 保持 closeout 首步幂等；超长行拆到专项 plan 只留指针；旧 🟡 票按结论逐件 ✅ / retain-with-reason。
5. （P2）四账本同源生成器：能力地图 / 功能矩阵 / 货架矩阵 / UI 台账摘要由同一命令重建，人工改动判红；`shelf-matrix.json` 的 4 个 detour 按 bundle 状态、C-46 票状态、demo 差异自动复判。
6. （P2）证据生命周期：acceptance 文件统一记录 sourceCommit、platform、命令、生成时间、负测指针与 source/dependency digest；历史 PASS 只在 digest 一致时复用。
7. （P2）`resources/skills/manifest.json` 的 `sha256:null` 在构建期补齐或显式 `unavailable+reason`；`skills:check` 增 artifacts 形状校验。
8. （P2）每阶段收口同批回写 plan / registry / README / roadmap / handoff / AUDIT-LOG / UI 台账；未跑、跳过、复用、人眼 pending 一律如实标注。

**出口判据**：`docs:reconcile` 候选逐件复核、`docs:check` PASS；coverage 与 status 一致；无第二 active canonical；每阶段有 acceptance 目录、复跑命令、负测与交接笔录。

---

## §13 S7 · 真实任务终验（P3）

**目标**：把机械判据的「做完了」补齐为「做得好不好」的可复核证据。

**具体改进点**

1. （P3）8 任务套件连续 3 次 8/8、0 干预；T6 `TURING-9` 口令波动归因到稳定根因后再计入。
2. （P3）T7 去掉 `windowOverride=20000`，在真实默认窗口下触发压缩；20 项 FACT 全收。
3. （P3）`acceptance/block-356/results-v2final.json` 的 8 项 `humanEyePending` 与逐任务 `toolSelectJudge` / `artifactJudge` 按冻结判据表集中一次人工过目并落证据，Agent 不得代答。
4. （P3）真实 provider 长任务复跑一次，记录 attempt 级 token / 重试 / 压缩 / 终态证据；不外推 Provider 矩阵。
5. （P3）EAR ≥45%，新增证据全部由负测守住。
6. （P3）十一维按 §2 口径重新复评，每维附当次锚点指针；与本次复核并列呈现差值与逐条归因，跑完不回溯调参。

**出口判据**：机械绿、实机/DOM 绿、人眼绿、真实任务绿四类证据齐备且互不冒充；未达项如实呈报，不得写成 completed / verified。

---

## §14 发令与验收协议

### 14.1 发令顺序

```text
S0 发令 → 干净树全门复绿
  ↓
S1 发令 → 全 provider 主链与失败可见性收口
  ↓
S2 发令 → 执行准入与数据自证收口
  ↓
S3 发令 → 体验与人工实机腿收口
  ↓
S4 发令 → 架构拆分与测试有效性收口
  ↓
S5 发令 → 性能与规模化收口
  ↓
S6 发令 → 治理与证据运营收口
  ↓
S7 发令 → 真实任务终验
```

S1 / S2 都触及执行语义，必须串行；S3 / S4 若发现共享文件或 sharedBaselines，按 registry 三判据自动排队，不并行抢文件面。

### 14.2 每个正式工作包的最小 DoD

- 独立 plan：范围、非范围、依赖、风险、touchSurface、sharedBaselines、验收、完成语义。
- 红绿先行：新行为契约与缺陷修复先落失败测试再写最小实现；纯重构用拆前拆后同套绿作行为基线。
- 当次证据：命令输出、exit code、acceptance JSON、实机/视觉证据、负测、未覆盖范围。
- 门禁：`docs:check` + `ui:audit:check` + 定向 `test:changed` + 本阶段专项门禁 + `closeout`；干净树上只跑一次全量门禁。
- canonical 回写：registry、README、roadmap、handoff、AUDIT-LOG、UI 台账同批；未达证据不写 verified / completed。
- 收口报告：P0 修复清单、P1 留痕、外部/人工/环境边界、WIP 保留状态、下一步唯一建议。

### 14.3 明确不做

- 不新增功能域或工具族来充进度；不新增依赖。
- 不新建第二 executor、Job、Artifact、Workflow、项目状态、UI truth、DB 连接源、插件源解析器或评分器。
- 不为过门放宽 lint / types / knip / code-size / model-surface / domain-neutrality / perf / EAR 基线；重打必须显式留因和负测。
- 不把 DOM 断言、机械判据、进程 health 冒充视觉观感、人眼质量或真实任务成功。
- 不覆盖、暂存、删除或提交当前未知 WIP；不在兄弟仓授权前改 C-46；C-47 未复现归因前不猜测性修复。
- 不撤销 `workspace_exec` 默认放行裁决；不启动阶段跃迁，不外推 packaged / Provider / GA。

---

## §15 与既有 canonical 的关系与复跑命令

- 本蓝图是 `planned` 方向文件，不替代 `docs/next-steps-roadmap.md` 的当前立即任务，也不把任何阶段翻成 active。
- 事实基线优先序：当次门禁/命令输出 > Git/源码 > acceptance JSON > canonical 文档；本文件 §2/§3 的结论可被新的当次证据推翻，届时先更新受影响章节再执行阶段。
- 旧蓝图 `next-stage-optimization-blueprint-2026-11-06.md` 与 `Petri-Desktop-Holistic-Evaluation-2026-11-06.md` 保留为已完成程序与其评估的历史真相，本文件不改写其评分与收尾笔录。
- 发令后按治理规范分配正式工作包编号、登记 registry 与 AUDIT-LOG；本文件只保留阶段、目标、改进点、优先级与验收，不记录每日进度。
- 每阶段 acceptance 证据目录建议 `acceptance/post-nso-2026-11-06/stage-N/`，具体路径在正式 plan 中钉死。

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
npm run quality:knip:check
npm run quality:lint
npm run quality:types
npm run quality:perf
npm run test:changed:list && npm run test:changed
```

---

*本蓝图不设工作量上限，但设证据上限：任何没有当前证据的「完成」「通过」「可信」都不得写入收口报告。*
