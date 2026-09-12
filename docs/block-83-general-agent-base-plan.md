# BLOCK-83-GENERAL-AGENT-BASE：通用 agent 底座化与垂直领域插件平台计划

> 文档版本：v1.2（立项评估版 · 修订 2 平台化：生信降格为首个参考领域）
> 创建日期：2026-09-12
> 修订日期：2026-09-12
> 状态：**planned（排队候选，启动需用户裁决）**
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
| **P1** | Result Studio 通用化（前置）：D1 改名 + D2 去 `.R` 绑定 + D3 validator 钩子化；15 生信插件回归绿 | 定向测试 + 实机插件安装/run_tool 回归 |
| **P2** | 前端领域中性化：目录提供者 SPI 落地 + 解 7 处 import → inventory.ts 数据属性改为包供给；死代码残留清理（ProjectModality 等） | tsc 0 + 受影响 vitest + 空目录态 UI 诚实空 |
| **P3** | 核心扩展点定型：D10 脚本宿主泛化 + 确认钩子 SPI + 清单/安装适配独立包（远程清单），全程守 D12 词表纪律；finalize gate 科学理由码退场（钩子化） | 零网络定向测试 + agent loop 回归绿 + SPI 定义文件零领域词（D12 门禁） |
| **P4** | 生信包独立建仓迁移（D9）：插件+scripts+registry 内容+目录数据+R executor+demo+教程整体迁出核心树；核心残留摘除（scientific-task 链、datasets 资源名） | 核心树生信文件零残留 + D7 硬门绿 |
| **P5** | 收口：装包态生信全链回归（装→run_tool 通→卸→零残留）+ **D13 第二租户证明（非生信 demo 包走通全链）** + 纯通用态实机全功能 + 台账五件套回写 | 收口门禁 + D7 硬门 + D13 全链 + 实机证据（acceptance/block-83/） |

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
