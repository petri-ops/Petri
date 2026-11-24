---
capability: block517-walk-batch
status: completed
kind: work-package
canonical: true
truthDomain: block517-walk-batch
entrypoint: docs/README.md
registeredAt: 2026-11-24
owner: main-agent
phase: CLOSED
---

# BLOCK-517 · 筐② 五项 9223 实机走查批（plan）

> 发令：owner「逐个进行走起来」第一项（2026-11-24）——EXECUTION-PLAN 零风险准备步：UI-702/699/698/697/694 五项 9223 实机走查（每项 S、零外部依赖、不依赖 G1 决策）。台账口径=把「代码完成没验收」变「能用」。
> 纪律：观感零代签；binary 降级腿（UI-697）/结果库 cv 腿（UI-699）需特定产物场景，不可达**如实 skip 不伪造**；dev 栈跑完即 kill 复核 0 监听；发现新缺陷只登记不扩包。

## 1. 范围（五项走查，逐项独立提交）

| 序 | 项 | 台账缺口原文口径 | 走查面 |
|---|---|---|---|
| W1 | UI-702 通知历史回看+viewer 降级语义 | 实机走查（通知历史 UI 态） | 通知中心面板：历史列表/已读语义/viewer 降级 status 提示 |
| W2 | UI-699 字号 token 收敛+行 cv 预算 | 会话行 cv 在 p_mvtu0b52_9cbr 过；**结果库行 cv 待人工（结果面板 UI 态依赖）** | 会话行 content-visibility 复核 + 结果库行 cv（结果面板态不可达则如实 skip） |
| W3 | UI-698 隐藏层 inert+项目树语义+导入表单+live region | 代码+契约完成，待实机观感 | inert 面语义/项目树 aria/导入表单标签/live region 宣告 |
| W4 | UI-697 viewer 三段式+降级原因上抛 | live 腿 6/6 过；**binary 降级腿需 binary 产物（不可靠复现，待人工）** | 已过腿复核 + binary 腿不可达如实 skip |
| W5 | UI-694 设置面板五段+档位锁定+钉住多格式预览 | 代码+组件测试完成，待实机腿 | 设置五段在场/档位锁定提示/钉住预览格式 |

## 2. 非范围（exclusions）

- 观感签字（零代签）；binary/结果库不可达腿（skip 带原因）；新缺陷（只登记）；19 项 WIP/frogfish；G1+。

## 3. 验收门禁

- 每项：走查 flow allPass（含如实 skip 项）+ 台账行更新（verified 仅限走查判据全过且无不可达欠账；有欠账的如实标注欠账腿）。
- 收口：closeout 全门（存量红如实归属）；证据=acceptance/block517-walk-batch/。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 收口笔录（2026-11-24 · completed）

提交链：立项 `d1e988585` → W1 `b5b88821b` → W2 `f933f08ea` → W3 `1b40dc4ee` → W4 `f96212639` → W5 `741dde8e8` → 对账 `0806a5abf`/`5a75dec6c`/`88b56f8eb` → 本批回写。

- **五腿全走查**：W1 UI-702 7/7（通知历史回看全链真实路径）→ W2 UI-699 5/5（会话行 cv=auto 确认；结果库行不可达如实 skip）→ W3 UI-698 5/5（树语义+导入面板语义；inert 双模态腿 skip=入口不存在，契约覆盖）→ W4 UI-697 5/5（binary 降级卡+无 HTML 错分派实证；工作区预览=现存 binary 预览面）→ W5 UI-694 7/7（五段真连后端；重新检测钮/pdf 渲染腿如实 skip）。
- **台账口径（观感零代签）**：五项状态均维持 in_progress 不翻 verified——欠账腿=观感/读屏/特定产物场景（归人归后续）；机械判据腿已全部补齐并留证。
- 门禁：walk flows 全部 allPass（7/7+5/5+5/5+5/5+7/7）；test:changed **313/2**（2 红=BLOCK-462 three-live 环境漂移族，S0/COMPLETENESS 筐⑤已归属，模型3d域零触碰 git 实证）；post-h9 **186/186**（knip 上限 414→420 同步留痕 `88b56f8eb`）；knip 420 键（五 W flow 留因）；lint 0 errors；types 0。
- 台账滞后两处随批纠正（living-plan C 类源文件未动留归位令——兴奋抓真后如实分级）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
