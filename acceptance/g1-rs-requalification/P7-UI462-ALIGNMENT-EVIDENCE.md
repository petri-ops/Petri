# P7 资格契约与 UI-462 对齐 · 证据（2026-11-25）

> 发令：Orca msg_5bc541c8c0eb（owner「批了 冲吧」）。方案=P7-UI462-ALIGNMENT-DECISION.md（四问获批）。
> 纪律：HK-01 红绿先行、既有门零放宽、资格语义变化单列提示、不翻 qualificationEligible、owner 实例零触碰。

## §1 实现（按批准方案）

1. `core/shared-backend/result-studio-qualification.js`：
   - 保留 `REQUIRED_ENVIRONMENTS` 完整 13 项（含 `existing_clean_git`/`existing_dirty_git`）——**防历史证据 environmentTags 绑定漂移**；
   - 新增 `RETIRED_ENVIRONMENTS`（冻结）= UI-462 退役的两项；新增 `ACTIVE_ENVIRONMENTS`（冻结）= 完整集去掉退役项；
   - `evaluateResultStudioQualification` 的 `missingEnvironments` 改用 `ACTIVE_ENVIRONMENTS`——**新资格判定不再要求已退役的 existing_***。
2. `core/shared-backend/result-studio-evidence-bundle.js`：existing 两分支加 UI-462 退役标注注释——分支仅为**历史证据读取**保留（退役前 legacy 证据仍可解析、不冒充现行产品），新证据不得依赖这些标签。

## §2 资格语义变化（按 owner 要求单列）

- **变化**：新资格环境矩阵从 13 项要求收敛为 11 项（ACTIVE），不再把 `existing_clean_git`/`existing_dirty_git` 当作新证据缺口——因为 UI-462 已把「接入用户自有 Git 仓库」能力整体退役，要求 G1 资格去证一个不存在的能力属逻辑矛盾。
- **不变**：`qualificationEligible` 恒 `false`（G0 开发期常态，不翻）；五个 REQUIRED_TASKS、trace 步骤、不变量门零放宽；历史证据绑定不漂（REQUIRED_ENVIRONMENTS 未删项）。
- 这是**资格判据语义变化**，不是产品资格升级；不外推 packaged/Provider/GA。

## §3 HK-01 红绿先行

`test/g1-rs-p7-ui462-alignment.test.mjs` 红 4/4 → 绿 4/4：
1. 退役标注在场、历史枚举不删（防漂移）；
2. 新资格判定按 ACTIVE 集（源码断言 missingEnvironments 用 ACTIVE）；
3. evidence-bundle existing 分支标退役、历史引用可分离；
4. 资格语义零翻转（qualificationEligible:false 字面在场、REQUIRED_TASKS 未删、ACTIVE/RETIRED 冻结）。

全 G1 回归（P7 对齐 + qualification + P7 acceptance + compare + W1/W2/W3）49/49 绿。

## §4 边界

- 零新依赖、既有门零放宽、owner 实例零触碰、观感零代签；历史证据不冒充资格；heatmap 挂账（兄弟仓）与 W4/W5 外部挂账维持；19 WIP/frogfish 零触碰；push 绿批次回执据（本令授权）。P7 对齐子包随此收口。
