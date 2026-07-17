# Stage 3 标准流程与模块化 Harness — 设计文档 (草案 v1)

最后更新：2026-07-17
状态：**设计草案，待用户评审后进入实现**。当前 Stage 1/2 已验收关闭；本文件定义 Stage 3 的架构与推进顺序，允许后期迭代优化。

> 阅读前置：`docs/v1-productization-roadmap.md`（阶段总纲）、`docs/harness-engine-spec.md`、`docs/harness-roadmap.md`（Phase 1–6 已完成）、`docs/plugin-artifact-schema.md`、`docs/dependency-decoupling-checkpoint.md`。

---

## 0. 已锁定的架构决策（来自用户 2026-07-17）

| # | 决策 | 含义 |
|---|---|---|
| D1 | **所有功能模块 built-in** | 分析能力代码随 app 打包进 `resources/built-in-plugins/`，用户不通过商店安装“插件代码”。 |
| D2 | **Harness 自备运行时/包，过程无感 + 事后可查看** | Harness 自动检测并获取模块所需运行时与 R 包，用户不手动去商店；提供只读“Harness 配置了什么”面板供事后审计。 |
| D3 | **预构建 + 分析功能模块化 → 再编排流程** | 重量级 R 包做成预构建 bundle；每个分析功能是自包含模块；模块之上用现有 agent-workflow 编排标准流程。 |
| D4 | **分发源灵活，但要稳、要流畅** | 分发通道可选，优先稳定与流畅（可复现、可校验、可回退）。 |

“无感”的落地口径：**不让用户去商店找、Harness 自动办、只给不打断操作的进度提示、装完可在配置面板查看**。首次重包下载无法零时间，但全程无需手动决策，符合“大额网络动作可见 + 可审计”的安全底线。

---

## 1. 目标与范围

在 Stage 1（UI）、Stage 2（模型层）验收之上，用真实分析流程验证并扩展 Harness：

1. 以 **GO/KEGG 富集** 为首个真实标准流程样板（built-in 模块）。
2. 跑通 **模块化能力 + 自备运行时/包 + agent 编排 + 二跳 lineage + 失败恢复** 的完整闭环。
3. 沉淀可复制样板后，按 **GSEA → WGCNA** 逐个接入。
4. 用 Stage 2 已验证的多 Provider（DeepSeek / Anthropic 原生）做 Harness 评测矩阵。

**不做**：不批量复制脚本、不为单个流程改 Agent 核心、不新增执行器/job 库/工作流状态库/结果系统。

---

## 2. 不变量（Stage 3 全程不得破坏）

- 唯一执行事实链：`run_tool → tool_job → artifact truth`。
- 单一后端形态：本地文件存储 + SQLite + 内嵌 R/Python 本地执行；不重新引入 OSS 业务存储 / PostgreSQL / docker 执行。
- Electron IPC 经既有 preload/desktopBridge；前端 React 本地状态，不引入 zustand。
- 新分析能力只通过 **Plugin SDK + fixture + artifact truth** 接入；下游只能绑定 valid artifact。
- Agent 单步推进：`plan → run → verify → bind → decide/recover`，默认不自动盲跑。
- `api-failover-proxy/` 永不进 Desktop 提交。

---

## 3. 现状基线（Stage 3 的地基，已从代码核实）

### 3.1 已完成（Phase 1–6）
- Plugin SDK：built-in / installed / development 三来源发现（`core/shared-backend/plugin-sdk.js`，优先级 10/20/30），manifest/脚本/failureModes 校验、注册诊断。
- Agent Workflow Runtime：从现有 tool job/artifact truth 投影步骤状态，支持依赖、断点恢复、下一动作、可审计 lineage（`core/shared-backend/agent-workflow.js`）。
- artifact truth：执行结束校验声明产物与真实文件，统一 blocked/degraded 诊断（`core/r-server/helpers/artifact-truth.js`）。
- 文件索引 + 参数修复 + 诊断（`scripts/harness-file-index.mjs`）。
- 弱模型任务包：`enrichment` intent 已存在，`toolIds: ['go-kegg','gsea']`（`scripts/harness-task-packs.mjs`）—— **但 go-kegg / gsea 插件尚不存在，需本阶段创建**。

