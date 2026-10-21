---
capability: qdomain-p4d-datamodel
goal: P4 余项收口——pack 声明式 dataModelExtensions（artifact 类型/字段扩展）契约 + 导出/联邦域中性基线；保持核心 canonical SDC-0 profile 不可覆盖。
acceptance:
  - S1：pack `provides.dataModelExtensions` + bounded loader；扩展 profile 经 SDC-0 校验后并入注册表，非法/冲突 fail-closed，canonical 6 profile 不可覆盖；无包=仅 canonical。
  - S2：导出/联邦基线——general 项目会话导出、delivery manifest 携带扩展 artifact 类型、联邦授权与文件透传不依赖生物 profile；既有 export/federation 套件全绿。
  - 域中性基线不恶化（11 处 / 6 键 compat）；test:changed + closeout 十三门 PASS。
reopen: 真实生信包当前没有新增 artifact 类型需声明；扩展契约以夹具 pack 验证。未来领域类型由 pack 直接声明，不改核心。
status: completed
---

# BLOCK-235 · Q-DOMAIN P4-D（dataModelExtensions + 导出/联邦基线）

> 用户裁决：2026-10-21「可以的 冲 P4余项」。
> 前置：BLOCK-234（P4-C S2–S6）completed；BLOCK-230/232/233 已收口。
> 母纲：`docs/qoder-essence-absorption-plan.md` §6 P4（数据模型/权限）。

## 1. 起点与契约裁决

P4 公开余项只剩两项：**导出/联邦基线** 与 **dataModelExtensions（artifact 类型/字段）契约**。

**dataModelExtensions 裁决：additive extension，不迁 canonical profile。**
- 核心保留 SDC-0 的 6 个 canonical profile（counts-matrix / sample-metadata / expression-matrix / deg / gene-list / enrichment-table）与 schema/兼容性引擎——这是 BLOCK-234 S3 的既有裁决（schema 引擎与 canonical profile 留核心，仅 actors 下沉 pack）。
- `dataModelExtensions` 是 Q0.5 host API 的第 11 类贡献点：**pack 可新增 artifact profile（类型/字段/规则）**，但不能覆盖 canonical ID、不能改写核心校验语义。
- 不执行 pack 代码；纯数据、有界装载、冲突/非法 fail-closed。
- 无包时 registry 仍为 canonical 6；扩展缺失只影响声明它的包能力，不影响通用结果/交付。

**导出/联邦基线裁决：只做回归证据，不为基线改业务。**
- 既有 `conversation-export`、`delivery-manifest`、`federation-grants`、federation job file 透传均已是领域中性实现（无 profile/modality 耦合）。
- 本包补一组基线测试，钉住「general 项目 + 扩展 artifact 类型」在导出/联邦链路上不被 canonical profile 假设污染；若测试抓出真实耦合，只做最小修复。

## 2. S1 — dataModelExtensions（扩展注册表）

### 2.1 pack 契约

`pack.json`：

```json
"provides": { "dataModelExtensions": "data-model-extensions.json" }
```

文件形状：

```json
{
  "version": 1,
  "artifactProfiles": [
    { "profileId": "petri.<family>.v1", "familyId": "petri.<family>", "...": "SDC-0 profile definition" }
  ]
}
```

边界：≤256KB、≤50 profiles、路径限 packRoot、坏形状整包该段忽略并留 warning；多包按 packId 稳定覆盖扩展（后包胜出 + warning），canonical ID 永远拒绝扩展覆盖。

### 2.2 core 接线

- 新增 `core/shared-backend/pack-data-model-extensions.js`：只读 bounded loader，返回 `{ profiles, warnings }`。
- `artifact-profiles.js`：在 canonical `ARTIFACT_PROFILES` 构建后、actor 合并前：
  - 对每个扩展 profile 调 `validateProfileDefinition`；
  - `profileId` 已存在（canonical 或先到扩展）→ 跳过并记录 warning（canonical 优先；同 ID 扩展后包覆盖前包按现有 loader 惯例）；
  - 合法扩展 `defineProfile` 后入表；actor 合并照常生效（扩展也可被 `artifact-profile-actors.json` 引用）。
- 导出 `ARTIFACT_PROFILE_EXTENSION_WARNINGS`（只读）供诊断/测试；不改现有 `getProfile/listProfiles/validateProfileRegistry` 语义。

### 2.3 测试（红绿先行）

- `test/block235-data-model-extensions.test.mjs`：
  - 夹具 pack 声明扩展 profile → `listProfiles()` 含扩展且 canonical 6 不丢；
  - 扩展 profile 可被 `getProfile` / `validateProfileDefinition` / actor 查询使用；
  - 扩展试图覆盖 canonical ID → 拒绝 + warning；两个包同 ID → 后包胜出 + warning；
  - 路径逃逸 / 坏形状 / 非法 profile → 跳过 + warning，canonical 不受影响；
  - 无包 → canonical 6 原样。
