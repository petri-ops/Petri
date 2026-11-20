---
capability: evo-harness-self-evolution
status: completed
phase: EVO-0-CLOSED
goal: 让 Petri 内嵌的 agent harness 在用户机器上运行时自进化——自己观测失败（Observe）→ 记本地库 → 自己聚类梳理（Distill）→ 自己产出并执行分级改进（Evolve）→ 用同类错误频率曲线验证改进真伪（Verify）→ 全程受不可修改红线约束（Guard）。目标是「这个装在我机器上的 agent，用得越久越懂怎么把事做对」，不经过开发者、不发版、不进开发治理链。
acceptance:
  - EVO-0 基座：本地 incident 表（migration 023）+ fingerprint 归一化/脱敏纯函数 + 不可修改红线守卫 + HK-01 红绿回放
  - EVO-1 自观测：5 类 catch 点接线（顶层 fatal / 工具信封失败 / SSE reasonCode / stall 重试 / working-tree 否决）→ 脱敏落库，写入失败 fail-soft
  - EVO-2 自梳理+自改进：聚类产出 lesson（带证据/置信/TTL）；低风险自动写 LEARNINGS.md 注入 prompt 段、中风险改进卡片待人裁决、高风险只出 plan 草案
  - EVO-3 自验证：lesson 前后同类 fingerprint 频率曲线（降→留、平→降级、升→自动回滚）；一条真实历史错误走通「学习→频率归零→保留」
  - 全程零新依赖 / 纯本地 SQLite 零外发 / 红线机械门 fail-closed / 用户可见可否决可 wipe
reopen: lesson 投毒（被注入的失败反馈污染 prompt）或红线守卫被绕过时立即停环并审计
supersedes: 无（新产品能力，非既有包的增量）
---

# EVO · Harness 自进化蓝图（2026-11-20 · 产品能力，非开发治理）

> **发令原话**：用户三轮澄清——①「我要的是 Petri agent 内嵌这种能力，有错误就会记录数据库下来，Petri 运行的时候自动收集、自动梳理阶段性问题、给出优化建议和 plan，让 Agent 越用越好用」；②「我说的不是开发 Petri 的过程中，而是让 Petri 这个自带 Agent harness 自进化」；③「给一个了不起的规划，设计好就可以直接按计划开搞」。
>
> **本规划与开发治理链的区别（关键）**：主角是**用户机器上运行的那个 agent harness 自己**，不是维护 Petri 的工程师。错误→建议→改进的出口**不接** AUDIT-LOG / 工作包 / 发版，而是接进 harness 自己的运行时行为面。开发治理链仍独立运作，两条链不混。

## 0. 立项核对（WORK-PACKAGE-LAUNCH-CHECKLIST）

- **前置状态**：`npm run state` 显示三个 work-package 仍 active——BLOCK-503/505/506，均为 2026-11-19 MATERIAL 交付（清单/提示词/对标研究），产出已落盘、待人消费，且 docs-only。本规划文件面（core 运行时 + src/migrations + test）与其零相交。
- **并行裁决留痕**：用户明示「设计好就可以直接按计划开搞」→ 按显式并行裁决处理，零触碰三个 MATERIAL 包及其 untracked 证据目录、`assets/`、`tmp-*` 等未知 WIP（git status 已核对，逐项显式 add，不批量卷入）。
- **Plan ID**：新建 `EVO` 系列（独立责任与验收边界：harness 运行时自进化，非既有包增量）。EVO-0 为首包，复用本 plan 作为总蓝图，各阶段独立登记 AUDIT-LOG 行。
- **环境纪律**：本包为后端/存储逻辑，dev 栈后端变更须重启；无需 UI 实机（EVO-2 改进卡片阶段另接）；全程不跑 Provider / packaged / GA（G0 纪律）。

## 1. 为什么现在能做：现成抓手盘点（代码取证）

Petri 已经把「harness 行为面」做成了运行时可写/可注入，自进化不是从零造：

