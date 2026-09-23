# BLOCK-118-DEV-DECISION-TOOLING 计划：开发时决策工具化（Jev/Laya 提效开发流程）

**Plan ID**：`BLOCK-118-DEV-DECISION-TOOLING`
**状态**：`active（P0-LAUNCH）`
**立项日期**：2026-09-23
**责任轨道**：BLOCK（开发时决策工具化 / 双供给打通 / 新决策点 doc-suggest）
**上游文档**：`docs/block-115-test-suggest-plan.md`（建议器内核与校准先例）· `docs/block-116-decision-platform-plan.md`（阈值注册表与记账）· `docs/block-117-laya-supply-validation-plan.md`（本地供给先例与 confidence 语义结论）· `docs/planning/typesafe-jev-system-one-research.md`（技术底稿）

## 0. 立项来源与用户裁决留痕

- 用户提问（2026-09-23）：「能否让 jev 或者 laya 来优化 gewu 项目开发呢 使用 skill 或者你觉得比较合适的方式」。
- 本会话澄清确认：目标=**开发侧工具**（ZCode/agent/终端辅助 Gewu 开发），Gewu 产品运行时零改动。
- 用户裁决原话（AskUserQuestion 留痕）：
  - 供给：「**两者都支持**」（Jev 云端 + 本地 Laya；工具跟随设置页 provider，另补 Laya 校准让两种供给都可用）。
  - 范围：「**加文档回写建议**」（test-suggest 接线 + 新建 doc-suggest 决策点）。
  - 启动：「**裁决并行启动**」（与 UI-437 v5.1.1 活跃会话并行）。

### 并行文件面隔离声明（用户裁决并行）

- UI-437 v5.1.1 会话独占（本包**零触碰**）：`frontend/src/components/copilot/*`、`docs/ui-productization-audit.md`、`scripts/check-ui-productization-audit.mjs`、`scripts/ui437-*.cjs`、`acceptance/ui-437/*`、`test/impact-map.json` 现有改动。
- 本包 impact-map 登记推迟到 UI-437 收口后补登记（登记完成前收口门禁以定向测试 + docs 门禁承载，如实说明）。
- 提交严格按路径分批 staging，绝不批量暂存；共享台账（AUDIT-LOG/roadmap/README/DOC-REGISTRY）按 BLOCK-104 并行先例只追加本包条目。

## 1. 范围与非范围

### 1.1 范围

| 阶段 | 内容 | 核心落点 |
| --- | --- | --- |
| P0 | 供给打通 + test:suggest 接线 | `decision-thresholds.js` 注册表增可选 `thresholdsByModel` 字段（仅 dev-time 点）；建议器门控改 `thresholdForModel(point, outcome.model)` 默认回落现行 `threshold`；npm 包装 `scripts/dev-suggest-run.mjs`（git 改动收集 + 供给选择 `--supply=cloud\|file` + 显式 `BIOF3_DECISION_CONFIG_PATH` 锚定 `.biof3-dev-user-data/data/decision-config.json`）+ `package.json` 接 `test:suggest`；Jev 云 key 1-call 冒烟；Laya 版 test-suggest 校准（复用 block115 语料 + harness overrides，BLOCK-117 先例），达标落 per-model θ、不达标如实落「不可采纳」 | 
| P1 | doc-suggest 新决策点 | 语料构建 `scripts/block118-build-doc-corpus.mjs`（git 历史挖掘：已收口提交文件清单 + 实际回写 canonical 文档自动标注 ≥100 条）；请求形状=单次调用并行多道 noul（每 canonical 文档一道）+ 确定性前置层；内核 `core/biof3-server/helpers/doc-suggest-core.js`（或与 CLI 同文件，与 block115 同构）+ CLI `npm run doc:suggest`；Jev + Laya 双供给校准，per-model gates 入注册表（证据绑定）；契约测试 `test/block118-doc-suggest.test.mjs` |
| P2 | 工作流接线与收口 | `gewu-dev-infra` skill 增 `references/DEV-DECISION-TOOLS.md` + SKILL.md 挂入口（不新建 skill、零发现桥义务）；impact-map 补登记（UI-437 收口后）；dogfood 证据 `acceptance/block-118/dogfood.json`；closeout 门禁 + 台账回写 |

### 1.2 非范围（exclusions）

