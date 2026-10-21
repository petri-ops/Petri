---
capability: qdomain-p4c-tail
goal: Q-DOMAIN P4-C 收尾（S2–S6）——把外围 tool/result 与前端剩余的领域数据/文案继续下沉领域包，逐阶段下调域中性基线；不可迁移的兼容键收敛为显式白名单并单独裁决。
acceptance:
  - S2：agent-workflow 模板移入 pack `provides.agentWorkflowTemplates`，核心只留通用装载与投影；域中性 179→163。
  - S3-S6 按 §3 逐阶段推进，每阶段 0 新增/0 恶化，基线逐次下调。
  - 每阶段定向测试 + test:changed + closeout 十三门 PASS。
  - 最终剩余量只能是显式兼容白名单（permissions/modality/schema 等），不得以改扫描器词表充数。
reopen: 兼容白名单的最小集与门禁表达方式，待 S6 收口时裁决。
status: active
---

# BLOCK-234 · Q-DOMAIN P4-C 收尾（S2–S6）

> 用户裁决：2026-10-21「按照你的建议继续推进下去，最好能搞完 P4-C」。
> 母纲：`docs/qoder-essence-absorption-plan.md` §6 P4；前置：BLOCK-233（S1，已完成，域中性 201→179）。

## 1. 起点（2026-10-21）

- 域中性基线：**179 处 / 85 键**（S1 后，0 新增/0 恶化）。
- 剩余大头：methods-export 40、agent-workflow 16、artifact-profiles 13、result-scientific-compare 10、office-file-preview 10、tools-assets 7、其余零散。
- 兼容残留（预计不可零化）：`permissions`/`guest-permissions` 的 legacy 别名 4、`project-modality` 兼容基础值 1、`db/schema` modality 兼容值 2。

## 2. S2 实码勘察（agent-workflow 模板）

| 面 | 现状 | 结论 |
| --- | --- | --- |
| `core/shared-backend/agent-workflow.js:325` | `AGENT_WORKFLOW_TEMPLATES` 三条领域工作流（bulk-rna-core / deg-result-refinement / coexpression-network） | 纯数据块，整体移入 pack |
| `listAgentWorkflowTemplates()` / `createAgentWorkflowPlan()` | 直接读模块常量 | 改读 pack 装载器；包缺失=零模板（诚实降级） |
| 消费方 | `learning.js`（run_tool op=list）、`routes/tools-catalog.js`（workflow-templates） | 接口不变 |
| 测试 | `test/agent-workflow.test.mjs` 依赖三条模板 | 夹具 pack（不依赖兄弟包） |
| pack | 已有 `provides.methods` 先例 | 新增 `provides.agentWorkflowTemplates`，0.2.1→0.2.2 |

## 3. 分阶段

| 阶段 | 目标 | 预估残量 |
| --- | --- | --- |
| **S2（当前）** | agent-workflow 模板下沉 pack | 179→163 |
| S3 | demo assets + artifact profiles 下沉 pack | →~130 |
| S4 | methods-export 模板/引文下沉 pack | →~90 |
| S5 | result 模块（compare/rerun/selection/interpret/cohort）通用化或下沉 | →~60 |
| S6 | 前端领域文案/类型收敛 + 兼容白名单裁决 | →最小集 |

> 每阶段独立完成“实现→测试→基线下调→门禁→提交”，不一次性大爆炸。

## 4. S2 范围与红线

1. pack：`workflow-templates.json` + `provides.agentWorkflowTemplates`（0.2.2）。
2. core：新 `pack-workflow-templates.js`（只读、有界、路径限 packRoot 内、坏形状 fail-closed、多包按 packId 稳定合并并留 warning）。
3. `agent-workflow.js`：删除模板常量，`list/create` 改读装载器；包缺失 → 空列表 / `unknown_workflow_template`。
4. 测试：夹具 pack 保持既有 16+ 断言；新增装载器边界测（坏形状/路径逃逸/停用包）。
5. 红线：不执行 pack 代码；不改工作流状态机与投影逻辑；不碰 Result Studio。

## 5. 验收门禁（每阶段）

- 定向 `node --test`（本阶段测试 + 邻域）。
- `node scripts/d7-baseline.mjs --update` + `domain-neutrality.test.mjs`（0 新增）。
- `npm run test:changed` + `npm run closeout` 十三门。
- 台账回写：plan 阶段节、AUDIT-LOG、roadmap/handoff；pack 与桌面双仓提交。

## 6. 完成语义

BLOCK-234 只有在 S2–S6 全部收口（或剩余量经裁决为显式兼容白名单）后才转 `completed`；单阶段完成不关闭本包。

## 7. S2 收口（2026-10-21）