| 现成机制 | 证据 | 在自进化中的角色 |
|---|---|---|
| SQLite `task_events` 事件流 | `core/petri-server/agent-task-store.js:253-281` | 结构化事件落库范式（EVO-1 复用） |
| 顶层 fatal / SSE reasonCode / 工具信封失败 | `loop-orchestrator.js:1590-1605`、`events.js:134-209`、`tool-execution.js:447-485` | Observe 的 catch 点（已具名化） |
| `.petri/MEMORY.md` 写→下次注入 | `agent-runner.js:467-491,596-598` | 唯一已打通的「写一次、以后生效」闭环（EVO-2 低风险层复用其注入通道） |
| working-tree rejects → prompt 回灌（30 天 TTL） | `system-prompt.js:234-355` | 「被否决经验」注入模板（EVO-2 lesson 注入范式） |
| `buildSystemPromptSections` 分段 add + 字符预算 | `system-prompt.js:423-437,440-528` | 新增 `selfEvolution` 段的低成本注入点 |
| 运行时可写策略文件（agent-rules / tool-approval / memory-policy） | `agent-user-rules.js:117-148` 等 | 行为参数落点范式（写入口现为 UI，EVO-2 中风险层需新增受控写入） |
| 工具定义 overlay / 结果层 hint | `registry.js:594-619`、`workspace-tools.js:892-899` | 工具面改进挂钩（EVO-2 中风险层） |
| Skill `discover → get` + installed manifest | `skill-registry.js:283-310,412-473` | 沉淀技能的容器（EVO-2 高风险层，仅草案） |
| 失败归因 L1/L2/L3 管线 | `scripts/block114-failure-triage.mjs` | Distill 的归因范式（产品化内嵌） |
| 10 类 fault + 修复边界纯函数 | `loop-failure-diagnoser.js`、`loop-repair-strategy.js` | lesson 分类与 ALLOW/BLOCK 边界现成定义 |

**缺口（本规划要补的）**：①统一 incident 存储与 fingerprint 归一化（当前散落、无聚类键）②lesson 专用语义（MEMORY 是「关于用户/项目」，不是「agent 该怎么做」）③读进化文件注入 prompt 的通道 ④agent 可调用的受控写入工具 ⑤不可修改红线的运行时机械门（现有 `user-asset-guard` 只管 git 索引）。

## 2. 五层架构（Observe → Distill → Evolve → Verify → Guard）

```
       ┌───────────────────── Guard（横切红线，fail-closed） ─────────────────────┐
       │  禁改：harness 自身源码 / 工具注册表 / approval 与执行准入链 /          │
       │        built-in skill / embedding 绑定 / owner:'code' 配置              │
       └──────────────────────────────────────────────────────────────────────────┘
 Observe           Distill              Evolve                  Verify
 失败信号  ──→  聚类成 lesson  ──→  分级改进落地  ──→  频率曲线验证  ──→（回流）
 ·顶层 fatal     ·fingerprint 聚合   ·低:自动注入 prompt      ·降→保留加固
 ·工具失败       ·频次/趋势/影响面   ·中:改进卡片待裁决       ·平→降级观察
 ·SSE reasonCode ·归因 L1/L2/L3      ·高:只出 plan 草案       ·升→自动回滚
 ·stall 重试     ·置信/TTL/证据      ·永不动红线内资产        ·如实留证据
 ·working-tree否决
       ↓ 脱敏本地 SQLite（incidents 表）
```

### 2.1 Guard —— 不可修改红线（最先做，EVO-0）

**必须先于任何写入能力存在**，否则 `workspace_write` / `workspace_exec` 在 full 档下可触及 harness 自身。红线清单（运行时机械门，非 git 期门）：

