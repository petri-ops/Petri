# BLOCK-11: bioSkills 生态集成计划

> Plan ID: `BLOCK-11-BIOSKILLS-INTEGRATION`
> Kind: Work Package
> Status: **DRAFT v0.1** — awaiting user explicit ruling to activate
> Canonical entrypoint: `docs/block-11-bioSkills-integration-plan.md`
> Truth Domain: `block-11-bioSkills-integration`
> Archive Policy: `retain_stable_path`
> Last Updated: 2026-08-18

---

## §0 用户裁决

**必须用户显式裁决后启动。**

用户已表达意图：将 [GPTomics/bioSkills.git](https://github.com/GPTomics/bioSkills) 生态接入 BioF3 Desktop Skills 系统。

当前存在 active 工作包 `BLOCK-10-ARCHITECTURE`（PHASE 0 已收口，待 PHASE 1 启动）。

**单工作包串行纪律**：同一时间只有一个 active 工作包。用户在以下选项中裁决：

- **选项 A**：暂停 BLOCK-10，先做 BLOCK-11（bioSkills 生态）
- **选项 B**：BLOCK-10 继续，BLOCK-11 等 BLOCK-10 收口后再启动
- **选项 C**：两包并行（需说明理由，违反单工作包串行纪律）

---

## §1 背景与目标

### 1.1 bioSkills.git 是什么

GPTomics/bioSkills (1.2k Stars, 已 archive) 是一套 AI Coding Agent 的**生信 Prompt 指南库**：
- 32 个生信 category
- ~170 个 SKILL.md 文件
- 每个 SKILL.md = 生信最佳实践 Prompt 模板（供 AI Agent 读取后生成代码）
- **不是**：可执行代码 / Plugin / Workflow Engine

### 1.2 BioF3 Desktop Skills 是什么

BioF3 Skills 是**可执行工作流引擎**：
- JSON manifest (`skill.json`) + DAG Workflow + Plugin 执行器 + Recovery 策略
- 当前只有 2 个 built-in 生信 Skill（deg-analysis-standard, go-enrichment-analysis）
- 生态覆盖率 ~3%

### 1.3 目标

将 bioSkills 的**内容领域**映射为 BioF3 Skills 的**可执行生态**：
- 目标：覆盖率从 ~3% → ~80%+（32 categories 中 26 个有 plugin + skill）
- 不做：把 SKILL.md 的 Prompt 文本直接搬进 BioF3（那是 Prompt Library，不是 Execution Engine）

---

## §2 范围与边界

### 2.1 In Scope

- [ ] 制定 bioSkills → BioF3 plugin/skill 的优先级路线图
- [ ] 实现 Top 5 priority categories 的 plugin + skill.json（见 §3）
- [ ] 验证 workflow-engine 能正确调度新 plugin
- [ ] 更新 `resources/built-in-plugins/manifest.json`
- [ ] 更新 `resources/skills/` + `resources/skills/manifest.json`
- [ ] 4 治理门禁 GREEN（docs:check / tsc / ui:audit:check / docs:reconcile）

### 2.2 Out of Scope（G1+ / 后续工作包）

- ❌ marketplace 真实后端（当前只有 placeholder）
- ❌ 所有 plugin 的 packaged artifact 构建 + 公证 + 签名
- ❌ Provider 矩阵 / OSS 远程分发
- ❌ GA 公证流水线
- ❌ MCP Server 暴露新 plugin 为工具（skill-runtime 层够了，MCP 暴露是 G1+）
- ❌ 把 bioSkills SKILL.md 的 Prompt 文本逐字翻译进 BioF3 skill.json（那是 Prompt Library 工作流，不适合可执行引擎）
- ❌ 32 个 category 全部实现（那是超大型生态工作，需多工作包，后续再规划）

### 2.3 验收证据

- `resources/built-in-plugins/{plugin-id}/plugin.json` 存在且通过 schema 校验
- `resources/skills/{skill-id}/skill.json` 存在且通过 `skill-schema.js` 校验
- `skill-registry.js discover()` 能发现所有新 plugin/skill
- `workflow-engine.js` 能实例化新 plugin 并执行
- 4 治理门禁 GREEN

---

## §3 优先级路线图（Top 5）

基于 bioSkills category 技能数 × BioF3 当前空白 × R/Python 实现难度综合评分：

### 🟢 Phase 1 — Top 5（本次工作包范围）

| Priority | Category | Skills | BioF3 现状 | 评分 | Plugin ID | Skill ID |
|----------|---------|--------|-----------|------|-----------|----------|
| **P0** | `single-cell` | 17 | scanpy ✅ + squidpy ✅，缺 Seurat/Pertpy/Cassiopeia | **95** | `seurat`, `scanpy-advanced` | `sc-analysis-standard` |
| **P0** | `variant-calling` | 13 | **完全空白** | **92** | `variant-calling-gatk` | `variant-analysis-standard` |
| **P1** | `pathway-analysis` | 6 | clusterProfiler ✅（已有 go-kegg） | **85** | `reactomepa`, `gsea-advanced` | `pathway-enrichment-standard` |
| **P1** | `methylation-analysis` | 10 | **完全空白** | **82** | `methylkit`, `bsseq` | `methylation-analysis-standard` |
| **P2** | `read-qc` | 7 | expression-qc ✅（已有 FastQC 基础） | **78** | `fastqc-plus`, `multiqc` | `read-qc-standard` |

### 🔶 Phase 2 — Next 5（后续工作包候选）

| Priority | Category | Skills | 评分 | Plugin ID |
|----------|---------|--------|------|-----------|
| **P2** | `atac-seq` | 12 | 75 | `macs3`, `chipseeker` |
| **P2** | `genome-intervals` | 8 | 73 | `bedtools-wrapper`, `deeptools` |
| **P3** | `population-genetics` | 7 | 70 | `plink-wrapper` |
| **P3** | `rna-quantification` | 4 | 68 | `salmon`, `kallisto` |
| **P3** | `alignment-files` | 10 | 65 | `samtools-wrapper` |

### 🔴 Phase 3 — 剩余 22 categories

（不在本次工作包范围，列入 `docs/bioSkills-ecosystem-roadmap.md` 长期规划）

---

## §4 实施方法

### 4.1 Plugin 实现模式（参考现有 deseq2）

每个新 plugin 必须有：
```
resources/built-in-plugins/{plugin-id}/
├── plugin.json          # Plugin manifest（schema 见 manifest.schema.json）
├── environment.json     # 依赖包声明（r/Python version ranges）
├── tool-definition.json # MCP tool definition（可选，MCP 暴露时用）
├── scripts/
│   └── run.R / run.py  # 主执行脚本
├── golden-revisions/    # 离线验证数据
├── acceptance.json      # 验收标准
└── README.md
```

### 4.2 Skill 实现模式（参考现有 deg-analysis-standard）

每个新 skill 必须有：
```
resources/skills/{skill-id}/
├── skill.json           # Manifest（schema 见 skill-schema.js）
├── prompts/
│   ├── system.md       # 系统 prompt（从 bioSkills SKILL.md 提炼）
│   └── user/
│       └── standard-*.md
└── metadata.json
```

### 4.3 bioSkills SKILL.md → BioF3 skill.json 转换规则

bioSkills SKILL.md（Markdown）→ BioF3 skill.json（JSON）的映射：

| bioSkills 字段 | BioF3 skill.json 字段 | 说明 |
|---------------|----------------------|------|
| `Use when...` | `description` | 直接复用 |
| `Quick Start` | `prompts.system` | 提炼为系统 prompt |
| `Example Prompts` | `prompts.user_templates` | 转为模板字符串 |
| `Version Compatibility` | `metadata.compatibility` | 转换版本范围 |
| `Category` | `category` | 格式：`bioinformatics/{subdomain}` |
| 工具列表 | `plugins.required` | 映射到 BioF3 plugin id |
| 核心流程 | `workflows.default` | 转为 DAG step 名 |

### 4.4 关键原则

1. **Plugin first, Skill second**：先实现 plugin 可执行，再包装 skill
2. **Minimize new plugin id**：尽量复用现有 plugin（如 scanpy 已有时，补 scanpy-advanced 而非新建）
3. **Version compatibility 保守**：bioSkills 的版本要求普遍宽松，BioF3 应取交集
4. **No MCP exposure in this package**：只做到 skill-runtime 层，MCP 是 G1+ 工作
5. **Offline-verified only**：不做 packaged/dist/Provider/G1+ 验证

---

## §5 实施 PHASE

### PHASE 0：调研与准备（无代码改动）

- [ ] 读取 bioSkills.git 仓库，提取 32 categories 的完整 skill 列表
- [ ] 逐一对照 BioF3 现有 plugin（deg / go-kegg / gsea / scanpy / squidpy / deseq2 / volcano-plot / expression-qc 等）
- [ ] 生成 gap 矩阵（bioSkills category × BioF3 plugin coverage）
- [ ] 确认 Top 5 plugin 的技术可行性（Python/R 环境依赖、现有包是否已装）
- [ ] 确认 Top 5 的 `environment.json` 依赖与 `biof3-py-runtime` / `biof3-r-runtime` 的交集
- [ ] 输出：`docs/block-11-bioSkills-gap-matrix.md`

### PHASE 1：single-cell plugin + skill（P0）

- [ ] `seurat` plugin（plugin.json / environment.json / scripts/run.R / golden-revisions / acceptance.json）
- [ ] `scanpy-advanced` plugin（补完 scanpy 缺失功能：perturb-seq / trajectory）
- [ ] `sc-analysis-standard` skill.json + prompts/
- [ ] manifest.json 更新（`seurat` + `scanpy-advanced` entry）
- [ ] 离线验证：workflow-engine 实例化 seurat/scanpy-advanced

### PHASE 2：variant-calling plugin + skill（P0）

- [ ] `variant-calling-gatk` plugin（plugin.json / environment.json / scripts/run.sh / golden-revisions / acceptance.json）
- [ ] `variant-analysis-standard` skill.json + prompts/
- [ ] manifest.json 更新（`variant-calling-gatk` entry）
- [ ] 离线验证：workflow-engine 实例化 variant-calling-gatk

### PHASE 3：pathway + methylation plugins + skills（P1）

- [ ] `reactomepa` plugin
- [ ] `methylkit` plugin
- [ ] `pathway-enrichment-standard` skill.json
- [ ] `methylation-analysis-standard` skill.json
- [ ] manifest.json 更新

### PHASE 4：read-qc plugin + skill（P2）

- [ ] `multiqc` plugin
- [ ] `read-qc-standard` skill.json
- [ ] manifest.json 更新

### PHASE 5：收口（4 治理门 + 文档）

- [ ] 4 治理门禁 GREEN（docs:check / tsc 0 / ui:audit:check / docs:reconcile 0）
- [ ] `resources/skills/manifest.json` 更新（新增 skill entries）
- [ ] `resources/built-in-plugins/manifest.json` 更新（新增 plugin entries）
- [ ] `docs/bioSkills-ecosystem-roadmap.md`（Phase 2/3 路线图）
- [ ] `docs/block-11-bioSkills-integration-closeout.md`
- [ ] `docs/AUDIT-LOG.md` 登记
- [ ] `docs/DOC-REGISTRY.json` BLOCK-11 → completed

---

## §6 依赖

- ✅ `core/shared-backend/skill-schema.js`（skill manifest 校验）
- ✅ `core/shared-backend/skill-registry.js`（registry discover）
- ✅ `core/shared-backend/workflow-engine.js`（workflow 执行）
- ✅ `core/shared-backend/skill-runtime.js`（skill → plugin 调度）
- ✅ `resources/built-in-plugins/manifest.schema.json`（plugin manifest schema）
- ✅ 现有 `biof3-r-runtime` / `biof3-py-runtime`（依赖基础）
- ⚠️ `biof3-py-runtime` 可能需要补充：`seurat`（R）、`GATK`（需要额外安装）、`methylKit`（R）

---

## §7 风险

| Risk | Severity | Mitigation |
|------|----------|------------|
| GATK license 限制 | High | 用 bcftools/GATK4 开源子集代替；或 defer variant-calling plugin |
| 环境包依赖超出现有 runtime | Medium | 先确认 `biof3-r-runtime` 包列表，不够则 defer 该 plugin |
| seurat 启动慢（~GB 内存） | Medium | acceptance.json 加 memory threshold |
| bioSkills SKILL.md 内容质量参差 | Low | 只映射技术领域，不复制 Prompt 文本 |
| BLOCK-10 并行冲突 | High | 等用户裁决 |

---

## §8 完成语义

BLOCK-11 完成 = 以下全部为真：

- Top 5 categories 的 plugin.json 全部通过 `resources/built-in-plugins/manifest.schema.json` 校验
- Top 5 categories 的 skill.json 全部通过 `core/shared-backend/skill-schema.js` 校验
- `skill-registry.js discover()` 输出包含所有新增 plugin/skill
- `npm run docs:check` GREEN
- `npm run ui:audit:check` GREEN（无 UI 改动时继承）
- `npm run docs:reconcile` 0 issues
- TypeScript 0 errors（前端相关改动时）
- 文档更新：`resources/skills/manifest.json` + `resources/built-in-plugins/manifest.json` + `docs/bioSkills-ecosystem-roadmap.md`

---

## §9 文档清单

| Document | Kind | Status | Path |
|----------|------|--------|------|
| BLOCK-11 bioSkills Integration Plan | work-package | draft | `docs/block-11-bioSkills-integration-plan.md` |
| bioSkills Gap Matrix | reference | pending | `docs/block-11-bioSkills-gap-matrix.md` |
| bioSkills Ecosystem Roadmap | reference | pending | `docs/bioSkills-ecosystem-roadmap.md` |
| BLOCK-11 Closeout | closeout | pending | `docs/block-11-bioSkills-integration-closeout.md` |

---

## §10 参考

- [GPTomics/bioSkills.git](https://github.com/GPTomics/bioSkills)（source）
- `core/shared-backend/skill-schema.js`（skill manifest schema）
- `core/shared-backend/skill-registry.js`（registry discovery）
- `resources/built-in-plugins/manifest.schema.json`（plugin manifest schema）
- `resources/skills/deg-analysis-standard/skill.json`（skill 参考实现）
- `resources/built-in-plugins/deseq2/plugin.json`（plugin 参考实现）
