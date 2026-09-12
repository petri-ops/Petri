# BLOCK-83-GENERAL-AGENT-BASE：通用 agent 底座化与垂直领域插件平台计划

> 文档版本：v1.2（立项评估版 · 修订 2 平台化：生信降格为首个参考领域）
> 创建日期：2026-09-12
> 修订日期：2026-09-12
> 状态：**completed（2026-09-12 P0–P5 整包收口；生信包已独立交付 Diandian-ops/gewu-pack-bio）**
> truthDomain：block-83-general-agent-base
> 关联：`agent-workbench-enhancement-plan.md`（active，方向同源）、`g0-result-studio-plan.md`（P6 证据重采归属）

---

## 0. 修订链（2026-09-12 同日三轮裁决递进）

### 修订 1：微内核 + 领域包

用户裁决「生信作为独立存在 随时彻底清理」→ v1.0 的「核心仓内可选内置插件」不够（插件宿主代码仍住核心树）。v1.1 目标：核心只留**领域中性的扩展点**（工具注册 SPI[已有] / 脚本运行时 SPI[tools-executor 泛化] / 工具目录提供者 SPI[新增] / 确认校验钩子 SPI[新增] / 渲染器扩展点[新增]），生信一切功能代码迁出核心树进独立交付物（独立 git 仓库，如 `gewu-pack-bio`），分发走既有远程插件清单机制（`getRemoteManifest` 已存在）。**「随时彻底清理」验收判据**：① 清理动作不改核心代码；② D7 生信关键词扫描升格硬门。诚实边界：git 历史不追改 / DB 生信表留置 / 命名残留另行裁决（D11）。

### 修订 2：平台化——生信降格为首个参考领域

用户裁决「通用基座后期扩展**其它垂直领域**的能力，生信分析就是其中的一个垂直领域，我需要的是彻底的那种」→ 五个 SPI 不是「为搬生信留的口子」，它们就是**垂直领域扩展平台**本身：

- **核心基座 = 垂直领域扩展平台**；SPI 契约是平台的产品；生信包 = 租户 #1 / 参考实现（它存在的意义之一是证明平台够用）；未来化学/金融/影像等垂直领域走同一条接入路。
- **纪律一（D12）SPI 词表零领域词**：扩展点契约禁止任何领域词汇渗入——脚本宿主契约是「解释器+输入+输出」而非「R脚本+CSV报告」；确认钩子是「任务确认钩子」而非「科学确认」。判据机械化：SPI 定义文件纳入关键词扫描硬门（生信及其它领域词零命中）。
- **纪律二（D13）第二租户证明**：收口验收必须装载一个**非生信 demo 垂直包**走通全链（注册工具→目录可见→run_tool 通→渲染），证明插座无生信私货。既有先例：`agent-tools/plugins/example-hello/`，升级为正式验收项。
- **诚实的平台天花板**：DB schema、全局路由、窗口系统、插件运行时本身永远由核心持有（单一真相红线）；垂直包数据进自有命名空间存储或文件。未来某领域若确需自有业务表，届时再裁决「命名空间存储扩展点」，现在不预建（YAGNI）。

v1.0 现状盘点（§2）与 D1-D11 继续有效，阶段微调（§4）。

---

## 1. 背景与用户裁决

两轮会话裁决（2026-09-12）：

1. **剥离裁决（原话）**：「生信功能应该作为目前通用 agent 的一个插件存在 如果不需要了 剥离彻底清理掉……模块化思想」——目标形态＝Gewu 底座是通用 agent 工作台，生信是**可卸载的插件集合**，卸载后产品面零生信残留。
2. **Result Studio 定位裁决**：用户在三选一中**同意方向 1**——Result Studio 机制层（job→artifact→revision→changeset→adopt/revert/restore/replay）**升格为底座的「通用产物工作台」**：去掉科学命名、去掉 plugin SDK 的 `.R` 硬编码、validator 降为插件可注入钩子。它是生信剥离的**前置配套**——拔掉生信后它不是孤儿，而是未来所有插件产出可迭代产物的公共基础设施。

## 2. 现状盘点结论（2026-09-12 全仓侦察，文件级清单待 P0 冻结）

