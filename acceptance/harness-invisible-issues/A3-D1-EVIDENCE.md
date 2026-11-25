# A3-D1 注入边界 frequency_rebound 事前机械门 — 证据（2026-11-25）

> 队列 5.5 · 裁决 `docs/harness-invisible-issues-optimization-2026-11-25.md` §4b：D1=行，D2–D5=不行。
> 设计 `acceptance/harness-invisible-issues/A3-LESSON-GUARD-DESIGN.md` §3（另一 worktree 的只读 WIP，本包零触碰）。
> 独立分支 `petri-ops/codex-a3-d1-lesson`；提交留本地，push 待主人口令。G0 开发期常态 · 不外推 packaged / Provider / GA。

## §1 真源 API 核对（先读实际代码，未臆造；与方案 §3 零偏差）

| 核对项 | 真值（file:line） | 与方案一致性 |
|---|---|---|
| 频率判据纯函数 | `core/shared-backend/lesson-frequency.js:23-38` `judgeFrequency(before, after)` → `{decision:'keep'\|'degrade'\|'rollback', code, reason}`；rollback 唯一码 `frequency_rebound`（`:29-31`）；`VERIFY_RULES.owner='code'`（`:11-15`） | 一致，`degrade`=持平、`keep`=下降/零复发 |
| 频率验证入口 | `core/petri-server/helpers/lesson-store.js:140-164` `verifyLessonFrequency(fingerprint)` → `{before, after, decision, ok}`，其中 `decision` 本身就是 judgeFrequency verdict（`:158`） | 一致，故冻结条件为 `result.decision.decision === 'rollback'` |
| lesson 对象主键 | `lesson-store.js:121-129` `listActiveLessons` 返回字段含 `sourceFingerprint` / `title` / `action` / `scope` / `confidence` / `evidence` / `status`，无 `createdAt` | 一致，按 `sourceFingerprint` 取 verdict，不依赖 `createdAt` |
| 注入写入点 | `core/petri-server/agent-runner.js:321-323`（现 319-323）取 `listActiveLessons(8)` → 写 `ctxForPrompt.selfEvolutionLessons` | 一致，门落在二者之间 |
| prompt 消费点 | `core/petri-server/helpers/system-prompt.js:538-542` 经 `renderSelfEvolutionForPrompt` + `clipSection` 进动态 body | 未改动；门只在写入前过滤数组 |

结论：API 签名、verdict 嵌套结构、lesson 字段名、注入位置全部与方案 §3 相同，无偏差需回报、未自行改设计。

## §2 改动清单（仅以下 4 个文件）

| 文件 | 改动 |
|---|---|
| `core/petri-server/helpers/lesson-injection-guard.js`（新） | 纯函数 `guardLessonInjection(lessons, verifyFn)` → `{lessons, frozen}`；零 require / 零 import；仅 `rollback` 剔除并把 `{sourceFingerprint, verdict}` 随行留痕（verdict 的 `code`/`reason` 原样带出）；`degrade`/`keep`/读失败/抛错一律 fail-open 注入 |
| `core/petri-server/agent-runner.js:321-323` | 原 5 行接线改为 4 行（净 -1 行，1153→1153）：注入前调用 guard，只把 `guarded.lessons` 写入 `ctxForPrompt.selfEvolutionLessons` |
| `test/a3-d1-lesson-injection-guard.test.mjs`（新） | HK-01 14 条契约（详见 §3） |
| `test/impact-map.json` | 新增 `a3-d1-lesson-injection-guard` 规则，登记 4 个 pattern + 3 个测试，保证 `test:changed` 覆盖可复现 |

未改：`lesson-frequency.js` / `lesson-store.js` / `system-prompt.js` / `lesson-render.js` / `harness-redline.js` / `.petri/LEARNINGS.md` / `.petri/MEMORY.md` / `package.json` / 任何前端文件 / 任何 canonical 文档。

## §3 HK-01 红绿先行

测试文件 `test/a3-d1-lesson-injection-guard.test.mjs`，14 条契约：

