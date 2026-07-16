# totalVI CITE-seq 整合工具范围卡

## Tool ID

`mo-citeseq`（task type: `mo_citeseq`）

## Version targeted

- BioF3 Python 容器: `Python 3.11+`
- 关键包: `scvi-tools` (totalVI) / `scanpy` / `anndata`

## Canonical workflow source

**官方文档**: scvi-tools totalVI tutorial (Gayoso et al., 2021 Nat Methods)

## Steps (in-scope) — CITE-seq 联合分析

1. **读 CITE-seq h5ad** — RNA + 蛋白质 (ADT)
2. **totalVI 训练** — 联合 latent 空间 + 蛋白质去噪
3. **Latent embedding** — 细胞在整合空间投影
4. **UMAP 可视化** — 整合前后对比
5. **蛋白质去噪** — denoised protein expression
6. **中间数据** — latent_embedding.csv / protein_denoised.csv

## Out-of-scope (不做)

- ❌ **MultiVI (RNA+ATAC)**（见 mo-multivi 工具）
- ❌ **MOFA+ / SNF**（见 mo-mofa / mo-snf，线性方法）
- ❌ **WNN / Seurat v4 CITE-seq**（独立工具）
- ❌ **ADT 质控 / isotype control 去除**（用户自行预处理）
- ❌ **Differential protein analysis**（高级下游）

## Default params (官方默认)

| 参数 | 默认值 | 来源 |
|------|--------|------|
| `n_latent` | `20` | totalVI 默认 |
| `n_layers` | `2` | totalVI 默认 |
| `max_epochs` | `100` | scvi-tools 常用 |
| `protein_likelihood` | `nb` | totalVI 默认 |

## Expected outputs

图（PNG）：UMAP 整合前 / UMAP 整合后 / protein correlation / RNA-protein comparison
中间数据：latent_embedding.csv / protein_denoised.csv / summary.json

## 工具间数据联动

- ✅ 上游：用户提供 CITE-seq h5ad（RNA + ADT）
- ✅ 下游：latent_embedding.csv 可进 consensus-cluster / ml-classifier
