# BLOCK-83 P0 设计评审稿 v1

> 日期：2026-09-12
> 状态：**confirmed（2026-09-12 用户裁决「确认」：D1-D14 全部通过）**
> 计划：`docs/block-83-general-agent-base-plan.md` v1.2 §3 D1-D14
> 证据方式：每项裁决附当前代码事实（file:line 已抽查核实）

---

## 裁决总览

| # | 裁决项 | 建议 | 用户确认 |
| --- | --- | --- | --- |
| D1 | Result Studio 改名边界 | 代码/文档层改名，**DB schema 留置** | ⏳ |
| D2 | plugin SDK 去 `.R` 硬编码 | 契约按扩展名放宽，15 插件零改动 | ⏳ |
| D3 | 确认/校验钩子化 | finalize gate 挂钩子注册表，默认零注册直通 | ⏳ |
| D4 | inventory 替代方案 | 方案 A：目录提供者 SPI 动态投影 | ⏳ |
| D5 | 分发形态 | **并入 D9**（原「可选清单」被远程清单取代） | ⏳ |
| D6 | extraRenderers 升格 | 真渲染器扩展点，与已收口注入桥同契约 | ⏳ |
| D7 | 关键词扫描硬门 | 词表+范围+豁免清单见下 | ⏳ |
| D8 | P6 源绑定漂移 | 例外登记，重采属 G0-RS，不阻塞 | ⏳ |
| D9 | 生信包交付形态 | 独立 git 仓库 `petri-pack-bio` + 远程清单分发 | ⏳ |
| D10 | tools-executor 归属 | 泛化为领域中性脚本宿主**留核心** | ⏳ |
| D11 | 命名残留 | 本包不动，品牌收尾另立包 | ⏳ |
| D12/D13 | SPI 词表纪律 / 第二租户证明 | 纪律项，随 P3/P5 执行 | ⏳ |
| D14 | 命名空间存储扩展点 | **不做**（远期候选） | ⏳ |

---

## D1 Result Studio 改名边界

**代码事实**：`src/migrations/001_result_studio.sql:27` `CREATE TABLE IF NOT EXISTS scientific_change_sets`（:50 同名索引）；`scientific_task_*`/`result-scientific-*` 命名遍布 shared-backend 与 agent-tools。

**建议**：schema 表/列名**永久留置**（additive 纪律：禁止改名/迁移；空表无害）；代码层、API 文档、前端组件目录（`frontend/src/components/result-studio/`）P1 一次到位改中性名（ChangeSet / ArtifactWorkbench），旧导出名保留别名一版防断裂。

## D2 plugin SDK 去 `.R` 硬编码

**代码事实**：`core/shared-backend/result-studio-plugin-sdk.js:88-89`——descriptor 的 `independentScriptPathTemplate` 必须逐字等于 `analysis/scripts/{artifactFamilyId}/{revisionId}/{artifactId}.R`，否则 `fail('independent_script_contract_invalid')`。

**建议**：契约放宽为「模板路径必须以声明语言的扩展名结尾且保持 per-Revision 目录契约」；`.R` 继续合法（15 个现存插件 plugin.json **零改动**），`.py` 与通用脚本放行；解释器按扩展名推断，**不新增 descriptor 字段**。

## D3 确认/校验钩子化

**代码事实**：`core/petri-server/loop-orchestrator.js:429/:946` 硬编码 `'scientific_task_not_confirmed'`、`:454/:1106` `SCIENTIFIC_DESIGN_MISSING`；`core/petri-server/db.js:1092` 直接 `require('../shared-backend/scientific-task-confirmation')`（DB 层反向依赖科学契约）。

**建议**：finalize gate 改挂「任务确认钩子注册表」——核心零注册时**零确认直通**（行为=无生信安装态）；科学确认逻辑随生信包经注册进入。db.js 依赖倒置：DB 层只暴露回调注册点，不 require 具体契约模块。钩子粒度建议**任务级**（对齐现行 scientific task confirmation 语义）。这是全包最高风险点，P3 落地时配 agent loop 定向回归 + 实机对话双保险。

## D4 前端工具目录替代方案

**代码事实**：`frontend/src/tools/inventory.ts` **2,095 行**生信工具目录；import 面 7 处——`components/copilot/SimpleChat.tsx`、`workspace-panels/{AnalysisLaunchPanel,ResultArtifactShell,ResultView,RightPanel}.tsx`、`pages/project-workspace.tsx`、`pages/_data.ts`（re-export）。

