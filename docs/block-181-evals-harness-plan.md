---
capability: agent-evals
goal: Agent 质量评测基线（evals harness）——本地可复现的任务级评测：黄金任务集（fixture 项目+prompt+确定性判据）× 运行器（隔离后端+mock/real 双 provider 模式）× 判据评估器 × 基线回归门。「证据自证」的终局形态：prompt/工具/skill/模型变更对任务完成质量的影响本地可测。
acceptance:
  - P0 评测基建：scripts/lib/evals-harness.mjs——隔离后端拉起（同 block179 姿势产品化）+provider 种子（credential_updates 文件路径，根治 block93 类 env 债）+脚本化 mock OpenAI SSE provider+黄金任务执行器（fixture 项目/会话播种→真实 agent 循环→SSE 事件收集→终态等待）
  - P1 判据与套件：确定性判据评估器（task_completed/final_answer_contains/tool_used/tool_not_used/policy_denied/no_policy_denial/event_present/file_contains）+ smoke 套件 ≥3 黄金任务（工具链写档/策略防护拦截/正文退化修复——复用 BLOCK-179/180 实证场景）mock 模式全绿
  - P2 基线回归门：evals-run 产出结构化报告（acceptance/evals/）+evals-gate 基线棘轮（基线通过项回归即红，--update 显式升级）+npm run evals:run/evals:gate 接线
  - P3 真模式与债务清偿：provider=real 通道（无凭据诚实 skip）+block93 凭据种子修复（credential_updates 路径，env 债根治，2 红转绿）
  - 红线：评测全程本地（无云依赖，judge LLM 层 v1 不做——判据全确定性）；mock 模式测的是 harness 与 loop 机制回归而非模型质量（诚实边界写进报告）；不改 block93 测试断言语义（只修凭据供给根因）；0 新 npm 依赖
  - closeout 门禁绿（test:changed block93 转绿为收口证据之一）
reopen: 任一出口断言未达即返工；用户 2026-10-13 裁决「可以的 开」（批准主代理方向推荐「Agent 质量评测基线」）
status: completed
---

# BLOCK-181 — Agent 质量评测基线（evals harness）

## 0. 来源与授权

- 主代理方向推荐（研究池四项收官后的新候选）：「七波能力建设后，最高杠杆的下一步是**能证明质量、能抓回归**——它让之后每一次 prompt/工具/skill 改动都获得质量信号，复利所有后续变更」；「证据自证是 ZCode/Codex 给不了的魂面（评测在云端内部，用户拿不到）」。
- 用户 2026-10-13 裁决「可以的 开」→ 立项发令。

## 1. P0 勘察结论（2026-10-13，代码实证）

- **可复用基建（三件全有实证）**：①隔离后端姿势（block179/180 探针：PETRI_DB_PATH/PETRI_LOCAL_DATA_DIR 临时目录+独立端口+src/migrations 自举）；②脚本化 mock OpenAI SSE provider（block180：tool_calls delta 聚合格式+内容寻址脚本）；③任务事件信封 SSE 收集器（{seq,eventType,payload} 归一）。三者已重复实现两次——本包产品化为 `scripts/lib/evals-harness.mjs`。
- **block93 env 债根因**：测试在 before() 设 `process.env.DEEPSEEK_API_KEY`，但 credential 迁移至 credential-store 后 env 路径失活（ai-settings 头注「.petri-secrets/env 对本模块失活」）→「API key 未配置」2 红。修复=seed 改走 `credential_updates`（ai-settings._extractCredentialUpdates 迁移路径，credentialStore.set 同进程生效）。
- **评分分层决策**：v1 判据全确定性（事件/文件/答案文本断言，离线可验证）；LLM-as-judge 质量分层登记不做（依赖 judge provider，且质量分无基线可比较前意义有限——诚实边界）。
- **mock 模式语义**：脚本化 provider 下评测的是 **harness 与 loop 机制回归**（判据评估/事件面/策略拦截/修复提升），不是模型质量——写入报告字段 `measures: 'harness'`，real 模式才标 `measures: 'model'`（诚实边界）。

