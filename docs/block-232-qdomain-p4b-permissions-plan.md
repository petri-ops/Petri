---
capability: qdomain-permissions
goal: Q-DOMAIN P4-B 权限通用化——把 single-cell/spatial 专属 gate 收敛为通用 `data` 资源权限，保留 legacy 别名与存量存储语义；本地 admin 行为零变化。
acceptance:
  - `data` 成为通用数据面权限键；`single-cell`/`spatial` 降为 legacy 别名（显式任一为 true 即授予 data）。
  - `/api/data/*` 写 gate 改用 `data`；`/api/run` 计算 gate 改用 `tools` 或 `data`。
  - 存量 users/guest 权限 JSON 零迁移；legacy 键的逐键判定语义不变。
  - 本地 admin（LOCAL_USER.role=admin）gate 行为零变化。
  - 兼容测试 ≥10（can/effectivePermissions/normalize/gate/guest/admin）+ 实机 REST + closeout 十三门。
reopen: domain-neutral baseline 归零、Result Studio 生信 UX 保真、导出/联邦基线、dataModelExtensions、多用户 admin UI（当前桌面不存在）。
status: completed
---

# BLOCK-232 · Q-DOMAIN P4-B：权限通用化（data 资源权限 + legacy 别名）

> 用户裁决：2026-10-21「推荐先开 P4-B；现在立项开做」（承接 BLOCK-230 的 P4 reopen 第一项）。
> 母纲：`docs/qoder-essence-absorption-plan.md` §6 P4「单细胞权限分支改通用资源权限；迁移/兼容层」。

## 1. P0 实码勘察（2026-10-21）

| 面 | 现状 | 结论 |
| --- | --- | --- |
| `core/petri-server/helpers/permissions.js:28` | `MODULE_KEYS` 8 键（docs/blog/figcode/tools/skills/single-cell/spatial/copilot） | 新增 `data`，legacy 两键保留 |
| `permissions.js:207` | `/api/data/*` 写操作要求 `['single-cell','spatial']` 任一 | 收敛为 `data`（组内 OR 解析） |
| `permissions.js:202` | `POST /api/run` 要求 `['tools','single-cell','spatial']` 任一 | 改 `['tools','data']` |
| `permissions.js:125` | `_enforce` 在 `userId` 缺失时查 guest；登录态逐键 `can()`；admin 直接 next | 本地 admin 零拦截 |
| `core/petri-server/auth.js:8` | `LOCAL_USER = { role: 'admin' }`，桌面所有请求即 admin | **桌面权限 gate 结构性不拦截**；兼容语义面向历史多用户/guest |
| `core/petri-server/helpers/guest-permissions.js:9` | 解构 `_DEFAULT_PERMS`，但该符号从未导出 | 化石死 import，本包顺手清理 |
| `guest-permissions.js:44,81` | 两次逐键循环（同步/异步） | 共用同一解析器，避免第二套别名逻辑 |
| `core/petri-server/bootstrap.js:61` | `moduleGate` 在 `localIdentityMiddleware` 之后挂载；加载失败 fail-open 且大声 | 装配面零改动 |
| `frontend/src` | `grep permissions` 命中 0；无权限 UI/消费方 | 零前端改动，403 `module` 字段变更无消费方 |
| 权限写面 | 仓内无 `users.permissions` / `guest_permissions` 写路由（仅 authz 数据与 helper） | 不动 schema、不做迁移 |
| `test/domain-neutrality-baseline.json` | `permissions.js` 3/1/1/2、`guest-permissions.js` 1 | 本包不新增领域词；legacy 键保留，基线预期不变 |
| `test/helpers/domain-scan.mjs` | 块注释剥离先于行注释；`// --- copilot: all /api/ai/* ...` 中的 `/*` 会把 `moduleGate` 主体吞进“块注释” | **扫描器盲区**（当前少计 `moduleGate` 内 2 处）；本包不修扫描器，改注释后边界自然消失且同步移除两处 gate 词，计数仍为 3 → 记入 P4-C 输入 |

## 2. 范围

1. `permissions.js`：新增通用 `data` 键与 `MODULE_MSG`；`can('data')` 使用「data 组内显式键任一为 true」解析；`MODULE_KEYS`/`DEFAULT_PERMS` 保留 legacy 两键。
2. `moduleGate`：`/api/data/*` 写 → `data`；`POST /api/run` → `['tools','data']`。
3. `guest-permissions.js`：共用解析器；`GUEST_DEFAULT_PERMS` 增加 `data:false`；删除 `_DEFAULT_PERMS` 死 import。
4. 兼容测试 `test/block232-permissions-generalization.test.mjs`（红绿先行）。
5. 实机 REST 腿 + `acceptance/block-232/` 证据 + impact-map 登记。

## 3. 非范围（reopen）