去生信化已完成大半：`frontend/src/pages/` 已全部通用化（无 single-cell/spatial 路由页）；r-server/py-server/gateway 已摘除；15 个生信工具插件已住 `resources/built-in-plugins/`，骑在通用 `run_tool → tool_job → artifact` 管道上，反向依赖健康。

剩余耦合面分层：

| 层 | 内容 | 处置 |
| --- | --- | --- |
| **A 天然通用（保留）** | pages/ 全部、chat/agent-runner/loop-orchestrator 骨架、ai-* 路由、workspace/computer/多agent 工具、knowledge、skills、llm-providers、mcp registry 机制、插件安装管道、git/files/ssh/remote、DB 通用表 | 底座 |
| **B 生信专用（剥离）** | `tool-registry.js` + `tool-scripts/`(69 文件) + demo 数据 + `image/`；前端 `tools/inventory.ts`(2,095 行) + 7 处通用组件 import 链；`harness/scientific-task` 子域 + `scientific-task-*` + `scientific-replay-package` + `result-scientific-*`；`r-executor.js`/`r-libs-resolver.js`；DB 4 表（datasets/analyses/subsets/cell_labels，**留置不迁移**）；static 教程图片 | 约 90 后端文件 / 2,200 前端行 |
| **C 灰色（归底座+改名/钩子化）** | Result Studio 全家桶（~40 文件 + 8 表，机制通用）；g0 治理框架（实为质量治理）；`tools-executor.js`（通用执行器，解科学工具形态绑定）；死代码残留（`ProjectModality`、copilotContext 单细胞枚举、`query/read_page/search` 的 datasets/analyses 资源名） | 本包 P1 |
| **D 风险链（拆除时会打断）** | ① 7 处前端通用组件 → `@/pages/_data` → inventory.ts；② loop-orchestrator/agent-runner → result-context-binding + finalize gate 科学理由码；③ `db.js:1092` 引 scientific-task-confirmation；④ 插件契约强制 Result Studio descriptor；⑤ system-prompt `biof3://` URI 与科学确认分支 | P0 逐项设计解法 |

**插件系统真实缺口**：插件目前只能贡献工具/内容/运行时，**不能贡献 UI 页面、渲染器、确认流**；生信插件靠内置清单默认全量安装，无按需安装。

## 3. 设计裁决 D1-D8（⏳ 全部待 P0 评审，逐项核实代码事实后呈用户确认）

- **D1 Result Studio 改名边界**：代码层/API 层命名去科学化（ScientificChangeSet→ChangeSet 等）；**DB schema 表名/列名留置不改**（既有纪律：schema 只能可空扩展，禁止改名/迁移）。
- **D2 plugin SDK 去 `.R` 硬编码**：脚本路径模板参数化解释器（`.R`/`.py`/任意），**向后兼容** 15 个现存生信插件（不改它们的 plugin.json 即可继续安装运行）。
- **D3 validator 注入点契约**：科学 validator 从 finalize gate 硬编码降为插件可注入钩子（无插件注入＝零校验直通，行为与「无生信安装」一致）。
- **D4 inventory.ts 替代方案**：工具目录从静态硬编码改为按插件安装态动态投影；或保留目录形态但内容源改为插件 manifest。⏳ 两案取一。
- **D5 生信插件分发形态**：内置清单 → 可选安装清单（插件商店可见、默认不装）；已装用户零影响。
- **D6 extraRenderers 协同**：占位 flag 升格为真渲染器扩展点，与 AGENT-WORKBENCH（UI-AGENTWB-004 extraRenderers 注入桥）共用同一契约，避免两套扩展点。
- **D7 剥离验收判据机械化**：新增机械门禁（生信关键词/import 扫描：`single-cell|seurat|deseq|gsea|...` 在 core/shared-backend/frontend 生产代码零命中；插件目录除外）。
- **D8 P6 源绑定证据漂移处置**：B/C 类文件移动/删除会使 `g0-rs-p6-product-acceptance` 源绑定门 fail-closed → 按既有例外登记（重采属 G0-RS 范围），不阻塞本包收口。
- **D9 生信包交付形态（修订 1 新增）⏳**：独立 git 仓库（推荐，彻底独立、核心树零生信文件）vs 同仓子目录 vs 构建产物 zip；分发走远程插件清单。P0 评审定案。
- **D10 tools-executor 归属（修订 1 新增）⏳**：泛化为领域中性「脚本工具宿主」（任意解释器+数据文件+报告）留在核心 vs 随包搬走。推荐前者——它是插座不是电器，通用插件（含未来非生信脚本工具）都受益。
- **D11 命名残留边界（修订 1 新增）⏳**：`biof3-server` 目录名/`biof3://` URI/`biof3.db` 等品牌遗留本包不动；是否另立品牌收尾包由用户裁决。
- **D12 SPI 词表零领域词（修订 2 新增）**：扩展点契约定义禁止任何领域词汇渗入（脚本宿主=「解释器+输入+输出」非「R脚本+CSV报告」；确认钩子=「任务确认」非「科学确认」）；SPI 定义文件纳入关键词扫描硬门。非裁决项，是本包设计红线。
- **D13 第二租户证明（修订 2 新增）**：收口验收装载一个非生信 demo 垂直包走通全链（注册工具→目录可见→run_tool 通→渲染），先例 `agent-tools/plugins/example-hello/` 升格为正式验收项。
- **D14（远期候选，本包不实现）命名空间存储扩展点**：仅当未来某垂直领域确需自有业务表时另行裁决，现在不预建（YAGNI）。

