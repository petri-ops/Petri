---
capability: qdomain-p3-methods
goal: Q-DOMAIN P3 垂直切片——把 methods 出口里的领域数据（标准工具引用、工具标签）下沉到领域包，并删除核心化石工具注册表，让「单一注册源」与「核心零生信硬编码」各前进一格；无 pack 时诚实降级，不伪造引文。
acceptance:
  - 核心 core/shared-backend/tool-registry.js 内联 10 个生信工具删除；全仓零引用；单一注册源=core/petri-server/tool-registry.js（pack egistry/tool-registry.json 驱动）。
  - 新增 pack 契约 provides.methods（methods/citations.json + methods/tool-labels.json）：分析类型→标准工具引用、分析类型→工具标签，均为纯数据。
  - methods-export.js 的 _METHODS_CITATIONS / _scriptHeader 工具标签改读已安装且启用的 pack；pack 缺失/停用 → 无引文、无标签（诚实降级），不伪造。
  - 装载器 core/petri-server/helpers/pack-methods.js：只读、有界（文件 ≤256KB、类型 ≤200、单类型条目 ≤40、单条 ≤400 字符），形状错误 fail-closed 忽略坏包。
  - 域中性基线机械下调（只减不增）：	ool-registry.js 31 处归零 + methods 文件相应下调；	est/domain-neutrality.test.mjs 绿。
  - 单元测试：契约校验/缺失回退/停用回退/越界截断/坏 JSON 忽略；	est:changed 定向绿 + closeout 十三门 PASS。
reopen: `_pythonEquivalent` 脚本模板下沉（占位符/条件语义）；`artifact-profiles.js` 扩展化（P4 邻域）；`agent-workflow.js` 工作流模板；`learning.js` 教学工具领域语义（等 Q2）；`result-*-tools` 领域默认值；LLM 人格文案改为 pack 可注入自由 prompt（防注入面扩大，不做）。
status: completed
---

# BLOCK-220 — Q-DOMAIN P3 垂直切片：methods 契约下沉 + 遗留注册表清除

## 1. 背景与发令

- 用户 2026-10-20 发令「直接开 P3 可以直接推进」，承接 BLOCK-219 收口「下一步 Q-DOMAIN P3（methods/learning/legacy registry）」。
- 母纲 [`qoder-essence-absorption-plan.md`](./qoder-essence-absorption-plan.md) §Q-DOMAIN 切片 4 定义 P3：`methods-export.js`、`learning.js`、`result-*-tools`、`artifact-profiles.js`、`agent-workflow.js` 生信内容下沉；删除 `core/shared-backend/tool-registry.js` 内联工具，保持单一注册源。
- 母纲口径是 1–2 周的整段；本轮按**垂直切片**交付，未覆盖项在 §5 显式 reopen。

## 2. P0 实码勘察（2026-10-20，只读实测）

### 2.1 遗留注册表

| 事实 | 实测 |
| --- | --- |
| `core/shared-backend/tool-registry.js` | 458 行 / 13.9KB，内联 10 个生信工具（volcano-plot / heatmap-basic / go-enrichment / seurat-pca / spatial-standard / spatial-svg / spatial-deconv / spatial-lr / ml-scvi-annotate / scanpy-cluster） |
| 消费方 | **零**：全仓仅有 `core/shared-backend/index.js:75` 的 barrel 字段 `toolRegistry`；`getBuiltinTools`/`migrateFromRServerRegistry`/`initPythonTools` 均无外部引用 |
| 活的注册表 | `core/petri-server/tool-registry.js`（TOOL_REGISTRY_v1，92 行）+ `server.js:84-97` 在 pack 已安装/启用时 `registerDomainToolsFile(<packRoot>/registry/tool-registry.json)`；`test/block84-pack-oneclick.test.mjs` 已把 pack 驱动固化为契约 |
| 域词残留 | 31 处（h5ad 15 / scvi 5 / seurat 5 / scanpy 3 / volcano 3） |

结论：这是**化石模块**，删除不改变任何运行时行为；「单一注册源」要求可机械达成。

### 2.2 methods 出口

| 事实 | 实测 |
| --- | --- |
| `core/petri-server/helpers/methods-export.js` | 916 行；域词 62 处（h5ad 17 / scanpy 16-17 / seurat 11 / scrna 6 / single-cell 6 / cellchat 4 / 其余 3） |
| `_renderMethodsParagraph` | 通用 LLM 提示装配 + 引用表查表；除引用表/人格文案外无领域分支 |
| `_METHODS_CITATIONS`（28–95 行） | 13 个分析类型 → 标准工具引用列表；纯数据 |
| `_scriptHeader`（661–719 行） | 工具标签映射（13 条）+ 通用注释头；标签是纯数据 |
| `_pythonEquivalent`（722–952 行） | 7 个分析类型的 scanpy 脚本模板（约 230 行），**本轮不迁（reopen）** |
| 报告装配 | `_buildReportHtml` / `_embedPlotsAsDataUrls` / `_renderReportPdf` 为通用面，无领域分支 |

