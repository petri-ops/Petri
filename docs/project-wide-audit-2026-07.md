# BioF3 Desktop 全项目横切审计（2026-07-27）

规范编号：`AUDIT-PROJECT-WIDE-2026-07`

状态：`reference / qualificationEligible:false`

> 本文是一次只读代码横切审计的范围依据，不是资格证据，不升级任何 `qualified/maintained/verified` 声明，不改变当前 P4R 主线状态。所有结论以代码为准，附 `文件:行号`。文档声明的"已完成"在代码里可能不存在。修复优先级与是否启动独立工作包属用户决定；本文只登记事实。

最后核对：2026-07-27（HEAD `4f9d89f`，分支 `codex/g0-result-studio-product`，ahead 54）

## 0. 调查方法

六个维度并行/串行走查：科学插件层、安全隐私、用户旅程（三份完整深审）+ 前端架构、后端架构、工程治理（后三者经定向核实补齐）。每条发现均可回溯到代码。本审计不运行全量测试，依据为静态代码核对与 `tool_jobs` 开发库脱敏统计。

贯穿全项目的核心矛盾：**契约设计水平远高于契约执行水平**。仓库里 `artifact-profiles.js`、`result-studio-plugin-sdk.js`、`git-adapter.js`、`capability-bundles.js` 都是认真写的工程作品，但它们校验的是"声明"，真正决定用户结果的执行路径（R 脚本里的列名嗅探、同步阻塞、参数裸传）几乎不受这些声明约束。修任何维度，核心动作都是同一个：把已写好的校验层接到生产调用点上。

---

## 1. 科学正确性（最高危，14 项）

对科研工具，错误结果比崩溃更致命，因为研究者会把结果写进论文。按"错误结果被发表"的概率排序。

| # | 问题 | 依据 | 性质 |
|---|---|---|---|
| SCI-1 | **火山图默认用未校正 p 值判显著性**。默认 `pvalue` 而非 `padj`，全脚本 0 处 `p.adjust`；`padj` 列被读入但只原样抄进输出不参与判定。2 万基因表约 1000 个假阳性被标 Up/Down，而火山图正是进论文的那张图。`pval_col` 的 `parameterImpacts` 被错标为 `data` 而非 `scientific` | `volcano-plot.R:30,32,126,169-171` | 一行可修 |
| SCI-2 | **PCA 在无分组文件时凭空捏造分组**，按样本顺序均分 A/B 两组，输出带 Group A/B 图例蓝红配色，与真实条件 PCA 视觉无法区分 | `pca-explorer.py:59-62` | |
| SCI-3 | **PCA 分组回退按位置贴标签不做样本 ID 对齐**。分组文件缺 `sample` 列即落 elif 按位置赋值，每个点标签都是错的且不报错 | `pca-explorer.py:56-58` | |
| SCI-4 | **样本元数据校验器的"混淆设计检查"是空循环永远通过**，批次与条件完全混淆（会让整条 DESeq2 下游作废）的数据集拿到绿色 ✓ | `sample-metadata-validator.R:373-385` | 空循环只有注释 |
| SCI-5 | **DESeq2 静默接受 TPM/FPKM，四舍五入成整数当 counts 跑**，每个 p 值无效；`expression-qc.R:288` 本能检测却被从不读取 | `deseq2.R:146-147`；`expression-qc.R:288-293` | |
| SCI-6 | **GSEA/GO-KEGG 把基础设施故障包装成"阴性生物学结果"退出码 0**。OrgDb 缺失/KEGG 断网/msigdbr API 改名 -> 产出与真实零结果逐字节相同的产物，job 标 completed | `gsea.R:195,212-218`；`go-kegg.R:215-217,366-369` | 科研工具最不可接受的失败模式 |
| SCI-7 | **GO-KEGG 用全基因组做背景而非实际检验过的基因宇宙**（无 `universe=`），前景是已过滤矩阵，系统性抬高每个 term 显著性 | `go-kegg.R:212-214` | |
| SCI-8 | **物种非人类时静默回退人类**，else 吃掉一切；报告还把用户写的物种名原样回显——报告声称大鼠注释是人类。参数完全不做服务端枚举校验 | `go-kegg.R:101-109`；`gsea.R:94-102`；`tools-executor.js:981`；`registry.js:392` | |
| SCI-9 | **GO-KEGG 的 DEG 表识别失败静默退化成"全基因列表富集"**；最坏分支拿行号当基因 ID，而行号恰好是合法 Entrez ID，产出完全虚构但外观合理的富集结果 | `go-kegg.R:129-130,145-147,158-160,173` | |
| SCI-10 | **GSEA 无 `set.seed` 结果不可复现**；`pvalueCutoff` 硬编码 0.25 且不可调不声明，4 个调用点 | `gsea.R:50,69,192-208` | |
| SCI-11 | **WGCNA 模块-性状 p 值未多重校正，报告全网格 |r| 最大的裸 p**；基因-性状显著性同样未校正 | `wgcna.R:289-290,299,390-391,403,453` | |
| SCI-12 | **gene-correlation 无 p 值、无归一化、2 样本时相关系数恒 ±1**；"最变异基因"实为"最高表达基因"（未取对数 counts 上方差是均值单调函数） | `gene-correlation.R:29,33-35,38` | |
| SCI-13 | **expression-qc 的 PCA 画左奇异向量而非得分**，散布完全相同却标 20:1 方差比；离群检测 n≤5 时按算术恒不触发（z 分数上界 (n-1)/√n < 2），恰是单坏样本危害最大的小样本场景 | `expression-qc.R:436-438,453-454,462-465,473` | |
| SCI-14 | **DESeq2 部分样本对齐失败只警告不阻断**，12 样本只 6 个名字匹配照跑；警告在 run.log 用户看不到。3 组以上实验 factor 强制 levels 会让第三组变 NA 根本跑不了 | `deseq2.R:84-96,138,149,158` | |

