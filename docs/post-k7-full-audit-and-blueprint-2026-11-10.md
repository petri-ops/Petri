---
capability: post-k7-full-audit-and-blueprint-2026-11-10
status: planned
goal: 以 2026-11-10 HEAD f9873243（post-H9 K0–K7 全收口后）为唯一事实基线，用七路只读源码实证 + 十九门当次机械取样，对十一维度做第五轮独立深度审计；逐项登记新发现与 K 项残留，转成分阶段 L0–L7 优化蓝图，每项带优先级、blocker 分类与可机械核验的验收标准；产出可独立执行的执行提示词。
acceptance:
  - 十一维度均有当前源码 file:line 锚点、逐项发现、严重度、修法与阶段归属，不重复 W/S/H/K 已闭合发现为"新发现"
  - 每阶段有目标、具体改进点（映射到发现 ID）、优先级、依赖、blocker 分类、出口判据与复跑命令
  - 门禁真值来自当次逐门取样，未取数/跳过/复用/在制 WIP 引起的红一律如实标注，不写通过
  - 本文件是 planned 多包程序文档（kind=living-plan），不占单包串行槽位；各 L 阶段发令时各自注册 work-package
  - 零产品代码改动、零触碰 10 项 untracked 用户资产与在制 CSS WIP；G0 开发期常态 · 不外推 packaged/Provider/GA
reopen: 源码、门禁读数、工作区 WIP、active 工作包或用户裁决变化后，先重跑 §1.2 十九门与受影响维度复核，再执行对应阶段
---

# 第五轮全量深度审计与下一阶段优化蓝图（2026-11-10 · post-K7）

> 用户发令：「对现有项目开展全面深度审计，覆盖功能完整性、性能表现、代码质量、可维护性、可扩展性、安全性、界面与交互体验、错误处理与边界情况、测试覆盖、文档完善度、依赖与架构合理性等维度，逐项列出发现的问题与细节，不设工作量上限。基于审计结果输出结构化蓝图计划……最后生成一份完整的执行提示词，使开发助手能依据蓝图独立完成全部优化任务，无需用户额外参与。」
> **定位**：第五轮方向蓝图。承接 W0–W7（NSO）、S0–S7、H0–H7、**K0–K7（BLOCK-396～403，2026-11-10 全部 completed）**。不重复旧发现、不回溯改写历史评分、不新建第二份当前状态真相。
> **形态**：`planned` 程序文档（`kind=living-plan`，多包并列，不占单包串行槽位）；每个 L 阶段发令时各自是正式 work-package，按单工作包串行纪律逐阶段收口，BLOCK 编号发令时按 `$petri-project-governance` 分配，本文不预占。
> **波次命名**：W → S → H → K → **L**。**阶段纪律**：G0 开发期常态 · 不外推 packaged/Provider/GA。
> **本轮动作**：只读核查（七路子代理 + 主代理终审复核）、当次十九门逐门取样、产出两份治理文档；未改产品代码、未提交、未暂存、未清理任何 WIP。

---

## §0 执行摘要

### 0.1 一句话结论

第四轮 K0–K7 把「判据校准 / 兑现度 / 体验 / 结构 / 证据」推到 19 门常态全绿、32 条缺口全终态；**第五轮的真实瓶颈不是「还缺什么」，而是三条被绿灯掩盖的结构性问题**：①**门禁本身在保护债务**（`k4-architecture.mjs` 把「巨型文件入册」「knip 收窄」判为违规、K6 把「删除 IPC env 豁免口」判为违规、perf 门 60–80% 宽门 + skipped 即绿 + 热栈冒充冷启动）；②**若干 P1 级安全与假成功断链仍在生产面**（MCP `skill_execute` 恒返回空成功、深链 MCP stdio `command` 无白名单、`terminal:open-shell` 命令注入、受信 origin 可被 env 注入、browser navigate 任意 scheme）；③**状态可信度失守**（真实 UI WIP 被 `git status` / `npm run state` 因 stat 缓存漏报，`ui:audit:check` 在"看似干净"的树上恒红；AUDIT-LOG 🔵 行与 registry 两层语义冲突）。因此本轮主线 = **L0 先修尺子与门（否则任何优化都会被门禁反锁或假绿放行）→ L1 安全 → L2 功能断链 → L3 错误语义 → L4 性能数据面 → L5 结构单源 → L6 体验可达性 → L7 总收口**。

### 0.2 本轮新增结论（相对 K7 终验）

1. **当次十九门逐门取样**：16 门静态/质量门中 **15 绿 1 红**；另 `gate:post-h9-contracts` 185 项全绿、`test:changed:list` exit 0、`quality:perf` 5/5 绿。**唯一红门 `ui:audit:check` exit=1**。
2. **红门根因是真实 WIP 且状态聚合器漏报**：`git diff --name-only HEAD` 与 `git --no-optional-locks status --porcelain` 显示 `frontend/src/pages/project-workspace.module.css` 有 **11 insertions / 9 deletions**（BLOCK-395 B-11 `.workspaceSessionInner` composes 顺序修正，未提交），而普通 `git status --short --branch` 与 `npm run state` **均不显示该 `M`**（stat 缓存陈旧，`git ls-files --eol` 为 `i/lf w/lf`，非换行漂移）。`isUiSurface` 命中该路径 → `WORKTREE_UI` 红。这不是门禁误判，也不是用户资产误判；但「恢复者以为树干净」是更危险的 P1。
3. **perf 门读数全面贴阈值仍判绿**：当次 `cold_start 818ms`（阈值 874）、`packaged_start 734ms`（773）、`long_conversation 36ms`（40）、`big_project_tree 20ms`（27）；K7 前读数约 547/21/471，**退化 30–70% 而门全绿**，因 `max(median×1.6, median+slack)` 与 min-of-2 采样。
4. **门禁反向锁死债务**（新发现，K 轮未系统识别）：`scripts/lib/post-h9-k4-architecture.mjs:186-189` 把「`loopOrchestratorInManifest !== false`」「`sizeFiles === 24`」「`knipFullEntryInWorkspace !== true`」判为违规，结论固定 `debt-unchanged-w5b-deferred`；`K-28` 同类（删除 IPC env 豁免口会破契约）。**改进方向即判红**。
5. **四类 P1 安全断链**（七路实证新登记）：`src/platform-compat.js:27-46` cwd 拼进 `osascript`/`cmd /k`；`src/main/install-deep-link-core.js:112-139` stdio `command` 只校验长度、mcp 分支无 `expected` 快照对账；`src/main/env-coordinator.js:243-249` 把 env `PETRI_TRUSTED_DESKTOP_ORIGINS` 无校验并入 CORS/IPC/权限三道门且空 Origin 一律放行；`frontend/src/lib/browser-url.ts:4` + `BrowserPanel.tsx:106-112,364-374` navigate 任意 scheme、iframe 无 `sandbox`。
6. **MCP `skill_execute` 假成功**（功能完整性最高优先）：`mcp/registry.js:272` 只注入 `{ registry }`，`skill-runtime.js:655-696` 走 `_runFallbackWorkflow` 且 11 个内置 Skill 的 `plugins.required` 全空 → 返回 `status:'complete'` 空产物；`:285` 仅以 `status==='failed'` 判 `isError` → 外部 MCP 客户端恒得「成功但零执行」。
7. **MCP 双 server 分裂**：`src/mcp-server.js:31` 只声明 `tools`，`core/petri-server/mcp/server.js:141-174` 才有 `resources/list`/`read`（`ide://projects`、`ide://git-status`），而 `package.json:10,30` 的 bin/script 只挂载前者 → 产品 MCP 入口资源面完全不可达。
8. **错误处理真静默集中在 SSE 与桥接层**：`events.js:113` 终态判定在 try 外（unhandledRejection + heartbeat 泄漏 + SSE 永不 end）；`:131-157` 500ms 无限静默轮询且因带注释绕过 `gate:silent-catch`；`scripts/silent-catch-ratchet.mjs:29` `SCAN_ROOTS=['core','src']` 完全不覆盖 `frontend/src`（真静默 8 处）。
9. **数据面与判据**：`ai-conversations.js:252-259` fork 全量 SELECT + 逐条 INSERT 无事务；`db/connection.js:79-96` 「Promise facade」伪异步 + `schema.js:18-23` `Atomics.wait` 同步阻塞最多 7s；`WorkspaceSummaryCard.tsx:684-692` 定时器 6→1 后未实现取模，30s 档被提到 5s（6×）、60s 档 12×。
10. **文档/台账双真相**：`test/impact-map.json` 实读 **366 规则 / 90 未映射**，第四轮蓝图仍写 365/120；`DOC-REGISTRY.json` 实读 **544/527**，蓝图写 528/511；`docs/pending-work-backlog.md:14` 自称「所有已知未完成项唯一 canonical」却停在 2026-10-31；`docs/AUDIT-LOG.md` 77.87KB > 50KB 建议阈，且行 72 的 🔵 `BLOCK-385 active` 与 `npm run state`「串行槽位空」冲突。
11. **证据边界不变**：真实任务 0/8（凭据/出网环境因）、22 条人眼项 `pending_human_eye`、ADMISSION/FK 属 U 类未裁决——三类均不得由 Agent 代答或冒充 verified。

### 0.3 十一维复核（第五轮独立估值，不回溯改历史分）

| 维度 | K7 终验 | **本次复核** | 目标 | 归因 |
| --- | ---: | ---: | ---: | --- |
| 功能完整性 | 4.4 | **4.2** | 4.7 | −0.2。新登记 MCP 假成功 + 双 server 分裂两个 P1 断链（外部 MCP 面），16 域 facade / 168 通道 / 主链未动 |
| 性能表现 | 3.9 | **3.6** | 4.5 | −0.3。perf 门读数退化 30–70% 仍全绿、`packaged_start` skipped 即绿、EAR 棘轮未实现、fork 无事务、伪异步 facade |
| 代码质量 | 4.0 | **3.8** | 4.5 | −0.2。门禁反向锁死债务、eslint 抑制台账无机械对账、源码扫描棘轮仅覆盖 4/45 文件、2429 warnings 且 +55 |
| 可维护性 | 3.7 | **3.6** | 4.4 | −0.1。CSS 3200+ 行 / ≥7 个 >1000 行文件不入尺寸门、resolveCore 四处镜像、16 例外行数反向增长 |
| 可扩展性 | 4.5 | **4.4** | 4.8 | −0.1。插件源装配仍 3 处、工具四表 + 审批元数据无统一扩展点、三矩阵三生成器 |
| 安全性 | 4.3 | **3.9** | 4.6 | −0.4。四项 P1 新断链（注入 ×2 / 信任源注入 / navigate 任意 scheme）+ fail-open 权限装配 + transcript 明文；四项 webPreferences 基线未见回归 |
| 界面与交互体验 | 4.1 | **4.0** | 4.6 | −0.1。CommandPalette 无 focus trap、ThemeProvider 读侧静默回正、UI 台账 4 条 verified 冒认、theme 门只扫 .css |
| 错误处理与边界情况 | 3.9 | **3.6** | 4.6 | −0.3。SSE 无界静默轮询 + 未捕获终态判定、桥接层塌缩为空、silent-catch 不覆盖 frontend、三套 IPC 失败形状 |
| 测试覆盖 | 4.4 | **4.1** | 4.7 | −0.3。`test-affected.mjs` exit 2 非 fail-closed（unknown 生产路径零测试）、185 契约全绿但源码扫描断言 ≥62 处不受约束 |
| 文档完善度 | 4.7 | **4.5** | 4.8 | −0.2。365/120 与 528/511 双读数、backlog 与 registry 定性冲突、AUDIT-LOG 超阈与 🔵 两层语义冲突 |
| 依赖与架构合理性 | 4.0 | **3.9** | 4.6 | −0.1。typescript 双版本 + 三树重复声明 + engines 缺失、FK OFF/ON 分裂未裁决、R2 注释与实现不符 |

**综合**：**零升十一降**（口径：发现更多真实 P1 断链与判据失真，按「无证据扣分而不是给分」逐维下调；不回溯修改任何历史分数）。达「每维 ≥4.4」出口由 K7 的 5/11 降为 **2/11**（功能 4.2 已不达标，仅文档 4.5、可扩展 4.4）。差距集中在**安全 3.9 / 性能 3.6 / 错误处理 3.6 / 可维护性 3.6 / 代码质量 3.8**，全部是「尺子与结构」而非「功能数量」。

---

## §1 事实基线与证据边界

### 1.1 四轴口径

| 轴 | 事实 |
| --- | --- |
| 已交付基线 | `main` HEAD `f9873243`（BLOCK-403 总收口状态同步）；K0–K7 八包 completed，32 条缺口全终态零 in_progress |
| 在制 WIP（零触碰） | ①**真实未提交 M**：`frontend/src/pages/project-workspace.module.css` 11+/9−（BLOCK-395 B-11 修正）；②**10 类 untracked 用户资产/临时目录**：`assets/`(2)、`docs/pelican-bicycle.html`、`docs/post-h9-optimization-blueprint-2026-11-10.md`（第四轮蓝图，registry 已 planned）、`model3d/enclosure-*.scene3d.json`、`petri-logo-concepts.miora` + `_assets/`(29 png)、`scripts/backfill-artifact-chain.mjs`、`tmp-block342-live/`(7)、`tmp-review/demo.svg`、`acceptance/nso-2026-11-06/.../summary-1793978091259.json` |
| 当前 active | 层 1 串行槽位：**空**；层 2 常驻计划：`G0-LF`（`docs/g0-living-foundation-plan.md`）；planned 队列 3 项。`AUDIT-LOG` 无 🔴/🟢 未决（但 🔵 行存在两层语义冲突，见 L-90） |
| 本轮动作 | 七路只读源码实证（含主代理对冲突项的终审复核）+ 十九门逐门取样 + 两份治理文档；未改产品代码、未提交、未暂存、未清理 WIP、未跑 `closeout` 聚合门 |
| 证据等级 | 当次命令输出 > Git/源码 > acceptance JSON > canonical 文档；历史「全绿」不自动复用 |

### 1.2 当次机械门禁真值（2026-11-10 23:55，逐门串行取样，HEAD `f9873243`）

