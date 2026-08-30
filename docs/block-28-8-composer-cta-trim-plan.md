# BLOCK-28.8-COMPOSER-CTA-TRIM — 聊天输入区移除「排队/停止生成」按钮 Plan

- **Plan ID**: `BLOCK-28.8-COMPOSER-CTA-TRIM`（用户反馈驱动，2026-08-30）
- **状态**: `completed`（2026-08-30 收口：tsc 0 / copilot vitest 179/179 / ui:audit:check / docs:check；CDP 回归通过，证据 `acceptance/ui-217/`）
- **truthDomain**: `block-28-composer-cta-trim`
- **阶段**: 单 PHASE（UI-217）实施 + CDP 取证 + 收口
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 用户反馈（2026-08-30）

「会话任务启动的时候会出现停止生成这个按钮，我觉得这个停止生成和左边那个按钮
（排队）是没有必要的，你看看能否取消掉。」

附带澄清（同日问题 1）：「完全访问 / 只读模式」访问模式选择器**真实生效**——
链路 SimpleChat accessMode → 请求 context.accessMode → 后端
`agent-tool-policy.js`（mutating 操作 read 模式拒绝）、`workspace-tools.js`
写工具检查、`agent-execution-policy.js`（缺省 read）权威执行；前端另有
`accessModeValidator` 预检与只读模式 ApprovalCard 确认。本轮不改代码，仅澄清。

## 2. 方案（单 PHASE，UI-217）

- SimpleChat composer：删除流式态的 `sc-send-cta-queue`（排队）与
  `sc-send-cta-stop`（停止生成）两个按钮及 `queueCurrentPrompt` 包装、
  「已排队 N 条」角标；流式期间保留唯一发送按钮（禁用态，title「任务进行中…」）。
- `stop` / `queue` 能力保留在 useChatStream（不破坏 hook 契约），仅移除按钮入口；
  需要时可用事件/快捷键恢复。
- CSS：清理 `.sc-send-cta-stop` / `.sc-send-cta-queue` / `.sc-queued-count` 规则。

**非范围**：0 新增 IPC / 0 新依赖 / queuedPrompts 排水机制保留 / G1+ 不外推。

## 3. 门禁

tsc 0 / copilot 定向 vitest 179/179 / ui:audit:check / docs:check；
CDP 断言（stop/queue/queued-count 计数=0、唯一 send 按钮、访问选择器在位、
改动卡片干净树隐藏），截图落 `acceptance/ui-217/`。
G0 开发期常态 · 不外推 packaged/Provider/GA.
