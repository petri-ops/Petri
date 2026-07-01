// ============================================================
// /algorithms 页数据层 — 生信算法卡片
//
// 每张卡片解释一个工具背后的核心算法：公式、流程、关键参数、适合/不适合场景。
// 数据在 build 时打包进 JS bundle（SSG），AI 爬虫可直接从静态 HTML 抓取。
// ============================================================

export type AlgorithmCategory =
  | 'differential-expression'
  | 'enrichment'
  | 'network'
  | 'survival'
  | 'single-cell'
  | 'mutation';

export interface AlgorithmKeyParam {
  name: string;
  desc: string;
}

export interface AlgorithmCard {
  id: string;
  name: string;
  name_zh: string;
  category: AlgorithmCategory;
  one_liner: string;
  principle: string; // 核心洞察：为什么这个算法有效，不是"做什么"而是"为什么这样做"
  formula: string;
  flow: string[];
  key_params: AlgorithmKeyParam[];
  suitable: string[];
  not_suitable: string[];
  related_tool?: string;
  related_tutorial?: string;
  related_code?: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}

export const ALGORITHM_CATEGORIES: { id: AlgorithmCategory; name_zh: string; name_en: string }[] = [
  { id: 'differential-expression', name_zh: '差异分析', name_en: 'Differential Expression' },
  { id: 'enrichment', name_zh: '富集分析', name_en: 'Enrichment' },
  { id: 'network', name_zh: '网络分析', name_en: 'Network' },
  { id: 'survival', name_zh: '生存分析', name_en: 'Survival' },
  { id: 'single-cell', name_zh: '单细胞', name_en: 'Single-cell' },
  { id: 'mutation', name_zh: '突变分析', name_en: 'Mutation' },
];

