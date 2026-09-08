# UI-LEDGER-CLOSEOUT —— UI 产品化台账剩余项清债

状态：**completed**（2026-09-09 整包收口：台账 9 项 + 隐藏拼行 UI-184 全部裁决——verified 8 / cancelled 2，台账 in_progress 清零；治理门 ui:audit:check + docs:check + docs:reconcile + tsc 0 全绿。收口记录见 §8）
关联：本文件是 [`docs/ui-productization-audit.md`](./ui-productization-audit.md) 剩余 `in_progress` 项的收口工作包。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 背景与已完成部分

台账状态列权威取法（**勿用裸 grep**）：文档是叙述+表格混合，直接搜 `in_progress` 会有 115 次噪声（历史叙述里的「保持 in_progress」）。必须按状态列过滤：

```bash
grep -E '^\|\s*\*{0,2}UI-[A-Z0-9-]+' docs/ui-productization-audit.md \
 | awk -F'|' '{st=$3; gsub(/[ \t*]/,"",st); if(st=="in_progress") print $2}' | sort -u
```

**2026-09-08 已收口 4 项（in_progress 13 → 9）**，提交 `4ec8cb07`、`f4d6850e`：

| 项 | 处置 | 实机证据 |
| --- | --- | --- |
| UI-159 Workspace plumbing | verified | CDP： `#root` 已挂载；`backend.status()` 返回 `{rRuntime:true,pyRuntime:true,rServerUp:true,serverUp:true,isReady:true}` |
| UI-157 Skills 页面 | verified | CDP 导航 `/skills`：真实渲染 3 个内置 skill，推翻 UI-161「bridge unavailable」旧判据 |
| UI-158 CommandPalette | verified | CDP 注入 Ctrl+K → `.cp-overlay`/`.cp-panel`/`.cp-search-input` 全转 true；再注入 Meta+K 转 false |
| UI-196 DiffActionBar | **cancelled** | 组件已随 BLOCK-43 / UI-193 移除（`frontend/src` 内仅剩一行注释），从未在生产渲染过 |

## 2. 核心阻塞：缺"驱动 harness"

本轮尝试直接验收 UI-156 / UI-181 时撞到同一个真实障碍：**应用停在空会话态**（URL 为 `/project/<id>`，DOM 里是 `sc-example-title` 空态示例），三次点击历史会话均 `not-found` —— 会话列表在 DOM 里不可达。

后果链条：
- 无会话 → 无可 fork 对象 → UI-156 的「创建分支」按设计不出现
- 未打开产物 → 进不了 `result/code/compare/history` 模式 → UI-181 的项目名后缀按设计不追加（chat 模式下标题 `biof3-desktop | 新对话` 是**正确**的，判不了）

**结论：这 9 项不是"探一下就能定案"，而是先要有一套能把应用可靠驱动到目标界面的 harness。这是 PHASE 0 的全部意义。**

## 3. 剩余 9 项分档

| 档 | 项 | 需要的前置状态 | 难度 |
| --- | --- | --- | --- |
| **A. 需驱动到会话/产物** | UI-156 Fork、UI-181 TitleBar 项目名、UI-ATTCH-001（补 ③预览弹窗缩放/ESC、④文档名与图标；①②拖拽与粘贴已实证） | 打开既有会话 + 打开一个产物 | 中 |
| **B. 需 fixture** | UI-180 Working tree diff（需仓库有未提交改动）、UI-P2-001 Result Studio（需项目 + 结果）、UI-183 聊天错误详情（需真实触发一次工具失败） | fixture 工厂 | 中高 |
| **C. 需实验 flag + agent** | UI-AGENTWB-001 ResultCard、UI-AGENTWB-002 TableRenderer | Settings 开 `extraRenderers` flag + agent 产出 `resultNodes` | 高 |
| **D. 需 CodeMirror hunk fixture** | UI-195 inline-diff 行尾 Accept/Reject widget | 带 hunk 的文件进 inline-diff 模式 | 高 |

## 4. PHASE

- **PHASE 0 — harness 建设（前置，必须先完成）**
  0.1 会话导航：定位 LeftPanel 会话列表真实选择器（CSS Modules 哈希名，见 §5），能可靠点进既有会话。
  0.2 产物导航：能打开一个 artifact / 进入 result 模式。
  0.3 fixture 工厂：git 未提交改动、工具失败触发、inline-diff hunk 文件、实验 flag 开关。
  0.4 退出准则：harness 能在全新启动的 dev Electron 上，从冷启动走到「会话已加载」「result 模式已就绪」两个检查点。

- **PHASE 1 — 档 A 收口**（UI-156 / UI-181 / UI-ATTCH-001 ③④）
- **PHASE 2 — 档 B 收口**（UI-180 / UI-P2-001 / UI-183）
- **PHASE 3 — 档 C+D 收口**（UI-AGENTWB-001 / 002 / UI-195）
- **PHASE 4 — 台账同步 + 治理门 + closeout 笔录**

## 5. 已验证的实操纪律（本轮踩出来的，务必遵守）