结论：`citations` 与 `tool-labels` 是**可数据化**的两块（本轮切片），`scriptTemplates` 需要占位符/条件语义，单独 reopen。

### 2.3 其余 P3 目标（本轮不迁）

| 文件 | 域词 | 为什么本轮不动 |
| --- | --- | --- |
| `core/shared-backend/artifact-profiles.js` | 13 | 是 RS/ChangeSet 的**科学数据契约词汇表**（`petri.counts-matrix.v1` 等，含 producers/consumers 声明），下沉需先定「pack 可扩展 profile 注册」结构 → 属 P4 邻域 |
| `core/shared-backend/agent-workflow.js` | 16 | 工作流步骤模板与 UI 投影耦合，需独立契约 |
| `core/petri-server/agent-tools/learning.js` | 5 | 教学工具语义（学习闭环）与 Q2 速记板相关，等 Q2 定形 |

### 2.4 当前基线

`test/domain-neutrality-baseline.json` 实测：**109 键 / 261 处 / 45 文件**（母纲记的 135/326/49 是旧值，本轮按实测记账）。

## 3. 范围（垂直切片）

1. **删除化石注册表**：`core/shared-backend/tool-registry.js` 整文件删除 + `core/shared-backend/index.js` 移除 `toolRegistry` 字段与注释；确认零引用（含测试/脚本）。
2. **新契约 `provides.methods`**（pack 侧）：
   ```
   provides.methods = {
     citations: "methods/citations.json",   // { "<analysisType>": ["引用字符串", …] }
     toolLabels: "methods/tool-labels.json" // { "<analysisType>": "工具标签" }
   }
   ```
   两文件均可缺省；形状错误 = 该包该面忽略（fail-closed，不静默半读）。
3. **装载器** `core/petri-server/helpers/pack-methods.js`：
   - 只遍历 `readInstalledPacks()` 中 `enabled !== false` 的包（与 `pack-prompt-fragments.js` 同一先例）；
   - 单文件 ≤256KB、单类型 ≤40 条、单条 ≤400 字符、类型键 ≤200 个；越界截断并记录 `warnings`（有界，不无界膨胀）；
   - 导出 `loadPackMethods()` / `getCitations(type)` / `getToolLabel(type)`；读取失败 fail-open 为空（不阻断 methods 生成），但绝不把未安装包当已安装。
4. **methods 接线**：`_renderMethodsParagraph` 引用块改 `getCitations(a.type)`；`_scriptHeader` 工具标签改 `getToolLabel(analysis.type)`；删除文件内 `_METHODS_CITATIONS` 与 `tools` 映射表。
5. **诚实降级**：pack 缺失/停用 → 引用块整段不出现（不输出空括号/占位引文）；`Type: <type>` 后无标签即只写类型名。
6. **pack 仓**：`petri-pack-bio` 新增 `methods/citations.json`（13 类型，内容从核心原表 1:1 迁移）、`methods/tool-labels.json`（同名 13 类型）、`pack.json` 增 `provides.methods`、版本 0.1.1 → 0.2.0。
7. **基线下调**：`node scripts/d7-baseline.mjs --update`（机械只减）；`test/domain-neutrality.test.mjs` 绿。

## 4. 非范围（reopen，逐条在册）

- `_pythonEquivalent` 脚本模板下沉（需占位符 + 条件语义）。
- `artifact-profiles.js` 扩展化（P4 邻域）。
- `agent-workflow.js` 工作流模板。
- `learning.js` 教学工具领域语义（等 Q2）。
- `result-*-tools` 领域默认值（P2b 高级 tab 迁移同族）。
- 不新建第二套 methods/引用真相；不把 LLM 人格文案做成 pack 可注入的自由 prompt（防 prompt 注入面扩大）。

## 5. 验收

- `node --test test/block220-pack-methods.test.mjs`：契约形状、缺失回退、停用回退、越界截断、坏 JSON 忽略、引用/标签命中。
- `node --test test/methods-export*.test.*`（若存在）/ 受影响邻域：methods 段落装配在无 pack 时不崩、有 pack 时引用块出现。
- `npm run test:files -- test/domain-neutrality.test.mjs` 绿（基线下降后仍只拦新增）。
- `npm run test:changed` 定向绿；`npm run closeout` 十三门 PASS。
- pack 仓：`node test/...`（若仓内有校验脚本）或至少 `pack.json` JSON 合法 + 两文件 JSON 合法（机械校验）。

