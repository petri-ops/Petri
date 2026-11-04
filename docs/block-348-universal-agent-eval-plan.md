---
capability: block-348-universal-agent-eval
status: completed
goal: 建立并跑通一套跨域（非生信垂类）通用任务基准，度量 Petri 作为通用 agent 的自主完成能力，产出可复跑任务定义、runner、实测报告与短板分级清单。
acceptance:
  - 8/8 任务定义落盘且 schema 校验通过；runner 至少完成一次完整回放。
  - 每任务有当次结果记录：完成/中断/失败 + 事件轨迹指针 + 人工干预点列表。
  - 四项度量（自主完成率 / 干预次数 / 工具选择合理性 / 产物可用性）均有数值，或明确「不可测 + 原因」。
  - 短板清单按 P1/P2/P3 分级并逐条带证据；判据表在跑之前写死并留时间戳。
  - 不出现「未跑表述为通过」；环境不可得的任务如实标记。
reopen: G1+ 项（真实 Provider 矩阵 / 外部 LLM 评测服务）；新增功能域；已取消四项不复活；本包非范围项。
---

# BLOCK-348 — 通用 agent 任务基准实测（计划）

- 登记状态：**completed（2026-11-05 当日收口；开工发令原话「按 docs/next-phase-program-2026-11-05.md 总纲，逐个推进 BLOCK-348 → 354 共 7 个包」）**——实测报告 `docs/block-348-eval-report.md`；证据 `acceptance/block-348/`；P1 发现（压缩断链）入池 C-45
- 总纲：`docs/next-phase-program-2026-11-05.md`（工作模式契约 / 检查单 / 红线以总纲为准）
- 依据：`docs/Petri-Desktop-Evaluation-Report-2026-11-04.md` §5 T-A
- 阶段边界：**G0 开发期常态 · 不外推 packaged / Provider / GA**

---

## §1 立项依据

评估报告判词「工程成熟度 A- / 产品兑现度 C+」的核心缺口：项目已有 115 工具、285 路由、976 测试文件，但全部验证停留在**工具级与契约级**。`acceptance/evals/` 里的 golden / smoke / real-replay 是回归防退化，不是「新任务能不能完成」的能力评估。距上次产品评估（2026-10-15）一个月、新增 20+ 包，无一次任务级实测。上轮点名的「过目积压压价值兑现」本月仍未动。

## §2 范围（逐条）

- 定义 **8 个跨域任务**，固定 prompt + 固定种子工作区 + 固定判据，**不使用任何生信垂类数据**：
  - T1 代码：含 bug 的小仓库 → 定位 + 修复 + 跑测试证明
  - T2 数据：脏 CSV → 清洗 + 出图 + 结论
  - T3 研究：联网检索指定主题 → 带引用报告
  - T4 操作：可控本地页上完成一次浏览器具体动作
  - T5 文档：散乱笔记 → 结构化文档 + 摘要
  - T6 多 agent：并行探索 3 个方向后汇总
  - T7 长任务：30+ 步并中途触发上下文压缩，验上下文保持
  - T8 自我验证陷阱：埋一个易错点，看 agent 是否核验自己的产物
- 任务定义落盘为机器可读 JSON（`acceptance/block-348/tasks.json`），每任务含 `id / prompt / seedWorkspace / timeoutMs / 判据表 / 预期产物`。
- 建可复跑 runner（`scripts/block348-task-runner.mjs`）：按任务启动会话、记录事件轨迹与工具调用、标记人工干预点、采集产物。
- 度量四项：**自主完成率**、**人工干预次数**、**工具选择合理性**（选对工具 / 是否绕路）、**产物可用性**（人眼判据表）。
- 产出实测报告（`docs/block-348-eval-report.md`）：每任务一页结果 + 汇总 + 短板清单（P1/P2/P3 分级、逐条带证据）。
- 复跑命令（real provider 全量）：

  ```bash
  PETRI_LOCAL_DATA_DIR="$HOME/Documents/BioF3-Local" \
  PETRI_EVALS_BASE_URL="https://api.deepseek.com/v1" \
  PETRI_EVALS_MODEL="deepseek-chat" \
  node scripts/block348-task-runner.mjs
  ```

## §3 非范围（越界即停工）

- **不修任务暴露的缺陷**（另立票；本包只产出事实）
- 不引入外部 LLM 评测服务 / 评分模型（G1+；先要事实，不要分数）
- 不做生信垂类课题（通用 agent 视角）
- 不新增工具域、不改 `TOOL_DEFS`
- 不追求「达标分数」、不预设通过线、不事后调整判据

## §4 验收（可度量）

- 8/8 任务定义落盘且 schema 校验通过；runner 至少一次完整回放，复跑命令写进计划
- 每任务有当次结果：完成 / 中断 / 失败 + 事件轨迹指针 + 干预点列表
- 四项度量均有数值，或明确「不可测 + 原因」（不得留空、不得补写估算）
- 短板清单按严重度分级，每条带 `file:line` 或轨迹指针
- 判据表在跑之前写死并留时间戳；报告不得事后调口径
- 不出现「未跑表述为通过」；环境不可得如实标记

## §5 门禁（机械）

- 新增 `test/block348-task-suite.test.mjs`：任务定义完整性、结果 schema 校验、判据表不可变校验
- `node scripts/functional-surface-audit.mjs --check`：P1/P2 无新增
- `npm run quality:surface` / `quality:knip:check` / `quality:types` / `quality:lint` / `docs:check` / `ui:audit:check`
- `npm run closeout` 14 门全绿
- 新增 `scripts/` 与 `acceptance/block-348/**` 必须登记 `test/impact-map.json`
- 本包不改工具面 → `model-surface` 不更新（若意外改动须 `--force` 并写理由）
- 开工前跑总纲 §6.1 检查单；收口跑 §6.2 检查单

## §6 依赖 · 风险 · 边界

### 6.1 依赖

无（首包）。BLOCK-350 复用本包任务脚本作性能场景；BLOCK-353 复用其作打包态验收脚本。

### 6.2 风险登记

- 任务跑不通可能是环境缺依赖而非产品缺陷 → 必须区分「环境不可得」与「agent 能力不足」并分别留痕
- 通用任务触发大量工具调用 → 每任务设 `timeoutMs` 与成本上限，超限记「中断」而非「失败」
- 产物可用性是人眼判据 → 判据表先写死，禁止事后调口径
- 真实 Provider 差异属 G1+ → 报告只在 G0 dev 口径成立

### 6.3 touchSurface（允许改动面，越界需先裁决）

`acceptance/block-348/**`、`scripts/block348-*.mjs`、`test/block348-*.test.mjs`、`docs/block-348-*.md`、`test/impact-map.json`

### 6.4 sharedBaselines（改动时必须同步核对）

`test/impact-map.json`（新文件未登记 → `test:changed` fail-closed）、`test/functional-surface-baseline.json`（棘轮只许递减）、`test/model-surface-baselines.json`（仅工具定义变化）、`test/knip-baseline.json`（优先删死码）、`eslint-suppressions.json`

## §7 完成语义（DoD）

任务集 + runner + 实测报告 + 短板清单落盘；总纲 §8 进度台账填行；registry `planned→completed`；README / roadmap / backlog / AUDIT-LOG 回写；`docs:reconcile` 0 issues；`closeout` 全绿。

状态流转：`planned → active`（用户发令）`→ completed`。**本计划本身不是开工授权**；范围变更、跨包插队均需显式发令。
