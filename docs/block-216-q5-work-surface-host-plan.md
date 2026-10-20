---
capability: q5-work-surface-host
goal: Q5 统一工作面 host — 建立 core+pack 共享的 work surface 注册表、稳定 tab 状态机、pack 视图/结果面/UI 动作贡献通道与生成文件/计划/证据面；为 Q-DOMAIN P2-UI 与 P2b 提供唯一 host 契约。
acceptance:
  - 纯函数测试覆盖 tab 身份/单例/序号/关闭策略/持久化与未知 surface fail-closed；生成文件来源判定四态。
  - 后端 `/api/packs/contributions` 只返回已安装/启用 pack 的合法贡献；非法形状/路径穿越/未知 kind fail-closed；pack 卸载/停用即消失。
  - 前端统一 host 可挂载 core surface 与 pack iframe surface；pack 缺失时显示诚实空态，不回退成第二套真相。
  - 从聊天/面板打开文件、审阅、计划、生成文件、证据后标签保持，支持 close others/right/all；实机 flow + 截图落 acceptance/block-216/。
  - closeout 十三门 PASS。
reopen: 终端分屏（E9）；Q3 事件级证据面扩展；P2-UI 动作下沉；P2b 生信 resultSurface 物理迁移；Q8 插件安装/信任面；Q9 外壳打磨。
status: completed
---

# BLOCK-216 · Q5：统一工作面 host

> 用户裁决：2026-10-20「我点头」（批准按「Q5 → P2-UI → P2b → Q6 → P3 → P4」推进，Q5 作为波次开发第一包，同时作为 P2-UI/P2b 的前置 host）。
> 方向母纲：[`qoder-essence-absorption-plan.md`](./qoder-essence-absorption-plan.md) §6-Q5；插件架构口径=§2.5 B（边缘插件化、内核不插件化）；Q-DOMAIN 依赖=§7「Q5→P2b，P2→Q5」。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 0. P0 实码勘察（2026-10-20）

### 0.1 现状：三套并存的“工作面”，缺统一身份与贡献通道

| 面 | 现状证据 | 结论 |
| --- | --- | --- |
| 右栏 tab | `rightPanelTabs.ts:6` 九个硬编码 id；`useRightPanelTabs.ts:29-49` 仅 open/close 单键；`RightPanel.tsx:165-281` 按 id 硬编码渲染 | 有 tab 条（title bar pills），无统一 descriptor、无 close others/right/all、无持久化、无 pack 入口 |
| 文件 tab | `RightFileTree.tsx:617-632` 已实现 close/others/right/all/reopen；`workspaceFileTabOps.ts` 纯函数 | UI-451 已成熟，**不重写**；只把关闭策略/身份语义抽到共享模型并保持行为 |
| 工作区模式 | `useWorkspaceRouting.ts:8` chat/scheduled/result/code/compare/history 由 URL 子路径驱动 | 路由真相，**不并入 tab**；surface descriptor 只做身份/门控，不改路由 |
| 结果面 | `resultSurface.ts:8` 四模式；`viewerRegistry.ts:29` 九 adapter；结果页当前是核心内硬编码 | P2b 才物理下沉；Q5 只建 result surface host 解析与挂载点，保留核心 transitional 面 |
| 分屏 | `ArtifactPinPane.tsx:30` 已有 60/40 可拖拽双栏 | F7 的可用基座；Q5 不做通用窗格重写 |
| pack 贡献 | `pack-registry.js:128` 已保留 `provides`；`projection-data.js:142-157` 只暴露安装记录，不暴露 provides | Q5 新增只读贡献投影接口，不建第二套 pack 注册表 |
| 计划面 | `plan-ui-tools.js:20-46` 落 `copilot_plans`；`routes/ai-plans.js` 已有 list/get/approve | B3/H4 可直接消费既有 API，不新建计划真相 |
| 生成文件 | `conversationChangesStore.ts:117` 有路径/状态/工具/迭代；`conversationRunStore` 有 toolActivities 结果 | E3 可消费既有数据；工具记录内容缺失时如实显示“无可用记录” |
| UI 动作 | `act-tools.js:70-92` 单细胞动作/页面标签仍硬编码；前端无通用 action host（旧页面已退役） | P2-UI 下沉前，Q5 先建 action registry + pack iframe 窄桥；本包不删单细胞动作 |
| 文件管理器显示 | `src/ipc/file-dialog.js:284` 有 `shell.showItemInFolder`，但无 IPC 通道 | E4 补齐通道 + preload + 前端动作 |

