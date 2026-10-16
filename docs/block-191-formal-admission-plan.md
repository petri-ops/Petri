---
capability: evaluation
goal: BLOCK-191 = 评测基线 v2 第四切片·formal-admission 门控棘轮（§4.1 ZCode「smoke→real 晋升需 case manifest+fixture 双齐，baseline 更新只走显式审计命令」）。用户 AskUserQuestion 拍板门控口径「晋升=双齐+显式审计（推荐）」（PASS=全 criteria 过不变）。把晋升规则固化为机械门 + 生成晋升清单台账，防「无凭据/缺 manifest 的 real 用例混入基线」与「基线被非审计路径改写」。全自动化无人眼无凭据依赖（不跑真模型，只守准入规则）。
acceptance:
  - P1 `deriveAdmissionManifest(task, suite)` 纯函数派生 case manifest（id / covers←category+criteria kind 集 / tier←套件 / hasFixture←fixtureFiles 在场 / promoted 目标）；`evalAdmission(task, manifest)` 判双齐=晋升 eligible
  - P2 `scripts/evals-admission.mjs`：扫全部套件产出晋升清单台账（每用例 tier+是否双齐+缺失项）+ 违规即 exit 非零；立「基线仅显式审计」机械门——断言 evals-gate.mjs/evals-run.mjs 唯一写 baselines/snapshots 路径均在显式 flag 守卫内（源码扫描）
  - P3 契约测 `test/block191-formal-admission.test.mjs`：①manifest 派生正确（covers/tier/hasFixture）②双齐规则（声明晋升 real 却无 fixture/manifest→not admissible；有双齐→admissible）③基线写仅显式 flag（扫源码：无 flag 时不 fs.writeFileSync baseline）④现有 golden/smoke 全部满足其 tier 准入不违规
  - 门禁：docs:check/ui:audit:check（纯基建免 UI-###）/契约测/test:changed 全绿；evals:run golden+smoke 不回归
  - 完成语义：formal-admission 双齐+显式审计口径成机械门在册；晋升清单可重放；不改 13 任务字段名/PASS 语义/gate+runGoldenTask 行为
reopen: 无；provider 依赖切片（真实 provider 录制态/LLM-as-judge real）需 PETRI_EVALS_PROVIDER_KEY，独立评估（本环境无凭据诚实 blocked）
status: completed
---

# BLOCK-191 — 评测 v2 第四切片·formal-admission 门控棘轮（晋升=双齐+显式审计）

- 状态：`completed`（2026-10-16 用户拍板门控口径后发令 → P0-P4 单会话闭环；closeout 十三门全绿；零 provider 零人眼）

## 1. 立项自检
证据自证=晋升不再靠人自觉，而由机械门守「凭据+manifest+fixture 双齐才入 real 基线，基线仅显式审计命令可写」。防「静默放宽基线=自欺」退化。

## 2. 范围
case manifest 派生视图 + 双齐晋升门 + 显式审计基线门 + 晋升清单台账。现有 13 任务（smoke 9/golden 1/real 3）。

## 3. 非范围（红线）
- 不改任务 JSON 字段名/不引 manifest 必填字段到 13 文件（manifest 派生自现有 category/fixtureFiles/criteria/套件）。
- 不动 PASS 判定（全 criteria 过）与 gate/runGoldenTask 行为。
- 不跑真模型：本门只守准入规则，不产生 real 结果（凭据缺失切片 reopen）。

## 4. 执行
P1 deriveAdmissionManifest+evalAdmission 纯函数（`scripts/lib/evals-admission.mjs`）→ P2 `scripts/evals-admission.mjs` 台账+双齐违规 exit 非零+基线显式审计源码门 → P3 契约测 4 项 → P4 closeout+五件套。

## 5. 并行隔离
触碰面=`scripts/lib/evals-admission.mjs`(新)/`scripts/evals-admission.mjs`(新)/`test/block191-*.test.mjs`(新)/package.json `evals:admission`/impact-map 登记。无 dev 栈、无人眼、无 provider。