**共同根因**：`params` 从 HTTP body 直接 `JSON.stringify` 写进 `params.json`（`tools-executor.js:981`、`mcp/registry.js:392`），descriptor 里的 `minimum/maximum/options` 从不被任何代码读取校验。`validateColumnSchema()`（`artifact-profiles.js:588`）生产代码零调用，只有测试调。

---

## 2. 安全与隐私

桌面本地应用威胁模型与 Web 不同，"本地进程可访问"不计为漏洞，只列**把边界扩到本机之外**的。

| # | 问题 | 依据 | 严重度 |
|---|---|---|---|
| SEC-1 | **`POST /api/run` 执行任意 R 代码 + 完全绕过 tool_job + CORS 全开**。直接 `execFile` 跑内嵌 Rscript，临时 workDir 用后删除，零 job 记录零 artifact truth，破坏唯一执行真相宣言。无鉴权 + `cors()` 通配 + R 黑名单可被 `eval(parse())`/`do.call('system')` 绕过。任意恶意网页可调 `localhost:3003/api/run` 执行本地 R 代码。**比 SEC-2 读文件更严重——那是读，这是执行** | `core/r-server/routes/r-compute.js:128,193,147-156`；`bootstrap.js:51` | 最高（之前所有报告漏报） |
| SEC-2 | **`/api/files/:key` 任意文件读取 + `ACAO: *`**。`storage.read`=`fs.readFileSync(path.join(resultsDir, key))` 零包含校验，`..%2F` 逃逸，一条 GET 读 SSH 私钥/`.aws/credentials`/未发表数据 | `core/r-server/routes/files.js:151-166`；`storage/local-storage.js:99-102`；`path-safe.js:17-22` 已有正确实现未用 | 高 |
| SEC-3 | **5 条后台自动向 LLM 外发用户数据，无告知无开关**。含表列名/文件路径/界面全文/原始文件内容/本机绝对路径/结果图片 base64。向量化默认发往 DashScope（第二家厂商）UI 无提示。`tool-defs.js:386` 要求模型用绝对路径与 `desktop-agent-prompt.js:30` 矛盾 | `agent-runner.js:845,1601-1651`；`helpers/system-prompt.js:72-82,174-176`；`workspace-tools.js:427-441,709-723`；`helpers/user-facts.js:240-285`；`helpers/memory-vectors.js:70-79`；`helpers/ai-settings.js:182` | 高（对未发表数据） |
| SEC-4 | **"完全访问模式"默认值 + 服务端 fail-open + 自动点掉所有确认**。`accessMode` 默认 `'full'` 纯组件 state 不持久化，服务端缺字段一律判 full，full 模式任何确认 120ms 后自动批准。默认配置下人在回路不存在 | `SimpleChat.tsx:167,616-625,759`；`ai-agent.js:514`；`agent-runner.js:831` | 高 |
| SEC-5 | **API Key 明文回传渲染进程可一键批量导出** | `main.js:997-1007`；`DesktopSettingsPanel.tsx:905-947` | 中 |
| SEC-6 | **脱敏在真实 key 格式上大面积失效**（JSON 引号值、火山方舟裸 UUID、智谱 hex.b64 全不脱敏）；落盘日志完全不脱敏，只在诊断导出那一刻过一遍 | `redaction.js:4,6,15,27`；`main.js:95-101`；`logger.js:13-25` | 中 |
| SEC-7 | **内置 webview 零 Electron 加固**：加载任意远程内容、`allowpopups:true`、地址栏任何 scheme 放行含 `file://`、`new-window` 防护是死代码（Electron 22 已移除） | `main.js:856`；`project-workspace.tsx:4228-4233`；`browser-url.ts:4` | 中 |
| SEC-8 | **`workspace_exec` 命令黑名单在 `sh -lc` 面前形同虚设**（换行即可绕过），而 `tool-defs.js:126` 对模型宣称"安全边界拒绝"——文档承诺强于实现 | `workspace-tools.js:606-645,691-699` | 中 |

