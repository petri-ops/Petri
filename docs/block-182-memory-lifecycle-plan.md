---
capability: agent-competitiveness
goal: BLOCK-182 记忆生命周期治理——user_facts 事实衰减/用户纠错流/矛盾消解/全链审计四件（CP-6 评估结论的直接承接），设计裁决=纠错免费、（模型）记忆写入过审批门
acceptance:
  - 生命周期字段落地：user_facts 加 status/superseded_by/last_confirmed_at（additive 迁移），active 之外状态不进 system prompt 注入
  - 惰性衰减：TTL 未确认自动事实转 decayed（pinned 永不衰减），读路径惰性触发（同 BLOCK-180 审批资源模式）
  - 纠错流：用户 PUT 修改=旧事实标 superseded+新事实插入（链可追溯，不原地覆盖丢历史），免费直生效
  - 抽取矛盾消解：auto 抽取同类别规范化等值内容=合并（更新正文+刷新 last_confirmed_at）而非新增重复行
  - 全链审计：memory_audit 表记 extract_write/merge/correction/supersede/decay/clear 六动作，GET 审计面可查
  - 模型记忆写入审批门：workspace_write/replace 命中 .petri/MEMORY.md → 动态防护 memory: 维度 require-ack（走 BLOCK-180 审批卡全链）
  - 实机探针：隔离后端+mock provider 审批链+facts 纠错流全链 PASS；closeout 门禁绿
reopen: 衰减 TTL 参数需按真实使用节奏重校准，或分层（episodic/semantic）触发条件达成时重开
status: completed
---

> **收口（2026-10-14 当日立项当日收口）**：红绿 6/6（test/memory-lifecycle.test.mjs）+实机三链 PASS（scripts/block182-live.mjs：审批门 deny→ack→真实写入/纠错 superseded 链/惰性衰减）+UI-510 live 在场（acceptance/block-182/ui510-live.json）；抓真=迁移时点 user_facts 未建（列升级挂运行时 ensureLifecycleColumns）+探针 mock env 须先于后端 spawn。

# BLOCK-182 — 记忆生命周期治理

## 1. 背景（P0 勘察结论）

记忆系统四通道现状（2026-10-14 勘察）：
1. **user_facts**（USER_FACTS_v1）：每 2 条用户消息后台抽取（`backgroundExtractFacts`），REST CRUD，`buildFactsBlock` 注入 system prompt——**无衰减/无合并/无状态**，矛盾事实无限累积。
2. **.petri/MEMORY.md**（CP-6）：读侧有界注入 6000 字符；写侧=模型 workspace_write（已过 sha256 乐观锁等治理门，但**无记忆特有审批**）。
3. **memory_vectors**：语义向量记忆（暴力扫，CP-6 评估维持）。
4. **memory-privacy.js**：脱敏层。

CP-6 评估结论（docs/block-172-cp6-memory-evaluation.md）：「缺的是生命周期（facts 无衰减/无合并）。建议下一步=事实生命周期治理（TTL/合并去重）」——本包即其承接。

## 2. 设计（用户裁决锚点：纠错免费、写入过审批门）

- **衰减**：`status='decayed'` + 惰性触发（读/写路径顺手扫，不引入后台任务）；TTL=90 天未确认的 `source='auto'` 事实；pinned/手动事实（source='manual'）永不衰减。decayed 事实保留在库（可审计、可复活=手动 pin）但不进注入。
- **纠错流（免费）**：用户经 MemoryPanel/PUT 修改事实内容 → 旧事实 `status='superseded', superseded_by=<新id>`，新事实插入立即生效——不原地覆盖，替代链可追溯。无审批门（用户自身动作）。
- **矛盾消解（确定性 v1）**：抽取写入前按 `category+规范化内容` 等值合并（更新正文+刷新 last_confirmed_at+审计 merge）；语义级矛盾检测不做（LLM 判定非确定性，登记不做），由纠错流承接用户显式纠正。
- **写入过审批门**：`evaluateDynamicGuards` 新增 memory 维度——workspace_write/replace 目标为 `.petri/MEMORY.md` 时 flag `guardKey=memory:<path>` → require-ack（复用 BLOCK-180 审批资源/审批卡/指纹放行全链，零新设施）。用户 REST/面板通道不经此门。
- **全链审计**：`memory_audit(id, user_id, actor, action, fact_id, detail_json, created_at)`；六动作=extract_write/merge/correction/supersede/decay/clear；actor ∈ system/user/model。

## 3. 非范围

ANN/分层存储（CP-6 触发条件未到）、语义矛盾 LLM 判定、跨项目记忆共享、memory_vectors 生命周期（仅 user_facts 本包）、MEMORY.md 内容格式重设计。

## 4. 实施切片

- P1 迁移+生命周期 helper（memory-lifecycle.js 单源：decayed 扫描/合并/替代/审计）+ user-facts 接线
- P2 policy memory 维度 + ai-memory 路由（facts 带 status、GET /api/ai/memory-audit、PUT 纠错语义）
- P3 MemoryPanel 状态徽章+审计最近列表（最小面）
- P4 红绿测试（隔离 DB）+ 实机探针（隔离后端+mock provider）+ closeout

## 5. 验证判据

- 红绿：test/memory-lifecycle.test.mjs（衰减/合并/替代/审计/注入过滤）+ test/block182-policy-memory.test.mjs（memory 维度 flag/ack 放行/指纹放行）
- 实机：scripts/block182-live.mjs——①mock provider 调 workspace_write .petri/MEMORY.md → deny 信封 memory guardKey → guard-ack 放行 → 真实写入；②facts PUT 纠错 → superseded 链+审计；③decay 惰性触发
- 门禁：test:changed + docs/ui-audit + quality 四门
