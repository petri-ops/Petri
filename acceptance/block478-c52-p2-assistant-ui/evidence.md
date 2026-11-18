# BLOCK-478 / C-52 P2 assistant-ui 模式借鉴契约冻结 — 证据清单

> 生成：2026-11-18 · 证据类=mechanical-gate · humanEyeEquivalent=false
> 源提交：见 assistant-ui-pattern-snapshot.json `sourceCommit`

## 一、HK-01 红绿先行

- **红**：`node --test test/c52-assistant-ui-pattern.test.mjs`（扫描器缺席）→ `ERR_MODULE_NOT_FOUND`，`tests 1 / pass 0 / fail 1`。
- **绿**：实现扫描器并生成契约后 → `tests 11 / pass 11 / fail 0`。
- **--check**：`node scripts/c52-assistant-ui-pattern.mjs --check` → `{ok:true, readingIds:[6]}`。

## 二、六组冻结读数（逐读数现读一致）

| 读数 | 现读要点 |
| --- | --- |
| streamingMessages | pending 强制 + compose→pending + completed 升级 + JSON 前缀判据 + SSE 续传（8 it / 7 test） |
| toolApproval | ApprovalCard onApprove/onReject + GuardAckCard 三变体 + PlanApprovalCard 三选一 + useApprovalFlow/useGuardAck |
| attachments | MAX_ATTACHMENT_BYTES/MAX_ATTACHMENTS + validateAttachmentSize + .chat-attachments 工作区落盘 + onDragOver/onDrop |
| structuredData | COMPOSE_KINDS 五 kind + 未知 kind/悬空/环 fail-closed + $state 安全引用 + 手写零依赖校验器（12 it） |
| optionLists | AskUserQuestion 结构化提问 + multiSelect/allowFreeText + busy + answered/timedOut（3 it） |
| boundaries | 零新增依赖 + SimpleChat 未被替换 + UI-706/707/709/710 in_progress/pending_human_eye 零 verified + 许可证四来源登记 |

## 三、篡改负测（fail-closed）

- 注入流式源删去 pending 强制 → `streamingForcesPending=false`，完整性判红。
- 注入 package.json 加 assistant-ui 依赖 → `noNewDependency=false`，完整性判红。
- 注入观感翻态 → `humanEyeZeroSign=false`，完整性判红。

## 四、零回归与治理

- C-53 P0–P7 八份契约测试：`tests 79 / pass 79 / fail 0`（共用 manifest 面零回归）。
- 本包自身 closeout 门逐个全绿：ui:audit 绿 / code-size PASS / arch-cycles PASS / css-modules PASS / secret PASS / arch PASS / lint 0 error（本包 5 处 unused 已修）/ types 绿 / knip PASS。
- `output:judge`：首次 fit 2.62 RETRY → 带判词重试 fit 3.54 PASS。
- `test:suggest --supply=cloud`：零建议（area_none，confidence 0.31）；`doc:suggest --supply=cloud`：各维 suggested=false；`next:suggest --supply=cloud`：零建议（area_none，0.96）。

## 四附：closeout 聚合链两处既有红（非本包文件面，如实归属）

1. `docs:check` `DOCUMENT_MISSING docs/post-h9-optimization-blueprint-2026-11-10.md`：受保护未跟踪 living-plan，HEAD 全史 0 commit/无 blob，任何干净 checkout 均现；本包零触碰、不伪造。
2. `test:changed`：`block326 ② dev-verify --list exit 2`（run.cjs `padEnd` 崩溃，本包零 flow 面）+ `test-affected.test.mjs:90` block464/470/477 `evidence.json` 未映射（既有测试面债务）；本包未新增任何 `evidence.json`。

定向链 15 个 node test 中本包 11/11 通过；两红不冒充本包通过。

## 五、边界声明

零 UI 运行时写面、零观感代签（pending_human_eye 保持 in_progress）、零新增产品依赖、零 SimpleChat 写面；C-52 P3/P4/P5 保持候选未启动；他方 WIP（`docs/architecture/gateway-design.md`）零触碰。概览=G0 开发期常态 · 不外推 packaged/Provider/GA。
