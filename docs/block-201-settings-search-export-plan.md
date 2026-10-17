---
capability: settings-search-export-reset
goal: BLOCK-201 = 阶段 A 速赢 II（runlist W2）＝ P0-3 设置搜索 + 分区过滤 + 按区重置 + 全景导出/导入。现状事实（§0 实码核对）：设置面板有 **10 个分区**（BLOCK-200 加 keymap/reasoning 后从 8 变 10，runlist 的「8 分区」口径已过时），定义在 `DesktopSettingsPanel/types.ts:31`；面板主体 `DesktopSettingsPanel.tsx` 696 行且已登记 code-size 台账（`scripts/code-size-ledger.mjs:54`），分区渲染是平铺的 `activeSection === 'x' && <Panel/>`；`shared-config` 注册表 **6 族 / 26 键**（feature-flags / decision-points / generation / cost-cap / keymap / reasoning），每族已有唯一写路由；**不存在任何跨族导出/导入/重置入口**，用户要备份只能逐节抄。本包做的是「把已注册的 6 族接上一个可搜索、可备份、可回默认的统一入口」，不是「把所有设置都收进注册表」（后者=runlist W4/B1b）。
acceptance:
  - P0 拆前基线：`test/block201-settings-baseline.test.mjs` 冻结「10 个分区 id / 6 族 26 键 / transfer 族集合==注册表族集合」；实现前红、实现后绿，此后不许为省事改它。
  - P1 搜索与分区过滤：`frontend/src/lib/settingsSearch.ts` 纯函数索引（分区名/描述/同义词，多词 AND，label 命中优先），与 `SETTINGS_SECTIONS` 逐项相等的漂移测试；`SettingsToolbar` 输入即过滤导航并显示命中数，无命中给可行动空态（不假装有结果）。
  - P2 按区重置：只有「本区设置确由注册表承载」的 5 个分区出现「恢复默认」（usage/decisions/keymap/reasoning/experimental），其余分区不显示假按钮；动作只清覆盖层回落代码默认，二次确认文案明确「不动对话/项目/结果/凭据」；重置后分区面板重挂载刷新（`settingsVersion` key）。
  - P3 全景导出/导入：`GET /api/config/export` 返回版本化信封（`format/version/families/excludes/envShadowed`），`POST /api/config/import` **先全量校验后落盘**（未知族/未知键/非法值/错版本 → 400 + 结构化 diagnostics，零写入），`POST /api/config/reset` 按族清覆盖层；导出只含**用户覆盖层**（不含默认值、不含 env 生效值、不含凭据），排除清单随信封回传（D-2）；导入=合并覆盖（不删除文件里未出现的键），往返幂等由测试钉住。
  - P4 诊断与门禁：BLOCK-199 漂移门扩一条「transfer 族集合==注册表族集合」；`config:doctor` 既有族诊断保持（本包不新造第二套诊断出口）；impact-map 为本包新面补规则（无 fail-closed 盲区）；前端 vitest 覆盖搜索/工具栏/导入导出面板，Node 覆盖 transfer 契约。
  - P5 兼容与收尾：不动 BLOCK-199 冻结基线（`test/block199-config-compat.test.mjs`）与 BLOCK-200 三份基线；不改任何既有默认值与写路由语义；reset 只写空覆盖层（不经 `readDoc()` 的 seedDoc，避免把默认当覆盖冻结）；closeout 十三门 + 五件套回写。
  - 完成语义：交付的是「注册表 6 族的搜索/备份/重置」，**不宣称「全部设置可导出」**（models 凭据/渠道、外观偏好、计算路径未进注册表，属 W4）；UI 实机腿未过则记 `in_progress`，不标 verified。
reopen: models/外观/计算路径等未注册落点的导出（W4/B1b 收编后并入本 transit）；设置项级搜索与深链（字段级索引）；导入的「整机恢复」语义（当前刻意只做合并覆盖）；导出格式版本 v2（新增族时需要迁移策略）。
status: active
---

# BLOCK-201 · 阶段 A 速赢 II（设置搜索 / 分区过滤 / 按区重置 / 全景导出导入）