export const ALGORITHMS: AlgorithmCard[] = [
  {
    id: 'deseq2-nb',
    name: 'DESeq2',
    name_zh: '负二项模型差异分析',
    category: 'differential-expression',
    one_liner:
      '用负二项分布建模 count 数据的过度离散，估计每个基因的离散度 α，再用 Wald 检验算显著性，BH 校正得 padj。',
    principle:
      'RNA-seq count 的方差远大于均值（过度离散）。泊松假设方差=均值，会低估方差 → 假阳性爆炸。负二项分布多了一个离散度参数 α，专门吸收这部分"额外方差"。关键洞察：α 不是常数，高表达基因的 α 小（稳定），低表达基因的 α 大（噪声多），DESeq2 拟合这条 mean-dispersion 趋势线，把单个基因的 α 往趋势线上"拉"（shrinkage），让低表达基因的估计不再被少数样本带飞。',
    formula: 'K_ij ~ NB(μ_ij, α_i)\nμ_ij = s_j · q_ij\nα_i = f(μ̄_i)  (mean-dispersion trend)',
    flow: [
      'raw counts 矩阵',
      'size factor 估计 (中位数比例)',
      '拟合 mean-dispersion 趋势',
      '每个基因离散度 α_i 收缩',
      'Wald 检验: z = β / SE(β)',
      'BH 校正 → padj',
    ],
    key_params: [
      { name: 'α (dispersion)', desc: '基因特有离散度，无重复时无法估计' },
      { name: 'shrinkage', desc: 'apeglm / ashr / normal，对 LFC 做收缩，低表达基因 LFC 往 0 拉' },
      { name: 'padj 阈值', desc: '默认 0.05，BH 校正控制 FDR' },
    ],
    suitable: ['bulk RNA-seq raw count', '有生物学重复 ≥3/组', '两组或多组比较'],
    not_suitable: [
      '单细胞（太稀疏，用 MAST/Wilcoxon）',
      '已标准化数据（需原始 count）',
      '无生物学重复（离散度估不出）',
    ],
    related_tool: '/tools/#deseq2',
    related_tutorial: '/docs/bulk-rnaseq/module02',
    related_code: 'static/scripts/bulk-rnaseq/bulk02_deseq2_sci.R',
    difficulty: 'intermediate',
  },
  {
    id: 'edger-nb',
    name: 'edgeR',
    name_zh: '负二项 + QL 检验',
    category: 'differential-expression',
    one_liner:
      '负二项分布建模，用 quasi-likelihood F 检验（glmQLFTest）比 Wald 更稳健，适合复杂设计和不等方差。',
    principle:
      'Wald 检验假设系数的标准误估计是准确的，但样本量小的时候这个假设不成立——离散度估计本身就有不确定性。edgeR 的 QL 检验在负二项之上再加一层 quasi-likelihood，把离散度的估计不确定性也纳入检验统计量。效果：小样本时 p 值更保守（不容易假阳性），大样本时和 Wald 结果一致。代价是计算更复杂，但对不等方差（heteroscedasticity）更鲁棒。',
    formula: 'K_ij ~ NB(μ_ij, φ_i)\nφ_i = dispersion (gene-wise)\nQLF = (deviance reduction) / φ_i',
    flow: [
      'raw counts',
      'TMM 标准化',
      '估计 common / trended / tagwise dispersion',
      'glmQLFit 拟合',
      'glmQLFTest 检验',
      'BH 校正 → FDR',
    ],
    key_params: [
      { name: 'φ (dispersion)', desc: 'common / trended / tagwise 三档，tagwise 最精确' },
      { name: 'robust', desc: 'robust=TRUE 对离群基因更稳' },
      { name: 'TMM', desc: 'Trimmed Mean of M-values 标准化，默认方法' },
    ],
    suitable: [
      'bulk RNA-seq raw count',
      '复杂设计矩阵（多因子 / 交互项）',
      '大样本（>20/组，比 DESeq2 快）',
    ],
    not_suitable: ['单细胞（太稀疏）', '已标准化数据', '小样本无重复'],
    related_tutorial: '/docs/bulk-rnaseq/module02',
    difficulty: 'intermediate',
  },
  {
    id: 'limma-voom',
    name: 'limma-voom',
    name_zh: 'voom 加权线性模型',
    category: 'differential-expression',
    one_liner:
      '把 count 转成 log-CPM，用观测均值-方差关系给每个基因一个权重，再用 limma 的线性模型 + eBayes 检验。',
    principle:
      'log 转换后 count 近似正态，但低表达基因的方差仍然远大于高表达基因——直接做线性回归会被低表达基因的噪声主导。voom 的核心：从数据本身估计均值-方差关系，给每个基因一个精确权重（低表达降权、高表达升权），把加权最小二乘变成"每基因自适应精度"的回归。再叠加 eBayes：借用全基因组信息收缩单个基因的方差估计，3-4 个重复就能得到稳定的 t 检验。',
    formula:
      'logCPM_ij = log2(count_ij / library_size + 0.5)\nw_i = 1 / (a + b · μ̄_i)^0.5\nfit: lmFit → eBayes',
    flow: [
      'raw counts',
      'TMM 标准化',
      'voom 计算 log-CPM + 权重',
      'lmFit 拟合加权线性模型',
      'eBayes 经验贝叶斯收缩',
      'topTable → DE 基因',
    ],
    key_params: [
      { name: 'voom 权重', desc: '低 count 基因降权，高 count 基因升权' },
      { name: 'eBayes', desc: '借用所有基因信息收缩单个基因方差，小样本更稳' },
      { name: 'design matrix', desc: '最灵活，支持任意设计矩阵' },
    ],
    suitable: ['bulk RNA-seq', '多因子 / 交互项设计', '微阵列数据（不用 voom，直接 lmFit）'],
    not_suitable: ['单细胞（太稀疏）', '无生物学重复'],
    related_tutorial: '/docs/bulk-rnaseq/module02',
    difficulty: 'intermediate',
  },
  {
    id: 'ora-hypergeometric',
    name: 'GO/KEGG ORA',
    name_zh: '超几何检验过表达分析',
    category: 'enrichment',
    one_liner:
      '给定差异基因列表和背景基因集，用超几何检验（Fisher 精确检验）判断每个基因集是否非随机富集。',
    principle:
      '想象一个袋子里有 N 个球（全基因组），K 个红球（属于某通路的基因）。你无放回地抽了 n 个球（差异基因），其中有 k 个红球。超几何检验问：k 比随机抽的期望值大多少？如果差异基因里某通路的基因数显著超过随机预期，就说这个通路"富集"。关键：必须有明确的差异基因列表（有阈值），没有阈值的全基因排序用 GSEA。',
    formula:
      'P(X ≥ k) = Σ C(K,i)·C(N-K,n-i) / C(N,n)\nN=背景基因数, K=基因集大小, n=差异基因数, i=交集数',
    flow: [
      '差异基因列表（有阈值）',
      '基因 ID 转换（SYMBOL → ENTREZID）',
      '对每个 GO/KEGG 术语做超几何检验',
      'BH 校正 → padj',
      'dotplot / barplot 可视化',
    ],
    key_params: [
      { name: 'universe', desc: '背景基因集，默认所有表达基因，不是全基因组' },
      { name: 'padj 阈值', desc: '通常 0.05，GO 术语多时放宽到 0.1' },
      { name: 'gene ID 类型', desc: 'clusterProfiler 的 enrichGO/enrichKEGG 需要 ENTREZID' },
    ],
    suitable: ['有明确差异基因列表', 'GO / KEGG / Reactome 通路库', '快速筛选显著通路'],
    not_suitable: ['没有阈值的全基因排序（用 GSEA）', '连续型表型关联'],
    related_tool: '/tools/#go-kegg',
    related_tutorial: '/docs/bulk-rnaseq/module03',
    difficulty: 'beginner',
  },
  {
    id: 'gsea-ks',
    name: 'GSEA',
    name_zh: '加权 Kolmogorov-Smirnov 富集',
    category: 'enrichment',
    one_liner:
      '不筛阈值，用全部基因按 log2FC 排序，通过加权 K-S 统计量看基因集在排序里的分布是否偏向两端。',
    principle:
      'ORA 需要先筛差异基因，但筛阈值是主观的——padj 0.05 和 0.06 可能差几百个基因，富集结果完全不同。GSEA 绕过这个问题：不筛阈值，用全部基因排序，看基因集的成员在排序里是否"扎堆"在两端。加权 K-S 比普通 K-S 多了一个权重 |r_i|^p：排名越极端的基因贡献越大，温和但排名靠前的变化不会被淹没。置换检验打乱样本标签，算出"随机情况下 ES 能有多大"，从而判断观察到的 ES 是否显著。',
    formula:
      'ES(S) = Σ_{i∈S} |r_i|^p / N_R - Σ_{i∉S} 1/(N-N_H)\nNES = ES / mean(ES_permutations)\np = P(ES_perm ≥ ES_obs)',
    flow: [
      '全部基因按 log2FC 排序',
      '遍历排序，基因在集合内 → ES 上升，不在 → ES 下降',
      '计算 ES (Enrichment Score)',
      '置换检验（gene-set 或 phenotype permutation）',
      '归一化 → NES',
      'BH 校正 → padj',
    ],
    key_params: [
      { name: 'p (权重指数)', desc: '默认 1，强调极端排名；=0 退化为标准 K-S' },
      { name: 'minSize / maxSize', desc: '基因集大小过滤，默认 15-500' },
      { name: 'permutation', desc: 'geneSet（小样本）或 phenotype（大样本）' },
    ],
    suitable: ['没有明确阈值的全基因排序', '温和但协同的变化', '通路级分析'],
    not_suitable: ['基因数很少（<1000）', '需要具体差异基因列表（用 ORA）'],
    related_tool: '/tools/#gsea',
    related_tutorial: '/docs/bulk-rnaseq/module03',
    difficulty: 'intermediate',
  },
  {
    id: 'wgcna',
    name: 'WGCNA',
    name_zh: '加权基因共表达网络',
    category: 'network',
    one_liner:
      '用 soft threshold 把相关矩阵变成加权邻接矩阵，算 TOM 距离后层次聚类切出模块，模块与性状关联。',
    principle:
      '硬阈值（|cor| > 0.8 才算连接）会丢信息：0.79 和 0.81 本质一样却被一刀切开。WGCNA 用 soft threshold β 把相关系数指数化：a = |cor|^β，弱相关不被丢弃只是权重小。β 的选择让网络趋近 scale-free 拓扑（少数 hub 连很多节点，多数节点只连少数），这是生物网络的普遍特征。TOM（Topological Overlap Matrix）不只看两个基因的直接相关，还看它们的"共同邻居"——共享很多邻居的基因即使直接相关不高，也会被聚到一起。这比单纯用相关系数聚类更稳健。',
    formula:
      'a_ij = |cor(x_i, x_j)|^β  (soft threshold)\nTOM_ij = (Σ_k a_ik·a_jk + a_ij) / (min(k_i,k_j) + 1 - a_ij)\n模块 = 层次聚类切 TOM → dynamicTreeCut',
    flow: [
      '表达矩阵（方差过滤后）',
      '选 soft threshold β（scale-free 拟合）',
      '算邻接矩阵 → TOM',
      '层次聚类 → dynamicTreeCut 切模块',
      '模块 eigengene (ME) 与性状关联',
      'hub 基因 = 模块内 kME 最高',
    ],
    key_params: [
      { name: 'β (soft power)', desc: 'scale-free R² > 0.8 时的最小幂次，通常 6-12' },
      { name: 'minModuleSize', desc: '默认 30，太小模块不稳定' },
      { name: 'mergeCutHeight', desc: '模块合并阈值，默认 0.25' },
    ],
    suitable: ['样本数 ≥15（越多越稳）', '探索性分析（无预设分组）', '找共表达模块和 hub 基因'],
    not_suitable: ['样本太少（<15）', '需要严格统计推断（WGCNA 是探索性的）'],
    related_tool: '/tools/#wgcna',
    related_tutorial: '/docs/integration/module02',
    difficulty: 'advanced',
  },
  {
    id: 'lasso-cox',
    name: 'LASSO-Cox',
    name_zh: 'L1 正则化 Cox 回归',
    category: 'survival',
    one_liner:
      '在 Cox 偏似然上加 L1 惩罚项，自动做特征选择，把不重要基因的系数压到 0，选出预后 signature。',
    principle:
      '普通 Cox 回归在高维数据（基因数 >> 样本数）上必然过拟合——50000 个基因只有 200 个样本，数学上无解。LASSO 加 L1 惩罚项 λ·Σ|β_k|，效果是让大部分基因的系数精确等于 0（不是接近 0，是等于 0），只留下少数非零基因 = signature。为什么 L1 能做特征选择而 L2 不能：L1 的约束区域是菱形，优化路径在顶点处找到解，顶点意味着很多系数 = 0；L2 的约束区域是圆形，解在圆弧上，系数都接近 0 但不等于 0。λ 越大留下越少基因，交叉验证选最优 λ。',
    formula: 'min_β [ -Σ(δ_i·(x_i·β - log Σ_{j∈R(t_i)} exp(x_j·β))) + λ·Σ|β_k| ]',
    flow: [
      '基因矩阵 + 生存数据 (OS, event)',
      '交叉验证选 λ（lambda.min / lambda.1se）',
      'glmnet 拟合 LASSO-Cox',
      '非零系数基因 = signature',
      'risk score = Σ β_k · x_k',
      'KM 分组验证（中位数切高低风险）',
    ],
    key_params: [
      { name: 'λ (penalty)', desc: 'lambda.min（最准）vs lambda.1se（最简），推荐 1se' },
      { name: 'α=1', desc: 'α=1 是 LASSO（L1），α=0 是 ridge（L2），0<α<1 是 elastic net' },
      { name: 'CV folds', desc: '默认 10 折交叉验证' },
    ],
    suitable: ['高维基因 + 生存数据', '需要自动特征选择', '构建预后 risk score'],
    not_suitable: ['样本数 < 事件数（会过拟合）', '无生存数据（用普通 LASSO）'],
    related_tool: '/tools/#lasso-cox',
    related_tutorial: '/docs/machine-learning/module04',
    difficulty: 'advanced',
  },
  {
    id: 'km-survival',
    name: 'Kaplan-Meier',
    name_zh: 'Kaplan-Meier 估计 + log-rank 检验',
    category: 'survival',
    one_liner: '非参数估计生存函数 S(t)，用 log-rank 检验比较两组生存曲线是否有显著差异。',
    principle:
      '生存数据有删失（censoring）：有些受试者在研究结束时仍存活，你只知道他的生存时间 > 某个值，不知道具体多久。Kaplan-Meier 用乘积极限法处理这个问题：在每个事件时间点算条件生存概率（1 - 死亡数/风险人数），累乘得到 S(t)。删失样本在离开前留在风险集（分母），但不贡献事件（分子）。log-rank 检验比较两组：在每个事件时间点算"观察死亡数 - 期望死亡数"的差值，累加后用卡方检验——它不假设生存曲线的形状，只问"两组的事件发生速率是否一致"。',
    formula: 'S(t) = Π_{t_i ≤ t} (1 - d_i/n_i)\nlog-rank: χ² = (O-E)² / E  (每组分别算)',
    flow: [
      '生存数据 (time, event) + 分组变量',
      '按时间排序事件',
      '每个事件时间点算 S(t) = Π(1 - d/n)',
      '画阶梯曲线',
      'log-rank 检验比较组间差异',
      'HR (hazard ratio) + 95% CI',
    ],
    key_params: [
      { name: 'censoring', desc: '右删失最常见，删失样本在 S(t) 计算时留在 risk set 但不贡献事件' },
      { name: 'log-rank', desc: '非参数检验，不假设分布，最常用' },
      { name: '分组方式', desc: '中位数 / 最优截点（maxstat），中位数最常见但可能不是最优' },
    ],
    suitable: ['两组生存比较', '时间到事件数据', '临床试验 / 预后分析'],
    not_suitable: ['连续型预测变量（用 Cox 回归）', '竞争风险场景（用 Fine-Gray）'],
    related_tool: '/tools/#km-survival',
    related_tutorial: '/docs/machine-learning/module04',
    difficulty: 'beginner',
  },
  {
    id: 'ssgsea-immune',
    name: 'ssGSEA',
    name_zh: '单样本 GSEA 免疫浸润',
    category: 'enrichment',
    one_liner:
      '对每个样本独立做 GSEA，用免疫细胞 marker 基因集算富集分数，估计每个样本的免疫细胞比例。',
    principle:
      '普通 GSEA 比较两组样本的基因排序差异，但临床样本往往没有"对照组"——每个肿瘤样本需要独立评估免疫浸润。ssGSEA 的做法：对每个样本，把它的基因按表达量排序，然后用免疫细胞 marker 基因集（如 LM22 的 T cell / B cell / NK 标志基因）做一次 GSEA。分数高 = 这些 marker 在该样本的表达排序里偏向高表达端 = 该免疫类型丰度高。关键：这是相对丰度（样本间可比），不是绝对比例（不等于 30% 是 T cell）。要绝对比例用 CIBERSORT（需要参考矩阵反卷积）。',
    formula:
      'ssGSEA(A, S) = Σ_{i∈S} (rank_i^w - |S|·(n+1)/2)\nrank_i = 基因 i 在样本 A 中的表达排名',
    flow: [
      '表达矩阵（样本 × 基因）',
      '对每个样本独立排序基因',
      '用免疫 marker 基因集算 ssGSEA 分数',
      '分数 = 该样本中免疫细胞的相对丰度',
      'boxplot / lollipop 可视化',
    ],
    key_params: [
      { name: 'marker 基因集', desc: 'LM22 (22 免疫类型) / LM7 / 自定义' },
      { name: 'w (权重)', desc: '默认 0.25，强调排名极端' },
      { name: '标准化', desc: '分数跨样本比较前需 z-score 标准化' },
    ],
    suitable: ['bulk RNA-seq 免疫浸润', '无参考数据时估计免疫比例', '肿瘤微环境分析'],
    not_suitable: ['单细胞（用直接注释）', '需要绝对比例（用 CIBERSORT）'],
    related_tool: '/tools/#immune',
    related_tutorial: '/docs/bulk-rnaseq/module05',
    difficulty: 'intermediate',
  },
  {
    id: 'cellchat',
    name: 'CellChat',
    name_zh: '配体受体细胞通讯',
    category: 'single-cell',
    one_liner: '用配体-受体对的共表达推断细胞间通讯，结合通路数据库算通讯概率和信号强度。',
    principle:
      '单细胞数据只告诉你每个细胞表达了什么，不直接告诉你细胞之间在"对话"。CellChat 的推断逻辑：如果 sender 细胞高表达配体 L，receiver 细胞高表达受体 R，且 L-R 是已知配对（CellChatDB），则推断存在通讯。通讯概率不是简单相乘 L×R——还要乘以 agonist（激动剂）、antagonist（拮抗剂）、cofactor（辅因子）的调控系数，这些来自实验文献。permutation 检验打乱细胞标签，算"随机情况下通讯概率多大"，判断观察到的通讯是否显著。局限：共表达 ≠ 真实通讯（配体可能没有分泌、受体可能有 decoy），需要实验验证。',
    formula:
      'P(L-R) = (L_sender · R_receiver) · agonist · antagonist · cofactor\n通讯强度 = Σ P(L-R) across all L-R pairs in pathway',
    flow: [
      '单细胞表达矩阵 + 细胞注释',
      '查 CellChatDB 配体受体对',
      '算每个 sender→receiver 的通讯概率',
      'permutation 检验显著性',
      'circle plot / chord plot 可视化',
      '通路富集分析',
    ],
    key_params: [
      {
        name: '数据库',
        desc: 'human / mouse，Secreted Signaling / ECM-Receptor / Cell-Cell Contact',
      },
      { name: 'population size', desc: '默认按细胞数加权，可设 population.size=FALSE 去除' },
      { name: 'min cells', desc: '每组最少细胞数，默认 10' },
    ],
    suitable: ['单细胞有细胞类型注释', '肿瘤微环境 / 发育 / 免疫通讯', '多样本比较'],
    not_suitable: ['无注释数据', '空间转录组（用 spatial 方法）'],
    related_tool: '/tools/#cellchat',
    related_tutorial: '/docs/single-cell/module07',
    difficulty: 'advanced',
  },
  {
    id: 'louvain-cluster',
    name: 'Louvain 聚类',
    name_zh: '模块度优化的社区发现',
    category: 'single-cell',
    one_liner: '在 KNN 图上用 Louvain 算法最大化模块度（modularity），把细胞分成社区 = 细胞类型。',
    principle:
      '单细胞聚类的本质不是在表达空间里画圈，而是在"细胞相似性图"上找紧密连接的社区。先建 KNN 图：PCA 降维后，每个细胞连到 k 个最相似的邻居，形成一张网络。Louvain 算法最大化模块度 Q——Q 衡量"社区内连接密度 vs 随机预期连接密度"的差值。直觉：如果一群细胞互相之间连接远比随机情况多，它们就是一个社区。Louvain 用贪心策略迭代：每个节点尝试移到邻居社区，如果 Q 增加就移，否则不动，直到没有移动能增加 Q。resolution 参数调节"什么算紧密"：越高，需要越紧密才算一个社区 → cluster 越多越碎。',
    formula:
      'Q = (1/2m) Σ [A_ij - k_i·k_j/2m] δ(c_i, c_j)\nLouvain: 迭代地将节点移到使 Q 增量最大的社区',
    flow: [
      'PCA 降维后的表达矩阵',
      '建 KNN 图（k 邻居 + 距离权重）',
      'Louvain 迭代：每个节点尝试移到邻居社区',
      '模块度 Q 最大化 → 收敛',
      '社区 = cluster = 细胞类型',
      'resolution 控制粒度',
    ],
    key_params: [
      { name: 'resolution', desc: '0.4-1.2，越高 cluster 越多越碎' },
      { name: 'k (邻居数)', desc: '默认 20-50，影响图的连通性' },
      { name: 'modularity', desc: 'Leiden 算法是 Louvain 改进版，更稳' },
    ],
    suitable: ['单细胞聚类（Seurat 默认）', '大规模图（>10k 节点快）', '社区发现'],
    not_suitable: ['连续型结构（用轨迹推断）', '小数据集（直接层次聚类更稳）'],
    related_tool: '/tools/#seurat-standard',
    related_tutorial: '/docs/single-cell/module03',
    difficulty: 'intermediate',
  },
  {
    id: 'mutation-nmf',
    name: '突变签名 NMF',
    name_zh: '非负矩阵分解突变签名',
    category: 'mutation',
    one_liner:
      '把突变频谱矩阵（96 trinotide × 样本）用 NMF 分解为签名矩阵和暴露矩阵，每个签名代表一种突变过程。',
    principle:
      '肿瘤细胞的突变不是随机的——紫外线在 C→T 的 CC 上下文富集（签名 7），化疗药在 C>A 的特定上下文富集（签名 2/13）。每个突变过程在 96 种三核苷酸上下文里留下独特的"指纹"。NMF 的作用：把样本 × 96 频谱矩阵 V 分解成 V ≈ W·H，W 是 96 × r 的签名矩阵（r 个突变过程各自的指纹），H 是 r × 样本的暴露矩阵（每个样本各过程贡献多少突变）。为什么用 NMF 而不是 PCA：NMF 的非负约束让结果可直接解释为"突变计数贡献"（不能有负突变），PCA 的负分量无法对应生物学意义。分解后把 W 的每列和 COSMIC v3 已知签名比对 cosine similarity > 0.85 即匹配。',
    formula:
      'V ≈ W · H\nV: 96×samples (突变频谱)\nW: 96×r (签名)\nH: r×samples (暴露)\nmin ||V - W·H||²  s.t. W,H ≥ 0',
    flow: [
      'MAF 文件 → 提取 96 trinotide 突频谱',
      '选 rank r（COSMIC 签名数）',
      'NMF 分解 → W (签名) + H (暴露)',
      '与 COSMIC v3 签名比对 (cosine similarity)',
      '每个样本的签名暴露量',
      'stacked barplot 可视化',
    ],
    key_params: [
      { name: 'rank r', desc: '用 NMF 评估指标选最优 r，或直接用 COSMIC 签名数' },
      { name: 'COSMIC v3', desc: 'SBS / DBS / INDEL 三类签名，最常用 SBS' },
      { name: 'cosine similarity', desc: '>0.85 视为匹配到已知签名' },
    ],
    suitable: ['WES/WGS 突变数据 (MAF)', '肿瘤突变过程分析', '环境暴露推断'],
    not_suitable: ['非突变数据', '样本突变数太少（<1000）'],
    related_tool: '/tools/#maftools-mutation',
    related_tutorial: '/docs/genomics/module05',
    difficulty: 'advanced',
  },
];
