# BLOCK-90-OS-DRAG-IMPORT — 工作区文件树 OS 拖入导入 / 拖出导出

最后更新：2026-09-15

状态：`completed（2026-09-15 P0–P3 当日完成：P0 立项（用户裁决「本地 + SSH 全量」+ 追加拖出导出）→ P1 后端双端点 + 契约 8/8 → P2 前端接线 tsc 0 → P3 自动化探针 4/4 + 用户真拖验收「都测试了 可以」→ UI-380 verified 当日闭环）`

计划编号：`BLOCK-90-OS-DRAG-IMPORT`

主模块：`P-01 项目、会话与上下文`（工作区文件面）；协作：`P-02`、前端工作台

前置：BLOCK-89（completed，树内 move/copy/delete/mkdir 双后端同构）BLOCK-67（completed，ssh node-agent fs verbs 面）

## 0. 用户裁决留痕

- 「我说的是 文件 外部也可以到这里」——OS 拖入导入（BLOCK-89 非范围项，本包转正）。
- 「本地 + SSH 全量」——拖入导入 v1 即覆盖双后端（ssh 走分片上传）。
- 「文件中的内容拖拽出来也要实现哦」——追加 OS 拖出导出（本地项目文件）。

## 1. 设计裁决

- **D1 拖入导入（in）**：工作区路由接管窗口级 `dragover/drop`（`preventDefault` 防 Chromium 导航劫持；与 home 页 BLOCK-53「拖文件夹=建项目」按路由天然分区，互不重叠）。落点：文件树目录行（`data-tree-dir`）=该目录，其余=根目录；重名复用 `uniqueTargetName` 自动 `-2`。
- **D2 本地项目导入**：renderer 经 `pathForFile`（webUtils，BLOCK-53 沉淀）取磁盘绝对路径 → 新 IPC 免绕——直接新 REST `fs/import-from { sourceAbsolutePath, toPath }`，服务端 `fsp.cp(recursive)`，无 1MB 上限（源路径由 requireTrustedDesktopOrigin 同源守卫 + 用户本人拖入的桌面文件，威胁模型与既有 fs 路由一致）。
- **D3 ssh 项目导入（分片上传）**：文件在桌面机、工作区在远端——renderer `File.slice` 分片读（**64KB 二进制/片**，b64 后 ~87KB < Linux 单 argv 128KB 上限）→ 新 REST `fs/upload { toPath, dataB64, offset }` → gateway 新 `append`（local=fsp.appendFile / ssh=node-agent 新 `fs_append`）。offset 完整性：追加前服务端 size 必须===offset（0 时目标须不存在），防乱序/并发交叉。
- **D4 ssh 文件夹拖入**：renderer `webkitGetAsEntry()` 递归走目录树 → 逐个 `fs/mkdir` + `fs/upload`。
- **D5 拖出导出（out）**：文件行 `dragStart` 同时设内部 MIME（BLOCK-89 树内互拖不变）+ `DownloadURL`（Chromium 拖到 Finder/桌面即落盘）。仅**本地项目**文件行启用（绝对路径同步可得）；ssh 文件在远端、dir 无 DownloadURL 语义——均不启用（诚实边界，拖出行仅树内移动）。
- **D6 冲突/错误语义**：与 BLOCK-89 同族——目标已存在 409 `target_already_exists`（导入前 `uniqueTargetName` 预消解）；越界 400；源缺失 404；上传中断序 409 `offset_mismatch`。

## 2. 阶段

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| P0 | 立项登记三件套（plan/registry/roadmap）+ UI-380 预登记 | ✅ |
| P1 | 后端：node-agent `fs_append` + gateway `append`×2 + REST `fs/upload`、`fs/import-from` + 路由级契约测试 8/8 | ✅ |
| P2 | 前端：窗口级 drop 接管 + 落点定位 + 双向 dragStart + UI-380 | ✅ |
| P3 | 实机：CDP 合成路径导入 e2e 4/4 + ssh 真远端链路（aliyun）+ 用户真拖验收「都测试了 可以」 | ✅ |
| closeout | 五件套 + 四门 | ✅ |

## 3. 非范围

- 聊天输入框拖入（拖文件=发 AI 附件）——另行候选。
- ssh 文件拖出导出（需先物化本地临时副本 + 异步 prefetch，另行候选）。
- OS 拖入到欢迎页=建项目（BLOCK-53 已有，不动）。

## 4. 验收门

- 路由级契约测试零网络全绿（upload 分片拼装/offset 校验/import-from 本地文件+目录/越界与冲突映射/ssh import 拒绝）。
- `tsc` 0；`docs:check` + `ui:audit:check` 绿。
- 实机（dev Electron）：CDP 合成绝对路径导入 e2e（建临时源文件→导入→树刷新→内容一致）+ **用户真拖一次**（Finder→文件树导入 + 树内文件拖到桌面导出）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
