---
capability: prompt-cache-prefix
goal: BLOCK-212 ＝ **提示词缓存前缀优化**：把"每轮都可能变的动态上下文"从 system prompt **头部**挪到消息**尾部**，让静态前缀跨轮逐字节恒定（所有家的 prompt cache 都是前缀缓存，头部一改整段作废）；并为 Anthropic 补显式 `cache_control` 断点（Claude 不标就全价）。**不改协议语义、不改计费口径、不动 G1+**。
acceptance:
  - P0 基线：`test/block212-prompt-prefix.test.mjs` 冻结四件事——①静态前缀跨任意 context **逐字节恒定**；②动态上下文**不再出现在 system 头部**（`buildSystemPromptParts().staticPrefix` 不含项目/结果/Harness 摘要）；③动态上下文在消息链里**恰好出现一次**且在尾部；④既有公开 API（`buildSystemPrompt`/`buildSystemPromptSections`）行为不变（下游 38 个提示邻域断言不受影响）。
  - P1 拆分与搬运：`system-prompt.js` 新增 `buildSystemPromptParts()`（`{staticPrefix, dynamicContext}`）；`agent-runner` 的 `fullMessages` 改成 `[staticPrefix] + 历史 + [dynamicContext 尾块]`。
  - P2 Anthropic 断点：`llm-providers/protocol-conversion.js` 在 anthropic 分支把 system 发成 **block 数组**，静态段打 `cache_control:{type:'ephemeral'}`，动态段不打（避免每次写缓存）。**只对 anthropic 生效**；DeepSeek/OpenAI 保持字符串（它们自动前缀缓存）。
  - P3 度量：`scripts/block95-b3-cache-baseline.cjs` 增加"静态前缀字符/token 数"与"命中率阈值"两列，报告可复跑（不自动改库）。
  - P4 收尾：closeout 十三门；台账（如有 UI 变化则 UI-###）；`docs:check` 通过。
  - 完成语义：**能证明"前缀稳定性提升了"，但不声称"真实 API 命中率提升 X%"**——真实命中率需要 Provider 真实调用，属 G1+；本包只做离线可证的形状与稳定性。
reopen: 真实 Provider 命中率 A/B（需 G1+ 调用预算）；DeepSeek 磁盘缓存 TTL 适配；tools schema 序列化字节稳定性断言；跨会话（多轮 compaction 后）前缀桥接。
status: active
---

# BLOCK-212 · 提示词缓存前缀优化

立项发令：2026-10-18「可以 立BLOCK-212开整」（承接用户提问"prompt 缓存有什么处理/怎么优化提示词提交降成本"）。

## 0. P0 勘察结论（读码，非猜测）

| 层 | 现状 | 证据 |
| --- | --- | --- |
| 分层 | 静态模板有 `STATIC_CACHE` + `invalidateStaticCache`，动态段**追加在静态 base 之后** | `core/petri-server/helpers/system-prompt.js:409/466`；`test/block198-prompt-layering.test.mjs` 断"静态前缀跨 context 逐字节恒定" |
| 计量 | 四家 cache 字段归一（Anthropic `cache_read_input_tokens` / DeepSeek `prompt_cache_hit_tokens` / OpenAI `prompt_tokens_details.cached_tokens`）→ `ai_usage` → `/api/ai/usage` 算 `cache_hit_rate` | `llm-providers/protocol-usage.js:13`；`routes/ai-misc.js:64` |
| 基线 | 按 provider/model 出命中率 + "cache 断链"告警，可复跑 | `scripts/block95-b3-cache-baseline.cjs` |
| **缺口①** | 动态上下文（项目数据集/分析历史/结果摘要）**在 system prompt 里**，而 system 是消息链第一条 ⇒ 每轮一变，**整个前缀作废** | `agent-runner.js:749` `[{role:'system', content: systemPrompt}, ...messages]` |
| **缺口②** | Anthropic 无 `cache_control`：system 被拼成**一个字符串**发出，Claude 不标断点=全价 | `protocol-conversion.js:93`（`result.system = systemParts.join('\n')`）；`llm-providers/` 全目录 grep `cache_control|ephemeral` 零命中 |

