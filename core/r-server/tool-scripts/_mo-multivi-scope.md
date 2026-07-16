# MultiVI 多组学整合工具范围卡

## Tool ID

`mo-multivi`（task type: `mo_multivi`）

## Version targeted

- BioF3 Python 容器: `Python 3.11+`
- 关键包: `scvi-tools` (MultiVI) / `scanpy` / `anndata`

## Canonical workflow source

**官方文档**: scvi-tools MultiVI tutorial (Ashuach et al., 2023 Nat Methods)

## Steps (in-scope) — 多模态深度学习整合

1. **读多模态 h5ad** — RNA + ATAC（或蛋白质）
2. **MultiVI 训练** — 联合 latent 空间学习
3. **Latent embedding** — 细胞在整合空间投影
4. **UMAP 可视化** — 整合前后对比
5. **模态对齐评估** — batch effect / modality mixing
6. **中间数据** — latent_embedding.csv / umap_coords.csv

## Out-of-scope (不做)

- ❌ **MOFA+ 因子分解**（见 mo-mofa 工具，线性方法）
- ❌ **WNN / Seurat v4 整合**（独立工具）
- ❌ **SNF 网络融合**（见 mo-snf 工具）
- ❌ **totalVI (CITE-seq)**（见 mo-citeseq 工具）
- ❌ **Imputation / differential**（高级下游，用户自行）

## Default params (官方默认)

| 参数 | 默认值 | 来源 |
|------|--------|------|
| `n_latent` | `30` | MultiVI 默认 |
| `n_layers` | `2` | MultiVI 默认 |
| `max_epochs` | `100` | scvi-tools 常用 |
| `gene_likelihood` | `nb` | MultiVI 默认 |

## Expected outputs

图（PNG）：UMAP 整合前 / UMAP 整合后 / modality mixing / batch effect
中间数据：latent_embedding.csv / umap_coords.csv / summary.json

## 工具间数据联动

- ✅ 上游：用户提供多模态 h5ad（RNA + ATAC）
- ✅ 下游：latent_embedding.csv 可进 consensus-cluster / ml-classifier