- **禁改资产**：`core/petri-server/**`、`core/shared-backend/**`（harness 源码）、工具注册表 `tool-defs.js` / `registry.js`、approval 与执行准入链（`agent-execution-policy.js` / `agent-tool-interceptor.js` / `trust-policy`）、`resources/skills/` built-in、`memory-policy.json` 中 `owner:'code'` 项、config-schema 中 `mutable:false` 项、`.petri-secrets*` / `.env*` / `.git` / 凭据路径。
- **允许写入面（白名单）**：`.petri/LEARNINGS.md`（新建，agent 行为教训）、`.petri/MEMORY.md`（既有）、`agent-rules.json`、`tool-approval-policy.json`、`memory-policy.json` 中 `mutable:true` 项、installed skill 目录（EVO-2 高风险层且需裁决）。
- **机制**：纯函数 `assertEvolutionTargetAllowed(target)` → `{allowed, reason, tier}`；所有自写入口（EVO-2 的 `harness_apply_lesson` 工具）必须先过门，fail-closed（不在白名单即拒）。红线表本身 `owner:'code'`，agent 不可改。
- **隐私**：所有落库内容先经 `redactIncidentPayload()`（去密钥/路径/邮件/会话 id），raw 不落盘；incidents 表带 TTL 与一键 wipe 接口。

### 2.2 Observe —— 自观测（EVO-1）

- 在 5 类现有 catch 点插入 `recordIncident({source, errorCode, tool, phase, context})`，写入脱敏后的 `incidents` 表。
- **fingerprint 归一化**：`normalizeIncidentFingerprint()` 去掉会话 id / 时间戳 / 临时路径 / 数字后缀 / 绝对路径前缀，使同类错误聚到同一键（纯函数，HK-01 覆盖：同义输入同 fingerprint、敏感 token 零残留）。
- **fail-soft**：写入失败绝不阻断 agent（照 `recordTranscript` 吞错+logger.warn 范式）；但写入失败计数计入自身可观测（避免「证据链静默缺失」——这是第一轮审计抓到的既有缺口）。
- 保留用户纠正信号：working-tree reject（已具名）、任务中途放弃/「继续执行」重发——这些是「agent 做错了」的高价值标注。

### 2.3 Distill —— 自梳理（EVO-2 上半）

- 触发：每 N 个任务 / 会话结束 / 启动回收（N 可配，默认 20）。
- 按 fingerprint 聚合：频次、首末出现、趋势（升/平/降）、影响会话数、关联工具/阶段。
- 由 harness 自己（复用 model gateway + L1/L2/L3 归因范式）产出 **lesson**：
  ```
  { id, sourceFingerprint, title, action（可执行行为修正）,
    scope（适用条件）, confidence, evidence[], status,
    createdAt, lastSeenAt, occurrencesBefore, occurrencesAfter }
  ```
- lesson 低置信（<阈值）标 `needs_human`，不自动执行；证据指针必须回指至少一条 incident（防凭空生成）。

### 2.4 Evolve —— 分级自改进（EVO-2 下半）

| 风险层 | 落地形态 | 生效方式 | 用户角色 |
|---|---|---|---|
| 低 | lesson 写入 `.petri/LEARNINGS.md`，新增 `selfEvolution` prompt 段注入（照 rejects 段范式，带字符预算与 TTL） | 下次会话自动生效 | 可见「agent 学到了什么」，可删除否决 |
| 中 | 工具 hint overlay / 运行时策略微调 | 生成改进卡片（设置页只读→采纳/拒绝） | 一键采纳或拒绝 |
| 高 | 新 skill 草案 / 工具面调整 | **只出 plan 草案展示，永不自动执行** | 明确裁决才落地 |

- **不越权边界**：照 `loop-repair-strategy.js` 的 ALLOW/BLOCK——可改「提示、hint、策略档位」；不可改「事实、数据、统计方法、红线资产」。模型自建脚本质量域（BLOCK-510 E3）属自我纠正域，harness 只补反馈信息量，不代做。

### 2.5 Verify —— 自验证（EVO-3）

- 每条 active lesson 持续追踪其 `sourceFingerprint` 的后续频率：
  - 频率**下降** → 保留并加固置信；
  - **持平** → 降级观察，不继续扩散；
  - **回升 / 产生新 fingerprint** → 自动回滚该 lesson（从 LEARNINGS.md 移除），留回滚证据。
- 「越用越好用」的唯一硬证据 = **前后频率曲线**，不是「我们加了个学习功能」。收口验证用一条真实历史错误（如 BLOCK-510 unknown_tool）走通完整链路。

## 3. 分期与验收门禁

