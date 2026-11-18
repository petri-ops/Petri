---
capability: block494-w2-tickets-readiness
status: completed
phase: CLOSED
goal: W2 已裁决实现票准备（BLOCK-492 plan §3 W2 · 无人值守提示词 §5 S2）——逐票核对 P4-05b / P3-03 v2a / v2b 的登记状态与仓库实况，补齐真正缺位的 HK-01 契约测骨架（skip 形态承载、启动时去 skip 即红），登记「登记 vs 实况」漂移；零产品实现落地（实现票保持逐票待用户发令）。
acceptance:
  - 三票实况核对完成：P4-05b 第一刀 / v2a 已实现且有测试与实机证据（本包实测 23/23 绿）；v2b 半实现（特征表纯函数库+同源移植+探针定案在场；D2/D1 契约与接线缺位）——逐票登记证据指针
  - v2b D2/D1 契约测骨架落档：skip 形态（deferred_user_ruling），环境开关复跑可捕获真实红（对当前树 aFeature 不在白名单）；断言严格从已裁决形态（D1 派生缓存/D2 白名单键/D3 禁建模 API/D5 数值判据）导出，不发明新契约
  - 登记漂移如实登记不改判：RULING-04 §5 与 BLOCK-491 implementationTickets 登记「三票 deferred」vs 实况「P4-05b 第一刀+v2a 已实现（BLOCK-322 时代 2026-10-30/31 落地）」——BLOCK-491 契约重算须按其 reopen 条款由用户发令，本包只登记
  - 探针实况核对：v2a 前置探针已在场（Blender 5.2.3 实测定案 + live 证据 gap=0；材料写 4.5 属版本号登记漂移，本机在场 5.2.3 LTS 与探针一致）；特征 id 稳定性探针已在场（内核哈希不可用→几何签名，RULING-04 §7 要求的「v2b 第一张票探针定掉」已完成）
  - 零产品代码写面 / 零新依赖 / 观感零代签 / 不碰 G1+ / 六件套回写 + commit/push
reopen: 用户发令启动任一实现票（v2b D2/D1 落地或 P4-05 完整尺寸链）时，对应骨架去 skip 转红→实现→绿，并按 BLOCK-491 reopen 条款重算其契约
supersedes: 无（执行 BLOCK-492 plan §3 W2；登记漂移的对齐本身列为用户动作项）
---

# BLOCK-494 · W2 实现票准备（实况核对 + v2b 契约测骨架）

日期：2026-11-19 · 执行依据：[`block492-full-work-execution-plan.md`](./block492-full-work-execution-plan.md) §3 W2（用户预授权无人值守提示词 §5 S2）· 关联：[BLOCK-491 裁决固化包](./block491-ruling-codification-plan.md)（其 reopen 条款）· [RULING-04 v2 材料](./block-322-ruling-04-feature-reference-v2.md)

## 0. 一句话

W2 预设「三票全 deferred、只备骨架」，实况核对发现 **P4-05b 第一刀与 v2a 已在 BLOCK-322 时代（2026-10-30/31）实现并有测试与实机证据**——本包把实况钉死、把唯一真正缺位的 v2b D2/D1 契约测做成可激活的红绿骨架、把登记漂移如实登记（改判归用户）。**零产品实现落地。**

## 1. 三票实况核对表（本包实测，2026-11-19）

