---
capability: block-268-scratchpad-live
goal: UI-585 速记板开态抗重挂实机腿补验（BLOCK-267 交付的组件级实现推到实机 verified）：隔离 9223 亮/暗双腿，断言开→跨重挂保留→Esc 关闭→刷新归零四链；全程离屏零弹窗。
acceptance:
  - 实机断言 JSON 落 acceptance/block-268/scratchpad-live{,-dark}.json，亮/暗各 5 条断言全 PASS。
  - 跨重挂触发=真实路由切换（首页→设置→回首页，SPA 卸载重挂 ScratchpadDock 子树）；断言 aria-expanded 与 sc-scratch-panel 同步保留。
  - 刷新归零=有意语义（模块级 store 零持久化），reload 后 aria-expanded=false 断言钉住该边界。
  - 台账 UI-585 in_progress → verified；closeout 十三门 PASS；registry/roadmap/handoff/AUDIT-LOG 回写。
reopen: 跨会话记忆开态（产品决策，BLOCK-267 已判不做）；流式推进触发的重挂形态（组件测试已覆盖同语义，实机以路由切换为代表路径）。
status: completed
---

# BLOCK-268 · UI-585 速记板开态实机腿补验

用户发令：「行！ 你规划一下 按顺序批次完成」（2026-10-27）——批次 1/5（实机腿补验批，Jev 建议 confidence=1.00）。

## 0. 启动前置（2026-10-27 实测）

| 项 | 事实 |
| --- | --- |
| 分支 | `main`，`ebc43aca`（BLOCK-267）已提交，工作区干净，领先 origin 1 笔 |
| active 槽位 | 无 active 工作包；本包占用 |
| 台账现状 | UI-585 in_progress（BLOCK-267 组件 3/3，实机未跑）；UI-583/584 已 verified（BLOCK-266 实机 4/4）——本批唯一实机目标=UI-585 |

## 1. 断言面（4+1 条）

| 断言 | 路径 |
| --- | --- |
| `UI585_dock_open` | 首页 composer 点 `[data-testid="scratchpad-toggle"]` → `aria-expanded=true` + `[data-testid="sc-scratch-panel"]` 在场 |
| `UI585_remount_keeps_open` | `Page.navigate('/settings')` 等 settings 在场 → `Page.navigate('/')` 等 composer 回来 → `aria-expanded=true` + panel 在场（SPA 卸载重挂，模块级 store 重读） |
| `UI585_close_semantics` | `document` 派发 Escape keydown（面板既有监听）→ `aria-expanded=false` + panel 消失 |
| `UI585_reload_resets` | `Page.reload` → 页面 ready 后 `aria-expanded=false`（零持久化边界钉住） |
| `S1_seeded_project_conversation` | 隔离栈 seed 项目+会话 |

## 2. 基础设施

复用 BLOCK-265/266 实机模式：`scripts/block268-scratchpad-live.mjs`（隔离栈 :3001/:3000/:9223 + 临时数据根，Electron `--remote-debugging-port=9223` 离屏，`--force-dark-mode` 走暗轮）+ flow `.agents/skills/petri-dev-infra/dev-verify/flows/b268-scratchpad-live.cjs`。测试纪律：零弹窗（离屏实例 show:false 语义由 PETRI_TEST_INSTANCE 承载）、不干扰其它程序。

## 3. 收口

亮/暗两轮全 PASS → 台账 UI-585 verified（同批回写 BLOCK-267 行的"实机未跑"注记）→ closeout 十三门 → 提交（不推送，推送需用户发令）。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 4. 收口记录（2026-10-27）

- 亮/暗各 **7/7** PASS（`acceptance/block-268/scratchpad-live{,-dark}.json`）。
- **实机抓真一处**：首版用 CDP `Page.navigate` 作重挂触发=整页刷新（新 JS realm，模块级 store 归零）误杀开态——修正为 SPA 内部切换（点 `sidebar-settings` + `history.back()`），核心断言即绿。组件测试的「重挂」语义与真实 SPA 卸载重挂一致，实机路径此前选错，非实现缺陷。
- impact-map 登记 block268 规则（patterns 用 `acceptance/block-268/**` 目录 glob——首版列具体文件名导致 test-affected 的 acceptance 目录断言红，18/18 复绿）；契约测试 2/2。
- 台账 UI-585 in_progress → verified；closeout 十一门+lint/types；不推送（推送需用户发令）。