## 1. 方案取舍：为什么搬"尾部"而不是"按段拆分打点"

- 所有家都是**前缀**缓存：能复用的是"从第一个字节开始连续相同的部分"。
- 动态段放**头**：任何变化 ⇒ 0 复用（现状）。
- 动态段放**历史之前、头之后**：头可复用，但**上一轮注入的位置**会污染下一轮历史，除非把注入写进历史（改动存储语义，风险大）。
- 动态段放**最后一条 user 之后**：历史保持"干净的 append-only"，注入不落历史 ⇒ 下一轮的前缀=静态头+干净历史，**逐轮增长且完全可复用**；只有尾部小段是新的。**本包选这条。**

## 2. 红线

- **不改** `buildSystemPrompt`/`buildSystemPromptSections` 的公开行为（38 个提示邻域断言依赖它）；只新增 parts API 并让传输层用它。
- **不改**协议语义（动态上下文仍以 system 角色出现、内容一字不改，只是位置变了）。
- **不碰** DeepSeek/OpenAI 的字符串 system（它们自动前缀缓存）；Anthropic 的 block 化只在 anthropic 分支。
- 不声称真实命中率提升（G1+ 才可测）；只证"前缀字节稳定 + 动态不在头部 + 断点形状正确"。

## 3. 落地记录（2026-10-18）

- **P1 拆分与搬运**：`system-prompt.js` 新增 `buildSystemPromptParts()`（`{staticPrefix, dynamicContext}`，按 `sections.base` 长度切分）；新增纯函数 `helpers/prompt-assembly.js` 的 `assembleMessages()`；`agent-runner` 的 `fullMessages` 改为「静态前缀 + 历史 + 动态尾块」。后续追加（知识注入/桌面指令/驻留交接）都是**后缀**，所以函数尾部的切分点仍然正确。
- **P2 Anthropic 断点**：`openAIToAnthropicRequest` 把 system 发成 block 数组，**只有第一条（静态段）**打 `cache_control:{type:'ephemeral'}`，动态段不打（否则每轮写新缓存更贵）；单条 system 也带断点。
- **P3 度量**：`block95-b3-cache-baseline.cjs` 增 `staticPrefix.staticPrefixChars/staticPrefixTokensApprox` 与 `overall.hitRateThreshold/belowThreshold`（阈值 `PETRI_CACHE_HIT_THRESHOLD`，默认 0.3，只报告不阻断）。本机实跑：**静态前缀 643 字符 ≈ 215 tokens**；命中率 83.33%（11k/13.2k，17 次调用，dev 库样本）。
- **P4 证据**：`test/block212-prompt-prefix.test.mjs` **7/7**（逐字节恒定 / 动态不在头部 / 旧 API 行为不变 / 尾块恰好一次 / anthropic block 断点 / 单条 system 不退化 / **离线前缀复用量化**：长历史下 >90% vs 旧布局 <20%）；提示与 Provider 邻域 **52/52**（含三个按新契约更新的既有断言：anthropic-provider / provider-protocol / block93）。

## 4. 两条如实登记的局限（不吹）

- **静态前缀 215 tokens < Anthropic 最小可缓存长度（1024）** ⇒ 当前 `cache_control` 在 Claude 上**是空操作**（Anthropic 会忽略断点）。真正的杠杆在本包 P1：DeepSeek/OpenAI 走**自动前缀缓存**，前缀稳定即刻生效。要让 Claude 吃到，得把断点打在**最后一个 tool 定义**上（工具 schema 体量大），但那要求 tools 跨轮稳定——列入 reopen。
- **不声称真实命中率提升**：本机 83.33% 是 dev 库既有样本（含 mock 渠道），不是本包前后对比；真实 A/B 需 Provider 真实调用（G1+）。本包能证的只有「前缀字节稳定性 + 尾块布局 + 断点形状」。
