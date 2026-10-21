---
capability: qdomain-data-model
goal: Q-DOMAIN P4 垂直切片——项目 modality 默认域中性 `general`，领域包通过 pack.json `provides.modalities` 声明扩展值；未知值回落 general，存量 single-cell/spatial/bulk 兼容。权限通用化/域中性归零/结果页保真列为 reopen。
acceptance:
  - `resolveProjectModality`：基础值 general/single-cell/spatial/bulk + pack 扩展值；未知/缺省 → general。
  - `db.createProject` 未指定 modality → general（本地与 ssh 两路径）。
  - pack.json `provides.modalities` 归一（小写/去重/拒绝基础值与非法 id/≤20），仅有 modality 的包仍进贡献投影。
  - 测试 ≥4（纯函数/pack 装载/createProject 默认）；9223 实机腿 REST 6/6（默认/显式/未知三态）；closeout 十三门。
reopen: 权限通用化（single-cell/spatial gate → data）、domain-neutral baseline 归零、Result Studio 生信 UX 保真、导出/联邦基线、dataModelExtensions（artifact 类型/字段）契约。
status: completed
---

# BLOCK-230 · Q-DOMAIN P4 垂直切片：modality 默认 general + pack 扩展值

> 用户裁决：2026-10-21「只剩 E7 与 P4。搞定这俩」。
> 母纲：`docs/qoder-essence-absorption-plan.md` §6（P4 数据模型/权限；本包为数据模型第一片）。

## 1. P0 实码勘察

| 面 | 现状 | 结论 |
| --- | --- | --- |
| API 默认 | `api-data.js` 白名单含 general，但缺省写死 `single-cell` | 桌面默认应为 general |
| DB 默认 | `db.createProject` 两路径 `modality || 'single-cell'` | 需改 general |
| pack 契约 | `pack-contributions` 只投影 views/resultSurfaces/uiActions | 可扩 `provides.modalities` |
| 前端 | 桌面创建已传 `general`；标签已有「通用」 | 无需改 UI |
| 权限 | `permissions.js` 仍有 single-cell/spatial 专属 gate | 本片不动，列 reopen |

## 2. 范围

1. 新纯函数 `core/shared-backend/project-modality.js`（基础值/归一/解析）。
2. `pack-contributions` 投影 `provides.modalities`（仅有 modality 的包保留）。
3. `api-data` 创建项目走 `resolveProjectModality`（含已启用 pack 扩展值）。
4. `db.createProject` 默认 general。
5. 测试 + REST 实机腿 + closeout。

## 3. 非范围（reopen）

权限通用化、域中性 baseline 归零、Result Studio 生信 UX 保真、导出/联邦基线、dataModelExtensions（artifact 类型/字段）。

## 4. 红线

- 存量 `single-cell/spatial/bulk` 项目照常可读、可显式创建；不迁移、不改写既有行。
- 未知 modality 回落 general，不报错、不写非法值。
- pack 扩展值只做声明与校验，不执行包代码。
- 不改任何权限判定；默认值变更不改变显式传值语义。

## 5. 验收门禁

- `node --test test/block230-*.test.mjs`。
- `npm run verify -- block230-modality-live`（REST 6 断言）。
- `test:changed` + `quality:types` + `quality:lint` + `gate:code-size`。
- `npm run closeout` 十三门 PASS。

## 6. 完成语义

`completed` 需：纯函数/pack/创建路径/测试/实机腿/closeout。**明确声明**：这是 P4 的数据模型第一片；权限通用化与域中性归零仍 open，不得表述为「P4 已完成」。

## 7. 收口（2026-10-21）

**结论：BLOCK-230 Q-DOMAIN P4 数据模型第一片 completed。**

### 7.1 交付

- `core/shared-backend/project-modality.js`：基础值 general/single-cell/spatial/bulk；`normalizeModalities`（小写/去重/拒绝基础值与非法 id/≤20）；`resolveProjectModality`（未知/缺省→general，pack 扩展值可放行）。
- `pack-contributions`：读取 pack.json `provides.modalities`（非法形状 diagnostic）；仅有 modality 的包仍进贡献投影。
- `api-data` 创建项目：已启用 pack 的扩展 modality + 基础值；未知回落 general。
- `db.createProject`：本地与 ssh 两路径缺省 general（存量显式值不受影响）。

### 7.2 验证

- Node **4/4**：归一/解析/pack 投影（仅 modality 包保留）/createProject 默认 general。
- 实机 REST **6/6**：不传 modality → general；显式 single-cell 保留；未知 `nope` → general；创建后清理。
- `npm run closeout` 十三门 PASS（收口时执行）。

### 7.3 边界（reopen）

- **不是完整 P4**：权限通用化（single-cell/spatial gate → data）、domain-neutral baseline 归零、Result Studio 生信 UX 保真、导出/联邦基线、dataModelExtensions（artifact 类型/字段）仍未做。
- 存量项目不迁移、不改写；只影响新项目缺省与 pack 扩展值声明。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
