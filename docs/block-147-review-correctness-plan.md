---
capability: review-correctness
goal: BLOCK-147 A2 审阅正确性批——把 WorkingTreeReview 的 hunk 决策从「可能错位的索引账」修成「可信的内容寻址账」：①决策键内容寻址（refresh 后不再错位挂到未审 hunk）②未决 hunk 可见且提交有拦截（「待定」死分支激活）③键盘焦点有视觉反馈（↑↓/j/k 切换联动滚动+高亮）
acceptance:
  - 三项红绿先行（HK-01）：每项先写失败测试（#1 必须先复现「refresh 后决策错位」场景）再实现，红→绿证据随收口笔录留痕
  - #1 决策键内容寻址（hunk 头+上下文指纹）或 refresh 后按 hunk 头对账重挂——设计取舍留痕 notes；既有 accept/reject 行为零回归（存量测试全绿）
  - #2 未决 hunk 计数真实可见（非恒 0）+ 提交确认前拦截（列出未决文件/条数，用户可显式继续或回去审）；提交路径不绕过拦截
  - #3 focusedHunk 变化联动滚动（scrollToLine/jumpToHunk 现成 api）+ 焦点 hunk 高亮；样式走既有 token 阶梯（禁十六进制/slate 字面量），theme-token-contract 契约测试绿
  - 定向门禁：test:changed + quality:types/lint/secret/arch 全绿 + 前端定向测试（npm run test:files --prefix frontend）；closeout 十一门（集成提交后）
reopen: hunk 级后端 stage（文件级 stage 的根本改造）另立批；reject→regenerate 回路优化属后续
status: completed
---

# BLOCK-147 A2 审阅正确性批（审视批序列第 2 批）

## 1. 背景与裁决溯源

- 源头：双视角全面审视（dwfrun-6724f75c）A2 角度高影响发现 #1/#2/#3（换眼复核确认）；剩余工作地图（dwfrun-25f8657a）裁决为三批价值主线之首。
- 发令：用户 2026-10-08「按顺序直接推进 尽可能的走远」——序列批量发令，本批为第一站（BLOCK-146 已收口）。
- 定位：审阅面正确性——决策账本可信 + 未决可见 + 键盘流可用，全部既有功能优化，零新功能面。

## 2. 范围（三项，同文件面串行实现）

| 项 | 审视发现 | 内容 | 主文件 |
| --- | --- | --- | --- |
| 决策键内容寻址 | #1 | hunk 决策键从 file.path#index 改为内容寻址（hunk 头+上下文指纹），或 refresh 后按 hunk 头对账重挂——消灭「被拒 hunk 消失→索引前移→旧决策错位挂未审 hunk」 | useWorkingTreeReview.ts、ReviewMode.tsx |
| 未决可见+提交拦截 | #2 | 未决 hunk 计数真实（pendingCount 死分支激活或按 diff hunk 数对账）+ 提交确认前拦截未决（列出明细，可显式继续） | useWorkingTreeReview.ts、ReviewMode.tsx |
| 焦点视觉反馈 | #3 | focusedHunk 变化→scrollToLine 联动 + 焦点高亮样式（token） | ReviewMode.tsx、CodeMirrorDiffView.tsx、ReviewMode.css |

## 3. 非范围

- 后端 hunk 级 stage（working-tree-review.js 文件级 stage 的根本改造）——另立批。
- reject→agent 重新生成回路体验、审阅徽章信息到达率——审视批 A2 中低影响项，后续批。
- G1+ 不外推；不新增依赖；不改 HTTP/IPC 通道面（如需新通道按 channels.js 纪律，预计零）。

## 4. 实现形态

- dynamic workflow：单实现员串行三项（同文件面禁并行互踩，红绿先行）→ 独立评审（P1 必修）→ 统一门禁（红了即修 ≤2 轮）。
- **工作流内不提交**：改动留工作区，主代理终审后集成提交（既有形态）。
- CSS 纪律（gewu-css-theme）：颜色一律走既有 CSS 变量/token（先读 ReviewMode.css 与 themes/ 现有写法），禁新增十六进制/slate 字面量，写完跑 theme-token-contract 契约测试。

## 5. 验收与证据

- 红绿证据：#1 错位场景复现测试（refresh 模拟）红→绿；#2 未决计数/拦截测试红→绿；#3 焦点联动组件测试红→绿。
- 定向门禁：`npm run test:changed` + `npm run quality:types/lint/secret/arch` + 前端定向 `npm run test:files --prefix frontend -- <相关文件>` + theme-token-contract。
- 收口：closeout 十一门 + 台账回写；若 CSS/组件体积触碰 code-size 棘轮按 R-2 机制重锚登记。
- 证据落 `acceptance/block-147/`（收口时主代理整理）。

## 6. 风险与边界

- #1 键形态变更是「账本迁移」：存量 decisions（旧索引键）在升级瞬间的语义——选择丢弃重建（决策本就轻量）或双读兼容，取舍留痕；不得静默错读。
- #2「未决」判定基准：以当前 diff 的 hunk 全集 − 已决策键集合计算（内容寻址后天然准确），不依赖 pending 写入路径。
- #3 高亮与既有 :focus 样式的特异性冲突按 css-theme skill 的 infima 特异性战争规则处理（组件级 class 限定）。

## 7. 完成语义

三项交付 + 评审 P1 清零 + 统一门禁绿 + 主代理终审集成提交 + closeout 十一门 PASS + 台账五件回写。序列下一批（B9 分析输入可达性批）在同序列发令下由主代理接续立项。

## 8. 收口笔录（2026-10-08 当日立项当日收口）

- **三项交付**（dwfrun-39d8ec9a 单实现员串行+红绿先行）：#1 决策键内容寻址 `path#h{oldStart}-{FNV-1a}`——refresh 后被拒 hunk 消失不再错位挂未审 hunk，后端 lastIndexOf 契约兼容零改动，无持久层故升级瞬间无旧键面；#2 未决计数真实可见（diff hunk 全集−已决键，按文件明细）+ 提交确认拦截（⌘Enter/按钮同路径）；#3 焦点滚动联动+is-focused 持续高亮（纯 token，theme-token-contract 4/4）。
- **独立评审 P1=0**；P2 三条在主代理集成批全部修掉：scrollToLine y 偏好透传（焦点联动 nearest 防抖动，既有调用方默认 center 不变）/ staged 提交框同款未决拦截（handleStagedCommitGuarded，两调用点齐换；未附独立红绿——形态与主路径拦截同款且主路径已测，如实注记）/ 键形态锚测试（签名段不含 # 的机械守卫）；后端注释漂移顺手修。
- **门禁**：统一门禁全绿（test:changed/types/lint/secret/arch/theme-token-contract）+ closeout 十一门 PASS；code-size 棘轮两次 R-2 重锚（工作流交付面 + P2 集成面，IPC 文件 +2 行为注释）。
- **红绿证据**：错位复现（状态化 diff mock：reject 后 A 消失、B 前移）/ 未决计数与拦截取消放行 / 焦点迁移 pulse——三项红→绿两轮输出在 impl-report 卡片；定向 52/52。
- **边界**：实机走查未做（UI-466 in_progress 待过目或 dev-verify flow）；后端 hunk 级 stage 非范围。序列下一批（B9 分析输入可达性批）按「按顺序直接推进」授权接续立项。
- 证据=acceptance/block-147/evidence.json。G0 开发期常态 · 不外推 packaged/Provider/GA。