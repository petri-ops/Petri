# G0-LF12 Baseline Qualification Report

状态：`qualified + maintained`

资格对象：`g0-fifth-wave-establishing-0.6 / 0.6.0`

当前晋升结果：`g0-baseline-v1 / 1.1.0`（LF12 首次晋升为 1.0.0；RS9 完成兼容支持范围重资格）

执行真相：`run_tool → tool_job → artifact_truth`

## 最终裁决

- 强制证据：`17 / 17 satisfied`
- 零容忍不变量：`10 / 10 observed`，违规数均为 `0`
- Evidence Ledger 无效条目：`0`
- blocker：`0`
- limited claim：`0`
- unsupported claim：`0`
- 确定性裁决：`qualified`
- 永久维护门：`11 / 11 passed`

资格裁决绑定封存的 0.6 subject digest；晋升后的 v1 Manifest、Registry、Support Matrix 和 LF11 requalification 接线形成新的 maintained bundle，不反向改变被资格评审的对象。

RS9 新增 `result_studio_product` mandatory evidence，并将 `result-studio-editing` 从 excluded claim 晋升为显式 support claim；五条科学任务、九类环境、双真实 Provider、五态 renderer 与零假成功边界见 `acceptance/g0-result-studio/rs9-*-acceptance.json`。

## 强制证据覆盖

| 证据类 | 状态 |
|---|---|
| Constitution / Baseline | satisfied |
| Truth Lattice | satisfied |
| Durable State | satisfied |
| Scientific Accuracy | satisfied |
| Replay / Drift | satisfied |
| Runtime / Resource | satisfied |
| Model / Memory / Cost | satisfied |
| Plugin Supply Chain | satisfied |
| Security / Permission | satisfied |
| Observable Experience | satisfied |
| Resilience / Fault Matrix | satisfied |
| Migration / Upgrade | satisfied |
| Real Provider | satisfied |
| Packaged App | satisfied |
| Soak / Endurance | satisfied |
| Visual State Convergence | satisfied |

真实执行证据包括两个 Provider 类、macOS arm64 packaged canonical DESeq2、Artifact/参数/Provenance/独立脚本/HTML 报告、应用退出清理、项目重启恢复、两轮真实任务与 5 分钟连续健康采样，以及聊天/摘要/Task/文件/结果的明暗、宽窄和重启视觉矩阵。

## Qualified 支持边界

- macOS arm64 packaged Desktop 本地科学执行。
- 本地文件 + SQLite 持久化。
- Node、R、Python 本地 Runtime。
- DeepSeek 与 OpenAI-compatible Provider 的 science-neutral 交互边界。
- canonical `deseq2` conformance track。
- read、full、developer 权限模式及不可覆盖安全边界。

Windows、Linux、macOS x64、云/PostgreSQL、任意组学自动支持、任意插件科学资格、Multi-Agent 编排和 Result Studio 编辑能力均未被本次资格推断或晋升。

## 迁移与回滚

- v1 未改变 SQLite schema 或执行真相；既有 Major 0 项目保持可读和可执行，创建身份不被改写。
- Major 2 及未来项目保持可读但阻断正式执行与写入。
- 同版本 digest 冲突继续 fail-closed，不通过静默重写历史修复。
- 回滚通过版本化 Manifest/Registry/Support Matrix 提交恢复上一基线；项目原始创建/opening identity 和 Artifact 历史保持不变。
- 任何 baseline digest 变化、新 G0 major、支持范围扩张、证据过期或事故回灌都触发 LF12 requalification；没有新的 `qualified` 决策和证据摘要时 LF11 Promotion Gate 拒绝晋升。

## 证据入口

- `qualification-manifest.json`
- `evidence-ledger.json`
- `qualification-decision.json`
- `qualification-gate.json`
- `offline-conformance.json`
- `real-provider.json`
- `packaged-app.json`
- `soak-endurance.json`
- `visual-state-convergence.json`
- `packaged-ui/`

所有提交证据仅保留 ID、哈希、计数、有界状态与脱敏截图；不包含凭据、Provider 原始响应、内部 URL、绝对用户路径或真实用户科学数据。
