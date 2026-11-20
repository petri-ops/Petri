# E-03 执行包（SUS / UMUX-Lite · 真人样本就绪件）

> 日期：2026-11-20（用户发令「开整 E-03 真人样本（外部条件）」）。
> **状态更新（同日用户裁决）**：E-03 已 cancelled——原话「过去了 长期处于G0开发阶段 不需要用户反馈」。本包留档不删：G1+ 若需真人评分可直接复用（分发→录入→出分三步不变）；签字槽以 ia-material §8 cancelled 行为准。**真人填写与签字无法由 Agent 产生**——本包把外部条件压缩到只剩「分发给真人 + 收回答卷」一件事：回收后一条命令出分，签字槽仍由人填。
> 口径真源 = [jia3-sus-questionnaire.md](../jia3-sus-questionnaire.md)（问卷原文+填写说明，分发给参与者用那份）。

## 你要做的三步（唯一的人工环节）

1. **分发**：把 `../jia3-sus-questionnaire.md` 的 §0 填写说明 + §1/§2 两张题表发给参与者（本地渠道：打印/复制到内部文档均可，不接外部平台）。建议按问卷 §3：首轮 12 人（最低 8）、老 8 新 4、三类任务各 ≥3 人、任务后 5 分钟内填。
2. **回收录入**：每人一行填进 [results-template.csv](./results-template.csv)（存为 `acceptance/block503-outputs/e03-results/results.csv`），列=匿名编号/老新/任务类型/SUS 十题/UMUX 三题/日期。
3. **出分**：`node scripts/e03-score.mjs acceptance/block503-outputs/e03-results/results.csv --out acceptance/block503-outputs/e03-results` → 生成 `score-report.{json,md}`（SUS 均值/中位/>68 人数、UMUX-Lite 主分、老新分布、持续意愿；**<8 人自动只报个案不出总体分**）。

然后把 `score-report.md` 数字按你的判断填进 `docs/ui-design-ia-decision-material.md` §8 E-03 签字槽（样本量+分值+日期+结论）——**签字归你，Agent 零代签**。

## 本包内容

| 文件 | 作用 |
|---|---|
| `results-template.csv` | 回收模板（含表头与 2 行示例——示例行带 `#` 前缀注释行，录入时删掉） |
| `scripts/e03-score.mjs`（仓库 `scripts/`） | 机械核算器（纯函数+CLI；fail-closed：选项越界/缺列/列数不齐即红） |
| `test/e03-score.test.mjs`（仓库 `test/`） | 计分契约测试（SUS 标准向量/UMUX 主分两题口径/CSV 红测/最低样本护栏） |

## 边界（如实）

- Agent 不填答、不编造样本、不代签；E-03 状态 `external-blocked` 维持到真人读数在案。
- 问卷原文零改写；本包只做执行配套（模板+核算）。
- 零新依赖（node 内置模块）；核算器契约测试 `node --test test/e03-score.test.mjs`。

G0 开发期常态 · 不外推 packaged/Provider/GA。
