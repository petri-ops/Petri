# Harness 科学分析插件原型：ranked-go-enrichment

这是一个**不进入内置插件清单**的开发原型，用来固定后续生信插件的开发方式。它把一个可验证的科学子问题定义为最小插件：

> 对一份全基因排序表执行 GO-BP 富集，输出可复现的结果表、图、报告和产物清单。

原型目录可以直接复制到 `resources/built-in-plugins/<plugin-id>/`，或作为第三方插件 zip 的内容。它不代表一个完整的用户需求；完整需求应由 Harness 编排多个插件，并通过 artifact lineage 形成论据。

## 目录

```text
plugin.json              # 身份、运行时、R 包与 capability bundle
tool-definition.json     # 输入、输出、失败模式契约
environment.json         # 可执行环境声明与锁定策略
scripts/ranked-go-enrichment.R
demo-data/ranked_genes.csv
acceptance.json          # 原型验收标准与证据要求
AGENT-DEVELOPMENT-PROMPT.md # 可复制给新智能体的开发提示词
bulk-rnaseq-evidence-task-plan.md # 第一个科学问题的 DAG 与插件开发计划
```

## 开发约束

1. `plugin.json` 只声明依赖，不在脚本中安装或联网下载 R 包。
2. 重量级或 Bioconductor 依赖通过 `requiresBundle` 由 Harness 在运行前 provision；脚本只使用 `library(...)`。
3. `tool-definition.json` 是输入/输出/失败模式的唯一事实源。任何输出都必须列出稳定的 `id`、类型和文件名。
4. 每个图、表和报告都由本插件脚本在同一个 job 中生成；Harness 在执行后统一写入内部 `artifact-manifest.json` 与 `provenance.json`，记录命令、参数、输入 SHA-256、运行时、包约束和输出 SHA-256。内部证据不得列入用户科研产物契约。
5. 空结果是有效科学结果，不得伪装成执行成功或失败；脚本必须同时产出空表、解释性报告和结构化 warning。
6. 失败信息必须能被 `failureModes[].detect` 归类，且给出用户可执行的修复建议。

新智能体交接提示词见 [`AGENT-DEVELOPMENT-PROMPT.md`](./AGENT-DEVELOPMENT-PROMPT.md)。它固定了阅读顺序、R 环境探测、跨平台边界、禁止事项和验收命令。

第一个科学问题的 DAG、插件独立边界、开发顺序和 OSS 分发边界见 [`bulk-rnaseq-evidence-task-plan.md`](./bulk-rnaseq-evidence-task-plan.md)。

## 本地原型运行

在 Harness 已准备 R runtime 与 `r-enrichment` capability 后，执行器应等价于：

```bash
Rscript scripts/ranked-go-enrichment.R <job-dir>
```

脚本从 `<job-dir>/ranked_genes.csv` 读取输入，将所有结果写到 `<job-dir>/output/`。不要手工在脚本里执行 `install.packages()`；环境缺失应由 readiness/provisioning gate 报告。

## 交付判定

只有 `acceptance.json` 中的硬性条款全部有证据，插件才可升级到内置或商店来源。仅有“脚本能运行”不等于插件验收通过：还必须证明输入契约、artifact truth、失败恢复、重复运行一致性、环境来源和二跳绑定。