## 4. 阶段划分（v1.1 按微内核+领域包重排；启动后按序串行）

| 阶段 | 内容 | 出口判据 |
| --- | --- | --- |
| **P0** | 立项评审：D1-D11 逐项核实代码事实落评审稿 → 用户确认（D12/D13 为设计红线随阶段执行，D14 本包不做）；B/C/D 清单冻结到文件级（产出搬迁清单与顺序） | 评审稿 + 用户裁决 |
| **P1** ✅ completed（2026-09-12） | Result Studio 通用化：D1 改名 + D2 去 `.R` 绑定 + D3 钩子化，三切片落地 | 实机 4/4 allPass（acceptance/block-83/）+ 契约测试 7/7+11/11+30/30 |
| **P2** ✅ completed（2026-09-12） | 前端领域中性化：目录提供者 SPI（后端自插件投影）+ 6 处消费方迁移 + `tools/` 目录整体退役（inventory 2,095 行 / registry / categories / _data） | tsc 0 + 受影响 vitest 30/30 + 实机 flow 8/8 allPass（acceptance/block-83/） |
| **P3** ✅ completed（2026-09-12，D10 缝已立/R 档案迁出归 P4） | 核心扩展点定型：D12 注册表驱动「需用户输入」分类（核心不再硬编码领域错误码）+ 理由码/故障类别词表中性化（存量兼容）+ **D7 领域中性化棘轮门禁**（扫核心生产代码，只拦新增/恶化）+ D10 语言描述符 SPI 缝（表现层 6 处中性化；7 处行为分支=R 档案本体随 P4 迁出） | 门禁 2/2 + loop 族 283 测试全绿 + 负例验证门禁会咬（注入领域词即红） |
| **P4** ✅ completed（2026-09-12，四切片全部落地） | 生信包独立建仓迁移（D9）+ 核心树生信内容删除 + D7 基线销号 | **出口实机 8/8 allPass**（acceptance/block-83/block83-p4-exit-live.json：零生信态 catalog=0 / runtime 清单幸存 / 核心文件零残留 / 生信包装载 15 / D13 第二租户装载无混入） |

**P4 切片进度**

