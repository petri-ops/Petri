# 最终清扫：剩余一次列全 + 推完（2026-11-23）

## 用户发令

「后面还有哪些内容，能一次性搞定吗」——现读 canonical 后一次列全，把能自推的全部推完。

## 现读结论（三类）

**① 真代码待办只剩 L6 写路由**（🟡9 其余五项已在前批完成集成）——本批推完。

**② 状态归位（机械对齐，无产品语义）**——本批推完：
- 母纲 `qoder-essence-absorption-plan.md`：§5 统计 `✅86·🟡9·🔴0·⛔7` → `✅95·🟡0·🔴0·⛔7`；Q-MATRIX 9 行（A2/E12/J2/J4/J6/L1/L2/L5/L6）🟡→✅，每行带证据注记与诚实边界（L5 非完全沙箱化、L1/L2 authority 只透传、J2 前端面板留增量）。
- backlog `QODER-REM` 行过时计数 `✅72/🟡22` 现读纠正为 `✅95/🟡0` 并注明九项完成。
- `qoder-yellow9-reopen-review.md` frontmatter `active/P0-LAUNCH` → `completed/CLOSED`；DOC-REGISTRY 同条目同步。
- UI 台账 `UI-720`/`UI-721` in_progress → **verified**（Agent 判据类审定）：两条自述"行为/可访问性/导航权限面、非观感签字项"，证据齐（UI-721 组件 15/15+路由 2/2；UI-720 HK-01 4/4 + A/B 1→0 + P6 全链 passed=true 清偿旧留因），无观感改动需用户签。

**③ 等用户/不可代行**（如实列出，不推）：
- C-56 真实稿件改写（等用户给稿件路径；合成夹具演练已备，不伪造论文）；
- 观感签字槽（其余 pending_human_eye 项，零代签纪律）；
- 外部/平台条件（macOS sidecar、签名证书、i18n 决策等，deferred 不阻塞 G0）；
- C-47 文件树修复方向 A/B 待裁决、C-50 场景裁决——均等发令。

## 本批代码交付

- `core/petri-server/routes/plugin-lifecycle-audit.js`：GET `/api/harness/plugin-audit` 只读统一投影（trust-audit.jsonl + 本模块 JSONL，投影像不承载信任真源）+ POST `/api/harness/plugin-audit/append` 追加 JSONL（经 P1 `formatAuditEvent` 脱敏）。注册 `routes/index.js`。不读写凭据、不改 guard-ack/信任写 handler、不覆盖既有 JSONL。

## 验证

- L6 写路由 HK-01 9/9 + 端到端 2/2 + P1 核心 5/5 → Node 11/11（`node-tests.txt`）。
- docs:check PASS(664) / ui-audit PASS / lint 0 error / tsc 0 / test:changed 0。
- 串行槽位现读为空（DOC-Registry 无 status=planned/active 的 work-package）——代码层面可自推项已全部完成。

G0 开发期常态 · 不外推 packaged/Provider/GA。