**做得好的（别改回去）**：`git-adapter.js`（数组传参、禁 hooks、锁死环境变量、无 push 路径）是全仓库安全质量最高的模块；更新器有 https+同源+sha512 三重校验；CSP 生产 `script-src 'self'` 无 unsafe-eval；上传端点无路径穿越；workspace 文件工具路径包含性检查质量很高（被 SEC-1/根可指定架空，非自身写错）。

---

## 3. 用户旅程（核心断点）

| # | 问题 | 依据 |
|---|---|---|
| UX-1 | **无数据上传入口，但 Agent 指引去拖不存在的区域**。全前端唯一 `<input type=file>` 是导入模型配置；`plan-ui-tools.js:436` 让 Agent 说"已定位到上传区域，把 .h5/.rds 拖进去"，该区域不存在。后端 `POST /api/upload` 存在，前端零调用 | `plan-ui-tools.js:436`；`home.tsx:87`；`project-workspace.tsx:626-628`；`routes/files.js:168` |
| UX-2 | **5 分钟硬超时 + 10 分钟僵尸回收，真实长分析几乎必失败**。WGCNA/大矩阵 DESeq2 远超 10 分钟。开发库 1427 failed 剔除 1050 条测试 fixture 后，真实失败本质只有两个：R runtime 路径配错（252 条 ENOENT）和输入文件路径错（118 条 cannot open） | `tools-executor.js:761,1074`；dev DB `tool_jobs` 统计 |
| UX-3 | **跑起来的分析无法中断**：后端 `POST /api/tools/cancel/:id` 齐备前端零调用；聊天"停止"只 abort SSE + 置协作式标志，不杀 R 子进程 | `routes/tools-platform.js:60`；`SimpleChat.tsx:910`；`conversationRunStore.ts:392-418`；`agent-task-store.js:88,161` |
| UX-4 | **失败后看到一坨 R stderr 无重试按钮**。15 条 R 错误中文翻译只在 HTTP 路径生效，桌面走的 MCP 路径从不调用——实测 1427 次失败翻译表一次没触发。10 类故障诊断器只接 Harness Loop 不进 `/api/tools/status` | `project-workspace.tsx:3699-3703`；`tools-executor.js:1076-1132,512`；`registry.js:552`；`loop-failure-diagnoser.js` |
| UX-5 | **回访落地页是空白**（`mode=scheduled` -> 返回按钮 + 空 div），"分析记录"页左栏根本不渲染入口 | `home.tsx:25-36,113-119`；`project-workspace.tsx:2693-2709` |
| UX-6 | **首启不提 API Key 但预设让模型看起来已配好**，发第一条消息才报错，无"去配置"引导 | `DesktopOnboarding.tsx:33-36,180-226`；`useAiSettings.ts:58-70` |
| UX-7 | **默认 `accessMode='full'` 屏蔽执行前确认**：用户看不到即将跑什么/用哪个文件/什么参数；文件↔参数绑定按文件名猜，用户不知系统把哪个文件当 counts | `SimpleChat.tsx:616-625,759`；`harness-file-index.mjs:195-206` |
| UX-8 | **表格结果静默截断到 24 行无提示**，研究者会以为差异基因只有 24 个 | `project-workspace.tsx:2806-2812,3485` |
| UX-9 | **大量概念泄漏**：确认操作把 `run_tool(...)` 原文当用户消息打进对话；界面暴露 Honeycomb/Harness/Revision/ChangeSet/artifactId/裸枚举/Git SHA/存储去重 KB | `SimpleChat.tsx:604-606,1210,1285`；`project-workspace.tsx:3899,3752`；`ResultStudioChangeSetPanel.tsx:202,244,325` |

