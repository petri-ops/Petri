# 独立 Agent 重放记录（2026-10-30）

只读 Agent（未参与实现上下文）按 `docs/next-stage-experience-blueprint.md` §3/§11、roadmap 顶部、handoff 恢复段与 `acceptance/next-0*/` 重放恢复步骤。原始结论摘要与处置：

## 能定位

- 八包完成状态与唯一下一候选（当时 NEXT-06 未收口）。
- 每包至少一份 acceptance JSON 与断言数：02A 9/9、01 11/11、03 13/13、04A 15/15+7/7、04B 18/18+15/15、05 46/46+12/12、02B 19/19。
- golden-path 场景哈希、revision、manifest、耗时、geometrySame/binaryHashesSame。
- 明确未覆盖项：真实 vision Provider、像素级图像 diff、法线/壁厚/间隙、3D→Result Studio Artifact Revision、长会话 soak、71 条 UI in_progress、G1+。

## 发现的问题与本轮处置

1. **严重：120→130 未改变几何**。当时 recipe 节点尺寸是烘焙数值，`set_parameter` 只改 parameters，130mm 构建仍为 `120×80×40`、体积 384000、GLB/STL/OBJ 与 120mm 相同。→ 已修：五类 recipe 的主体尺寸改用参数引用；runner 在送 Blender 前 `resolveSceneSpec`；golden-path 重跑后 `boundsMm=[130,80,40]`、volume=416000；GLB/STL/OBJ 与 120mm 不同。证据 `golden-path.json` 12/12。
2. **证据口径**：theme-token-contract 17/17 是组件/样式测试，不是 acceptance JSON；closeout 13/13 是命令结果，不落 JSON。→ 本矩阵如实注明来源，不伪造 JSON。
3. **recovered.text=false 误读风险**：resilience 的 `text=false` 表示刷新后不再出现 `webgl_context_lost`，R4 断言 canvas 恢复；已在此说明。
4. **恢复入口歧义**：文档在 NEXT-06 进行中时与 acceptance 并存。→ 本包收口后统一更新 roadmap/handoff/backlog/AUDIT-LOG，并保留本目录证据；以顶部恢复段 + blueprint §3/§11 为唯一入口。
5. **二进制可复现口径**：同场景重跑 GLB/STL/OBJ sha256 相同，PNG 渲染图不同；规范几何/边界/manifest sceneHash 一致。矩阵按此如实描述，不把 PNG 差异表述为不可复现。

## 结论

独立 Agent 能仅凭 canonical 文档与 acceptance 定位状态、产物、失败与回退入口；发现的几何参数化缺陷已修复并重采证据。未覆盖项仍按未覆盖处理。