domain-neutral baseline 归零（P4-C）、Result Studio 生信 UX 保真、导出/联邦基线、dataModelExtensions（artifact 类型/字段）、多用户 admin UI（桌面不存在）、扫描器盲区修复（P4-C 输入）。

## 4. 设计与兼容语义（D1–D4）

- **D1 单一通用键**：只加 `data`，不再造 `compute` 键；`/api/run` 的既有 `tools` 授权保留，`data` 作为数据面授权的自然延伸。
- **D2 别名组 OR（零迁移）**：`data` 组 = `[data, single-cell, spatial]`。解析规则=组内取显式出现的键，任一 `true` 即放行；一个显式键都没有时取默认（三键默认均 `false`）。这与旧 gate `['single-cell','spatial']` 的 OR 语义逐例等价；`can('single-cell')`/`can('spatial')` 的逐键语义**不变**（显式优先 → 默认），避免改变展示/存量判定。
- **D3 guest 同源**：同步/异步 effective map 都调用同一解析器；guest 存量 `single-cell:true` 自动获得 `data`。
- **D4 403 形状**：保持 `error:'module_forbidden'`；数据面拒绝的 `module` 字段变为 `data`，文案改通用资源口径。仓内零消费方，属有意收敛并在此留痕。

## 5. 验收门禁

- `node --test test/block232-permissions-generalization.test.mjs`（预期 ≥10 断言组，先红后绿）。
- `node --test test/domain-neutrality.test.mjs`（基线不得回退）。
- `npm run verify -- block232-permissions-live`（真实后端起、只读/无副作用探测）。
- `npm run test:changed:list` 可分类全部改动；`npm run closeout` 十三门 PASS。

## 6. 完成语义

`completed` 需：实现 + 红绿证据 + 实机腿 + 域中性门禁 + closeout。**明确声明**：这是 P4 的权限切片；P4-C 域中性归零、RS 保真、导出/联邦基线、dataModelExtensions 仍 open。

## 7. 收口（2026-10-21）

**结论：BLOCK-232 Q-DOMAIN P4-B 权限通用化 completed。**

### 7.1 交付

- `permissions.js`：新增通用 `data` 键；`DATA_MODULE_KEYS = ['data','single-cell','spatial']` 组内 OR 解析（显式任一 true 即授予）；`can('data')` 走 `resolveModulePermission`；legacy 逐键判定保持原语义；`/api/data/*` 写 gate → `data`，`POST /api/run` → `['tools','data']`；删除已不可达的 legacy 403 文案。
- `guest-permissions.js`：同步/异步 effective map 共用同一解析器；`GUEST_DEFAULT_PERMS` 增加 `data:false`；清理 `_DEFAULT_PERMS` 死 import。
- 兼容测试 `test/block232-permissions-generalization.test.mjs`（11 组）+ 实机 flow `block232-permissions-live`（3 断言）+ `acceptance/block-232/`。

### 7.2 验证

- 红绿先行：实现前 **4 pass / 7 fail**；实现后 **11/11 pass**。
- 域中性门禁：`domain-neutrality.test.mjs` 2/2；基线 100 键——减少 5（`api-data`/`db` 的 BLOCK-230 遗留、permissions 的 3 组领域文案），接受 1（`project-modality.js` 的 `BASE_MODALITIES` 兼容值，BLOCK-230 新增时该门未跑而漏登记）；`permissions.js::single-cell` 维持 3（legacy 别名必需）。
- 实机 REST **3/3**：health 200；`POST /api/data/__permission_probe__` → **404 而非 403**（admin 穿过 data gate）；`GET /api/data/projects` 200。非 admin 拒绝分支由单测覆盖（桌面 localIdentity 恒 admin，实机无法构造）。
- `test:changed`：23 个 Node 测试 **322 项 / 320 pass / 0 fail / 2 skip**；`npm run closeout` **十三门 PASS**（report 级 `skills:check` OK）；`quality:lint` 0 error、`quality:knip:check` PASS（新 flow 以动态入口定性入基线）。

### 7.3 实机抓真与边界

- 实机腿发现存量缺陷：`GET /api/auth/me` 在 standalone backend 恒 500（`server.js` 传 raw sqlite handle，`auth.js` 按 helper 模块调用）；前端零消费、不阻塞本包，已登记 AUDIT-LOG 🟡，本包未修。
- 域中性扫描器存在块注释盲区：`// ... /api/ai/* ...` 中的 `/*` 会吞掉 `moduleGate` 主体（少计 2 处）。本包改注释后边界自然消失、同时移除两处 gate 词，计数仍为 3；扫描器本体修复与全仓重基线归入 P4-C 输入。
- **不是完整 P4**：P4-C 域中性归零、Result Studio 生信 UX 保真、导出/联邦基线、dataModelExtensions 仍 open；多用户 admin UI 当前桌面不存在。G0 开发期常态 · 不外推 packaged/Provider/GA。