---

## 4. 后端架构

| # | 问题 | 依据 |
|---|---|---|
| BE-1 | **`POST /api/run` 完全绕过 tool_job/artifact truth**（见 SEC-1）。另：`callTool` 在 db 不可用时静默降级执行（`registry.js:346`），`createToolJob` 抛错只 warn 不 abort（`:347`） | `r-compute.js:128`；`registry.js:346-347,768` |
| BE-2 | **py-server 与 r-server 状态机不一致并发写同一库**：py 用 `status='pending'`、r 用 `'running'`；`busy_timeout` 5s vs 10s，无跨进程协调 | `py-server/r-server-db.js:29,60`；`db.js:25-26,888` |
| BE-3 | **`db.js` 2007 行混 schema DDL + 16 处内联 `try{ALTER}catch{}`（无版本追踪）+ 112 prepared statement + 119 CRUD + recovery + ack 流程**。两套 schema 演进并存（主表内联 ALTER vs result-studio 的 migration-runner）。`routes/tools.js:20` 注释引用 `006_tool_jobs.sql` 但该文件不存在 | `db.js:1-177,178-451,452-541,543-1566`；`src/migration-runner.js`；`routes/tools.js:20` |
| BE-4 | **112 个 prepared statement 仅 1 处用事务**。`createToolJob`+artifact、ack 流程、跨表更新全无事务，崩溃致不一致 | `db.js:1184`（唯一事务） |
| BE-5 | **`recoverZombieJobs` 只改 DB 状态不杀进程**，子进程继续烧 CPU/内存/磁盘；`killLocalToolJob` 只发 SIGTERM 无 SIGKILL 升级。是 UX-3"点停止 R 还在跑"的根因 | `tools-executor.js:428,158,455` |
| BE-6 | **`routes/index.js:38-44` 每个路由模块独立 try/catch 只 warn**：模块 require 失败该模块所有端点静默消失，无健康检查无告警。`server.js:146-149` 整个 routes 注册失败也只 warn | `routes/index.js:38-44`；`server.js:146-149,74-80` |
| BE-7 | **482 处同步 API 在请求路径**；`git-adapter.js:319` 同步 git 60s timeout；`uncaughtException` 不退出（"let pm2 decide"）在桌面单进程下是状态损坏风险 | `git-adapter.js:319`；`server.js:77-80`；`server.js:177-195`（自装 block monitor 间接自认） |
| BE-8 | **tool-jobs 目录无定期 GC**，孤儿目录磁盘泄漏；仅显式删除清理 | `routes/tools-platform.js:100`；`tools.js:112`；`cache-manager.js:444,452` |