| 门禁 | 结果 | 读数 |
| --- | --- | --- |
| `docs:check` | PASS | **544 registered**；`[audit-ledger] 78KB > 50KB` 建议级提示 |
| `ui:audit:check` | **FAIL (1)** | `WORKTREE_UI`：真实 CSS WIP 未同步 `docs/ui-productization-audit.md`；且 `git status`/`state` 漏报该 M |
| `hygiene:check` | PASS | 无死链/CRLF/控制字节/桥退化；untracked 16 项仅列出 |
| `quality:secret` | PASS | 生产面 0；3 类 fixture 豁免在册 |
| `quality:types` | PASS | `tsc --noEmit` 0 error（incremental） |
| `quality:lint` | PASS | **0 errors / 2429 warnings**（K7 前 2374–2376，warnings +55，无只减锚） |
| `gate:code-size` | PASS | 24 文件 23511 行 = 基线；生效例外 16；预算 700 行（盲区见 L-36） |
| `gate:css-modules` | PASS | plain CSS 11，白名单 11 |
| `gate:silent-catch` | PASS | 92 文件 / 395 处（扫描根仅 `core`/`src`，见 L-18） |
| `gate:user-assets` | PASS | 9 项受保护路径未入库（`tracked=6160 staged=0`） |
| `gate:version-parity` | PASS | 10 处跨语言字面量一致 |
| `skills:check` | PASS | 11 内置（2 `skill.json` + 9 `SKILL.md`）+ 3 领域包 |
| `quality:arch` | PASS | R1–R5 无违规；cruise 全新 |
| `gate:arch-cycles` | PASS | 12 存量环在册，无新环 |
| `quality:knip:check` | PASS | 保留面 330 键冻结 |
| `quality:ear` | PASS | **981/2198 = 44.6%**（阈值 40%，manifest 43.3%；**45% 目标未达**） |
| `gate:post-h9-contracts` | PASS | 11 契约文件 / **185 项全绿**，fail/skip/todo 均 0，1.67s |
| `test:changed:list` | PASS | exit 0，`unknown` 归入 `tmp-review-scratch` 等规则 |
| `quality:perf` | PASS | 连续 5/5 绿；`cold_start 818/874`、`packaged_start 734/773`、`long_conversation 36/40`、`big_project_tree 20/27`（全部贴阈值） |

> 本表是**逐门取样**，不是 `npm run closeout` 聚合结果。**未取数**：`closeout` / `closeout:full`（会触发 `audit:compact` 写盘，且工作区存在他方 WIP）、`test:changed --run`、`test:all:workspace`、`quality:surface`（刷新两份 generated 产物）。一律不写通过、不写全绿。
> **红门处置边界**：`ui:audit:check` 属他方在制 UI WIP 未同步台账，其 owner 收口时清零；本蓝图不代改台账、不删 WIP、不放宽任何基线。若干净树上重跑仍红，才升级为门禁缺陷走 L0。

### 1.3 既有评估链与不重复原则

- 事实基线链：`Petri-Desktop-Holistic-Evaluation-2026-11-06.md` → W0–W7 → S0–S7 → H0–H7 → BLOCK-393/394 → **K0–K7（BLOCK-396～403）** → 本文（L0–L7）。
- **已闭合、不再列为改进点**：errorsAsRejections 全链、42 原因码、静默 catch 三分法、四事件前端投影、分页 hasMore/nextCursor、复合索引 + rowid 负测、具名上限常量收编、PiP 四项安全基线 + 窗口名单门、DOM 阈值纯函数门、严格证据元数据门、源码扫描只减棘轮（4 文件）、三矩阵同源对账、165 通道第一批分诊、判据三作废三重立、九组口径单源 JSON、32 条缺口全终态、goals/viewer 接线防回退契约。
- **AUDIT-LOG 中用户已裁决的延期/资格类 🟡 项**（RS-P7、G0 视觉证据、Windows 签名、i18n、capability-provisioning）按既有裁决态保留，不重复登记、不推动状态变化。
- **主代理终审更正**：子代理报告中「`src/database/branch-db.js:36-40` 是 DB 路径第二入口」为**过时注释误读**——实读 `:34-44` 已委托 `resolveDbPath(process.env)`，`db-connection-policy.js:6-12` 列三消费方一致；本轮只登记「注释未更新」（L-41，Minor），不登记为第二真相。

### 1.4 证据等级与不可外推边界

五类证据不得互相冒充：①行为/契约测试；②机械门禁；③DOM 与 CDP 实机；④人眼观感；⑤真实任务成功。`closeout` 绿 ≠ UI 在场；`quality:perf` 毫秒读数 ≠ 用户观感；`verdict=measured` ≠ 视觉绿；185 契约全绿 ≠ 生产安全边界成立（本轮四项 P1 安全断链恰在契约覆盖之外）。凡 `verified` 必须有对应类别的当前证据。

---

## §2 十一维度逐项发现

> 每条三要素：`file:line` 锚点 + 现象（源码原文/当次读数）+ 建议修法。严重度：P1 = 契约/正确性/安全/当前门真红；P2 = 可靠性/性能/可维护性实质影响；Minor = 风格/命名/清理。⏳ = 证据不足待验证，不定性。blocker：`A` Agent 可做 · `L` 需实机/CDP · `E` 需人眼 · `U` 需用户裁决 · `V` 凭据/出网/平台 · `W` 在制 WIP 归属。

### 2.1 功能完整性（4.2 / 5）— 11 条

| ID | 级 | 锚点 | 现象与影响 | 建议修法 | blocker |
| --- | --- | --- | --- | --- | --- |
| L-01 | **P1** | `core/petri-server/mcp/registry.js:272,285`；`core/shared-backend/skill-runtime.js:655-696` | `createRuntime(skill,{ registry })` 未注入 workflowRuntime/pluginManager → 走 `_runFallbackWorkflow`；11 个内置 Skill 的 `plugins.required` 全空 → 返回 `status:'complete'`、空 artifacts；`isError: result.status === 'failed'` 恒 false。**外部 MCP 客户端执行任何内置 Skill 得到「成功但零执行」** | MCP 侧复用 SkillsSDK 同源注入执行体；无执行后端时 fail-closed 返回 `isError:true` + `no_execution_backend`；红绿先行补「空产物必红」负测 | A |
| L-02 | **P1** | `src/mcp-server.js:31,35,38`；`core/petri-server/mcp/server.js:141-174,195`；`package.json:10,30` | 产品 MCP 入口 `capabilities:{tools:{}}`，只注册 ListTools/CallTool；`listIdeMcpResources()`/`readIdeMcpResource()`（registry.js:482-499,953-954）仅被**未挂载**的 legacy server 消费 → `ide://projects`、`ide://git-status` 在产品入口完全不可达；prompts 声明 `{}` 却恒返回空（:175） | 在 `src/mcp-server.js` 注册 ListResources/ReadResource + 声明 capabilities.resources，或收敛为单一 server 实现并下线 legacy；补协议握手契约测 | A |
| L-03 | P2 | `frontend/src/components/work-surface/ResultsSurface.tsx:161`；`viewerRegistry.ts:71`；`resultMode.ts:55,73` | 唯一 `<ResultStudioCanvas>` 调用不传 `canCompare` → `ResultStudioSurface.tsx:24` 默认 false → `compare` 模式永不进入、`mode=compare` 静默回退；而 `table` adapter 明写 `canCompare:true`【K 项残留：viewer 能力位】 | 调用方按 `resolveResultViewer(...).canCompare` 传值，或把 table 声明诚实改 false 并同步契约测试 | A |
| L-04 | P2 | `src/ipc/auto-update.js:21-34`；`src/preload.js:466-495` | 非 darwin / dev / 未打包时 check→`auto-update disabled`、download/install→`ok:false`，5 个 `updater:*` 事件通道永不触发，而 preload 与前端更新 UI 仍在；Windows/Linux 打包版「可点但恒失败」 | 实现跨平台 updater，或按平台隐藏更新入口并给明确文案；通道表标注可用平台 | A |
| L-05 | P2 | `core/petri-server/agent-tools/tool-defs/skill.js:25`；`skill-registry.js:23-27`；`mcp/registry.js:70-91` | `source.enum=['built-in','installed']`，真值 `SOURCE_PRIORITY` 含 `'pack'`；MCP 侧已派生含 pack，agent 主链 `skill_discover` 无法按领域包过滤，模型按真实来源传参会被 schema 拒 | enum 由 `SOURCE_PRIORITY` 派生（同源）+ 双表一致性测试 | A |
| L-06 | P2 ⏳ | `core/petri-server/routes/tools-platform.js:312,316`；`helpers/tools-assets.js:24` | `/api/tools/public-demo/:toolId`、`/public-file/:jobId/:filename` 无静态可验证前端调用方（唯一 URL 生产点是后端运行时拼接）；是否经工具卡 demo 动态消费待验证 | 补端到端消费断言；确认无用则连同 `handlePublicDemo`/`handlePublicFile` 退役 | A |
| L-07 | P2 | `src/preload.js:99`；`src/ipc/startup-timeline.js:51`；`frontend/src/hooks/useStartupTimeline.ts:39-58` | `startup:marks` handler + 包装齐全但 renderer 零 `.marks()` 调用；实际消费只在 3 个验收脚本的 CDP `evalJs`（源码自注「无业务消费方」） | 诊断面板补只读消费入口，或通道表标「验收/flow 专用」不计产品能力 | A |
| L-08 | Minor | `src/preload.js:293,364-366`；`src/ipc/plugin.js:54`；`src/ipc/telemetry.js:16` | `contentPlugins.{list,listDocs,read}` + `telemetry.report` 4 通道在 `frontend/src` 仅 `lib/electron.d.ts:441` 类型声明，无组件调用 | 补消费方或标预留并从产品通道清单降级 | A |
| L-09 | Minor | `src/preload.js:232,360`；`src/ipc/desktop-shell.js:25,372-375` | `previewQuitSummary`/`crashSimulate` 用 `testOnly(...)` 守卫，产品 UI 无入口，调用全在 dev-verify flows；纯验收通道被当成产品 IPC 登记 | `channels.js` 增 `testOnly` 标记，通道清单/契约测试区分「验收通道」与「产品通道」 | A |
| L-10 | Minor | `core/petri-server/mcp/server.js:175,193-197` | `prompts/list` 恒空但 initialize 声明 `prompts:{}`；与 L-02 同源双 server 分裂 | 随 server 收敛移除声明或补真实实现 | A |
| L-11 | Minor | `core/petri-server/agent-tools/tool-defs.js:6`；`tool-defs/agent-orchestration.js:208` | 头注写「9 域 / 勿直接 require 域文件」，实际 `domainModules` 16 域且存在域内组合 require（`...require('./goals')`）→ 机械审计曾把 goals.js 误报为孤儿（block-346 记录） | 头注更新为 16 域 + 说明域内组合 require 合法性（零行为改动） | A |

**已核对无问题**：17 个域文件全部被 require；`TOOL_METADATA` 覆盖 `CONTRACTS` 全部工具名；`buildToolRegistry` 三方校验；channels/preload/handler 无集合差异；automation 8 端点全部有前端消费；Skill 双格式归一字段齐备；goals/viewer 接线无回归。

### 2.2 性能表现（3.6 / 5）— 12 条