执行序位置=`docs/stage-3-4-execution-runlist.md` 的 **W2**（W0=BLOCK-199、W1=BLOCK-200 已 completed）。
用户授权（常驻）：「不要问我所有工作决策你来定」+「能否做个plan 一次性 推完呢」⇒ 按 W0→W8 连打。
本包发令：用户 2026-10-17「开 W2」。

## 0. P0 勘察（实码核对，不是文档转述）

### 0.1 分区与面板

- `DesktopSettingsPanel/types.ts:31` 的分区表实为 **10 项**：general / models / compute / usage / decisions / keymap / reasoning / diagnostics / experimental / maintenance。runlist W2 行写的「8 分区」是 BLOCK-200 之前的旧口径，本包按 10 执行并在收口笔录更正。
- `DesktopSettingsPanel.tsx` 696 行、已入 code-size 台账（wave B）；分区渲染为平铺条件链（`:178` general → `:666` experimental）。
- 本包**不拆面板**（拆分会把《搜索/重置》变成一次无验收收益的大重构），改为新增独立 `SettingsToolbar` 与 `ConfigTransferPanel` 两个小组件，面板只加状态与两处挂载；新增行数由「拆一个 696 行文件」的替代方案承担，若后续再加面则按台账纪律先拆。

### 0.2 注册表与写面

- `core/packages/shared-config/config-schema.js` 424 行：6 族 / 26 键，`resolve / commitGuard / diagnoseObject / envShadowedKeys / findEntryByPath`。
- 六族写面：`/api/feature-flags`、`/api/ai/decisions/config/:point`、`/api/ai/generation-defaults`、`/api/ai/agent/cost-cap`、`/api/keymap`、`/api/ai/reasoning-defaults`。
- **无跨族入口**：`/api/config/*` 不存在 ⇒ 导出/导入/重置必须新建，但**不得再造第二套读写**：所有读写委派既有 helper（§2）。

### 0.3 既有安全姿态（本包必须对齐的）

- 凭据在 credential store，不在注册表族里；`ai-settings.json` 里可能有 `apiKey`/`credential_updates` 字段，导出**逐字段挑选**（generation/costCapCny/reasoning），绝不整文件序列化。
- 既有 models 导出（`useEndpointProfilesEditor.ts:381`）确认后写**明文 Key**，与 runlist D-2「凭据永不明文入导出」冲突。本包**不改它与不接管它**：全景导出走独立路径且不含凭据；冲突作为已知事实登记（见 §5 边界），是否收编既有导出留后续小批裁决。

## 1. 判定：patch 还是 refactor

**patch（新建薄层，不动既有读写实现）**。理由：六族读写已有唯一实现与唯一写路由，缺的只是「跨族打包/校验/分批应用」这一层；
若把六族读写复制进 transfer 才是第二真相（治理红线）。不触发「补丁堆积」三信号：不在同一处叠条件、不造第二变体、不绕过既有抽象（本层只调用它们）。

**刻意不做**：
- 不把 10 个分区/所有字段塞进注册表（W4 的范围，且会让本包失去验收边界）；
- 不做字段级搜索与深链（需要给每个字段建第二份描述表=负改善）；
- 不做「整机恢复」（导入只写文件里出现的键；否则一个残缺文件会静默清掉用户设置）；
- 不重写既有 models 导出（见 §0.3）。

## 2. 实现切面

### 2.1 后端（新建 2 文件 + 2 处 additive）

- `core/petri-server/helpers/config-transfer.js`：`CONFIG_TRANSFER_FAMILIES`（6 族）/ `exportConfig` / `validateImport` / `importConfig` / `resetConfigFamilies` / `CONFIG_TRANSFER_EXCLUDES`。
  - 读：`flags.readStore()`、决策 `configPath()` 直读**原始覆盖层**（不走 `readDoc()` 的 seedDoc，否则默认值会被当覆盖导出）、`getAiSettings().generation|costCapCny|reasoning`、`keymap.readStore()`；
  - 写：逐族委派 `setFlag / setPointConfig / saveGenerationDefaults / saveAiSettings / setKeymapBindings / saveReasoning`；
  - 校验：逐族 `commitGuard` + decision 接点白名单 + `reasoning.validateReasoningPatch`（从 `saveReasoning` 抽出的同一份摊平/守卫，不建第二套）；
  - 重置：`writeStore({})` / `clearPointOverrides()`（新 additive）/ `saveGenerationDefaults({null,null})` / `costCapCny=0` / `keymap.writeStore({})` / `saveReasoningSection({})`。
