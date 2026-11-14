---
capability: block-448-p6-recovery-driver-syntax
status: in_progress
goal: 修复 P6 恢复腿 driver 的表达式语法缺陷（SyntaxError 被静默 catch 吞成 lifecycle=null，导致 waitForLifecycle 恒定 120s 超时），恢复 P6 证据重采能力，从而解除 M7 §8 第 3 条「干净树 closeout:full 三连」的阻塞。
acceptance:
  - 新增 test/g0-rs-p6-recovery-driver-expression-syntax.test.mjs 语法门禁 3/3 绿（含事故形态负测）
  - npm run g0:result-studio:p6:update 真实跑通并写盘，node scripts/g0-rs-p6-product-acceptance.mjs 由 p6_stored_current_source_hash_mismatch 转 PASS
  - P6 证据 source binding 追平当前 HEAD（sourceCommitMatchesSourceHashes=true 且 sourceBindingStableDuringCapture=true）
  - closeout 定向门禁全绿；closeout:full 连续 3 次结果如实记录（不把未跑/红写成 PASS）
---

# BLOCK-448 · P6 恢复腿 driver 表达式语法修复（证据链解阻）

> **裁决来源**：用户 2026-11-14 发令「搞定 P6 恢复腿：change set 操作完成态不收敛」。
> **truthDomain**：`block-448-p6-recovery-driver-syntax`（层 1 唯一占用）。
> **形态自检**：不是新能力，是**验收装置缺陷修复** + 一条证据链解阻；不触碰 Result Studio 产品语义裁决、不改 M 蓝图阶段顺序、不放宽任何门禁基线。

## 1. 现象（可复现，2026-11-14 实测四次）

| 观测 | 值 |
| --- | --- |
| 入口 | `npm run g0:result-studio:p6:update` 与 `node scripts/g0-rs-p6-product-acceptance.mjs --live --keep` |
| 失败码 | `p6_recovery_active_electron_persisted_driver_failure` / `--live` 直跑为 `p6_recovery_active_electron_tree_termination_unconfirmed` |
| driver 失败阶段 | `inspect_active_operation_before_crash`（`waitForLifecycle(webContents, 'ready')`） |
| driver 写入的 lifecycle | **`null`** |
| 同一时刻 DOM 真值 | `[aria-label="Result Studio 版本与变更"]` 存在，`children[1]` 的 `data-state = "ready"`（诊断字段 `panelChildStates` 实证） |
| 后端事实 | 同轮 `[tools] Job … completed`；`/workspace/status` 26 项检查 `everyCheckReady: true` |
| 稳定性 | 四次同阶段失败，非 flaky |

## 2. 根因（单点，非状态机）

`scripts/g0-rs-p6-recovery-electron-driver.cjs` 的 `lifecycleExpression()` 返回的脚本存在**语法错误**：

```js
        publicProjectionAudit: { … },
      };                              // ← return 对象在此提前闭合
        publicProjectionHits: (() => {  // ← 之后出现属性名，被解析为 label
          …
        })(),
    })()
```

`webContents.executeJavaScript(script)` 对整段脚本抛 `SyntaxError`；调用点 `try { lifecycle = await … } catch {}` **静默吞掉**，于是：

```
lifecycle 恒为 null → data-state="ready" 永远读不到 → waitForLifecycle 跑满 WAIT_MS(120s) → 超时
```

⇒ 与「change set 状态不收敛」无关；`result-studio-lifecycle.js:440-446` 的 `status` 判定（`activeOperations` 非空**不**影响 status）本身正确，与 `test/result-studio-lifecycle.test.mjs:353`「status=ready 且 activeOperations 长度 1」一致。**产品侧无缺陷。**

潜伏期：该属性由 BLOCK-384 插入（诊断用），自 2026-09-25 最后一次 P6 证据之后无人跑通恢复腿；期间 P6 的红一直被上游 `p6_current_source_tree_not_exact`（工作区脏）掩盖。

## 3. 修复

1. **语法归位**：`publicProjectionHits` 移入 `return { … }` 对象内；`};` 移到对象真正闭合处。
2. **事故留痕**：`lifecycleExpression` 上方加 BLOCK-448 注释，写明三条纪律（模板串内禁反引号 / 新属性必须落在 return 内 / 改动后跑语法门禁）。
3. **机械门禁**：新增 `test/g0-rs-p6-recovery-driver-expression-syntax.test.mjs` —— 从 driver 源码配平截取两个表达式生成器，用 `new Function` 校验产出脚本语法；含「事故形态坏脚本必被 new Function 抓到」负测。
4. **失败可观测性**：driver catch 段新增 `diagnostics`（panel 是否存在、children 的 `data-state`、全页 `[data-state]` 清单、URL），使「读不到 lifecycle」这类故障不再只能靠猜。**保留为长期字段**，不设开关。

