# 用户 Prompt 模板：标准差异表达分析

## 模板变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `{{dataset}}` | 数据集名称或路径 | `demo-counts.csv` |
| `{{metadata}}` | 分组信息表路径 | `demo-coldata.csv` |
| `{{group_column}}` | 分组列名 | `condition` |
| `{{group1}}` | 对照组名称 | `control` |
| `{{group2}}` | 实验组名称 | `treatment` |
| `{{method}}` | 分析方法 | `deseq2` |
| `{{padj_threshold}}` | 显著性阈值 | `0.05` |
| `{{logfc_threshold}}` | Fold Change 阈值 | `1` |
| `{{species}}` | 物种 | `human` |
| `{{run_enrichment}}` | 是否运行富集分析 | `true` / `false` |

---

## 标准 DEG 分析

请对 **{{dataset}}** 数据集进行标准的差异表达分析：

1. **数据输入**：
   - 计数矩阵：`{{dataset}}`
   - 样本元数据：`{{metadata}}`
   - 分组列：`{{group_column}}`
   - 比较组：{{group1}} vs {{group2}}

2. **分析参数**：
   - 方法：`{{method}}`
   - 校正后 P 值阈值：{{padj_threshold}}
   - Log2 Fold Change 阈值：{{logfc_threshold}}
   - 物种：{{species}}

3. **分析流程**：
   - 表达质控
   - 低表达基因过滤
   - DESeq2 标准化与差异分析
   - 结果可视化（火山图、热图、MA 图）

4. **输出要求**：
   - 完整的 DEGs 结果表（CSV）
   - 火山图（PNG, 300 DPI）
   - 质控报告（HTML）
   - 差异基因热图

5. **富集分析**：
   - 运行 GO/KEGG 富集：{{run_enrichment}}
   - 如运行，物种使用 {{species}} 数据库

---

## 示例用法

### 示例 1：基本分析
```
请对 demo-counts.csv 进行标准 DEG 分析：
- 分组信息在 demo-coldata.csv
- 分组列为 condition
- 比较 Control 组 vs Treatment 组
- 使用默认参数（deseq2, padj<0.05, |log2FC|>1）
```

### 示例 2：自定义参数
```
使用 deseq2 方法对 counts.csv 进行差异分析：
- 分组列为 treatment
- 比较 KO vs WT
- padj 阈值设为 0.01
- log2FC 阈值设为 2
- 物种为 mouse
- 同时运行 GO 富集分析
```

### 示例 3：宽松阈值
```
分析 RNA-seq 数据 experiment1.csv：
- 样本分组见 metadata.csv 的 group 列
- A 组 vs B 组
- 使用宽松阈值（padj<0.1）探索性分析
- 运行 KEGG 富集
```

---

## 注意事项

- 确保计数矩阵为非负整数格式
- 确保元数据文件的样本顺序与计数矩阵一致
- 确保分组列的值只包含两个不同的组别
- 如有批次效应，请在分组信息中标注