| ID | 级 | 锚点 | 现象与影响 | 建议修法 | blocker |
| --- | --- | --- | --- | --- | --- |
| L-24 | **P1** | `core/petri-server/routes/ai-conversations.js:252-259` | fork `'SELECT ... FROM copilot_messages WHERE conversation_id=?'` 无 LIMIT + `for` 逐条 `stmt.run()` 无 `db.transaction`【K-11 残留】→ 1000 条消息 = 1000 次 WAL commit/fsync + 1000 次 uuid，中途失败留半截会话 | `db.transaction` 包整段 + 单条 `INSERT ... SELECT`；`untilIndex` 下推 SQL `LIMIT`；红绿先行补事务回滚负测 | A |
| L-25 | **P1** | `core/petri-server/db/connection.js:79-96`；`db/schema.js:18-23`；`routes/ai-conversations.js:5` | `createAsyncDatabaseFacade` 的 `async run/get/all` 只是 `return stmt.run(...)`，无 worker/队列；`await` 只把同步阻塞挪进微任务，单 event loop 被慢查询卡住时 SSE 心跳与 health 一起停摆。`BUSY_RETRY_DELAYS_MS=[2000,5000]` 用 `Atomics.wait` 同步阻塞最多 7s | 热路径读写迁 worker_threads（真异步），或接口/注释显式标注同步契约；`sleepSync` 改非阻塞退避 | A |
| L-26 | **P1** | `routes/ai-agent/events.js:130-157,80`；`helpers/agent-task-event-limits.js:15` | 每 SSE 连接 500ms 双同步查询 ×并发数；`findFallbackChild` 对每个失败终态执行 `getAgentTaskEventsSince(taskId,0,1000000)`（具名常量只把「无上限全量回放」合法化），历史 `task_events` 236,087 行 / delta 98.5% → 一次失败终态把数万条 delta 反序列化进内存 | `findFallbackChild` 改倒序 `WHERE event_type='model_fallback' ORDER BY seq DESC LIMIT 1`；SSE 改事件驱动 wakeup + 有界兜底；全量回放点设真实业务上限 | A |
| L-27 | **P1** | `scripts/lib/evals-harness.mjs:117,129`；`block350-perf-collect.mjs:35,75,277`；`block350-perf-gate.mjs:38-42` | `bootstrapDb` 在 spawn 后端前同步跑完全部 migrations；同机同进程连跑 + `sleep(800)` + OS 页缓存热 = **热栈冒充冷启动**；`GATE ? RUNS=2` 且取 `Math.min(...samples)`；阈值 `max(median×1.6, median+slack)` → ≤60% 持续退化仍绿。K-03 已判「热栈 5 轮≠冷启动×5」作废，但本常驻门未随之重立 | 场景改名 `warm_backend_spawn` + 单列真冷启动腿（带 `stageCoverage`）；gate 采样改中位/最差轮；容差收紧到可复现噪声带；加「有活栈才断言」条件与植入慢样本负测 | A + L |
| L-28 | **P1** | `scripts/block350-perf-collect.mjs:173-179,248-253`；`block350-perf-gate.mjs:28-30,49` | 无 `dist/mac-arm64/*.app` 或采样全失败时写 `skipped:true`，gate 对 skipped 直接 `status:'skipped'`，`ok: rows.every(r=>r.status!=='red')` → **缺样本即绿**，最重的打包态场景在未打包树恒不参与判定 | skipped 计入「未覆盖」并默认判红（或 `PETRI_ALLOW_SKIP=1` 才放行）；evidence 强制记录 skipped 数 | A |
| L-29 | P2 | `scripts/block351-ear.mjs:10,19,38,99`；`scripts/lib/post-h9-k5-perf-matrix.mjs:83-85,98-100` | 头注宣称「EAR ≥ manifest.totals.earPct 棘轮只进不退」，实现是硬编码 `EAR_THRESHOLD=40`，manifest 值只打印不参与判定；perf 矩阵只做静态正则「源码里写了某字样」→ EAR 43.2%→40.1% 门仍绿，删掉阈值比较也能过 | `validateManifest` 增 `earNow >= manifest.totals.earPct`；矩阵补动态负测（植入慢样本必红） | A |
| L-30 | P2 | `block350-perf-collect.mjs:9,147-153,161`；`test/perf-baseline.json:2-8`；`scripts/post-s7-dom-budget-live.cjs:36-46` | 头注宣称 big_project_tree 测 `tree+workspace_search`，实际只跑 3 次 tree 分页读；`convs-400/800` 两档因服务端分页与 100 档同读数；基线冻于 2026-11-04、host 固定，`coreSha` 只 hash `server.js` 一个文件，gate 不校验 host/源码 → 换机型/改热路径文件后基线不失效 | 统一场景文档与实测 SQL；去掉无区分力档位或改断言「截断生效」；gate 启动校验 `host.platform/cpus` 与覆盖全部热路径文件的 `coreSha` | A |
| L-31 | P2 | `routes/ai-conversations.js:153,156-159,186`；`helpers/conversations.js:42,50` | messages 每页 `COUNT(*) ... WHERE rowid < ?`（索引不含 rowid 伪列 = 每页回表递增扫描，20 页滚动 = O(n²)）；每页最多 500 条逐条 `JSON.parse(meta_json)`；export `SELECT ... ORDER BY rowid` 无 LIMIT。三条路径**都不在** perf 四场景内 | `windowOffset` 改游标增量计数 / 维护 `message_count`；`meta` 解析下沉消费端；export 流式分块；export/fork 加入 perf 场景 | A |
| L-32 | P2 | `frontend/src/components/workspace-panels/WorkspaceSummaryCard.tsx:684-692,722,760,796` | 注释宣称「单 interval 驱动 tick，各 hook 按周期取模（30s=6 拍 / 60s=12 拍）」，实测 `tickMs=5000` 且 26 处 `tick` 出现中**无任何 `tick % N`**，6 个 useEffect 依赖一律 `[..., tick]` → 30s 档提频 6×、60s 档 12×，定时器合并反而把请求量从 ~53 抬到 ~72 次/min | 对应 hook 内加 `if (tick % 6 !== 0) return;` / `%12`；补测试断言 30s/60s 档请求间隔 | A |
| L-33 | P2 | `frontend/src/components/copilot/SimpleChat.tsx:1546`；`LeftPanel.tsx:373,465,514,689,697`；`ResultsLibrary.tsx:59` | `displayMessages.map` 仍全量建 DOM（`React.memo` 只挡流式 tick 重渲）；cv A/B 实测 0.7ms vs 0.7ms 已回滚；`block350-perf-gate.mjs:112` 自认「DOM 节点数与帧率需 CDP 腿」但无门 | 窗口化（自绘 `useScrollGuard` + 首尾锚定，不新增依赖）；CDP 节点数/帧间隔作独立常驻门 | A + L |
| L-34 | P2 | `frontend/vite.config.ts:223-230`；`frontend/package.json:9`；`frontend/src/pages/project-workspace.module.css`（**172.82 KB**） | `manualChunks` 只拆 `vendor-react`，无 `chunkSizeWarningLimit`、无产物体积/构建耗时断言；`css-modules-ratchet` 只比路径白名单，`code-size-ledger` MANIFEST 无 `.css` → 单页 CSS 继续膨胀无人拦截 | `.module.css` 设 KB 棘轮（或并入尺寸门字节维度）；`vite build --json` 产物体积与耗时上限门；按路由拆 CSS chunk | A |
| L-35 | Minor ⏳ | `ThemeProvider.tsx:187`；`useMcpServers.ts:210`；`KnowledgeSpacePanel.tsx:61`；`ToolActivityList.tsx:549,716` | `frontend/src/**/*.tsx` 约 20 个真实定时器，高频档 1–2.5s 在多面板同时挂载时构成常驻请求底盘；cleanup 静态抽查对得上，但后台/隐藏窗口节流未动态验证 | 高频档统一挂 `document.visibilityState` 门 + 共享 scheduler | A + L |

**已核对无问题**：会话列表 `LIMIT 101` + `hasMore/nextCursor` 且无每页全表 COUNT；复合索引 + `EXPLAIN QUERY PLAN` 命中 + rowid 负测；`task_events` 30 天 retention + `.unref()`；App.tsx 11 个 `lazy()` + Suspense；perf 门「无当次样本即红」「连续 5 次」「最差轮为准」「证据 opt-in 且默认不写盘」四类判据确实生效。

### 2.3 代码质量 / 可维护性 / 可扩展性（3.6–4.4 / 5）— 14 条

| ID | 级 | 锚点 | 现象与影响 | 建议修法 | blocker |
| --- | --- | --- | --- | --- | --- |
| L-36 | **P1** | `scripts/code-size-ledger.mjs:45-70,125`；`acceptance/block-92/size-baseline.json` | MANIFEST 仅 24 项且全为 `.js/.ts/.tsx`；实测 `project-workspace.module.css` >3200 行、`loop-orchestrator.js` 1579、`RightFileTree.tsx`/`SvgEditorViewer.module.css`/`helpers/scene3d.js`/`skill-schema.js`/`cohort-package.js` 各 ≥1000 行，另 `scientific-replay-package.js` 942、`result-studio-contracts.js` 721、`artifact-profiles.js` 707 均超 `BUDGET_LINES=700` 却未登记；`evaluateGate` 只遍历 `current.files` → 盲区再增长也不判红，CSS 债零覆盖 | >700 行生产文件（含 `*.module.css`）全量入册，或新增「未登记超预算文件」fail-closed 发现器；入册前先解 L-37 的反向门禁 | A |
| L-37 | **P1** | `scripts/lib/post-h9-k4-architecture.mjs:186-190` | `if (a.loopOrchestratorInManifest !== false) issues.push('K-18: …独立锚设计被破坏')`、`if (!(a.loopOrchestratorLines===1579 && a.sizeFiles===24)) 判红`、`if (a.knipFullEntryInWorkspace !== true) 判红`，结论固定 `debt-unchanged-w5b-deferred` → **真正入册/拆分/收窄 knip entry 都判违规，「债务被门禁保护」** | 「不入册/全量 entry/固定行数」类断言改读数型记录（只记不改判）；清偿路径走只减棘轮 + 篡改负测；同步修订 K-18/K-22 契约 | A |
| L-38 | **P1** | `src/main/core-utils.js:89-111`；`src/ipc/terminal.js:37-38`；`src/ipc/harness-capabilities.js:16-29`；`src/ipc/ai-settings.js:10,18-26`；`src/main/backend-proc-manager.js:48-61`；`src/migration-runner.js:33` | 除单源外至少 4 份自认 `resolveCore mirror / duplicated here`，`core-utils.js:54` 记过一次修错（`".."` 少一层）→ dev/packaged 根路径算法分叉，修一处打包态找不到 `core/`；`test/post-s7-h9-structural-gates.test.mjs:75` 单源防回退契约未覆盖此面 | 四处统一 `require('../main/core-utils').resolveCore`，migration-runner 接单源；补「除 core-utils 外不得定义 `resolveCore*`」源码契约 + 负测 | A |
| L-39 | **P1** | `agent-tools/tool-metadata.js:23-189`；`agent-tools/registry.js:306-458`；`docs/pending-work-backlog.md:213` | `TOOL_METADATA`（`needsApproval/riskLevel/timeoutMs`）与 `CONTRACTS`（`riskTier/resources/estimatedDurationMs/cancellable`）字段语义重叠；第四轮蓝图 `:182,399` 要求「双表合一或同一生成器」，backlog 却断言「BLOCK-233 已清偿；职责分离非重复」→ **文档终态互相矛盾**，新增工具须跨表登记且无一致性门 | 单一 schema 生成两视图 + 跨表一致性锚与负测；统一文档定性（以 registry 为准） | A |
| L-40 | **P1** | `eslint.config.mjs:1-112`；`package.json:238`；`scripts/post-s7-hygiene-gates.mjs:144`；`scripts/check-ui-productization-audit.mjs:175,179` | flat config 全文无 `suppressions`，`quality:lint` 仅 `eslint . --cache`；`eslint-suppressions.json`（100 文件 / 120 条规则 / 191 处）是**纯人工台账**，B-31 `evaluateLintRatchet` 只比较数字 → 手工下调 count 即可显绿，锁的是账本不是代码 | 由 `eslint -f json` 生成/校验台账并 diff，禁止裸改 count；新增违规仍 fail-closed | A |
| L-41 | Minor | `src/database/branch-db.js:34-44` | 注释仍自述「不认 `PETRI_DB_PATH`、与 resolveDbPath 形成两套入口」，实际已委托 `resolveDbPath(process.env)`（主代理终审更正：**不是第二真相**）→ 误导后续审计 | 只更新注释表述（零行为改动） | A |
| L-42 | P2 | `core/petri-server/server.js:79,108-120`；`mcp/registry.js:357-384`；`agent-tools/plugin-loader.js:750-770`；`scripts/lib/post-h9-k4-architecture.mjs:167-168` | 解析面单源已兑现（唯一 `resolveDefaultPluginSources`），但**装配面三处**各自 `loadFromSourcesArray([...])` / `loadPluginsFromSources(...)`；`ownArrays !== 2` 即判红 → 新增插件源仍须同步改两处数组 + loader 默认值，且门禁按固定计数而非漂移检测 | 收敛为单一 `loadPlugins(sourcePlan)`；`ownArrays` 断言改漂移检测 | A |
| L-43 | P2 | `scripts/lib/post-h9-k4-architecture.mjs:15-20,127-138`；`acceptance/post-h9-2026-11-10/k4/k4-source-scan-baseline.json:6-27`；`test/**` | 源码扫描只减棘轮仅冻结 4 文件 / 21 处（includes 13 / srcMatch 3 / lineAnchor 5）；实测全库 **45 个测试文件约 129 处**（另口径 `src.includes(` ≥62、`readFileSync` ≥844），样例 `test/block135-retry-policy.test.mjs:109-137`、`test/agent-runner-loop-orchestrator.test.mjs:46-88` 仍逐行断源码字面量 → 41 个文件新增扫描断言不受约束，且无法抓行为回归 | 冻结清单扩为全库命中文件并重打基线，或新增「全库 includes/行数锚总数只减」第二棘轮（含负测）；按 K-20 逐族换事件/状态机/错误码断言 | A |
| L-44 | P2 | `knip.json:41`；`scripts/lib/post-h9-k4-architecture.mjs:97,189` | `workspaces["."].entry` 含 `core/**/*.js` 全量入口 → core 下模块全视为已引用，330 键是**上界不是精确债**；动态 require 三处 `plugin-loader.js:152`、`learning.js:617`、`mcp/registry.js:305-335` + `src/` 49 处拼接 require 无法判死导出；反向门禁把「收窄 entry」判红 | 收窄 entry 到真实入口、动态点改静态注册表，再 `--update` 下调基线（须与 L-37 同批） | A |
| L-45 | P2 | `test/impact-map.json`；`test/impact-map-coverage-baseline.json:6-95`；`docs/post-h9-optimization-blueprint-2026-11-10.md:184,243,305,400` | 实读 **366 规则 / 90 未映射**，蓝图仍写 365/120 且 K-21 出口判据按 120 推进；同蓝图 `:58` 的 528/511 滞后于 `DOC-REGISTRY.json:12-14` 的 **544/527** → 文档与机械判据并存两个真相 | 由单一读数生成器同时输出规则数/未映射数到文档与门禁；蓝图为受保护未跟踪文件**不改原件**，在总报告/registry 加「以 JSON 为准：366/90、544/527」并作废旧表述 | A |
| L-46 | P2 | `acceptance/block-92/size-exceptions.json:23-134` | 16 条生效例外中 15 条 `expires=2026-12-31`、1 条 `2026-11-30`，15 条 reason 逐字重复「BLOCK-92 遗留巨型文件，Wave 拆分进行中」；`linesAtGrant` 与实测对比多数**反向增长**（SimpleChat 1653→2089、tools-executor 1858→2080、project-workspace 1052→1221、db.js 1476→1526、git-adapter 1253→1396）→ 白名单冻结的是路径不是行数，例外实质是常驻续期通道 | 每次续期附「下降行数」判据或按 W5b 排期硬性下降；到期前 30 天预警 | A |
| L-47 | P2 | `src/ipc/channels.js:3-8`；`agent-tools/index.js:108-110`；`helpers/tool-approval-policy.js`；`helpers/approval-request-store.js` | 新增一个 IPC 通道至少改 4–5 处（表/preload/handler/双向契约/impact-map）；新增工具要 `TOOL_DEFS` + `CONTRACTS` + `TOOL_METADATA` + `index.js` 导出四表；审批元数据分散四处 → 无「注册表 + 单入口 + 审批元数据」统一扩展点，跨表漏登记不判红 | 单一工具声明文件生成四表并附审批元数据校验门 | A |
| L-48 | P2 | `scripts/functional-surface-audit.mjs:30-31,420-424`；`scripts/block357-capability-map.mjs:20,61`；`scripts/block352-shelf-audit.mjs:17`；`scripts/post-s7-matrix-parity-gate.mjs:3-15` | 三份矩阵三个生成器；parity 门自述 shelf 需活栈「不能串进 closeout」（无栈必红 = fail-open 陷阱）只做同源校验；零消费端点检测是业务段子串启发式、路由正则只数 `app.(get|post|...)`、无 `router.*` / 动态挂载兜底 | 抽纯函数生成器三份共用，实机脚本只喂数据；补 `router.*` 扫描 + 消费方检测可信度负测 | A |
| L-49 | Minor | `eslint.config.mjs:100`；`ResultCardRenderer.test.tsx`(16)、`lib/selectionBus.test.ts`(12)、`selectionReferences.test.ts`(10) 等 | 类型逃逸最集中 5 文件全在测试面；生产面 `any` 最高仅 `extraRenderers.tsx` 5；`@ts-expect-error` 全仓 3 处、`@ts-ignore` 0；`no-explicit-any` 设 warn 且不进 `eslint-suppressions` 台账（120 条无一为此规则） | warn 计数纳入 B-31 分域棘轮，测试面优先替换 | A |

