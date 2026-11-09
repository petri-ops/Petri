---
capability: block-386-post-s7-h1-execution-truth
status: active
goal: 把「策略判定」与「真正执行」焊成一条可审计闭环，并让产物链与不可信输入只有一份 fail-closed 真相——同时不撤销任何既有用户裁决（FK=ON 维持缓 / ADMISSION 拨硬维持缓 / MCP 两轴分离 / workspace_exec 默认放行）。
acceptance:
  - workspace_exec 执行边界出示并消耗一次性准入凭据；四类拒绝（过期/重放/指纹改写/上下文改写）在生产路径有可复跑负测
  - 签发失败不再静默，reasonCode 透出到工具结果（observe 也不吞）
  - 删知识空间的绑定清理不依赖 FK 开关；knowledge-space G3 用例红→绿
  - zip 解压补条目级 fail-closed（条目数 / 总字节 / 符号链接 / 路径形态）并有真实 zip 负测
  - delivery manifest 链三态（linked/started/broken）显式化，断链不静默新起
  - 链校验器 legacy_unhashed 默认 strict；存量清单先行走 --inventory；容忍旧库须显式 --allow-legacy
  - U 类（ADMISSION 默认档 / FK 全量切换）出一页决策材料并留痕，不擅自改默认语义
reopen: 用户裁决 ADMISSION 拨硬或 FK 全量切换；ssh-direct-runner / tools-executor 接入凭据通道
---

# BLOCK-386 · post-S7 H1 执行准入与数据真相

> 发令：用户 2026-11-09 预授权连续工作（蓝图 H0→H7 全推）。上游 `docs/post-s7-optimization-blueprint-2026-11-09.md` §4 H1（B-04 / B-05 / B-06 / B-08）。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 范围与判断

| 项 | 蓝图缺口 | 本包动作 | 判断 |
| --- | --- | --- | --- |
| 准入闭环 | B-04 | `consumeExecutionAdmission()` 新增；拦截器签发点补 `expect`（task/指纹/上下文快照）；`workspace_exec` 执行边界出示并消耗，结果透出 `executionAdmission{mode,reason}` | patch（既有 `executionAdmission` 字段已在透传，只是没人消费） |
| 签发失败静默 | B-04/B-08 | 空 catch 改显式降级态：`issuanceFailed + reasonCode=execution_admission_issue_failed`，消费端不得退化成 missing | patch |
| FK 分裂下的掉绑 | B-05 | `deleteSpaceCascade` 显式删 `knowledge_space_bindings`，不依赖 CASCADE | patch（一处 SQL） |
| 解压输入面 | B-06 | `extractZipFile` 在 extract-zip 的 `onEntry` 上补四道闸：条目数 / 累计字节 / 符号链接 / 路径形态；返 `{destDir,entries,totalBytes}` | patch（不新建解压器，零新增依赖） |
| manifest 断链 | B-06 | `writeDeliveryManifest` 返 `chainStatus`（linked/started/broken）+ `reasonCode=manifest_chain_broken` | patch |
| 链校验默认档 | B-06 | 默认 strict；`--inventory` 存量清单；`--allow-legacy` 显式降级（`--strict` 成兼容别名）；既有 `nso-s2-chain-hash-update` 契约同批翻新 | 契约翻转（有意 fail-closed 收紧） |

## 2. 非范围与保留（附理由）

| 项 | 处置 | 理由 |
| --- | --- | --- |
| `mcp/registry/run-plugin-script.js` 接 capability token | **保留不接** | BLOCK-374 两轴分离用户裁决：外部 MCP 主体由 MCP trust 轴治理，不进 capability token 面。蓝图 H1 原文列三入口，但与本裁决冲突——按「不撤销既有用户裁决」以裁决为准 |
| `helpers/tools-executor.js` / `ssh-direct-runner.js` 接凭据 | **retain-with-reason** | 两者是 job / 远端 job 执行器，无 `handlerOptions` 通道；接入需在 job 创建链传凭据（跨 `tool_jobs` 行与 SSH 会话），属独立大包。补腿条件见 §5 |
| FK 全量切换（后端 `foreign_keys=ON`） | **维持缓** | 用户裁决（BLOCK-372 证据 179 违约 / BLOCK-384 复核维持缓）。本包只消除「依赖 FK 才正确」的代码，使两种形态行为一致 |
| ADMISSION 拨 enforce | **维持 observe** | U 类：决策材料见 `docs/post-s7-h1-admission-fk-decision-material.md`；未获用户裁决前不改默认语义 |
| prompt-injection 面盘点 | **retain-with-reason** | 需专门只读审计（工具结果 → 消息装配的全部注入点）。本包未做，**不冒充已盘点** |

## 3. 依赖与风险

- 依赖：H0（干净树 + 分片归因稳定）。
- 风险 1：默认 strict 的链校验会让旧库红。缓解：`--inventory` 先出清单；dev 库实测 118 版全部有哈希、0 legacy；`--allow-legacy` 是显式出口而非默认。
- 风险 2：执行边界加校验可能误伤既有放行。缓解：默认 observe 且 observe 也消耗但永不拒绝；`agent-workspace-exec-*` 四族 + `agent-tool-policy` + `nso-s2-*` 全回归 70/70 绿。
- 风险 3：zip 校验误伤合法包。缓解：四道闸只拒绝「超限/符号链接/路径形态异常」，正常包测试照常解出并回报条目与字节数。

## 4. touchSurface / sharedBaselines

- touchSurface：`core/shared-backend/execution-admission.js`、`core/shared-backend/delivery-manifest.js`、`core/petri-server/agent-tools/{agent-tool-interceptor.js,workspace-tools.js}`、`core/petri-server/helpers/knowledge-space.js`、`src/plugin/zip.js`、`scripts/verify-artifact-chain.mjs`、`test/{block386-execution-admission,block386-zip-guard,block386-chain-inventory,delivery-manifest,block235-export-federation-baseline,nso-s2-chain-hash-update}.test.mjs`、`test/impact-map.json`、`acceptance/post-s7-2026-11-09/h1/**`、本文 + 决策材料。
- sharedBaselines：无放宽。`legacy_unhashed` 属**收紧**（登记不判红 → 默认判红）。

## 5. 补腿条件

- `tools-executor` / `ssh-direct-runner` 接凭据：需先给 job 创建链定义凭据载体（不新建表；复用 `tool_jobs.parameters_json` 还是新增列需架构判断），并补「job 无凭据在 enforce 下拒绝」的负测。
- prompt-injection 面盘点：只读枚举 `tool_result → messages` 的全部装配点（loop-orchestrator / message-trimmer / agent-resilience / resume 链），产出注入点清单与是否需要隔离层的结论。

## 6. 完成语义

`completed` 需：生产路径四类拒绝负测绿、zip 四道闸真实负测绿、删空间掉绑绿、链三态绿、默认 strict 绿且有存量清单、U 类材料在册、门禁全绿且未放宽任何基线。