**做得好的**：`callTool` 是唯一执行入口，注释明确"Scientific analysis is exposed only through installed plugin tools"；MCP 与 HTTP 路径在 job 记录上一致；结果契约从磁盘 manifest 读而非解析 stdout（R warning 污染不了结果）；`migration-runner.js` 有版本追踪 + transaction，设计合理（但仅 Electron 主进程跑，r-server 独立启动时不跑）。

---

## 5. 前端架构

| # | 问题 | 依据 |
|---|---|---|
| FE-1 | **`ResultArtifactShell` ~1190 行内联组件不 export 零测试**，承载选择串行化队列+乐观更新+回滚、artifact 优先级、recovery 流、manifest 降级——前端最复杂逻辑单元。P4R-2 刚开始往外抽纯谓词，主体未动 | `project-workspace.tsx:2816-4004` |
| FE-2 | **mode 路由两套实现**：`useWorkspaceRouting` hook（死，生产零调用）+ 内联同步（活）。代码注释自认。比纯死代码更糟，维护者会以为 hook 是真相 | `useWorkspaceRouting.ts:30-54`；`project-workspace.tsx:241-242,374-377,397-422` |
| FE-3 | **`fetchData` 失败后成功路径不清 error（真实 bug）**：一次轮询失败 error 永驻，`:1313` 守卫持续显示错误屏，即便下次轮询成功也要刷新页面才能恢复 | `project-workspace.tsx:735-755,1313` |
| FE-4 | **`ResultArtifactShell:2979` fetch 失败静默吞掉 result 保持 null，落到 `:3725` 显示"分析已完成但未生成可视化结果"**——把网络/服务错误谎报成"无结果文件"。`fetchDir` 同样吞错返回空数组伪装空目录 | `project-workspace.tsx:2979,3725,1759,1142` |
| FE-5 | **两个 `SimpleChat` 实例并存**（CenterPanel + RightPanel）各自持有 messages state 各自拉取；`ownsCopilotAsk` 门只挡事件订阅没挡消息拉取 | `CenterPanel.tsx:162-173`；`RightPanel.tsx:199-204`；`SimpleChat.tsx:156,579` |
| FE-6 | **`searchConversationIndex` 绕过 sharedCache 直接拉全项目会话**，第二套会话真相 | `project-workspace.tsx:296,612-625` |
| FE-7 | **重复实现**：`formatSize`×3、CSV 解析×2、`formatDate` 纯死码、`openRightPanel` 死抽象；7 处手写 fetch 不复用 `result-studio-interaction-client.ts:44-56` 已有封装；2s 全量文件树轮询连带触发预览重跑 | `project-workspace.tsx:4507,2247,2807,4515,425-430,1708,1810,1998`；`DesktopSettingsPanel.tsx:270`；`PluginStorePanel.tsx:192` |
| FE-8 | **`data-mode` 属性设了但零 CSS 选择器命中**（注释自认），只为测试存在；16 个响应式断点无统一 scale | `resultMode.ts:13`；`ResultStudioSurface.tsx:61` |

---

## 6. 工程治理

**规模**：53 个 docs markdown（15901 行）、62 个 scripts（14745 行）、158 个 npm scripts、73 份 acceptance 证据 JSON、176 个测试文件（根 133 + 前端 43）。

