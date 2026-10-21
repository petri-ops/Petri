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
