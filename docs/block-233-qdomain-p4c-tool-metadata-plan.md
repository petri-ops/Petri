---
capability: qdomain-tool-metadata
goal: Q-DOMAIN P4-C 第 1 片——tool 元数据单一源：核心删除工具标签/CSV 校验/大小上限的第二份硬编码，改为消费领域包注册表声明；每片下调域中性基线。
acceptance:
  - `tools-executor.js` 不再内联工具显示名表，统一 `getToolDisplayName()`。
  - `result-files.js` 的 CSV 严格校验集合/一列基因表规则/大小上限全部来自 pack 注册表声明。
  - pack `registry/tool-registry.json` 补齐 go-kegg/gsea 并声明 `csvValidation`/`acceptsSingleColumnGeneList`；版本 0.2.1。
  - 兼容测试（夹具注册表）≥10 断言；既有 tools-input-validation 4/4 保持；域中性基线下调约 22 处。
  - test:changed + closeout 十三门 PASS。
reopen: P4-C 后续片（demo assets、artifact profiles、workflow/learning、methods-export、result/RS 保真、前端领域文案与兼容键）。
status: completed
---

# BLOCK-233 · Q-DOMAIN P4-C 第 1 片：tool 元数据单一源

> 用户裁决：2026-10-21「确认后，开冲 P4-C」；P4-C 口径「域中性基线分片（208→0，分批）：先外围 tool/result 模块，再 Result Studio 保真；每片下调基线」。
> 母纲：`docs/qoder-essence-absorption-plan.md` §6 P4；上一片 `docs/block-232-qdomain-p4b-permissions-plan.md`。

## 1. P0 实码勘察（2026-10-21）

| 面 | 现状 | 结论 |
| --- | --- | --- |
| `core/petri-server/helpers/tools-executor.js:1983` | 19 项硬编码 `toolNames` Map（jobName 用） | 与 pack 注册表 `displayName` 重复；改用 `getToolDisplayName()` |
| `core/petri-server/helpers/tools-executor/result-files.js:291` | `csvTools` 8 项硬编码 + `go-kegg` 一列特例 + `seurat/cellchat` 500MB 例外 | 改为注册表声明（`csvValidation` / `acceptsSingleColumnGeneList` / `sizeLimitMB`） |
| `core/petri-server/tool-registry.js` | 已有 `getToolDisplayName`/`listCsvTools`/`getToolSizeLimitMB`；`listCsvTools` 语义=有 csvInputs（比旧严格集合宽） | 新增 `listCsvValidationToolIds` + `toolAcceptsSingleColumnGeneList`，语义对齐旧校验面 |
| pack `registry/tool-registry.json` | 21 条；缺 `go-kegg`/`gsea`；`tool-registry-entries.json` 有 23 条（含两者） | pack 补两条（数据搬运），并声明新字段；版本 0.2.1 |
| pack 大小声明 | `seurat-standard`/`cellchat` 500MB、`maftools-mutation` 200MB、其余 100MB | 核心改读声明；maftools 100→200 属对齐（如实登记） |
| 测试 | `test/tools-input-validation.test.mjs` 4/4 依赖核心硬编码 | 改为夹具注册表（不依赖兄弟 pack）；新增 block233 契约测 |
| 域中性基线 | 201 处 / 100 键；两文件合计 22 处 | 本片目标 179 处 / 98 键 |

## 2. 范围（本片 S1）

1. pack：`registry/tool-registry.json` 补 `go-kegg`/`gsea`；8 个旧严格校验工具加 `csvValidation:true`；`go-kegg` 加 `acceptsSingleColumnGeneList:true`；`pack.json` 0.2.0→0.2.1。
2. core `tool-registry.js`：新增两个只读访问器并导出。
3. core `tools-executor.js`：删除 19 项标签 Map，改用 `getToolDisplayName()`。
4. core `result-files.js`：严格 CSV 集合、一列规则、大小上限全部读注册表。
5. 测试：block233 契约测 + tools-input-validation 夹具化。
6. 域中性基线下调 + closeout。

## 3. 非范围（reopen）

`tools-assets` demo job id 映射、`artifact-profiles`、`agent-workflow`/`learning`/`scientific-task-planner`、`methods-export`、result compare/selection/interpret（RS 保真）、前端领域文案与兼容键。均为 P4-C 后续片。

## 4. P4-C 分片路线（每片独立收口、每片下调基线）

