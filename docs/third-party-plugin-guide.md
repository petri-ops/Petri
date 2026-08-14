# BioF3 第三方分析插件接入指南

> Stage 3 出口交付物（M5）。本文档说明如何为 BioF3 Harness 编写一个自包含的分析插件，
> 让它被自动发现、注册、参数修复、执行、产物校验、二跳编排与失败恢复，全程**不修改**
> Agent 核心、执行器、job 库或结果系统。
>
> 所有约定均以仓库现有内置插件（`resources/built-in-plugins/go-kegg`、`deseq2`、`wgcna`）
> 为真实样板，可直接对照复制。
>
> 最后更新：2026-07-22
>
> 可直接复制的原型：[`acceptance/harness-plugin-prototype`](../acceptance/harness-plugin-prototype)。该目录不自动注册，专门用于新插件开发、评审和交接。

---

## 0. 前置模型：一个插件 = 三层

| 层 | 内容 | 落点 | 谁提供 |
|---|---|---|---|
| **L1 模块代码** | `plugin.json` + `tool-definition.json` + `scripts/<id>.R`(或 `.py`) + demo-data + report 模板 | `resources/built-in-plugins/<id>/`（打包只读） | 插件作者（内置）或商店（installed） |
| **L2 预构建包 bundle** | 分析所需的重量级 R/Python 包（如 clusterProfiler、org.db） | `USER_DATA_DIR/runtimes/capabilities/<bundleId>/`（可写） | Harness 按需自备（capability-provisioning） |
| **L3 运行时** | 内嵌 Rscript / Python | `USER_DATA_DIR/runtimes/` | Harness 自备 |

关键约束：L1 在**只读** `.app` 内，不能往插件目录写包；因此重包声明为 `requiresBundle`，
由 Harness 装到可写用户目录，执行时经 `R_LIBS_USER` 挂载（见 §5）。

---

## 1. 最小文件集

一个可运行的分析插件至少包含：

```
resources/built-in-plugins/<id>/
├── plugin.json            # 身份 + 依赖声明（发现/注册/provisioning 读它）
├── tool-definition.json   # 输入/输出/失败模式契约（参数修复/artifact 校验读它）
├── scripts/<id>.R         # 分析脚本（executor 复制成 run-script.R 执行）
├── <id>-report-template.html   # 可选：解读报告模板
└── demo-data/             # 可选：自带样例，保证零配置可试跑
```

建议额外保留 `environment.json`：它把 `requiresBundle`、R 版本、包版本和“脚本不得安装/联网”的策略固定下来。`plugin.json` 是发现与 readiness 的声明，`environment.json` 是开发和验收的环境证据；两者不一致时必须阻断发布。

## 1.1 脚本可提取与二次修改

插件是可复用的模块，但结果不能只保存成一张“最终图片”。现有本地执行器会把插件源脚本复制为 Job 目录中的 `run-script.R`/`run-script.py`；正式交付必须保留这份**本次实际执行的脚本快照**，并在 artifact provenance 中记录：源插件版本、脚本 SHA-256、运行快照路径、参数、输入 hash 和环境版本。

因此 Agent 二次修改结果时遵循：

```text
读取原始插件脚本 / 本次 run-script 快照
  → 说明要改的统计或展示逻辑
  → 生成新版本或本次 Job 的修改脚本
  → dry-run / 重新执行 / 比较 artifact
  → 交付新脚本、参数和新结果
```

修改不能直接覆盖历史 Job 的脚本。历史结果永远绑定原脚本和原参数；修改应生成新的插件版本、workflow step 或可追踪的 patch，并保留 parent script SHA-256。交付包至少应包含脚本、输入引用、参数 JSON、环境清单和重放命令。

## 1.2 跨平台边界

插件的“科学逻辑”可以跨平台复用，但运行能力不是天然跨平台。必须分别验收：

