---
capability: block513-ui-live-legs
status: active
kind: work-package
canonical: true
truthDomain: block513-ui-live-legs
entrypoint: docs/README.md
registeredAt: 2026-11-24
owner: main-agent
---

# BLOCK-513 · UI 实机补腿包（plan）

> 发令：owner 经 Orca 转达主人「还有没做的内容 继续启动不要停下来」第 1 项（2026-11-24）：UI 实机缺腿组复核——本机能走查的走掉、如实升 verified；需隧道/真实 provider 的继续挂外部。
> 前置复核：七项逐条读台账（原文关键句在案）；owner 独立核码同批确认。**L5 改判**：UI-663 已由 UI-670（BLOCK-342）交付并 verified，531 行=旧降级条目内部矛盾 → 纯文档归位，不造实现工作。
> 同批纯文档：母纲行 695 过期推荐行纠错（Q4b/Q9-REM/P4-REM 已收口、§6.5 清零）+ NEXT-STEP-BRIEF 口径同步 + block-262 reopen 列对齐（代码领先台账反向例）+ Q7 reopen 候选池裁决材料（`acceptance/q7-reopen-candidates/DECISION-MATERIAL.md`，单一推荐 Q7 cron 包，pending_user_ruling 不硬开）+ C-56 英文面 U 材料已备（`acceptance/c56-english-surface/`）。

## 1. 范围（六项，串行执行，每项独立提交）

| 序 | 项 | 腿 | 做法 |
|---|---|---|---|
| L1 | UI-593 右栏空态引导（最轻） | 9223 实机走查 | 新 flow：EmptyResult 标题章/描述块/六卡 2 列网格/居中/悬停 accent；亮暗各截图；对账 `acceptance/block-277/` 旧证据与降级判定的矛盾 |
| L2 | UI-522 模型渠道导出脱敏 | 9223 点导出 | 新 flow：设置→模型接口→导出→落盘断言 Key 仅后四位、明文零出现、信封/列序不变；二次确认出明文路径对照 |
| L3 | UI-475 识图未配置前置阻断（实机腿） | 隔离栈 env 无 vision 凭据 | 新 flow：`vision_configured=false` 阻断 + 文案在位、true 放行；**用户贴图观感腿保留 pending_human_eye 不代签** |
| L4 | UI-693 Inkscape 协处理器 flow 腿 | 本机 Inkscape 1.4.4 已装（探针 available） | 新 flow：union→1 path、text 路径化、difference 真差集、export-pdf 落盘非空，全经 CAS+审计链 |
| L5 | UI-663 未保存改动清单 | **复核改判（2026-11-24 owner 独立核码同结论）：纯文档归位**——该功能已由 **UI-670**（BLOCK-342 收口）以 `pendingOps` 方案交付并于 2026-11-03 verified（dev Electron 边界内，实机 35/35 allPass，`svgChangeList.ts` 在案）；台账 531 行系同一件事的旧降级条目（内部矛盾），加指向注记即可，**不造实现工作** |
| L6 | UI-595 批注画笔平滑 | 图像 artifact 在结果面打开（造本地 tool job 先例 `block334-result-host-live`） | 新 flow：CDP 真实指针 freehand→polyline→path 平滑渲染→保存 REST path 契约不变 |

## 2. 非范围（exclusions）

- UI-482：登记腿=真机过隧道断连/恢复，需外部环境——**本机模拟不等价，不翻 verified**（挂外部维持）。
- UI-475 用户观感腿（实机贴图过目）：pending_human_eye，零代签。
- 19 项未跟踪 WIP、frogfish、G1+：零触碰。
- 观感签字一律等用户口令；本包只补机械可判据的实机腿。

## 3. 红线与纪律

- HK-01 红绿先行（L5 改实现必走；纯补腿 flow 以「flow 先红（缺腿）→绿」留证）。
- 9223/隔离栈离屏跑完即 kill；零新依赖；台账升 verified 仅限「台账登记的腿已补且机械可判据」的项，观感项不动。
- dev 栈纪律见 `$petri-dev-infra`；每项独立提交+定向测试。

## 4. 验收门禁（收口逐项对账）

- 每项：新 flow 断言数 + 台账行更新（verified 仅限机械判据腿；UI-475 停在「实机腿已补、观感腿待签」）。
- 收口：`npm run closeout` 全门（存量红 lint:ledger/EAR 如实归属）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
