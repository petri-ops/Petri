# 审计广播台历史归档 · through 2026-11-01

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（BLOCK-170 自稳设计；
> 活跃台只留「最后更新」链最近 8 条，本档=被淘汰链行原文追加，搬移不改写）。
> 状态与完成语义以 canonical 文档（roadmap/plan/DOC-REGISTRY）为准，本档仅作广播历史追溯。

最后更新：2026-11-01（**BLOCK-323-PROGRESSIVE-AUTONOMY completed + UI-655 verified（2026-11-01 当日立项当日收口；用户裁决「行 规划好 开整吧」+「开整」补腿令）**：放权坡道——规则/工具层 observe 中间档（命中只记录不执行）+ 本地复盘人工升级 allow + policy_observations UPSERT 合并表 + PolicyReviewBridge 通知；四条红线全守住（坡道终点复用既有 allow 不发明 auto 档/升级永远人工/判定序六层安全地板不变/不建第二执行器）。证据=契约 8/8 + 前端 6/6 + 邻域回归 29/29 + 后端实机 `acceptance/block-323/block323-observe-live.json` 13/13 + **UI 离屏实机 `block323-observe-ui-live.json` 20/20**（`/settings?section=decisions` 深链→四档→待复盘行→真实点击升级放行 + REST 同后端对账→任务2 自动执行+审计行→标复盘清空→重载双区可见→亮/暗截图）+ closeout 十三门 PASS（`1699ce6b`）。**实机抓真三处均修**：①探针缺 `context.projectId` 致 exec `project_required`（B 腿假绿被 A 腿暴露）；②**flow 模块顶层固化 `PETRI_B323_API`（wrapper require 先于设 env）→ REST 误落 ：3001 用户活后端**——页内/REST 双通道对比定位；误建 3 任务（均 failed 终态、未执行 npm）+3 会话**已清偿**（DELETE ok×3）；教训=flow 读 wrapper 注入 env 必须运行时取；③lint 7 个 unsafe-any（Array.isArray 收窄 ReadonlyArray→any[]）。决策工具面如实记录：doc:suggest/next:suggest/output:judge 本轮均 `jev_unavailable:no_key`（用户密钥暂缺，2026-10-30 🟡 在案）。plan=docs/block-323-progressive-autonomy-plan.md。G0 开发期常态 · 不外推 packaged/Provider/GA。）

<!-- audit-log-compact.mjs 追加 @ 2026-11-02T06:01:47.399Z -->
最后更新：2026-11-01（**BLOCK-325-MODEL-SURFACE-BUDGET 启动登记（active；用户裁决「很棒 继续」）**：模型可见面尺寸预算 CI 门禁——系统提示/工具定义字面量与工具数基线棘轮（任何增长即红，--update 下调需说明）+ 核心面退役词扫描；基线 test/model-surface-baselines.json；pack 注入内容不在扫描面（合法域扩展通道）。plan=docs/block-325-model-surface-budget-plan.md。G0 开发期常态 · 不外推 packaged/Provider/GA。）
最后更新：2026-11-01（**BLOCK-324-REASON-TAXONOMY 启动登记（active；用户裁决「开整」）**：统一结构化原因码 taxonomy——封闭 REASONS 注册表 + renderReason + 源码扫描机械锁（新增未注册即红）；第一批=治理/审批族归并；GET /api/ai/reason-codes 词表出口；加性接线零行为变更；decision_log 自由文本不归并（reopen）。plan=docs/block-324-reason-taxonomy-plan.md。G0 开发期常态 · 不外推 packaged/Provider/GA。）
