---
capability: block-329-ffmpeg-turntable
status: completed
goal: macOS 转盘 mp4 能力缺席（Blender 5.2.3 无头把 FFMPEG 从 file_format 枚举摘掉）时，用外部 ffmpeg 消费已出盘的 PNG 序列合成同名 turntable.mp4；窄触发、缺失如实报、不下载、来源留痕（RULING-03 同型）。
acceptance:
  - 契约 test/block329-ffmpeg-turntable.test.mjs 4/4：shouldFallback 四态（原生出片/真失败/无帧/可关）+ 真跑 ffmpeg 出合法 mp4（ftyp 头、临时清单清理）+ 无素材如实失败 + provider 接线位置与单一源源码契约。
  - mac 实机 block322-p2-04-turntable-live 13/13 allPass：tier=ffmpeg、videoSource='ffmpeg'、movieCapability='unavailable'、blenderVideoError 保留、videoError=null；mp4 sha256/bytes 磁盘重算一致、ftypisom 文件头、临时帧清单零残留。
  - 未请求转盘与 Blender 原生出片两条存量路径零变化（videoSource='blender' 分支不动）。
reopen: Windows 侧未在本轮回跑（不改变其原生出片路径）；若某平台 Blender 能出片但产物被判失败，需另作能力探测（当前 ffmpeg 探测只判存在性，不可用二进制会在 compose 阶段 fail-closed 并回显 stderr）。
---

# BLOCK-329 — macOS 转盘 mp4 外部 ffmpeg 合成回退

状态：**completed（2026-11-02 当日立项当日收口）**
truthDomain：`block-329-ffmpeg-turntable`
canonical 入口：本文件
关联：BLOCK-322 P2-04（转盘序列帧与 mp4）/ RULING-03（外部可执行 CLI 同型裁决）/ AUDIT-LOG 2026-10-31 🟡「macOS 转盘 mp4 面能力缺席待裁」

## 1. 裁决来源与问题

用户 2026-11-02：「除 R 运行时下载授权与 G1+ 暂不做，其它几项都确定开整」——本包为其中 A 项。

问题（BLOCK-322 macOS 复验批实测）：Blender 5.2.3 LTS 在 macOS 无头下把 movie 格式从 `file_format` 动态枚举中摘掉（`FFMPEG` 不在枚举内），Python 侧因此报 `movieCapability='unavailable'` + `videoError='movie_format_unavailable'`，**但 PNG 序列帧已经全部出盘**。产品当时改为诚实声明（mac 只出帧、mp4 位显式缺席），本轮把它补上。

## 2. 方案（RULING-03 同型：外部可执行、默认探测、缺失如实报、不下载）

- 新增 `core/petri-server/helpers/ffmpeg-turntable.js`（BLOCK-322 交接时留的 WIP，本包接线并补齐契约）：
  - `findFfmpegBinary()`：`PETRI_FFMPEG_BIN` 优先 → PATH 探测（与 `findBlenderBinary` 同款口径），进程内缓存。
  - `shouldFallback(turntableReport)`：**窄触发**——`video` 缺席 + `movieCapability === 'unavailable'` + `stills` 非空；`PETRI_MODEL3D_FFMPEG_FALLBACK=0` 可关。真失败（`movie_render_failed`）**不代偿**，否则等于把执行失败伪装成平台差异。
  - `composeTurntable({ outDir, stills, fps })`：concat demuxer 吃**显式帧清单**（不依赖 glob 与帧名假设），`libx264 + yuv420p + crf 23`、偶数尺寸缩放，输出与 Blender 原生同名 `turntable.mp4`，跑完删除临时清单。
- 接线点：`helpers/blender-provider.js::applyTurntableVideoFallback()`，在读 `blender-report.json` 之后、登记 `outputs` 之前执行：
  - 原生出片 → `videoSource='blender'`（产物面零变化）；
  - 补片成功 → `video = <abs>/turntable.mp4`、`videoSource='ffmpeg'`、`blenderVideoError` 保留原原因码、`videoError` 清空（缺席原因不再是"没有视频"）；
  - 补片失败 → `ffmpegError/ffmpegMessage` 另记，**不覆盖** Blender 的 `videoError`（两条原因都要能看见）。

## 3. 非范围

- 不下载/不打包 ffmpeg；不静默安装；`ffmpeg` 缺失时如实报 `ffmpeg_not_installed`。
- 不改 Blender Python 侧任何逻辑（mac 仍如实声明 movie 能力缺席）。
- 不做 GUI 对照实验确认 5.x 是设计还是回归（与"无可见窗口"纪律冲突，已由本轮方案绕开）。
- 不改 P2-05 结果面播放器；mp4 走既有工作区读面。

## 4. 证据

- 契约：`test/block329-ffmpeg-turntable.test.mjs` **4/4**（窄触发四态 + `PETRI_MODEL3D_FFMPEG_FALLBACK=0` 关闭 + 真跑 ffmpeg 合成合法 mp4（`ftyp` 文件头、临时清单清理）+ 无素材如实失败 + 接线位置/单一源源码契约）。
- 实机：`npm run verify -- block322-p2-04-turntable-live`（flow 已扩三档判据）在本机 **13/13 allPass**，`tier=ffmpeg`、`videoSource='ffmpeg'`、`movieCapability='unavailable'`、`blenderVideoError='movie_format_unavailable'`、`videoError=null`；登记 mp4 的 sha256/bytes 由磁盘重算一致（15797B），文件头 `ftypisom`；8 帧哈希互异；临时帧清单零残留。
- 证据文件：`acceptance/block-322-p2/block322-p2-04-turntable-live-darwin.json`、`acceptance/block-322-p2/block322-p2-04-turntable-detail-darwin.json`（按 BLOCK-330 的平台命名口径）。

## 5. 环境抓真（已入册）

本机 `brew` 的 ffmpeg 8.1 因 `x265 4.1→4.2` 升级导致 soname 失配无法启动（`Library not loaded: libx265.215.dylib`）。处置=`brew reinstall ffmpeg`（升到 9.0.2）后实机腿通过。教训：**"二进制存在"≠"二进制可用"**——`composeTurntable` 对不可用二进制的失败是 fail-closed 的（`ffmpeg_failed` + stderr 原文回显），不会产出空壳 mp4；见契约测「无可用帧如实失败」与实机腿 V6。

## 6. 完成语义

`completed`＝契约 4/4 + mac 实机 13/13 + 转盘产物面（outputs 含 mp4、frameAssets 只作过程产物）+ AUDIT-LOG 🟡 翻 ✅。Windows 侧未在本轮回跑（本包不改变其原生出片路径：`videoSource='blender'` 分支零改动），不代证。

G0 开发期常态 · 不外推 packaged/Provider/GA。