## 6. 回滚

单提交回滚：删 `pack-methods.js` 接线两侧即回到「引用表在核心」形态；pack 侧 `provides.methods` 缺省时核心天然降级，不需要数据迁移。

## 7. 完成语义

completed 需：P1 删除 + P2 契约/装载器/接线 + P3 测试 + P4 pack 落地 + 基线回写 + canonical 回写 + closeout 十三门。**明确声明这是 P3 垂直切片**：methods 引用/标签已下沉，脚本模板与另外三个文件仍在 reopen。

## 8. 收口（2026-10-20）

**结论：BLOCK-220 P3 垂直切片 completed。**

### 8.1 交付

- **单一注册源**：删除 `core/shared-backend/tool-registry.js`（458 行、10 个内联生信工具、**零消费**）+ `core/shared-backend/index.js` 的 `toolRegistry` barrel 字段；工具注册唯一源 = `core/petri-server/tool-registry.js`（pack `registry/tool-registry.json` 驱动，`test/block84-pack-oneclick.test.mjs` 已固化该契约）。
- **新契约 `provides.methods`**：`{ citations, toolLabels }` 两个 packRoot 内相对路径；数据面纯 JSON，不执行 pack 代码。
- **装载器** `core/petri-server/helpers/pack-methods.js`：只读已安装且启用的包；`pack.json` 单文件 ≤256KB、类型 ≤200、单类型条目 ≤40、单条 ≤400 字符；路径必须落在 packRoot 内；坏 JSON/形状错误 fail-closed 只丢该包该面；同类型多包按 packId 序稳定覆盖并留 warning。
- **methods 接线**：删除 `_METHODS_CITATIONS` 表（13 类型）与 `_scriptHeader` 的 `tools` 映射（13 类型）；引用块改 `getCitations(a.type)`（空则整段不出现，不留空括号）；脚本头改 `getToolLabel()`（无标签只写类型名），并把 `(Python / scanpy)` / `(R / Seurat)` 收敛为 `(Python)` / `(R)`。
- **pack 仓**：`petri-pack-bio` 新增 `methods/citations.json`（13 类型，1:1 迁移）+ `methods/tool-labels.json`（13 类型）+ `pack.json` `provides.methods`；版本 `0.1.1 → 0.2.0`；pack 仓提交 `ea1da46`（main）。

### 8.2 验证

- `test/block220-pack-methods.test.mjs` **13/13**：无包空结果 / 启用贡献 / 停用不贡献 / 坏 JSON 只丢一面 / 形状错误 fail-closed / 条目截断 40 / 超长裁剪 400 / `../` 逃逸拒绝 / 多包覆盖留 warning / 未声明 provides 跳过 / `_scriptHeader` 无 pack 只写类型名 / 有 pack 写标签 / 核心无 `_METHODS_CITATIONS`。
- 真实 pack 根静态集成：13 类型引用 + 13 标签，`warnings: 0`（临时数据目录 + 只读指向兄弟仓）。
- 域中性基线机械下调：**109 键/261 处/45 文件 → 104 键/208 处/44 文件**（`tool-registry.js` 31 处归零；`methods-export.js` 62 → 24，seurat 11→2、scanpy 16→9、scrna 6→2、cellchat 4→2），`scripts/d7-baseline.mjs` 报「新增/恶化 0 | 减少 9」。
- `test:changed`：Node **315 项 0 红**（313 pass + 2 平台 skip）；本片不含前端改动。
- `quality:knip:check` PASS（248 键，删文件未新增保留面）；`docs:check` PASS（379 文档）。

### 8.3 边界（reopen，逐条在册）

- `_pythonEquivalent` 脚本模板（7 类型约 230 行 scanpy 代码）仍在核心：需占位符 + 条件语义契约，本轮不做；`methods-export.js` 余下 24 处域词主要来自它。
- `artifact-profiles.js`（13 处）扩展化属 P4 邻域：先把「pack 可扩展 profile 注册」结构定下来。
- `agent-workflow.js`（16 处）工作流模板需独立契约；`learning.js`（5 处）等 Q2 速记板定形；`result-*-tools` 领域默认值随 P2b 高级 tab 迁移。
- 不把 LLM 人格文案做成 pack 可注入的自由 prompt（防注入面扩大）。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