| 票 | 登记状态 | 仓库实况 | 证据 |
| --- | --- | --- | --- |
| **P4-05b 第一刀**（tolerances[].feature 可解析引用 + HLR 尺寸线/文字，D5 数值判据） | BLOCK-491 §4：`deferred_user_ruling` | ✅ **已实现 + 已接线**：`resolveToleranceFeatures` + `buildGdtAnnotationLayer` 在 `model3d-cad-drawing.js:58-62` 主链；测试 `test/rw06-p405b-dimension-lines.test.mjs`（5/5）+ `rw06-p405b-dimension-annotations.test.mjs`；实机证据 `acceptance/block-322-ruling04/p405b-live-macos.json`（recordedAt 2026-10-30：occt-wasm 真实 STEP 腿 + SVG 数值对账，height 30 ✓ / width 120.4 ✗ 诚实 mismatch 在册 + occt 枚举小写勘误） | 测试 23/23 绿（本包复跑）；manifest `capabilities.gdt/dimensions` 保持诚实 false（完整 GD&T 尺寸链仍需特征级引用=P4-05 主纲余量，另案） |
| **P3-03 v2a**（局→世合成，带旋转平面贴合；D4 ruled 先行） | BLOCK-491 §4：`deferred_user_ruling` | ✅ **全实现**：提交 c88f2fd9（2026-10-31「feat(block-322): P3-03 v2a…RULING-04 v2 §5 第 2 票」）；`scene3d.js:660` 起旋转合成 + `applyMateConstraintV2a`；测试 `test/block322-p3-03-v2a-mate-rotation.test.mjs`（5/5 + v1 兼容锚：90° 组合可解语义锁 + 45° 不可解 fail-closed）；实机证据 `acceptance/block-322-p3/p3-03-v2a-live-macos.json`（Blender 5.2.3 探针定案 + 面心对账 gap=0 + rotation 读回一致） | **欧拉序探针已实测在场**（不设 rotation_mode 默认 XYZ、Rz·Ry·Rx 列向量右乘）；材料写「Blender 4.5」与实机 5.2.3 LTS=版本号登记漂移（本机 `/Applications/Blender.app` 即 5.2.3，探针与环境一致） |
| **P3-03 v2b**（features[] 数据模型 + 基元派生 + CAD 抽特征 + sidecar sha 锚定 + 前端编辑器；2 票） | BLOCK-491 §4：`deferred_user_ruling` | ⏳ **半实现**：①特征表纯函数库在场（`core/petri-server/helpers/model3d-features.js` 111 行：derivePrimitiveFeatures/deriveImportFeatures/featureId）；②前端同源移植在场（`frontend/src/lib/workSurface/sceneFeatures.ts` + 契约对账测试；R4 合规不引后端）+ `SceneConstraintEditor.tsx` 消费特征表（其 aFeature→aFace 是 UI 命名映射，提交的是既有 `aFace` 键，**非 D2 契约键**）；③稳定性探针定案在场（`acceptance/block-322-p3/v2b-stability-probe.json`：内核 subShapeHashes 同进程两次 import 即漂移→不可用；几何签名 sha256(kind|量化体积|量化 bbox) 跨进程全匹配——RULING-04 §7「v2b 第一张票探针定掉」要求已完成） | **真缺口**：D2 白名单键 `aFeature`/`bFeature`（`scene3d.js` 零命中）；求值器消费 `features[]`（D1 派生缓存+fail-closed）；CAD 导入链抽特征接线（`deriveImportFeatures` 在 core 内零调用者）；sidecar sha 锚定。这些=本包骨架的断言对象 |
| **v2c**（曲面/边） | `deferred`（材料已判不做） | 未实现（符合预期） | — |

## 2. 登记漂移（如实登记，不代改判）

- **漂移内容**：RULING-04 材料 §5「开工序」与 BLOCK-491 契约 `implementationTickets` 读数把 P4-05b/v2a/v2b 全部登记为待发令；仓库实况是 P4-05b 第一刀与 v2a 已于 2026-10-30/31（BLOCK-322 主纲时代）实现（提交信息即引用「RULING-04 v2 §5 第 N 票」，属当时发令链）。BLOCK-491（11-18）固化时按材料文本登记，未核对仓库实况。
- **性质**：登记漂移（同 3D 蓝图 §10 类），非新越权实现，也非本包引入。
- **处置边界**：BLOCK-491 契约（`resources/ruling-codification/block322-ruling-codification.json` + 消费测试）的 reopen 条款明确「显式发令启动某个实现票时本契约须同步重算」——**登记对齐需用户发令**，本包不改该契约；列入最终报告用户动作清单。
- **RULING-04 材料 §1 行号漂移**：所引 `scene3d.js:556-573/:445-448/:473` 系 2026-10-31 快照，现行行号已漂移（mate 校验区现约 :421-474、tolerances 现 :474-482、v2a 合成区现 :660+）；启动实现票时须重新锚定。

