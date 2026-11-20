---
capability: c55-video-p4
goal: 把 P0-P3 已收口的视频能力接进产品主链，实现主题到可审阅 spec 到显式确认到成片结果卡的一键出口
status: completed
acceptance:
  - Node 与前端 HK-01 红绿先行，含 fail-closed 与篡改负测
  - P0 引擎契约与聊天产物卡邻域回归不退化
  - types/theme/docs/ui-audit 门禁绿，体积仅本包文件定向重锚
  - dev Electron 可见窗：轻量卡展开可见 mp4 与讲稿/字幕/来源/QA 下载
---

# BLOCK-509 · C-55 VIDEO-P4 产品内一键成片出口

> 最后更新：2026-11-20（CLOSED · 一次会话完成；HK-01 双端 7/7、前端邻域 52/52、types/theme/docs/ui 门禁绿，实机 L1-L3 3/3；P0 既有 D2 环境性红如实归属）
> 队列锚：`docs/pending-work-backlog.md` C-55；审计锚：`docs/AUDIT-LOG.md` C-55 / 本包条目。
> 前置：BLOCK-482（P0 真实成片 + `compose_video`）、BLOCK-483（P1 证据/质检）、BLOCK-486（P2 分镜）、BLOCK-487（P3 本地 SceneSpec 镜头）均 completed/CLOSED；本包**不重做** P0–P3。

## 1. 用户裁决

- 目标：聊天里一句「做一个 30 秒科普视频」→ 生成可审阅的 `VideoProjectSpec` → 用户确认付费 TTS / 本地执行 → 调既有 `compose_video` → 聊天结果卡给出 MP4、讲稿、字幕、来源、QA。
- 边界：把已完成的视频能力接进产品主链，不新增执行器、不重做视频引擎。
- 红线：零新依赖；TTS/付费仍走窄口显式确认；外部素材默认关闭；不接云文生视频/图生视频；不建第二套 spec；不碰资格线 / G1+；观感零代签。

## 2. 范围（in scope）

1. 新增纯函数 `core/petri-server/helpers/video-brief-spec.js`：从主题/受众/时长/画幅确定性 draft `VideoProjectSpec`，并复用 `normalizeVideoSpec` fail-closed；提供付费与外发确认文案生成。
2. `ChatArtifactCard` 增 `.mp4` 视频分支：轻量摘要默认折叠，展开后内联 `<video controls preload="metadata">` + 下载链接；讲稿/字幕/来源/QA/manifest 继续走既有下载链接。
3. HK-01 红绿先行：Node 契约（draft 校验、负测、确认文案）+ 前端契约（mp4 视频分支、轻量态不回归、未知扩展名不崩）。
4. 证据落 `acceptance/block509-c55-video-p4/`；dev Electron 可见窗实机核对；观感口令归用户。

## 3. 非范围

- 不改 `compose_video` 的 schema / handler / contract / tool 注册表（P0 已验证，保持冻结）。
- 不改 `video-compose.js` / `video-evidence.js` / `video-storyboard.js` / `video-advanced-shot.js` 的既有契约。
- 不新增 UI 确认对话框（付费确认走既有 `ask_user_question` 治理链）。
- 不生成新视频文件、不接外部素材下载器、不翻转全局 `speech-config.json`。
- 不改 Result Studio 资格线、不动 packaged/Provider/GA。

## 4. 验收门

| 门 | 判据 |
| --- | --- |
| G1 | HK-01 红→绿；Node + 前端测试全绿，含篡改负测 |
| G2 | 回归：`block482-video-compose` / `ChatArtifactCard` / `ConversationTimeline` / UI-713 邻域不回归 |
| G3 | `quality:types` / `theme-token-contract` / `docs:check` / `ui:audit:check` 绿 |
| G4 | 体积指纹仅本包文件定向重锚；他包漂移如实归属 |
| G5 | dev Electron 可见窗：真实 compose_video 产物卡可折叠/展开并内联播放 MP4；付费确认话术在场 |
| G6 | 六件套：plan / registry / README / roadmap / handoff / AUDIT-LOG 回写；观感零代签 |
