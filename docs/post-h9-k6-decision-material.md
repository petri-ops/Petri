---
capability: post-h9-k6-decision-material
status: reference
goal: 按第四轮蓝图 §4 K6 为 ADMISSION 默认档 / FK 全量切换 / 统一 IPC 参数 schema / 空 catch 扫描根 / dev 双后端出 U 类一页材料，Agent 不代答、裁决前不改默认语义。
acceptance:
  - ADMISSION 与 FK 各含现状/候选/风险/推荐/证据/补腿条件
  - 既有裁决（workspace_exec 默认放行、FK 维持缓、ADMISSION 拨硬维持缓）不回退
  - 空 catch 扫描根扩展与 IPC schema 结构性改造写明独立切片条件
reopen: 用户裁决后按候选另立切片，四腿一致性门与生产路径负测齐备才落地
---

# post-H9 K6 U 类决策材料：ADMISSION / FK / IPC 边界

> 状态：`pending_user_ruling`（**Agent 不代答**）。本材料是决策输入，不是验收证据；
> `evidenceClass: decision-material`，`verdict` 禁用 PASS/verified/completed。
> 生成：BLOCK-402（2026-11-10）。既有材料 `docs/post-s7-h1-admission-fk-decision-material.md` 保留，
> 本文件按当前 HEAD 证据刷新，不改写历史。阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 决策 A · 执行准入默认档（ADMISSION）

### 现状（实证）

| 事实 | 证据 |
| --- | --- |
| `core/shared-backend/execution-admission.js:112-120` 默认 `observe`：只审计不拦 | file:line |
| `workspace_exec` 已真实消耗准入凭据（`docs/block-386-...` 四类拒绝 9/9）；`tools_executor` / `ssh_direct_runner` 两入口显式 deferred（`h9/structural-triage.json:14-22`） | 既有证据 |
| 既有用户裁决：「ADMISSION 拨硬维持缓」（AGENTS.md §6.1.4 / AUDIT-LOG 在册），本程序红线「不撤销任何既有用户裁决」 | canonical |

### 候选

| 候选 | 做法 | 后果 |
| --- | --- | --- |
| **A1（推荐）** | 维持 observe；把两入口 deferred 与 9/9 拒绝证据写进材料，等用户裁决 | 不回退裁决、不改默认语义 |
| A2 | 全局拨硬 enforce | 需先补齐两执行入口「出示并消耗凭据」+ 迁移连接同 pragma + 四腿一致性门 + 生产路径负测；未齐前会把正常本地执行误拒 |
| A3 | 分面档（按工具/工作区区分） | 需定义分面维度与审计口径，属新策略设计，需裁决 |

### 风险 / 推荐 / 补腿条件

A2/A3 都改变默认执行语义，属用户裁决面；推荐 **A1**。补腿条件：①三执行入口全部出示并消耗一次性凭据；②每个入口四类拒绝生产路径负测；③审计台账可回看；④裁决留痕。四条未齐前不改 `execution-admission.js` 默认档。

## 决策 B · SQLite 外键 FK 全量切换

### 现状

| 事实 | 证据 |
| --- | --- |
| 后端 `core/petri-server/db/connection.js:24-25` `foreign_keys=OFF`；桌面 `src/database/_db-singleton.js:86-90` `ON` → **运行时分裂** | file:line |
| BLOCK-372 曾实测 FK=ON 回归 **179 fail** 后回退 OFF，证据在册 | AUDIT-LOG `03d1d448` |
| H10 `acceptance/post-s7-2026-11-10/h10/cascade-scan.json`（已 tracked）记 16 条 CASCADE DDL / 11 条显式 delete 清单 | 证据 JSON |

### 候选

| 候选 | 做法 | 后果 |
| --- | --- | --- |
| **B1（推荐）** | 维持 OFF 三面一致 + 显式 delete 不依赖 FK（BLOCK-386 已 50/50 验证）；CASCADE 清单留作决策材料 | 不回退既有裁决、不引入 179 回归 |
| B2 | 全量切 ON | 需逐表清偿 179 违约 + 迁移连接同 pragma + 四腿一致性门，属独立大包；BLOCK-372 实测失败在前 |
| B3 | 分阶段按表切换 | 需逐表裁决顺序与回滚预案，仍属 U 类 |

### 风险 / 推荐 / 补腿条件

B2 会重演已实测的 179 fail；推荐 **B1**。补腿条件：用户裁决 + 逐表违约清单清偿 + 三处 pragma 同源 + 桌面/后端/迁移/测试四腿一致性门 + 生产路径负测。裁决前不改任何 pragma。

## 决策 C · 统一 IPC 参数 schema 与 env 豁免口

### 现状

- `src/ipc/_ipc-trust.js:32-37,88` 的 `PETRI_IPC_FILE_SENDER_EXEMPT_IDS` 被 `test/nso-w2-ipc-trust.test.mjs:50-53` 钉成期望行为（env 豁免放行），删除/收紧会破契约。
- 统一 `ipcMain.handle` 参数 schema 需覆盖全部 handle，属结构性重构（W2 蓝图 `:157-158` 出口判据仍是台账声明）。
- `test/silent-catch-baseline.json` 冻结 395 处，扫描根 `['core','src']`；扩到 `frontend/src`/`scripts` 会改冻结口径。

### 候选 / 推荐

**C1（推荐）**：豁免口逐件复核并记录 reason（保留契约钉住的行为，不擅删）；schema 与扫描根扩展各立独立切片。C2（立即删豁免 / 全局 schema / 扩扫描根）会破坏既有契约或需基线重打，红线禁止 Agent 代做。

### 补腿条件

①schema：复用既有 handler 注册点不建第二包装器，覆盖全部 handle + 越界负测；②豁免口：逐件复核留 reason 与到期复核；③空 catch：三分法逐处清零后扩扫描根，基线重打须显式留因 + 负测，总数只减不增；④dev 双后端「墙面板取消跨后端 15s 无效果」按 dev-infra §76 结构性修复方向（dev 模式 attach 到 :3001）另立包，不误判为产品缺陷、不擅自改进程模型。

## 证据（当前）

`acceptance/post-h9-2026-11-10/k6/k6-security-truth.json`、`k6-red-green.json`；`test/post-h9-k6-security.test.mjs` 14/14（含「擅自拨硬/切 FK/伪造裁决必红」负测）；`docs/post-s7-h1-admission-fk-decision-material.md`（既有材料，未改写）。

## 边界声明

本材料覆盖 K6 的 U 类三项，**未裁决前不生效**、不写 verified/completed、不冒充行为测试或实机证据。按蓝图 §5.3，K6 不停线空等，队列推进到 K7。
