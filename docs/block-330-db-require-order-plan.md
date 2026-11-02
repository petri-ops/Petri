---
capability: block-330-db-require-order
status: completed
goal: 断开 db 装配层 CJS 环（schema 顶层副作用 require connection ↔ connection 顶层回调 require schema），使 schema 可被独立 require；顺带把 dev-verify 证据文件名按平台自落（加性，旧文件不动）。
acceptance:
  - 契约 test/block330-db-require-order.test.mjs 4/4：schema 独立 require 真进程不崩且不建库；生产装配顺序 db.js→connection→schema 的 DDL 仍建表；源码契约「环不得加回来 + 退避表单一声明」；证据名 <slug>-live-<platform> 且 -live 不双拼。
  - 邻域回归：block328 5/5（含真进程持写锁启动集成）、block326 5/5、dev-verify 5/5。
  - 手工对账：node -e "require('./core/petri-server/db/schema.js')" 通过；装配顺序下 scientific_task_specs 建表仍在。
reopen: 既有证据文件（*-live-live.json / *-macos.json）不做迁移改名；若将来确需统一命名，须同步 impact-map 的 acceptance 路径与 ui-audit 引用后另案处理。
---

# BLOCK-330 — db 装配层循环加载收敛 + dev-verify 证据文件名平台化

状态：**completed（2026-11-02 当日立项当日收口）**
truthDomain：`block-330-db-require-order`
canonical 入口：本文件
关联：BLOCK-328（加载期守卫，抓真本循环）/ AUDIT-LOG 2026-11-02 🟡（db/schema.js 循环加载）与 2026-10-31 🟡（证据文件名平台化，后半个待裁点）

## 1. 裁决来源

用户 2026-11-02「其它几项都确定开整」→ 本轮 B 项（db 装配层循环收敛）+ C 项（dev-verify 证据文件名平台化，随 B 捎带）。

## 2. B：循环从哪来、怎么断

**成因**：`db/schema.js` 顶层 `require('./connection')` 是**纯副作用**（schema 从未使用 connection 的任何导出），而 `db/connection.js` 在 pragma 之后回调 `require('./schema').initSchemaWithBusyRetry(db)`——两者互为 CJS 环。先 require schema 的调用方（测试/工具/迁移脚本）在环内拿到半成品导出直接崩（`initSchema is not a function`）；BLOCK-328 把入口前置挂载只是把崩点后移到 `getCurrentG0Baseline` 的 TDZ。

**修法**（采纳 handoff 推荐①，属于"拆前基线拆后对账"式结构收敛而非加补丁）：
1. `schema.js` 删除顶层 `require('./connection')`，只保留 `require('../../shared-backend/g0-baseline')`——依赖恢复**单向** `connection → schema`。
2. 顺带删掉 BLOCK-328 留下的 `busyRetryDelays()` 幽灵副本（返回与 `BUSY_RETRY_DELAYS_MS` 重复的字面量），退避表回到**唯一声明**。
3. 前置挂载的两行 `module.exports.*` 与末尾 `Object.assign` 合并重复，删掉前置挂载（环不存在后不再需要）。
4. `connection.js` 导出先行于 schema require 的顺序**保留**（DDL 在 require 期执行，避免未来再加 require 时重现"部分导出缺属性"），注释改写为事实。

**行为零变化轴**：DDL 仍在 `connection.js` 建连 + pragma 之后执行（时序不变），`initSchema(db)` 签名不变，`BUSY_RETRY_DELAYS_MS=[2000,5000]` 不变。

## 3. C：证据文件名平台化（加性策略）

`dev-verify/lib.cjs::createRun` 现在按 `process.platform` 原值落证据名（`<slug>-live-darwin.json` / `-win32` / `-linux`），并在 payload 里写入 `platform` 字段（证据自述平台）。**旧文件一律不动**——改名重构要同步 impact-map 的 acceptance 路径与 ui-audit 引用，收益不抵迁移风险（handoff 推荐策略）。

细节：flow id 已以 `-live` 结尾时不再叠加 `-live`（旧 `...-live-live.json` 的双拼不再复制）；平台标签不做别名表（`macos`/`mac`/`darwin` 三种写法并存正是历史上要人工改名才分得清的原因）。

## 4. 非范围

- 不迁移/不改名任何既有证据文件（`*-live-live.json`、`*-macos.json` 原样保留）。
- 不改 `dev-verify` 的连接/截图/断言原语；不动 `run.cjs` 的退出码语义。
- 不做 db 层其它结构改造（DDL 外迁、迁移器调整均不在本包）。

## 5. 验收门禁与证据

| 门禁 | 结果 |
| --- | --- |
| `node --test test/block330-db-require-order.test.mjs` | **4/4**（schema 独立 require 真进程不崩且不建库 / 生产装配顺序 DDL 仍建表 / 源码契约禁环 + 退避表单一声明 / 证据名平台化 + `-live` 不双拼） |
| `node --test test/block328-early-loop-guard.test.mjs` | **5/5**（含真进程持写锁 2.5s 启动集成测，重试语义零变化） |
| `node --test test/block326-audit-debt-sweep.test.mjs` | **5/5**（`verify --list` 与 state 槽位未被本包改坏） |
| `node --test test/dev-verify.test.mjs` | **5/5**（证据名 + payload keys 契约同步更新） |
| 手工对账 | `node -e "require('./core/petri-server/db/schema.js')"` 通过；`db.js` 装配顺序下 `scientific_task_specs` 建表仍在 |

## 6. 完成语义

`completed`＝上述五组门禁全绿 + AUDIT-LOG 两条 🟡 翻 ✅。无新增依赖、无迁移、无 IPC/契约面变更。

G0 开发期常态 · 不外推 packaged/Provider/GA。
