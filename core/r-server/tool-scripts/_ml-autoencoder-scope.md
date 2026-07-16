# ML Autoencoder 特征提取工具范围卡

## Tool ID

`ml-autoencoder`

## Version targeted

- BioF3 Python 容器: `Python 3.11+`
- 关键包: `torch` / `scanpy` / `scikit-learn`

## Canonical workflow source

**官方文档**: PyTorch Autoencoder tutorial + scvi-tools 深度学习模块

## Steps (in-scope) — 深度学习特征提取

1. **读 expression + label** — h5ad 或 CSV
2. **预处理** — 归一化 / log1p / 高变基因筛选
3. **Autoencoder 构建** — encoder-decoder 架构，bottleneck 维度可配
4. **训练** — Adam optimizer，early stopping
5. **特征提取** — bottleneck 层输出作为降维特征
6. **下游可视化** — UMAP / PCA on latent / 分类性能对比
7. **manifest + summary + report**

## Out-of-scope (不做)

- ❌ **VAE / scVI 变分自编码器**（见 ml-scvi-annotate 工具）
- ❌ **分类器训练**（见 ml-classifier，本工具只做特征提取）
- ❌ **SHAP 解释**（见 shap-explain）
- ❌ **GAN / 对抗训练**（高级，独立工具）
- ❌ **预训练模型 fine-tune**（独立工具）

## Default params

| 参数 | 默认值 | 来源 / 说明 |
|------|--------|---------|
| `latent_dim` | `32` | 常用瓶颈维度 |
| `hidden_dims` | `[256, 128]` | 编码器逐层缩减 |
| `lr` | `1e-3` | Adam 默认 |
| `epochs` | `100` | early stopping 可提前终止 |
| `batch_size` | `32` | PyTorch 常用 |

## Expected outputs

图（PNG）：loss 曲线 / UMAP on latent / PCA on latent / 分类性能对比
中间数据：latent_features.csv / autoencoder_model.pt / metrics_summary.json

## 工具间数据联动

- ✅ 上游：可导入 ml-feature-select 的 consensus_top_genes.csv 作为输入特征
- ✅ 下游：latent_features.csv 可进 ml-classifier 做分类
