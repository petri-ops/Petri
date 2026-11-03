---
capability: block-341-game-engine-bridge
status: active
goal: 受治理的本地游戏引擎桥（Godot 4 headless 先行）+ Blender 现有工程受治理扩档：把推文里「agent 操作引擎 → 运行 → 看画面 → 改 → 再验证」做成 Petri 形态——单真值 / manifest sha / propose-apply 修订快照 / 放权坡道审批 / 诚实 `capability_unavailable`。对照 Kimi「游戏开发与创意工作解决方案」推文评估（2026-11-02）的核心缺口。
acceptance:
  - P0 形态裁决钉死（立项自检问句答案）：差别形态 = 本地主权（引擎 / 脚本 / 渲染全在用户机器，无云端中继）+ 单真值（改动经 propose/apply 落修订快照与语义 diff，不绕开 artifact 链）+ 治理透明（白名单外脚本 / 命令默认 require-ack，走放权坡道 observe→allow 与 ack 审计）+ 证据自证（运行截图 / 日志 / 退出码落 manifest sha 可复核）；不复刻「云端大模型直连专业软件」。P5 Blender 扩档边界与 BLOCK-322 RULING-01「不建第二场景真值」的关系在启动时由用户显式裁决。
  - P1 Godot 发现与能力探针：`PETRI_GODOT_BIN` + 常见安装路径发现；版本 / headless / `--write-movie` 能力探测 → capability 状态；缺席诚实 unavailable（同 Blender / R 先例：不内置、不下载引擎）。
  - P2 `godot_run` 工具：headless 跑项目 / 场景 ≤N 秒，采集 stdout / stderr / 退出码 / 截图序列（`--write-movie` 或截图脚本）→ manifest（sha256 + 参数 + 时长）；截图序列经 BLOCK-340 同一「帧→vision」管线；超时与残留进程处置复用 `process_status` / `process_stop` 先例。
  - P3 `godot_scene_apply`（model3d propose/apply 模式平移）：.tscn / .gd 的白名单操作（节点属性 / 资源引用 / 脚本片段替换），before/after hash + 修订快照 + 语义 diff；白名单外一律 require-ack 走坡道，绝不静默放行；不接受任意 shell 参数与路径逃逸。
  - P4 观察-判据-迭代样例：跑 → 截图 → `read_image` / vision 判据 → goal 状态机迭代一轮；接口对齐 BLOCK-335，不建第二执行器、不建第二 Goal。
  - P5 Blender 扩档 `model3d_blend_ops`：对**现有 .blend 工程**的白名单操作（import / transform / material / render / 导出）经固定参数化脚本执行（扩 `resources/model3d/blender_scene.py` 命令面），不开放任意 bpy；.blend 视为外部资产，provenance 入 manifest，不产生第二场景真值。
  - P6 契约 + 实机：契约测试 mock godot 二进制三路（成功 / 缺席 / 超时）+ mac 实机（真 Godot 4.x 示例项目跑 5s → 截图 ≥3 帧 → manifest sha 复核 + 坡道审计行在案）；聊天内 ChatArtifactCard 展示截图序列（复用 BLOCK-322 artifacts 投影，不建新卡）；证据 `acceptance/block-341/`；impact-map；closeout + 台账回写。
reopen: Unity（Tuanjie / batchmode）与 UE（commandlet）桥——闭源 / 许可 / 编辑器自动化面大，v1 不做；Godot 编辑器 GUI 自动化（`computer_*` 通用路径已可达，不专用化）；素材批量生产通用剪辑链；游戏内助手部署形态（federation / MCP server 已有雏形，非本包）。
---

# BLOCK-341-GAME-ENGINE-BRIDGE — 受治理游戏引擎桥计划（Godot 先行）

