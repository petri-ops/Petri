# BLOCK-435 · M6-A 结构单源第一刀

> 前置：M6（BLOCK-432）A 组把「三矩阵共用 schema / 28 文件绕桥 / resolveDataDir·readConfig 单源 /
> 12 环逐环消亡」整体记 `done-partial`（只读视图）；M7 逐件终态沿用。本包做其中**不需要产品裁决、
> 不触碰在制 WIP** 的第一刀，把「只读视图」升级为「可执行门 + 真收紧」。

## 范围（三项，逐项可机械核验）

| ID | 交付 | 判据 |
| --- | --- | --- |
| S1 | **三面共用 schema 生成器**（`scripts/m-blueprint-m6a-surface-schema.mjs`）：ipc / tool / route 收敛为单一 `entry = {kind,id,scope,exposed,consumed,riskTier?}` 形状，以真相源（`channels.js` / `tool-defs.TOOL_DEFS` / `routes/<module>.js`）为基准算漂移 | 结构必填/唯一性/空面恒红；矩阵自报计数 vs 实际行数不一致即红；漂移与已知缺陷**只减不增**棘轮 |
| S2 | **静默 catch 基线真收紧**：`ai-memory` 迁移 DDL 接单源后静默 catch 9→3，基线 `412 → 406`，并同步重生成 M6 分域视图与 M0 读数单源 | `gate:silent-catch` PASS 且基线=实际；`gate:m6-debt` / `m0-criteria` 0 issues |
| S3 | ~~架构环消亡一刀：抽 `helpers/permission-keys.js` 解 `guest-permissions` ↔ `permissions` 环~~ **已尝试 → 回退（blocked）**：实现与验证均通过（环 12→11、权限回归 11/11），但**触碰 BLOCK-83 D7 域中立棘轮**——被搬出的 `MODULE_KEYS`/`DEFAULT_PERMS` 含 legacy 领域别名 `single-cell`/`spatial`，搬到新文件即计为「核心生产代码新增领域词残留」。不改基线洗白、不用拼接字面量规避，原样回退（环基线恢复 12） | 回退后 `gate:arch-cycles` 12 环 PASS；待办：需 injection 重构或用户批准的 compat 条目 |

## 明确不做 / 已尝试回退

**S3 归因（保留证据，避免后人重走）**：环确实可解（`permission-keys.js` 抽出后 `gate:arch-cycles` 报 12→11、权限回归 11/11），
阻塞点是 `test/domain-neutrality-baseline.json` 的 D7 棘轮按「文件::词」计新增残留——键表里的 `single-cell`/`spatial`
是**合法的 legacy 权限别名**，但搬迁后落在新文件即判新残留。合规路径只有两条：① 改成注入式（permissions 持有键表，
guest-permissions 经参数接收），需改 4 处调用面；② 用户批准把该文件登记进 compat 白名单。本包不做 ①（超出第一刀范围）、
不做 ②（改基线性质、需裁决）。

## 明确不做（需要裁决或在制 WIP）

- **28 文件绕 desktopBridge 迁移**：触碰渲染层在制 WIP，且涉及 IPC 契约面，需独立包。
- **resolveDataDir 单源**：5 处实现中 `mobile-admin` / `federation-admin` 的兜底是 `cwd/data`，与 canonical 的
  `~/Documents/Petri-Local` **不同**；统一即改变这两处数据落盘位置（可能造成既有数据「看起来消失」）⇒ U 类。
  已核对：`user-prefs` 已委托单源，`projection-data` / `llm-transcripts` 与 canonical 仅差 `LOCAL_DATA_DIR` 优先级。
- **readConfig 单源**：仅 1 处实现，无重复可合并。
- **88 个未挂 impact-map 的测试**：按文件名自动挂载会制造**假覆盖**（M-56 正是这个教训），需逐测试判断归属。

## 验收门

`node scripts/m-blueprint-m6a-surface-schema.mjs --check` / `node --test test/m6a-surface-schema.test.mjs`（7/7）/
`gate:silent-catch` / `gate:arch-cycles` / `gate:m6-debt` / `m0-criteria` / `docs:check` / `docs:reconcile` / `test:changed` / `closeout`。

G0 开发期常态 · 不外推 packaged/Provider/GA。
