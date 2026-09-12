# BLOCK-83-GENERAL-AGENT-BASE：通用 agent 底座化与生信插件化剥离计划

> 文档版本：v1.0（立项评估版）
> 创建日期：2026-09-12
> 状态：**planned（排队候选，启动需用户裁决）**
> truthDomain：block-83-general-agent-base
> 关联：`agent-workbench-enhancement-plan.md`（active，方向同源）、`g0-result-studio-plan.md`（P6 证据重采归属）

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

## 4. 阶段划分（启动后按序串行）

| 阶段 | 内容 | 出口判据 |
| --- | --- | --- |
| **P0** | 立项评审：D1-D8 逐项核实代码事实落评审稿 → 用户确认；B/C/D 清单冻结到文件级（产出拆除清单与顺序） | 评审稿 + 用户裁决 |
| **P1** | Result Studio 通用化（前置）：D1 改名 + D2 去 `.R` 绑定 + D3 validator 钩子化；15 生信插件回归绿 | 定向测试 + 实机插件安装/run_tool 回归 |
| **P2** | 前端剥离小切口：解 7 处 import → inventory.ts 退役（D4）；死代码残留清理（ProjectModality 等） | D7 扫描门禁前端面绿 + tsc 0 + 受影响 vitest |
| **P3** | 后端剥离：tool-registry/tool-scripts/demo-data/scientific-task 契约链/R executor 摘除；finalize gate 科学理由码退场（D3 已铺路）；DB 生信表留置 | D7 扫描门禁后端面绿 + 启动零生信注册实机 |
| **P4** | 插件系统补全：按需安装（D5）+ 渲染器扩展点（D6）；生信插件以「可选清单」身份回归安装验证 | 插件商店可见可装可卸 + 卸载后零残留实机 |
| **P5** | 收口：全链验收（通用 agent 全功能在无生信安装态可用）+ 台账五件套回写 | 收口门禁 + D7 门禁全绿 |

## 5. 范围外与非范围

- 不做 Result Studio 机制层重构（它是保留下来的底座，只改名/解绑/钩子化）。
- 不删除 DB 生信表（留置；空表无害，删除 migration 破坏已装实例的 schema 演进链）。
- 不破坏 15 个生信插件的安装/运行能力（它们从「默认内置」变「可选安装」，功能本身不退役）。
- G1+ 阶段事项不外推（packaged/Provider/GA）。
- 与 G0-RS 的 P6 重采、AGENT-WORKBENCH 的 P1.4/P2 各自独立，文件面交汇处（extraRenderers）启动时显式划界。

## 6. 风险诚实登记

- finalize gate 科学理由码摘除涉及 agent loop 收尾语义，是全包最高风险点（P3），需定向回归 + 实机对话双保险。
- `tools-executor.js`（2,642 行）解科学工具形态绑定可能牵出 hidden 耦合，P0 冻结清单时专项核实。
- 改名面宽（代码/API/文档），一次会话收不完，按 P1-P5 串行分批提交，每阶段独立可回退。

## 7. 验收门禁预声明（收口时逐项对账）

- D7 机械扫描门禁（core/shared-backend/frontend 生产代码生信关键词零命中）全绿。
- 无生信安装态实机：启动零生信注册 + 通用 agent 对话/工具/文件/终端全功能可用（dev Electron 断言，证据落 `acceptance/block-83/`）。
- 15 生信插件可选安装回归：装→run_tool 通→卸→零残留。
- 定向测试 + tsc 0 + 收口门禁（hygiene/docs/ui-audit/test:changed）三绿+。

## 8. 与 AGENT-WORKBENCH 的关系

方向同源（都是「通用 agent 底座化」）。当前 active 槽位归 AGENT-WORKBENCH（P1=P1.4 参数确认卡片）；本包排队，启动顺序由用户裁决。两包文件面天然隔离（本包动 tool-registry/scientific-chain/inventory，AGENT-WORKBENCH 动 copilot 组件族），唯一交汇点 D6（extraRenderers）在 P4 启动时与 AGENT-WORKBENCH 当前状态对齐。

G0 开发期常态 · 不外推 packaged/Provider/GA。