- 登记状态：**active（2026-11-03 启动；用户「确认 一次性搞完 不用再问」=发令）**——P0 形态裁决按 plan 预答钉死；**P5 Blender 扩档边界裁决=用户已确认按 plan §P5 预答执行**（.blend 视为外部资产、provenance 入 manifest、不产生第二场景真值；实施中若发现与 322 单真值实质冲突则停下上报）。Godot 4.7.1 已在本机（/opt/homebrew/bin/godot + /Applications/Godot.app）。
- 立项裁决：用户 2026-11-02 对照 Kimi 游戏解决方案推文的能力评估后「可以的 梳理好了 这一块是否要建个 block 后续排队推进？」→ 主代理答「要」并登记排队（planned，未启动）。
- 队列位置：**340 之后（当前末位）**；依赖 340 的帧→vision 管线与 335 的闭环接口；336 worktree 便于与其它包并行，非硬依赖；323 放权坡道已完成可直接复用。
- 唯一真相域：本文件（block-341-game-engine-bridge）
- 文件面：`core/petri-server/helpers/godot-provider.js`（新，仿 `blender-provider.js` 形态）/ `agent-tools/godot-tools.js` + `tool-defs/godot.js` + `registry.js` + `tool-metadata.js` / `helpers/model3d-blend-ops.js`（新）+ `resources/model3d/blender_scene.py` 命令面扩参 / `agent-tools/model3d-tools.js` 注册 / 前端 ChatArtifactCard artifacts 投影复用 / `test/impact-map.json`

## 1. 评估结论（2026-11-02 主代理按代码实况核对）

| 推文能力 | Petri 现状 | 结论 |
| --- | --- | --- |
| 操作 Blender | 本地 Blender 后端（968 行受控脚本）+ SceneSpec 单真值 → 多视角渲染 / 转盘 / GLB-STL-STEP 导出 / BOM / `model3d_visual_qa` | 🟡 已有「声明式规格→受控构建」，缺「现有工程受治理操作」（P5） |
| 操作 Godot / Unity / UE | 全仓 grep 为零专用桥；通用手已有：`computer_screenshot/click/type` + `workspace_exec(_background)` + `process_status` | ❌ 够得着、没专用桥、没产物链与治理实例（P1–P3） |
| 运行→看画面→改→再验证 | 原语齐（exec_background / screenshot / read_image / goal 状态机）；`model3d_visual_qa` 是 3D 域内一次性实例 | 🟡 闭环未泛化（P4 对齐 335） |
| 交付保留 diff + 验证记录 | working tree 评审 / artifact 修订 / 血缘 / manifest sha | ✅ 强项，本包沿用 |
| 明确操作权限与人工确认 | 放权坡道 observe→allow / 动态审批 / `computer_authorize` / `ask_user_question` / 审计 | ✅ 强项，本包把「任意脚本」接到坡道 |

推文的配方 = 模型 + 专业工具插件 + 实机验证闭环 + 无人值守；Petri 的骨架与治理已齐，本包补「专业工具桥」这一支柱，闭环与无人值守由 335 / 338 / 336 / 337 承担。

## 2. 形态自检（产品个性纪律问句）

「这个能力的形态与 ZCode / Codex 的差别在哪？本地可审计 / 治理透明 / 证据自证体现了吗？」——答案即 P0 四条：引擎与脚本不出机器；每次变更有修订快照与语义 diff；白名单外默认要批且留 ack 审计；运行证据（截图 / 日志 / 退出码）带 sha 可复核。推文把「明确操作权限和需要人工确认的环节」写成使用须知，Petri 把它做成产品能力——这是形态差别，不是功能复刻。

## 3. 红线

- 不建第二执行器 / 第二真相（截图与 manifest 走现有 artifact 链；Goal 走 335）；不开放任意脚本（白名单 + 坡道）；不内置 / 下载引擎（用户自装，缺席诚实）；Unity / UE 不进 v1（reopen）；P5 不破坏 322 单真值（启动时用户显式裁决边界）；G1+ 不外推。

## 4. 阶段

P0 形态裁决 → P1 发现与探针 → P2 `godot_run` → P3 `godot_scene_apply` → P4 闭环样例（对齐 335）→ P5 Blender 扩档 → P6 契约 + mac 实机 + closeout。P0 / P5 各含一个用户裁决点；其余按单工作包串行推进。

## 5. 风险与前置

- Godot 4.x CLI 参数随版本漂移（`--headless` / `--write-movie` / `--quit-after`）：探针按版本分支，契约用 mock 二进制固定三路。
- headless 渲染截图依赖 GPU / 软件渲染可用性：mac 实机为唯一真实证据，缺席路径必须诚实。
- 引擎内截图不走屏幕录制权限（与 `computer_screenshot` 的 macOS 权限面无关），避免把平台权限问题混入本包。
- 前置：BLOCK-340（帧→vision）、BLOCK-335（闭环接口）；BLOCK-323 放权坡道（completed）。
