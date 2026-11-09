---
capability: block-387-post-s7-h2-failure-semantics
status: completed
goal: 让「失败」在 Petri 里是可查、可回看、可归因的一等公民——原因码覆盖生产面全部字面量，静默 catch 从此只减不增，4 秒提示不再一闪而过，viewer 降级原因进读屏队列。
acceptance:
  - 生产面（core/ + src/）每个 reasonCode 字面量都在封闭词表注册，新增未注册即红
  - 四类失败事件（compaction_failed/trim_skipped/provider_retry/stream_stall）+ agent_run_failed + 首 token stall + 准入四类拒绝 + 输入面拒绝码在册且可渲染
  - 静默 catch（裸 catch {}）按文件冻结、新增即红，并自带负测
  - toast 历史回看：播报即入历史、去重、上限 50、可清空、可展开
  - viewer 降级原因从 role=note 升为 status + aria-live
reopen: 四事件前端投影（轨迹面）/ SSE 重连横幅 / ExternalImportPanel 回看接入时
---

# BLOCK-387 · post-S7 H2 失败态与错误语义

> 发令：用户 2026-11-09 预授权连续工作（蓝图 H0→H7 全推）。上游 §4 H2（B-07 / B-08 / B-13 / B-15）。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 交付

| 项 | 缺口 | 交付 |
| --- | --- | --- |
| 原因码覆盖 | B-15 | 词表 25→42 码；新增 `execution` / `input` 两个类别；四事件、`agent_run_failed`、`stream_stalled_first_token`、准入六类拒绝 + 三态、`manifest_chain_broken`、zip 四码全部在册 |
| 词表覆盖门 | B-15 | 契约测试从「只扫 agent-tool-policy + 拦截器」扩到**生产面全部** `reasonCode: 'x'` / `reasonCode = 'x'` 字面量（core/ + src/），未注册即红 |
| 静默 catch | B-08 | 新机械门 `gate:silent-catch`（按文件冻结 100 文件/403 处，新增即红）+ 负测 2 条；接入 closeout（第 6 门） |
| `onEvent: () => {}` 三处 | B-08 | 抽 `helpers/no-stream-subscriber.js` 具名占位（后台/续跑 run 无 SSE 订阅者，事件仍由 loop 落 `task_events`），三处引用；意图进入代码而非空函数 |
| toast 回看 | B-07 | `ToastProvider` 增加有界历史（播报即入、同 (variant,message) 去重、上限 50、可展开/清空）；4 条新测试 |
| viewer 降级语义 | B-13 | `ResultArtifactShell` 降级原因 `role="note"` → `role="status"` + `aria-live="polite"`（非错误不抢话，但进播报队列） |

## 2. 非范围（如实挂起）

| 项 | 处置 | 理由 |
| --- | --- | --- |
| 四事件前端投影（轨迹面/通知历史） | retain-with-reason | 需要轨迹面板 UI 与实机腿；H2 只做「词表 + 回看底座」，投影与实机归 H3（UI 台账同批） |
| SSE 重连横幅（B-14） | retain-with-reason | 同上；且需 dev 栈断线注入才能取证，H3 实机腿一并做 |
| `ExternalImportPanel` 单条 message → 可回看列表 | retain-with-reason | 与 toast 历史同族，待回看区在 H3 统一接线后复用 |
| 64MB 上限收进单一入口 | retain-with-reason | 分散常量（mesh/语义校验/远端读预算/mmap/transcript）各有语域，收拢需先定单一入口归属，属 H4 单源收编 |
| 8 处生产空 catch 逐处三分法 | 部分 | 门已立（冻结 + 负测）；逐处清零是持续动作，H4 随大拆片一起做 |

## 3. 证据

| 门 | 读数 |
| --- | --- |
| `test/block324-reason-taxonomy.test.mjs` | 7/7（含生产面扫描 + 15 码可渲染） |
| `test/block387-silent-catch-ratchet.test.mjs` | 2/2（口径 + 仓内 PASS） |
| `gate:silent-catch` | PASS（100 文件 / 403 处；基线 403） |
| `frontend ToastProvider.test.tsx` | 10/10（含 4 条历史回看） |
| `frontend ResultArtifactShell*` | 18/18（4 文件） |
| `tsc --noEmit` | 0 error |
| `npm run closeout` | 16→17 门全绿（新增 gate:silent-catch） |

## 4. 完成语义

`completed`（带挂起项）。四项前端投影类缺口**未做且不冒充已做**，reopen 条件写在 frontmatter。

G0 开发期常态 · 不外推 packaged/Provider/GA。
