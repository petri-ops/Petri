# 交接提示词 · 新会话继续开发（2026-09-15 · 第二轮：G0-RS 整包 closeout 尾声）

> 本文件已按 2026-09-15 第二轮会话（macOS 指挥席）重写：
> **P6 重采已 closed**（live capture 10/10，证据刷新并推送到本分支）；
> **p4r ui observation 重采是唯一未竟项**，卡在驱动的候选生命周期段（已定位到具体条件，未修完）。
> 换 Agent 继续：先读本文件 → AUDIT-LOG → plan 状态头 → 按「四、剩余工作」执行。

## 提示词正文（复制从这里开始）

### 一、开工前必读（顺序不可变）

1. `docs/AUDIT-LOG.md`（当前无 🔴 阻塞项）
2. `git status` / `git log --oneline -10` 对账（本轮结束时工作区干净）
3. `docs/next-steps-roadmap.md` → `docs/project-workspace-handoff.md` → `docs/g0-result-studio-plan.md` 状态头
4. 项目自有 Skill：`$gewu-project-governance`（启动/收口必走）、`$gewu-dev-infra`、`$gewu-code-review`

### 二、G0 开发期铁律（违反即越权）

- 长期 G0 开发期：不外推 packaged/Provider/GA；`qualificationEligible: false` 是常态不是待办；收口笔录「G0 开发期常态 · 不外推 packaged/Provider/GA」恰一次。
- 单工作包串行：当前 active 槽位 = **G0-RS**（P2 已 completed；剩整包 closeout）。
- Result Studio 维持 `implemented_unverified / experimental`；P7 维持 `deferred`。
- 包仓 `gewu-pack-bio`（`21d610c`，14 插件封存 `plugins.dormant/`，deseq2 唯一活跃）**只读不改动**；核心树零领域回流。
- 用户裁决过：**不擅自杀用户进程**（dev 栈属用户）；本轮实测 3000/3001/3005/9222 均空闲。

### 三、本轮已交付（全部已提交，HEAD `ba840ef4`，工作区零差量）