| 层 | 是否可复用 | 约束 |
|---|---|---|
| R/Python 源脚本 | 通常可以 | 禁止硬编码 `/Users/...`、shell 专属命令和平台路径；使用 job 相对路径与参数。 |
| Plugin/tool 契约 | 可以 | `supportedPlatforms` 和 runtime/capability 版本必须明确。 |
| Runtime | 不一定 | R/Python 可执行文件、原生库、字体和系统依赖要按平台构建。 |
| Capability bundle | 不一定 | 每个 bundle 必须有平台 artifact、SHA-256 和版本；不能把 macOS 包静默用于 Windows/Linux。 |
| 产物验证 | 可以 | 表格 schema、artifact 类型和统计规则应跨平台一致；图像像素允许声明容差。 |

当前原型只承诺 `macos-arm64`，Windows、macOS x64 和 Linux 显式标记为 planned。后续扩展顺序是：先完成 macOS 真实运行与重放，再为每个平台分别构建 runtime/bundle、补平台 fixture 和 CI 矩阵；平台缺少可验证依赖时返回 `platform_not_supported`，不得自动降级到另一平台。

三方通过商店分发时，同样的 L1 目录打成 zip，`manifest.json` 用真实 `https://` URL + SHA-256
描述；内置插件用 `built-in://<id>` 伪 URL（见 §7）。

---

## 2. plugin.json（身份与依赖）

以 `go-kegg/plugin.json` 为真实样板：

```json
{
  "id": "go-kegg",
  "pluginManifestVersion": 1,
  "title": "GO/KEGG 富集分析",
  "version": "1.0.0",
  "language": "r",
  "description": "基因功能富集分析（clusterProfiler enrichGO + 离线 KEGG）。",
  "requiresBundle": "r-enrichment",
  "requiresBundleVersion": "1.0.0",
  "packages": {
    "r": { "clusterProfiler": ">=4.16.0", "org.Hs.eg.db": ">=3.19.0" }
  },
  "runtime": { "r": ">=4.4.0" },
  "builtAgainst": { "r": "4.5" },
  "platform": ["macos-arm64"],
  "supportedPlatforms": ["macos-arm64"]
}
```

字段说明：

- `id`：全局唯一，等于目录名、脚本名 `scripts/<id>.R`、`manifest.json` 的 key，三者必须一致。
- `language`：`r` 或 `python`，决定 executor 用 Rscript 还是 Python。
- `requiresBundle` / `requiresBundleVersion`：声明依赖的 L2 预构建包。**首次运行前 Harness 会自动
  provision 这个 bundle**（下载→SHA-256 校验→挂载）。轻量插件（只用运行时基础包，如 `volcano-plot`
  只需 ggplot2/ggrepel）**不写** `requiresBundle`。
- `packages.r` / `packages.python`：声明版本约束，用于 readiness 诊断与文档；不在此处触发安装。
- `runtime` / `builtAgainst`：运行时版本下限与构建基线。
- `platform` / `supportedPlatforms`：当前仅 `macos-arm64`。

---

## 3. tool-definition.json（执行契约）

这是 Harness 做参数修复、artifact 校验、失败恢复的**唯一事实源**。以 `go-kegg` 为例，核心三块：

### 3.1 inputs（参数契约）

```json
"inputs": [
  { "id": "deg_table", "type": "file", "required": true, "accept": ".csv",
    "hint": "单列基因名，或含 gene/log2FoldChange/padj 的 DESeq2 结果表（可二跳绑定）" },
  { "id": "species", "type": "select", "default": "human", "options": ["human", "mouse"] },
  { "id": "gene_id_type", "type": "select", "default": "SYMBOL",
    "options": ["SYMBOL", "ENSEMBL", "ENTREZID", "auto"] }
]
```

- `type: file` + `required: true` 的输入可被上游 valid artifact **二跳绑定**（见 §6）。
- `type: select` 的 `options` 就是弱模型/参数修复的合法值域——Harness 与评测脚本都据此校验。
- `default` 让"零参数直接跑 demo"成为可能。

### 3.2 outputs（产物契约）

```json
"outputs": [
  { "id": "go_bp_results", "type": "table", "label": "GO-BP 结果表" },
  { "id": "kegg_dotplot", "type": "plot", "label": "KEGG 气泡图" },
  { "id": "report", "type": "report", "label": "解读报告" }
]
```

