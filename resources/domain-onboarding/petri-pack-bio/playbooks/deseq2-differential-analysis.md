# DESeq2 差异分析 playbook（教练化草稿 · item 87 第一阶段）

> **状态：草案，待领域专家（owner）确认后定稿。** 升级自包内 DESeq2 golden path 实战内容
> （demo 工具 `deseq2` + `test/fixtures/golden-path/deseq2-run.json`），按方案 §11「教练化」
> 重写：每步带领域含义 / 验收标准 / 常见坑 / 依据（真理源清单 id，机器可核）。
> 步骤顺序是领域惯例路径（golden path），不是唯一合法路径——教练复盘只做 diff，不做终判。

## 适用任务

有两/groups 以上条件、每条件 ≥3 生物学重复的 RNA-seq 计数矩阵 → 差异表达基因清单。
输入是**计数矩阵**（raw counts），不是 TPM/FPKM。

## 步骤

### 1. 数据导入与质检前置

- 做什么：读入 counts 矩阵与 coldata（样本元数据表），核对行列对齐、重复数、条件设计。
- 领域含义：DESeq2 的统计模型假设 counts 服从负二项分布，任何上游（比对/定量）换工具
  都要重算 counts；coldata 的每一列都是潜在 design 变量，缺列后面无法补救。
- 验收标准：矩阵行列名与 coldata 样本名一一对应；每条件生物学重复 ≥3；无负数、非整数 counts。
- 常见坑：用 TPM/FPKM/已归一化矩阵喂 DESeq2（模型假设直接被破坏）；样本名大小写/空格导致静默错位。
- 依据: bioconductor-deseq2

### 2. 预过滤（pre-filtering）

- 做什么：去掉几乎所有样本中 counts 近零的基因。
- 领域含义：不影响模型正确性，只省内存/多重检验负担；这是"卫生"步骤不是统计步骤。
- 验收标准：过滤规则写成代码且可复现（如 `rowSums(counts) >= 10`），报告过滤前后基因数。
- 常见坑：过滤规则没写进报告（读者无法复现）；误以为过滤能"改善 p 值"。
- 依据: bioconductor-deseq2

### 3. 设计公式（design formula）选择

- 做什么：`design = ~ batch + condition`——把关心的变量放最后，已知批次/混杂变量放前面。
- 领域含义：DESeq2 按 design 里的顺序做边际化；批次在前 = 在 condition 检验里扣除批次效应。
- 验收标准：design 公式在报告里显式写出；每个变量都来自 coldata 且理由可述。
- 常见坑：把 batch 放在 condition 之后（等于没校正）；把配对信息丢掉（paired design 当 unpaired 做）；
  变量名与 coldata 列名拼错导致因子被静默忽略。
- 依据: bioconductor-deseq2
- 依据: deseq2-paper

### 4. 估计与检验（DESeq → results）

- 做什么：`DESeq(dds)` 一步完成离散度估计、原始 LFC 估计、Wald 检验；
  `results(dds, contrast=...)` 提取指定对比。
- 领域含义：Wald 检验是默认；对比的参考/处理方向决定 log2FC 符号——方向搞反是报告级事故。
- 验收标准：contrast 的 ref/treatment 显式声明（对照 `contrast_ref`/`contrast_treat` 惯例）；
  报告 resultsNames(dds) 输出。
- 常见坑：contrast 方向写反（上调/下调全反）；对照因子水平默认按字母序（Control 恰好在前是运气不是设计）。
- 依据: bioconductor-deseq2

### 5. LFC 收缩（lfcShrink）

- 做什么：对低表达/高离散基因的 log2FC 做收缩（apeglm 默认），用于**排序与可视化**。
- 领域含义：收缩改善 LFC 估计的稳定性，但不改变 p/padj——DE 判定仍以未收缩 results 为准。
- 验收标准：报告注明收缩仅用于展示/排序，DE 判定阈值基于 results() 的 padj。
- 常见坑：用收缩后 LFC 的阈值筛基因并宣称"显著"（混入未过检验的基因）。
- 依据: bioconductor-deseq2

### 6. 多重检验与阈值（independent filtering + FDR）

- 做什么：以 `padj < 0.1`（FDR, Benjamini-Hochberg + 独立过滤）为默认显著阈值。
- 领域含义： Genome-wide 检验必须校正多重性；0.1 是 DESeq2 社区惯例默认，0.05 更严——阈值是
  领域约定不是数学真理，报告必须写明用了哪个。
- 验收标准：报告显式给出 padj 阈值、通过数、up/down 分计数。
- 常见坑：拿 raw p-value 阈值（p<0.05）当显著基因清单；不报告 up/down 各多少。
- 依据: bioconductor-deseq2
- 依据: deseq2-paper

### 7. 可视化与报告

- 做什么：PCA（用 vst/rlog 变换，不用 raw counts）、MA plot、volcano、top 基因热图。
- 领域含义：PCA 是样本级 QC——有样本离群要先解释再谈 DE；MA/volcano 的坐标轴是领域通识语言。
- 验收标准：每张图轴标签/单位齐全；PCA 图注明用了哪种变换；图注写明 padj 阈值。
- 常见坑：对 raw counts 直接做 PCA（方差被高表达基因绑架）；热图用未聚类的任意基因子集却宣称"全局模式"。
- 依据: bioconductor-deseq2

### 8. 结论谨慎度

- 做什么：结论按证据等级分层表述——「padj<0.1 且 |LFC|≥1 的 N 个基因」是数据结论；
  通路解释是解释性推断，必须标注为推断。
- 领域含义：差异分析回答"哪些基因在该对比下有统计证据"，不回答"为什么"；
  机制解释需要正交证据。
- 验收标准：报告区分数据结论与推断；推断句标注「推断，需正交验证」；负结果如实报告（非"没有差异"而是"在该检验力下未检出"）。
- 常见坑：把统计显著直接等同生物学重要；用单次未重复实验断言机制。
- 依据: deseq2-paper

## 常见坑速查（教练复盘用）

| 坑 | 代价 | 正确姿势 |
| --- | --- | --- |
| TPM/FPKM 喂 DESeq2 | 分布假设破坏，padj 无意义 | raw counts + DESeq2 内部归一化 |
| batch 放 design 末尾 | 批次效应混入 condition | `~ batch + condition` |
| contrast 方向反 | 全报告上调/下调颠倒 | 显式声明 ref/treatment 并复核 LFC 符号 |
| raw p 阈值筛基因 | 假阳性不可控 | padj（FDR）阈值 + 写明数值 |
| 收缩 LFC 做 DE 判定 | 混入未过检验基因 | 判定用 results()，收缩仅展示 |
| 重复数 <3 | 检验力不足，估计不稳 | 每条件 ≥3 生物学重复，不足时如实降级结论 |

## 验收红绿（HK-01 文化扩展——领域尺子可执行化）

- R1 输入是 raw counts（非 TPM/FPKM/归一化矩阵）
- R2 design 公式显式且批次变量在 condition 前
- R3 contrast ref/treatment 显式声明
- R4 显著性阈值写明（padj + 数值），up/down 分计数报告
- R5 PCA 用 vst/rlog 变换并注明
- R6 结论分层：数据结论与推断分开，推断句带标注