### 0.2 设计裁决（P0 定稿）

1. **host 不是新布局**：Q5 的统一 tab 先覆盖右轨（files/results/browser/review/jobs/io/agent/analyze + 新增 generated/plan/evidence + pack surfaces）；工作区 URL 模式、底部终端、侧聊维持现有宿主，只通过 descriptor 统一身份与门控。避免第二套路由/面板真相。
2. **descriptor 单源**：core surfaces 与 pack surfaces 进同一注册表；id 稳定（`core:<id>` / `pack:<packId>:<viewId>`），重复 id fail-closed。title bar 与右栏同源读取。
3. **pack 视图走 iframe 窄桥**（复用 Gen UI 安全口径）：后端只读提供 pack 资产，`sandbox` 无脚本以外权限；host→iframe 只传 surface context/theme/action；iframe→host 只收 ready/action-result，未知消息丢弃。
4. **未知 kind/能力 fail-closed**：非法贡献不进入注册表；pack 缺失/停用 → surface 消失，显示“安装对应领域包”诚实空态，不伪装成通用面。
5. **结果面 host 先解析后迁移**：Q5 建 `resultSurfaceHost`（pack descriptor 匹配 + core transitional 标记）；P2b 再把生信结果页物理迁入 pack，Q5 不做通用化。
6. **生成文件四态**：empty（无改动）/ loading（会话数据未就绪）/ error（工作区读取失败）/ no-evidence（无工具记录内容）；当前工作区版本与工具记录分开呈现，不把未知写成成功。
7. **持久化**：右轨 tab 状态按 projectId 存 localStorage，恢复时只保留注册表内 surface；未知/已卸载 pack drop，活动 tab 回退到首个合法项。

## 1. 切片

### P1 — 纯模型与注册表（core）

- `frontend/src/lib/workSurface/model.ts`：`WorkSurfaceDescriptor` / `WorkSurfaceTab` / `WorkSurfaceId`；open/close/closeOthers/closeRight/closeAll/reorder/active fallback/serialize/restore 纯函数。
- `frontend/src/lib/workSurface/registry.ts`：core descriptor 清单 + pack 贡献合并；重复 id/非法 shape/未知 kind fail-closed；`resolveWorkSurface`。
- `frontend/src/lib/workSurface/generatedFileSource.ts`：生成文件来源判定（workspace-current / tool-recorded / unavailable / no-evidence）。
- 测试：`model.test.ts`、`registry.test.ts`、`generatedFileSource.test.ts`。

### P2 — pack 贡献投影（backend）

- `core/petri-server/helpers/pack-contributions.js`：只读已安装/启用 pack；归一化 `provides.views` / `provides.resultSurfaces` / `provides.uiActions`；`entry` 必须为 packRoot 内相对路径（拒绝绝对路径/`..`/符号链接逃逸）；未知 kind/形状错误丢弃并记诊断。
- `GET /api/packs/contributions`（只读、无写面）。
- pack 资产只读路由：`GET /api/packs/:packId/assets/*`（仅安装包内、MIME 白名单、CSP 头、路径穿越 fail-closed）。
- 测试：合法/缺失/停用/非法形状/重复 id/穿越/未知 kind/资产路由。

### P3 — 前端 host 接线

