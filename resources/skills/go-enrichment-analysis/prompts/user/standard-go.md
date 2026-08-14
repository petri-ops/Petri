# 用户 Prompt 模板：标准 GO 富集分析

## 模板变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `{{geneList}}` | 基因列表（逗号分隔或换行） | `TP53, BRCA1, EGFR` |
| `{{organism}}` | 物种代码 | `hsa` (人), `mmu` (小鼠), `rno` (大鼠) |
| `{{ontology}}` | GO Ontology 类型 | `BP`, `MF`, `CC`, `ALL` |
| `{{pvalueCutoff}}` | P-value 阈值 | `0.05` |
| `{{qvalueCutoff}}` | Q-value 阈值 | `0.2` |
| `{{minGSSize}}` | 通路最小基因数 | `10` |
| `{{maxGSSize}}` | 通路最大基因数 | `500` |

---

## 标准 GO 富集分析

请对 **{{geneList}}** 进行 GO 富集分析：

### 输入参数

- **基因列表**：{{geneList}}（支持 Entrez ID 或基因符号）
- **物种**：{{organism}}（默认 hsa）
- **Ontology**：{{ontology}}（默认 ALL：BP/MF/CC 全部分析）
- **P-value 阈值**：{{pvalueCutoff}}（默认 0.05）
- **Q-value 阈值**：{{qvalueCutoff}}（默认 0.2）

### 分析流程

1. **数据预处理**
   - 验证基因 ID 格式
   - 自动转换 symbol ↔ entrez（如需要）
   - 检查基因数量（建议 10-5000 个基因）

2. **GO 富集分析**
   - 使用 clusterProfiler 的 `enrichGO()` 函数
   - 对 BP、MF、CC 三个 Ontology 分别进行超几何检验
   - 应用 Benjamini-Hochberg 多重检验校正

3. **结果可视化**
   - **dotplot.pdf**：富集气泡图（Top 10 显著通路）
   - **barplot.pdf**：富集条形图（当 BP 显著结果 >5 时生成）
   - **cnetplot.pdf**：基因-通路网络图（当基因数 ≤100 时生成）

4. **结果解读**
   - 识别最显著的生物学过程
   - 解释结果的生物学意义
   - 提供下游分析建议

### 输出要求

分析完成后，输出以下文件：

| 文件 | 类型 | 说明 |
|------|------|------|
| `enrichment_table.csv` | CSV | 完整 GO 富集结果 |
| `dotplot.pdf` | PDF | 富集气泡图 |
| `barplot.pdf` | PDF | 富集条形图（如适用） |
| `cnetplot.pdf` | PDF | 基因-通路网络图（如适用） |
| `analysis_report.md` | Markdown | 结果解读报告 |

---

## 示例用法

### 示例 1：基本 GO 富集分析
```
对以下基因进行 GO 富集分析：
- 基因：TP53, BRCA1, EGFR, MYC, BCL2
- 物种：hsa（人类）
- 使用默认参数
```

### 示例 2：仅分析 BP Ontology
```
对 deg_results.csv 中的上调基因进行 GO 富集分析：
- 物种：mmu（小鼠）
- 仅分析 BP（生物学过程）
- P-value 阈值：0.01
```

### 示例 3：自定义阈值
```
对基因列表进行 GO 富集分析：
- 基因：gene_list.txt
- 物种：rno（大鼠）
- Ontology：ALL
- P-value 阈值：0.05
- Q-value 阈值：0.1
- 最小基因数：5
```

### 示例 4：从 DEG 结果提取基因
```
从差异分析结果中进行 GO 富集：
- 输入：degs_up.csv（上调基因）
- 物种：hsa
- Ontology：ALL
- 使用默认阈值
```

---

## 物种代码参考

| 代码 | 物种 | OrgDb |
|------|------|-------|
| `hsa` | 人类 (Homo sapiens) | org.Hs.eg.db |
| `mmu` | 小鼠 (Mus musculus) | org.Mm.eg.db |
| `rno` | 大鼠 (Rattus norvegicus) | org.Rn.eg.db |
| `dre` | 斑马鱼 (Danio rerio) | org.Dr.eg.db |
| `cel` | 线虫 (Caenorhabditis elegans) | org.Ce.eg.db |
| `dme` | 果蝇 (Drosophila melanogaster) | org.Dm.eg.db |
| `ath` | 拟南芥 (Arabidopsis thaliana) | org.At.eg.db |
| `osa` | 水稻 (Oryza sativa) | org.Og.eg.db |

---

## 注意事项

- 确保基因 ID 类型一致（全部 symbol 或全部 entrez）
- 基因数量建议在 10-5000 之间，过少可能无显著结果，过多分析较慢
- 默认使用人类物种的 GO 数据库（GO.db）
- Q-value 阈值用于控制 FDR，建议设置在 0.1-0.3 之间
- 如需分析其他物种，需要安装对应的 OrgDb 包
