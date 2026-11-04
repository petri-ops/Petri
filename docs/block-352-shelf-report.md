# BLOCK-352 扩展生态货架点验报告（2026-11-05）

- 计划：`docs/block-352-extension-shelf-audit-plan.md`；总纲：`docs/next-phase-program-2026-11-05.md` 包 5/7
- 矩阵：`acceptance/block-352/shelf-matrix.json`（`scripts/block352-shelf-audit.mjs` 机械生成，可复跑）
- 判定三态：**available**（真实动作证据）/ **detour**（需绕路，带具体步骤）/ **shell**（在架无实现或不可触发）
- 阶段边界：**G0 开发期常态 · 不外推 packaged / Provider / GA**

## 1. 三货架总览

| 货架 | 条目 | available | detour | shell |
| --- | --- | --- | --- | --- |
| 技能（内置 11 + pack 3） | 14 | **14** | 0 | 0 |
| 插件（pack） | 7 | **3** | 4 | 0 |
| MCP | server 面 + 客户端货架 | **2** | 0 | 0 |
| **合计** | **21+2** | 19 | 4 | 0 |

**上轮判词「货架可见不可用」的修正**：货架本体无空壳（0 shell）；不可用项全部集中在 pack 插件的**运行时依赖与 pack 仓缺陷**，且均有具体绕路步骤——「看得见」的都「点得动」，点不动的有明确修法。

## 2. 逐件判定（关键行）

### 技能 14/14 available
- 内置 11（coding-playbook/defuddle/excalidraw-diagram/json-canvas/knap/mermaid-visualizer/obsidian-bases/obsidian-cli/obsidian-markdown/obsidian-setup/visualize）：skill.json 契约合规（id/name/description/version）；契约校验=npm run skills:check（14/14 在案）；触发=skill_discover/skill_get 工具面。
- pack 3（deg-analysis-standard/go-enrichment-analysis/sc-analysis-standard）：同契约形态合规。
- 判定探针修正（采集期实机抓真）：这些技能的契约文件是 **skill.json**（skillManifestVersion 契约）而非 SKILL.md——首版探针误判 5 个 shell，已按产品双契约形态修正。

### 插件 7 件（隔离后端真跑=真实动作证据）
- **available ×3**：expression-qc（job 完成 → 10 产物）、deg-standardizer（7 产物）、volcano-plot（5 产物）——demo 输入真跑出真 artifact。
- **detour ×4**（均带绕路步骤，见矩阵 basis）：
  - go-kegg / gsea：依赖 r-enrichment capability bundle 未就绪（下载/校验失败）→ 绕路=预置 bundle 或联网授权后 capability-provisioning 自动就绪。
  - deseq2：pack 仓 `plugins/deseq2/scripts/deseq2.R:72-73` 跨行字符串语法错（C-46）→ 绕路=pack 仓两行 paste0 修复后真跑即通。
  - sample-metadata-validator：真跑 exit 1（demo 输入组合与生产形态差异）→ 绕路=以 tool_jobs error 全文定位失败行 / 以生产 counts+metadata 真跑。
- **0 shell**：7 件全部有 tool-definition（可解析）+ catalog 在架（隔离后端 count=7）。

### MCP
- **server 面 available**：`src/mcp-server.js` stdio JSON-RPC 真实握手 initialize 成功 + tools/list 返回 21 工具（registry 单源）。
- **客户端货架**：用户配置驱动（/extensions 页），隔离后端如实计数 **0 条配置**——货架空但货架本体功能在（CRUD+治理面 BLOCK-221 在案），无判定对象故不产空壳判定。

## 3. 空壳处置台账

本轮 **0 空壳**——无处置项。历史嫌疑（BLOCK-346 时代的「休眠插件」）经本次逐件真跑排除：插件货架的「休眠」实为运行时依赖未就绪（detour）而非实现缺失（shell）。

## 4. 门禁与负测

- `test/block352-shelf-audit.test.mjs` 5/5：矩阵全判定 + available 带真实动作证据 + detour 带绕路步骤 + **负测**（造 `verdict:'pending'` 无依据条目 → 判红，恢复判绿）+ shell 处置语义。
- 新增货架条目漏判定 = 矩阵 totals.allJudged=false + 契约测试红（机械断言，随 test:changed 进 closeout）。

*G0 开发期常态 · 不外推 packaged / Provider / GA。*