### 3.2 执行接线（已核实的真实机制）
- 脚本定位：`pluginLoader.getScriptForTool(id)` → `resources/built-in-plugins/<id>/scripts/<id>.R`。
- 执行：registry `_runPluginScript` 把脚本复制成 `jobDir/run-script.R`，复制 `_biof3-theme.R`，注入 `R_LIBS_USER`（**`pluginDir/packages/r` 最高优先级**），经 R executor 跑 `Rscript run-script.R --args params.json`（Python 为 `--params`）。
- 产物：脚本写 output dir + manifest；artifact-truth 归一为 `artifacts[]` 并校验（缺失/空/类型不符）。
- built-in 插件放进 `resources/built-in-plugins/` 且 manifest 合规即被发现/注册/可运行，**无需额外任务白名单接线**。

### 3.3 现有获取管道（可复用，不重建）
- `src/plugin-manager.js`：远程 manifest（当前指向 OSS CDN）、`downloadFile()` 带 **SHA-256 流式校验 + host 白名单**、运行时装到 `USER_DATA_DIR/runtimes`、`installed.json` 记账、runtime 校验/装包能力。
- **Stage 3 复用这套管道做“自备”，不新建下载/校验/装包系统。**

---

## 4. 三层模块模型（D1 + D3 的落地）

一个“分析功能模块” = 三层，来源与可变性不同：

| 层 | 内容 | 体积 | 落点 | 获取方式 |
|---|---|---|---|---|
| **L1 模块代码** | `plugin.json` + `tool-definition.json` + `scripts/<id>.R` + demo-data + fixtures | KB | 随 app 打包 `resources/built-in-plugins/<id>/`（**只读**） | 内置（D1） |
| **L2 预构建 R 包 bundle** | 该模块所需 R/Bioconductor 包（如 clusterProfiler、org.Hs.eg.db） | 百 MB~GB | **可写用户目录** `USER_DATA_DIR/runtimes/rpkgs/<bundleId>/`，经 `R_LIBS_USER` 挂载 | Harness 自备（D2），预构建 bundle（D3） |
| **L3 R 运行时** | 内嵌 Rscript | 百 MB | `USER_DATA_DIR/runtimes/r/` | Harness 自备（D2），预构建（D3/D4） |

关键点：
- L1 因为在**只读**的 `.app` bundle 内，**不能**往 `pluginDir/packages/r` 写包。因此 L2 provisioned 包放到**可写用户目录**，并让执行时的 `R_LIBS_USER` 追加该目录。**这是对现有 `_runPluginScript` R_LIBS_USER 注入逻辑的一处必要扩展**（内置模块 → 指向 provisioned lib，而非 bundle 内 packages/r）。
- 模块只声明依赖（`plugin.json.packages.r` / 新增 `requiresBundle`），**不在模块内自带重包**，避免 app 膨胀。
- 一个 L2 bundle 可被多个模块共享（如 GO/KEGG 与 GSEA 都依赖 clusterProfiler → 同一 enrichment bundle）。

---

## 5. Capability Provisioning 子系统（D2 “Harness 自备” 的核心）

### 5.1 职责
在模块运行前，确保 L2/L3 就位；缺失则**自动获取**，全程无感，事后可查看。

### 5.2 流程（复用现有管道）
```
需要运行模块 M
  → 读 M.manifest 的 runtime + requiresBundle 声明
  → checkCapabilityReady(M): R 运行时? 该 bundle 已装且版本/hash 匹配?
      ready    → 直接进 run
      missing  → provisionCapability():
                   解析 bundle 描述（bundleId, version, url, sha256, size）
                   downloadFile()（复用：SHA-256 校验 + host 白名单）
                   解压到 USER_DATA_DIR/runtimes/...
                   写 provisioning ledger（见 5.4）
                   → 就位后进 run
```
- 触发点：Harness 在 `plan`/`run` 前的 readiness gate（现有 `diagnoseHarnessRunReadiness()` 的扩展），把 `runtime_not_ready` 从“死胡同诊断”升级为“可自动 provision 的可恢复项”。
- **不新建执行器/下载器**：`provisionCapability()` 是对 `plugin-manager` 现有 download/verify/install 的编排封装。

### 5.3 无感 UX（D2）
- 无需用户去商店；Harness 自动开始。
- 只在 Agent 会话/结果区给**不打断**的进度提示（“正在准备 GO/KEGG 运行环境… 320MB”）。
- 完成后自动继续原分析。
- 首次大额下载给一次极轻量告知（可配置为静默 + 仅进度条），绝不静默跑满带宽而零提示。