**建议**：**方案 A（推荐）**——新增「目录提供者 SPI」：核心 IPC 面按已装插件动态投影工具目录，7 处消费方改读投影；无插件时诚实空态。方案 B（保留静态文件改内容源）被否——仍需核心随包改文件，违背「清理不改核心」判据。

## D5 分发形态（并入 D9）

原 v1.0 设想「内置清单→可选安装清单」已被修订 1/2 的**独立包 + 远程清单**取代，本项并入 D9 一并确认。

## D6 extraRenderers 升格为渲染器扩展点

**代码事实**：`src/preload.js:38` `AGENT_WORKBENCH_FLAGS = { extraRenderers: false }`（布尔 flag，非扩展 API）；主进程侧 `src/main/_agent-flags.js`；注入桥（SimpleChat `extraRenderers.tsx`）已随 AGENT-WORKBENCH 收口 verified。

**建议**：升格为真「渲染器扩展点」SPI——插件按 artifact 类型声明渲染 handler；现有 boolean flag 保留语义为启停总开关；与已收口的 ResultCard 注入桥共用同一契约（AGENT-WORKBENCH 已 completed，无并行冲突）。

## D7 领域关键词扫描硬门

**建议**：新增 `test/domain-neutrality.test.mjs`（node --test，进 test:changed 影响图）。初版词表：`seurat|deseq2|scanpy|gsea|cellchat|single-cell|单细胞|组学|volcano|h5ad|wgcna|go-kegg|km-survival`。扫描范围：`core/`、`frontend/src/`、`src/`。豁免：插件包目录（built-in/安装态）、`src/migrations/`（D1 schema 留置）、测试 fixture、`acceptance/`、docs。SPI 定义文件同门禁（D12 执行面）。

## D8 P6 源绑定证据漂移

**代码事实**：`g0-rs-p6-product-acceptance` 门禁对源文件集做工作区字节 vs blob SHA 比对（现行 2 红=存量漂移，已例外登记）；B/C 类文件搬移/删除将新增触红。

**建议**：按既有例外登记（重采属 G0-RS 范围），不阻塞本包收口；P4 搬仓提交信息中显式登记触红预期。

## D9 生信包交付形态

**代码事实**：`src/plugin/manifest-source.js:10` `getRemoteManifest` HTTPS 远程清单通道已存在；`resources/built-in-plugins/` 现为 15 生信插件的内置清单源。

**建议**：独立 git 仓库 **`petri-pack-bio`**（15 插件 + 69 脚本 + registry 内容 + 目录数据 + R executor/依赖解析 + 科学校验钩子 + demo + 教程内容）；核心内置清单清空（仅保留通用示例如 example-hello）；dev 支持本地路径安装，生产走远程清单。
**⏳ 待确认**：① 仓库宿主（GitHub 同 org？）；② 首版是否同时发布 zip 附件（可先只走清单）。

## D10 tools-executor 归属

**代码事实**：`core/petri-server/helpers/tools-executor.js` **2,642 行**；机制=spawn 解释器执行脚本 + CSV/HTML 产物落 artifact truth（形态绑定科学工具，机制领域中性）。

**建议**：泛化为「脚本工具宿主」**留核心**（契约=解释器 + 输入声明 + 输出/产物声明——插座不是电器）；R 专属部分（`r-executor.js`、`r-libs-resolver.js`、R 运行时探测）随生信包走。

## D11 命名残留边界

**代码事实**：`core/petri-server/` 目录名、`petri://` URI（system-prompt 装配）、`petri.db`（db 路径）、`PETRI_*` env（env-coordinator/dev-electron）。

**建议**：本包**全部不动**——属品牌遗留非生信功能；改名牵动已装实例 userData 路径与 env 兼容，属破坏面，另立品牌收尾包由用户届时裁决。

## D12 / D13 / D14

- **D12 SPI 词表零领域词**：纪律项。执行面=P3 落 SPI 时其定义文件纳入 D7 门禁（初版生信词表已覆盖）。
- **D13 第二租户证明**：纪律项。P5 验收装载非生信 demo 包（example-hello 升级：注册工具→目录可见→run_tool→渲染）走通全链。
- **D14 命名空间存储扩展点**：**本包不做**，远期候选（YAGNI）。

---

## P0 出口确认（2026-09-12）

用户裁决原话「确认」——D1-D14 全部按本稿建议通过。D9 附带两项一并确认：生信包仓库宿主 = GitHub 同 org（petri-ops）；首版**不发** zip 附件（只走远程清单）。P0 出口达成，进入 P1（Result Studio 通用化：D1 改名 + D2 去绑定 + D3 钩子化；15 插件回归绿为出口）。