- 产品运行时五接点（topic-shift/knowledge-guard/marker-celltype/intent-route/tool-route）的供给、阈值、设置页、UI：**零改动**。当前 Laya 供给下产品接点零采纳（confidence 语义）属 BLOCK-117 已裁决事实，处理与否另立裁决。
- 不引入 hook 自动化、不建 MCP server、不新建独立 skill（扩展既有 gewu-dev-infra）。
- 不动 `.biof3-dev-user-data/` 内任何密钥文件内容（cloud 供给只读）。
- 不改 `test:changed` / `npm run closeout` 既有链路语义（建议器永远是增量附加，只加不减）。
- 阈值注册表 schema 扩展仅限 dev-time 点使用 `thresholdsByModel`；产品接点注册表条目零漂移（契约测试承载）。
- 0 npm 新依赖。

## 2. 设计要点

- **双供给解析**：dev CLI 默认跟随 `decision-config.json` provider（与设置页同源，当前=本地 Laya）；`--supply=cloud` 时从 `.biof3-dev-user-data/jev.env.bak-by-user-request` 读 `TYPESAFE_API_KEY`（gitignored，不回显不入仓，quality:secret 红线）以 `askDecision overrides` 直连 Jev 云。校准 harness 同通道 overrides，与产品运行时供给完全隔离。
- **每模型阈值**：BLOCK-117 裁决「confidence 语义不可平移」→ 单一 θ 无法双供给通用。注册表条目增可选 `thresholdsByModel: { '<model-id>': θ|gates }`；解析顺序=response model 精确匹配 → 回落现行 `threshold/gates`（Jev 校准值保持默认）。契约测试：每条 per-model 阈值必须绑定证据文件（沿用 block116「无证据不改阈值」红线）。
- **doc-suggest 请求形状**：state=改动文件清单（≤600 字符，与 test-suggest 同界）；questions=并行 noul（roadmap/handoff/ui-audit/audit-log/plan-doc 各一道，「本次改动是否需要回写该文档」）；一次调用出全部答案（Jev 加问几乎不增延迟）。确定性前置层：纯 docs//acceptance/ 改动→零建议零出站；含 `frontend/` UI 面文件→ui-audit 确定性命中（AGENTS.md 既有硬规则，无需模型）；模型只裁语义残差（roadmap/handoff/plan 归属）。
- **建议语义**：与 block115 同构——低置信/弃权/降级=零建议（安全默认）、永不 throw、只附加不下判、执行由人/流程决定；`decision_log` 记账 meta `{point, threshold}`（BLOCK-116 既有面，观测面可见）。
- **判据**（沿 block115 P0 门，评审可改）：存在 θ 使 adoptedPrecision@θ ≥ 0.80 且 adoptedCoverage@θ ≥ 0.50；argmax/noul overall ≥ 0.80（诊断门）；noul 双阈值形态参照 block110 gates。

## 3. 验收门禁清单（收口对账用）

1. 契约测试：`test/block115-test-suggest.test.mjs`（门控改造后全绿）+ `test/block118-doc-suggest.test.mjs`（新建，弃权=零建议/降级=零建议/只加不减/前置层确定性/注册表证据绑定）+ `test/block116-decision-platform.test.mjs` 扩展（thresholdsByModel 契约 + 产品七接点条目零漂移红线）。
2. 双供给校准证据：`acceptance/block-118/` 落 test-suggest-Laya 校准 JSON + doc-suggest-Jev/Laya 校准 JSON（含 θ 曲线与三值裁决）。
3. Jev 云冒烟：1-call 真跑通过（或 key 失效如实登记并降级 file/Laya 路径）。
4. dogfood：对真实改动跑 test:suggest + doc:suggest 各一轮，输出落 `acceptance/block-118/dogfood.json`。
5. `npm run docs:check` 绿；`npm run test:changed` 绿（impact-map 补登记前如实说明升级范围）；`npm run closeout` 十门（本包无 UI 面，ui-audit 门按既有基线过）。
6. 台账回写：plan 状态 / roadmap / handoff / AUDIT-LOG 收口行。

## 4. 完成语义

- `completed`：P0~P2 全落 + 门禁清单逐项对账 + 双供给校准三值裁决落档（「Laya 不可采纳」也是合法完成态，只要证据如实）。
- 关键风险与对策：Laya 校准不达标→如实落证不硬凑 θ（该供给零建议=安全默认）；git 历史自动标注 gold 噪声→harness dry 先验语料，精度门不过先修语料；Jev key 失效→P0 首步冒烟，失效即报告用户不阻塞 file/Laya 路径。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
