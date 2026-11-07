---
capability: block-377-post-nso-s2-execution-admission
status: completed
goal: S2 执行准入与数据自证——在保持用户 exec 裁决前提下把「策略判定」与「真正执行」焊成可审计闭环；数据库与产物链状态可自证；承载蓝图 §8 全部 10 项改进点。
acceptance:
  - FK 裁决落地：db-connection-policy 为唯一策略真相（后端 OFF），connection.js/_db-singleton/测试断言/头注三面一致，全量回归证据在册
  - 链哈希覆盖业务列 UPDATE（重算 chain_hash）；verify-artifact-chain 分流 legacy_unhashed（存量缺链不判篡改）；端到端改行触发 fail-closed 负测
  - _ipc-trust file: sender 收紧（主窗精确比对+显式豁免清单）；file-dialog 写 handler 模块内 guard；真实写通道端到端拒绝负测
  - 三执行入口（tools-executor/run-plugin-script/ssh-direct-runner）接入同一决策结构：一次性 capability token（fingerprint+ctxSnapshot+expiresAt+taskId）；参数改写/过期/跨 task 重放/旁路四类拒绝负测绿
  - delivery-manifest 重算产物字节 sha256 并纳 prevManifestHash；导出包带根哈希；篡改负测绿
  - nso-b4-mcp-subject 的 || true 恒真断言换行为负测；mcp/registry 子目录纳入扫描
  - P1 件：后端句柄退出收敛（closeAll+wal_checkpoint）；afterPack PROBE_UNAVAILABLE fail-closed+单测；execToken 特权通道裁决留痕；mcp registry warn 后继续点汇入 degraded
  - 两轴分离契约不变（MCP trust 轴 vs capability token 轴）；workspace_exec 默认放行裁决不变
reopen: 门禁红或契约冲突时先归因再重开对应项
---

# BLOCK-377 · S2 执行准入与数据自证（post-NSO 蓝图 §8）

> 承载 [`docs/post-nso-optimization-blueprint-2026-11-06.md`](./post-nso-optimization-blueprint-2026-11-06.md) §8。
> 发令：用户 2026-11-07 预授权连续工作模式（S0→S7 全程零参与，工程判断全下放）。
> 前置：BLOCK-376（S1）completed @1a439237。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 范围与执行顺序

P0 五件按依赖序：FK 裁决（最小面先行）→ 链哈希 UPDATE 覆盖 → IPC sender 收紧 → 三入口 token → manifest 自证。P1 四件随后。裁决记录：

- **FK 取向 = 后端回退 OFF**（依 BLOCK-372 Batch-2 全量回归证据 179 fail；policy 头注已是 OFF 真相，runtime 未跟上——本包把代码改到与策略一致，桌面侧 ON 保持）。
- **execToken 特权通道 = 保留并补签发者与审计**（workspace-tools per-call 令牌是 BLOCK-360 ④ 交付面；删除=回退已交付安全能力；「全仓无签发者」按蓝图 §8.9 补齐）。
- **capability token 单源结构**：新 helpers/execution-admission.js（纯函数：签发/校验/消耗，fingerprint+ctxSnapshot+expiresAt+taskId）；三入口在同一校验函数上接线，不建第二执行器。

## 2. 非范围（exclusions）

- 不撤销 workspace_exec 黑名单默认放行；不动 MCP trust 轴语义（BLOCK-374 两轴分离契约）。
- 不做 G1+ 项（packaged/公证/Provider）；不重构 mcp/registry 整体（degraded 汇入为加性）。
- 不动 179 违约数据的逐表清偿（独立大包候选；本包只保证策略/代码/测试三面一致）。

## 3. touchSurface / sharedBaselines

- core：db/connection.js、shared-backend/db-connection-policy.js（头注如需）、result-studio-repository.js（UPDATE 链哈希）、scripts/verify-artifact-chain.mjs、delivery-manifest.js、routes/harness/scientific-task.js、mcp/registry/run-plugin-script.js、helpers/remote-execution/ssh-direct-runner.js、helpers/tools-executor.js、mcp/registry.js（degraded 汇入）、helpers/execution-admission.js（新）。
- src：ipc/_ipc-trust.js、ipc/file-dialog.js、database/_db-singleton.js（注释一致性）、build/afterPack.js。
- 测试：新建 nso-s2-* 族 + db-singleton/nso-b1-chain-hash/nso-w2-* 追新。
- sharedBaselines：knip 保留面（新 helper 导出定性）、code-size 台账。

## 4. 验收门禁

