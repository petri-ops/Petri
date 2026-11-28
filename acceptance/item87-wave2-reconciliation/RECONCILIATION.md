# item 87 第二波教练循环对账报告（52a0f6472 vs origin/main · 2026-11-28）

## 结论

**52a0f6472 的全部内容主线已覆盖——无真实缺失，无需合并。** 主线版本在等价基础上额外演进（lint 修复 + seat polish 三分区），测试 7/7 全绿。

## 局面还原

- 52a0f6472（87 二波教练循环，基于 c12e36d94/item91）提交后被 coordinator 部署预览的 checkout -B 重置成孤儿（流程缺陷，coordinator 责任）
- 但 a162648f1（诊断批）顺带包含了 do-coaching 系文件——原因：该批基于的 origin/main 已含 52a0f6472 的内容（coordinator 在诊断批之前已把教练内容并入主线），故诊断批 diff 只显示 lint 修复部分
- 逐文件对账（52a0f6472 版 vs origin/main tip 5ddbaec75）：

| 文件 | 52a0f6472 版 | main 版 | 判定 |
| --- | --- | --- | --- |
| do-coaching.js | 动态键循环校验（3 处 detect-object-injection 警告源） | 显式字段直取（lint:ledger 收敛版，0 警告） | **主线已演进覆盖**（语义等价+更规范） |
| do-coaching-schema.js / 027_do_coaching.sql | 三表 DDL | 逐字节相同（diff 0 行） | 等价 |
| routes/do-coaching.js + index 注册 | 六端点 | 逐字节相同（diff 0 行） | 等价 |
| test/item87-coaching.test.mjs | 动态键断言 | entries 查找断言（lint 修复版），7/7 绿 | **主线已演进覆盖** |
| WorkbenchOverviewSurface 教练条 | coaching-strip（初版） | coaching-strip + seat polish 三分区（className=coachingStrip、去 emoji、可读任务标签） | **seat polish 合法变更，保留**——教练条功能完整在场 |
| impact-map item87-coaching-loop / 审计流水 / knip 基线 | 已入 | 已入 | 等价 |

## 引擎完整性核真（HEAD 现状）

- 八个导出函数全在：computeHandoverPhase / createCoachingRun / recordDecisionExplanation / recordReview / listDivergences / insertTasteSample / compareAgainstSamples / seedBioTasteSamplesFromMarkdown
- HK-01 四钉测试 7/7 绿（HEAD 版）
- 路由注册 `['Do coaching', ...]` 在场（routes/index.js:76）；impact-map `item87-coaching-loop` 规则在册

## 流程缺陷修复建议（coordinator 采纳即闭环）

1. **worker 分支命名**：worker 一律用 `codex/<item>-<slug>` 命名分支提交，不用 `preview` 共享分支——checkout -B 预览部署就不会重置 worker 的提交
2. **coordinator 部署**：改用独立 `deploy/preview` 分支（部署流水线只 checkout 该分支），worker 分支永不复用
3. **孤儿兜底**：coordinator 做 checkout -B 前若分支有未并入提交，先 `git branch archive/<old-name> <sha>` 留可恢复引用（本次 52a0f6472 即靠可恢复对象完成对账）
4. **对账工具**：本报告的判定方法 = `git diff <orphan> HEAD --stat` + 逐文件语义 diff + 引擎导出清单核真，可复用为「孤儿提交对账」标准流程

## 基座

- 对账基点：origin/main = 5ddbaec75（seat 总览 polish tip），52a0f6472 与 HEAD 的 merge-base = c12e36d94（item91）
- 本报告为纯文档，零代码变更