### 5.4 “Harness 配置了什么”面板（D2 可查看）
- 新增只读 provisioning ledger：`USER_DATA_DIR/harness-provisioning.json`（或复用 `installed.json` 的 runtime 记账并扩展字段）。
- 记录：capability id、类型（runtime/bundle）、版本、来源 URL、SHA-256、大小、安装时间、被哪些模块使用、状态。
- 前端在“设置 → 计算与数据”或“插件/运行时”下新增只读视图（复用现有设置分类，不新建竞争页面）。
- 提供“重新校验 / 重新获取 / 移除”动作（移除等破坏性动作需确认，C-03）。

### 5.5 稳定与流畅（D4）
- 预构建 bundle 带 `sha256` + `version`，下载后校验；失败自动重试一次，再报可读诊断。
- 支持断点/幂等：已就位不重复下载；部分下载可续或清理重来。
- 分发源：`manifest` 描述每个 bundle 的 `url`（可 OSS CDN，可自建源，可镜像列表）；host 走白名单。**分发源可换，provision 逻辑不变**（满足 D4 灵活）。

---

## 6. 编排（D3 “再编排流程”）

- 模块是自包含能力；**标准流程 = 用现有 `agent-workflow.js` 把模块编排起来**，不写第二套工作流引擎。
- 二跳 lineage：上游 valid artifact（如 DESeq2 的 DEG 表）→ `bind_artifact` → 下游模块输入（GO/KEGG 的 gene list / DEG 表）。绑定只接受**真实 job 的 valid、类型匹配** artifact（现有约束）。
- Agent 单步：`plan → run → verify → bind → decide/recover`，`autoExecute:false` 默认。
- 典型流程（Bulk RNA 富集）：`DESeq2 → (DEG artifact) → GO/KEGG → (富集表/图) → 报告`。

---

## 7. GO/KEGG 试点具体设计

### 7.1 新增/改动文件清单
```
resources/built-in-plugins/go-kegg/
  ├── plugin.json                 # runtime.r + packages.r + requiresBundle: "r-enrichment"
  ├── tool-definition.json        # inputs/outputs/failureModes
  ├── scripts/go-kegg.R           # clusterProfiler enrichGO + enrichKEGG
  ├── go-kegg-report-template.html
  └── demo-data/
        └── demo_deg.csv          # 复用/对齐现有 DEG 样例
resources/built-in-plugins/manifest.json   # 若内置清单需登记（实现时确认）
test/fixtures/harness/go-kegg-*.json        # valid lineage / degraded / blocked fixtures
```
不改 Agent 核心、执行器、结果系统。R_LIBS_USER 指向 provisioned lib 的扩展在 registry `_runPluginScript`（第 4 节）。

### 7.2 输入契约（tool-definition inputs）
- `deg_table` (file, required, .csv)：DEG 表；支持二跳从上游绑定。
- `gene_id_type` (text, default `SYMBOL`)：`SYMBOL|ENSEMBL|ENTREZID`。
- `organism` (text, default `human`)：物种，不硬限（D6）；首期预构建覆盖 human + mouse（org.Hs/org.Mm），其余按需 provision；缺失 org.db → `organism_db_missing` 自动补齐或提示。
- `ontology` (select, default `ALL`)：GO `BP|MF|CC|ALL`。
- `pvalue_cutoff` (number, default 0.05)、`qvalue_cutoff` (number, default 0.2)。
- `top_n` (number, default 20)：展示条目数（受结果条目上限裁剪）。
- 可选 `logfc_col` / `pvalue_col` / `sig_threshold`：从 DEG 表筛显著基因（复用 DEG 列别名修复）。

### 7.3 输出/产物（artifacts）
- `go_table` (table)：GO 富集结果表。
- `kegg_table` (table)：KEGG 富集结果表。
- `go_dotplot` / `kegg_dotplot` (plot)。
- `go_barplot` (plot)。
- `report` (html)：解读报告。
- `zip` (file)：打包下载。

### 7.4 failureModes（先继承通用模板，再补专属）
通用：`missing_required_file_inputs`、`missing_required_columns`、`input_path_not_found`、`runtime_not_ready`、`parameter_out_of_range`、`empty_result_or_insufficient_signal`。
专属：
- `gene_id_mapping_failed`：ID 类型与物种数据库不匹配 → 建议切换 `gene_id_type` 或探测 ID 形态。
- `organism_db_missing`：物种注释库缺失 → 触发 provisioning 补对应 org.db，或提示支持的物种。
- `no_significant_genes`：显著基因集为空 → 放宽阈值或检查 DEG 列。
- `kegg_network_unavailable`：KEGG 在线库不可达 → 用离线/缓存 KEGG 或提示网络（见风险 12）。