脚本写出的产物 + manifest 会被 `artifact-truth` 归一为 `artifacts[]` 并校验（存在/非空/类型匹配）；
只有 **valid** artifact 才能作为下游二跳输入。

### 3.3 failureModes（可恢复诊断）

每个失败模式给 `code` / `detect`（匹配脚本 stderr 的正则）/ `recoverable` / `suggestedFix`：

```json
{ "code": "gene_id_mapping_failed", "recoverable": true,
  "suggestedFix": "切换 gene_id_type 或设为 auto；确认物种选择正确。",
  "detect": "bitr|no gene can be mapped|ENTREZID" }
```

Harness 用 `detect` 把原始报错归类成结构化可恢复项，驱动 `decide/recover` 单步循环。
通用模板（建议每个插件继承）：`missing_required_file_inputs`、`too_few_genes`、
`empty_result_or_insufficient_signal`、`runtime_not_ready`；再补插件专属项。

---

## 4. 分析脚本（scripts/<id>.R）

约定：

- 入参：R/Python 插件统一接收第一个位置参数 `job_dir`，并读取 `job_dir/params.json`；不要自行发明 `--args` / `--params` 协议。
- executor 会把脚本复制成 `jobDir/run-script.R` / `run-script.py`，R 脚本附带 `_biof3-theme.R`，并注入 `R_LIBS_USER`（见 §5）。
- 科研产物只写到 `job_dir/output/`。`artifact-manifest.json` 与 `provenance.json` 是 Harness 依据实际执行脚本、参数、输入和输出统一生成的内部证据，不得声明为用户科研产物。
- **结果为空 / ID 映射失败等务必输出可被 `detect` 正则命中的结构化诊断文本**；若插件主动阻断，还应保存 `status=blocked` 与 `failureMode`，执行层会原样保留。
- 不要在脚本里自己下载重包或联网；依赖由 `requiresBundle` + provisioning 负责。

---

## 5. requiresBundle 与 Harness 自备（L2）

声明 `requiresBundle: "r-enrichment"` 后：

1. 首次运行前，Harness readiness gate 调 `checkCapabilityReady()`；未就位则 `provisionCapability()`
   自动下载（**host 白名单 + https + SHA-256 校验 + 幂等 + 重试一次**，见
   `core/shared-backend/capability-provisioning.js`）。
2. bundle 装到 `USER_DATA_DIR/runtimes/capabilities/<bundleId>/<version>/`，executor 把它追加进
   `R_LIBS_USER`（优先级最高），R 脚本 `library(clusterProfiler)` 即可命中。
3. 一个 bundle 可被多插件共享（GO/KEGG 与 GSEA 同用 `r-enrichment`）。
4. bundle 的 `url` 由分发 manifest 描述，host 必须在白名单内（默认 Aliyun OSS，可经
   `BIOF3_CAPABILITY_ALLOWED_HOSTS` 覆盖）。**换分发源只改 manifest，不改插件代码。**

---

## 6. 二跳 lineage（编排）

标准流程不写第二套工作流引擎，直接用现有 `agent-workflow.js` 把插件串起来：

```
DESeq2 → (deg_table valid artifact) → bind_artifact → GO/KEGG → (富集表/图) → 报告
```

- 下游插件的 `type: file` 输入通过 `bind_artifact` 绑定上游 job 的 artifact。
- 绑定只接受**真实 job 的 valid、类型匹配**的 artifact；degraded/missing 会被拒。
- Agent 单步推进 `plan → run → verify → bind → decide/recover`，`autoExecute:false` 默认不盲跑。

---

## 7. 被发现与注册（三来源）

`plugin-sdk.js` 按优先级发现三类来源：

| 来源 | 优先级 | 位置 | 用途 |
|---|---|---|---|
| built-in | 10 | `resources/built-in-plugins/<id>/` | 随 app 打包 |
| installed | 20 | 用户数据目录 | 商店安装 |
| development | 30 | 开发工作区 | 本地开发调试 |

内置插件还需在 `resources/built-in-plugins/manifest.json` 登记一条，`url` 用 `built-in://<id>`：