| 切片 | 内容 | 状态 |
| --- | --- | --- |
| 1 | **包骨架 + 装卸缝实证**：独立包仓库建立（`gewu-pack-bio`，本地 git 首提交 268 文件/6.3MB，含 `pack.json` 契约 + 15 插件 + 69 脚本 + demo 数据 + 安装索引生成器）；**核心以包为唯一插件源跑通**（内置目录移走 → dev 栈 15 插件全部来自包 + 目录 flow 8/8 allPass） | ✅ 2026-09-12 |
| 2 | **核心树内删除生信内容**（314 文件：built-in-plugins/tool-scripts/tool-demo-data/tool-demo-results/image/demo-data）+ B 类 16 测试全数迁移（前置+2a+2b 三批）+ manifest 运行时拆分（`resources/runtime/`）+ tool-registry 中性化（空表+env 注入）+ tasks/scenario 路径改包 + 静默跳过反模式修复 + D 条目清理 | ✅ 2026-09-12 |
| 3 | **注册链随包化**：D10 余 7 处行为分支 + R 档案（`r-executor`/`r-libs-resolver`/运行时探测）+ scientific-task 契约链随包注册；`biof3://` URI 与 datasets 资源名清理 | 待办 |
| 4 | **D7 基线销号**：158 → **144 条**（tool-registry 14 条随中性化清零）；远程建仓 ✅（`Diandian-ops/gewu-pack-bio`，用户指定账户，凭据 API 创建+推送） | ✅ 2026-09-12（剩余 144 条=agent-runner 提示词/learning/plan-ui 等代码层残留，属 P4 尾部延续清理+P5 门禁监控对象） |

**P4 尾部清债（2026-09-13，用户夜间授权「遗留 A 一次清干净」）**：① A 类 9 个核心旧副本删除（cellchat/celltypist/seurat-standard/scanpy-advanced/scvi-tools 五 smoke + deseq2-report + g0-chf0-science + p4r-corpus + harness-file-index；包仓副本在彼处运行，删除前核心侧基线实测 119 测试/99 红）；② C 类 2 项按本节语义改造——`g0-rs-p5-acceptance` 源绑定删 17 条生信路径 + 描述符/夹具经 `findBioPackRoot()`（兄弟仓或 `BIOF3_BIO_PACK_ROOT`）解析 + 主入口包缺失显式 SKIP；`g0-rs-p6-electron-pressure-prototype` 源绑定删 7 条生信路径 + go-kegg 夹具包根解析 + producer 测试包缺失显式 skip；③ 悬空引用清理（`g0-chf0-acceptance.mjs` 移除已删源条目与 SCI 契约→核心门 SEC-1/SEC-2/BE-5 3/3 转绿（自 P4 删文件起首次可运行）；`g0-rs-p4r-acceptance.mjs`/package.json/impact-map 移除已删测试引用）。**基线对照**：`g0-rs-p6-product-acceptance` 7 红→2 红（净改善 5）；余 2 红属 D8 例外（P6 证据重采属 G0-RS）。**登记归属 G0-RS**：`g0:result-studio:p4r:perf` 的 corpus 生成链需包感知化改造（go-kegg 夹具/插件源指向包根+真实 R 运行时）——结构性 RS 线工作，非测试债。

**D9 包仓库事实（切片 1）**：本地路径 `D:\1.WorkDir\gewu-pack-bio`（与核心仓平级，独立 git 仓，初始提交 `2a51b73`）；包契约 `pack.json` 声明提供物（plugins/scripts/demoData/languages/confirmationHooks/artifactTypes）与所需核心能力；核心侧装卸缝 = `BIOF3_PLUGINS_DIR`（installed 源，需 `plugins/installed.json` 索引，由包内 `tools/generate-installed-index.cjs` 生成）。
| **P5** ✅ completed（2026-09-12） | 收口对账：D7 硬门（棘轮 2/2，基线 144=延续清理监控面）+ D13 第二租户证明（P4 出口 8/8 内）+ 零生信态实机（catalog=0 诚实空态/runtime 幸存/文件零残留）+ 装卸结构回归（包 15 装载/卸载即回零态）+ 台账五件套回写 | hygiene/docs:check 231/ui-audit/tsc 0/D7 2/2/契约 14/14 全绿 |

### D7 残留清单（P2 出口盘点，P3 起点）

P2 前端中性化后，核心生产代码（非注释）仍残留的领域词锚点，按归属登记，供 P3（后端剥离）+ D7 门禁落地时逐项销号：

