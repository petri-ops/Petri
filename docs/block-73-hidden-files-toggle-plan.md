# BLOCK-73 — 文件树「显示隐藏文件」开关（方案 A）

> 状态：`active`（2026-09-09 用户确认方案 A，同日立项即开工）
> 立项日期：2026-09-09
> truthDomain: `block-73-hidden-files-toggle`
> UI 台账：UI-322（UI-321 已被并行 BLOCK-67 P1 占用，顺延）
> 来源：用户观察「右侧边栏的文件，好像看不到隐藏文件和隐藏文件夹」并确认优化方案 A

## 1. 事实基线（已读源核实）

- 右栏文件树 → `GET /api/workspaces/:id/tree` → `routes/files.js` local 分支
  `.filter((entry) => !entry.name.startsWith('.'))` **服务端硬过滤**所有点开头条目，前端无开关。
- ssh 分支（并行 BLOCK-67 P1c 在制）：node-agent `fs_list` bash verb 侧过滤
  （`for f in "$d"/*` glob 天然不匹配点文件 + `case .*` 显式跳过）。

## 2. 方案 A（用户确认）

- 文件树工具条新增「显示隐藏文件」toggle（eye/eye-off 图标，`aria-pressed`），**默认关**（维持现状体感）。
- 服务端过滤参数化：local 分支 `?showHidden=1` 时跳过点文件过滤；前端 fetchDir 携带参数；
  偏好持久化 `localStorage['petri.fileTree.showHidden']`；切换即整树刷新（refreshFiles 链 + refreshVersion
  联动 FileTreeItem 子目录重取）。
- 0 新依赖；审阅面板（git 通道）不受影响。

## 3. 范围边界（诚实登记）

- **ssh 项目本包不放开**：放开需动 node-agent/workspace-gateway——并行 BLOCK-67 P1 在制面，
  按文件面纪律不触碰。UI 对 `workspaceKind === 'ssh'` 的项目禁用开关并注明；
  fetch 参数对 ssh 分支为 no-op（行为不变）。ssh 侧放开登记为 BLOCK-67 后续协调项。
- `.git` 特殊保护未选（用户仅确认 A）：开关开 = 显示全部点文件（含 .git），与「看到所有文件」语义一致。

## 4. 验收门

- 定向 vitest：local 分支默认隐藏 / showHidden=1 显示 / ssh 分支不受参数影响（零网络，复用 block67 harness 模式）
- tsc 0；docs:check + ui:audit:check
- 实机 CDP：toggle 开 → .gitignore 等点文件出现在树中，关 → 消失；偏好持久化（刷新后保持）
- UI-322 台账与实现同提交登记；G0 开发期常态 · 不外推 packaged/Provider/GA
