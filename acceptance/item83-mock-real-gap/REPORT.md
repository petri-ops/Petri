# mock 与真实路径差距清单（item83 三轮返工沉淀，供 86 快照测试输入）

owner 13:xx 反馈「今日第三次 mock 绿真实红」。本清单把已发现的 mock 级历史用例与对应真实路径缺口逐条登记，作为 86 快照测试的设计输入。

## 1. `ChatArtifactCard.auto-trigger.test.tsx`
- mock 形态：描述符全部 `/api/generated/file/...`，同一轮用同一个 `iteration`。
- 真实路径：产物落项目工作区，URL 为 `/api/workspaces/:id/file?path=generated/...`；同一次请求的不同产物 `iteration` 不同（`conv_705d7a21-89a`：image=2、video=6），共同点是 `traceId`。
- 缺口：URL 形态与分组键都没覆盖 → 自动出卡/网格聚合漏测。
- 86 输入：快照必须含真实 descriptor 样本（workspace URL + 同 traceId 多 iteration）。

## 2. `ChatArtifactGridCard.test.tsx`
- mock 形态：手工构造 `groupGeneratedActivities` 的 groups，iteration 固定 5/8，无 traceId。
- 真实路径：分组来自真实 toolActivities；跨轮拆分依据 traceId。
- 缺口：只测渲染，不测分组来源。
- 86 输入：快照链路应从活动（而非预构造 groups）出发。

## 3. `generatedArtifactPanel.test.ts`（item83 早期）
- mock 形态：只认 `/api/generated/file/`，并显式断言 workspace URL 被排除。
- 真实路径：主路径就是 workspace URL。
- 缺口：把设计变更前的错误行为钉成了断言。
- 86 输入：URL 白名单矩阵测试（legacy + workspace + 越界）。

## 4. `generatedVideoArtifactsFromActivities` 相关测试（item85）
- mock 形态：legacy `/api/generated/file/video/` URL。
- 真实路径：新落盘后视频描述符是 workspace URL，面板只从当前 run 活动快照取。
- 缺口：85 验收通过后，83 改落盘路径造成供给链回归未被发现。
- 86 输入：面板视频必须做一次「从生成到渲染」的端到端快照（`<video src>` 断言）。

## 5. `item84-model3d-fallback.test.mjs` / 3D 出卡 mock
- mock 形态：手工构造 `generate.model3d` 描述符。
- 真实路径：真实 3D 成功来自 `model3d_asset`（workspace-relative `.glb`）或 `model3d_recipe`（SceneSpec）；`params.mode` 曾完全不被读取。
- 缺口：mock 覆盖了不存在的路径，真实两条路径都漏。
- 86 输入：快照样本须含 `model3d_asset`/`model3d_recipe` 真实形状。

## 6. `item89` 第一笔 `conversationSelection.test.ts`
- mock 形态：只测命令面板 preselect 的纯函数。
- 真实路径：owner 点击的是左栏会话列表，跨项目点击同 tick 导航+setActiveConvId 互相冲掉。
- 缺口：没覆盖真实点击 handler 组合。
- 86 输入：真实 `AppRailProvider` + `LeftPanel` DOM 点击快照（已在本批补 `item89.integration.test.tsx`）。

## 7. 本批新增的真实路径钉（供 86 直接复用）
- `frontend/src/lib/workSurface/item83-real-flow.test.tsx`：真实 DB 同形描述符（同 traceId、不同 iteration、workspace URL）。
- `frontend/src/components/work-surface/GeneratedFilesSurface.item83.integration.test.tsx`：真实渲染出 `<video src>` 与四类产物卡。
- `frontend/src/components/desktop/AppRailContext.item89.integration.test.tsx`：真实 provider + 真实点击链。

## 共同教训
mock 级用例必须标注「mock 形状来源」，凡是涉及**跨模块接缝**（落盘路径↔URL↔面板归一化、活动 iteration↔分组键、点击 handler↔项目上下文）的，至少有一条从真实执行流形状出发的集成/快照用例。