## 3. 本包交付物

1. **v2b D2/D1 契约测骨架**：`test/block322-p3-03-v2b-d2-contract.test.mjs`——skip 形态承载（`skip: deferred_user_ruling`），`BLOCK322_V2B_SKELETON_ACTIVE=1` 环境开关复跑可捕获真实红；断言严格从已裁决形态导出：
   - D2：mate 约束白名单收 `aFeature`/`bFeature` 可选键；无新键的旧约束零迁移可解；
   - D1：`features[]` 派生缓存语义——版本键=sourceSha256（导入件）/dimensions 指纹（基元）；与源不一致 fail-closed（口径沿 `mesh_source_hash_required`）；特征 id=几何签名（探针定案），禁内核哈希作跨会话 id；
   - D3：特征派生链禁 OCCT 建模 API（静态负测：`model3d-features.js` 不引内核建模方法）；
   - D5：数值判据先例引用（P4-05b 已示范的「标注文本+投影坐标+解析尺寸一致」）。
   - **红证据**：本包以环境开关复跑捕获真实红（当前树 aFeature 不在白名单），落 `acceptance/block494-w2-ticket-readiness/v2b-d2-skeleton-red.txt`；绿等实现票启动。
2. **实况核对证据**：`acceptance/block494-w2-ticket-readiness/evidence.json`（三票核对表 + 测试复跑读数 + 探针在场核对）。
3. **影响图**：新测试挂 rule（并入 `next04a-3d-foundation` 的 tests 清单，其已携带 v2b 姊妹测试）。
4. **六件套回写 + commit/push**。

## 4. 非范围（exclusions · 红线）

- **零产品实现落地**：不改 `scene3d.js` / `model3d-features.js` / `model3d-cad-drawing.js` / 前端组件（实现票逐票待用户发令；R2 预置裁决明确）。
- **不改 BLOCK-491 契约**：登记对齐待用户发令（其 reopen 条款）。
- **不启动 P4-05 完整尺寸链 / v2c**：维持既有判定。
- 零新依赖 / 观感零代签 / 不碰 G1+ / 用户资产与在他方 WIP 零触碰。

## 5. 验收判据

- `node --test test/block322-p3-03-v2b-d2-contract.test.mjs`：skip 形态全绿（skip 计数如实）；`BLOCK322_V2B_SKELETON_ACTIVE=1` 复跑真实红（证据落 acceptance/）；
- 三票实况测试复跑：`block322-p3-03-v2a-mate-rotation` + `v2b-features` + `v2b-constraint-ops` + `rw06-p405b-dimension-lines` + `rw06-p405b-dimension-annotations` 全绿（23/23）；
- `npm run docs:check` + `npm run ui:audit:check` + `npm run closeout`（定向）绿；
- 零产品代码 diff（`git diff --stat` 仅 test/docs/acceptance/impact-map/registry）。

G0 开发期常态 · 不外推 packaged/Provider/GA。

---

## 收口笔录（2026-11-19 · 一次会话完成）

- 判据达成：三票实况测试复跑 23/23 绿；骨架 skip 模式 2 绿+6 skip（不挂门禁）、激活模式 3 真红恰对三缺位+5 绿锚（红证据 acceptance/block494-w2-ticket-readiness/v2b-d2-skeleton-red.txt）；closeout 定向链 exit=0。
- 夹具校准注记：红必须是契约缺席红——两轮校准（version='scene3d/v1'、parameters:{} 必填、成功形态无 errors 字段改用 ok===true 判）后，激活态红=D2①/D1①/D1③ 三条恰好对应三缺位实现面；D2② 零迁移锚与 D1② 几何签名锚为绿（已实现面）。
- 提交：4d36b1e0（立项+交付批）+ 904fdbf1（coverage 随批）+ 本批（台账批）。
- 骨架激活路径：实现票获发令 → `BLOCK322_V2B_SKELETON_ACTIVE=1 node --test test/block322-p3-03-v2b-d2-contract.test.mjs` 复跑确认红 → 最小实现转绿 → 去 skip 纳入常规定向集。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