1. rollback（frequency_rebound）→ 剔除注入，`frozen` 带 `code`/`reason` 留痕；
2. degrade（频率持平）不冻结、原样注入（D2）；
3. keep（下降 / 零复发）不冻结；
4. 混合批量只剔 rollback、其余保序；
5. 判据读失败 `ok:false` → fail-open；
6. 判据抛错 → fail-open 且不中断；
7. 空 / 非数组输入 → 零注入零冻结；
8. rollback 唯一来自 `judgeFrequency` 的 `frequency_rebound`，`VERIFY_RULES.owner='code'` 未改；
9. 真实 SQLite：`verifyLessonFrequency` 真接线下 rebound 剔除 / degrade 注入 / 两条 lesson 的 DB `status` 仍为 `active`（D3）；
10. guard 源码无 `rollbackLesson` / `UPDATE lessons` / `status=`；
11. guard 源码不触 LEARNINGS / MEMORY（D4/D5）；
12. 红线表 `owner:'code'`、`FORBIDDEN` 13 项、`FORBIDDEN_SEGMENTS` 6 项、ALLOWLIST 六项 tier 原样在场；
13. guard 零 require / 零 import（零新依赖）；
14. agent-runner 中 guard 调用早于 `selfEvolutionLessons` 赋值，且消费 `verifyLessonFrequency`。

- **RED（实现前）**：`node --test …` → **14 tests / 3 pass / 11 fail**（guard 模块 `MODULE_NOT_FOUND`，逐例红；红线表常量核真与真值判据两例本就绿）。
- **GREEN（实现后）**：**14 tests / 14 pass / 0 fail**。
- 邻域：`a3-d1…` + `evo3-verify-frequency` + `evo2-distill-evolve` 合跑 **46 tests / 46 pass / 0 fail**。

## §4 D2–D5 边界逐条声明

| # | 裁决 | 落地声明 |
|---|---|---|
| D2 | 不行（degrade 不冻） | guard 仅 `decision==='rollback'` 冻结；`degrade` 原对象原样进注入列表，不降权、不改写。契约 2/4/9 守护 |
| D3 | 不行（不改 DB status） | guard 为内存过滤，无任何 DB 写；真实 SQLite 契约 9 断言冻结后 lesson 仍 `active`。事后状态收口仍归既有 `rollbackLesson`，EVO reopen 语义未动 |
| D4 | 不行（不纳 LEARNINGS 回读） | 产品代码本无回读路径，本包未新增；guard 源码零 LEARNINGS 字符串（契约 11） |
| D5 | 不行（MEMORY 不加频率门） | `agent-runner.js` 的 MEMORY 注入段未改；guard 源码零 MEMORY 字符串（契约 11） |

另：⑤红线表 `harness-redline.js` 一字未改（契约 12）；⑥零新依赖、零外发（契约 13，guard 无任何 import；未联网、未写 AUDIT-LOG、未触发发版）。

## §5 门禁结果

| 门禁 | 结果 |
|---|---|
| `node --test`（A3 + EVO2 + EVO3 邻域） | PASS 46/46 |
| `npm run docs:check` | PASS（673 registered documents） |
| `npm run ui:audit:check` | PASS |
| `npm run quality:secret` | PASS（生产面命中 0） |
| `npm run quality:arch` | PASS（R1–R5 无违规） |
| 定向 `npx eslint`（3 个改动文件） | PASS，0 error / 0 warning |
| `npm run gate:code-size` | **红，含预存项**：`agent-runner.js` 行数维持 1153 = 基线（净 -1 行，无新增行增长），仅 sha 指纹因本包必然内容变更待重打；`WorkspaceFilePreview.tsx` 731>727 为 HEAD 预存红，与本包零相交。按同队列 A1 先例不动 `acceptance/block-92/size-baseline.json`（避免为无关预存增长登记例外） |
| `npm run quality:types` / `npm run quality:lint` | **环境阻塞，非本包红**：本机缺 `frontend/node_modules`，tsc 全仓 `TS2307`（vitest/@testing-library/react）、eslint 全仓 type-aware 解析失败；本包 3 文件定向 ESLint 0 error。未安装依赖（零新依赖纪律） |
| `npm run quality:knip:check` | **预存红**：283 处死代码新增均为存量，grep 本包文件名零命中；未改基线 |
| `npm run test:changed:list` | **预存阻塞**：`closed-batch-evidence-dirs` 引用 HEAD 即不存在的 `test/c56-user-manuscript-fidelity.test.mjs`；本包新增规则引用的测试均存在，impact-map JSON 已 `JSON.parse` 校验通过 |

根 `npm run check` / 全量 `npm run test:all:workspace` 按纪律默认不跑；未验证范围如实说明，未把定向绿表述为全量绿。

## §6 边界与纪律

- 独立分支 `petri-ops/codex-a3-d1-lesson`，主线未跟踪 WIP、A1/B4B5/B1/A5 四分支、A3 方案 worktree 全部零触碰；未启 dev 栈、未碰 owner dev 实例。
- 只改 §2 四文件；无新 npm 依赖、无模型调用、无网络/外发；不进治理链、不写 AUDIT-LOG 工作包。
- 观感零代签；G0 开发期常态 · 不外推 packaged / Provider / GA。