| # | 提交 | 内容 |
| --- | --- | --- |
| 1 | `6ddbb645` | **P6 重采前置：live 链封存态包感知化**。封存态实锤 = `plugins/` 只剩 deseq2，而 volcano-plot/go-kegg/gene-correlation 是 `pluginOnly` 工具、插件不在装载面 → 探针实测 `job failed「Unknown tool: volcano-plot」`、CATALOG 只剩 1。四处复用 `g0-rs-p4r-pack.mjs` 包感知层：p6-pressure 的 go-kegg 供能数据改 `locatePackPluginDir`（可逆对照：撤改动 → ENOENT 红，改后 7/7 绿）；p5-acceptance 的 `buildScientificInput` + `ADMITTED_DESCRIPTOR_FILES` 改包内 dormant 感知 + `createP5LiveScientificRuntime` 在隔离根装配封存插件运行副本（`BIOF3_DEVELOPMENT_PLUGIN_DIRS` + `BIOF3_DOMAIN_TOOL_REGISTRY`）；restart 原型的 drift 隔离 built-ins 副本改「包 manifest + 活跃插件 + 运行副本」且冷启窗口开发源指向副本本身；p6-ui110 描述符从已删的 `resources/built-in-plugins/` 改包内定位 |
| 2 | `25005849` | **UI-378 ①首启整页空白**：`DesktopOnboarding` 的 `if (packRequiresRuntimes === null) return null` 排在 3 个 `useCallback` 之前 → 首渲染 3 个 hook、判定落地后 6 个 → React 抛「Rendered more hooks…」卸载整棵树（`#root` 空）。守卫移到全部 hook 之后。同类隐患顺手清一处：`UpdateChecker` 的桥判定早退排在 `useAutoUpdate()` 之前 → 改无条件调用。新增两个回归门，可逆对照：早退放回 hooks 之前 → 4/4 红（同一条 React 错误） |
| 3 | `5f0172a6` | **UI-378 ②项目页全白（P6 渲染层直接真因）**：BLOCK-86 P2 把运行时横幅的 `useState`/`useEffect` 追加在 `ProjectWorkspace` 三个组件级早退（`if (loading)` / `if (error && !project)` / `if (!project)`）**之后** → 首渲染早退 164 个 hook、加载完成后 165 个 → React 卸载整棵树，深链 `/project/:id` 必现。整块上移到早退之前；新增源级回归门 `frontend/src/pages/project-workspace.hook-order.test.ts`（锁定「全部 hook 先于第一个组件级早退」） |
| 4 | `d86cfec8` | **p4r ui 链①**：corpus 目标 Job 走 `tool_run_tool` 直提、`conversation_id=NULL`，渲染层自 UI-123 起对深链做会话归属 fail-closed 校验（`project-workspace.tsx:1130`）→ 画布永不挂载。harness 侧补绑定：agent child 建会话后把目标 Job 绑到该会话（`UPDATE tool_jobs … AND conversation_id IS NULL`，`changes!==1` fail-closed） |
| 5 | `25437c34` | **p4r ui 链②**：驱动仍派发旧品牌事件 `biof3:project-open-artifact` / `biof3:project-open-result` / `biof3:theme-change`，BLOCK-61 改名后应用只认 `gewu:*`（`frontend/src/lib/events.ts`、`ThemeProvider`）→ 事件无人监听，重开结果等待超时 |
| 6 | `0b9d256c` | **p4r ui 链③**：（a）补 `dismissOnboarding`（fresh userData 下引导浮层盖住工作区、污染截图）——必须放在画布等待**之后**调用（React 挂载引导晚于 `loadURL`，过早探测会误判「无引导」）；（b）版本/变更面板（含「采用此版本」）现只在 `compare/history` 模式挂载（`ResultArtifactShell.tsx:1378`），驱动却仍在 `result` 模式等按钮 → 先切「审查修改」再等候选 |
| 7 | `db26530a` | **P6 重采证据刷新**：7 条 live 链全跑，canonical **10/10**；`componentCheckCounts` = stop 5 / executionFailure 7 / drift 7 / restart 11 / electronRecovery 15 / electronPressure 26 / productScenarios 6；`sourceCommit=5f0172a6`、`sourceCommitMatchesSourceHashes=true`、`sourceBindingStableDuringCapture=true`）。D8 例外族的 `p6_stored_current_source_hash_mismatch`（SimpleChat.tsx）**已消解** |
| 8 | `ba840ef4` | p4r ui 驱动 `clickMode` 改有界重试（15s/250ms）+ 失败时把 `navPresent/navButtons/canvasMode/bodyHead` 打到 stderr |

**已跑门的结论**（可复现）：
- `g0:result-studio:p6:syntax` OK；`g0:result-studio:p6:test` **365 项 → 358 过 / 0 红 / 7 项 opt-in skip**；`g0:result-studio:p6:frontend` OK。
- 前端 `tsc --noEmit -p frontend/tsconfig.json` = 0；新增/受影响单测：`DesktopOnboarding.test.tsx` 4/4、`UpdateChecker.test.tsx` 2/2、`project-workspace.hook-order.test.ts` 2/2、`ResultStudioChangeSetPanel.test.tsx` 21/21、`p4r-ui-observation.test.mjs` 5/5。
- **未跑**：`npm run closeout`、`docs:check`、`ui:audit:check`、`g0:result-studio:p4r:product`（都要等 ui 重采落定后一起跑）。

### 四、剩余工作（唯一主线：p4r ui observation 重采 → 整包 closeout）

#### 第 1 步 · 修完 p4r ui 重采的最后一段（**当前卡点**）

- 现象：`npm run g0:result-studio:p4r:ui:update` 推进到 `candidateLifecycleTrace` 首段即失败：
  `Error: Electron observation failed ({"code":1,"signal":null}): mode button not found: 审查修改`
  即使 `clickMode` 已改 15s 有界重试仍耗尽 → **不是瞬态**。
- 已定位的因果链：模式切换器只在 `canReviewVersions || canProjectSource` 时渲染，而 `canReviewVersions = Boolean(versionFamilyId)`；
  `versionFamilyId = viewedRevision?.artifactFamilyId || boundInteractionManifest?.artifactFamilyId || matchingActiveArtifact?.artifactFamilyId`（`ResultArtifactShell.tsx:1261-1264`）。
  → 该阶段三者同时为空，`nav[aria-label="结果视图"]` 整体不出场。
