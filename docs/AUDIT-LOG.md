# 审计广播台 (AUDIT-LOG)

> **本文件是所有非主线 agent（审计/辅助 agent）向主 agent 广播发现的唯一入口。**
> 主 agent 每次会话开始时，**必须先读本文件**，处理其中 🔴 待处理项，再开始主线工作。
> 非主 agent 每次完成审计后，必须把发现追加到本文件并提交。
>
> 维护方：非主 agent（只读审计 + 阻断性回归修复通道）
> 最后更新：2026-07-17

---

## 当前待处理项（主 agent 请优先看这里）

| 状态 | 日期 | 发现 | 来源 | 详情 |
|------|------|------|------|------|
| 🟡建议 | 2026-07-17 | `conversations.js:5` 等模块头注释陈旧，仍写 `process.env.DEEPSEEK_API_KEY` 但代码已走 ModelGateway | 审计报告 | [§1.1 问题A](#问题-a模块头注释陈旧) |
| 🟡建议 | 2026-07-17 | `ai-admin.js:207` 成本估算硬编码 `deepseek-chat`，切换 Provider 后成本不准 | 审计报告 | [§1.2 问题B](#问题-b成本估算硬编码-deepseek-chat) |
| 🟡建议 | 2026-07-17 | `ai-agent.js:123` 兼容期仍从 `getApiKey()` 拿明文 key 传给 Gateway | 审计报告 | [§1.3 问题C](#问题-c兼容期-apikeyoverride) |
| 🟢待合并 | 2026-07-17 | `fix/qa-smoke-stale-css-paths` 分支待合并，零冲突 | 分支备忘录 | [§2.1](#21-fixqa-smoke-stale-css-paths-) |
| 🟡待评估 | 2026-07-17 | `codex/fix-collapsed-right-titlebar` 分支待评估，三文件两边改过 | 分支备忘录 | [§2.2](#22-codexfix-collapsed-right-titlebar-) |
| ⚪可清理 | 2026-07-17 | 5 个 codex/* 已合并残留分支可删除 | 分支备忘录 | [§2.3](#23-已合并残留分支可安全删除-) |

**状态图例**：🔴 阻塞验收必须处理 | 🟡 建议处理不阻塞 | 🟢 待合并零风险 | ⚪ 可清理 | ✅ 已处理

---

## §1 Stage 2 验收审计发现（2026-07-17）

> 详细报告见 `docs/stage2-acceptance-audit.md`
> 审计结论：6 项验收清单中 5 项代码层通过，1 项待实机验收。无阻塞级问题。

### 问题 A：模块头注释陈旧

- **位置**：`core/r-server/helpers/conversations.js:5`、`core/r-server/helpers/user-facts.js`
- **现象**：注释仍写 `process.env.DEEPSEEK_API_KEY`，实际代码已走 `callModelTask()` -> ModelGateway
- **建议**：主 agent 清理注释，避免误导后续审计。优先级低。
- **对验收影响**：无（不影响功能）

### 问题 B：成本估算硬编码 deepseek-chat

- **位置**：`core/r-server/helpers/ai-admin.js:207,209`
- **现象**：成本估算硬编码 `deepseek-chat` 作为默认模型
- **建议**：让成本估算读取当前绑定的模型。优先级中。
- **对验收影响**：无（不影响模型调用路径）

### 问题 C：兼容期 apiKeyOverride

- **位置**：`core/r-server/routes/ai-agent.js:123`
- **现象**：仍通过 `getApiKey(providerName)` 拿明文 key 作为 `apiKeyOverride` 传给兼容层
- **判定**：MODEL-1 兼容期设计的预期行为，最终 dispatch 仍由 Gateway 负责。不阻塞验收。
- **建议**：MODEL-1 收尾时考虑改为 `profileId` 路由。优先级低（兼容期可接受）。
- **对验收影响**：无

---

## §2 并行分支待合并（2026-07-17）

> 详细备忘录见 `docs/branch-handoff.md`

### §2.1 fix/qa-smoke-stale-css-paths 🟢

- **提交**：`ce1f054`
- **改动**：`scripts/qa-smoke.mjs`（2 行删除）
- **合并方式**：`git merge fix/qa-smoke-stale-css-paths`
- **风险**：零冲突，与 MODEL 文件零重叠
- **合并时机**：任何时候，建议尽快让门禁恢复绿色

### §2.2 codex/fix-collapsed-right-titlebar 🟡

- **提交**：`23705a3`
- **改动**：3 文件（TitleBar.module.css、TitleBar.tsx、project-workspace.tsx）
- **风险**：无文本冲突，但三文件两边都改过，有语义冲突风险
- **合并方式**：建议先 `git diff main...codex/fix-collapsed-right-titlebar` review，确认功能是否已被 main 的 minimal 版本覆盖
- **合并时机**：人工 review 后

### §2.3 已合并残留分支可安全删除 ⚪

```bash
git branch -D codex/fix-collapsed-right-titlebar-minimal \
             codex/fix-external-webview-height \
             codex/restore-user-avatar \
             codex/restore-user-chat-bubble \
             codex/theme-linked-panels
```

---

## 审计发现追加规范

非主 agent 完成新审计后，按以下格式追加到"当前待处理项"表格：

```
| 状态 | 日期 | 简述 | 来源 | 详情锚点 |
```

- **状态**：🔴/🟡/🟢/⚪/✅
- **来源**：审计报告文件名或"分支备忘录"
- **详情锚点**：指向本文件下方的详细小节

每条新增发现同时在下方新建小节记录详情。已处理的条目状态改为 ✅ 并保留，不删除（供追溯）。

---

## 处理记录

| 日期 | 处理内容 | 处理方 |
|------|---------|--------|
| 2026-07-17 | 建立审计广播台，汇总 Stage 2 验收审计 + 分支备忘录的发现 | 非主 agent |
