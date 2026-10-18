---
capability: memory-compaction-policy
goal: BLOCK-205 = runlist W6（阶段 3 B2 之二）＝ **记忆与压缩策略面**：把 compaction 的四个常量（触发 token / 最少消息数 / 保留最近条数 / 摘要源字符预算）、记忆检索与上限（topK / 相似度阈值 / 单条与召回字符上限）、事实生命周期（auto 事实 TTL 天数 / 衰减批次上限）收进注册表族 `memory-policy`，并保持**默认值逐字等于现有常量**（未配置=零行为变化）。「记忆提取模型」只做**可寻址的只读登记**（模型 id 与向量维度绑定，改它=换实现，须单独裁决）。
acceptance:
  - P0 基线：`test/block205-memory-policy-baseline.test.mjs` 冻结九个数（12000 / 24 / 12 / 60000 / 3 / 0.55 / 1500 / 90 / 200）与只读模型 id（`text-embedding-v3`）。改实现不得改基线。
  - P1 schema：族 `memory-policy`（9 个可写标量 + 1 个 `owner:'code'` 只读标量），全部 `ui:'none'`（v1 无设置页，漂移门按 `NO_UI_FAMILIES` 登记）。
  - P2 落点：`helpers/memory-policy.js`（`memory-policy.json`，目录走 `data-paths`）：读宽容/写消毒/`compactionSettings()`/`memorySettings()`/`lifecycleSettings()`/`resetMemoryPolicy()`。
  - P3 接线：`conversation-compaction` 四处、`memory-vectors` 三处（topK/阈值/字符上限）、`memory-lifecycle` 两处（TTL 天数/批次上限）改读策略；**未配置时必须与接线前逐字节同行为**。
  - P4 写面：`GET/PUT /api/ai/memory-policy`（400 + 结构化 diagnostics）；未知键拒绝。
  - P5 收尾：`config-transfer`/`config:doctor`/漂移门三件套；**与评测基线对齐**——跑 `context_snapshot` 棘轮与 smoke/golden，若指纹变化必须显式 `--update` 重基准并在日志里留因；不变则如实记录"未变"。
  - 完成语义：参数可配 + 生效可观测（快照接口回显"生效值 vs 默认值"）；不交付设置页；不改压缩算法本身（阈值语义、KEEP 语义、衰减规则一字不动）。
reopen: 记忆/压缩设置页（表格 UI + 9223 实机腿）；提取模型的真正可换（需要向量维度迁移与重嵌入）；按项目/会话覆盖策略；压缩摘要 prompt 的可配置化。
status: completed
---

# BLOCK-205 · 阶段 3 B2 之二：记忆与压缩策略面

执行序位置=`docs/stage-3-4-execution-runlist.md` 的 **W6**（W0–W5 已 completed）。用户发令：2026-10-18「行的 冲」。

## 0. P0 勘察（实码）

| 参数 | 位置 | 现值 |
| --- | --- | --- |
| compaction 触发 tokens | `conversation-compaction.js:20` | `COMPACTION_TRIGGER_TOKENS = 12000` |
| compaction 最少消息 | `:21` | `MIN_MESSAGES = 24` |
| compaction 保留最近 | `:23` | `KEEP_RECENT = 12` |
| 摘要源字符预算 | `:25` | `SUMMARY_SOURCE_CHAR_BUDGET = 60000` |
| 记忆召回 topK / 阈值 / 字符上限 | `memory-vectors.js:64-66` | `3` / `0.55` / `1500` |
| 单条内容上限 | `:67` | `MAX_CONTENT_LEN = 1500` |
| auto 事实 TTL | `memory-lifecycle.js:17` | `90 天` |
| 衰减批次上限 | `:18` | `200` |
| 嵌入模型 | `memory-vectors.js:63` | `text-embedding-v3`（维度 1024 绑定） |

全部是模块常量：**改一个数要改代码、发版本**；也没有任何"当前生效值"的出口。

## 1. 判定：patch + 新建薄层

参数已存在、语义已确定，只需把"值从哪来"换成注册表（与 W5 同构）。压缩/衰减**算法**一字不动；不新建第二套记忆系统。

## 2. 红线

- **默认值逐字等于现有常量**（未配置=零行为变化），基线测先冻结后改实现。
- **不改阈值语义**：`sourceTokens < threshold` 与 `rows.length < MIN_MESSAGES` 的判定顺序、`KEEP_RECENT` 的取数范围、衰减规则都不动。
- **嵌入模型只登记不可写**：`owner:'code'` + 单值域；改模型=换维度=重嵌入，属 reopen。
- 不碰四档判定/审批/凭据；不新增依赖；不碰 G1+。

## 3. 落地记录（2026-10-18）

- **P0 基线**：`test/block205-memory-policy.test.mjs` 前两例冻结九个数与嵌入模型 id，并断"未配置时压缩判定与接线前一致"（12K/24 条/保留 12；判序未变）。
- **P1+P2**：schema 加 `memory-policy` 族（9 可写标量 + `embeddingModel` 只读）⇒ 注册表 **14 族 / 75 键**；`helpers/memory-policy.js`（`memory-policy.json` 走 `data-paths`；`DEFAULTS` 逐字等于原常量；`effectiveSnapshot()` 给出"生效值 + 来源"）。
- **P3 接线九处**：compaction 4（阈值/最少条数/保留条数/摘要预算）、`memory-vectors` 3（topK/阈值/字符上限）、`memory-lifecycle` 2（TTL 天数/批次上限）；常量降级为"基线声明处引用"，运行时不参与判定。
- **P4 写面**：`GET/PUT /api/ai/memory-policy`（400 + diagnostics；未知键/越界/只读键三分类）。
- **P5 收尾与评测基线对齐**：`config-transfer` 扩族（导入走落点纯校验 `validatePatch`）、`config:doctor` 纳入、漂移门 `NO_UI_FAMILIES` 登记。
  - **`context_snapshot` 棘轮 7/7 通过 = 指纹未变**（默认值逐字等于常量，prompt 组装形状不变）；`npm run evals:gate`：smoke/mock 回归 0 · 改善 0 · 新任务 0。故本包**不需要重基准**，如实记录"未变"。
- **抓真两处**：①`compactConversationNow` 里我引入的 `settings` 只存在于 `planCompaction` 作用域 → `ReferenceError`，被既有 compaction 测当场抓到（补上独立 `const settings`）；②`SUMMARY_SOURCE_CHAR_BUDGET` 变成未使用常量 → lint 抓到，删除。