- **后端真值已核实齐备**（keep 现场查 SQLite）：基线 change set（`adopted`）+ 候选 change set（`preview_ready`，`conversation_id` 绑定正确）+ 会话 + 两个 volcano job 均在库 → 这是**投影/驱动面问题，不是产物链问题**。
- 同一阶段更早的两处已修（见提交 6）：引导浮层、事件名；更早的两处（提交 4/5）同理。也就是说本链已经过了 4 关，只剩这一关。
- **下一步建议动作（按序）**：
  1. 先让诊断可见：`g0-rs-p4r-ui-observation.mjs:238` 抛错时优先回显 `persisted?.error`，把子 Electron 的 stderr（含新加的 `[p4r-ui-driver] mode button missing` 摘要）**短路吞掉了**——要么同时打印 stderr，要么直接用 `--keep` 起一次并保留现场。
  2. `--keep` 现场取证：在 `keyboardTrace` 结束 → `clickMode('结果')` → `clickMode('审查修改')` 这段之间 dump 前端状态（`nav` 是否存在 / `canvas data-mode` / 当前 `viewedRevision` / `activeArtifact` 上下文 / `context-envelope` 响应），判定 `versionFamilyId` 是哪一分支丢的。
  3. 定性后二选一：
     - 若是**驱动/时序**（绑定 refetch 后需重新进入深链、或该用 `history` 模式取版本面板）→ 改 `scripts/g0-rs-p4r-ui-driver.cjs`（该文件属证据源绑定，**改完先提交再重跑**）。
     - 若是**产品缺陷**（重开结果后 `viewedRevision`/`activeArtifact` 上下文持续丢失，`versionFamilyId` 恒空 → 用户也无法查看版本/变更）→ 那是本包之外的真缺陷：先登记（AUDIT-LOG + UI 台账），**不要在本包内顺手改产品语义**，并把 ui 重采按例外登记转下一包。
  4. 重采通过后：`npm run g0:result-studio:p4r:ui:update` 写 `acceptance/g0-result-studio/rs-p4r-ui-observation.json`（当前存量证据 `sourceCommit=35a0760c`，远早于 UI-123/BLOCK-61/BLOCK-86，属同族漂移）。

#### 第 2 步 · 聚合门 + 收口回写五件套

1. `npm run g0:result-studio:p4r:product`（校验 perf / source-obs / live / ui 四份证据是否全部 source-bound @ HEAD；P4R 三份绑定 desktop `1357c4c4` + 包 `21d610c`，祖先提交持续有效；若第 1 步动了 `scripts/g0-rs-p4r-*` / `test/p4r-*` / `test/agent-tool-registry` / `test/impact-map.json`，对应证据要重采）。
2. plan `docs/g0-result-studio-plan.md` 状态头 → `completed`（写明重启增量 P0→P1+P6 重采→P2→closeout；Result Studio 维持 `implemented_unverified / experimental`；P7 维持 `deferred`）。
3. `docs/DOC-REGISTRY.json`：G0-RS `status: completed`、`phase: COMPLETED`。
4. `docs/next-steps-roadmap.md` + `docs/project-workspace-handoff.md` 头部前插收口摘要、active 槽位清空（下一包候选：G0-SDC / BLOCK-85 Mac 侧双真机验收 / P5 候选，**启动均需用户裁决**）。
5. `docs/ui-productization-audit.md`：**本轮有 UI 增量，必须更新**——UI-378 两条前端真缺陷修复（首启整页空白 / 项目页全白）目前只有 harness 实机证据 + 单测证据，**尚无用户视角实机验收**，按台账纪律标 `in_progress`，拿到用户复测证据才升 `verified`。

#### 第 3 步 · 门禁 + 提交推送