### 7.5 R 脚本结构（scripts/go-kegg.R）
- 读 `--args params.json` + DEG 表；按显著阈值筛基因；`bitr()` 做 ID 映射。
- `enrichGO()`（org.<Sp>.eg.db）+ KEGG 富集**走离线数据集**（D5：bundle 内预装 KEGG 数据，不默认打在线 API；缺失才联网补齐）；生成表、dotplot/barplot；写 report + zip + manifest。
- 结果为空/映射失败时输出结构化诊断文本（供 failureModes.detect 捕捉）。
- 复用 `_biof3-theme.R` 主题。

### 7.6 二跳验证
- 真实链路：DESeq2/历史 DEG valid artifact → `bind_artifact` → go-kegg run → artifact truth valid。
- 反例：绑定 degraded/missing DEG → 被拒。

### 7.7 provisioning
- `requiresBundle: "r-enrichment"`（含 clusterProfiler、org.Hs.eg.db、enrichplot、ggplot2 等预构建）。
- 首次运行 go-kegg → Harness 自动 provision `r-enrichment` bundle（+ R 运行时若缺）→ 无感继续。

---

## 8. GSEA / WGCNA（样板复制，后续）
- **GSEA**：复用 `r-enrichment` bundle（clusterProfiler `gseGO/gseKEGG`）；输入为**排名**（DEG 的 log2FC 排序），验证 ranked input、数据库选择、结果消费。
- **WGCNA**：新 bundle `r-wgcna`（WGCNA 包）；输入表达矩阵；验证更长运行、资源提示、分阶段产物、失败恢复。
- 两者都走同一 L1/L2/L3 + 编排 + fixture 模板，不改核心。

---

## 9. Provider 评测矩阵（Stage 3 出口项）
- 复用 Stage 2 已验证的 Provider：DeepSeek（OpenAI-compatible）、xunfei-astron / api.xcdw.us opus-4-8（Anthropic 原生）。
- 对每条标准流程，用不同 Provider 跑：intent 识别、选型、参数修复、tool calling、失败恢复、结果解释。
- 产出可比较报告 + 明确失败分类（复用 `acceptance/stage2/live-provider-check.mjs` 的思路，扩一个 harness 评测脚本）。

---

## 10. 分发与预构建（D3 + D4）
- 预构建 bundle 构建流水线（离线可复现）：固定 R + Bioconductor 版本，装好目标包，打包成 tar，算 SHA-256，产出 `bundleId/version/sha256/size`。
- bundle 清单并入现有 manifest（描述 url + sha256 + 适用平台 arm64/x64）。
- 分发源（D7）：沿用现有 OSS CDN 作为自建源；host 白名单保留；bundle 迁移只改 manifest 的 `url`，provision 逻辑不变；后期有更优源再迁移。
- bundle 内含**离线分析数据**（D5：KEGG 离线数据 + org.Hs/org.Mm），保证离线可跑；联网只作兜底补齐。
- **架构一致性口径**：去耦移除的是 OSS **业务存储**；运行时/bundle 的**分发**允许联网（OSS CDN，非业务存储）。文档统一此口径，避免误读为“全程离线”。

---

## 11. 测试与门禁
- `npm run harness:check` + `test/harness-manifest.test.mjs`：新模块 manifest 合规。
- `npm run harness:phase6` + `test/harness-workflow-fixtures.test.mjs`：valid lineage / degraded recovery / 确认断点 / blocked fixture。
- `node --test test/*.test.mjs`：全量回归不引入基线外失败。
- 新增 provisioning 的单测：SHA 校验、幂等、缺失→就位、损坏→重试→诊断（**本地 mock，不依赖真实大包下载**）。
- Provider 评测脚本作为手动门禁（真实网络，不进 CI）。

---

## 12. 风险与开放问题
1. **Bioconductor 重包体积/构建**：clusterProfiler + org.db 巨大；预构建 bundle 是正解，但要维护多平台（arm64/x64）构建产物。
2. **KEGG 数据（已决策 D5：离线优先）**：不默认打 `enrichKEGG` 在线 API；`r-enrichment` bundle 预装离线 KEGG 数据集 + org.db，离线跑；仅在离线数据缺失时联网补齐。需维护离线 KEGG 数据的构建与版本更新。
3. **物种覆盖**：org.db 按物种拆分；首期先 human(+mouse)，其余按需 provision。
4. **只读 app bundle 写包**：确认 R_LIBS_USER 扩展到用户目录、内置模块不写 .app 内部（打包/签名兼容）。
5. **provisioning 与“无感”的张力**：首次重包下载耗时；落地为“无手动步骤 + 非阻塞进度 + 事后可查”，而非真正零延迟。
6. **多平台**：arm64 优先，x64 需各自预构建 bundle。
7. **失败恢复真实性**：fixture 覆盖需包含真实 R 运行失败（如包缺失、ID 映射失败），不能只测 happy path。

