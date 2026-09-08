# UI-LEDGER-CLOSEOUT —— UI 产品化台账剩余项清债

状态：**planned**（2026-09-08 用户裁决立项；排队待启动，不抢占当前槽位）
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