**已核对无问题**：内联样式债冻结 55 颜色 + 5 zIndex 逐字一致且无新增；源码扫描 4 文件冻结 + 篡改负测在位；插件源解析面单源未回退；typescript 三树漂移只读检出（不判红不改版本）；`scripts/test-affected.mjs:96-101` 重复 rule id 即 throw；`eslint-suppressions.json` 100 文件 / 120 条与分域基线 production 154 / test 36 / scripts 1 吻合。

### 2.4 安全性（3.9 / 5）— 12 条

| ID | 级 | 锚点 | 现象与影响 | 建议修法 | blocker |
| --- | --- | --- | --- | --- | --- |
| L-50 | **P1** | `src/platform-compat.js:27-46`；`src/ipc/terminal.js:141-147`；`src/preload.js:380` | `getOpenShellPlan(cwd)` 把 `targetPath` 直接拼进 `osascript -e 'tell application "Terminal" to do script "cd \"${escaped}\"; clear"'`（只转义 `\` 与 `"`）与 `cmd /c start cmd /k 'cd /d "${cwd}"'`（**不转义**）；无 workspace roots / 字符校验 → 渲染层可用 `$(...)`、反引号、`&`、`|` 执行任意本地命令，完全绕过 roots 与审批准入链 | cwd 走 `_workspace-roots.js` realpath 精确校验 + 字符白名单；osascript 用 `quoted form of` / 参数化 AppleScript；Windows 改 `spawn` 参数数组 + `cwd` 选项，禁止拼 shell 串；红绿先行补注入负测 | A |
| L-51 | **P1** | `src/main/install-deep-link-core.js:112-139,460-470`；`src/main/deep-link-protocol.js:14-21`；`src/main.js:185-189,765` | `petri-install://mcp?config=<base64url>` 的 `validateMcpConfig` 对 stdio `command` 只做 `readBoundedString(raw.command,512)`、`args` 只校验条数/长度，**无可执行文件白名单、无 `-c`/`-e` 求值开关拦截**；`confirmInstall` mcp 分支只校验 `allowReplaceMcp` 便 `upsertMcpServer`，`expected` 预览快照 TOCTOU 对账（`:473`）只用于 pack 分支；系统级协议任意网页/邮件可触发 → 外部深链可写入「可执行文件 + 求值参数」的 stdio server（⏳ 启动/trust 触发条件需实机验证） | stdio `command` 收敛到已登记运行时绝对路径白名单、`args` 禁求值开关；mcp 分支同样要求 `expected` 对账 + 二次确认；深链 mcp 安装默认禁用 | A + L |
| L-52 | **P1** | `src/main/env-coordinator.js:243-249`；`core/shared-backend/local-request-boundary.js:17-36,50-53`；`src/ipc/_ipc-trust.js:65-69`；`src/main/security-hardening.js:65-70`；`frontend/src/lib/authClient.ts:10` | `computeTrustedRendererOrigins` 把 `PETRI_TRUSTED_DESKTOP_ORIGINS` env 无校验全量并入（后端 CORS / 全局 IPC sender 门 / Electron 权限策略**三者共同真相源**）；`trustedDesktopOrigins()` 只做 http 形态归一化，IPC 门与权限门直接 `includes(origin)` 零校验；`requireTrustedDesktopOrigin` 对空 Origin 一律 `return true`；配合硬编码共享 bearer → 能写启动 env 即可把任意外部 origin 加进三道门、跨域读本地 API / 冒认 IPC sender | `existing` 只接受回环 origin（localhost/127.0.0.1 + 显式端口）或忽略；三处消费方统一回环过滤；无 Origin 的非浏览器请求改用本机随机 token；同类开关 `allowPrivate()`（`:37-39`）一并收敛 | A |
| L-53 | **P1** | `frontend/src/lib/browser-url.ts:4`；`frontend/src/pages/project-workspace/BrowserPanel.tsx:106-112,289,364-374`；`frontend/src/lib/browser-action-bridge.ts:43-46,104-114`；`src/main/security-hardening.js:129-131` | `normalizeBrowserUrl` 对任意 `scheme://` 原样透传；`navigate()` 运行时 `webview.loadURL(nextUrl)` **不再经过** `will-attach-webview` 的 `isHttpOrHttps(src)`（只查初始 src）；bridge `navigate` 无协议/主机白名单，`read_text` 用 `executeJavaScript('document.body.innerText')` 把正文 POST 回 `/browser-connector/action-result`；`frameUrl` `<iframe>` 无 `sandbox` → 提示注入可把 guest 导向 `file://` / 自定义协议 / 本机服务并回读内容 | 每次 `loadURL` 前用 `new URL` 强制 http(s) + 主机白名单，navigate/bridge 共用同一校验；本地报告只走 `petri-pack://` / `petri-genui://` 独立通道；iframe 补 `sandbox` | A |
| L-54 | P2 | `src/ipc/_ipc-trust.js:29-37,88`；`test/nso-w2-ipc-trust.test.mjs:50-53`；`scripts/lib/post-h9-k6-security.mjs:151` | `readExemptFileSenderIds()` 每次事件现读 env、逗号分隔 webContents id 即可 `return {ok:true}` 绕过 `file:` 注册制，无 channel 限制/过期/审计；契约测试把「env 豁免放行」钉成期望行为，K6 门禁更把「删除豁免口」判红（**与 L-37 同族的反向门禁**）【K-28 残留】 | 启动期一次性登记 + channel 白名单/审计；或移除豁免、PiP 走 `registerTrustedFileSenderHost`，同步修订契约测试与 K6 门禁 | A |
| L-55 | P2 | `src/main/csp-config.js:16-21,34`；`env-coordinator.js:250-263` | dev 模式 `script-src 'self' 'unsafe-inline'` + `http://localhost:* http://127.0.0.1:* ws://* frame-src:*` 同时放行**任意本机端口**；dev 是实际运行形态 → 渲染页可连/嵌入调试端口、其它 dev 后端、本机管理接口，XSS 放大 | dev 放行收敛到实际 Vite/renderer 单一端口；`script-src` 用 nonce 替代 `unsafe-inline`；生产 `localhost:*` 收窄到明确端口 | A |
| L-56 | P2 | `core/shared-backend/execution-admission.js:112-135`；`helpers/guard-ack-store.js:17`；`helpers/approval-request-store.js:35`；`test/post-h9-k6-security.test.mjs:97-108` | 默认 `observe`，凭据缺失/无效/重放均 `ok: mode==='observe'` = true（只审计不拦）；`consumedNonces`/`stores` 全进程内态，重启即失效、dev 双后端不共享；测试把 `defaultObserve:true` 断言为现状且「擅自拨硬判红」【K-29 U 类在册未裁决】 | **U 类**：出一页决策材料交用户裁决，裁决前不改默认语义；裁决通过后切 enforce + 跨进程持久化 | U |
| L-57 | P2 | `src/main.js:557-563` | `applyPermissionPolicy` 被 try/catch 包裹且 catch 后继续启动，注释原文「权限请求将被自动批准——安全策略未生效」→ session 模块异常时 Electron 回落「自动批准一切」，而应用存在加载任意远程页的 `<webview>` | 装配失败即终止启动，或降级 `callback(false)` 全拒绝 + 显著错误态 | A |
| L-58 | P2 | `core/petri-server/helpers/credential-store.js:68-70` | Keychain 写入 `execFileSync('/usr/bin/security',['add-generic-password','-U',...,'-w', value])`，密钥值作为 **argv**（参数数组无 shell 注入，但进入进程参数表）→ `ps`/proc/崩溃转储/EDR 可采集；与文件头「secrets never enter diagnostics」纪律冲突 | 改用 stdin / `input` 传值；非 mac 分支 0600 原子替换已达标 | A |
| L-59 | P2 | `core/shared-backend/llm-providers/io-transcript.js:4-12,244-247`；`routes/ai-agent/llm-transcripts.js:167-189` | 落盘「请求 messages 全量 + 响应全文 + delta 帧样本」用 `appendFileSync` 无 `mode`/`chmod`（依赖 umask，常见 0644）、无脱敏；`/record` 只校验 `req.user.id` 与 conversationId 正则，**无会话归属校验** → prompt 中凭据明文落盘且可按 id 枚举读取；`diagnostic.js:35` 的脱敏不覆盖此面 | 目录/文件 0600；写入前过 `redactSensitiveValue`/`scanTextForSecrets`；read 端点加会话归属校验 | A |
| L-60 | P2 | `src/main/_window-create.js:263-284`；`src/ipc/window-manager.js:374-385`；`src/main/security-hardening.js:227-236` | 导航门用字符串前缀 `url.startsWith(a)` 而非 URL origin 精确比较；`setWindowOpenHandler` 对任意 http(s) 一律 `shell.openExternal(url)` 无主机白名单 → `http://localhost:3000@other-host/` 形态可能命中前缀而 host 是外部域（⏳ Electron 规范化形态需实机验证） | 改 `new URL(target).origin === new URL(base).origin` + 路径白名单并拒 userinfo；`openExternal` 增 scheme+host 白名单 | A + L |
| L-61 | Minor ⏳ | `package.json:14,268,270,279`；`scripts/install-core-deps.mjs:118-145`；`frontend/package.json:48,73-74`；`core/petri-server/package.json:12` | 根 `postinstall` 在 install 期 `npm install --ignore-scripts` + `npm rebuild`（native 编译 + 联网）；`node-pty 1.1.0-beta34`、`infima ^0.2.0-alpha.45` 预发布、`vite ^8.3.0`/`vitest ^5.0.1` 大版本 caret、两个 native 模块；三份 package.json 静态未见 `*` 范围 / git-http 依赖 / 额外 install 钩子。**已装版本、传递依赖与 CVE 未跑 audit，⏳ 待验证** | native 与预发布依赖固定精确版本 + lock 锁定；CI 用 `npm ci --ignore-scripts` 后单独受控 rebuild；postinstall 增离线/完整性校验 | A + V |

**已核对无问题**：4 个窗口创建点四项 webPreferences 基线 + `WINDOW_FILES` 名单覆盖门 + 5 组漏配负测；生产 `child_process` 调用均为参数数组、无 `shell:true`（`workspace_exec` 是显式 shell 功能且带 `commandVerdict` 黑名单 + `accessMode` + `withWorkspace` cwd 校验）；zip 四道 fail-closed 闸；`_workspace-roots.js` realpath 精确相等 + 写面双 guard；gen-ui/pack-ui 协议按 session 取路径 + 全禁面 CSP；深链 pack 安装 https/非私网/逐跳重定向复验/流式 sha256/`expected` TOCTOU 对账齐备；`secret-scan.mjs` 8 模式 fail-closed 且输出不打印命中内容。

### 2.5 界面与交互体验（4.0 / 5）— 13 条