1. **CSS Modules 让语义选择器大面积失配。** class 是哈希名（`_columnHeader_8f65k_4`、`_centerTitle_uogzf_206`），而命令面板是 `cp-overlay`/`cp-panel`（**不含** palette/command 字样）。**写选择器前必须先读组件源码确认真实 class**，否则会得到假阴性（UI-158 曾被我误判成"未挂载"）。
2. **改台账用行首 ID 前缀做锚点**（`| UI-158 | in_progress | P1 | ...`），状态与证据一次改完。行尾 `| UI-AUDIT-FIX |` 在多行间重复、不唯一。
3. **已删除的能力置 `cancelled` 而非 verified**（UI-182 先例）。
4. **半证据不翻状态。** UI-ATTCH-001 已证 ①② 但 ③④ 未证，保持 in_progress。
5. **CDP 脚本放仓库外**（`scripts/` 有 impact-map 分类规则）；node.exe 是 Windows 二进制，GitBash 传 `/d/x.cjs` 会被解析成 `D:\d\x.cjs`，需 `cd` 到目录后用相对名。
6. **本机宿主安全层拦截合成键鼠输入**，只能用 CDP `Input.dispatchKeyEvent` / `dispatchMouseEvent` 注入（keyDown→char→keyUp 三连 + `modifiers:2`=Ctrl / `4`=Meta 可靠）。

## 6. 门禁

每 PHASE：受影响定向 vitest + `npx tsc --noEmit` 0 + `npm run ui:audit:check` + `npm run docs:check`。
收口：in_progress 清零（或逐项给出 verified / cancelled / not_applicable 的实证裁决）。

## 7. 不外推

不外推 packaged / Provider / GA / P7 / notarization / dist staleness G1+；不为凑数降低验收线；不重新激活任何已关闭 BLOCK；0 新 npm 依赖；不改 IPC 契约。

## 8. 收口记录（2026-09-09 completed）

台账 9 项 + 隐藏拼行 UI-184（挤在 UI-183 行 139 拼行内、线级查询漏计）全部给出实证裁决，`in_progress` 清零：

| 项 | 裁决 | 关键证据（acceptance/ui-ledger-closeout/） |
| --- | --- | --- |
| UI-180 Working tree diff | verified | 2 缺陷修复（a9df9f95：parseDiffFiles EOF 零长度伪影行 + revertPaths tracked/untracked 分区）后 /review 真链复跑全绿（ui180-live.json） |
| UI-P2-001 Result Studio 结果共享 | verified | branchBridge 单点拆包修复后：fixture 分支 tab 切换不重取结果 + DOM 保持（ui-p2001-live.json） |
| UI-183（3 行：WTR hooks ×2 + 聊天错误详情） | verified | /review 长链零 hooks 异常 + fatal fixture 实跑「查看详情」可展开 533 字符 stack（ui183-error-details.json，settings md5 前后一致） |
| UI-156 Fork Chat | verified | Fork 按钮真实点击 → 会话树新增「新对话 (分支)」血缘（ui156-uiattch-verdict.json） |
| UI-181 TitleBar 项目名 | verified | harness 检查点：result 标题含项目名后缀、chat 基线无后缀（harness-checkpoints.json） |
| UI-ATTCH-001 ③④ | verified | 真实 File 对象 DragEvent → 拖拽反馈/双 chip 图标文件名（④）+ 预览弹窗缩放/重置/ESC（③）（ui156-uiattch-verdict.json） |
| UI-AGENTWB-001/002 | verified | flag IPC 裸调修复（1dc133c3）后 ResultCard chrome + TableRenderer 真实渲染（ui-agentwb-live.json）；meta.resultNodes 生产者仍不存在（契约面 only），以 SQL 注入 fixture 走真实持久化+渲染链 |
| UI-195 inline-diff widget | **cancelled** | acceptRejectWidget.ts 已随 f57089cb（BLOCK-43 / UI-193 superseded）整文件退休、生产零引用；活路径 = BLOCK-28 hunkControls（UI-182/UI-196 同型先例） |
| UI-184 SSE 吞流（隐藏拼行） | verified | fatal fixture 实跑即其真链实证：_dispatchSseEvent 同步抛错被入口守卫接住转 onError、ErrorBanner 呈现完整 stack |

随包修复（均为验收过程抓出的真缺陷）：`a9df9f95`（UI-180 ×2 + UI-P2-001 branchBridge）、`1dc133c3`（agent-workbench-flags IPC 裸调 publish —— extraRenderers 开关此前被 bridge.set rejection 永久回滚）、`835332dc`（dev-electron.js 数据根三分裂：BIOF3_LOCAL_DATA_DIR 未导出致后端回落 ~/Documents/BioF3-Local → 模型列表重置 deepseek 默认、用户配置读不到；BIOF3_DB_PATH 钉死 macOS 时代 ~/Library 路径）。

事故记录（如实登记）：PHASE 4 清理脚本曾按标题匹配误删用户会话 conv_240062f9-e01（新对话 (分支)，昨日 UI-156 验证遗留的 fork 拷贝）——已从 WAL 快照恢复全部真实字段（parent_id/timestamps），按 fork 语义以同 id 重建（消息拷贝 4 条 = fork 时点父会话状态）；清理逻辑已改为 id-diff 只删本次新建。