## 2. 范围（四批）

- **P0 基建**：`scripts/lib/evals-harness.mjs` 导出 spawnIsolatedBackend / seedProviderSettings / startMockProvider / runGoldenTask / evaluateTask。
- **P1 判据与套件**：判据评估器 + `evals/suites/smoke/` 三个黄金任务（①工具链写档：mock 两轮=workspace_write→收口；②策略防护：破坏命令→deny→收口说明；③正文退化修复：BLOCK-179 场景复用）。任务定义 JSON：{id,title,category,fixtureFiles,prompt,accessMode,mockScript,criteria}。
- **P2 基线门**：evals-run 报告落 acceptance/evals/；evals-gate 基线棘轮（--update 升级）；npm 双命令；impact-map 登记。
- **P3 真模式与清偿**：provider=real 通道（PETRI_EVALS_DEEPSEEK_KEY 或既有 credentialStore，无凭据 skip）+real 套件 sanity 任务一枚+block93 凭据种子修复转绿。

## 3. 非范围（红线）

- LLM-as-judge 质量分（v2，需先有确定性基线）；评测报告 UI 面（v1 CLI+JSON）；分布式/并行评测（单机串行）；改 block93 断言语义（只修供给根因）；0 新 npm 依赖。

## 4. 门禁

- 红绿先行：`test/evals-harness.test.mjs`（判据评估器纯函数+基线棘轮对比逻辑，离线）。
- 套件自证：`npm run evals:run -- --suite=smoke --provider=mock` 全绿 + `evals:gate` PASS（smoke 套件即 harness 集成测试）。
- block93 转绿：`node --test test/block93-role-prompt.test.mjs` 2/2。
- test:changed 收口（block93 转绿后此门应恢复全绿）+ closeout 十三门。

## 6. 波报（2026-10-13 当日整包收口）

- **P0 基建**：scripts/lib/evals-harness.mjs——spawnIsolatedBackend（DB 自举+provider 种子+健康等待）/startMockProvider（有序回合队列，tool_calls 与文本双形态 SSE）/runGoldenTask（fixture 项目/会话播种〔API 取 workspace_path+id 扫描兜底〕/projectId 绑定/SSE 收集/终态等待）/evaluateCriterion（8 判据）/compareRunVsBaseline（纯函数棘轮）。
- **P1 判据与套件**：8 判据全实现（task_completed/final_answer_contains/tool_used/tool_not_used/policy_denied〔嵌套 toolResult.data 取数〕/no_policy_denial/event_present/file_contains）；smoke 三任务全绿（工具链写档含 file 实证/策略拦截 cmd: 前缀/正文退化修复 repair 事件+指纹链）。
- **P2 基线门**：evals-run 报告（latest+时间戳双写，measures=harness|model 诚实标注，skip 不计失败）+evals-gate 棘轮（回归红/改善绿/新任务只记/--update 显式升级）+npm evals:run|gate。**门禁三态实证：clean=0/篡改=1/再生成=0**（棘轮真会抓回归）。
- **P3 真模式与债务清偿**：provider=real 通道+real/provider-sanity 任务（无凭据 SKIP exit 0 实证）；**block93 凭据种子根治**——credential_updates 路径替换失活 env 占位，2 红转绿，test:changed 恢复全绿（41 测 0 红 exit 0），2026-10-12 在册 env 债正式清偿。
- **抓真两处**：①评测任务缺 context.projectId 致 workspace 工具 project_required、file 判据空转（已修，判据现在验证真实落盘）；②once 决策初版误写维度级（BLOCK-180 同族教训：放行语义与确认集写入分离）。
- **决策工具**：doc:suggest 零建议；实现中 lint 触碰面 0 error。
- closeout 十三门 PASS（test:changed 全绿含 block93）；G0 开发期常态 · 不外推 packaged/Provider/GA。

## 5. 完成语义

- registry `active → completed`；plan 波报回填；AUDIT-LOG ✅ 行；handoff 顶部更新；方向登记 roadmap（评测基线为五维「可靠性/证据自证」新主线）。UI 台账不涉及（CLI 面）。