| 门禁 | 预期 |
| --- | --- |
| nso-s2 行为测试族 | 全绿（红绿先行） |
| db-singleton / nso-w2-* / nso-b1-chain-hash / block357 | 定向绿 |
| test:changed / closeout / 九门 | 0 未归因 fail / PASS |

## 5. 完成语义

本包 `completed` = §4 全绿 + canonical 回写同批 + 收口笔录。FK 179 违约数据清偿、蓝图 §8.4「迁移/回填」若证据显示需要独立数据迁移，则如实登记为后续大包候选，不冒进。

---

## 6. 收口（2026-11-07）

### 6.1 交付对账（§1 八项）

| 项 | 结果 | 证据 |
| --- | --- | --- |
| FK 裁决落地 | ✅ | **当场钉死真相**：b4edf467（声称「回退 OFF」）实际**添加**了 ON pragma——裁决与代码反向。S2 按裁决落地 connection.js=OFF；nso-s2-fk-policy-consistency 四腿（源码钉×2+运行时实测 OFF+策略模块无 FK 开关）4/4；桌面 ON（A-007.8）不变 |
| 链哈希 UPDATE 覆盖 | ✅ | recordReplayProofAndVerifyCohort 的 reproducibility_status UPDATE 接入 recomputeRevisionChainHash（_test 缝导出）；is_current 指针位不在载荷内无需重算；校验器 legacy_unhashed 分流（存量不判红/--strict 判红）+arg 解析 bug 修正（--strict 曾被误当 project filter）；nso-s2-chain-hash-update 3/3+既有 b1 族 4/4 |
| IPC sender 收紧 | ✅ | file: 注册制（registerTrustedFileSenderHost+env 豁免登记制）；PiP 窗登记；file-dialog 写通道补模块内主窗 guard（真实写通道 workspace:write-text-file 端到端负测：非主窗 sender 拒/unauthorized）；w2-ipc-trust 7/7+w2-workspace-roots 11/11 |
| 三入口 capability token | ✅（结构面） | execution-admission 内核（issue/verify/consume/inspect；fingerprint+ctxSnapshot+expiresAt+taskId；单次消耗）6/6 契约测试；拦截器策略点签发（executionAdmission 经 handlerOptions 传递）；**MCP run-plugin-script 依 BLOCK-374 两轴分离裁决豁免**（trust 轴治理，更新于 G-06 之上的更晚裁决）；enforcement=observe（PETRI_EXEC_ADMISSION=1 拨硬），**拨硬前置=S4 全调用面审计**（队列路径令牌随行需 job 行携带——如实登记） |
| execToken 特权通道（§8.9） | ✅ | **裁决修订=删除**（原计划保留补签发）：per-call execToken 全仓无签发者=不可达假安全面，env 令牌已被红测实证可绕过；删除后默认放行裁决不变、严格模式照拦；nso-w2-exec-token 4/4+邻居 exec 族 30/30 |
| manifest 字节自证（§8.6） | ✅ | computed/declared 双哈希并存、漂移→degraded+artifact_integrity_drift；writeDeliveryManifest 接 prevManifestHash 链（二次写衔接上一份）；nso-s2-delivery-manifest 3/3+final-report 1/1 |
| \|\| true 恒真断言（§8.2） | ✅ | 换行为负测（拦截器无 mcpServerId×trust/allow 语义）+capabilityEvidence 扫描递归覆盖 mcp/ 子树；nso-b4 3/3 |
| P1 四件 | ✅ | 句柄退出收敛（checkpoint+close+exit 0 真实进程回归 300ms）；afterPack PROBE_UNAVAILABLE fail-closed（PETRI_PACK_PROBE_FALLBACK=1 显式豁免口）；mcp refresh 失败汇入 degraded（clear on success）；execToken=删除裁决见上 |

### 6.2 门禁终态

test:changed 1374/1395（7 红=P4R C-46 家族〔S0 归因残红〕，7 skip=block48 环境档）；九门绿（docs 508/ui-audit 631/code-size PASS（registry.js 指纹随交付重打）/knip 329/lint 0 error/types 0/arch R1-R5/secret 0/hygiene PASS）；impact-coverage 基线 147→145（w2 两测试挂规则真清偿）。

### 6.3 残留与补腿

1. PETRI_EXEC_ADMISSION 拨硬：需 S4 全调用面审计（队列路径 job 行携带 token）。
2. C-46×16（兄弟仓 deseq2.R）：S0 归因延续。
3. P6 源绑定重打：S0 pending 延续。
4. FK=ON 全量切换（179 违约清偿）：独立大包候选（蓝图 §8.4 原文不缩小）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
