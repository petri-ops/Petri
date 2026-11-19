---
capability: block496-ruling-registration-realign
status: completed
phase: CLOSED
goal: 登记漂移对齐（用户 2026-11-19 裁决「B 组按推荐的来」→ B7 对齐授权）——按 BLOCK-491 自带 reopen 条款「显式发令启动某个实现票时，本契约须同步重算并重开对应实现包」，把 block322-ruling-codification 契约的 implementationTickets 读数组从「收口时点快照（四票全 deferred）」重算为「当前真值（两票已实现/v2b 已授权/v2c 维持）」，登记与实况一致；治理批零产品代码。
acceptance:
  - 对齐真源落档：本文件 §3 实现状态表（机器可读，扫描器读数组的新读数源）+ §2 用户授权原话（2026-11-19 AskUserQuestion 答复原文）
  - 扫描器进化：scanImplementationTickets 改读 RULING-04 材料 §5（范围）+ 本文件状态表（现行状态）；状态枚举封闭（implemented/partially_implemented/authorized_pending_start/deferred_maintained/deferred_user_ruling）；validate 钉住当前真值（任一篡改即红，fail-closed 强度不减）
  - 消费测试更新：票状态锚迁移 + 新增篡改负测（翻任一票状态/抹授权段/证据缺席一律红）+ 已实现票证据文件在盘断言
  - RULING-04 材料 §5 补逐票状态行（指向本表；§4 裁决状态行不动；BLOCK-491 plan 历史文本不动——其 §4 是收口时点快照，现行状态以本表为准）
  - 契约/快照/manifest 原路径重算（reopen 条款语义）+ --check PASS + 单源重生成 + docs 门禁 + closeout 定向 + 六件套回写 + commit/push
  - 零产品代码写面 / 零新依赖 / 观感零代签 / 不碰 G1+
reopen: v2b（包3）或 P4-05 完整尺寸链（包4）收口时，按同一条款重算本契约的对应票状态；用户翻案任一状态时重算
supersedes: 无（BLOCK-491 plan §4 表保持原样作为历史快照；本文件是其现行状态投影）
---

# BLOCK-496 · 登记漂移对齐（BLOCK-491 契约重算）

日期：2026-11-19 · 关联：[BLOCK-491 裁决固化包](./block491-ruling-codification-plan.md)（reopen 条款）· [RULING-04 v2 材料](./block-322-ruling-04-feature-reference-v2.md) §5 · [BLOCK-494 实况核对](./block494-w2-implementation-tickets-readiness-plan.md) §2（漂移发现源）

## 0. 一句话

BLOCK-494 钉死的登记漂移（契约登记四票全 deferred vs 实况两票已实现），经用户 2026-11-19 授权（B 组按推荐=对齐），按 BLOCK-491 reopen 条款把契约重算到当前真值。**登记对齐 ≠ 改判**：D1–D5 五裁决形态一字不动；变的只是实现票生命周期状态。

## 1. 漂移与对齐范围

| 项 | 登记原值（BLOCK-491 收口时点） | 实况（BLOCK-494 钉死） | 对齐后 |
| --- | --- | --- | --- |
| P4-05b | deferred_user_ruling | 第一刀已实现（2026-10-30，测试+实机证据） | implemented（含证据指针） |
| P3-03-v2a | deferred_user_ruling | 已实现（c88f2fd9，2026-10-31） | implemented（含证据指针） |
| P3-03-v2b | deferred_user_ruling | 半实现；用户 2026-11-19 发令开工 | authorized_pending_start（2026-11-19） |
| P3-03-v2c | deferred_user_ruling | 未实现；用户 2026-11-19 裁决维持 | deferred_maintained（2026-11-19） |
| P4-05 完整尺寸链（主纲余量，非四票槽位） | 未登记 | 用户 2026-11-19 发令开工 | authorized_pending_start（附属读数，不入四票槽） |

## 2. 用户授权（2026-11-19 · 原话留痕）

- B 组裁决（会话消息原文）：「B 组 按推荐的来」——其中 B7=登记漂移对齐授权。
- A 组开工发令（AskUserQuestion 答复原文）：「#1 MIGRATION-IDEMPOTENT（推荐）, #2 v2b D2/D1 落地（推荐）, #4 C-56 手册内容稿（推荐）, #3 P4-05 完整尺寸链」（=四项全部开工）。
- C 组裁决（会话消息原文）：「C 组说『维持』」——C-50 维持登记 / v2c 维持 deferred / post-h9 D5 资产维持现状。
- C-47 方向裁决（AskUserQuestion 答复原文）：「方向 A（推荐）」。

## 3. 实现状态表（2026-11-19 对齐 · 扫描器读数源 · 机器可读）

