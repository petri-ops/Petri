# NEXT-06 证据矩阵与蓝图复盘（2026-10-30）

## 1. 八包交付对账

| 包 | 状态 | 主证据 | 关键边界 |
| --- | --- | --- | --- |
| NEXT-02A UI 信任基线 | delivered / UI-631 | `acceptance/next-02a-ui-trust-core/`（9/9 实机 + 定向 74/74） | 状态词表未知态保留；不宣称全量 UI |
| NEXT-01 Q4b-REM | delivered / UI-632 | `acceptance/next-01-q4b-rem/`（11/11） | workflow 不建第二执行器/调度器/审批链 |
| NEXT-03 TaskSpec | delivered / UI-633 | `acceptance/next-03-prompt-enhance/`（13/13） | 只入草稿，不自动替换/发送 |
| NEXT-04A SceneSpec/Blender | delivered / UI-634 | `acceptance/next-04a-3d-foundation/`（15/15 + 7/7） | Blender 外部可选；Three 只预览 |
| NEXT-04B 视觉回读 | delivered / UI-635 | `acceptance/next-04b-3d-vision-loop/`（18/18 + 15/15） | 真实 vision 凭据缺席；mock 验协议；P3-2 参数提案移 NEXT-05 |
| NEXT-05 参数化/五 recipe | delivered / UI-636 | `acceptance/next-05-3d-process/`（46/46 + 12/12） | 不建布尔抽壳/通孔；法线/壁厚/间隙未实现不声称 |
| NEXT-02B UI 收敛 | delivered / UI-637 | `acceptance/next-02b-ui-visual-convergence/`（19/19 + 漂移清单） | 71 条存量 in_progress 保留；原生对话框未重验 |
| NEXT-06 收敛 | 本包 | 本目录 golden-path / resilience / evidence-matrix | 见下 |

## 2. 黄金路径（P1-1）

`golden-path.json`（12/12）：box-enclosure 120mm dryRun（零写盘）→ 构建/四视图/GLB-STL-OBJ/manifest → 参数改 130mm（rev-000001）→ resolve 后重渲染 → `boundsMm=130×80×40`、volume=416000mm³、manifest sceneHash 与写盘 SceneSpec 一致。
- 指标：dryRun 0ms；120mm 构建+渲染+导出 1578ms；130mm 重渲染 1399ms。
- **Artifact Revision 边界**：3D 产物当前只有 SceneSpec 本地修订（rev-000001）+ manifest；Result Studio artifact revision 未建，属后续跨面集成，不在本轮冒充。

## 3. 五 recipe 抽验（P1-2）

`acceptance/next-05-3d-process/next05-recipes-live.json`（46/46）：五类 recipe 各自独立 SceneSpec/outDir/manifest，真实 Blender 四视图 + GLB/STL/OBJ + watertight/0 非流形；from-table 逐行校验；STL mesh-reference 导入 + 篡改拒绝；workflow 成功链与 cancel/resume（resume 复用 dryRun phase）。

## 4. 异常/压力（P2-1）

| 场景 | 证据 | 结论 |
| --- | --- | --- |
| vision 缺席 | NEXT-04B `scenarioDegraded` | 渲染/网格仍完整，vision `model_profile_not_found` |
| Blender 取消/超时 | NEXT-05 workflow cancel/resume + provider 180s 超时 | 取消终止子进程；resume 复用已完成 phase |
| WebGL 上下文丢失 | `next06-resilience-live-live.json`（5/5） | 首帧 424ms；丢失显示 `webgl_context_lost`；刷新后 canvas 恢复 |
| 导出/导入失败 | NEXT-05 hash 篡改拒绝、from-table 异常行、scene 冲突 | fail-closed，无半写成功 |
| 慢后端/模型超时 | NEXT-02A trajectory 15s 超时单测、NEXT-03 无凭据/超时 | 明确错误，不伪造结果 |
| 长会话/长列表/复杂场景 | 沿用既有长会话/工具列表测试；本轮未做 soak | **未覆盖**：不宣称压力通过 |

## 5. 可复现对账（P2-2）

同 SceneSpec（130mm）、同 provider（Blender 4.5.10 LTS）重跑：
- 规范几何报告 `mesh/boundsMm/renderEngine` 完全一致（`geometrySame=true`）；
- manifest `sceneHash` 一致；
- GLB/STL/OBJ 的 sha256 两次一致；PNG 渲染图 sha256 不一致（渲染采样/元数据），按纪律只记录、不强求；不以 PNG hash 冒充几何可复现。

## 6. 指标基线（P2-3）

见 `golden-path.json.metrics`：dryRun 1ms、构建+渲染+导出 1433ms、重渲染 1340ms。首次可预览时间以 Blender 首张渲染出现为准（4 视图全部产出即 preview 可用）；未测内存/长会话响应，列为未覆盖。

## 7. 独立 Agent 重放（P3-1）

见 `agent-replay.md`（由未参与实现上下文的只读 Agent 按蓝图与 acceptance 重放恢复步骤；它只报告可定位性，不修改文件）。

## 8. 蓝图复盘（P4-1）

- delivered：NEXT-02A/01/03/04A/04B/05/02B/06 的 P0–P3 主链与证据。
- partial：NEXT-04B P3-2（参数提案已由 NEXT-05 承接；图像逐像素差异未做）；NEXT-05 法线/壁厚/间隙检查未实现；3D Artifact Revision 未接入 Result Studio。
- deferred：真实 vision Provider 校准、packaged/GA、Provider 矩阵、长会话 soak、原生对话框/OS 权限重验（G1+ 或后续包）。
- 未覆盖项不得用文档勾选补位；`docs/ui-productization-audit.md` 71 条存量 in_progress 保留。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