| 位置 | 残留形态 | 归属处置 |
| --- | --- | --- |
| `core/biof3-server/api-data.js:202-203` | dataset modality 白名单 `[general, single-cell, spatial, bulk]` + 缺省 `single-cell` | P3：datasets 域面随生信包；核心不约束取值 |
| `core/biof3-server/db.js:379,382` | `projects.modality` 列 DEFAULT `single-cell` + NULL 回填 | P3/P4：schema 级（additive 纪律——改 DEFAULT 需迁移，随建仓迁移一并裁决） |
| `frontend/src/pages/project-workspace.tsx:937` | dataset 行 `type: nCells != null ? 'single-cell' : undefined` | P3：数据集体检面随域包（或改中性命名） |
| `frontend/src/lib/copilotContext.ts:7-15` | `CopilotPage` 的 8 个生信页面枚举 + 路由映射（`copilotContext.ts:177-179`） | P3/P4 候选：web 时代路由残留，有测试覆盖（`copilotContextProvider.test.tsx`），处置需同步改测试 |
| 注释层若干（`errorMessages.ts` / `SimpleChat.tsx` / `types.ts` / `Icon.tsx` / `App.tsx`） | 领域词出现在注释与图标命名 | P3 随 D7 门禁词表落地时一并清理（注释不计入硬门判定，但建议同步） |

D7 门禁（P3 落地）扫的是**代码 token** 而非注释，因此注释层不计入 fail；上表前三行与 `CopilotPage` 是硬门红灯的真实来源，须在 P3/P4 内销号或显式登记豁免。
### P4 切片 2 执行计划（29 个依赖内置插件/脚本的测试文件级分类）

> 2026-09-12 全量只读分析产出。分类口径：**A 随包迁出**（断言生信领域语义）/ **B 留核心改中性夹具**（断言核心机制，恰好拿生信插件当例子）/ **C 留核心但需包存在**（核心验收门但需真实插件形态）/ **D 直接删**。

**A 类：随生信包迁出（9 个）** —— cellchat-smoke / celltypist-smoke / seurat-standard-smoke / scanpy-advanced-smoke / scvi-tools-smoke（五个插件包完整性 8 件套 + manifest schema + R/Py 入口）/ deseq2-report（报告模板锚点与脚本 token 替换）/ g0-chf0-science（真跑 volcano-plot.R + pca-explorer.py 的 padj 与 PCA 元数据语义）/ p4r-corpus（真 R 跑通 deseq2→deg→volcano→go-kegg 语料链）/ harness-file-index（按意图排序工具，20 处读三插件描述符）。
**B 类：留核心改中性夹具（18 个 = 16 测试 + 2 配置）** —— agent-approval / agent-run-tool / agent-tool-policy / agent-vision / block83-task-confirmation-hooks / data-profiler / hle-c5r-regression / mcp-builtin-discovery / mcp-tool-registry / platform-compat / plugin-loader-refresh / plugin-manifest-schema / plugin-schema-strict / result-edit-controls / result-plugin-validator / result-studio-plugin-sdk；配置面 `test/impact-map.json`（4 处 built-in 规则）与 `test/fixtures/harness-scientific-task/tasks.json`（harness 科学任务语料）。
**C 类：留核心但需包存在（2 个）** —— g0-rs-p5-acceptance（RS-P5 证据卡 + 真起 HTTP 的 live scientific runtime）/ g0-rs-p6-electron-pressure-prototype（P6 压力原型静态契约）。二者 source-binding 列表须删生信路径，live 旅程改「包存在则跑、缺失则**带理由显式 skip**」。
**D 类：条目级删除 3 处** —— seurat-standard-smoke:257/:264（守卫将被删路径的断言，迁移后 moot）、mcp-tool-registry:56/:64（与 built-in 无关的保留项）。

**执行前置（阻塞全部 B/C）**：新建 `test/fixtures/neutral-plugins/` 中性分析插件包（`plugin.json` + `tool-definition.json` + 脚本 + 合法 `resultStudio` 块 + golden revision），装载型测试统一把 `BIOF3_BUILT_IN_PLUGINS_DIR` 指向它。注意：现成的 `agent-tools/plugins/example-hello/` **不可用**（agent-tool 插件，无 `tool-definition.json`）；可参考的中性形态是 `acceptance/harness-plugin-prototype/`。

**两处额外风险（同一交付面，勿漏）**：① `test/tool-scripts-dependencies.test.mjs` 引用 `core/biof3-server/tool-scripts/`（不经 built-in-plugins，前述 grep 未命中），分类同 C；② **静默跳过反模式**——`mcp-tool-registry.test.mjs:169`（`if (!hasDemo) return`）与 `mcp-builtin-discovery.test.mjs:17`（`skip: !hasBuiltIn`）删除本地插件后会「绿着假过」，必须改为带理由的显式 skip（`p4r-corpus` 顶部注释已明确拒绝该反模式）。