| 包 | 范围 | 验收门禁（HK-01 红绿先行） | 体量 |
|---|---|---|---|
| **EVO-0**（本批开工） | Guard 红线纯函数 + incident 数据模型（migration 023）+ fingerprint 归一化/脱敏纯函数 + 红线守卫接入点 | 红：模块缺席→绿：fingerprint 稳定/脱敏零残留/红线不可改/迁移可建表；邻域零回归；docs:check + ui:audit | 小包 |
| EVO-1 | 5 类 catch 点接线 + fail-soft + 写入计数可观测 | 注入 5 类错误逐类可查；写入失败不阻断 agent | 小包 |
| EVO-2 | 聚类 + lesson 生成 + 低/中/高风险分级写入 + prompt 注入段 | 合成多次失败→1 条可执行 lesson；红线内资产尝试写入被拒 | 1–2 周 |
| EVO-3 | 频率曲线 + 自动回滚 + 真实历史错误闭环 + 证据 UI | 一条真实错误走通「学习→频率归零→保留」 | 1 周 |

**串行纪律**：一次只开一个包，EVO-0 收口后才启动 EVO-1。本批只做 EVO-0。

## 4. 数据模型（EVO-0 落地）

```sql
-- src/migrations/023_incidents.sql（照 014_funnel_events 范式；additive 新表，本机留存零外发）
CREATE TABLE IF NOT EXISTS incidents (
  id            INTEGER PRIMARY KEY,
  fingerprint   TEXT NOT NULL,
  source        TEXT NOT NULL,        -- fatal | tool_failure | sse_reason | stall | reject
  error_code    TEXT,
  tool          TEXT,
  phase         TEXT,
  normalized    TEXT NOT NULL,        -- 脱敏后的归一化文本
  conversation_id TEXT,               -- 脱敏/哈希后
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_incidents_fingerprint ON incidents(fingerprint, created_at);
```

`lessons` 表延后到 EVO-2（届时与 LEARNINGS.md 双写，SQLite 为结构化真源、MD 为 prompt 注入投影）。

## 5. 红线与纪律

- **零新依赖**：纯 Node + 既有 better-sqlite3 + node:crypto。
- **纯本地零外发**：不复活 telemetry 占位端点；incidents 只进本机 DB；用户可 wipe。
- **不进开发治理链**：harness 自进化的建议/plan 不留 AUDIT-LOG 工作包、不触发发版；本规划文件自身的立项/收口按常规治理登记。
- **G0 纪律**：不外推 packaged / Provider / GA；EVO-2 改进卡片 UI 属产品内功能可做，观感项零代签。
- **E-03 裁决不冲突**：E-03 砍的是真人观感评分；本能力是运行时自动采集，非问卷、非代打分。

## 6. 证据位置

- 规划本体：`docs/evo-harness-self-evolution-plan.md`（本文件）
- EVO-0 证据：`acceptance/evo-0/`（plan-copy.md + hk01-red.txt + hk01-green.txt + test-run.txt）

## 7. EVO-0 收口笔录（2026-11-20 · 一次会话完成）