- `useWorkSurfaceTabs`（替代 `useRightPanelTabs` 的核心状态）：复用 P1 纯函数；保持现有 `rightTab/openRightTabs` 语义与 `home` 兜底；新增 close policy、持久化、pack id。
- `RightPanel` 改为按 descriptor 渲染：core renderer 表 + `PackSurfaceFrame`（sandbox iframe + 窄桥）。
- title bar pills/工具菜单改读注册表（core + pack），加 close others/right/all 右键菜单；现有 UI-451 文件 tab 行为零改动。
- `packContributionsClient`：拉取 `/api/packs/contributions`，失败/无 pack 诚实空态；卸载/停用刷新后 surface 消失。
- `resultSurfaceHost`：按 artifact kind/fileName 匹配 pack resultSurfaces（priority 稳定）；Q5 无 pack surface 时继续走核心 transitional 面，并打 `data-surface-source="core-transitional"`。

### P4 — 新 core surface

- **生成文件**：列表（当前会话）、状态、工具/迭代归属、打开当前工作区文件、工具记录可用性；empty/loading/error/no-evidence 四态。
- **计划**：会话计划列表 + 详情（title/status/steps/specMd/版本）、复制、下载 `.md`、加入对话反馈入口；复用 `/api/ai/plans`。
- **证据（host 槽 + 最小索引）**：当前 artifact truth/availability/revision + 会话 job 状态；Q3 在此面扩展事件级轨迹，不新建第二套证据面。
- 文件预览动作：补充“在文件管理器中显示”IPC（`file:show-in-folder`）并接入文件面与生成文件面。

### P5 — 验证与收口

- 定向测试、`test:changed`、`quality:types`、`quality:lint`、`quality:knip:check`。
- 9223 实机 flow：打开文件/审阅/计划/生成文件/证据 → 标签保持 → close others/right/all；pack 缺失诚实空态。
- 证据落 `acceptance/block-216/`；回写 UI 台账、Q-MATRIX E1/E2/E3/E4/H4/H3、roadmap/handoff/AUDIT-LOG；closeout 十三门。

## 2. 非范围（明确不做）

- **不重写** `WorkingTreeReview`、`Result Studio` 内容、UI-451 文件 tab 内部保活/草稿逻辑、底部终端与侧聊布局。
- **不做终端分屏（E9）**：node-pty 会话与 tab 生命周期耦合，Q5 host 不依赖它；成本不可控，留 Q5 reopen/后续包，矩阵保持 🟡。
- **不做 P2-UI 动作下沉**：单细胞动作/标签仍在 `act-tools.js`；Q5 只提供 action registry 与 pack iframe 桥，P2-UI 负责删核。
- **不做 P2b 结果面物理迁移**：生信 Result Studio 内容仍由核心提供；Q5 只建 host 解析与挂载点，不把结果页压成通用文件浏览器。
- **不做 Q3 事件级轨迹/筛选**：证据面只做最小索引，Q3 扩展同一 surface。
- **不做 Q6 批注、Q8 安装信任/OAuth、Q9 外壳**。
- 不新增依赖；不改路由真相；不建第二套 pack/结果/证据真相。

## 3. 契约要点

### 3.1 surface descriptor

```ts
interface WorkSurfaceDescriptor {
  id: string;                    // core:<id> | pack:<packId>:<viewId>
  kind: 'core' | 'pack-view' | 'pack-result';
  title: string;
  icon: string;                  // 未知图标回落 folder
  source: 'core' | 'pack';
  packId?: string;
  singleton: boolean;            // true=单例；false=序号实例
  closeable: boolean;
  order: number;
  entry?: string;                // packRoot 相对路径（pack-view）
  capabilities?: Record<string, unknown>;
}
```

tab identity：`<surfaceId>`（单例）或 `<surfaceId>#<ordinal>`（序号）；ordinal 单调递增，关闭不回收。
关闭策略：`close`（单）/`closeOthers`/`closeRight`/`closeAll`；活动 tab 被关时回退到关闭位置右邻，否则左邻，否则首个合法项。
恢复：序列化 `{tabs:[{id,surfaceId,ordinal}], activeId}`；恢复时未知 surface/非法 tab 丢弃；`home` 永不进入持久化列表（现有兜底语义）。