| # | 问题 | 依据 |
|---|---|---|
| GOV-1 | **空转门机制已基本堵死，残留 1 处**。`test-affected.mjs:107` 对未知映射 fail-closed 返回 2；`npm test` 已改为定向测试。残留 `g0-rs9-product-acceptance.mjs:34` 仍用裸 `npm run test`（= `vitest run --changed`），属 RS9 历史 non-qualifying 证据，不 underwrite 当前 maintained 声明 | `scripts/test-affected.mjs:85,107`；`g0-rs9-product-acceptance.mjs:34` |
| GOV-2 | **虚假保障（最危险的失效模式）**：73 份证据里 27 份在 scripts/ 下无生产者。其中 `rs-p1-result-surface.json` 无生产者无测试断言但 `passed:true`（一次性生成手动提交无法重跑）；`rs9-ui/inspection.json` 纯人工布尔值零写入者（AUDIT-LOG 视觉证据问题的同类）。"形状被校验但内容无来源"比"没测"更危险，让人以为被防住 | `acceptance/g0-result-studio/rs-p1-result-surface.json`；`acceptance/g0-result-studio/rs9-ui/inspection.json` |
| GOV-3 | **证据税集中**：`routes/result-studio.js` 被 6 份证据锚定、`project-workspace.tsx` 被 4 份、`package.json` 被 2 份——恰是 P4R 每步必改的文件，刷新证据是每次提交税 | acceptance sourceHashes 抽查 |
| GOV-4 | **根 `check` 是纯 `node --check`（只查语法不查行为）+ 专项门串联**，大量专项门之间有测试重叠；`node --check` 保证文件能加载但不验证运行时行为 | `package.json` scripts.check |
| GOV-5 | **文档陈旧**：抽查 26 份，8 份明显失真（把已完成的 Loop Engineering/Phase 7 写成"当前活跃"、引用不存在的 tools.tsx/dashboard/vendor 路径、版本冻结在 rc.6），5 份存疑（未提 P4R）。失真最严重：`development-module-map.md`、`v1-productization-roadmap.md`、`first-success-path.md` | docs/ 抽查（详见各文件） |

**收益判断**：这套体系**确实防住过真实缺陷**（RH0 的 fail-closed 定向测试、golden fixture 漂移检测、`test-affected` 未知映射报错都是有效保障），但成本集中在每次提交的证据税和文档同步上，且有相当一部分是纯 `node --check` 语法检查冒充行为验证。当前 P4R 阶段引入 `not_captured_no_browser_automation_in_repo` 诚实降级是对的方向，应推广到历史证据。

---

## 7. 修复优先级建议（供用户决策，本文不裁决）

**第一梯队（几行代码，直接阻断硬伤）**
1. SEC-1：`/api/run` 加 tool_job 记录 + 收紧 CORS + R 黑名单改正面拦截。同时堵 SEC-2（`/api/files` 复用 `path-safe.js`）。
2. SCI-1：火山图 `pval_col` 默认改 `padj`。
3. UX-2 + BE-5：拆 5/10 分钟双超时改心跳判活；`recoverZombieJobs` 杀进程 + `killLocalToolJob` 加 SIGKILL 升级；`loop-failure-diagnoser` 接 `/api/tools/status`。

**第二梯队（结构性，改动可控）**
4. SCI 类根因：在 `tools-executor.js:981`/`registry.js:392` 前插入基于 descriptor 的参数校验；把 `validateColumnSchema()` 接到执行前置检查。
5. UX-1：加真正数据上传入口 + 接 `validateUploadedFiles` 到执行路径。
6. SEC-3/SEC-4：LLM 数据外发知情开关 + 默认 `accessMode` 改 `'read'` + 移除自动批准。
7. FE-3/FE-4：修 `fetchData` 错误不清 bug + `ResultArtifactShell` 空 catch 显式化。

**第三梯队（治理净化）**
8. GOV-2：清理无生产者证据，历史人工布尔值证据按 P4R 先例降级为 `unmeasured`。
9. GOV-5：收敛 8 份陈旧文档，`g0-current-work-package` truthDomain 统一回填 P4R。
10. FE-1：`ResultArtifactShell` 拆出并补测试。

---

## 8. 审计边界与移交

- 本审计**只读代码**，未运行全量测试，未触碰任何资格状态、`support-matrix.json`、`evidence-ledger.json` 或 P4R 主线。
- `qualificationEligible:false`：本文是范围依据不是资格证据。
- 关键发现已登记进 `AUDIT-LOG.md` 待评估项；本文件是其完整依据。
- 修复优先级、是否启动独立工作包、是否插队 P4R——均属用户决定。本文只登记事实，不裁决顺序。
- 部分发现（`/api/run` 执行洞）严重程度超过 P4R 剩余 UI 工作，但按单工作包串行纪律不自动插队；冲突需用户定夺。