- **交付**：incident 本地表（`src/migrations/023_incidents.sql`，8 列+fingerprint 索引）＋ fingerprint 归一化/脱敏纯函数（`core/shared-backend/incident-fingerprint.js`）＋ 不可修改红线守卫（`core/shared-backend/harness-redline.js`，fail-closed 白名单）＋ 总蓝图（本文件）。
- **HK-01 红绿回放**：红=模块缺席 `MODULE_NOT_FOUND`（`acceptance/evo-0/hk01-red.txt`）→ 绿=10/10（`hk01-green.txt` / `test-run.txt`，含真实 SQLite 跑全部 migration 后 incidents 表可写可读的端到端断言）。⑤超长输入性能 5.6s→10ms（脱敏/截断顺序修正）。
- **邻域**：本包契约 + block510 + loop-stall-resume = 27/27 绿（`acceptance/evo-0/neighborhood.txt`）。
- **门禁**：docs:check PASS(661)（coverage 已重算）、ui:audit ✓、quality:secret/arch/types PASS。新增文件 quality:lint 0 error（3 个 `detect-object-injection` warning 属存量 2452 同类基线内）、knip 零命中。
- **存量红如实归属（非本包文件面、零触碰）**：quality:lint 2 error（model-gateway.js `resolveStallThresholds` 未用=BLOCK-338/507；ChatArtifactCard.video.test.tsx 类型断言=BLOCK-509）；quality:knip:check 38 处新增死代码（`acceptance/block503-outputs/yi-rest/_tools/*.cjs` 等并发人眼包未跟踪探针）；`test:changed:list` 1 处 `ui-error-classification-stall` 引用缺失（HEAD 既有存量，本包仅纯追加 17 行 impact-map）。三者均在 HEAD/并发 WIP，与本包无关，不放宽任何基线。
- **Jev**：doc:suggest 首跑 planDoc suggested=true（本文件即回写对象，已满足）；decision:session 本轮增量 jev×7。output:judge 需 transcript 参数，非本场景跳过。
- **范围外（后续阶段，需各自发令）**：EVO-1（5 类 catch 点接线+fail-soft）；EVO-2（聚类+lesson 分级写入+prompt 注入段）；EVO-3（频率曲线+自动回滚+真实错误闭环）。harness 自进化建议出口不进 AUDIT-LOG 工作包链。
- **纪律**：零新依赖/纯本地零外发/红线 fail-closed/用户可 wipe/不碰 G1+；与三个 MATERIAL active 包文件面零相交、零触碰未知 WIP。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 8. EVO-1 收口笔录（2026-11-20 · 一次会话完成）

- **前置**：EVO-0 改动补提交（806e5187）并推送 origin/main（快进 +13，含历史未推提交），满足单工作包串行。
- **交付**：incident-log 写入咽喉（`core/petri-server/helpers/incident-log.js`：白名单 5 源 + 脱敏 + fail-soft 全吞 + 内存失败计数 + EVO_DEBUG 门 error-log append + 测试注入）＋ 5 类 catch 点旁路接线：
  - fatal → `loop-orchestrator.js` catch 后（覆盖 providerFailure/catch 两条赋值路径，排除用户取消）
  - tool_failure → `tool-execution.js` appendTrace（envelope.status=error|denied）
  - sse_reason → `events.js` sseSend（reasonCode 窄守卫，fire-and-forget）
  - stall → `loop-orchestrator.js` _emit（provider_retry / stream_stall / stall_resume_exhausted 三类）
  - reject → `system-prompt.js` loadWorkingTreeRejectEntries（R5 避 src/ipc，模块级 seen 去重）
- **HK-01 红绿**：红=模块缺席+接线缺席（行为 7/7 绿、接线 5 红；`acceptance/evo-1/hk01-red.txt`）→ 绿 13/13（`hk01-green.txt` / `test-run.txt`）。测试正则三处跨度校准（源码接线本身正确，属测试断言精度）。
- **邻域**：15 文件 140 tests / 139 pass / 0 fail（`acceptance/evo-1/neighborhood.txt`）——含 agent-runner-loop-orchestrator / loop-sse-contract / agent-tool-result / system-prompt-rejects / routes-ai-agent-subdomains / m4-sse-real-endpoint / block507 / block510。唯一曾红=loop-orchestrator 行数锚 1647→1674（+27=EVO-1 三处接线），按该测试纪律显式重锚留因后转绿。
- **门禁**：docs:check PASS(661)（撤销误建的第二 registry 条目后恢复单值；EVO-1 与 EVO-0 共享 plan 文档，仅 AUDIT-LOG/README/impact-map 登记，禁止第二真相源）、ui:audit ✓、quality:secret/arch/types PASS。改动文件 quality:lint 0 error（12 warning 均存量同类 detect-object-injection）、knip 零命中。
- **存量红如实归属（非本包文件面、零触碰）**：同 EVO-0——2 lint error（model-gateway/video.test=BLOCK-338/507/509）、38 knip（并发人眼包探针）、1 test:changed 冲突（HEAD 既有）。
- **Jev**：doc:suggest planDoc adopted（本文件即回写对象，已追加本节）；decision:session 本轮增量 jev×5。
- **范围外（后续阶段，需各自发令）**：EVO-2（聚类+lesson 分级写入+prompt 注入段）、EVO-3（频率曲线+自动回滚+真实错误闭环）。harness 自进化建议出口不进 AUDIT-LOG 工作包链。
- **纪律**：零新依赖/纯本地零外发/红线 fail-closed/不进治理链/观感零代签/不碰 G1+。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 9. EVO-2 收口笔录（2026-11-20 · 一次会话完成）

