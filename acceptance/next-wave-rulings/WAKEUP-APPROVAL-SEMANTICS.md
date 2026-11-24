# 裁决材料 · agent 唤醒的审批语义（2026-11-24）

> 状态：**pending_user_ruling**（只出材料不开工）。定位：RULING-TABLE-2026-11-24 第 5 项的前置裁决；Jev 两波均指向此项（0.32→0.38，低置信=正因为治理魂面须主人裁）。
> 全部现状经核码（C-32 教训），引用处标文件:行为。

## 一、现状事实（核码四点，唤醒尚未实现）

1. **定时任务今天已经能自动提交 agent**：automation-runner 对 `kind=task` 的 schedule 直接 `POST /api/ai/agent`（`automation-runner.js:52-63`），无人值守提交链路存在——唤醒不是新执行器，是把「reminder 只落通知」升级为「到期自动提交」。
2. **提交默认走 guided 档**：runner 不传 automationMode → loop 契约默认 `guided`（`loop-contract.js:303`，三档=guided/confirm/trusted，`trusted`=legacy task_execute 自主档）。
3. **无人值守的审批现状=诚实失败而非免审**：guided 下需审批的工具调用会创建 approval request，但请求带 **TTL 惰性过期**（`approval-request-store.js:140-141` expiresAt→expired）——无人应答即过期、工具调用被拒、任务如实失败。即：今天定时任务「能用但会卡死在审批门」，这正是唤醒需要裁决的缺口。
4. **预算与目标门已覆盖**：提交前 goalGate 检查（`automation-runner.js:81-88`，goal 非 active/budgetLimited 即 skip）——唤醒不引入新的用量面。

## 二、裁决点（三个子问题，一次可批）

1. **档位**：唤醒任务允许不允许 `trusted`（自主）档？
2. **授权主体与范围**：谁授、授多大——per-schedule 显式白名单，还是全局开关？
3. **失败语义**：白名单外的审批缺口，维持「TTL 过期即诚实失败」还是排队等用户上线？

## 三、三方案

| 方案 | 内容 | 后果 |
|---|---|---|
| A 维持 guided | 唤醒只做「到期自动提交」，审批照旧 TTL 过期即失败 | 最保守；唤醒对需要写文件/跑命令的真实任务形同虚设（必卡审批），只剩纯读类可用 |
| **B per-schedule 预授权（推荐）** | 建/编辑 schedule 时**显式**授 trusted + 勾选免审工具族白名单 + 预算硬顶；白名单外工具仍走 guided 审批门（TTL 过期即诚实失败）；每刻运行带来源标注（schedule_id 血缘，审计链既有） | 无人值守≠免审——「授权是显式的、有范围的、可审计的」，治理透明魂保持；技术面小（loop 契约三档已存在，runner 提交带 automationMode+白名单即可） |
| C 全局免审直跑 | 唤醒任务一律 trusted、不设白名单 | 实现最省，但「睡了八小时，agent 免审跑了一夜」直接破坏动态审批治理魂——**不推荐** |

## 四、单一推荐：**B**

理由：①治理透明与本地主权是产品魂，无人值守场景的正确形态是「显式授权的自主」而不是「默认免审」或「诚实但无用」；②loop 契约三档与审批 TTL 机制全部现成，裁决后技术增量≈M（runner 传档+白名单参数、schedule 表加预授权清单列、设置面勾选）；③白名单外诚实失败保留「agent 做不了主的事如实上报」的人设。

## 五、裁决后技术增量预告（获批才开工，M）

1. schedule 表 additive 列：`auto_mode`（guided|trusted）+ `auto_tool_allowlist`（JSON 工具族清单）+ `auto_budget_cap`（可选，默认沿用 goal 门）。
2. runner 提交带 automationMode + 白名单透传（loop 侧零改动——三档契约已在）。
3. 审计：运行行与审批请求带 schedule_id 来源标注（血缘字段已具备）。
4. HK-01 红绿先行 + 定向测试 + 设置面勾选（UI 另点可并行）。

## 六、拍板口令（一句话）

- 「唤醒按 B」= 批准 B 档并立项 BLOCK-515（含 §五增量）；「按 A」= 只做自动提交不碰审批面（S）；「按 C」不推荐、需主人显式确认治理边界变更。
- 也可只批一半：如「B，但白名单只限只读工具族」。