### 3.2 pack contributions

```json
{
  "views": [{ "id": "volcano-lab", "title": "火山图实验室", "icon": "bar-chart",
              "entry": "ui/volcano.html", "singleton": true, "order": 100 }],
  "resultSurfaces": [{ "id": "bio-result", "domain": "bioinformatics",
                       "artifactTypes": ["plot", "table", "report"],
                       "priority": 100, "entry": "ui/result.html",
                       "emptyState": "安装生信包后显示结果面" }],
  "uiActions": [{ "id": "focus-cluster", "label": "聚焦簇", "surfaceId": "pack:petri-pack-bio:volcano-lab" }]
}
```

- 只接受字符串/布尔/有限数组；entry 不得为绝对路径、`..`、符号链接逃逸；
- 未知 kind / 缺 id / id 冲突 → 丢弃该条（`diagnostics` 回传，不 500）；
- pack 停用/卸载 → 投影中消失。

### 3.3 结果面解析

输入 `artifact.kind` / `fileName` / 可选 `viewerHint`；按 `priority desc, id asc` 取首个匹配；无匹配 → `{ source: 'core-transitional' }`（Q5）或 `{ source: 'missing', emptyState }`（P2b 切换后）。解析结果打 `data-surface-source`，测试可断言，不靠视觉猜测。

## 4. 验收与证据

| 项 | 判据 |
| --- | --- |
| 纯模型 | open/singleton/ordinal/close policies/reorder/persist/restore/未知 surface drop 全绿 |
| pack 投影 | 合法装载；缺失/停用/非法/穿越/重复 id fail-closed；资产路由不可越界 |
| host | core surface 可挂载；pack iframe 缺失/加载失败/消息未知均诚实态；title bar 与右栏同源 |
| 新面 | 生成文件四态；计划 list/detail/copy/download；证据最小索引 |
| 实机 | 9223 flow：打开 5 类 surface → 标签保持 → close others/right/all；截图 3 张 |
| 回归 | 现有文件 tab/右栏/title bar/结果面测试全绿；closeout 十三门 |

拆前基线：`npm run test:files --prefix frontend --` 覆盖 `useRightPanelTabs` 邻域、`RightFileTree*`、`ArtifactPinPane*`、`ResultSurface*`、`TitleBar*`；改前改后同一组测试全绿。

## 5. 风险

- 右栏 tab 从硬编码切注册表会触碰 title bar/right panel 两处消费面：先落纯模型与测试，再逐面接线，保持现有 id 与 `home` 兜底。
- pack iframe 是新的内容执行面：只允许本地安装包资产、sandbox、无 Node/preload 桥、消息白名单；不做远程 URL。
- 持久化可能恢复出不可用 surface：只认注册表当前项，卸载/停用即 drop。
- 生成文件的“工具记录内容”在现有数据里可能缺失：如实显示 no-evidence，不伪造内容。
- Q5 不得变成结果页通用化：result host 只解析和挂载，生信 UX 仍由核心 transitional 面保真，P2b 再迁移。

## 6. 完成语义

`completed` 需满足：P1–P4 代码与测试、P5 实机 flow、canonical 回写、closeout 十三门。E9 终端分屏明确 deferred，不因 Q5 收口被表述为已完成；H3 事件级证据扩展归 Q3；P2-UI/P2b 物理迁移未做，Q5 只交付 host 契约与挂载点。

## 7. 收口（2026-10-20）

**结论：BLOCK-216 Q5 host foundation completed。** closeout 十三门 PASS；9223 无窗口测试实例 live flow **19/19**。

### 7.1 交付