```json
"go-kegg": {
  "id": "go-kegg", "kind": "plugin", "language": "r",
  "artifacts": { "macos-arm64": { "url": "built-in://go-kegg", "sha256": null, "sizeBytes": 0 } },
  "packages": { "r": { "clusterProfiler": ">=4.16.0" } }
}
```

manifest 合规 + 目录就位即被自动发现/注册/可运行，**无需改任何任务白名单接线**。

---

## 8. fixture 门禁与本地验证

新插件必须补 fixture 并跑门禁：

- `test/fixtures/harness/<id>-*.json`：至少覆盖 **valid lineage**、**degraded/recovery**、**blocked** 三态。
- 验证命令：

```bash
npm run harness:check          # manifest 合规（inputs/outputs/failureModes 齐全）
npm run harness:phase6         # plugin-sdk + workflow fixture 回归
npm run harness:plugins:acceptance:update # 10 个内置插件走真实生产执行链并更新证据
npm run harness:plugins:acceptance        # 校验已落盘的 macOS 验收证据
node --test test/*.test.mjs    # 全量回归不引入基线外失败
npm run check                  # 静态检查 + harness:check + ui:audit
```

新分析能力**不得**新增第二套执行器、job 表、工作流状态库或结果查看器——只通过
Plugin SDK + fixture + artifact truth 接入。

---


## 8.1 Skills 层（领域最佳实践封装）

> 本节介绍 Plugin 之上的 Skills 抽象层：把"如何做"的知识（Prompt 模板、恢复策略、UI 提示）从 Plugin 里抽出来，使 Plugin 继续专注"能做"。
>
> 详细架构设计见 [`docs/architecture/skills-architecture.md`](./architecture/skills-architecture.md)。

### 8.1.1 Skills 与 Plugins 的关系

```
┌──────────────────────────────────────────────────────────────┐
│  Skills 层 (L4) — "如何做"                                   │
│    Prompt 模板 / 恢复策略 / 用户交互模式 / 必填参数提示        │
├──────────────────────────────────────────────────────────────┤
│  Plugins 层 (L2) — "能做"                                    │
│    DESeq2 / volcano-plot / clusterProfiler 等具体工具        │
└──────────────────────────────────────────────────────────────┘
```

- **Plugin** 继续独立可用：通过 `run_tool` 直接调用，所有现有功能不受影响
- **Skill** 是一组 Plugin + 领域知识的组合：声明 Plugin 依赖、Prompt、恢复策略
- **向后兼容**：现有 Plugin 不需要任何改动；可选地声明为某个 Skill 的依赖

### 8.1.2 Skill Manifest 示例

存储在 `resources/skills/<skill-id>/skill.json`：

```json
{
  "skillManifestVersion": 1,
  "id": "deg-analysis-standard",
  "name": "标准差异表达分析",
  "version": "1.0.0",
  "description": "从原始计数矩阵到火山图的完整 DEG 分析流程",
  "category": "bioinformatics/ngs",
  "tags": ["deg", "rna-seq", "deseq2"],
  "source": "built-in",
  "capabilities": ["r-enrichment"],
  "plugins": {
    "required": ["expression-qc", "deseq2", "volcano-plot"],
    "optional": ["go-kegg", "gsea"]
  },
  "parameters": {
    "required": ["dataset", "group_column"],
    "optional": {
      "method": {
        "type": "select",
        "options": ["deseq2", "edger", "limma"],
        "default": "deseq2"
      },
      "padj_threshold": {
        "type": "number",
        "default": 0.05,
        "min": 0,
        "max": 1
      }
    }
  },
  "recovery_strategies": [
    {
      "when": "sample_group_mismatch",
      "do": "尝试自动检测分组或请求用户确认",
      "fallback": "提供分组模板让用户填写",
      "recoverable": true
    }
  ]
}
```

### 8.1.3 Plugin 转 Skill 的步骤

如果你已有 Plugin，希望升级为 Skill 的依赖：

1. 在 `resources/skills/<skill-id>/skill.json` 声明对 Plugin 的依赖：

   ```json
   "plugins": {
     "required": ["<your-plugin-id>"]
   }
   ```

