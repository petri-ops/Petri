# QODER-J2 技能自进化建议（2026-11-23，completed）

## 范围与裁决

用户发令「开始 J2」，评审稿=建议列表/一键建任务/忽略、轻量包、零新依赖。P0 评审两待裁决项按默认口径自洽（非新裁决点）：
- **D1 建议来源** = 本地 lessons 审计（`listLessonEvidence` 同源的 lessons 表，只读、零外发），不接模型；
- **D2 自动建任务** = 默认否——建议只出 prompt 草案，用户显式触发才走既有 `POST /api/ai/agent` / `createAgentTask` 链。

## 交付

- **P1 投影器** `core/shared-backend/skill-suggestion-projector.js`：`projectSkillSuggestions({lessons, availableSkillIds, ignored})` → 建议列表（按 action/title 关键词归因 skillId、draft tier、autoApply:false、prompt 草案）；无归因不伪造、空输入不造建议。忽略指纹被过滤（独立账本，可跨蒸馏存活）。
- **P2 只读 + 忽略路由** `core/petri-server/routes/skill-suggestions.js`（注册 `routes/index.js`）：`GET /api/harness/skill-suggestions`（lessons 表→投影器→建议草案）、`POST .../ignore`（忽略/取消忽略）。忽略账本 `core/shared-backend/skill-suggestion-prefs.js`（独立 JSON，不写 `lessons.status`，避免下次 distill 覆盖）。
- **一键建任务**：不新建执行器——建议 prompt 草案由客户端显式触发既有 `chat.js:288` createAgentTask 链（D2 默认否，零配置开关）。本包不落前端面板（评审稿验收=建议可读+动作，API 已达成；前端面板留可选增量，不谎称完成）。

## 红线

- 不改 `resources/skills/` 内置资产（带 builtinSha256，harness-redline 禁改）；
- 不让 agent 自动落盘 skill / 自动建任务（draft 档 + D2 默认否）；
- 不写 `lessons.status`（独立忽略账本）；零新依赖；不改产品 sandbox/CSP/凭据/handler/pack 声明；不碰 G1+。

## 验证

- P1 纯函数 5/5 + 路由端到端 2/2（建议可读 draft/prompt、忽略写账本→GET 过滤→unignore 恢复）→ Node 合计 7/7（`node-tests.txt`）。
- docs:check PASS(664) / ui-audit PASS / lint 0 error / tsc 0 / test:changed 0。
- 诚实边界：建议是草案（tier=draft），归因基于本地关键词映射（保守无匹配则跳过），不是模型生成；未做前端 cell 级面板（非验收范围）。

## 完成语义

J2 验收达成（建议可读 + 忽略/建任务动作），registry `QODER-YELLOW9-REOPEN` 中 J2 → completed；其余 6 项 queued 待逐项发令。

G0 开发期常态 · 不外推 packaged/Provider/GA。