- **P1 纯模型**：`frontend/src/lib/workSurface/{types,model,registry,generatedFileSource}.ts` —— 稳定 id、单例/序号实例、close/others/right/all、项目级持久化/恢复、未知 surface fail-closed；生成文件来源四态。
- **P2 pack 贡献**：`core/petri-server/helpers/pack-contributions.js` + `GET /api/packs/contributions`；只读已安装/启用 pack 的 `views/resultSurfaces/uiActions`，非法条目丢弃 + diagnostics，不暴露 packRoot。路径判定单源下沉 `core/packages/shared-pack-assets`，由贡献投影与 Electron 协议共用。
- **P3 前端 host**：`useWorkSurfaceTabs` 替换旧 `useRightPanelTabs`；`RightPanel` 按 descriptor 渲染；title bar 药丸/「+」菜单同源，新增 tab 右键生命周期菜单与激活项自动滚入视野；`PackSurfaceFrame` 走 `petri-pack://<packId>` 独立 origin + sandbox + CSP + 窄桥（context/ready/ui-action-result）；`resultSurfaceHost` 解析 pack resultSurfaces，无匹配时保留核心 `core-transitional` 生信面。
- **P4 新 core surface**：生成文件（工作区版本/工具记录/无记录诚实态）、计划（列表/状态/步骤/spec/复制/下载/加入对话）、证据（truth/版本/可用性最小索引，Q3 扩展）；`file:show-in-folder` IPC + preload + 文件面/生成文件面入口。
- **P5 验证**：`test/block216-pack-contributions.test.mjs` 7/7；前端 Q5 测试 28+11+4+3=46 项；`test:changed` 前端 **266/266**（含新增 Q5 邻域）；`quality:types` 0、`quality:lint` 0 errors、`quality:knip:check` PASS、`quality:arch` PASS、`theme-token-contract` 17/17；9223 live **19/19**（证据 `acceptance/block-216/`）；**closeout 十三门 PASS**（含报告级 `skills:check` OK）。
- **门禁账**：新 dev-verify flow 是 `run.cjs` 按 id 动态加载的入口，按 CK-11 定性后 `knip-ratchet --update` 只新增该 1 键（246 键）；`SimpleChat` 保持 2142 行、`project-workspace` 从 1258 降到 **1252**，code-size 指纹随提交重打（基线只降不升）。

### 7.2 实机抓真（两处真缺陷，已修）

1. **多 surface 时 title bar 只显示关闭「×」**：`tabsRail` 内 tab 主按钮被 flex 压成 0，标签身份消失。修=tab 主按钮不参与压缩（`flex:0 0 auto` + 最小宽 22px）、标签条横向滚动、激活项自动滚入视野（截图 `q5-work-surface-tabs.png`）。
2. **OOPIF 不服从父级 `visibility:hidden`**：切走后 pack iframe 仍盖在新 surface 上；同时 `RightFileTree` 的空态子元素强制 `visibility:visible` 覆盖父级隐藏。修=pack 承载层非激活 `display:none`；files 面板空态/保活层仅在 files tab 激活时点亮（截图 `q5-generated-files.png` 对照）。

### 7.3 明确边界（不宣称完成的部分）

- **E9 终端分屏 deferred**：node-pty 会话/tab 生命周期耦合，Q5 host 不依赖；矩阵保持 🟡。
- **E1 部分**：右轨 surface 已统一；工作区 URL 模式（chat/result/code/compare/history）、底部终端、侧聊仍各宿主，未做布局合并。
- **E4 部分**：文件管理器显示 IPC 已落地，但未点验 OS 文件管理器实际弹窗（不在本包实机腿）。
- **H3/H4/B3 部分**：证据面为最小索引，Q3 扩展事件轨迹；计划面未做修订版本 tabs。
- **P2b/P2-UI 未做**：生信 Result Studio 内容仍在核心（host 已可解析 pack resultSurfaces）；单细胞 UI 动作/标签仍在 `act-tools.js`。Q5 只交付 host 契约与挂载点。

### 7.4 下一步

按用户 2026-10-20 裁决：**Q-DOMAIN P2-UI actions**（使用本包 action registry + pack iframe 窄桥）→ **P2b Result Studio resultSurface**（使用本包 resultSurfaceHost）→ Q6 → P3 → P4。Q1/Q2b 可按产品优先级插队。

G0 开发期常态 · 不外推 packaged/Provider/GA。
