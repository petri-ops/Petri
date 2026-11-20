# 乙组剩余（乙5–乙8）签字记录 · YI-REST-WB 批

> **签署方式**：用户 2026-11-20 批量口令「按 Agent 建议 2026-11-20 批量签——本提示词所载各条结论与留因文字即我的裁决内容，Agent 逐字转录回写，不再代签不改判」。本文件为该口令的逐条转录总档；签字槽 canonical=`docs/ui-design-human-eye-route.md` §3（已同批转录）。Agent 不代签、不改判；证据=本目录各 findings.json + PNG（零改写）。

## 一、乙5 · P4 八态矩阵 12 人眼格 → verified（12/12）

- 覆盖断言：4 类元件×{hover, active, focus-visible} 观感呈现与判据一致（判据=docs/ui-design-acceptance-checklist-v1.md §1）
- 证据：`yi5-matrix/`（16 PNG + findings.json）+ `yi5-matrix/matrix-checklist.md`（判定列已回填）
- 留因：input:hover 格=「无 :hover 规则仅 focus 强调，属设计取舍」；navItem:active 格=「由 /extensions 四货架真 tabs（aria-selected）承载；左栏 QuickActions isActive 恒 false 无 aria-current（a11y 观察点已登记）」
- 关键读数：button/listItem/navItem hover 提亮单一档 #f4f4f5；focus-visible 三处真实 Tab 到达且 `matches(':focus-visible')=true`

## 二、乙6 · C-53 P5（2 槽）+ P6（2 槽）→ verified（P6 留因）

- P5 覆盖断言：流式 pending 态/首屏占位/completed/错误态真实渲染，占位零 JSON 泄漏，RunStatsBar 在场
- P6 覆盖断言：skill 触发链消费面真实（「已列技能/已读技能」本地化工具行在场）
- P6 留因：语义匹配真实触发腿为受控注入（mock SSE，UI-711 同款先例），真 provider 腿留观察
- 证据：`yi6-p5p6/`（6 PNG + findings.json）
- 边界：mock run 无后端持久化，完成态经 messages 劫持合成持久化消息走真实 hydrate 链；消息落当前 fixture 会话（如实登记）

## 三、H 系路线 → H-01/H-02/H-03/H-04/H-05/H-07 verified（部分留因）；H-06/H-08 分批

| 项 | 结论 | 覆盖断言与留因 | 证据 |
|---|---|---|---|
| H-01 | verified | /extensions bare（无品牌 chip/分隔线）vs 工作区 chip+标题，DOM+截图双证 | `yi7a-h01h02/h01-*.png` |
| H-02 | verified+留因 | 769 未触发/768 恰好触发（matchMedia max-width:768 单源），768 态左栏按 @media 真实收起；留因=取证形态为 zoom 等效 CSS 布局视口（CDP 在 Electron 无真实窗口 resize，实测沉淀），9223 测试实例取材后 kill | `yi7a-h01h02/h02-{769,768}.png` |
| H-03 | verified+留因 | 暗色 5 类元件 hover：4 类 0.07 同档、文本钮 0.06 差 1 个百分点肉眼不可分辨；input 无 :hover 规则属设计取舍 | `yi7b-h03h04/h03-dark-hover-*.png` |
| H-04 | verified | selected 专用 token：5 accent×明暗 10 态 outline 全随 accent 明暗成对派生；路线 4 色→现面板 5 档漂移如实登记 | `yi7b-h03h04/h04-selected-*.png` |
| H-05 | verified+留注 | 5 个真实三级文字样本对比度 4.75–21.0 全达标；4.40:1 历史组合已由 BLOCK-422 提至 4.81:1、当次未复现 | `yi7c-h05h06/h05-tertiary-*.png` |
| H-06 | 分批 | KnowledgeSpacePanel/welcome/command-center 三文件 verified（fv=true 焦点环可见）；desktop.css pending（outline:none 真 gap 已在 FOCUS_GAP_BASELINE 在册，不算新债）；其余 8 文件 pending 补腿（AnnotationBar 需 artifact、审阅三件需工作树变更态、知识控制台需会话、扩展两件组件未挂载、home 未命中）；VoiceOver 朗读留真人 | `yi7c-h05h06/h06-*.png` |
| H-07 | verified | =乙5 同套证据（12 人眼格） | `yi5-matrix/` |
| H-08 | 分批 | =E-02 同批转录（见下） | 见 E-02 |

## 四、乙8 · E-01 → 保持 pending_human_eye（零代填）

- 判据=真人寻路样本（成功率 ≥80%/首击 ≥70%，IA 材料 §6 原文）；机械点击序列与到达读数已采（`yi8-e01e02/e01-step*.png` + findings.json：MCP 货架 2 击、设置→快捷键 3 击、审阅=右栏 tab、新建任务=工作台视图不路由 /projects 如实读数）。用户亲走五步后按 n=1 留因另批签；签字槽留空。

## 五、乙8 · E-02 22 条 → 分批转录

- 11 条 verified 维持不动、2 条 cancelled 维持不动（终态已封，e-class 指南 §1.1/1.2 分层）
- UI-695 verified+留因：模型菜单就地项在场（`yi8-e01e02/e02-ui695-model-menu.png`）+组件 6/6 已绿；「下一请求生效」腿未实测留观察，发现不生效即 reopen
- UI-331 verified+留因：「刚刚」短式相对时间在场（`e02-ui331-conv-time.png`，n=1 读数）
- UI-200 保持 in_progress：diff 渲染腿需工作树变更态（`e02-ui200-review-surface.png` 为空变更态，如实标注）
- 其余 6 条保持 in_progress：无实机面/等环境（UI-656 测试面守卫、UI-391 纯重构、UI-639/UI-532 同前提 pack 环境、UI-326/UI-304 需造场景、UI-388 IPv6 环境）

### ⚠️ 台账漂移披露（本批核对抓真）

e-class 指南（2026-11-16）分层称 UI-695/200/331 为 in_progress「可过目 3 条」；**台账现值三者均已 verified（2026-11-16）**——UI-695 9223 flow 8/8、UI-200 用户本人人眼过目（「好看/观感 OK」）、UI-331 10-30 实机+11-16 flow 复核。本批按「ledger 为准」**零改写**三条状态，指南分层陈旧如实披露（BLOCK-495 登记滞后同族第 4 次）。

## 六、E-03 → 保持 external-blocked（零代填）

## 七、观察点登记（ 🗃 候选，不立包不实现）

a. compose chart 节点以结构化 JSON 形态渲染（乙6 读数，需核实是否数据形态问题）；b. 左栏 QuickActions 无 aria-current（乙5 读数）；c. 文本钮 hover 0.06 vs 其余 0.07（1pp polish）。

## 八、human-eye-closeout 契约重算结果（fail-closed 如实登记）

生成器 `scripts/c53-human-eye-closeout.mjs` 重算**按设计抛错**——其四组不变量（signatureSlots 全空 / uiLedgerSlots 四槽全 in_progress / batchNewUiFaces 全未签 / humanEyeSlots 零代签）编码的是签署前世界；乙1–乙4（2026-11-19）与本批部分签署后，契约需**语义演进**（部分已签态；P5/P6 槽嵌于 BLOCK-474/475 冻结快照）方可重生成。已立候选（AUDIT-LOG 🗃），演进前旧快照与其消费测试维持原状（冻结基线仍绿）。详见 `closeout-regen-attempt.txt`。

---

签署日期：2026-11-20｜签署人：用户（批量口令 YI-REST-WB）｜转录：Agent（逐字，零代签零改判）
G0 开发期常态 · 不外推 packaged/Provider/GA。
