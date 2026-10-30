# BLOCK-322 P1b/P1c 评审报告（2026-10-30）

**评审范围**：工作区未提交改动 —— `core/petri-server/helpers/mesh-assets.js`（新）、`core/petri-server/helpers/scene3d.js`、`core/petri-server/routes/model3d.js`、`core/petri-server/routes/files.js`、`frontend/src/lib/meshAssets.ts`（新）、`frontend/src/lib/scene3d.ts`、`frontend/src/lib/workspaceFileUpload.ts`（新）、`frontend/src/lib/model3dAssetImport.ts`（新）、`frontend/src/lib/sceneEditClient.ts`、`frontend/src/components/work-surface/Model3DScene.tsx` / `Model3DSurface.tsx` / `Model3DEditPanel.tsx`、`frontend/src/components/result-studio/viewerRegistry.ts`、`frontend/src/components/workspace-panels/Model3DResultViewer.tsx`、`frontend/src/pages/project-workspace/fileOps.ts` / `RightFileTree.tsx`、`frontend/src/components/copilot/SimpleChat/attachmentUpload.ts`，加 4 个新测试与本包实机 flow。
**评审维度**：七维全跑（契约一致性 / 单一真相 / 失败语义 / 测试有效性 / 边界与安全 / 死代码与残留 / 最小化五问）。**本轮未做 AI 跑查（ocr）**：评审对象是工作区未提交 diff，ocr 需要提交区间；改为逐文件回读源码 + 实机取证。
**结论**：**P1 级发现 0 条；P2 一条已在收口前修复并复验；其余 P2 均已登记去向** → 可收口。一句话总评：这批改动净改善代码健康——把 12 份彼此漂移的格式清单与 4 份体积上限压成一个声明处，同时消除了一处「UI 声称存在、画面永不显示」的静默失败，且没有新增第二执行器或第二写面。

## 发现清单

| # | 严重度 | 位置 | 现象（源码合同原文 / 可复现行为） | 处置 |
| --- | --- | --- | --- | --- |
| 1 | P2 **已修并复验** | `frontend/src/components/work-surface/Model3DSurface.tsx:138-147` | `onSceneError` 原为 `setError(message)`，而 `Model3DScene` 的失败语义是**逐节点**上报（`mesh_reference_load_failed:${node.id}`）。两个以上 `mesh-reference` 同时失败时后一条覆盖前一条，用户只看到最后一个——违反红线4「能力缺失如实报」中的「不吞」半边 | 改为 `mesh_reference_*` 前缀进 `warnings` 去重累积，其余（WebGL 初始化/上下文丢失）仍走 `role="alert"` 阻断条；实机 U4a 断言随之改为「告警区含 `mesh_reference_load_failed:asset-scene` 且 alert 为空」，重跑 29/29 |
| 2 | P2（登记候选） | `core/petri-server/helpers/mesh-assets.js:56` | `sha256File(target.target)` 是同步流式读盘，64MB 上限内约 0.1–0.3s 阻塞后端事件循环；与 `helpers/model3d-scene-store.js:103-112`（`fs.readFileSync`）、`helpers/artifact-truth.js:44-63` 同形态 | 暂不改（改流式=引入第三种形态，收益不抵一致性成本）。触发条件=真实大资产频繁导入时实测卡顿，再评估流式化。已写入 plan §3「未验证面/登记」 |
| 3 | P2（登记候选） | `core/petri-server/helpers/scene3d.js:225` vs `:228-231` | `update_node` 的 changes 白名单是 `['transform','dimensions','material','label']`——**不含 `source`**；而 `add_node` 可以创建 `mesh-reference`。结果：导入进来的资产节点能挪位，却不能改指向或纠正 sha，只能删了重加。另 `remove_node:232-234` 对未知 id 静默 no-op | 属既有契约不对称，非本批引入。随 P3（装配约束扩面）一并处置；本批不扩白名单（扩 `source` 需同时定义 sha 变更的重锚语义，是产品裁决点） |
| 4 | P2（登记候选） | `resources/model3d/blender_scene.py:140,154` + `Model3DScene.tsx countMeshes` | Blender 侧 `import_mesh_reference` 只返回 MESH 对象，前端 `countMeshes` 只数 `isMesh`。GLTF 内的相机/灯光/骨骼进 `mesh-reference` 后**两侧都静默丢弃**，节点计数按 `|| 1` 兜底，画面无内容但无提示 | 已作为「未验证面②」写入 plan §3 与 UI-640 边界；P2（场景表现力，灯光/相机进 SceneSpec）时统一给显式 `capability_unavailable` 语义，而非在此处特判 |
| 5 | Minor | `frontend/src/lib/meshAssets.ts:1-3` + `test/block322-mesh-format-single-source.test.mjs` | 渲染层无法 require core，前端是「锁定的镜像」而非同源；对账门用文本正则取 `Object.freeze([...])` 字面量，重排/换行会让门红 | 可接受：门是 fail-loud 不是 fail-silent，与既有 `test/next04a-scene3d.test.mjs:69` 同型。留痕于 plan §3 裁决段 |
| 6 | Minor | `frontend/src/components/copilot/SimpleChat/attachmentUpload.ts:24-28`（改前） | 原自算 `getApiBase()`：dev 硬编码 `http://localhost:3001/api`、prod 用相对 `/api`，与文件树用的 `getApiPrefix()`（`window.petriDesktop.backendConfig.rApiBase`）是两套 URL 解析。收敛到单源后打包形态改变 | 取 `getApiPrefix()`（与 `pages/project-workspace/fileOps.ts` 同源，dev 下等价）。**如实声明**：packaged 侧附件上传本轮未重验（G0 只在 dev Electron 取证） |
| 7 | 死代码 | `frontend/src/lib/meshAssets.ts`（`isMeshFileName`）/ `frontend/src/pages/project-workspace/fileOps.ts`（`fsUpload`、`FileOpAction` 的 `'upload'` 成员） | 收敛后零调用方 | 已删除（不留 `// removed` 痕迹，不留 `_var` 改名壳）；knip 棘轮未上调 |
| 8 | ⏳ 待验证 | `frontend/src/components/work-surface/Model3DScene.tsx:34`（`setResourcePath`） | 多文件 `.gltf` 的外部 `.bin`/贴图解析：已从 three 0.186 源码核实 `LoaderUtils.resolveURL` 对相对资源是 `path + url` 字符串拼接（故带上 `?path=<目录>/` 的基址可命中工作区文件路由），但**实机只覆盖了自包含 `.glb`** | 不宣称通过。登记为 P1 未验证面；后续补一条 `.gltf + .bin` 实机腿 |

