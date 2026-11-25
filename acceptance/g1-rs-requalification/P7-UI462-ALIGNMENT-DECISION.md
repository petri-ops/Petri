# 「P7 资格契约与 UI-462 对齐」子包备料（2026-11-25 · 递 owner 裁决，未批不动）

> 来源：W3 核真（owner 裁决 msg_d8df1b1e636f 第②项）——改资格判据属裁决级，材料备好后递 owner 拍板（同四问形态），未批前 `REQUIRED_ENVIRONMENTS` 现状不擅动。
> 本件只备料，**不改任何资格代码/矩阵/证据**。

## §1 矛盾核真（三证链 + 资格侧）

| 侧 | 事实 | 位置 |
|---|---|---|
| 产品（canonical） | UI-462（2026-10-03 owner 裁决、10-30 verified）整体退役「接入用户自有 Git 仓库」；managed-only；consent UI/端点/存储/schema 全拆 | `docs/ui-productization-audit.md` UI-462 / UI-127 条目；`core/shared-backend/git-repository-binding.js:10`；`result-studio-repository.js:222` |
| 产品（代码零命中） | `existing_repository_not_attached_without_consent` 在 core 生产代码零命中，前端 consent UI 零命中 | W3 核真 |
| 资格（残留） | `REQUIRED_ENVIRONMENTS` 仍列 `existing_clean_git`/`existing_dirty_git` | `core/shared-backend/result-studio-qualification.js:18-19` |
| 资格（残留） | evidence-bundle 仍有 `repository.mode === 'existing' && consentObserved` 校验分支 | `core/shared-backend/result-studio-evidence-bundle.js:278,447` |

矛盾：P7 资格矩阵要求测一个产品已删除且 canonical 判失效的模式，逻辑不成立。

## §2 四问/方案（请 owner 拍板）

1. **是否清理资格矩阵残留？** 建议：**清理**——把 `REQUIRED_ENVIRONMENTS` 的 `existing_clean_git`/`existing_dirty_git` 标为 `retired_by_ui462`（保留枚举项但标退役，不删以防历史证据绑定漂移），evidence-bundle 的 existing 分支加 `retired` 标注且不再要求新证据（历史 P7 证据若引用 existing 须如实降级）。理由=与 canonical UI-462 对齐，避免 G1 资格去证一个不存在的能力。
2. **影响面**：只动资格判据/evidence-bundle 的标注，不动产品代码、不复活能力、不改 `qualificationEligible`（G0 常态不变）。
3. **验证**：HK-01 红绿（退役标注在场、新证据不要求 existing、历史引用如实降级）+ 资格门邻域回归；不跑真实 Provider/packaged（G1+ 矩阵不在本子包）。
4. **退出成本**：标注为 additive，撤销只删标注不改产品/历史证据本体。

**请 owner 只回「行/不行」**：行→按建议清理资格矩阵残留（单独立子包实现）；不行→保留现状并在 AUDIT-LOG 注明「资格矩阵与 UI-462 未对齐」缺口，不擅动。

## §3 边界

- 未批前 `REQUIRED_ENVIRONMENTS` 与 evidence-bundle 现状零改动；不动 W3 historical alternative 子项；heatmap/W4/W5 挂账维持；不翻资格、不外推 packaged/Provider/GA。
