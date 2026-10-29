---
capability: rw-01-3d-artifact-revision
goal: 把 NEXT-04A~06 建成的 3D 链产物（SceneSpec/manifest/GLB/STL/OBJ/revision）接入成果面（Result Studio）revision 与血缘体系——3D 产物成为 viewer 注册表、revision 快照与恢复、lineage 血缘、Composer 结构化引用的一等公民。
acceptance:
  - 方向级验收 = 按 parent 执行纲（docs/remaining-work-execution-plan.md §3.1）的逐包任务与完成判据执行；本 plan 是其立项展开。
  - 门禁级验收 = §5 六门（G1 契约红绿四件 / G2 后端定向 / G3 前端定向+tsc / G4 实机 flow / G5 closeout 十三门 / G6 台账回写）收口逐项对账。
  - 证据级验收 = 实机断言落 acceptance/rw-01-3d-revision/；实现未完成只能 in_progress，verified 需真实实机证据，不凑不伪造。
status: completed
---

# RW-01-3D-ARTIFACT-REVISION 执行计划

最后更新：2026-10-30（**P0-P4 全链收口 completed**：closeout 十三门 PASS + 实机 18/18（acceptance/rw-01-3d-revision/，真实 Blender 5.2.3 LTS）；实机抓真三连=family 需 projectId 前缀（内核 uq_rs_revisions_family_current 全局唯一）/scenePath 稳定锚（run 副本路径不 stacking）/restore 资格三字段+validator 描述符（plugin-loader 一方表）。边界如实：UI-638 面板发现路径实机腿随 RW-02；restore 物化域=git 绑定前提（既有内核域）；vitest 通道债+1 实证（three.js 真挂载 V8 OOM，薄壳测试以 stub 代入）。G0 开发期常态 · 不外推 packaged/Provider/GA。）

## 0. 发令与授权留痕

- **用户裁决（2026-10-30）**：「能否一次性搞定所有内容呢 不需要我的参与」= RW-01~06 六包串行全量预授权发令（预授权连续工作模式，2026-09-20 先例；包间不停候，真决策点仍停下询问）。
- **用户授权（2026-10-30，会话中追加）**：「授权 你可以安装任何需要安装的软件」= 本机安装 Blender 的依赖变更授权（DEPENDENCY-CHANGE-CHECKLIST 的用户裁决项就此满足；Blender 为外部工具链二进制，零 npm 新依赖）。

## 1. 范围（in scope）

1. **kind 契约扩展**：`ResultArtifactKind` 词表增 `model3d`（`frontend/src/lib/result-manifest.ts`）；扩展名族 `.glb/.gltf/.stl/.obj/.scene3d.json`。
2. **viewer 注册**：`viewerRegistry.ts` 增 model3d 规则行 + 能力 profile（canExport/canSelect 按实际能力如实标）+ `ResultArtifactShell` 3D 渲染分支；新组件 `Model3DResultViewer`（复用 `Model3DScene` three.js 预览内核，不复制几何代码）。
3. **导出即登记（revision 真值接入）**：新桥 `core/shared-backend/model3d-revision-bridge.js`——`tool_model3d_export` 成功后把 manifest 投影为成果面真值：`createChangeSet` + `appendRevisionBatch`（outputPath/outputHash/validation 取自 manifest，parametersHash 带 sceneHash 溯源，toolJobId 挂既有工具作业）。**artifact_revisions 是产物 revision 唯一真值**；`.history/` 文件级修订保持场景编辑线源真相不动（对象不同：场景编辑 vs 导出证据，非双账本）。
4. **lineage 接入**：revision 挂 toolJobId 后由内核 `buildAuthoritativeWorkflowGraph` 从 Job/Revision 真值自然投影 3D artifact 节点；**不建手动登记 API、不建第二执行器**。契约测断言 3D 节点/边出现在投影图中。
5. **selectionBus 接线（artifact 级）**：`Model3DResultViewer` 选中产物 → `setSelectionBusArtifact/Selection` → Composer 结构化引用可引用 3D 产物。
6. **实机断言**：真实 Blender 生成链（recipe → blender → manifest）+ 成果面打开/revision 恢复/lineage 3D 节点/Composer 引用，隔离栈（9223 离屏实例）断言落 `acceptance/rw-01-3d-revision/`。