| ID | 级 | 锚点 | 现象与影响 | 建议修法 | blocker |
| --- | --- | --- | --- | --- | --- |
| L-62 | **P1** | `frontend/src/components/copilot/CommandPalette.tsx:104-106,209-215,217-243,250,259-271,285,289-321`；`SimpleChat/PromptEnhanceDialog.tsx:76-94` | `switch(e.key)` 只处理 Arrow/Enter/Escape，**无 Tab**；`role="dialog" aria-modal="true"` 声称模态但焦点可走出；关闭时不还原焦点；分组 header 参与 `selectedIndex` 且 Enter 静默无动作；`role="option"` 容器无 `role="listbox"`、input 无 `aria-activedescendant`。台账 `:15` 自认「focus trap 未做且不得冒充」 | 复用 `PromptEnhanceDialog` 的 Tab 循环 + 保存/还原 `document.activeElement`；selection 跳过 header；补 `listbox` + `aria-activedescendant` | A |
| L-63 | **P1** | `frontend/src/themes/ThemeProvider.tsx:120,131-165,170-194,301-309` | `pull()` 的 `catch { /* 服务端不可达时保持本地 */ }` 吞错且**不写 `prefsSync`**（初值 `{state:'ok',at:0}`）；15s interval 的 `applyRemotePrefs` 把服务端**旧值写回** → 用户改主题看到「本端已生效」，15 秒后被静默回正；纯读侧断网界面仍显示 ok | `pull` 状态入 `prefsSync` + `role=status` 读侧失败条；push 重放期间抑制回正或显式提示「已按服务端旧值回正」 | A |
| L-64 | P2 | `docs/ui-productization-audit.md:5893,5895,892,897,104,413`；`scripts/ui-ledger-triage.mjs:13-16` | UI-482 / 593 / 693 / 650 标题写 `verified`，正文却是「实机待用户走查」「实机待」「flow 待入腿」「真实 Tripo 未验证」；triage 只解析段首状态，机械门检不出 → **implemented 冒认 verified** | 每条加 `- 状态:` 单一字段 + `- 证据:` 必填 acceptance 路径，verified 行机械校验证据文件存在；上述 4 条先降回 `in_progress` | A |
| L-65 | P2 | `docs/ui-productization-audit.md`；`acceptance/block-332/ui-ledger-triage.json:4-12`；`scripts/ui-ledger-triage.mjs:51` | 标题口径 `## UI-\d+` = 552 / verified 497 / in_progress 58；canonical 分段解析 `sections 497 / uniqueIds 488 / verified 450 / debt 35`；差异根因正则要求冒号（`## UI-448 加映 v2` 不计段）与取「最后一个状态词」→ grep 式读数把 verified 高估 +47、未闭合债从 35 虚报成 58 | 标题统一 `## UI-xxx:` + 状态/证据独立成行；对外计数一律以 `triageLedger` JSON 为唯一真源 | A |
| L-66 | P2 | `frontend/src/styles/theme-token-contract.test.ts:116,118-141,208-281,462-552`；`project-workspace.module.css:3952,7264` | 17 族断言中仅前 3 条走 `walk(srcRoot)` 扫全源码，其余 14 条经 `CSS_FILES()` **只扫 .css**；不覆盖 `.tsx` 内联样式、CSS 数字 `z-index`（pages/*.css 共 31 处）、暗色对比度（只有 `custom.css:91,253` 人工注释 5.3/4.8/5.94:1）、focus/aria、同名 class 重复 | 扫描扩到全 `.tsx`；加数字 `z-index` 棘轮；token 对 WCAG 4.5:1 计算断言；观感仍归 E | A |
| L-67 | P2 | `scripts/lib/post-h9-k3-experience.mjs:22-28,110-119`；`acceptance/post-h9-2026-11-10/k3/k3-inline-style-baseline.json:6-27` | `INLINE_DEBT_FILES` 只硬编码 5 个 `.tsx`（55 颜色 + 5 zIndex 逐字一致、无新增），但冻结名单外另有 5 文件内联 zIndex：`ThemeProvider.tsx:303`(1000 + 3 色 fallback)、`CrashNoticeBanner.tsx:90`(9998)、`InstallDeepLinkDialog.tsx:153`(90)、`TitleBarRightZone.tsx:228`(60)、`CommandCenterJobsWall.tsx:505`(2) → 新增内联债落任意未列文件都不红 | 改全量 `.tsx` 扫描 + 只减不增白名单；5 文件基线作为允许值而非扫描范围 | A |
| L-68 | P2 | `frontend/src/hooks/useInvalidationStream.ts:11,70`；`project-workspace.tsx:596-599`；`CommandCenterJobsWall.tsx:201-204`；`BrowserPanel.tsx:313`；`useConversationJobs.ts:89-92` | `catch {}` 吞连接/读错误，hook 返回 `void` 不暴露连接状态；5 个消费方只把 `invalidate` 转 `refresh()` → 全局失效通知断线时数据静默停旧值，用户分不清「慢」与「断」（`StreamReconnectBanner` 是 chat 任务流，无回归） | hook 返回 `phase`(connected/retrying/failed) + 统一 `role="status" aria-live="polite"` 横幅 | A |
| L-69 | P2 | `frontend/src/App.tsx:72-75`；`components/RouteErrorBoundary.tsx:70-72` | lazy fallback 是「刻意不画 spinner」的空 `<div aria-busy>`（无文本/role/live，`aria-busy` 不播报）；边界把原始开发者异常串 `<pre>` 直接抛给用户，无「复制诊断」出口 | fallback 加可见「正在加载页面…」+ `role=status`；错误详情默认折叠 + 复制诊断按钮 | A |
| L-70 | P2 | `frontend/src/App.tsx:152-169` | 窄屏 AppRail 抽屉只有全屏关闭按钮 + `zIndex:78/79` 内联层；无 `role="dialog"`/`aria-modal`/`aria-label`、无 Escape、无 focus trap、背景未 inert | 复用 `PromptEnhanceDialog` 的初始焦点 + Tab 循环 + Escape；抽屉 `aria-label="导航"`、背景 `inert` | A |
| L-71 | P2 | `frontend/src/pages/project-workspace.module.css`（172.82 KB，26 处数字 z-index）；`SimpleChat.tsx:1546`；`SimpleChatMessageRow.domBudget.test.tsx:13` | 数字 `z-index` 26 处（`60/998/999/9000/10000/10001`）、同名 class 重复定义无机械门（`scripts/` 内检测器 0 命中；theme 门只禁 `:root` 内重复 **token**）；长列表全量渲染，虚拟列表需用户裁决（不新增依赖） | 重复类名检测器 + 数字 z-index 棘轮；虚拟列表按裁决推进；同名 class 是否真重复 ⏳ 待验证 | A + E |
| L-72 | P2 | `frontend/src`（全量检索） | `证据等级|审批原因码` **0 命中**；`本地主权` 仅 `svgEditorImage.ts:6,82` 注释；可见原因码只有 `ModelAccessPanel.tsx:203`「查看原因码词表」；失败原因只在 `WorkflowRunsPanel.tsx:197`、`ResultArtifactShell.tsx:911` → 产品人设（本地主权 / 全链可审计 / 证据自证）主要留在内部文档，用户看不到「凭什么可信 / 为什么被拦」 | 结果真值徽标旁加证据等级 chip、审批卡展示 reasonCode 文案、设置页首屏加本地主权说明；措辞与位置 E | A + E |
| L-73 | P2 | `components/copilot/useAppCommands.ts:141`；`WorkingTreeReview/ReviewMode.tsx:717` | `if (!conversation.project_id) return;` 诚实降级为无动作，但 `CommandPalette.tsx:153-155,209-215` 选中后仍 `onClose()` → 面板关闭零反馈；「全部还原」`disabled` 无 `title`/aria 原因（同文件 :725-730 是正例）；13 个右键菜单文件 + `appKeymap.ts:61` + 命令面板不共享禁用原因 | 无归属会话项过滤或标 disabled + 原因；抽统一 `reason` 常量供菜单/快捷键/面板共用 | A |
| L-74 | Minor | `pages/home.tsx:87`；`pages/extensions/index.tsx:166`；`pages/window/CommandCenterJobsWall.tsx:217` | 三处 `.catch(() => { /* 桥缺失 = 不提示 */ })` 静默吞错 → 能力探测/依赖徽章/作业刷新失败零提示 | 降级为 `role="status"` 轻提示「依赖探测不可用」，不阻塞主流程 | A |

**已核对无问题**：冻结内联债 5 文件读数逐字一致；图片 alt 抽查齐备；`StreamReconnectBanner` 三态 live region、Toast 有界历史、`ArtifactPinPane` slider 语义、`treeRoving` roving tabindex、`RouteErrorBoundary` 两级兜底均无回归；home/extensions/JobsWall 关键失败态 `role="alert"` 与重试入口在座；台账 `:10/:15` 明确「22 条人眼项仍 `pending_human_eye`，Agent 不代答」。

### 2.6 错误处理与边界情况（3.6 / 5）— 12 条

| ID | 级 | 锚点 | 现象与影响 | 建议修法 | blocker |
| --- | --- | --- | --- | --- | --- |
| L-12 | **P1** | `core/petri-server/routes/ai-agent/events.js:49,68,113,125,150,161`；`agent-task-store.js:557`；`server.js:135` | `res.flushHeaders()` 与 `heartbeat = setInterval(...)` 之后，`const freshTask = agentTaskStore.getAgentTask(taskId)` 处于**所有 try 之外**；DB 语句异常同步抛 → unhandledRejection 只落一笔日志，`req.on('close')` 未注册、`stopHeartbeat()` 永不执行、SSE 已发 200 头却永不 `res.end()`/`[DONE]` → 前端 EventSource 无限空等、heartbeat 泄漏、错误完全不可见 | 终态判定包进 try/catch，异常时 `sseSend({event:'error', reasonCode:'sse_task_read_failed'})` + `stopHeartbeat()` + `sseDone()` + `res.end()`；`try/finally` 保证 heartbeat 清理；close listener 提前到 flushHeaders 之后 | A |
| L-13 | **P1** | `events.js:131-157`；`scripts/silent-catch-ratchet.mjs:15-17` | `setInterval(() => { try {...} catch { // 轮询出错不终止，下轮继续 } }, 500)` catch 内无计数 / warn / SSE error 帧 / 最大轮数 / 总时长上限 → DB 持续故障时每 500ms 无限静默重试；**因带注释不计入 `gate:silent-catch` 裸 catch 基线，棘轮看不见它** | 累计连续失败数，阈值内发结构化 error + `retryable`，超阈值（3 次/5s）`clearInterval` + `sseDone` + `res.end()`；每轮失败至少 `console.warn` 带 taskId | A |
| L-14 | P2 | `events.js:85-87,110`；`test/silent-catch-baseline.json:54` | `findFallbackChild` 内 `catch {} return null` 使 `failedPayload` 丢 `fallbackTaskId/fallbackLabel`（前端无法自动切降级续跑）；回放段 `catch {}` 吞掉 `getAgentTaskEventsSince` 异常且不推进 `lastSeq`【冻结基线内 4 处残留，非新增回归】 | 两处改具名 reasonCode 降级事件（`fallback_lookup_failed`/`event_replay_failed`）；回放失败显式重置 `lastSeq=afterSeq`；修好后 `gate:silent-catch --write` 下调基线 | A |
| L-15 | **P1** | `core/shared-backend/execution-admission.js:114`；`agent-tools/agent-tool-interceptor.js:406`；`scripts/post-s7-structural-gates.mjs:29-30,41`；`agent-tools/workspace-tools.js:912` | 默认 `observe` 时 `consumeExecutionAdmission` 末行 `return { ok: mode==='observe', ... }` → 重放/参数改写/过期/凭据缺失/签发失败一律 `ok:true`；结构门把 `tools_executor`/`ssh_direct_runner` 登记 `deferred`，但 `:41` 逻辑是 `if (e.state==='deferred' && consumes) issues.push(...)` → **接线反而判违规**；3 个执行入口仅 1 处真消费，头注释「三执行入口…校验并消耗」与现实不符【post-S7 蓝图 :183 已登记未修残留】 | `observe` 下把 `ok` 与 `decision.ok` 分离（`{allowed:true, verdict:false, reason}`）；`deferred` 接主流程红/黄门并给到期条件；为队列/SSH 载体补 token 透传后逐个拨 consumed | A + U |
| L-16 | P2 | `execution-admission.js:22,24,90,138-152` | `consumedNonces = new Set()` 唯一清理入口是测试缝 `_resetConsumedNonces()`；token TTL 5min 但过期 nonce 从不回收 → 无界缓存，长跑后端内存单调增长 | 改带 `expiresAt` 的 Map + 惰性清扫或按 TTL 分片轮转 | A |
| L-17 | **P1** | `frontend/src/lib/projectionTerminalBridge.ts:52-64,113,119,123,129,132-141` | `stopSession` 的 `void fetch(.../kill).catch(()=>{})` 裸吞 → kill 失败时 core 侧 node-pty 会话常驻而本地映射已删、无法重试；`terminal:exit` 只删 `sourceByTab` **不删 `sessionByTab`** → 后续 `writeSession`/`resizeSession` 对死会话 POST 且被吞；`source.onerror` 只标记失败、依赖 EventSource 原生无限重连无退避 | kill 失败重试 2 次并 `markProjectionBridgeFailure`、保留 sessionId 供补偿；`terminal:exit` 同时删 `sessionByTab`；onerror 计数达阈值即 `source.close()` 并抛 `BridgeUnavailableError` | A |
| L-18 | P2 | `scripts/silent-catch-ratchet.mjs:29`；`test/silent-catch-baseline.json:5` | `SCAN_ROOTS=['core','src']`，基线 395 处**无任何 `frontend/src` 条目**；`frontend/src` 约 30 文件 52 处 catch 塌缩（其中 ~40 处 `response.json().catch(()=>null)` 后紧跟 `if (!response.ok) throw` 属结构化降级），真静默 8 处：`CommandCenterJobsWall.tsx:217`、`home.tsx:102`、`office-file-preview.ts:403/429/444/458`、`projectionTerminalBridge.ts:129/141`、`projectionDataBridges.ts:169` | `SCAN_ROOTS` 纳入 `frontend/src` 并生成独立基线；真静默 8 处逐处补错误呈现或写注释豁免，再按只减收敛 | A |
| L-19 | P2 | `frontend/src/lib/projectionDataBridges.ts:50-56,98-99,111-112,127-128,138-139,168-169,189-190`；`desktopBridge.ts:108-110` | 6 处 `catch { return []; / {plugins:{}} / {ok:false,packs:[]} / {} }` 无 reasonCode 无 error；底层 `requestData` 已 `markProjectionBridgeFailure` 并 throw，桥自有 catch 全塌缩 → renderer 永远拿到「看起来正常」的空列表/默认设置；尤其 `runtime` 把网络故障伪造成「R 与 Python 均未安装」确定性假数据（假阴性，误导用户装不需要的运行时） | 统一返回 `{ok:false, code, message, retryable}` 并保留底层 error；`runtime` 不可用返回显式 `unavailable` 三态 | A |
| L-20 | P2 | `src/ipc/plugin.js:32-35,43-46,56-59,67-70`；`src/ipc/_ipc-trust.js:126`；`src/ipc/gen-ui.js:42,295-296` | 同一 IPC 面三套失败形状：`plugin.js` 裸 `[]`/`{}` 无 `ok:false` 无 code、`_ipc-trust.js` `{ok:false,error,reason}`、`gen-ui.js` `{ok:false,code,message}`；`resolveJobForData` 抛无 code 的 Error，被 `getData` catch 压成泛化 `get_data_failed` → 后端 500/404 状态与原因码被抹平，与「errorsAsRejections 全链 / 封闭 reason code 词表」方向不一致 | 定义单一 `ipcFailure(code,message,retryable)` 包装，所有 handler 返回 `{ok:false,...}`；已有 code 禁止覆盖成泛化码 | A |
| L-21 | P2 | `src/ipc/gen-ui.js:28,40,72,83`；`core/petri-server/helpers/web-fetch-policy.js:311` | 主进程对 `http://127.0.0.1:${R_SERVER_PORT}` 的四次 `fetch` 均无 `signal`/超时（同仓 `web-fetch-policy.js:311` 有 `AbortSignal.timeout(...)` 范例）；后端挂起时 `ipcMain.handle` promise 永不 settle → renderer `invoke` 永久 pending，无错误/重试/可重试标记；`_ipc-trust.js:122` 只做 sender 判定不提供超时 | 四处统一注入 `AbortSignal.timeout(10_000)`，超时返回 `{ok:false,code:'backend_timeout',retryable:true}`；preload 侧 invoke 加统一超时兜底 | A |
| L-22 | P2 | `core/petri-server/bootstrap.js:60-67`；`helpers/stale-running-reconciler.js:34,73-76`；`server.js:138-140` | 权限门加载失败仅 `console.error` **不中断启动**（注释自认「fail-open must be LOUD：module permission requests are auto-approved」）；`!db` 时对账器返回空数组（调用方误判「本轮无滞留」）；sweep 异常仅每 60s warn，无连续失败计数；`uncaughtException` 注释「Don't exit — let pm2 decide」只落日志 → 进程带不一致状态继续服务 | 权限门失败改硬失败或置全局 `degraded` 并向写面返回 503；对账器累计阈值后升 `console.error` + 发 `reconciler_unhealthy` 事件；`uncaughtException` 记录后按重启策略主动 `process.exit(1)` | A |
| L-23 | Minor | `helpers/mesh-assets.js:22`；`routes/result-studio/revisions.js:41,292`；`mcp/ide-tools/{search,git-show,git-diff,git-blame}.js`；`db/connection.js:14`；`bootstrap.js:53` | `MAX_MESH_BYTES=64*1024*1024` 是唯一具名常量，其余 6 处 `64*1024*1024`/`67108864` 字面量分散，另有 `express.json({limit:'200mb'})` 无关联说明；`docs/post-h9-2026-11-10-final-report.md:63` 已记「64MB 单入口未收编」未闭合【残留】 | 按语域建 `budget-constants.js`（`MAX_ASSET_BYTES`/`MAX_REMOTE_READ_BYTES`/`MAX_CHILD_STDOUT_BYTES`/`REQUEST_BODY_LIMIT`）逐处替换 + 负测 | A |

**已核对无问题**：`useInvalidationStream.ts:74-75` 有界退避（1s→8s 封顶）+ cleanup abort；`web-fetch-policy.js` 5 跳重定向 + `AbortSignal.timeout` + `retryable` 三态；`llm-client.js:85-93` 首 token stall 仅重试一次且发 `provider_retry`；`table-page.js:237-239` 有 limit/cursor 下游兜底；`events.js:29` afterSeq 负值/NaN 归一；`desktopBridge.ts` 本身不吞错误；`agent-task-event-limits.js:15` 已把 14 处 `1000000` 收编具名常量；全局 IPC 信任补丁空集合 fail-closed。

### 2.7 测试覆盖 / 文档完善度 / 依赖与架构合理性（4.1 / 4.5 / 3.9）— 15 条

| ID | 级 | 锚点 | 现象与影响 | 建议修法 | blocker |
| --- | --- | --- | --- | --- | --- |
| L-75 | **P1** | `scripts/test-affected.mjs:13,155,198-223,247-249`；`.agents/skills/petri-dev-infra/scripts/closeout-gates.mjs:171,178-180`；`docs/document-governance.md:23-25` | 源码自注「**2 不是 fail-closed**：仅说明当前改动没有 impact-map 规则覆盖」；`runPlan` 首行 `if (plan.unknown.length) return 2` 位于 syntax/node/frontend/gates **之前** → unknown 生产路径时**零项测试执行**，连语法门都跳过；补一条宽泛 patterns 或加忽略前缀即可让该路径零测试通过；聚合层把非 0 判 FAIL 并 fail-fast，语义分裂 | `runPlan` unknown 时先跑全量 `test:all` + frontend `test:all` 再返回 2，或把 exit 2 升级为 `FAIL_CLOSED` 并同步改治理文档表述 | A |
| L-76 | P2 | `docs/pending-work-backlog.md:2,14,49,51,56`；`docs/DOC-REGISTRY.json:57,316`；`docs/README.md:9` | backlog 自称「所有已知未完成项唯一登记与推进序 canonical（`truthDomain: pending-work-queue`）」但最后更新停在 **2026-10-31**，全文无 post-H9 / K0–K7 / 32 条终态，仍写 `in_progress`/`active`/`planned`；registry 记 K0–K7 全部收口 → 恢复者从 backlog 会误判仍有在制工作包 | 头部加一行「本表为 10-31 历史快照；当前终态以 `post-h9-2026-11-10-final-report.md` + `DOC-REGISTRY.json` 为准」，canonical 声明降级为「历史队列」 | A |
| L-77 | P2 | `docs/AUDIT-LOG.md`（**77.87 KB**）；`scripts/audit-log-compact.mjs`；`closeout-gates.mjs:114` | 仍 > 50KB 建议阈；第四轮 K-07「`audit:compact` 压回阈内」未兑现（BLOCK-391 只做了超长行搬移，最长 2695B）；冷启动 `npm run state` 每次读近 78KB 头部 | 继续按「搬移不改写」把历史注记迁 `docs/archive/`，或把 50KB 阈改成有依据的可达值并在 K-07 终态如实标注未完成 | A |
| L-78 | P2 | `package.json:274,268,275,279-280,290-291,294-295`；`frontend/package.json:50-51,62,65-66,72`；`core/petri-server/package.json:12,17`；三份 lock | `typescript ^5.9.3` vs `^5.5.4` 漂移（`DOC-REGISTRY.json:166` 已只读检出并标 U 类材料）；`better-sqlite3`/`uuid`/react/react-dom/@types 重复声明；根无 `workspaces`，靠 `postinstall` 手工维护三份 lock（300/258/79 KB）；`engines.node >=24` 只在根与 `core/shared-backend`，frontend 与 petri-server 缺失 | 出单一清单并扩 `gate:version-parity` 覆盖面；typescript 统一走依赖升级评审（前后同套定向测试绿）；三份 package.json 补齐 engines | A + U |
| L-79 | **P1** | `core/shared-backend/db-connection-policy.js:14-16`；`core/petri-server/db/connection.js:25`；`src/database/_db-singleton.js:89` | 自述「桌面侧 ON、后端侧 OFF；BLOCK-372 Batch-2 实测 FK=ON 全量 **179 fail** 已回退」→ 同一 SQLite 库在两个进程里参照完整性语义相反，级联删除/孤儿行行为不一致；第四轮 K-29 列为 **P0 U 类**，K0–K7 收口后仍悬置【在册 U 类，非新回归】 | **U 类**：把 K-29 提交用户裁决；裁决后按「独立大包逐表清偿违约行 + 测试 setup 补关联」推进；期间证据保持双态如实标注 | U |
| L-80 | Minor | `.dependency-cruiser.cjs:26-29,36,43`；`acceptance/block-109/arch-cycles-baseline.json:4-17`；`scripts/arch-cycles-gate.mjs:49-56` | R2 注释写「node: 内建（**config 文件除外**）」但 `to:{path:'^node:'}` 无任何 `pathNot`，宣称的例外未实现；12 存量环只对**新环**判红、消亡环仅「建议 --write 收紧」，无按簇消亡里程碑 | 补 R2 具体 config `pathNot` 清单或删注释；每消一簇环执行 `--write` 下调基线 | A |
| L-81 | Minor | `acceptance/block-100/block100-test-instance-live.json:1`；`scripts/lib/post-h9-k5-evidence-gate.mjs:3-11,19,31-33`；`k5-evidence-metadata-gate.json:20-22` | 历史证据仅 `name/startedAt/finishedAt/assertions/allPass`，无 `sourceCommit/platform/command/generatedAt`；边界**有意且机械化**（只扫 `acceptance/post-h9-2026-11-10/**`、8 字段、无例外；「改写历史=伪造」既有裁决）。但同一门读数三口径：README「33 份+8 负测」、registry「38 份+11 负测」、证据 JSON「fileCount 34 / negativeTests 11」 | 保持不回填，给历史证据加只读 `historic-unverifiable` 索引；报告统一引用 `k5-evidence-metadata-gate.json` 并标 `generatedAt` 时点 | A |
| L-82 | P2 | `.agents/skills/petri-dev-infra/scripts/workspace-state.mjs:184`；`.petri-dev-user-data/task-runs/*.status.json`；`acceptance/nso-2026-11-06/wave-0/full-test-shards/` | `state` 报「运行/失败 15 条（共 29）」：`exitCode:1` **11 条**、`state:"running"` **3 条**（均 2026-11-06 陈旧状态非活进程）、`exitCode:143` 1 条；最新 `nso-w0-shard-node-core` 仍 exit=1（wave-0 全量分片残红，5 份 summary 全 `allPassed=false`）→ 冷启动每次报警掩盖真 running 任务 | status 加 `acknowledgedAt/owner` 或按批次归档旧 status；`state` 区分「历史未消亡残红」与「当前 running」；分片残红按蓝图 :251 消亡 | A |
| L-83 | P2 | `test/user-asset-guard-baseline.json:4-14`；`scripts/user-asset-guard.mjs:7-8,54-58`；`git status` 实测 | 基线自述「上一轮 10 项 untracked 用户资产，此处按 2026-11-10 实测的 **9 项可见条目**登记」，`:6-14` paths 恰 9 项；当次 untracked 实际 10 类（含 `tmp-review/demo.svg` 等）→ 差额 1 项无保护，再次 `git add -A` 有误入库风险（历史已发生两次 `docs/pelican-bicycle.html`） | 逐件对账 10 项并注明差额去向，或改为按当前 untracked 全量动态生成清单；保持门只查 tracked/staged 语义 | A |
| L-84 | Minor | `test/impact-map.json`；`docs/post-h9-optimization-blueprint-2026-11-10.md:243` | 物理 `test/*.test.mjs` = **700**、`frontend/src/**/*.test.ts(x)` = **362**、未映射 **90**（≈12.9% 测试文件不挂规则）；蓝图记「约 700 个 .mjs（628 文件 / 5081 测试）」，628 是**分片清单**读数，两个分母混用 | 把 700/362/90 写入口径单源 JSON 并标注 628=分片清单、700=物理文件数 | A |
| L-85 | Minor | `frontend/package.json:48,49,62`；`core/petri-server/package.json:16`；`package.json:270` | `infima ^0.2.0-alpha.45` 预发布、`node-pty 1.1.0-beta34` 预发布 native；`pdfjs-dist 4.10.38` 精确同版双声明；`@docusaurus/tsconfig` 与 `:5`「Vite SPA（脱离 Docusaurus）」定性不符，污染 knip/依赖面统计 | 纳入依赖升级评审与 `gate:version-parity` 精确版本对账；删除已退役的 Docusaurus 依赖（同套前后绿） | A |
| L-86 | **P1** | `scripts/check-ui-productization-audit.mjs:1047-1062,1276-1284`；`git status` / `npm run state` / `git --no-optional-locks status`；`frontend/src/pages/project-workspace.module.css` | **本轮当次取样新发现**：`ui:audit:check` exit=1 属真实 WIP（CSS 11+/9−，BLOCK-395 B-11 composes 顺序修正）未同步台账，门判定正确；但普通 `git status --short --branch` 与 `npm run state` 因 **stat 缓存陈旧均不显示该 `M`**（`git ls-files --eol` 为 `i/lf w/lf`，排除换行漂移；`git ls-files -v` 为 `H`，非 assume-unchanged）→ 恢复者误判「树干净」而跑聚合门/提交/取证，比红门本身更危险 | `workspace-state.mjs` 用 `git --no-optional-locks status --porcelain` 或 `git diff --name-only HEAD` 兜底，并在输出显式标「stat 缓存可能陈旧」；WIP 归其 owner 收口（本轮零触碰）；`ui:audit:check` 红在干净树复跑仍红才升级门禁缺陷 | A + W |
| L-87 | **P1** | `quality:perf` 当次读数；`scripts/block350-perf-gate.mjs:38-42` | `cold_start 818/874`、`packaged_start 734/773`、`long_conversation 36/40`、`big_project_tree 20/27` 全部贴阈值仍 5/5 绿；K7 前约 547/21/471 → **退化 30–70% 门无感**（与 L-27/L-30 同根，此处登记当次证据） | 同 L-27/L-30；并把「连续 5 次最差轮 + 收紧容差」作为 L0 出口判据 | A |
| L-88 | P2 | `quality:lint` 当次读数；`eslint-suppressions.json` | 0 errors / **2429 warnings**，K7 前 2374–2376，一轮增 ~55；warnings 总数无只减锚（B-31 分域只覆盖 production/test/scripts 抑制条目） | warnings 设分域只减棘轮；与 L-40 同批落地 | A |
| L-89 | P2 | `quality:ear` 当次读数；`scripts/block351-ear.mjs:38` | **981/2198 = 44.6%**，manifest 43.3%，45% 目标未达（差 0.4pp）却因硬阈值 40% 判 PASS；分子分母须同时报，不缩分母 | 同 L-29（棘轮真生效）；45% 目标靠分子真实增长，不靠改阈值 | A |
| L-90 | P2 | `docs/AUDIT-LOG.md:72`；`docs/DOC-REGISTRY.json`；`npm run state` | AUDIT-LOG「当前待处理项」🔵 `BLOCK-385-post-S7-H0-TRUSTED-START 启动登记（active…）` 与 `npm run state`「层 1 串行槽位：空；planned 3 项」、registry「K0–K7 全部 completed」冲突；虽 §「🔵 是阶段广播，与 active 包不是同一层」已有两层语义注记，但该行文字直接写 `active` 仍会误导恢复者 | 把该 🔵 行迁入「最近处理记录」或加显式「历史阶段广播·不占串行槽位」标头；`docs:check` 增加「AUDIT-LOG 🔵 与 registry active 集合」机械对账 | A |

**已核对无问题**：`docs/README.md:1` 首行 BLOCK-403 `completed` 与 registry 一致（README status 对账已兑现）；`DOC-REGISTRY.json` `documentCount 544` 与六类 status（403 completed / 40 active / 3 planned / 76 reference / 5 superseded / 17 archived）合计自洽；三份 lock 齐备；证据元数据门边界清晰且有 11 负测；`test/**` 真行为断言（`assert.rejects|reasonCode|dispatchEvent|.emit`）≥567 处；DB 路径解析已单源（主代理复核更正 L-41）。

---

## §3 发现总台账与阶段归属

分级：**P0** = 正确性/安全/契约破坏/当前门真红/判据失真；**P1** = 必修级实质缺陷；**P2** = 可靠性/体验/可维护性；**Minor** = 清理。合计 **90 条**：P1 **24**、P2 **51**、Minor **15**（含 ⏳ 待验证 5 条）。blocker 决定能否由 Agent 直接开工：`A` 可做 / `L` 需实机 / `E` 需人眼 / `U` 用户裁决 / `V` 凭据出网 / `W` 在制 WIP。

| 阶段 | 覆盖发现 ID | P1 数 | 主 blocker |
| --- | --- | ---: | --- |
| **L0** 判据与可信起点 | L-27, L-28, L-29, L-30, L-36, L-37, L-40, L-43, L-45, L-54, L-75, L-76, L-77, L-82, L-83, L-84, L-86, L-87, L-88, L-89, L-90 | 8 | A + W（L-86 的 CSS WIP 归 owner） |
| **L1** 安全边界纵深 | L-50, L-51, L-52, L-53, L-55, L-57, L-58, L-59, L-60, L-61, L-56(U), L-79(U) | 4 | A + L + U（两项出材料不代答） |
| **L2** 功能断链与假成功 | L-01, L-02, L-03, L-04, L-05, L-06, L-07, L-08, L-09, L-10, L-11, L-19, L-20, L-21 | 2 | A + L |
| **L3** 错误语义与边界 | L-12, L-13, L-14, L-15, L-16, L-17, L-18, L-22, L-23, L-68, L-74 | 4 | A + U（L-15 的 observe 语义待裁决） |
| **L4** 性能与数据面 | L-24, L-25, L-26, L-31, L-32, L-33, L-34, L-35 | 3 | A + L |
| **L5** 结构与单源 | L-38, L-39, L-41, L-42, L-44, L-46, L-47, L-48, L-49, L-78, L-80, L-85, L-63(交叉) | 2 | A + U（typescript 版本需升级评审） |
| **L6** 体验可达性与人设 | L-62, L-64, L-65, L-66, L-67, L-69, L-70, L-71, L-72, L-73, L-81 | 1 | A + E（22 条人眼项不代答） |
| **L7** 总收口与证据 | 全部 ID 复核 + 三段分片残红 + 十一维复评 | 0 | V + E（真实任务/人眼终态材料） |

> L-36（尺寸门盲区）与 L-37（反向门禁）**必须同批**：先解反向门禁，否则入册即判红。L-44（knip 收窄）同理。L-86 的 CSS WIP 归 owner，L0 只修状态聚合器，不代改 CSS/台账。

---

## §4 阶段蓝图 L0–L7

> **不设工作量上限，但设证据上限**：任何没有当前证据的「完成/通过/可信」都不得写入收口报告。阶段内可切多个正式工作包，但同一时间只有一个 active work-package 与一个进行中阶段。每阶段开工前按 `$petri-project-governance` 的 `WORK-PACKAGE-LAUNCH-CHECKLIST.md` 走完，收口按 `STAGE-CLOSEOUT-CHECKLIST.md` 走完。

### L0 · 判据校准与可信起点（P0 · 全程序前置，21 项）

**目标**：把「会保护债务的门禁」「会假绿的判据」「会漏报 WIP 的状态聚合器」「并存的数字双真相」四类尺子问题先修好。**本阶段不做功能优化**——尺子不准时优化会做在假问题上，且会被反向门禁判红。

| # | 改进点 | 级 | 验收标准（可机械核验） |
| --- | --- | --- | --- |
| L0-1 | 解反向门禁：L-37 / L-54（K6 豁免口）/ L-44（knip entry）三处「改进即判红」断言改读数型记录 + 只减棘轮 | P1 | 植入「把 loop-orchestrator 入册 / 收窄 knip entry / 删除 env 豁免口」三份模拟改动，门禁**不判红**；同时三类篡改负测仍必红；`gate:post-h9-contracts` 185 项全绿 |
| L0-2 | perf 判据重立：L-27 冷热分离 + 中位/最差轮采样 + 收紧容差 + 植入慢样本负测；L-28 skipped 默认判红；L-30 基线绑定 host/热路径源码 | P1 | ①植入 +30% 慢样本门必红（负测）；②移除 `dist/*.app` 后 `packaged_start` 判红而非 skipped 绿；③改任一热路径文件后 baseline 失配即要求重采；④`quality:perf` 连续 5 次仍 PASS 且四场景读数写入当次证据 |
| L0-3 | EAR 棘轮真生效：L-29 `earNow >= manifest.totals.earPct` + 动态负测；L-89 45% 目标只靠分子增长 | P2 | 植入「ear 降至 41%」样本门必红；`quality:ear` 当次分子分母同时报 |
| L0-4 | 定向测试 fail-closed：L-75 `runPlan` unknown 时先跑全量再返回 2，或升级 `FAIL_CLOSED` | P1 | 构造一个未登记的生产文件改动，`test:changed --run` 必须执行至少 1 项测试且 exit≠0；治理文档 §4.5 同步改判 |
| L0-5 | 状态可信度：L-86 `workspace-state.mjs` 用 `--no-optional-locks` 兜底并显式标 stat 缓存风险；L-90 AUDIT-LOG 🔵 与 registry active 集合机械对账 | P1 | 构造 stat 缓存陈旧场景（`touch` 后改内容），`npm run state` 必须列出该 M；AUDIT-LOG 🔵 与 registry 不一致时 `docs:check` 报警 |
| L0-6 | lint 台账可信：L-40 `eslint -f json` 生成/校验 `eslint-suppressions.json` 禁止裸改 count；L-88 warnings 分域只减棘轮 | P1 | 手工下调 count 后门必红；新增违规必红；2429 warnings 设分域基线且此后只减 |
| L0-7 | 尺寸门与源码扫描棘轮扩面：L-36 >700 行生产文件（含 `.module.css`）全量入册 + CSS 字节维度；L-43 全库扫描发现器 + 第二棘轮 | P1 | 新增一个 >700 行未登记文件门必红；`project-workspace.module.css` 172.82KB 入册；全库新增 `src.includes(` 断言门必红；4 文件旧基线保持只减 |
| L0-8 | 数字口径单源：L-45（366/90、544/527）、L-84（700/362/90 与 628 分母）、L-81（33/34/38）、L-76 backlog 头部历史快照声明、L-77 AUDIT-LOG 压回阈或如实标未完成、L-82 task-runs 噪声归档、L-83 用户资产 10→9 对账 | P2 | 一份 `docs/post-k7-readings-single-source.json` 承载全部读数，文档引用该 JSON；`docs:reconcile` 0 validation issues；`npm run state` 不再报 15 条历史噪声；用户资产保护清单与当次 untracked 逐件对账一致 |

**依赖**：无（但串行上必须等其他 owner 把 CSS WIP 收口；L0-1 不依赖它，可先做）。**blocker**：A + W。**出口判据**：`closeout:full` 19 门全绿（含 `ui:audit:check` 在他方 WIP 收口后归零）、`gate:post-h9-contracts` 全绿、上述 8 组负测全数「植入必红」、L0 自身零产品行为变化（前后同套定向测试绿）。

### L1 · 安全边界纵深（P0，12 项）

**目标**：把四项 P1 安全断链与 fail-open 路径清干净，每条自带负测；U 类只出材料不代答。

| # | 改进点 | 级 | 验收标准 |
| --- | --- | --- | --- |
| L1-1 | L-50 `terminal:open-shell` cwd 校验 + AppleScript 参数化 + Windows spawn cwd | P1 | 注入 payload（`$(...)`/反引号/`&`/`|`/userinfo）12 组全部被拒且无命令执行；合法 workspace 路径三平台计划仍逐字可用；红绿先行负测落盘 |
| L1-2 | L-51 深链 MCP stdio `command` 白名单 + `args` 禁求值开关 + mcp 分支 `expected` 快照对账 + 二次确认 | P1 | 构造 `command:'sh', args:['-c','…']` 等 8 组深链全部拒绝；pack 分支既有 TOCTOU 对账零回归 |
| L1-3 | L-52 受信 origin 回环过滤 + 三消费方统一 + 空 Origin 改本机随机 token | P1 | 注入任意外部 origin 到 env 后 CORS/IPC/权限三道门全部拒绝；合法回环 origin 三道门全通；共享 bearer 常量移除且前后端握手回归绿 |
| L1-4 | L-53 每次 `loadURL` 前 http(s)+主机白名单（navigate/bridge 同源）+ iframe `sandbox` | P1 | `file://`/`petri-genui://`/`127.0.0.1:任意端口` 6 组 navigate 全拒；合法 http(s) 仍可读正文；iframe 带 sandbox 属性契约测 |
| L1-5 | L-55 dev CSP 收敛到单一端口 + nonce 替 unsafe-inline；L-57 权限装配失败硬失败；L-60 URL origin 精确比较 + openExternal 白名单 | P2 | 静态断言 CSP 无 `*` 端口与 `unsafe-inline`；`applyPermissionPolicy` 注入失败后进程不继续服务；`http://localhost:3000@other-host/` 被拒 |
| L1-6 | L-58 Keychain 改 stdin 传值；L-59 transcript 0600 + 脱敏 + read 归属校验 | P2 | `ps` 快照不含密钥值；写入文件 mode=0600；跨会话 id 读取返回 403；脱敏命中负测 |
| L1-7 | L-56 / L-79 **U 类一页决策材料**（ADMISSION observe→enforce、FK OFF/ON 179 违约） | P2 | 材料含现状/候选/风险/推荐四段，状态 `pending_user_ruling`；**Agent 不改默认语义、不代答**；L1 其余项不因此阻塞 |
| L1-8 | L-61 依赖静态清单（精确版本 + 受控 rebuild），⏳ CVE 判断只在有网/凭据时补 | Minor | 三份 package.json 无新增依赖；native/预发布版本精确钉扎；`npm ci --ignore-scripts` 后可受控 rebuild |

**依赖**：L0 完成（门禁不再反向锁死）。**blocker**：A + L + U + V。**出口判据**：全部负测绿、`quality:secret`/`quality:arch`/`test/electron-security-assertions` 全绿、零新增依赖、U 类材料在册未越权。

### L2 · 功能断链与假成功（P0/P1，14 项）

**目标**：消灭「成功但零执行」「声明有但入口不可达」「声明可比较但产品无入口」三类假兑现，并统一 IPC 失败形状。

| # | 改进点 | 级 | 验收标准 |
| --- | --- | --- | --- |
| L2-1 | L-01 MCP `skill_execute` 同源注入执行体 + 无后端 fail-closed `no_execution_backend` | P1 | 红绿先行：当前空产物用例必红 → 修后 11 个内置 Skill 逐件执行有真实产物或明确 `isError:true`；协议级 `callTool` 断言 |
| L2-2 | L-02 收敛 MCP 双 server：产品入口注册 Resources + capabilities，legacy 退役或单一实现 | P1 | 协议握手断言 `capabilities.resources` 在场；`ide://projects`/`ide://git-status` 从 `bin petri-mcp` 入口可读；`prompts` 声明不再恒空 |
| L2-3 | L-19 数据桥统一 `{ok:false,code,message,retryable}`、`runtime` 三态；L-20 单一 `ipcFailure()`；L-21 四处 fetch `AbortSignal.timeout` | P2 | 注入后端 500 / 超时 / 断网三态，renderer 收到明确 code 且不再显示「R 未安装」假阴性；gen-ui invoke 10s 内 settle |
| L2-4 | L-03 viewer `canCompare` 接线或诚实改声明 + 契约测；L-05 skill source enum 同源派生 | P2 | `mode=compare` 不再静默回退；`source:'pack'` 可过滤领域包且双表一致性负测绿 |
| L2-5 | L-04 updater 跨平台实现或按平台隐藏入口；L-06~L-11 零消费通道/端点逐件销号或 `retain-with-reason` | P2/Minor | 165 通道与 2 storage key 逐件终态；`startup:marks`/`testOnly` 通道标验收专用；`tool-defs.js` 头注与 16 域一致 |
| L2-6 | L-09 通道表增 `testOnly` 标记并让 `test/ipc-channels-registry.test.mjs` 区分产品/验收通道 | Minor | 双向集合相等门仍绿，新增分类字段有负测 |

**依赖**：L1（安全面零回归后再动 MCP 入口）。**出口判据**：MCP 协议级契约测 + 168 通道双向门 + `gate:post-h9-contracts` 全绿；每个「零消费」项有终态，不留 `in_progress`。

### L3 · 错误语义与边界（P1，11 项）

**目标**：所有失败有结构化原因码 + 可见 UI/轨迹态 + 明确可重试性；静默 catch 清零并扩扫描根。

| # | 改进点 | 级 | 验收标准 |
| --- | --- | --- | --- |
| L3-1 | L-12 SSE 终态判定 try/catch + `try/finally` heartbeat 清理 + close listener 提前 | P1 | 注入 `getAgentTask` 抛错：无 unhandledRejection、收到 `error` 帧 + `[DONE]`、heartbeat interval 计数归零、`res.end()` 被调用 |
| L3-2 | L-13 轮询失败计数 + 结构化 error + 3 次/5s 熔断；L-14 两处空 catch 改具名 reasonCode | P1/P2 | 注入连续 DB 失败：≤3 次有 error 帧、第 4 次连接关闭；`fallback_lookup_failed`/`event_replay_failed` 可在前端投影读到；`gate:silent-catch --write` 基线只减 |
| L3-3 | L-17 projectionTerminalBridge kill 重试 + `sessionByTab` 清理 + onerror 有界重连 | P1 | kill 失败 2 次后 `BridgeUnavailableError` 可见；`terminal:exit` 后 `writeSession` 不再对死会话 POST；永久断网时重连有上限 |
| L3-4 | L-18 `SCAN_ROOTS` 纳入 `frontend/src` + 独立基线；真静默 8 处逐处补呈现或具名豁免 | P2 | 新增前端静默 catch 必红；8 处逐件终态，基线只减不增 |
| L3-5 | L-22 权限门硬失败 / 对账器健康事件 / `uncaughtException` 主动退出；L-16 consumedNonces 带过期回收 | P2 | 注入三类失败后系统不静默降级、有 `degraded` 标记；长跑 10k 次消费后 Set/Map 规模有界 |
| L3-6 | L-15 `observe` 下 `ok` 与 `verdict` 分离 + `deferred` 接主流程红/黄门；L-23 64MB 单入口 | P2/Minor | 重放/过期/缺凭据四类在 observe 档下 `allowed:true` 但 `verdict:false` 可审计；3 执行入口逐件有消费点或到期条件；预算常量单文件 + 逐处替换负测 |
| L3-7 | L-68 `useInvalidationStream` 返回 `phase` + 统一断线横幅；L-74 三处轻提示 | P2/Minor | 断线注入后 5 个消费方均有可见 `role=status` 态；`StreamReconnectBanner` 三态零回归 |

**依赖**：L2（IPC 失败形状统一后前端才能稳定消费）。**出口判据**：`gate:silent-catch` 扩面后基线只减；SSE 断线注入三态实机证据落 `acceptance/`；42 原因码词表扩面且生产面未注册即红仍绿。

### L4 · 性能与数据面（P1/P2，8 项）

**目标**：把「数据库同步阻塞、全量回放、无事务 fork、定时器回归、渲染无门」五类真实性能债清掉，并把判据接进常驻门。

| # | 改进点 | 级 | 验收标准 |
| --- | --- | --- | --- |
| L4-1 | L-24 fork 事务化 + `INSERT ... SELECT` + `untilIndex` 下推 LIMIT | P1 | 红绿先行：1000 条 fork 中途注入失败 → 零半截会话；耗时与 WAL commit 次数较基线下降可量化；拆前拆后同套定向测试绿 |
| L4-2 | L-25 热路径真异步（worker_threads）或显式同步契约 + `sleepSync` 非阻塞退避 | P1 | 注入 7s 锁争用期间 health/SSE 心跳仍可响应；`Atomics.wait` 从启动热路径移除 |
| L4-3 | L-26 `findFallbackChild` 倒序 LIMIT 1 + SSE 事件驱动 wakeup + 全量回放真实上限 | P1 | 236k 行 fixture 下失败终态内存峰值与耗时可量化下降；`AGENT_TASK_EVENTS_ALL_LIMIT` 不再被 15 个生产点当默认全量使用 |
| L4-4 | L-31 messages 游标增量计数 + `meta` 按需投影 + export 流式分块 + 三路径入 perf 场景 | P2 | 20 页滚动 `COUNT(*)` 调用数 = 0；长会话 export 内存有界；perf 场景数由 4 扩到 ≥6 且各有连续 5 次读数 |
| L4-5 | L-32 `tick % 6`/`% 12` 分档 + 请求间隔测试 | P2 | 30s/60s 档实测请求间隔回到 30s/60s（±1 拍），每分钟请求量不高于定时器合并前 |
| L4-6 | L-33 长列表窗口化（零新增依赖）+ CDP 节点数/帧间隔独立常驻门；L-34 CSS KB 棘轮 + 构建产物体积/耗时门 | P2 | 1000 条会话 DOM 节点数有上界断言（植入 2 万必红负测已在 K5 交付，此处接渲染腿）；`vite build --json` 体积超阈即红；172.82KB CSS 入册并只减 |
| L4-7 | L-35 高频定时器挂 `visibilityState` 门 + 共享 scheduler | Minor | 隐藏窗口下轮询请求数下降可量化；20 个定时器逐件 cleanup 契约测 |

**依赖**：L0（perf 判据已重立，否则优化收益测不出）。**出口判据**：`quality:perf` 连续 5 次 PASS 且读数写入当次证据；`quality:ear` 只进不退；新增场景均有负测；零新增依赖。

### L5 · 结构与单源（P1/P2，13 项）

**目标**：把「四处 resolveCore 镜像、双表、三处装配、四表扩展、三矩阵」收敛为单一真相，并让尺寸例外真正下降。

| # | 改进点 | 级 | 验收标准 |
| --- | --- | --- | --- |
| L5-1 | L-38 四处 `resolveCore` 统一 require 单源 + 静态门「除 core-utils 外不得定义 `resolveCore*`」 | P1 | 植入第五份 mirror 门必红；dev/packaged 两态路径解析逐字一致（BLOCK-92 拆前拆后同套绿） |
| L5-2 | L-39 单一 schema 生成 `TOOL_METADATA`/`CONTRACTS` 两视图 + 跨表一致性锚与负测；统一文档定性 | P1 | 新增工具只改一处；删掉任一表字段门必红；`docs/pending-work-backlog.md` 与蓝图定性一致 |
| L5-3 | L-42 插件源装配收敛 `loadPlugins(sourcePlan)` + 门禁改漂移检测；L-47 单一工具声明生成四表 + 审批元数据校验门；L-48 三矩阵共用纯函数生成器 | P2 | 新增一个插件源/工具/IPC 通道的改动面逐项下降并可枚举；`ownArrays` 固定计数断言移除；三矩阵人工改动判红 |
| L5-4 | L-44 knip entry 收窄 + 动态 require 改静态注册表 + `--update` 下调基线（与 L0-1 同批解锁） | P2 | 330 键保留面下降且 `quality:knip:check` 绿；三处动态点有显式注册 |
| L5-5 | L-46 W5b 逐刀拆分：一切片 = 一会话 + 拆前拆后同套定向测试绿，例外续期附「下降行数」判据 | P2 | 至少 3 刀落地且 `SimpleChat.tsx`/`tools-executor.js`/`loop-orchestrator.js` 行数只减锚生效；16 条例约到期前给出终态或下降证据 |
| L5-6 | L-78 单一版本清单 + `gate:version-parity` 扩面 + 三份 engines（typescript 统一走依赖升级评审，**U 类不擅自升级**）；L-85 删 `@docusaurus/tsconfig`；L-80 R2 pathNot 与环消亡里程碑；L-41 注释更正；L-49 warn 计数入棘轮 | P2/Minor | 版本漂移由机械门报告；依赖升级前后同套定向测试绿；12 环至少消亡一簇并 `--write` 下调；零新增依赖 |

**依赖**：L0（L-36/L-37/L-43/L-44 解锁）。**出口判据**：`gate:version-parity`/`quality:arch`/`gate:arch-cycles`/`quality:knip:check`/`gate:code-size` 五门全绿；每刀拆分有拆前拆后同套绿证据；文档定性冲突清零。

### L6 · 体验可达性与产品人设（P1/P2，11 项）

**目标**：任何状态下用户都知道「发生了什么、能用什么、为什么不能用」，且把「本地主权 / 全链可审计 / 证据自证」做成可见形态（对齐 AGENTS.md 人设与立项自检问句）。

| # | 改进点 | 级 | 验收标准 |
| --- | --- | --- | --- |
| L6-1 | L-62 CommandPalette focus trap + 焦点还原 + 跳过 header + `listbox`/`aria-activedescendant`；L-70 窄屏抽屉 dialog 语义 + Escape + inert | P1/P2 | 组件级键盘用例（Tab 循环/Escape/初始焦点/还原/方向键跳 header）+ 9223 实机离屏探针；复用 `PromptEnhanceDialog` 既有配方 |
| L6-2 | L-63 ThemeProvider 读侧状态入 `prefsSync` + `role=status` 失败条 + 抑制静默回正 | P1 | 注入读侧断网与服务端旧值，界面不再显示 ok、不再 15s 静默回正；push 侧 30s×3 重放零回归 |
| L6-3 | L-64 UI 台账 4 条降回 `in_progress` + `- 状态:`/`- 证据:` 单字段 + verified 机械校验证据存在；L-65 计数统一以 `triageLedger` JSON 为真源 | P2 | 植入一条无证据 `verified` 门必红；`ui:audit:check` 在他方 WIP 收口后归零；对外计数带口径标注 |
| L6-4 | L-66 theme 门扩到全 `.tsx` + 数字 z-index 棘轮 + WCAG 4.5:1 计算断言；L-67 内联债改全量 `.tsx` 扫描；L-71 重复类名检测器 | P2 | 植入一个内联颜色/数字 z-index/重复 class 门必红；`theme-token-contract.test.ts` 全绿且覆盖新维度；对比度计算可复跑 |
| L6-5 | L-69 RouteFallback 可见文本 + `role=status`、错误详情折叠 + 复制诊断；L-73 禁用原因单源 | P2 | lazy 慢载/失败两态有可读文本；13 个右键菜单族 + 快捷键 + 命令面板共享同一 `reason` 常量 |
| L6-6 | L-72 产品人设可见化：证据等级 chip / 审批卡 reasonCode 文案 / 设置页本地主权说明 | P2 | 前端出现可断言的「证据等级」「原因码」「本地」可见元素；**观感归 E，路线已生成但不代答** |
| L6-7 | L-81 历史证据只读 `historic-unverifiable` 索引；22 条人眼项 `pending_human_eye` 保持不冒 verified，自动生成测试路线 | P2 | `docs/post-s7-h7-human-eye-route.md` 路线在册；无签字记录不得写 verified；debt 35 逐件终态为 verified/cancelled/retain-with-reason |

**依赖**：L3（错误语义稳定后 UI 才有稳定态可呈现）。**出口判据**：组件级 + 9223 离屏实机双证（`PETRI_TEST_ONSCREEN` 一律不设、跑完立即 kill）、`ui:audit:check` 绿、主题门绿、人眼项如实挂起。

### L7 · 总收口与证据（P2）

**目标**：把 90 条发现逐件终态化，把三段分片残红归因清零，做第五轮十一维复评，产出可机械恢复的干净起点。

| # | 改进点 | 级 | 验收标准 |
| --- | --- | --- | --- |
| L7-1 | 90 条逐件终态：`done` / `done-partial` / `retain-with-reason` / `pending_human_eye` / `external-blocked` / `pending_user_ruling`，零 `in_progress` | P2 | 一份 `gap-ledger` JSON 逐件带证据路径；零编造计数 |
| L7-2 | 三段分片残红（`nso-w0-shard-*` exit=1）按四类归因消亡；`task-runs` 历史噪声归档 | P2 | `test:all:sharded` 三段 0 未归因 fail；`npm run state` 只报当前 running |
| L7-3 | 干净树 `closeout:full` 连续 3 次 19 门 PASS 0 SKIP + `gate:post-h9-contracts` 全绿 + `docs:reconcile` 0 validation issues + `docs:check` PASS | P2 | 三次退出码与摘要落 `acceptance/post-k7-2026-11-10/l7/` |
| L7-4 | 十一维第六列复评（本蓝图 §0.3 为第五列），逐维写「升/平/降 + 归因」，不回溯改历史分 | P2 | 复评表每行有当前源码锚点或当次读数 |
| L7-5 | 真实任务 0/8 环境因与人眼签字缺席如实终态（**V + E 不代答**），出补腿条件 | P2 | `external-blocked` / `pending_human_eye` 带补腿条件与重开判据 |

**出口**：整个 L 程序 `completed`；canonical 六件套（work package / roadmap / handoff / AUDIT-LOG / ui-audit 台账 / DOC-REGISTRY）同批回写；`npm run docs:reconcile` + `docs:check` 通过后才可宣布收口。G0 开发期常态 · 不外推 packaged/Provider/GA。

---

## §5 优先级矩阵与发令顺序

| 顺序 | 阶段 | 体量 | 前置 | 可否 Agent 独立开工 |
| --- | --- | --- | --- | --- |
| 1 | L0 判据与可信起点 | 大（21 项，但零行为变化） | 无 | 是（L0-5 的 CSS WIP 归 owner，只修状态聚合器） |
| 2 | L1 安全边界纵深 | 大（12 项，含 4 个 P1） | L0 | 是（U 类出材料不代答，V 类标 ⏳） |
| 3 | L2 功能断链与假成功 | 中（14 项） | L1 | 是 |
| 4 | L3 错误语义与边界 | 中（11 项） | L2 | 是 |
| 5 | L4 性能与数据面 | 大（8 项，含结构性改动） | L0 判据 + L3 | 是（worker_threads 属 scoped refactor，需拆前拆后同套绿） |
| 6 | L5 结构与单源 | 大（13 项，W5b 逐刀） | L0 解锁 + L4 | 是（依赖升级走评审，不擅自升级） |
| 7 | L6 体验可达性与人设 | 中（11 项） | L3 | 是（E 类路线在册不代答） |
| 8 | L7 总收口与证据 | 小（纯验证 + 台账） | L0–L6 | 是（V/E 边界如实终态） |

**红线**：任何阶段都不得并行开第二个 active work-package；不得提前实现后续阶段；不得为过门禁放宽任何基线；不得改 10 项 untracked 用户资产与在制 CSS WIP；不得新增依赖；不得把 `pending_human_eye` / `external-blocked` / `pending_user_ruling` 写成 `verified`；不得建议 G1+ 工作。

---

## §6 验收协议

### 6.1 每阶段固定循环

1. `npm run state` + 读 `docs/AUDIT-LOG.md`（🔴/🟢 先处理）+ 核对 `DOC-REGISTRY.json` 两层 active 语义。
2. 按 `$petri-project-governance` 走 `WORK-PACKAGE-LAUNCH-CHECKLIST.md`，注册本阶段 work-package 与 truthDomain。
3. 规划定向测试前跑 `npm run test:suggest -- --supply=cloud`；台账回写前跑 `npm run doc:suggest -- --supply=cloud --context "<改动说明>"`。
4. **红绿先行**（HK-01）：新行为契约/缺陷修复先落失败测试 → 最小实现转绿；纯重构豁免但须拆前拆后同套绿。
5. 实现 → 定向测试 `npm run test:changed` → `docs:check` + `ui:audit:check` + 相关 quality 门。
6. 收口：`npm run closeout`（或锚点存疑时 `closeout:full`）→ `npm run output:judge` → `npm run next:suggest -- --supply=cloud --context ... --candidates ...` → canonical 六件套回写 → `npm run docs:reconcile` + `docs:check`。
7. 交付说明附 `NEXT-STEP-BRIEF` 固定块 + 〔skills: … · jev×N〕标签（N 取 `npm run decision:session` 当次分段读数）。

### 6.2 证据五类不互冒充

行为/契约测试、机械门禁、DOM/CDP 实机、人眼观感、真实任务成功——五类各自独立。`closeout` 绿 ≠ UI 在场；`quality:perf` 毫秒 ≠ 用户观感；185 契约全绿 ≠ 安全边界成立；`verdict=measured` ≠ 视觉绿。未跑/跳过/复用/在制 WIP 引起的红一律如实标注，不写通过。

### 6.3 U / E / V / W 四类边界的「无需用户参与」解法

用户已授权「独立完成全部优化任务，无需用户额外参与」。合规解法不是代答，而是：
- **U（用户裁决）**：出「一页决策材料」（现状/候选/风险/推荐），状态 `pending_user_ruling`，**不改默认语义**，继续推进下一可开工项；
- **E（人眼）**：自动生成详细测试路线（步骤/输入/预期/证据留存点），状态 `pending_human_eye`，**不冒 verified**；
- **V（凭据/出网/平台）**：诚实标 `external-blocked` + 补腿条件与重开判据；
- **W（在制 WIP）**：零触碰、不代改、不 stage、不提交，登记 owner 归属。
四类均不计入「Agent 可开工项」的完成数，但必须在 L7 逐件终态化。

### 6.4 复跑命令

```bash
npm run state
npm run docs:check && npm run ui:audit:check
npm run gate:post-h9-contracts
npm run quality:lint && npm run quality:types && npm run quality:arch && npm run quality:secret
npm run gate:code-size && npm run gate:arch-cycles && npm run gate:silent-catch
npm run quality:knip:check && npm run quality:ear && npm run quality:perf
npm run test:changed:list && npm run test:changed
npm run closeout            # 定向；锚点存疑用 closeout:full
npm run docs:reconcile && npm run docs:check
```

---

## §7 与既有 canonical 的关系

- **不改原件**：`docs/post-h9-optimization-blueprint-2026-11-10.md` 是未跟踪用户资产（registry 已 `planned`），本蓝图**零触碰**；其 365/120、528/511 等过期读数按 L0-8 在新单源 JSON 中作废，不改写历史。
- **不新建第二真相**：本文是 `living-plan`（planned），不占单包串行槽位；当前状态仍以 `docs/AUDIT-LOG.md` / `docs/next-steps-roadmap.md` / `docs/project-workspace-handoff.md` / `docs/DOC-REGISTRY.json` / `npm run state` 为准。
- **执行提示词**：`docs/post-k7-execution-prompt-2026-11-10.md`（本程序的可独立执行入口，含预授权边界与全部红线）。
- **既有评估链**：见 §1.3；本文只登记「到 HEAD `f9873243` 仍未闭合」的事实与下一阶段候选工作包。
- **重开条件**：见 frontmatter `reopen`。
