# BLOCK-11 v0.2 整合计划（PHASE 0 报告合并后 · superseded 镜像）

> **本文档是镜像文件**。v0.2 plan 的实际源位于 `agent-tools/block-11-bioSkills-integration-plan-v0.2.md`（按协调任务指令路径落盘）。
>
> v0.2 在 DRAFT 阶段已被 `docs/block-11-bioSkills-integration-plan-v1.0.md`（v1.0，active canonical）的 §0.5 关键内容增量吸收；本镜像用于让 `docs:check` 把 v0.2 视为已 managed。
>
> DO NOT EDIT. 真实内容请修改源文件并在此镜像同步。

---

## 镜像声明

- **源文件**：`agent-tools/block-11-bioSkills-integration-plan-v0.2.md`（24,890 bytes，2026-08-18 由 BLOCK-11 PHASE 1 协调 worker 落盘）
- **本镜像**：docs:check 把 v0.2 视为已 managed 的最小占位
- **版本关系**：v0.2 是 v0.1 的整合 superset；v1.0 是 active canonical；v0.2 与 v1.0 关系待主 agent 决定是否 promote v0.2 → v1.1

## 关键差异（v0.2 vs v1.0 vs v0.1）

| 项 | v0.1 | v1.0 active | v0.2 superset |
|---|------|------------|------------|
| 规模数字 | 32 categories / ~170 SKILL.md | 32 categories / ~170 SKILL.md（沿用 v0.1） | **101 categories / 562 SKILL.md**（worker A 实测 3.2×） |
| Top 5 #3 | pathway-analysis P1 85 | pathway-analysis P1 85 | methylation-analysis P1 84 |
| Top 5 #4 | methylation-analysis P1 82 | methylation-analysis P1 82 | rna-quantification P2 78 |
| Top 5 #5 | read-qc P2 78 | read-qc P2 78 | alignment-files P2 76 |
| 覆盖目标 | ~3% → ~80%（32 中 26） | ~3% → ~80%（32 中 26） | 3.3% → 82%（49/60 covered+partial） |
| PHASE 1 内容 | scanpy-advanced + seurat + sc-analysis-standard | 同 v0.1 | **5 plugin + 1 skill**（scanpy-advanced / seurat / celltypist / cellchat / scvi-tools / sc-analysis-standard） |
| runtime 扩展决策 | §6 注意事项 | §6 注意事项 | §4.5 独立决策矩阵（PHASE 2 新建 variant-tools / PHASE 3 增量 methylKit-bsseq / PHASE 4 新建 quant-tools / PHASE 5 增量 pysam） |

详细 §0.5 / §0.6 / §4.5 内容请读源文件 `agent-tools/block-11-bioSkills-integration-plan-v0.2.md`。