- 夹具：`test/helpers/data-model-extensions-pack-fixture.mjs` + `test/fixtures/data-model-extension.json`；需要注册表在装载时可见的腿用「先安装夹具 + 动态 import」隔离。

## 3. S2 — 导出/联邦基线

- `test/block235-export-federation-baseline.test.mjs`：
  - **导出**：general 项目会话经 `composeConversationMarkdown` 导出，消息逐字保留、无 modality/profile 字段泄漏；扩展 artifact 类型经 `delivery-manifest` 保留 `id/filename/type/sha256`，不要求 canonical profile。
  - **联邦**：`federation-grants` 对 general project 的 grant/revoke/read 与 modality/权限无关；federation job file 透传用通用文件（非生信文件名）仍字节一致（复用/扩展现有 federation-jobs 探针的纯逻辑腿，不新建网络栈）。
  - 既有 `conversation-export`、`delivery-manifest`、`federation*` 套件保持全绿。
- 若发现耦合：只做最小修复并附红绿证据；不扩大为导出/联邦重构。

## 4. 验收门禁

- 定向：S1/S2 测试 + 既有 `g0-sdc0-profile-registry`、`hle-c5r-regression`、`block131-domain-validation`、`agent-workflow*`、`conversation-export`、`delivery-manifest`、`federation*`。
- `node scripts/d7-baseline.mjs`：域中性基线保持 11 处 / 6 键 compat，0 新增。
- `npm run test:changed` + `npm run closeout` 十三门。
- 台账回写：plan、AUDIT-LOG、roadmap、handoff；pack 若需示例声明则双仓提交。

## 5. 红线

1. 不覆盖/不移动 canonical SDC-0 profile；不改 `validateProfileDefinition` 的必填与兼容性语义。
2. 不执行 pack 代码；扩展只接受纯 JSON profile。
3. 导出/联邦基线不改变既有产品行为；测试优先，真实缺陷才做最小修复。
4. 不引入新依赖；不把 artifact truth/repository 搬进 pack。
5. 单工作包串行：BLOCK-235 收口前不启动下一包。

## 6. 完成语义

S1+S2 全部收口、基线不恶化、closeout 十三门 PASS、台账回写后 BLOCK-235 转 `completed`。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 7. 收口（2026-10-21）

**S1/S2 completed；BLOCK-235 completed（P4 余项收口）。**

### 7.1 交付

- **S1 dataModelExtensions**：
  - 新增 `core/shared-backend/pack-data-model-extensions.js`：只读有界装载（≤256KB、≤50 profiles、路径限 packRoot、坏形状整段 fail-closed、多包按 packId 稳定覆盖 + warning）。
  - `artifact-profiles.js` 新增 `applyDataModelExtensions()`：扩展 profile 先过 SDC-0 `validateProfileDefinition` 才入表；已存在的 profileId（canonical 6 或先到扩展）一律拒绝并留 warning；扩展 actors 走既有 `artifact-profile-actors` 契约；注册表级校验失败时移除全部扩展并保留 canonical。
  - `ARTIFACT_PROFILE_EXTENSION_WARNINGS` 作为诊断出口；无包时 registry 仍为 canonical 6。
- **S2 导出/联邦基线**：
  - `block235-export-federation-baseline`：general 项目会话导出内容保真且无 modality/profile 字段；扩展 artifact 类型经 artifact manifest / delivery manifest 保真；federation grants 只按 projectId，不依赖 modality/权限。
  - `federation-jobs` 增加通用文件名（`notes.txt`）字节透传腿，证明联邦文件路由不要求生物扩展名/profile。

### 7.2 验证

- 定向：block235 S1 6/6、S2 4/4；既有 profile/actor/domain 21/21；workflow/HLE 85 pass + 2 skip；delivery/export 11/11；federation-jobs 1/1。
- `test:changed`：**443 项 / 432 pass / 0 fail / 11 skip** + 前端 5 文件 33/33。
- lint 0 error；arch 0 违规；knip 保留面 255；closeout **十三门 PASS**；`output:judge` PASS（fit 3.41，3 次 replay 稳定）。
- Jev：`test:suggest` 低于阈值（0 建议，如实记录）；`doc:suggest` 提示 planDoc（本收口节即回写）。

### 7.3 边界

- Canonical SDC-0 6 profile 未移动、未覆盖；扩展是纯数据 additive，不执行 pack 代码。
- 真实生信包当前没有新增 artifact 类型，扩展契约以夹具 pack 验证；未来领域类型由 pack 直接声明，不改核心。
- 无 UI 变化，未新增 UI 台账编号。
- **无 active 工作包**；下一包需用户发令。P4 的结构余项（多用户 admin UI 在桌面不存在）不在 G0 范围。G0 开发期常态 · 不外推 packaged/Provider/GA。