## 4. 验收门禁

| # | 判据 | 证据 |
| --- | --- | --- |
| 1 | 语法门禁 3/3（含负测） | `node --test test/g0-rs-p6-recovery-driver-expression-syntax.test.mjs` |
| 2 | 静态语法校验（修复前 FAIL / 修复后 OK） | `new Function(lifecycleExpression('ready'))` 三例 |
| 3 | P6 重采跑通并写盘 | `npm run g0:result-studio:p6:update` |
| 4 | 存量校验转绿 | `node scripts/g0-rs-p6-product-acceptance.mjs` → `PASS - N/N canonical checks recomputed` |
| 5 | 源绑定追平 HEAD | 证据 `sourceCommitMatchesSourceHashes=true`、`sourceBindingStableDuringCapture=true` |
| 6 | 收口链 | `npm run closeout` 定向全绿；`closeout:full` 三连如实记录 |

**红绿先行（HK-01）**：红 = 修复前 `new Function` 抛 `SyntaxError: Unexpected token 'return'`（已留痕）；绿 = 修复后三例 `[OK]` + 门禁 3/3。

## 6. 范围扩展（2026-11-14 二次诊断，同批交付）

语法修复后 P6 driver 走完全流程，语义断言暴露出**第二个、独立的产品缺陷**，属「搞定 P6」的必经路径，并入本包：

| 观测 | 值 |
| --- | --- |
| 失败形态 | `p6_recovery_active_electron_persisted_semantic_failure`（driver 正常结束、无 failedStage，但 `passed=false`） |
| driver 通过项 | `before.lifecycleState="ready"`、`activeOperationExplained=true`、`recoveryControlPresent=false`、`activeStageExplained=true`、`backendStatus.everyCheckReady=true` |
| 失败项 | `publicProjectionClean=false`；`publicProjectionAudit.rawInternalId=true` |
| 命中明细 | `job_6d1a0db688474fb9 @ Result Studio 版本与变更` ×3（`publicProjectionHits` 定位） |

**泄漏链**：`ContinueAnalysisMenu.tsx:20-22` 生成的指令文本含 `jobId`（发给 Agent 是**必需**的定位依据）→ 作为 `intent.requestedOutcome` 存进 change set → `result-changeset-service.js` 直接 `slice(0,500)` 投影为 `validationSummary.intentSummary` → `ResultStudioChangeSetPanel` 回显到版本面板 → 内部 ID 出现在用户可见文本。

**修法（单源，不动存储与 Agent 指令）**：

1. `core/shared-backend/redaction.js` 新增 `redactInternalIds()`，规则与 P6 验收断言（driver `rawInternalId`）同源：`\b(?:p|job|tj|rev|cs|conv|sel|wfg)_[A-Za-z0-9._-]{6,}\b` → `[内部标识]`。
2. `result-changeset-service.js` 的 `intentSummary` 投影改为 `redactInternalIds(input.intent.requestedOutcome).slice(0, 500)`。
3. 门禁：`test/block448-intent-summary-redaction.test.mjs` 4/4（内部 ID 族覆盖 / 不误伤普通文本 / 幂等 / 源码契约防裸 slice 回退）。

**边界**：只脱敏**用户可见投影**；`intentRef`、存储原文、Agent 指令一律不改；不新增依赖；不放开断言强度（`rawInternalId` 仍是硬断言，测试数据里的真实泄漏被修掉而非绕过）。

## 5. 边界与非范围

- 不改 Result Studio 产品语义（不改 `result-studio-lifecycle.js` 的状态判定）；不改 `activeOperations` 语义。
- 不改 M 蓝图阶段顺序、不提前实现 M6-B/C/D。
- 不放宽任何基线（P6 阈值/容差/证据 schema 零改动）。
- 证据诚实：`closeout:full` 三连若仍有红，如实标注归属，不写「全绿」。
- 同批需修复的连带项：`lifecycleExpression` 改动会使 P6 source binding 失配，因此**必须先提交源码改动再重采**（P6 要求工作区与 HEAD 在这 8+N 个源文件上逐字节一致）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
