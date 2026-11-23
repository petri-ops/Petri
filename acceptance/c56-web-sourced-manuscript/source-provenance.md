# C-56 网络素材 provenance（2026-11-23）

## 来源（单一来源，可复核）

- **来源类型**：arXiv 开放获取预印本（非用户私有稿件、非网络随机抓取的受版权正文）
- **arXiv ID**：`arXiv:1412.3050`（v1 2014-12-09；本批取 abs 页当前 v4，最后修订 2016-09-26）
- **标题**：A Bayesian model selection approach for identifying differentially expressed transcripts from RNA-Seq data
- **作者**：Panagiotis Papastamoulis; Magnus Rattray
- **DOI**：`10.48550/arXiv.1412.3050`；期刊版 `10.1111/rssc.12213`（JRSSC 2017）
- **许可**：arXiv non-exclusive distribution license 1.0（`http://arxiv.org/licenses/nonexclusive-distrib/1.0/`）——允许分发与引用，须保留作者/来源署名
- **抓取时间**：2026-11-23
- **抓取地址**：`https://arxiv.org/abs/1412.3050`
- **抓取内容**：页面元数据 + 英文摘要全文 + 摘要内方法事实（已由 web_fetch 原样返回）

## 使用边界（红线）

1. **不整段复制**：成品稿件为中文重组（提取事实 + 改写），不是英文摘要的逐句翻译复制；
2. **不编造数字**：源摘要**未给出任何量化性能指标/数据集数量/运行时间/准确率**——成品稿件不得补造数值，凡无源数值处标 〈未覆盖〉；
3. **署名保留**：成品与报告均标注原作者 + arXiv ID + 许可；
4. **不外推**：本批只做 C-56 保真改写链路演练，不作学术结论、不声称复现该论文结果。

## 提取的事实清单（仅这些可进稿件，逐条可回溯到摘要）

| # | 事实（源摘要支撑） |
|---|---|
| F1 | 分子生物学进展使转录组量化成为可能，可将转录本评为两种生物条件间差异/等同表达 |
| F2 | 现有推断方法把"表达估计"与"差异表达"分开处理：主模型估计表达，输出再经差异模型后处理 |
| F3 | 本文同时处理两任务：联合估计表达水平与差异表达（转录本相对丰度在两条件间可相等或不等） |
| F4 | 层级贝叶斯模型基于 BitSeq 框架；用 MCMC 推断表达与差异表达的后验分布 |
| F5 | 固定维度变量具共轭性，full conditional 可解析推导 |
| F6 | 构造两个 sampler：reversible jump MCMC 与 collapsed Gibbs；摘要称后者表现最佳 |
| F7 | 引入比对 reads 到转录组的 cluster 表示，支持并行估计转录本子集边缘后验 |
| F8 | 算法以合成数据集与替代方法做 benchmark，并应用于真实 RNA-seq 数据 |
| F9 | 源码在线：`github.com/mqbssppe/cjBitSeq` |

**摘要中不存在的事实**（不得补造）：样本量、基因/转录本数、具体性能数值、p 值、运行时间、真实数据集名称/数量。

**源摘要关键英文原文字面（数字锁定锚点，逐字符保留以备复核）**：
- `"two biological conditions"`（两生物条件）
- `"these two tasks"`（两任务）
- `"Two samplers are constructed"`（两采样器）
- `"builds upon the BitSeq framework"`（BitSeq 框架）
- `"a reversible jump MCMC sampler and a collapsed Gibbs sampler"`（两类采样器原名）
- `"benchmarked against alternative methods using synthetic datasets and applied to real RNA-sequencing data"`（benchmark + 真实数据应用）
