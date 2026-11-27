# mock 与真实路径差距清单（item 88 第三波 · 2026-11-27）

> 背景：今日三次「mock 测试绿、真实路径红」——3D 出卡 / item89 会话切换联动 / 网格按 traceId 聚合。
> 本清单盘点 mock 级历史用例 vs 真实路径的结构性缺口，并给出高危项的补测状态。
> 责任边界：本清单是盘点与钉子，不翻既有用例状态词。

## 一、今日三案（mock 绿真实红的根因模式）

| 案 | mock 测了什么 | 真实路径缺口 | 根因模式 | 补测状态 |
| --- | --- | --- | --- | --- |
| 3D 出卡 | ChatArtifactCard 测试用 `generate.model3d` 合成描述符（带 /api/generated/ url） | 真实流产物来自 `model3d_asset` 导入（workspace 相对路径，无受控 URL）与 `model3d_recipe` 本地近似降级——被 `generate.*` 过滤挡住 | mock 数据形状 ≠ 后端真实描述符形状 | ✅ 已补（item83 返工：`model3dArtifactsFromResult` 归一化两类真实形状，`ChatArtifactCard.model3d-real.test.tsx` 2/2） |
| item89 联动 | AppRail 单测 mock 会话列表切换 | 真实路径=旧项目 activeConvId 残留挡住新项目绑定 | mock 断言「函数被调用」而非「状态真的切换」 | ✅ 已补（item89 attempt2：preselect+项目导航单一入口，真实集成验证 6/6+1/1） |
| 网格聚合 | 单卡渲染测试（一活动一卡） | 真实流多 traceId 交错到达，按 iteration 分组错列 | mock 输入单线程有序，真实流交错 | ✅ 已补（item83 第三轮：网格按 traceId 聚合+视频独占行，3/3+集成 1/1） |

**共性根因**：mock 用「理想化的单一数据形状」替代后端真实形状；断言止于「组件收到 X 会渲染 Y」，不验证「后端真实产出 X'（≠X）时链路仍通」。

## 二、盘点：mock 级用例的高危缺口类别（审计维度）

1. **数据形状漂移类**（高危）：组件测试 mock 的 resultData/descriptor 形状是合成的，后端真实形状（agent 工具 resultData、loop_status_json、files_changed_json）无人钉。现状锚：`test/fixtures/tool-activity-labels.json` 三键恒等、`model3d-real` 真形状归一化——此类已有钉但覆盖不全。
2. **跨进程链路类**（高危）：前端组件测试不经过 express 路由/DB；后端 store 测试不经过 HTTP。缺口=两层之间「路由注册+真实 SQL」的集成面。本批补法：`test/item88-wave3-wb-overview.test.mjs`（真 express + 迁移库 + 真路由注册的 HTTP 集成，4/4）——新功能集成面从 day-1 有真路径钉。
3. **运行期状态类**（中危）：resume/恢复/崩溃恢复依赖内存 store 与 loop_runs 真值（item88 演示 attempt1→2 的三差距皆属此类：数据在库 UI 不可见）。现状锚：attempt2 CDP 预览实例端到端（6 截图）+ `resumeSubAgentTasks` 恢复链的投影钉。
4. **视觉/聚合类**（中危）：快照测试本批补齐（会话区产物卡三形态 + 生成文件面联动，snapshot 5/5），聚合类已有 traceId 钉。

## 三、高危缺口的补真实路径集成用例（本批落地）

- `test/item88-wave3-wb-overview.test.mjs`（真 HTTP 集成 4/4）：express app + 迁移库 + 真路由注册 + 真 SQL 数据 → /api/wb/overview 五态/依赖/任务书/计量逐断言 + 400 fail-closed + 诚实空投影。
- `test/item88-workbench-demo-seed.test.mjs`（attempt2 起真实库形状钉 3/4→现 3/3+前端 2/2）：seed 脚本幂等/clean 边界/轨迹绑定/会话可见性（user_id=LOCAL_USER.id）——attempt2 三差距的回归钉。
- 前端真形状：`WorkbenchOverviewSurface.wb.test.tsx`（wb 数据源 mock 但 DOM 断言真实投影产物：节点 id/五态色/去重合并）+ `WorkbenchOverview.projection.test.ts`（真 projectOrchestration 输出契约）。

## 四、建议（报 coordinator，不自行扩权）

- 「mock 绿真实红」复发模式集中在**数据形状**与**切换/恢复链**两处；建议 seat 后续组件测试规范：mock 数据形状必须引用后端真实产出样例（fixture 化），断言至少一条穿透到 store/路由层。
- 建议把「三层穿透」抽查纳入 closeout 抽检维度（每次工作包抽 1 个组件测试验证其 mock 形状与后端真实形状一致）。
