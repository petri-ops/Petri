# BLOCK-449 收口笔录 · M 程序 9223 实机补腿 + 干净树三连收口

**终态：`completed`（registry 已翻态）· 日期 2026-11-14 · HEAD `29cbf478`（门禁期）→ 收口提交**

## 目标与范围

M 程序（第六轮 M0–M7）唯二未达证据上限项——M7 §8 第 3 条（干净树三连全门 PASS 0 SKIP）与第 5 条（长任务自证包 9223 离屏实机腿）——当次补腿收口。四任务串行：T1 红清账 → T2 9223 实机腿 → T3 closeout:full 三连 → T4 回写。发令链 = 用户主控提示词 v1.0（一次性完整发令与预授权裁决）+ AGENTS.md 预授权连续工作除外条款 + Jev 不可用确定性兜底（选型对账见 `s0-fact-baseline.json` selectionEvidence）。

## 证据与结果

| 任务 | 终态 | 关键读数（当次） |
| --- | --- | --- |
| T1 红清账 | done | test:changed 43/43；三历史红重归因：UI-629 17/17、P6 指纹 13/13、block414 4/4（活栈条件绿）、center 锚 3/3 |
| T2 实机腿 | done | flow `m7-longtask-resume-live` run6 **31/31 allPass**：9223 离屏实例（禁 PETRI_TEST_ONSCREEN、跑完 kill 残留 pid=null）+ 真 agent loop + SIGKILL 崩溃注入 → 同库重启 → 产品 resume 路由（预览摘要逐字含 workspace_read / task_resumed 链接 / 续跑 done / 无重复工具调用 / finalText 逐字 / 消息前缀逐字对齐）+ 截图 142505B |
| T3 三连 | done | `closeout:full` run1/2/3 全 PASS（20 门 + skills:check，门禁级 SKIP=0，test:changed 70 面 0 fail） |
| T4 回写 | done | registry/roadmap/handoff/M 台账增量/AUDIT-LOG/README 六件套 + docs:check 587 PASS + docs:reconcile 0 issues |

**抓真修复（各有红绿锚）**：
1. `2a40bf7f` — evals-harness 同库二次 spawn 重放非幂等迁移必抛 duplicate column（崩溃→重启场景全域受益；回归=test/evals-harness.test.mjs 15/15）。
2. `14353c78` — **resume 路由冲突 P1**：team.js（BLOCK-249 暂停/恢复，先注册）与 resume.js（BLOCK-38 中断续跑，后注册）同路径 POST `/api/ai/agent/task/:taskId/resume`，Express 先注册先赢 → 中断续跑在生产面被 not_paused 409 全量遮蔽。修复=非 paused 态 `next()` 让位（任务态互斥，零前端改动）；回归锚 test/agent-task-resume-route-disambiguation.test.mjs 4/4（红证据=修复前 B/C/D 三红）。
3. `29cbf478` — knip 动态入口注册（ui-d2/ui-d4 先例）；perf 基线 B2 重绑（阈值/容差零改动，block350 15/15 + 5 连采样 PASS）。

## 未达项与补腿

| 项 | 终态 | 补腿条件 |
| --- | --- | --- |
| P6 pressure 腿重采 | `external-blocked` | r-enrichment capability bundle 分发恢复（当次 probe 2026-11-14T10:47:48Z 仍 HTTP 404）→ 重跑 `npm run g0:result-studio:p6:update` → closeout:full；原册 `acceptance/block-448/p6-pressure-blocked.json` |
| UI 会话自动打开逐字断言 | scope-limited（如实登记） | 如需 UI 渲染逐字证据，另行扩展 flow 以 UI 显式打开会话（产品行为面）；当次对齐断言由持久化事实承载 |

## 边界声明

- provider=mock（本地 SSE）：本腿测崩溃→重启→resume 机制链与路由语义，不是模型质量（五类证据不互冒充；真实任务成功类未声明）。
- M7 原档（m7-evidence.json fiveItems）零触碰；M 台账增量行指向新证据。
- 12 项 untracked 用户资产/受保护原件零触碰、零提交；`docs/post-h9-optimization-blueprint-2026-11-10.md` 维持受保护未跟踪（registry notes 契约）。
- M2-4-db UNIQUE 约束（perf 重采另案）、G1+ 全部事项不在范围。

## 复跑命令

```
npm run verify -- m7-longtask-resume-live        # 实机腿（前置 vite :3000；flow 自管隔离栈）
node --test --test-force-exit test/agent-task-resume-route-disambiguation.test.mjs
node --test test/m7-longtask-resume-live-flow.test.mjs
node --test test/evals-harness.test.mjs
npm run closeout:full                            # 三连（当次 3/3 全绿）
npm run docs:check && npm run docs:reconcile
npm run decision:session                         # jev×0 本轮 · 累计 344（当次取数）
```

证据目录：`acceptance/block-449/`（s0…s5 / CLOSEOUT / DELIVERABLES / evidence/）。收口门禁：`npm run closeout:full` 三连全绿当次在册。

G0 开发期常态 · 不外推 packaged/Provider/GA。