2. 提供 Prompt 模板（在 `resources/skills/<skill-id>/prompts/` 下）：

   ```
   resources/skills/<skill-id>/
   ├── skill.json
   ├── prompts/
   │   ├── system.md
   │   └── user/
   │       └── standard.md
   └── README.md
   ```

3. 定义参数契约（`parameters.required` / `parameters.optional`），与 Plugin 的 `tool-definition.json` 输入对齐。

4. 定义恢复策略（`recovery_strategies`），把 Plugin 的 `failureModes` 升级为更上层的恢复意图。

5. 在 `resources/skills/manifest.json` 登记 Skill：

   ```json
   {
     "skills": {
       "<skill-id>": {
         "id": "<skill-id>",
         "version": "1.0.0",
         "source": "built-in",
         "kind": "skill",
         "category": "bioinformatics/ngs",
         "plugins": { "required": ["<your-plugin-id>"] }
       }
     }
   }
   ```

### 8.1.4 通过 MCP 使用 Skills

Skills 通过 MCP 暴露给 Agent：

| MCP 工具 | 用途 |
|---|---|
| `list_skills` | 列出所有 Skills，支持 category/tag/source 筛选 |
| `get_skill` | 获取 Skill 完整定义 |
| `search_skills` | 关键词搜索 Skills |
| `execute_skill` | 执行 Skill |
| `can_execute_skill` | 检查 Skill 当前是否可执行 |

详细 API 与示例见 [`docs/architecture/skills-architecture.md`](./architecture/skills-architecture.md) §5。

### 8.1.5 关键实现位置

| 模块 | 文件 |
|---|---|
| Skills SDK | `core/shared-backend/skills-sdk.js` |
| Workflow Engine | `core/shared-backend/workflow-engine.js` |
| Skill Registry | `core/shared-backend/skill-registry.js` |
| Skill Schema | `core/shared-backend/skill-schema.js` |
| Skill Runtime | `core/shared-backend/skill-runtime.js` |
| 示例 Skills | `resources/skills/deg-analysis-standard/`、`go-enrichment-analysis/` |

## 9. 接入检查清单

- [ ] `resources/built-in-plugins/<id>/` 目录建好，`id` 三处一致（目录/脚本/manifest key）。
- [ ] `plugin.json`：身份 + `packages` + `runtime`；重包声明 `requiresBundle`。
- [ ] `environment.json`：runtime/capability/package 版本与安装、联网策略；与 `plugin.json` 一致。
- [ ] `tool-definition.json`：inputs（select 给 options + default）、outputs（type 明确）、failureModes（含 detect 正则）。
- [ ] `scripts/<id>.R` / `.py`：第一个位置参数读取 `job_dir`，从 `job_dir/params.json` 取参数，产物写入 `job_dir/output/`，失败输出结构化 `failureMode`。
- [ ] 若依赖重包：确认对应 bundle 在分发 manifest 有条目，host 在白名单内。
- [ ] `manifest.json` 登记 `built-in://<id>`（内置）或真实 URL+SHA-256（商店）。
- [ ] `test/fixtures/harness/<id>-*.json` 覆盖 valid/degraded/blocked 三态。
- [ ] 四条门禁全绿；产物二跳绑定验证通过。
- [ ] `acceptance.json` 的硬性证据齐全：重复运行、失败恢复、lineage、无隐藏安装、脚本/参数/输入哈希可重放。

---

## 附：真实样板对照

| 想参考的能力 | 看哪个内置插件 |
|---|---|
| 最小无 bundle 插件 | `volcano-plot`（只需 ggplot2/ggrepel，无 requiresBundle） |
| 带 bundle + 二跳输入 | `go-kegg`（requiresBundle=r-enrichment，deg_table 二跳） |
| 复用同一 bundle | `gsea`（与 go-kegg 同用 r-enrichment） |
| 独立 bundle + 多产物 | `wgcna`（requiresBundle=r-wgcna，13 个 artifact） |
| Python 插件 | `pca-explorer`（language=python，与 R 统一读取第一个位置参数 `job_dir`） |