**S2 completed；BLOCK-234 仍 active（S3–S6 open）。**

### 7.1 交付

- pack 0.2.2（兄弟仓）：新增 `workflow-templates.json` + `provides.agentWorkflowTemplates`，三条工作流模板整体下沉。
- `core/shared-backend/pack-workflow-templates.js`：bounded loader（≤256KB/≤20 模板/≤20 步/路径限 packRoot/坏形状整包 fail-closed/多包按 packId 稳定覆盖 + warning）。
- `agent-workflow.js`：删除模板常量，`list/create` 改读 loader；包缺失=零模板、`unknown_workflow_template`。
- 测试：`block234` 5/5（启用/停用、路径逃逸、坏形状、跨包覆盖、list/create 消费）；`agent-workflow` 40/40；受影响邻域 45/45。
- 夹具：`test/fixtures/agent-workflow-templates.json` + `test/helpers/workflow-pack-fixture.mjs`，五处模板消费测试统一接入。

### 7.2 验证

- 域中性：**179→163 处 / 85→80 键**，0 新增/0 恶化（`agent-workflow.js` 16 处归零）。
- `test:changed`：**391 项 / 380 pass / 0 fail / 11 skip**。
- `npm run closeout` **十三门 PASS**（report 级 `skills:check` OK）。

### 7.3 边界

- 不执行 pack 代码；状态机/投影/血缘逻辑零改动。
- 包缺失时工作流目录为空（诚实降级）；生态内的 pack 0.2.2 已在位。
- 下一阶段=S3（demo assets + artifact profiles 下沉 pack）。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 8. S3 收口（2026-10-21）

**S3 completed；BLOCK-234 仍 active（S4–S6 open）。**

### 8.1 交付

- **S3a demo assets**：pack 0.2.3 `demo-assets.json` + `provides.demoAssets`（22 条公开 demo job 映射）；核心 `pack-demo-assets.js` bounded loader，`tools-assets.js` 启动时装配 `PUBLIC_DEMO_ASSETS/JOB_IDS`（API 不变）。
- **S3b profile actors**：pack 0.2.4 `artifact-profile-actors.json` + `provides.artifactProfileActors`；核心 `pack-artifact-profile-actors.js` bounded loader，`artifact-profiles.js` 在 `deepFreeze` 前合并 6 个 profile 的 producers/directProducers/consumers；profile schema 引擎仍留核心。
- 测试：`block234-demo-assets` 4/4、`block234-profile-actors` 4/4；`pl4a/pl4b` 接 demo 夹具、`g0-sdc0/g0-third-wave/hle/agent-workflow` 接 actor 夹具；workflow 夹具 pack 同时提供 actors。

### 8.2 验证

- 域中性：**163→143 处 / 80→68 键**（tools-assets 7 + artifact-profiles 13 归零），0 新增/0 恶化。
- `test:changed`：**535 项 / 524 pass / 0 fail / 11 skip**。
- `npm run closeout` **十三门 PASS**（report 级 `skills:check` OK）。

### 8.3 边界

- demo 映射与 actor 映射均为启动时读取；安装/停用包后需重启后端生效（与既有 pack 装配纪律一致）。
- 包缺失时 actors 为空、demo 保护集合为空；profile schema 校验不依赖 actor 数据。
- 下一阶段=S4（methods-export 模板/引文下沉 pack）。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 9. S4 收口（2026-10-21）

**S4 completed；BLOCK-234 仍 active（S5–S6 open）。**

### 9.1 交付

- pack 0.2.5：`methods/python-equivalents.json`（8 类模板 + `{{MIN_CELLS}}` 等占位符）与 `methods/report-citations.json`（13 条）下沉；`provides.methods` 扩展两个路径。
- `pack-methods.js`：新增 `pythonEquivalents` / `reportCitations` 的有界装载与 sanitize（≤400 行/类型、≤40 条引文、400 字符/条），getter 导出。
- `methods-export.js`：`_pythonEquivalent` 改为 pack 模板 + 占位符渲染（无包→通用 fallback）；报告引文改为 pack 数组（无包→省略参考文献段）；封面标题通用化；Methods prompt 示例去具体包名。

### 9.2 验证

- 域中性：**143→103 处 / 68→60 键**（methods-export 40 处归零），0 新增/0 恶化。
- `test:changed`：**426 项 / 422 pass / 0 fail / 4 skip**；`block234-methods-templates` 4/4 + `block220-pack-methods` 13/13。
- `npm run closeout` **十三门 PASS**（report 级 `skills:check` OK）。

### 9.3 边界