- **交付**：
  - `src/migrations/024_lessons.sql` — lessons 结构化真源（UNIQUE source_fingerprint + status/scope 索引；不用 AUTOINCREMENT）。
  - `core/shared-backend/lesson-distiller.js` — Distill 纯函数：按 fingerprint 聚类 incidents（频次/趋势/影响会话数）→ L1/L2 规则（复用 loop-failure-diagnoser fault type 语义）产出 lesson（title/action/scope/confidence/evidence/status），**零模型调用**、证据指针回指 ≥1 条样本、低置信标 `needs_human`。
  - `core/petri-server/helpers/lesson-store.js` — 分级写入决策核 `applyLessonDecision()`（**先过 harness-redline fail-closed 门**，红线 tier 优先于 lesson.scope，拒绝优先）+ `upsertLesson()`（ON CONFLICT 去重累加，仿 policy-observation-store）+ `listActiveLessons()`（best-effort）。
  - `core/petri-server/helpers/lesson-render.js` — selfEvolution prompt 段渲染（照 rejects 模板：空零注入、条数上限、逐条预算、超长截断）。
  - 接线：`system-prompt.js` 加 `selfEvolution:4000` 预算 + `add(clipSection(renderSelfEvolutionForPrompt(...)))`（落 body 动态段，不进 staticPrefix 保护前缀缓存）；`agent-runner.js` 从 lesson-store 读活跃 lesson 注入 `ctxForPrompt.selfEvolutionLessons`（fail-soft）。
- **范围收敛说明**：物理文件写入不新建 `harness_apply_lesson` 工具——继续走既有 `workspace_write` 治理门（路径沙箱/审批/sha256 乐观锁），本批只产出"写到哪个 tier、是否放行"的决策核；避免扩大工具注册面（registry.js 为 EVO-0 红线禁改资产）。真实自写入工具待 EVO-3 与频率验证闭环一并裁决。
- **HK-01 红绿**：红=模块缺席→绿 18/18（`hk01-red.txt`/`hk01-green.txt`/`test-run.txt`）。含真实 SQLite 跑全部 migration：合成 4 次同类失败→1 条 active lesson→upsert→读出→注入 prompt 段（端到端闭环 16-18）；同 fingerprint upsert 两次一行（不重复插）；写入失败 fail-soft + 计数。
- **邻域**：12 文件 125 tests / 124 pass / 0 fail / 1 skipped（`neighborhood.txt`）——含 agent-runner-loop-orchestrator / system-prompt-* / block346-tool-defs-assembly / block510 / loop-sse-contract。唯一曾红=agent-runner 行数锚 1143→1153（+10=EVO-2 注入块），按该测试纪律显式重锚留因后转绿。
- **门禁**：docs:check PASS(661)、ui:audit ✓、quality:secret/arch/types PASS。改动文件 quality:lint 0 error（1 warning 属存量同类）、knip 零命中。
- **存量红如实归属（非本包文件面、零触碰）**：同 EVO-0/1——2 lint error（model-gateway/video.test=BLOCK-338/507/509）、38 knip（并发人眼包探针）、1 test:changed 冲突（HEAD 既有）。
- **Jev**：doc:suggest planDoc adopted（本文件即回写对象，已追加本节）；decision:session 本轮增量 jev×7。
- **范围外（后续，需发令）**：EVO-3（频率曲线 + 自动回滚 + LEARNINGS.md 双写 + 真实错误闭环 + 证据 UI）。harness 自进化建议出口不进 AUDIT-LOG 工作包链。
- **纪律**：零新依赖/纯本地零外发/零模型调用/红线 fail-closed/不进治理链/观感零代签/不碰 G1+。G0 开发期常态 · 不外推 packaged/Provider/GA。

G0 开发期常态 · 不外推 packaged/Provider/GA。