**运行时发行物须拆分别删**：`resources/built-in-plugins/manifest.json`、`manifest.schema.json`、`manifest.placeholders.json` 中 `biof3-r-runtime` / `biof3-py-runtime` 属**核心运行时发行物**，与生信插件条目拆开后保留；仅生信插件条目随包迁出。

**建议顺序**：① 建中性夹具基础设施 → ② 清「1 行级」B（data-profiler / agent-tool-policy / platform-compat / plugin-schema-strict / result-plugin-validator）→ ③ 清中等 B（agent-approval / agent-run-tool / mcp-builtin-discovery / mcp-tool-registry / plugin-loader-refresh / result-edit-controls / result-studio-plugin-sdk / block83-task-confirmation-hooks / plugin-manifest-schema / hle-c5r）→ ④ 迁出 A（先 5 smoke + deseq2-report + g0-chf0-science；p4r-corpus 随语料脚本、harness-file-index 待 `scripts/harness-file-index.mjs` 归属定）→ ⑤ 改 C（涉及证据 hash 刷新，改一次要重跑验收）→ ⑥ 收尾（D 条目删除、impact-map 规则重写、tasks.json 路径更新）。
## 5. 范围外与非范围

- 不做 Result Studio 机制层重构（它是保留下来的底座，只改名/解绑/钩子化）。
- 不删除 DB 生信表（留置；空表无害，删除 migration 破坏已装实例的 schema 演进链；字节级彻底需用户显式裁决 drop migration）。
- 不破坏 15 个生信插件的安装/运行能力（修订 1：从「默认内置」变「独立包按需安装」，功能本身不退役）。
- 不动命名残留（`biof3-server` 目录名/URI/db 文件名，D11 另行裁决）。
- G1+ 阶段事项不外推（packaged/Provider/GA）。
- 与 G0-RS 的 P6 重采、AGENT-WORKBENCH 的 P1.4/P2 各自独立，文件面交汇处（extraRenderers）启动时显式划界。

## 6. 风险诚实登记

- finalize gate 科学理由码摘除涉及 agent loop 收尾语义，是全包最高风险点（P3），需定向回归 + 实机对话双保险。
- `tools-executor.js`（2,642 行）解科学工具形态绑定可能牵出 hidden 耦合，P0 冻结清单时专项核实。
- 改名面宽（代码/API/文档），一次会话收不完，按 P1-P5 串行分批提交，每阶段独立可回退。

## 7. 验收门禁预声明（收口时逐项对账）

- **D7 机械扫描门禁升格硬门**：核心生产代码（core/ + frontend/src/ + src/，插件包目录与 SQL migration 除外）生信关键词零命中；SPI 定义文件按 D12 同门禁（零领域词）；「清理动作不改核心代码」由此门机械化保证。
- 无生信包安装态实机：启动零生信注册 + 通用 agent 对话/工具/文件/终端全功能可用（dev Electron 断言，证据落 `acceptance/block-83/`）。
- 生信独立包装卸回归：远程清单可见 → 装 → run_tool 通（R 真跑）→ 卸 → 核心树与运行态零残留。
- **D13 第二租户证明**：非生信 demo 垂直包装载走通「注册→目录→执行→渲染」全链。
- 定向测试 + tsc 0 + 收口门禁（hygiene/docs/ui-audit/test:changed）三绿+。

## 8. 与 AGENT-WORKBENCH 的关系

方向同源（都是「通用 agent 底座化」）。当前 active 槽位归 AGENT-WORKBENCH（P1=P1.4 参数确认卡片）；本包排队，启动顺序由用户裁决。两包文件面天然隔离（本包动 tool-registry/scientific-chain/inventory，AGENT-WORKBENCH 动 copilot 组件族），唯一交汇点 D6（extraRenderers）在 P4 启动时与 AGENT-WORKBENCH 当前状态对齐。

G0 开发期常态 · 不外推 packaged/Provider/GA。