1. `npm run closeout`（hygiene → docs → ui-audit → test:changed，fail-fast）+ `npm run docs:reconcile` + `npm run docs:check` 全绿才算收口。
2. 提交 + `git push origin main`（网络曾抖动：HTTP2 framing / SSL_ERROR_SYSCALL，退避重试或 `-c http.version=HTTP/1.1`）。
3. 收口表行写进 `docs/AUDIT-LOG.md`（模板：门禁总账数字 / 实机断言数 / 范围守住 / 遗留候选 / 红旗归属 / 提交哈希 + 「G0 开发期常态 · 不外推 packaged/Provider/GA」恰一次）。

### 五、源绑定纪律（换 Agent 最容易踩）

- 自绑定脚本改完必须**先提交再重跑**，否则工作区≠HEAD 必红（本轮 `p6_stored_current_source_tree_not_exact` 就是这么来的）。
- 三份 P4R 证据（perf / source-obs / live）绑定 desktop `1357c4c4`（祖先有效）+ 包 `21d610c`；只动 docs/ 不会破绑定。
- P6 证据现已锚定 `5f0172a6`（本轮后续提交不含 P6 绑定文件，绑定仍成立）。
- Electron 实机链前置：独占总线端口 + **不能有其他 Electron 实例**（`src/main.js` 有 `requestSingleInstanceLock`，dev 栈在跑时 harness Electron 起来即退）。

### 六、本轮沉淀的教训（值得沿用）

1. **「域工具 Unknown tool」不等于域工具真缺**：封存态下要分清三条链路——插件装载面（`plugins/` vs `plugins.dormant/`）、领域工具注册表（`BIOF3_DOMAIN_TOOL_REGISTRY`）、描述符/输入路径（包内定位）。本轮先修工具层，才暴露出真正的渲染层问题。
2. **React hooks 顺序违规是「整页空白」级故障**：早退守卫只要在 hook 之后就可能崩；判定方法是「首渲染与二次渲染 hook 数不一致」。本轮两例都是近期提交把新 `useState` 加到了早退之后/之前。建议：新增 hook 一律写在组件体 hook 段内（早退之上）。
3. **诊断链要先复刻再下结论**：一次性 Electron 诊断 main（记录 renderer console / HTTP / DOM 快照）能在 2 分钟内定位「整页空白」的真因，比静态猜快得多（本轮 `/tmp` 探针：`panelPresent/canvasPresent` 一票否决）。
4. **驱动↔前端漂移是陈旧证据的常态**：存量证据越老，重采时暴露的漂移越多（本轮 ui 链连过 4 关：会话绑定 → 事件名 → onboarding → 面板挂载模式）。每修一关都要重新提交再重跑。

## 提示词正文（复制到这里结束）

## 附：关键文件索引

| 文件 | 说明 |
| --- | --- |
| `scripts/g0-rs-p4r-pack.mjs` | 包感知层（`locatePackPluginDir` / `stagePackPlugins` / `buildPackEnv` / `resolvePackCorpusInputs`），全链唯一包解析点 |
| `scripts/g0-rs-p5-acceptance.mjs` | `createP5LiveScientificRuntime`（封存态下单点注入运行副本 + 领域注册表），P5/P6 共用的隔离 runtime |
| `scripts/g0-rs-p6-product-acceptance.mjs` | P6 七条 live 链的捕获与证据写入（`--write-evidence`） |
| `scripts/g0-rs-p4r-ui-observation.mjs` / `g0-rs-p4r-ui-driver.cjs` | ui 重采本体与 Electron 驱动（**当前卡点所在**） |
| `frontend/src/pages/project-workspace.tsx:1130` | 深链会话归属 fail-closed 守卫（UI-123 起） |
| `frontend/src/components/workspace-panels/ResultArtifactShell.tsx:1261/1378` | `versionFamilyId` 推导 + 版本面板只在 compare/history 挂载 |
| `frontend/src/components/result-studio/ResultStudioChangeSetPanel.tsx:592` | 「采用此版本」按钮的渲染条件（`selected.status === 'preview_ready'`） |
| `frontend/src/components/desktop/DesktopOnboarding.tsx` / `DesktopSettingsPanel/sections/UpdateChecker.tsx` | UI-378 两处 hooks 顺序修复 |
| `acceptance/g0-result-studio/` | P4R / P6 / ui 三族证据目录 |