| 片 | 目标 | 主要面 | 预估残量 |
| --- | --- | --- | --- |
| S1（本包） | tool 元数据单一源 | tools-executor / result-files / pack registry | 22 |
| S2 | demo 资产与 artifact profiles 下沉 pack | tools-assets / artifact-profiles / capability-bundles | ~26 |
| S3 | workflow/learning/planner 领域模板下沉 pack | agent-workflow / learning / scientific-task-planner / tool-defs | ~31 |
| S4 | methods/citations 模板下沉 pack | methods-export（_pythonEquivalent 等） | 40 |
| S5 | result/RS 保真切片（先契约后迁移） | result-scientific-compare / result-selection / interpret / replay | ~30 |
| S6 | 前端领域文案与兼容键收尾 | office-file-preview / copilotContext / welcome / permissions legacy | ~30 |

> 目标仍是 0，但按片推进；兼容必需的 legacy 键若无法零化，在本表如实收敛为“显式兼容白名单”并单独裁决，不以改扫描器词表充数。

## 5. 红线

- pack 只加数据，不执行 pack 代码；注册表仍是唯一工具元数据源。
- 既有工具标签、CSV 校验结果、一列基因表行为不变；大小上限以 pack 声明为准（maftools 100→200 明示）。
- 不碰 Result Studio 结果面与 RS 保真；不新增依赖；不改扫描器词表。
- 测试可移植：核心测试用夹具注册表，不强制兄弟 pack 在位。

## 6. 验收门禁

- `node --test test/block233-tool-metadata-single-source.test.mjs test/tools-input-validation.test.mjs`（先红后绿）。
- `node --test test/tool-registry-script-links.test.mjs`（pack 在位时 23 条 0 死链）。
- `node scripts/d7-baseline.mjs --update` + `node --test test/domain-neutrality.test.mjs`。
- `npm run test:changed` + `npm run closeout` 十三门。

## 7. 收口（2026-10-21）

**结论：BLOCK-233 Q-DOMAIN P4-C 第 1 片 completed。**

### 7.1 交付

- **pack 0.2.1**（兄弟仓 `petri-pack-bio`，独立提交）：`registry/tool-registry.json` 23 条——补 `go-kegg`/`gsea`（来自既有 `tool-registry-entries.json`）；8 个严格校验工具声明 `csvValidation:true`；`go-kegg` 声明 `acceptsSingleColumnGeneList:true`。
- `core/petri-server/tool-registry.js`：新增 `listCsvValidationToolIds()` / `toolAcceptsSingleColumnGeneList()` 并导出。
- `tools-executor.js`：删除 19 项 `toolNames` Map（22 行），jobName 统一 `getToolDisplayName()`。
- `result-files.js`：严格 CSV 集合、一列基因表规则、上传大小上限全部改读注册表；删除 8 项硬编码与 `seurat/cellchat` 100MB 例外。
- 测试：`test/block233-tool-metadata-single-source.test.mjs`（9 组）+ `test/tools-input-validation.test.mjs` 夹具化（4/4 保持）。

### 7.2 验证

- 红绿先行：实现前 **8 pass / 5 fail**；实现后 block233 + input-validation **14/14 pass**；pack 脚本死链守卫 **1/1**。
- `test:changed`：42 个 Node 测试 **464 项 / 460 pass / 0 fail / 4 skip**。
- 域中性：**201→179 处**（−22）、**100→85 键**（15 个键归零），`d7-baseline --update` 后 0 新增/0 恶化。
- `npm run closeout` **十三门 PASS**（report 级 `skills:check` OK）；`gate:code-size` 重打 `tools-executor.js` 指纹 2101→2079 行后通过。

### 7.3 行为与边界

- 显示名、严格 CSV 集合、一列规则、大小上限逐项保持旧行为；**唯一对齐**=`maftools-mutation` 上传上限 100→200MB（跟随 pack 已声明的 `sizeLimitMB`），在 AUDIT-LOG 明示。
- 插件执行优先级未变：`getToolConfig` 仍先查 plugin-loader（go-kegg/gsea 插件在位时走插件脚本），注册表 fallback 仅在无插件时生效。
- 测试夹具化：核心测试不依赖兄弟 pack；pack 集成由 `test/tool-registry-script-links.test.mjs` 守卫（23 条 0 死链）。
- **P4-C 未完成**：S2 demo/artifact profiles、S3 workflow/learning、S4 methods、S5 result/RS 保真、S6 前端领域文案与兼容键仍 open，见 §4。G0 开发期常态 · 不外推 packaged/Provider/GA。
