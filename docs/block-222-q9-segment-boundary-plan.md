---
capability: q9-shell-reliability
goal: Q9（外壳可靠性与打磨）垂直切片——把错误兜底粒度从「整页」降到「一段 UI」：预览段独立成界，插件/用户文件产出的异形数据崩掉预览时，结论区、truth 面与上下文条仍然可用，并给用户可恢复动作（重试 / 复制诊断）。
acceptance:
  - 新增通用 `SegmentBoundary`（`frontend/src/components/shell/`）：`segment` 标注、`resetKey` 变化自动清错、`onError` 上报钩子、重试、复制诊断（剪贴板不可用/被拒时如实显示失败）。
  - 结果面预览段（`ResultArtifactShell` 预览 body）与工作区文件预览段（`WorkspaceFilePreview`）各自独立兜底；崩溃不扩散到页面骨架与其余区块。
  - 崩溃态带 `data-segment` / `data-segment-crashed` 标注，实机可用选择器定位是哪一段崩的。
  - 上报器自身抛错不得反过来炸边界（内层 try/catch），边界 UI 不吞诊断（console 保留 error + componentStack）。
  - 组件测试 ≥5 条；`theme-token-contract` 与 `quality:types` 绿；closeout 十三门 PASS。
reopen: 轮次级与工具卡级边界（对话流/tool dock）；应用级（React 树根部）边界；预览段崩溃时的自动重载产物；错误上报落盘（本地日志/诊断包）；通知/托盘/退出摘要等 Q9 其余条目。
status: completed
---

# BLOCK-222 · Q9（垂直切片）：段落级错误边界

> 用户裁决：2026-10-20「可以的 冲 按顺序推进」= 按母纲顺序 Q8 → **Q9** → P4。
> 母纲：`docs/qoder-essence-absorption-plan.md` §6-Q9「分段错误边界：应用/页面/预览/轮次/工具」。

## 1. P0 实码勘察（2026-10-20，只读实测）

| 面 | 现状证据 | 结论 |
| --- | --- | --- |
| 错误边界存量 | 全仓只有一个 `RouteErrorBoundary`（路由级，挂在 App 两棵路由树） | 只有「整页」粒度：任何一段崩 → 整页换错误卡，页面骨架之外全丢 |
| 结果面预览 | `ResultArtifactShell.renderPreview()` 直接吐在 `resultSidebarPreviewBody` 里，覆盖 image/pdf/markdown/spreadsheet/binary 五种分支与 pack 渲染面 | 插件产出的异形产出最容易在这里抛（渲染第三方数据），却无兜底 |
| 工作区预览 | `WorkspaceFilePreview` 主返回单根 `workspacePreview`，内含 text/md/html/csv/json/office/binary 七类分支 | 同上；单文件解析失败会白掉整块预览 |
| 兜底可观测性 | RouteErrorBoundary 的兜底卡无 `data-*` 标记 | 实机走查时无法定位「哪一段崩」，只能看截图猜 |

## 2. 范围

1. `SegmentBoundary`：类组件边界 + `resetKey` 自动恢复 + `onError` 钩子 + 重试 + 复制诊断（含失败态）。
2. 两个挂载点：结果面预览段、工作区文件预览段。
3. 组件测试 + 主题/类型门禁。

## 3. 非范围（reopen）

轮次级/工具卡级/应用级边界；崩溃后自动重载产物；错误上报落盘；Q9 其余条目（通知、托盘、退出摘要、模型选择器深度、电脑控制 sidecar）。

## 4. 完成语义

completed 需：组件 + 两处挂载 + 测试 + canonical 回写 + closeout 十三门。**明确声明这是 Q9 垂直切片**：预览段已独立兜底，其余段落与应用级仍在 reopen。

## 5. 收口（2026-10-20）

**结论：BLOCK-222 Q9 垂直切片 completed。**

### 5.1 交付

- `frontend/src/components/shell/SegmentBoundary.tsx`：段落级错误边界。`segment` 进 `data-segment`、崩溃带 `data-segment-crashed="true"`；`resetKey` 变化自动清错（切产物/文件不留旧错误）；`onError` 上报钩子（上报器自身抛错被内层 catch 吞掉，不反噬边界）；「重试这一段」清错重渲染；「复制诊断」在 `navigator.clipboard` 缺失或被拒时显示「复制失败」，不假装成功。
- 挂载两处：结果面预览 body（`ResultArtifactShell`，`resetKey` = artifactId + 预览可用性 key）与工作区文件预览（`WorkspaceFilePreview`，`resetKey` = previewUrl / 文件路径）。两处文案都如实说明「只是这一段出错、数据仍在」，并给出重试/原路径打开的建议。
- 视觉遵循宪章：卡片用 `--petri-border-card` / `--petri-surface-2` / `--petri-surface-alt`，正文用 em 相对字号（不新增裸 px、不新增小字号 token 消耗），按钮复用 `ui/controls/button.module.css` 变体（不新增按钮类定义）。

### 5.2 验证

- `SegmentBoundary.test.tsx` **5/5**：直通不包可见 UI / 崩溃只接管该段且标注 segment / 重试恢复 / resetKey 变化自动清错 / 上报器抛错不反噬。
- 邻域前端：`components/shell` + `workspace-panels` + `WorkspaceFilePreview` 共 **24 文件 / 170 项全绿**。
- `theme-token-contract` **17/17**（首轮因 `--petri-surface-1` 未定义红，改 `--petri-surface-alt` 后绿）；`quality:types` 0（首轮 `selectedArtifact.id` 不存在，改 `viewedRevision.artifactId` 后绿）。
- `closeout` 十三门 PASS。

### 5.3 边界（reopen）

- 轮次级与工具卡级边界（对话流 / tool dock）、应用级根部边界未做：前者要与流式渲染状态机一起设计，后者需先定「整树崩溃时的最小可恢复面」。
- 崩溃后不自动重载产物，也不落盘错误日志（本地诊断包属 Q9 后续）。
- Q9 其余条目仍 open：系统通知、托盘最小化、退出摘要、模型选择器深度、电脑控制 sidecar、首启角色揭示。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