---

## 13. 推进里程碑（可迭代）

**M0 设计评审（当前）**：本文件评审通过，锁定 D1–D4 与三层模型。

**M1 provisioning 地基**（先于任何分析内容）
- 扩展 `_runPluginScript` 的 R_LIBS_USER：内置模块指向可写 provisioned lib。
- `provisionCapability()`：封装现有 download/SHA256/install；capability readiness gate；provisioning ledger + 只读查看面板。
- 单测（本地 mock）：就位/幂等/校验/重试/诊断。
- 门禁：`npm run check`、全量测试不回归。

**M2 GO/KEGG 模块**
- L1 文件（manifest/script/demo/report）+ failureModes；`r-enrichment` bundle 描述。
- 预构建 `r-enrichment` bundle（arm64 先行）+ SHA/version。
- fixtures：valid lineage / no_significant_genes / id_mapping_failed / blocked。
- 真机：DESeq2 DEG → 二跳 → GO/KEGG valid artifact；`harness:phase6` 通过。

**M3 Provider 评测**
- harness 评测脚本，DeepSeek + Anthropic 各跑 GO/KEGG 全链；可比较报告 + 失败分类。

**M4 样板复制**
- GSEA（复用 bundle）→ WGCNA（新 bundle）。达到 Stage 3 出口“三条真实标准流程闭环”。

**M5 出口收口**
- 三方插件接入指南（第 15 节）；全量门禁；更新台账/交接文档；决定是否进 Stage 4。

每个里程碑独立提交（Conventional Commits），只暂存自己文件，遵循“完成一批再 push”节奏。

---

## 14. 已确认决策（用户 2026-07-17，补充 D1–D4）

| # | 决策 | 落地 |
|---|---|---|
| **D5 离线优先 + 联网兜底** | 预装/预构建**离线分析数据包**（含 KEGG 离线数据、org.db 注释）随 bundle 提供；缺失时才联网获取。 | provisioning 先查本地 bundle/缓存 → 命中即离线跑；未命中再走 `downloadFile()` 联网补齐。KEGG 走离线数据集，不默认打 KEGG 在线 API。 |
| **D6 不硬限物种，先 human+mouse** | 不在代码里写死物种白名单；首期预构建覆盖 **human + mouse**（org.Hs/org.Mm），其余物种按需 provision。 | `organism` 参数自由填；对应 org.db 缺失 → `organism_db_missing` → 自动 provision 或提示。 |
| **D7 分发源沿用 OSS CDN** | 现有 OSS CDN 即自建源，先用；后期有更好的再迁移。 | manifest 的 bundle `url` 指向 OSS；host 白名单保留；迁移只改 manifest，不改 provision 逻辑。 |
| **D8 极轻量告知 + 进度条（透明）** | 资源预备对用户可见但不打断：一次极轻量告知 + 进度条，明确是“分析必要的资源预备”。 | 不静默、不阻塞；完成后自动继续；细节入 provisioning 面板。 |

这 4 条已回填到 §5.3（D8）、§7.4/§7.5（D5 KEGG 离线）、§7.2（D6 物种）、§10（D7 分发）。

---

## 15. Stage 3 出口交付：三方插件接入指南（占位）
出口要求形成“可复制的第三方插件接入指南”，至少覆盖：
- 一个模块的最小文件集（manifest/script/demo/fixtures）。
- 如何声明 `requiresBundle` 并让 Harness 自备依赖。
- 如何被 built-in/installed/development 发现。
- artifact 契约、failureModes 模板、二跳 lineage 绑定要求。
- fixture 门禁与本地验证命令。

（GO/KEGG 跑通后据实沉淀。）

---

## 附：Stage 3 出口判据（对齐 v1 路线图 §5.3）
- GO/KEGG、GSEA、WGCNA 至少三条真实标准流程闭环。
- 不同 Provider 下 Harness 评测有可比较报告与明确失败分类。
- 新流程接入不修改第二套执行器/job 库/结果查看器。
- 全量 Harness/Agent fixture、真实 artifact、恢复与 adapter 回归通过。
- 形成可复制的三方插件接入指南。