## 单一真相与最小化对账

- **消除的第二真值**：mesh 输入格式清单 12 份 → 1 份声明处（`mesh-assets.js`）+ 1 份渲染层锁定镜像；体积上限 4 份 → 同一常量跨 JS/TS/Python 对账；分片上传循环 2 份（`RightFileTree.uploadOsFile` / `attachmentUpload.fileToBase64+uploadChunk`）→ `workspaceFileUpload.ts` 单源；SceneSpec 默认路径字面量 2 份 → `DEFAULT_SCENE_PATH`。
- **未合并并如实登记**：导出侧格式白名单（`blender_scene.py:258-273`、`tool-defs/model3d.js:110/133`、`blender-provider.js:102`、`model3d-recipe-runner.js:11`）与输入侧是不同概念（产出格式 vs 可入链资产），不在 P1 硬合——已在 plan §3 记为后续债。
- **零新执行器 / 零新写面**：P1c 三步全部复用 `POST /workspaces/:pid/fs/upload`、`POST /model3d/scene/apply`（白名单 ops + 乐观锁 + 修订历史）；新增的唯一 REST 面 `asset/inspect` 是**只读**预检，不写文件、不算第二份真相（Blender 构建时仍逐字节复验 sha）。
- **YAGNI 五问**：新增 3 个生产文件均各有不可替代职责（契约声明 / 上传通道 / 导入编排）；无新依赖（Three 既有 loader、sha256 既有 helper）；`inspectMeshAsset` 的 `maxBytes` 参数是唯一测试缝，沿用仓库既有 `sha256File(filePath, io = fs)` 注入先例；未预建任何「以后可能要」的空壳。

## 测试有效性抽查

- `test/block322-p1c-asset-intake.test.mjs` 走真实临时工作区 + 真实 `sha256File`，并把 sha 与独立 `crypto` 重算值对账——不是手工注入；红面四类（格式/缺失/逃逸/敏感段）都有断言。
- `frontend/src/lib/model3dAssetImport.test.ts` 关键断言=**节点里的 `sourceSha256` 必须是服务端预检返回值**（若实现改成前端自算，测试必红）；并锁「不受支持/超限在上传前即拒绝，零副作用」与「409 才换名、非冲突错误不盲目换名」。
- 行为基线（重构前后同套测试绿）：`fileOps.test.tsx` / `RightFileTree.refresh|shortcuts` / `attachmentUpload` / `contextItems` / `contextChannels.baseline` / `Model3DEditPanel` / `Model3DResultViewer` 共 33 项在分片上传与常量收敛改动后全绿。
- **覆盖缺口（不粉饰）**：`Model3DScene.tsx` / `Model3DSurface.tsx` 仍无组件级单测（jsdom 无 WebGL，构造 `WebGLRenderer` 即抛）；其渲染行为由静态反回归锁（`block322-mesh-format-single-source` 最后一例）+ 实机 29 断言承载。`frontend/src/lib/workspaceFileUpload.ts` 在 happy-dom 下真实跑了切片语义。

## 收尾自检

- [x] P1 全部修复并复验（本批 P1=0 条；P2#1 已修并重跑实机 29/29）
- [x] P2 登记去向：#2/#3/#4/#8 → `docs/block-322-model3d-full-spectrum-plan.md` §3；工具面两条 → `docs/AUDIT-LOG.md`「当前待处理项」🟡
- [x] 同类 ≥2 次已转门禁：格式清单漂移（12 份并立）→ 跨语言逐值对账门 `test/block322-mesh-format-single-source.test.mjs`；静默跳过回归 → 同一门内的反向断言（禁止 `'mesh-reference') continue` 复现）
- [x] 最小化五问已过，无未裁决「多做」面
