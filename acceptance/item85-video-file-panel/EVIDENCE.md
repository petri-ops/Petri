# item 85 生成视频文件面板播放 — 验收证据（2026-11-27）

## 范围声明

本批只覆盖右栏「生成文件」面板（`GeneratedFilesSurface`）的 generate.video 产物预览与系统播放器出口。
Acceptance 只证明其契约声明的范围；观感签字不在本批（零代签，`in_progress`）。

## 改动清单

| 文件 | 改动 |
| --- | --- |
| `frontend/src/lib/workSurface/generatedFileSource.ts` | 新增 `generatedVideoArtifactsFromActivities`（generate.video 成功描述符归一化：只认 `/api/generated/file/video/`、视频扩展名白名单 mp4/webm/mov/m4v、按 URL 去重、失败 fail-closed）+ `absoluteGeneratedFileUrl` + 面板态函数补 `generatedArtifactCount` |
| `frontend/src/components/work-surface/GeneratedFilesSurface.tsx` | 新增「生成产物（视频）」段：内嵌 `VideoResultViewer`（受控读面供给）+「系统播放器打开」按钮（`files.openPath`） |
| `frontend/src/components/workspace-panels/VideoResultViewer.tsx` | 新加可选 `hint` 覆写（缺省保留原 Blender 语境文案，零行为变化） |
| `src/ipc/file-dialog.js` | `ALLOWED_OPEN_EXTENSIONS` 补 `.mp4/.webm/.mov/.m4v`（SEC-002 白名单登记制；脚本/可执行 DENIED 边界不松动） |
| `test/impact-map.json` | `create-pack-builtin-generate` 规则补 item85 patterns/tests |
| 台账 | `docs/ui-productization-audit.md` 顶部同批登记 + `docs/AUDIT-LOG.md` 最后更新 |

零触碰：`frontend/src/components/copilot/**`（83 领地）、`build/afterPack.js`（66 已收）、agent-tools 生成链（84 排队）。

## HK-01 红绿先行证据

1. 红确认（实现前）：前端 `GeneratedFilesSurface.test.tsx` + `generatedFileSource.test.ts` 新增 6 测全红（`generatedVideoArtifactsFromActivities is not a function` / 面板无产物段），存量 10 绿；`node --test test/item85-video-open-path.test.mjs` 红（`.mp4 应可打开 false !== true`）。
2. 绿确认（实现后）：
   - 定向：`generatedFileSource.test.ts` 9/9、`GeneratedFilesSurface.test.tsx` 7/7、`test/item85-video-open-path.test.mjs` 2/2。
   - 邻域：workspace-panels 31 文件 182/182、work-surface 21 文件 116/116。

## 门禁证据（CI 等价，2026-11-27 本地）

- 11 静态门全绿：docs:check ✅（退出 0）· ui:audit:check ✅ · quality:secret ✅ · quality:arch ✅ · quality:lint ✅（0 errors）· quality:types ✅ · gate:code-size ✅ · gate:css-modules ✅ · gate:arch-cycles ✅ · quality:knip:check ✅ · gate:tracked-consistency ✅（新测试文件登记后）
- platform 步：35 测 33 绿 2 live-skip（与 CI 一致）
- harness 步：harness:check ✅ + harness:phase6 66 测 64 绿 2 skip + 工具单测 bundle 106 测 104 绿 2 skip
- 前端：`frontend check`（tsc）✅ + CI 两测 `--changed` 无匹配 exit 0（与 CI 现状一致）+ `build:spa` ✅（2.19s）
- `test:changed`：522 测 507 绿 / 8 红 / 7 skip。8 红经基座回退核真（stash → cf92a146a 复跑 `ui-ledger-status-contract` 与 `result-changeset-service` 同样红）均为存量：UI-732 状态词/证据债（2）、P6 源绑定、W5a 棘轮、MCP 子进程缺 projects 表（3）、result-changeset-service——非本批引入、未放宽任何门。

## 待办（owner）

实机验收需重启后端 + Electron：generate.video 跑一单后在右栏「生成文件」面板过目视频段内嵌预览与「系统播放器打开」。观感翻 verified 走 owner 口令或偏好预审闭环。
