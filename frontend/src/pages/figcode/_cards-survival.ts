import type { FigCard } from './_data';

export const cards_survival: FigCard[] = [
  {
    id: 'km-curve',
    figLayout: 'default',
    title: 'KM Survival Curve',
    subtitle: 'KM 生存曲线',
    category: '生存分析',
    image: '/img/figcode/km-curve-example.png',
    description: '按分组画生存曲线，带 log-rank p 值和风险表。',
    inputFormat: '数据框：time, status, group',
    biologicalQuestion: '不同分组（如基因高/低表达）的患者生存时间是否存在显著差异？',
    scenarios: [
      '基因表达高低分组的预后分析',
      '突变 vs 野生型生存对比',
      '临床分期生存差异',
      '治疗方案疗效评估',
    ],
    keyParams: [
      '分组方式（中位数 / 最佳截断值 surv_cutpoint）',
      'time 单位（月 / 天）',
      'risk.table 是否显示风险表',
      'palette 配色方案',
      'conf.int 是否显示置信区间',
    ],
    code: `library(survival)
library(survminer)

# --- Demo data ---
set.seed(42)
n <- 100
df <- data.frame(
  time = c(rexp(50, 0.02), rexp(50, 0.05)),
  status = sample(0:1, n, replace = TRUE, prob = c(0.3, 0.7)),
  group = rep(c("High", "Low"), each = 50)
)

# --- Plot ---
fit <- survfit(Surv(time, status) ~ group, data = df)
ggsurvplot(fit, data = df,
  pval = TRUE, risk.table = TRUE,
  palette = c("#0f766e", "#dc2626"),
  xlab = "Time (months)", ylab = "Survival Probability",
  title = "Kaplan-Meier Survival Curve")`,
    packages: ['survival', 'survminer'],
    slogan: 'p 值大了，先怪样本不够，再怪命',
    tutorialUrl: '/docs/genomics/module08',
    onlineToolUrl: '/tools?tool=km-survival',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 12,
      prerequisites: ['/docs/genomics/module08'],
      learning_outcomes: ['会按基因高低或临床特征分组画 KM 曲线', '能解读 log-rank p 值和风险表'],
      hands_on: true,
      related_concepts: ['/figcode#oncoplot', '/figcode#lollipop'],
    },
  },
  {
    id: 'time-roc',
    figLayout: 'default',
    title: 'Time-dependent ROC',
    subtitle: '时间依赖 ROC',
    category: '生存分析',
    image: '/img/figcode/time-roc.png',
    description: '在 1 / 3 / 5 年等多个时间点评估 risk score 的预测能力，用 AUC 量化区分度。',
    inputFormat: '数据框：time, status, marker（risk score 或单基因表达）',
    biologicalQuestion: '我的预后 signature / risk score 在不同随访时间点的预测准确度有多高？',
    scenarios: [
      'LASSO Cox signature 性能评估',
      '单基因预后能力对比',
      '多模型 AUC 对比',
      'Risk score 与临床变量对比',
    ],
    keyParams: [
      'times（评估时间点，单位与 time 列一致）',
      'cause = 1（事件代码，多原因竞争事件分析时区分）',
      'iid = TRUE（计算置信区间需要）',
      'weighting（默认 marginal）',
    ],
    code: `library(timeROC)

# --- Demo data ---
set.seed(42)
n <- 200
df <- data.frame(
  time   = rexp(n, 0.05),
  status = sample(0:1, n, replace = TRUE, prob = c(0.4, 0.6)),
  marker = rnorm(n)
)
# Make the marker informative
df$time <- pmax(df$time + 0.5 * df$marker, 0.1)

# --- Time-dependent ROC at 1, 3, 5 years (assuming time in years) ---
roc <- timeROC(
  T      = df$time,
  delta  = df$status,
  marker = df$marker,
  cause  = 1,
  times  = c(1, 3, 5),
  iid    = TRUE
)

# --- Plot ---
plot(roc, time = 1, col = "#dc2626", title = FALSE, lwd = 2)
plot(roc, time = 3, col = "#059669", add = TRUE, lwd = 2)
plot(roc, time = 5, col = "#2563eb", add = TRUE, lwd = 2)
legend("bottomright",
       legend = paste0(c("1 yr", "3 yr", "5 yr"), " AUC = ",
                       round(roc$AUC, 3)),
       col = c("#dc2626", "#059669", "#2563eb"),
       lwd = 2, bty = "n")
title("Time-dependent ROC")`,
    packages: ['timeROC'],
    slogan: '一年三年五年都看清楚，AUC 报上来',
    tutorialUrl: '/docs/project-practice/module05',
    copilot: {
      domain: 'survival',
      level: 'advanced',
      estimated_minutes: 12,
      prerequisites: ['/figcode#km-curve', '/docs/project-practice/module05'],
      learning_outcomes: [
        '能用 timeROC 计算多个时间点的 AUC',
        '理解为什么生存分析需要时间依赖的 ROC',
        '会在同一图上叠加多个时间点的 ROC 曲线',
      ],
      hands_on: true,
      related_concepts: ['/figcode#km-curve', '/docs/project-practice/module06'],
    },
  },
  {
    id: 'forest-cox',
    figLayout: 'wide',
    title: 'Forest Plot (Cox)',
    subtitle: 'Cox 森林图',
    category: '生存分析',
    image: '/img/figcode/forest-cox.png',
    description: '多变量 Cox 回归的森林图：每行一个变量，显示 HR 及 95% CI，判断独立预后因子。',
    inputFormat: 'coxph 对象（包含多个协变量）',
    biologicalQuestion: '在校正其他临床变量后，我的 risk score / 基因仍然是独立预后因子吗？',
    scenarios: [
      'Signature 独立性验证',
      '临床变量预后排序',
      '多中心 meta 分析合并',
      'Subgroup 亚组分析',
    ],
    keyParams: [
      'data（用于生成 reference levels）',
      'main / cpositions（标题与列位置）',
      'fontsize（字号）',
      'refLabel（参考组标签）',
    ],
    code: `library(survival)
library(survminer)

# --- Demo data ---
set.seed(42)
n <- 300
df <- data.frame(
  time     = rexp(n, 0.04),
  status   = sample(0:1, n, replace = TRUE, prob = c(0.3, 0.7)),
  risk_score = rnorm(n),
  age      = sample(40:80, n, replace = TRUE),
  stage    = factor(sample(c("I","II","III","IV"), n, replace = TRUE)),
  gender   = factor(sample(c("Female","Male"), n, replace = TRUE))
)

# --- Multivariate Cox ---
fit <- coxph(Surv(time, status) ~ risk_score + age + stage + gender, data = df)

# --- Forest plot ---
ggforest(
  fit, data = df,
  main = "Multivariate Cox — Hazard Ratios",
  cpositions = c(0.02, 0.22, 0.4),
  fontsize = 0.9,
  refLabel = "ref",
  noDigits = 2
)`,
    packages: ['survival', 'survminer'],
    slogan: 'HR > 1 风险升高，谁是真正的独立因子一目了然',
    tutorialUrl: '/docs/project-practice/module05',
    onlineToolUrl: '/tools?tool=km-survival',
    copilot: {
      domain: 'survival',
      level: 'advanced',
      estimated_minutes: 10,
      prerequisites: ['/figcode#km-curve'],
      learning_outcomes: [
        '能读懂森林图的 HR / CI / p 值',
        '区分单因素与多变量 Cox 的不同用途',
        '能用 ggforest 一键生成审稿人友好的森林图',
      ],
      hands_on: true,
      related_concepts: ['/figcode#km-curve', '/figcode#time-roc'],
    },
  },
  {
    id: 'nomogram',
    figLayout: 'complex',
    title: 'Nomogram',
    subtitle: '列线图',
    category: '生存分析',
    image: '/img/figcode/nomogram.png',
    description:
      '把多变量 Cox 模型转成可读图：每个变量给分，加总后查 1/3/5 年生存概率。临床决策支持的金标准。',
    inputFormat: 'rms::cph 对象 + datadist 设定',
    biologicalQuestion: '对于一个具体患者，结合所有临床和分子变量，他的 1/3/5 年生存概率是多少？',
    scenarios: [
      '临床预后模型展示',
      'Signature 与临床因子整合',
      'Web calculator 后端逻辑',
      '论文 Figure 5 经典图',
    ],
    keyParams: [
      'fun（生存函数变换：通常 c(1, 3, 5) 年）',
      'lp = TRUE（显示 linear predictor 轴）',
      'fun.at（生存概率刻度）',
      'maxscale = 100（最大评分）',
    ],
    code: `library(rms)
library(survival)

# --- Demo data ---
set.seed(42)
n <- 300
df <- data.frame(
  time   = rexp(n, 0.04),
  status = sample(0:1, n, replace = TRUE, prob = c(0.3, 0.7)),
  risk_score = rnorm(n),
  age    = sample(40:80, n, replace = TRUE),
  stage  = factor(sample(c("I","II","III","IV"), n, replace = TRUE))
)

# --- Required: tell rms about variable distribution ---
dd <- datadist(df)
options(datadist = "dd")

# --- Cox model with rms::cph ---
fit <- cph(
  Surv(time, status) ~ risk_score + age + stage,
  data = df, x = TRUE, y = TRUE, surv = TRUE
)

# --- Build survival functions for 1, 3, 5 years ---
surv_obj <- Survival(fit)
surv1 <- function(x) surv_obj(1, lp = x)
surv3 <- function(x) surv_obj(3, lp = x)
surv5 <- function(x) surv_obj(5, lp = x)

# --- Nomogram ---
nom <- nomogram(
  fit,
  fun  = list(surv1, surv3, surv5),
  funlabel = c("1-year Survival", "3-year Survival", "5-year Survival"),
  fun.at   = c(0.95, 0.85, 0.7, 0.5, 0.3, 0.1, 0.01),
  maxscale = 100,
  lp = FALSE
)
plot(nom, xfrac = 0.4, cex.axis = 0.9, cex.var = 1)`,
    packages: ['rms', 'survival'],
    slogan: '把 Cox 模型变成临床能用的查表工具',
    tutorialUrl: '/docs/project-practice/module05',
    copilot: {
      domain: 'survival',
      level: 'advanced',
      estimated_minutes: 15,
      prerequisites: ['/figcode#forest-cox'],
      learning_outcomes: [
        '理解列线图把多变量 Cox 转成可读评分系统的原理',
        '会用 rms::nomogram 一键生成 1/3/5 年生存预测',
        '能为列线图配套画 calibration curve',
      ],
      hands_on: true,
      related_concepts: ['/figcode#forest-cox', '/figcode#time-roc'],
    },
  },
  {
    id: 'roc-confusion',
    figLayout: 'compact',
    title: 'ROC + Confusion',
    subtitle: '二分类评估',
    category: '生存分析',
    image: '/img/figcode/roc-confusion.png',
    description: 'ROC 曲线 + 混淆矩阵双面板：诊断模型 / 二分类预测的标配评估图。',
    inputFormat: '数据框：truth (0/1), prediction_score (0-1), prediction_class (0/1)',
    biologicalQuestion: '我的模型在阳性 / 阴性样本上的区分能力如何？错分主要发生在哪种类型？',
    scenarios: [
      '临床诊断模型评估',
      '癌症亚型分类性能',
      '基于 omics 的风险分层',
      '机器学习模型对比',
    ],
    keyParams: [
      'threshold（分类阈值，默认 0.5）',
      'positive class（哪类为阳性）',
      'pROC::ci.auc（AUC 置信区间 bootstrap 次数）',
    ],
    code: `library(pROC)
library(ggplot2)
library(patchwork)
library(caret)

# --- Demo data ---
set.seed(42)
n <- 300
truth <- rbinom(n, 1, 0.4)
score <- truth * 0.7 + rnorm(n, 0, 0.4)
score <- (score - min(score)) / (max(score) - min(score))
pred  <- as.integer(score > 0.5)

# --- ROC ---
roc_obj <- roc(truth, score, ci = TRUE, plot = FALSE)
auc_str <- sprintf("AUC = %.3f (95%% CI: %.3f-%.3f)",
                   auc(roc_obj), ci.auc(roc_obj)[1], ci.auc(roc_obj)[3])

p1 <- ggroc(roc_obj, color = "#dc2626", size = 1.2) +
  geom_abline(intercept = 1, slope = 1, linetype = "dashed", color = "grey60") +
  annotate("text", x = 0.4, y = 0.2, label = auc_str, size = 4) +
  labs(title = "ROC Curve", x = "Specificity", y = "Sensitivity") +
  theme_classic()

# --- Confusion matrix ---
cm <- confusionMatrix(factor(pred, levels = c(0,1)),
                      factor(truth, levels = c(0,1)),
                      positive = "1")
cm_df <- as.data.frame(cm$table)

p2 <- ggplot(cm_df, aes(Reference, Prediction, fill = Freq)) +
  geom_tile() +
  geom_text(aes(label = Freq), size = 6, color = "white") +
  scale_fill_gradient(low = "#bfdbfe", high = "#1d4ed8") +
  labs(title = sprintf("Confusion Matrix (Acc = %.3f)", cm$overall["Accuracy"]),
       x = "Truth", y = "Prediction") +
  theme_classic() +
  theme(legend.position = "none")

p1 + p2`,
    packages: ['pROC', 'ggplot2', 'patchwork', 'caret'],
    slogan: 'AUC 看整体，混淆矩阵看错在哪',
    tutorialUrl: '/docs/integration/module07',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 12,
      prerequisites: [],
      learning_outcomes: [
        '会用 pROC 画 ROC 并计算 AUC + 置信区间',
        '能读懂混淆矩阵 TP/FP/TN/FN',
        '理解为什么 ROC + 混淆矩阵互补',
      ],
      hands_on: true,
      related_concepts: ['/figcode#time-roc', '/figcode#pr-curve'],
    },
  },
  {
    id: 'pr-curve',
    figLayout: 'compact',
    title: 'PR Curve',
    subtitle: 'Precision-Recall 曲线',
    category: '生存分析',
    image: '/img/figcode/pr-curve.png',
    description: '不平衡数据下比 ROC 更敏感的评估指标：Precision-Recall 曲线 + 平均精度 (AP)。',
    inputFormat: '数据框：truth (0/1), score (0-1)',
    biologicalQuestion:
      '阳性样本占比很低（如 5%）时，模型在 precision 和 recall 之间的 tradeoff 如何？',
    scenarios: [
      '罕见病诊断（阳性极少）',
      '癌症早筛低发病率',
      '蛋白互作预测（正例稀疏）',
      '不平衡 multi-omics 分类',
    ],
    keyParams: ['recall.thresh（计算 AP 时的 recall 阈值）', 'pos_label = 1（阳性类编码）'],
    code: `library(PRROC)
library(ggplot2)

# --- Demo: imbalanced data (5% positive) ---
set.seed(42)
n <- 1000
truth <- rbinom(n, 1, 0.05)
score <- truth * 0.6 + rnorm(n, 0, 0.4)

# --- PR curve ---
pr <- pr.curve(
  scores.class0 = score[truth == 1],
  scores.class1 = score[truth == 0],
  curve = TRUE
)

# Also compute ROC for reference
library(pROC)
roc_obj <- roc(truth, score)

# --- Plot ---
df_pr <- data.frame(
  Recall    = pr$curve[, 1],
  Precision = pr$curve[, 2]
)
baseline <- mean(truth)

ggplot(df_pr, aes(Recall, Precision)) +
  geom_path(color = "#dc2626", size = 1.2) +
  geom_hline(yintercept = baseline, linetype = "dashed", color = "grey50") +
  annotate("text", x = 0.7, y = 0.85,
           label = sprintf("AP = %.3f\\nBaseline = %.3f\\n(ROC AUC = %.3f)",
                           pr$auc.integral, baseline, auc(roc_obj)),
           hjust = 0, size = 3.6) +
  labs(title = "Precision-Recall Curve", x = "Recall", y = "Precision") +
  scale_x_continuous(limits = c(0, 1)) +
  scale_y_continuous(limits = c(0, 1)) +
  theme_classic()`,
    packages: ['PRROC', 'ggplot2', 'pROC'],
    slogan: '阳性样本太少时 ROC 会骗人，PR 才说真话',
    tutorialUrl: '/docs/integration/module07',
    copilot: {
      domain: 'visualization',
      level: 'advanced',
      estimated_minutes: 10,
      prerequisites: ['/figcode#roc-confusion'],
      learning_outcomes: [
        '理解 ROC 在不平衡数据下的局限性',
        '会用 PRROC 计算 PR 曲线和 AP',
        '知道何时该看 PR 而不是 ROC',
      ],
      hands_on: true,
      related_concepts: ['/figcode#roc-confusion', '/figcode#time-roc'],
    },
  },
  {
    id: 'calibration',
    figLayout: 'compact',
    title: 'Calibration Curve',
    subtitle: '校准曲线',
    category: '生存分析',
    image: '/img/figcode/calibration.png',
    description: '配 nomogram / Cox 模型的预测概率与实际观测频率对比图，看模型预测得"准不准"。',
    inputFormat: 'rms::cph 对象 + 验证数据',
    biologicalQuestion: '模型预测某患者 5 年生存概率是 30%，那这群人真的有 30% 在 5 年后还活着吗？',
    scenarios: [
      'Nomogram 验证必备',
      'Cox 预后模型外部验证',
      '诊断模型可靠性评估',
      '机器学习概率输出校准检验',
    ],
    keyParams: [
      'B = 1000（bootstrap 次数）',
      'm（每个 group 的样本数）',
      'u（评估时间点，单位 = time 列）',
    ],
    code: `library(rms)
library(survival)

# --- Demo data ---
set.seed(42)
n <- 300
df <- data.frame(
  time   = rexp(n, 0.04),
  status = sample(0:1, n, replace = TRUE, prob = c(0.3, 0.7)),
  risk_score = rnorm(n),
  age    = sample(40:80, n, replace = TRUE),
  stage  = factor(sample(c("I","II","III","IV"), n, replace = TRUE))
)

dd <- datadist(df)
options(datadist = "dd")

# --- Cox model ---
fit <- cph(
  Surv(time, status) ~ risk_score + age + stage,
  data = df, x = TRUE, y = TRUE, surv = TRUE,
  time.inc = 3   # evaluation time
)

# --- Calibration at 3 years (bootstrap-corrected) ---
cal <- calibrate(fit, cmethod = "KM", method = "boot",
                 u = 3, m = 50, B = 200)

plot(cal,
     xlab = "Nomogram-Predicted 3-yr Survival",
     ylab = "Observed 3-yr Survival",
     col  = "#dc2626", lwd = 2,
     errbar.col = "#94a3b8")
abline(0, 1, lty = 2, col = "grey50")
title("Calibration Curve — 3-year")`,
    packages: ['rms', 'survival'],
    slogan: '模型说 30% 真就 30% 吗？校准曲线一条对角线说话',
    tutorialUrl: '/docs/project-practice/module05',
    copilot: {
      domain: 'survival',
      level: 'advanced',
      estimated_minutes: 12,
      prerequisites: ['/figcode#nomogram'],
      learning_outcomes: [
        '理解模型"区分能力"与"校准度"的区别',
        '会用 rms::calibrate 做 bootstrap 校正校准',
        '能识别 over-/under-estimation',
      ],
      hands_on: true,
      related_concepts: ['/figcode#nomogram', '/figcode#time-roc'],
    },
  },
  {
    id: 'decision-curve',
    figLayout: 'compact',
    title: 'Decision Curve Analysis',
    subtitle: '临床决策曲线',
    category: '生存分析',
    image: '/img/figcode/decision-curve.png',
    description: 'DCA 评估模型在不同决策阈值下的"净获益"，比 AUC 更贴近临床应用。',
    inputFormat: '数据框：truth (0/1), 多列 prediction_probability',
    biologicalQuestion: '在不同治疗决策阈值下，使用我的模型相比"全治"或"全不治"能多救多少病人？',
    scenarios: [
      '临床预测模型的实用性评估',
      '多模型对比（看哪个净获益最大）',
      'Nomogram 配套 DCA',
      '诊断标志物投入产出分析',
    ],
    keyParams: [
      'outcome（结局列名）',
      'predictors（多个模型列）',
      'thresholds（阈值范围）',
      'xstop = 0.99 截断高阈值区',
    ],
    code: `library(dcurves)
library(ggplot2)

# --- Demo data ---
set.seed(42)
n <- 500
truth <- rbinom(n, 1, 0.3)

# Two competing models
df <- data.frame(
  outcome  = truth,
  model_A  = plogis(truth * 1.5 + rnorm(n, 0, 0.6)),
  model_B  = plogis(truth * 0.8 + rnorm(n, 0, 0.6))
)

# --- Decision curve ---
dc <- dca(outcome ~ model_A + model_B, data = df,
          thresholds = seq(0, 0.6, by = 0.01))

plot(dc, smooth = TRUE) +
  ggtitle("Decision Curve Analysis")`,
    packages: ['dcurves', 'ggplot2'],
    slogan: 'AUC 看模型好坏，DCA 看模型用了能救多少人',
    tutorialUrl: '/docs/project-practice/module05',
    copilot: {
      domain: 'survival',
      level: 'advanced',
      estimated_minutes: 12,
      prerequisites: ['/figcode#nomogram'],
      learning_outcomes: [
        '理解 net benefit 的计算公式（TP - FP × pt/(1-pt)）',
        '能读懂 DCA 的两条参考线（all / none）',
        '会比较多个模型在不同阈值下的临床效用',
      ],
      hands_on: true,
      related_concepts: ['/figcode#nomogram', '/figcode#calibration'],
    },
  },
  {
    id: 'py-roc-confusion',
    figLayout: 'compact',
    title: 'sklearn ROC + CM',
    subtitle: 'Python 二分类评估',
    category: '生存分析',
    image: '/img/figcode/py-roc-confusion.png',
    description: 'sklearn 经典组合：ROC 曲线 + 混淆矩阵 + 分类报告，机器学习模型评估标配。',
    inputFormat: 'numpy 数组：y_true (0/1), y_score (0-1), y_pred (0/1)',
    biologicalQuestion: 'Python 训练的二分类模型表现如何？在 precision、recall 上的具体数值？',
    scenarios: [
      'scikit-learn 模型评估',
      'PyTorch / TensorFlow 模型评估',
      'AutoML 性能对比',
      'Kaggle 比赛标准评估',
    ],
    keyParams: [
      'threshold（默认 0.5，可调）',
      'normalize = "true" / "pred" / "all"（混淆矩阵归一化）',
    ],
    code: `import numpy as np
import matplotlib.pyplot as plt
from sklearn.metrics import (
    roc_curve, auc, confusion_matrix, classification_report,
    ConfusionMatrixDisplay
)

# --- Demo data ---
np.random.seed(42)
n = 300
y_true = np.random.binomial(1, 0.4, n)
y_score = np.clip(y_true * 0.7 + np.random.normal(0, 0.4, n), 0, 1)
y_pred = (y_score > 0.5).astype(int)

# --- ROC ---
fpr, tpr, _ = roc_curve(y_true, y_score)
roc_auc = auc(fpr, tpr)

fig, axes = plt.subplots(1, 2, figsize=(11, 4.5))

axes[0].plot(fpr, tpr, color="#dc2626", lw=2,
             label=f"AUC = {roc_auc:.3f}")
axes[0].plot([0, 1], [0, 1], "--", color="grey")
axes[0].set_xlabel("False Positive Rate")
axes[0].set_ylabel("True Positive Rate")
axes[0].set_title("ROC Curve")
axes[0].legend(loc="lower right")
axes[0].grid(alpha=0.3)

# --- Confusion matrix ---
cm = confusion_matrix(y_true, y_pred)
disp = ConfusionMatrixDisplay(cm, display_labels=["Negative", "Positive"])
disp.plot(ax=axes[1], cmap="Blues", colorbar=False)
axes[1].set_title("Confusion Matrix")

plt.suptitle(f"Classifier Evaluation (n = {n})", y=1.02, fontsize=12)
plt.tight_layout()
plt.savefig("plot_001.png", dpi=150, bbox_inches="tight")

# --- Print classification report ---
print(classification_report(y_true, y_pred,
                             target_names=["Negative", "Positive"]))`,
    packages: ['scikit-learn', 'numpy', 'matplotlib'],
    language: 'python',
    slogan: 'Python 党的二分类评估三件套，一行画完',
    tutorialUrl: '/docs/integration/module07',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 10,
      prerequisites: ['/figcode#roc-confusion'],
      learning_outcomes: [
        '会用 sklearn.metrics 跑完整评估流程',
        '能解读 classification_report 的 precision/recall/f1',
        '理解 R 版与 Python 版评估流程的对应关系',
      ],
      hands_on: true,
      related_concepts: ['/figcode#roc-confusion', '/figcode#pr-curve'],
    },
  },
  {
    id: 'risk-triple',
    figLayout: 'complex',
    title: 'Risk Score Triple Plot',
    subtitle: 'Risk 三联图',
    category: '生存分析',
    image: '/img/figcode/risk-triple.png',
    description:
      'LASSO Cox signature 标准展示：risk score 散点 + 生存状态散点 + signature 基因热图，三联拼图。',
    inputFormat: '数据框：risk_score, OS_time, OS_status + signature 基因表达矩阵',
    biologicalQuestion:
      '我的 prognostic signature 在样本水平上如何分布？高风险组是否真的死亡更多？',
    scenarios: [
      'LASSO Cox signature 论文 Figure 3',
      'TCGA 队列 risk signature 验证',
      'ICGC 外部验证集展示',
      '多 cohort 一致性对比',
    ],
    keyParams: [
      'cutoff（中位数 / 最佳截断）',
      'gene order（按系数符号分组）',
      'patchwork 三联拼接',
    ],
    code: `library(ggplot2)
library(patchwork)

# --- Demo data ---
set.seed(42)
n <- 200
n_sig <- 8
risk <- sort(rnorm(n))
df <- data.frame(
  idx        = 1:n,
  risk_score = risk,
  OS_time    = pmax(rexp(n, 0.05) - 0.5 * risk, 0.3),
  OS_status  = rbinom(n, 1, plogis(risk * 1.2 - 0.5))
)
df$group <- ifelse(df$risk_score > median(df$risk_score), "High", "Low")
cutoff_idx <- which(df$risk_score > median(df$risk_score))[1]

# Signature gene matrix (rows = genes, cols = patients in same order)
expr_mat <- matrix(rnorm(n_sig * n, 0, 0.6), nrow = n_sig)
# Make first 4 positively correlated, last 4 negatively
expr_mat[1:4, ] <- expr_mat[1:4, ] + 0.6 * matrix(rep(risk, 4), nrow = 4, byrow = TRUE)
expr_mat[5:8, ] <- expr_mat[5:8, ] - 0.6 * matrix(rep(risk, 4), nrow = 4, byrow = TRUE)
rownames(expr_mat) <- paste0("Gene", 1:n_sig)

# --- Panel 1: risk score ---
p1 <- ggplot(df, aes(idx, risk_score, color = group)) +
  geom_point(size = 1.2) +
  geom_vline(xintercept = cutoff_idx, linetype = "dashed", color = "grey50") +
  scale_color_manual(values = c(Low = "#2563eb", High = "#dc2626")) +
  labs(x = NULL, y = "Risk score") +
  theme_classic() + theme(axis.text.x = element_blank())

# --- Panel 2: survival status ---
p2 <- ggplot(df, aes(idx, OS_time, color = factor(OS_status))) +
  geom_point(size = 1.2) +
  geom_vline(xintercept = cutoff_idx, linetype = "dashed", color = "grey50") +
  scale_color_manual(values = c("0" = "#94a3b8", "1" = "#dc2626"),
                     labels = c("Alive","Dead"), name = "Status") +
  labs(x = NULL, y = "Survival time") +
  theme_classic() + theme(axis.text.x = element_blank())

# --- Panel 3: signature gene heatmap ---
expr_long <- as.data.frame(t(scale(t(expr_mat))))
expr_long$gene <- rownames(expr_long)
expr_long <- tidyr::pivot_longer(expr_long, -gene, names_to = "patient", values_to = "z")
expr_long$idx <- as.integer(sub("^V", "", expr_long$patient))

p3 <- ggplot(expr_long, aes(idx, gene, fill = z)) +
  geom_tile() +
  scale_fill_gradient2(low = "#2563eb", mid = "white", high = "#dc2626") +
  labs(x = "Patients (sorted by risk score)", y = NULL, fill = "z-score") +
  theme_classic() +
  theme(axis.text.y = element_text(size = 8))

p1 / p2 / p3 + plot_layout(heights = c(1, 1, 2))`,
    packages: ['ggplot2', 'patchwork', 'tidyr'],
    slogan: '一张三联图把 LASSO signature 的全部故事讲完',
    tutorialUrl: '/docs/project-practice/module05',
    copilot: {
      domain: 'survival',
      level: 'advanced',
      estimated_minutes: 15,
      prerequisites: ['/figcode#km-curve', '/figcode#forest-cox'],
      learning_outcomes: [
        '能把 risk score、生存状态、基因表达三个层面拼一张图',
        '会用 patchwork 控制 panel 高度比例',
        '理解三联图作为 LASSO 论文标志图的逻辑',
      ],
      hands_on: true,
      related_concepts: ['/figcode#km-curve', '/figcode#nomogram'],
    },
  },
  {
    id: 'meta-forest',
    figLayout: 'wide',
    title: 'Meta Forest Plot',
    subtitle: 'Meta 森林图',
    category: '生存分析',
    image: '/img/figcode/meta-forest.png',
    description:
      'Meta 分析 / 多 cohort 合并：每行一个研究的效应量 + CI，下方汇总（fixed / random effect）。',
    inputFormat: '数据框：study, n, effect (HR/OR/log2FC), lower_CI, upper_CI',
    biologicalQuestion: '同一个生物标志在多个独立 cohort 中的效应是否一致？合并后的总效应有多大？',
    scenarios: [
      '多 cohort signature 验证（TCGA + ICGC + GEO）',
      'Meta 分析合并 OR/HR',
      'Subgroup 异质性检验',
      '系统综述效应量汇总',
    ],
    keyParams: [
      'method = "REML"（random effects） / "FE"（fixed）',
      'measure = "HR" / "OR" / "MD"',
      'showweights = TRUE 显示权重',
    ],
    code: `library(metafor)
library(ggplot2)

# --- Demo: 6 cohorts, log HR with SE ---
df <- data.frame(
  study = c("TCGA-LIHC","ICGC-LIRI","GSE14520","GSE76427",
            "CHCC-HBV","Korean cohort"),
  yi    = c(log(1.85), log(1.62), log(2.10), log(1.45),
            log(1.78), log(1.95)),       # log HR
  sei   = c(0.18, 0.22, 0.30, 0.28, 0.20, 0.25),
  n     = c(371, 232, 220, 167, 159, 186)
)

# --- Random-effects meta-analysis ---
res <- rma(yi = yi, sei = sei, data = df, method = "REML",
           slab = study, measure = "GEN")

# --- Forest plot ---
forest(
  res,
  atransf  = exp,            # show on HR scale
  refline  = 1,
  xlab     = "Hazard Ratio",
  cex      = 0.9,
  header   = "Cohort",
  mlab     = sprintf("RE Model (I² = %.1f%%, p = %.3f)",
                     res$I2, res$pval),
  col      = "#dc2626"
)`,
    packages: ['metafor', 'ggplot2'],
    slogan: '多个数据集的效应合并起来看一眼，异质性是高是低',
    tutorialUrl: '/docs/project-practice/module06',
    copilot: {
      domain: 'survival',
      level: 'advanced',
      estimated_minutes: 12,
      prerequisites: ['/figcode#forest-cox'],
      learning_outcomes: [
        '区分 fixed-effect 与 random-effect meta',
        '理解 I² / Q / tau² 异质性指标',
        '会用 metafor::rma 做合并并出 forest',
      ],
      hands_on: true,
      related_concepts: ['/figcode#forest-cox', '/figcode#km-curve'],
    },
  },
  {
    id: 'lasso-cv-plot',
    figLayout: 'compact',
    title: 'LASSO CV Curve',
    subtitle: 'LASSO 交叉验证曲线',
    category: '生存分析',
    image: '/img/figcode/lasso-cv-plot.png',
    description:
      'LASSO Cox 回归的 10-fold 交叉验证曲线：x 轴 log(lambda)，y 轴 partial likelihood deviance，两条虚线标 lambda.min 和 lambda.1se。',
    inputFormat: 'cv.glmnet 对象（family = "cox"）',
    biologicalQuestion: '我的 LASSO 模型在什么正则化强度下预测最优？应该选多少个基因进 signature？',
    scenarios: [
      'LASSO Cox 论文 Figure 2A',
      '选择最优 lambda 确定 signature 基因数',
      '展示模型复杂度与预测性能的权衡',
      '多 cohort 验证时对比 CV 曲线',
    ],
    keyParams: [
      'nfolds 折数（默认 10）',
      'lambda.min 最小 deviance 对应 lambda',
      'lambda.1se 一个标准误内最简模型',
      'alpha = 1（纯 LASSO）',
    ],
    code: `library(glmnet)
library(survival)

# --- Demo data ---
set.seed(42)
n <- 200; p <- 50
x <- matrix(rnorm(n * p), n, p)
colnames(x) <- paste0("Gene", 1:p)
time <- rexp(n, 0.05) * exp(-0.3 * x[,1] + 0.2 * x[,2])
event <- rbinom(n, 1, 0.7)
y <- Surv(time, event)

# --- LASSO Cox CV ---
cv_fit <- cv.glmnet(x, y, family = "cox", alpha = 1, nfolds = 10)

# --- Plot ---
plot(cv_fit, main = "LASSO Cox Cross-Validation")
abline(v = log(cv_fit$lambda.min), col = "red", lty = 2)
abline(v = log(cv_fit$lambda.1se), col = "blue", lty = 2)
legend("topright", legend = c("lambda.min", "lambda.1se"),
       col = c("red", "blue"), lty = 2, bty = "n")`,
    packages: ['glmnet', 'survival'],
    slogan: '两条虚线之间就是你 signature 基因数的甜蜜区',
    tutorialUrl: '/docs/project-practice/module05',
    onlineToolUrl: '/tools?tool=lasso-cox',
    copilot: {
      domain: 'survival',
      level: 'intermediate',
      estimated_minutes: 10,
      prerequisites: ['/figcode#km-curve'],
      learning_outcomes: [
        '理解 LASSO 正则化路径和 CV 选 lambda 的逻辑',
        '能区分 lambda.min 和 lambda.1se 的使用场景',
        '会解读 CV 曲线上方的数字（非零系数个数）',
      ],
      hands_on: true,
      related_concepts: ['/figcode#lasso-coef', '/figcode#risk-triple'],
    },
  },
  {
    id: 'lasso-coef',
    figLayout: 'compact',
    title: 'LASSO Coefficient Barplot',
    subtitle: 'LASSO 系数条形图',
    category: '生存分析',
    image: '/img/figcode/lasso-coef.png',
    description:
      'LASSO Cox 筛选出的 signature 基因系数条形图：正系数 = 风险因子（红），负系数 = 保护因子（蓝）。',
    inputFormat: '数据框：gene, coefficient（从 cv.glmnet 提取非零系数）',
    biologicalQuestion: '哪些基因被 LASSO 选入 signature？它们是促进还是抑制预后？',
    scenarios: [
      'LASSO Cox 论文 Figure 2B',
      '展示 signature 基因的风险/保护方向',
      '对比不同 lambda 下选出的基因集',
      '多组学 signature 基因权重可视化',
    ],
    keyParams: [
      'coef(cv_fit, s = "lambda.min") 提取系数',
      '按系数绝对值排序',
      '红蓝配色区分方向',
      'coord_flip 横向展示',
    ],
    code: `library(ggplot2)
library(glmnet)
library(survival)

# --- Demo data ---
set.seed(42)
n <- 200; p <- 50
x <- matrix(rnorm(n * p), n, p)
colnames(x) <- paste0("Gene", 1:p)
time <- rexp(n, 0.05) * exp(-0.5 * x[,1] + 0.4 * x[,2] - 0.3 * x[,3])
event <- rbinom(n, 1, 0.7)
y <- Surv(time, event)

cv_fit <- cv.glmnet(x, y, family = "cox", alpha = 1, nfolds = 10)
coef_vec <- as.numeric(coef(cv_fit, s = "lambda.min"))
names(coef_vec) <- colnames(x)
selected <- coef_vec[coef_vec != 0]

# --- Plot ---
df <- data.frame(gene = names(selected), coef = selected)
df$direction <- ifelse(df$coef > 0, "Risk", "Protective")
df <- df[order(df$coef), ]
df$gene <- factor(df$gene, levels = df$gene)

ggplot(df, aes(x = gene, y = coef, fill = direction)) +
  geom_col(width = 0.7) +
  coord_flip() +
  scale_fill_manual(values = c(Risk = "#dc2626", Protective = "#2563eb")) +
  labs(x = NULL, y = "LASSO Coefficient", title = "Signature Gene Coefficients",
       fill = "Direction") +
  theme_classic() +
  theme(axis.text.y = element_text(size = 9))`,
    packages: ['ggplot2', 'glmnet', 'survival'],
    slogan: '红的促死亡蓝的保命，一根条就是一个基因的贡献',
    tutorialUrl: '/docs/project-practice/module05',
    onlineToolUrl: '/tools?tool=lasso-cox',
    copilot: {
      domain: 'survival',
      level: 'intermediate',
      estimated_minutes: 8,
      prerequisites: ['/figcode#lasso-cv-plot'],
      learning_outcomes: [
        '能从 cv.glmnet 对象提取非零系数并可视化',
        '理解正负系数对应的生物学含义（风险/保护）',
        '会用 coord_flip 做横向条形图',
      ],
      hands_on: true,
      related_concepts: ['/figcode#lasso-cv-plot', '/figcode#risk-triple', '/figcode#forest-cox'],
    },
  },
];