- 模板为纯数据，不执行 pack 代码；无包时 Python 等价与引文诚实降级。
- 报告引文由 Markdown 文本渲染为 `<li>` 并转义，不再内联 HTML 片段。
- 下一阶段=S5（result/RS 模块：compare/rerun/selection/interpret/cohort）。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 10. S5 收口（2026-10-21）

**S5 completed；BLOCK-234 仍 active（S6 open）。**

### 10.1 契约裁决（S5 开片先定）

Result Studio 保真核心（compare 的阈值/分类/排序语义）**不再硬编码在核心，也不降级为通用表比较**，改为
「pack 提供声明式 scientific profile，核心保留有界引擎与不变量」：

- 核心只实现 `threshold` / `status` / `ranked` 三种有界比较模式，以及稳定 ID、严格边界、`unavailable` 语义；
- pack `provides.scientificProfiles` 声明 admitted artifact、列别名、分类词表、reason 码、rerun/cohort 准入、planner 规则、selection 消费者、heavy 工具与标准解读类型；
- 无包 → `scientific_schema_not_declared_for_artifact` / 空 rerun/planner/selection/heavy，不猜测、不降级成近似统计。

理由：核心泛化表比较会丢失 volcano 分类与 DEG 阈值边界语义，触碰 RS 保真红线；profile 化可在包在位时逐字节复现现有输出，并让「哪些 artifact 可比较」成为包的单一声明。

### 10.2 交付

- **pack 0.2.6**：新增 `scientific-profiles.json`（comparisons/rerun/cohort/selectionConsumers/planner/heavyTools/interpret）+ `provides.scientificProfiles`。
- **`core/shared-backend/pack-scientific-profiles.js`**：只读有界接线（≤256KB、路径限 packRoot、分段 fail-closed、多包按 packId 稳定覆盖 + warning）。
- **compare**：`result-scientific-compare.js` 改 profile 驱动（删除 volcano/DEG 领域字面量）；`result-compare-service.js` 以 profile 判定是否执行科学比较，删除四 artifact 硬编码。
- **rerun/cohort**：`result-scientific-rerun.js` 导出 `loadRerunProfile()`；edit tool / changeset projections / cohort replay 的 root artifact、child tool、primary artifact、input id 全部改读 profile。
- **planner**：`scientific-task-planner.js` 改有界规则求值（rolesAll/questionTypes/methodCategories/originalRequest/any），规则来自 pack。
- **selection**：`result-selection-tools.js` 下游消费者注册表改 pack；新增消费者不再改核心执行链。
- **learning**：`HEAVY_TOOLS` 改 pack `heavyTools`（保留 getter 作为治理审计面）。
- **interpret**：标准分析类型词表改 pack `interpret.standardAnalysisTypes`；system/marker prompt 去领域词。
- **文案**：tool-defs（run_tool/read_page/read image/generate_methods）、query/context-edit/user-facts 去示例词；py-pool 去掉 scanpy 预导入与专用数据集缓存。
- **qualification**：`volcano_ai_presentation_edit` → `classification_plot_ai_presentation_edit`；历史 acceptance JSON 保持原样（仍按 historical/non-qualifying 分类）。

### 10.3 验证

- 域中性：**103→48 处 / 60→27 键**，0 新增/0 恶化（S5 清除 55 处、33 键）。
- 定向：block234-scientific-profiles 6/6、compare 7/7、selection 15/15、approval 14/14、planner 4/4、replay 11/11、changeset 36/36、compare service 19/19、rerun 5/5；Jev 建议追加 56/56。
- `test:changed`：**1039 项 / 1027 pass / 0 fail / 12 skip** + 前端 6 文件 26/26。
- `npm run closeout` 十三门 PASS（report 级 `skills:check` OK）。
- Jev 决策建议：`test:suggest` 建议的 6 个邻域测试已追加并全绿；`doc:suggest` 零台账建议（如实记录）。

### 10.4 边界

- 无包时 scientific compare/rerun/planner/selection/heavy/interpret 标准分支一律诚实降级，属「领域能力随包交付」，不是功能回退。
- `agent-tool-policy.js` 的 `.h5ad` 科学源扩展与 `capability-bundles.js` 的 `r-wgcna` 运行时包 ID 未下沉：前者是安全策略，后者是带哈希的下载契约，转 S6 兼容白名单裁决。
- 剩余 48 处 = **S6 前端/桌面 37 处**（office-file-preview/copilotContext/welcome/core-utils/shared-copilot/types/file-recognition）+ **兼容 11 处**（permissions/guest 4、modality 1、db schema 2、tool-policy 1、capability-bundles 3）。
- 下一阶段=S6（前端领域文案/类型收敛 + 兼容白名单裁决）。G0 开发期常态 · 不外推 packaged/Provider/GA。