| 票 | 状态 | 时点 | 证据/授权 |
| --- | --- | --- | --- |
| P4-05b | implemented | 2026-10-30 | acceptance/block-322-ruling04/p405b-live-macos.json（D5 数值对账：height 30 ✓ / width 120.4 ✗ 诚实 mismatch）；测试 test/rw06-p405b-dimension-lines.test.mjs + rw06-p405b-dimension-annotations.test.mjs |
| P3-03-v2a | implemented | 2026-10-31 | acceptance/block-322-p3/p3-03-v2a-live-macos.json（Blender 5.2.3 欧拉探针定案 + 面心对账 gap=0）+ commit c88f2fd9；测试 test/block322-p3-03-v2a-mate-rotation.test.mjs |
| P3-03-v2b | implemented | 2026-11-19 | 两票齐：后端契约票（BLOCK-498）D2 白名单键+D1 派生缓存（契约测 9/9+邻域 43/43）+ 第二票（BLOCK-504）CAD 导入链 occt-wasm 只读 faces→deriveImportFeatures 消费+featuresVersionKey 源 sha 锚定+前端编辑器切 aFeature/bFeature（契约测 8/8+前端 21/21+邻域 32/32）；证据=acceptance/block504-v2b-import-features/ + docs/block504-v2b-import-features-plan.md（第一票证据=acceptance/block498-v2b-d2-contract/） |
| P3-03-v2c | deferred_maintained | 2026-11-19 | 用户裁决「C 组说『维持』」；重开需新发令 |
| P4-05（完整尺寸链） | implemented | 2026-11-19 | BLOCK-499 落地：特征引用解析+尺寸链代数（D5 数值一致性）+SVG 链层+manifest 诚实翻转；实机腿=真实 STEP（occt-wasm）全链 9/9；证据=acceptance/block499-p405-full-chain/ + docs/block499-p405-full-chain-plan.md |

- **状态语义（封闭枚举）**：`implemented`（已实现且有证据指针）/ `partially_implemented`（部分实现）/ `authorized_pending_start`（用户已发令待开工）/ `deferred_maintained`（用户裁决维持不做）/ `deferred_user_ruling`（待发令）。
- **重开纪律**：任何票越过当前状态推进（含 v2b 后续票、P4-05 完整链、v2c 重开）一律需用户新发令；本表更新随对应包收口走。

## 4. 范围（本包做什么）

1. 对齐真源=本文件 §2/§3（登记即真源）。
2. `scripts/block491-ruling-codification.mjs`：scanImplementationTickets 重写（读 §5 范围 + §3 状态表；新状态枚举 + PATTERN_FLOOR.ticketCount=4 + p4_05_full_chain + alignmentAuthorized 读数）；validate 同步钉住当前真值。
3. `test/block491-ruling-codification.test.mjs`：票状态锚迁移 + 篡改负测扩充（翻任一票状态/抹授权段/证据文件缺席一律红）。
4. RULING-04 材料 §5 逐票补「状态」行（指向 §3 表；§4 与既有正则锚不动）。
5. 契约/快照/manifest 重算（原路径）+ --check PASS。
6. 证据落 `acceptance/block496-ruling-registration-realign/`（red-green 记录 + 状态表快照）+ impact-map 认领（W1 教训：新证据目录必须同批挂 rule）。
7. 收口：定向测试 + docs 门禁 + closeout 定向 + 六件套 + commit/push。

## 5. 非范围（exclusions · 红线）

- **零产品代码**：scene3d/features/cad-drawing/前端零改动（实现属包3/包4）。
- **五裁决形态不动**：D1–D5 readings 一字不改（本包只动 implementationTickets 组）。
- **BLOCK-491 plan 不改写**：其 §4 是收口时点快照，历史文本保留；现行状态以本表为准。
- **observers 不动**：boundaries 组（观感四槽 in_progress + pending_human_eye）读数与真源零触碰。
- 零新依赖 / 不碰 G1+ / 他方 WIP 零触碰。

## 6. 验收判据

- `node --test test/block491-ruling-codification.test.mjs` 全绿（含新篡改负测）；
- `node scripts/block491-ruling-codification.mjs --check` PASS；
- 骨架与邻域零回归（block322 邻域测试不受影响——本包零产品代码）；
- docs:check / ui:audit:check / closeout 定向绿；
- G0 开发期常态 · 不外推 packaged/Provider/GA。

---

## 收口笔录（2026-11-19 · 一次会话完成）

- HK-01：红 5（旧快照 vs 新锚，hk01-red-before-realign.txt）→ 重算 → 绿 11/11（hk01-green-after-realign.txt）+ --check PASS（契约 sha256 2ecee4a4…）。
- 执行修正 2 处（如实登记）：①授权段锚正则放宽为前缀匹配（标题含副题「· 原话留痕」）；②新代码 2 处 detect-object-injection 白名单键误报豁免（行级 disable+reason，warnings 基线零改动 P1484/T418/S539）。
- 提交：66083cf3（主批）+ 3db40c31（误报豁免随批）+ 本批（台账批）。
- 契约后续维护：包3（v2b）收口时按 reopen 条款更新 v2b 状态为 implemented（含证据）；包4 收口时更新 p4_05_full_chain。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