- `core/petri-server/routes/config-transfer.js`：`GET /api/config/export`、`POST /api/config/import`、`POST /api/config/reset`；拒绝=400+diagnostics，与 keymap/generation 同形；挂载在 `routes/index.js`（keymap 之后）。
- `helpers/decision-config.js`：+`clearPointOverrides()`（写空 `points`，不动 provider）。
- `helpers/reasoning-config.js`：抽出 `flattenReasoningPatch()` + 新增 `validateReasoningPatch()`（`saveReasoning` 复用同一份，行为不变）。

### 2.2 前端（新建 4 文件 + 面板 3 处挂载）

- `lib/settingsSearch.ts`：10 条索引（id/label/description/keywords 同义）+ `filterSettingsSections(query)`（多词 AND、label>keywords>description 打分）。
- `lib/settingsFamilies.ts`：分区→族映射（只登记 5 个真有注册表承载的分区）。
- `lib/configTransfer.ts`：export/import/reset 客户端（`getPlatformApiPrefix` + Bearer，400 diagnostics 原样返回）。
- `components/desktop/DesktopSettingsPanel/SettingsToolbar.tsx`：搜索框 + 命中计数 + 条件性「恢复本区默认」。
- `components/desktop/DesktopSettingsPanel/sections/ConfigTransferPanel.tsx`：导出（原生另存，浏览器退化下载）/导入（文件选择→后端校验）/排除清单与 env 遮蔽提示。
- 面板挂载：工具栏（header 下）、导航过滤与空态、5 个可重置面板加 `settingsVersion` key、maintenance 节挂 `ConfigTransferPanel`。

## 3. 验收证据

- `test/block201-settings-baseline.test.mjs`：10 分区 / 6 族 26 键 / transfer 族集合 / 无凭据字段（实现前红→实现后绿）。
- `test/block201-config-transfer.test.mjs`：信封形状、无凭据泄漏、往返幂等、未知键/未知族/错版本/非法值零写入、reset 回落、env 遮蔽点名。
- `test/block199-config-drift.test.mjs`：+1 条 transfer↔注册表集合相等（先红后绿：实现前 `CONFIG_TRANSFER_FAMILIES` 不存在）。
- 前端：`settingsSearch.test.ts`（索引↔分区逐项相等 + 匹配规则）、`SettingsToolbar.test.tsx`、`ConfigTransferPanel.test.tsx`。
- UI 台账：UI-516（搜索/过滤）、UI-517（按区重置）、UI-518（导出/导入）；实机腿未过保持 `in_progress`。

## 4. 边界与已知事实

1. **覆盖面诚实口径**：导出/导入/重置只覆盖注册表 6 族；models 渠道与凭据、外观偏好、计算路径属 W4（B1b）——UI 与导出信封都显式列出排除项。
2. **既有 models 导出明文 Key**（`useEndpointProfilesEditor.ts:381`）与 D-2 冲突：本包不接管、不改写；登记为后续小批（是否默认脱敏 / 是否移除明文选项）待裁决。
3. **reset 不写审计台账**：与既有设置写面一致（B 站无设置写审计）；导入/重置的可回溯性由「导出文件本身 + 面板提示」承担，若后续要审计需单独立项（避免本包顺手造第三套 ledger）。
4. **runlist 口径更正**：「8 分区」→ 实为 10（BLOCK-200 后）；收口时在 runlist W2 行注记。

## 5. 收口清单（完成时逐项勾）

- [ ] closeout 十三门全绿（或如实登记环境/邻居红归属）
- [ ] 五件套回写：plan（本文件 status）+ DOC-REGISTRY + README + roadmap/handoff + AUDIT-LOG
- [ ] UI 台账三条状态与实际证据一致（无实机腿不标 verified）
- [ ] impact-map 新面已登记（本包已加 `block201-settings-transfer`）
- [ ] 已知边界四条写进收口笔录，不粉饰
