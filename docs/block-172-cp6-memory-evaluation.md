---
capability: agent-competitiveness
goal: CP-6 记忆分层与项目记忆文件的评估与实施结论——项目记忆文件（.petri/MEMORY.md）已实施（读侧有界注入+写侧走 workspace_write 治理门）；分层（episodic/semantic）与 ANN 索引评估结论落档，实施视结论另裁
acceptance:
  - 项目记忆注入实机：workspace .petri/MEMORY.md 有内容时 system prompt 出现「项目记忆」节（组件/源码契约+实机）
  - 评估文档落档：单层向量暴力扫现状（topK=3 全表扫）/分层与 ANN 选型/召回基线方法（top3 命中率测量法）
  - closeout 门禁绿
reopen: 召回质量实证低于基线或分层评估被新证据推翻时重开
status: reference
---

# BLOCK-172 CP-6 — 记忆分层评估与项目记忆文件

## 1. 已实施：项目记忆文件（.petri/MEMORY.md）

- **读侧**（agent-runner，facts 块后）：workspace 解析单源（`createWorkspaceTools().withWorkspace`）读 `.petri/MEMORY.md`，trim 后有界 6000 字符注入 system prompt「项目记忆」节；缺席/读取失败=诚实缺席。
- **写侧**：零新工具——模型用既有 `workspace_write` 写 `.petri/MEMORY.md`，继承全部治理门（sha256 乐观锁/访问档位/审计/科学源不可变）。工具指南已告知写入通道与会话级/项目级边界。
- **自有形态**：记忆文件是用户可直接打开编辑的明文（本地主权+可审计），不是竞品的黑盒向量库。

## 2. 评估落档：单层记忆 → 分层与 ANN

现状（2026-10-12 探查锚点 `helpers/memory-vectors.js:111-127`）：单层向量记忆，embedding=text-embedding-v3 1024 维，余弦**暴力全表扫**，topK=3/阈值 0.55，注入 ≤1500 字符。knowledge-space 同款暴力扫（`knowledge-space.js:45-47` chunk>50k 仅告警）。

评估结论：
1. **分层（episodic/semantic/procedural）**：当前 user-facts（每 2 条用户消息抽取）+chat-summary（滚动摘要）+memory-vectors（语义检索）事实上已是三层雏形，缺的是**生命周期**（facts 无衰减/无合并）。建议下一步=事实生命周期治理（TTL/合并去重）而非引入新存储——投资小、收益直接。
2. **ANN 索引**：暴力扫在 <50k 向量时延迟可接受（SQLite 单表），当前用户量级无需 ANN；触发条件=单库向量 >50k 或 p95 检索 >200ms 实测超标，届时选型 sqlite-vec 扩展（零新服务）。登记触发条件，不预做。
3. **召回基线方法**：构建 30 问基准集（每问标注期望命中 chunk），`top3 命中率 = 命中数/30`；分片/ANN 改动前后各跑一次对比。基线集构建随下次触碰知识域的包落地。

## 3. 非范围

ANN/分层实施（触发条件未到）、跨项目记忆共享、记忆压缩格式重设计。