## 2. 非范围（exclusions）

- 3D 几何内核扩展（布尔/抽壳/通孔、法线/壁厚/间隙——handoff 边界在册）。
- 子网格级语义拾取（artifact 级选择已满足 RW-01「选择回路进 Composer」判据；网格拾取属后续 UI 增量）。
- 像素级图像 diff；G1+（packaged/Provider/GA）；C-44 pack 写桥（RW-02）。
- SceneSpec 编辑线（`.history/`）的任何行为变更；`/api/model3d/*` 既有路由语义变更。

## 3. 依赖

- 成果面内核：`result-studio-repository.js`（createChangeSet/appendRevisionBatch）、`result-workflow-graph.js`（真值投影）、`viewerRegistry.ts`、`selectionBus.ts`——全部零改动或纯扩展，不重构。
- 3D 链：`model3d-tools.js`（export 工具）、`scene3d.js`（manifest/SceneSpec）、`blender-provider.js`（探测链含 `/Applications/Blender.app`）。
- **Blender 本机安装**（用户已授权，brew cask）；capability 端点此前如实报 `blender_not_installed`，安装后以 `/api/model3d/capability` 复验。
- dev 栈：隔离栈起（后端 + Vite + 9223 离屏实例）；后端变更后重启后端。

## 4. 设计裁决

- **D1 真值路径**：导出即登记（同步桥，fail-open 语义=登记失败不吞导出结果、桥返回错误随工具结果如实上报）。
- **D2 kind 词表**：显式增 `model3d`（一等公民语义，契约可见可测），不走 file+扩展名暗判定。
- **D3 viewer 形态**：薄壳组件复用 `Model3DScene`，禁止复制 three.js 装配代码。
- **D4 lineage**：纯投影复用（真值投影内核不改词汇，3D artifact 经 artifactIds 进图）；若投影对 3D 存在 kind 白名单排除，按真值语义修白名单并红绿覆盖。
- **D5 选择**：artifact 级。
- **D6 Blender**：真实安装（授权留痕），实机断言走真实生成链；NEXT-06 黄金工作区（`acceptance/next-06-convergence/golden-workspace/`）留作 sha 交叉对账，不替代本机生成。
- **D7 REST**：复用 `/api/result-studio/*` 既有查询面；仅在 kind 过滤排除 3D 时按真值语义扩展。

## 5. 证据位置与验收门禁（收口逐项对账）

证据目录：`acceptance/rw-01-3d-revision/`。

| # | 门禁 | 预期 |
| --- | --- | --- |
| G1 | 契约红绿先行：kind 词表 / viewerRegistry 规则 / bridge manifest→change-set+revision / lineage 投影含 3D 节点 | 四件先红后绿，测试名+两轮输出留痕 |
| G2 | 后端定向：result-studio-repository / result-workflow-graph / result-changeset-service / next04a/04b/05 系列 | 全绿 |
| G3 | 前端定向：viewerRegistry.test(+block142) / Model3DResultViewer.test / selectionBus 相关 / theme 门 | 全绿 + tsc 0 |
| G4 | 实机：dev-verify flow（隔离栈）真实 Blender 生成 + 成果面打开/恢复/lineage/引用 | 断言 N/N allPass，证据落 acceptance/ |
| G5 | closeout 十三门 | PASS |
| G6 | 台账回写：UI 新面登记 + RW 纲 §2 状态 + backlog 行 + roadmap/handoff/AUDIT-LOG | 完成 |

## 6. 阶段划分与完成语义

- P0 立项（本提交）→ P1 契约红绿 → P2 后端桥 + REST → P3 前端 viewer + selectionBus → P4 实机 + closeout + 回写。预期一次会话内连续推进（预授权模式）。
- 完成语义：实现未完成只能 `in_progress`；`verified` 需 G4 实机证据；WebGL/Blender 依赖实机 Electron，缺证据如实标注，不凑。

## 7. 环境纪律

- dev 栈按无窗口纪律：主验证走 9223 离屏实例，探针跑完即杀；后端代码变更后重启后端（`lsof -ti :3001 | xargs kill`）。
- 并行包文件面：无并行包；`docs/remaining-work-execution-plan.md` §2 状态列随本包回写（唯一 active）。
