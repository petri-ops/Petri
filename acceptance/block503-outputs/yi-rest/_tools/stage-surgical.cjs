#!/usr/bin/env node
'use strict';
// YI-REST-WB 外科暂存：共享文件按 HEAD 内容 + 本批插入构造暂存 blob（不裹挟他方未提交行）。非产品代码。
const { execSync } = require('node:child_process');

const file = process.argv[2];
const head = execSync(`git show HEAD:${JSON.stringify(file)}`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

let out = head;
let applied = 0;
const insertAfter = (anchor, insertion, label) => {
  if (out.includes(insertion.trim().slice(0, 40))) { console.log(`${file}: ${label} 已在 HEAD？跳过（防重复）`); return; }
  if (!out.includes(anchor)) throw new Error(`${file}: 锚点缺失（${label}）`);
  out = out.replace(anchor, anchor + insertion);
  applied += 1;
};
const insertTop = (insertion, label) => {
  out = insertion + out;
  applied += 1;
  console.log(`${file}: ${label} 顶部插入`);
};

if (file === 'docs/ui-productization-audit.md') {
  const TOP = `> BLOCK-503 · YI-REST-WB 人眼签字回写批（2026-11-20）：乙组剩余（乙5–乙8）证据采集+用户批量口令签署——**乙5 P4 八态矩阵 12 人眼格 verified**（input:hover 格留因=无 :hover 规则仅 focus 强调属设计取舍；navItem:active 格留因=由 /extensions 四货架真 tabs 承载、左栏 QuickActions 无 aria-current）、**乙6 P5 两槽 verified / P6 两槽 verified+留因**（消费面真实；语义匹配真实触发腿受控注入留观察）、**H-01/H-02/H-03/H-04/H-05/H-07 verified**（H-02 留因 zoom 等效布局视口、H-03 留因 0.06 vs 0.07、H-05 留注样本 4.75–21.0 全达标且 4.40:1 已由 BLOCK-422 提至 4.81 未复现）、**H-06/H-08/E-02 分批**（H-06 三文件 verified+desktop.css pending 在册+8 文件 pending 补腿；E-02：11 verified/2 cancelled 终态维持、UI-695/UI-331 verified+留因、UI-200 与其余 6 条 in_progress 维持）、**E-01/E-03 保持 pending_human_eye 零代填**。签字记录=\`docs/ui-design-human-eye-route.md\` §3 + \`acceptance/block503-outputs/yi-rest/signature-record.md\`（证据=\`acceptance/block503-outputs/yi-rest/\`）。**零 CSS/组件/token 写面、零新依赖、debt 棘轮零改动**；台账 UI-695/200/331 已于 2026-11-16 verified（本批零改写，e-class 指南分层陈旧如实披露）。G0 开发期常态 · 不外推 packaged/Provider/GA。\n\n`;
  insertTop(TOP, '顶部批登记行');
  const anchor422 = '- **BLOCK-422 追加（同段，不新增债）**';
  const line422End = out.indexOf('\n', out.indexOf(anchor422));
  if (line422End < 0) throw new Error('BLOCK-422 行尾定位失败');
  const BULLET = `\n- **BLOCK-503 乙组剩余签署追加（2026-11-20，同段，不新增债；观感结论出自用户批量口令，Agent 转录）**：本段涉及的观感槽逐件翻 verified——① **H-03**：暗色 5 类元件真实 hover（图标钮/列表项/导航项 0.07 同档、文本钮 0.06 差 1pp 留因、input 无 :hover 规则属设计取舍），证据=\`acceptance/block503-outputs/yi-rest/yi7b-h03h04/h03-dark-hover-*.png\`；② **H-04**：selected 专用 token 5 accent×明暗 10 态 outline 全随 accent 成对派生（\`h04-selected-*.png\`）；③ **H-05**：三级文字对比度 5 真实样本 4.75–21.0 全达标（4.40:1 历史组合经 BLOCK-422 修复后未复现），签名槽=route §3 H-05 行；④ **乙5/H-07**：八态矩阵 12 人眼格 verified（hover/active/focus-visible 三态观感终结 \`pending_human_eye\`；input:hover/navItem:active 两格留因在案），证据=\`yi5-matrix/\`；⑤ **H-06 分批**：KnowledgeSpacePanel/welcome/command-center 三文件 verified（fv=true），desktop.css pending（outline:none 真 gap 已在 FOCUS_GAP_BASELINE 在册）、其余 8 文件 pending 补腿（AnnotationBar 需 artifact/审阅三件需工作树变更态/知识控制台需会话/扩展两件未挂载/home 未命中），证据=\`yi7c-h05h06/\`。三处观察点（compose chart JSON 形态渲染/左栏 QuickActions 无 aria-current/hover 1pp）已登记 AUDIT-LOG 候选。签名总档=\`acceptance/block503-outputs/yi-rest/signature-record.md\`。`;
  out = out.slice(0, line422End) + BULLET + out.slice(line422End);
  applied += 1;
} else if (file === 'docs/AUDIT-LOG.md') {
  const TOP = `最后更新：2026-11-20（🏁 **YI-REST-WB 乙组剩余回写批（用户批量口令按 Agent 建议 2026-11-20 批量签）**：乙5 八态矩阵 12 人眼格 verified（input:hover/navItem:active 两格留因）、乙6 P5 两槽 verified/P6 两槽 verified+留因（真实语义触发腿受控注入留观察）、H-01/H-04 verified、H-02/H-03/H-05 verified+留因（zoom 等效布局视口/0.06 vs 0.07/样本 4.75–21.0 全达标且 4.40:1 已由 BLOCK-422 提至 4.81 未复现）、H-07 verified、H-06/H-08/E-02 分批（H-06 三文件 verified+desktop.css pending 在册+8 文件 pending 补腿；E-02 11 verified/2 cancelled 终态维持+UI-695/UI-331 verified+留因+UI-200 等维持）、E-01/E-03 保持 pending_human_eye 零代填。**核对抓真：e-class 指南分层陈旧**——UI-695/200/331 台账已 2026-11-16 verified（UI-200 为用户本人过目），本批零改写。**closeout 契约按设计 fail-closed throw**（不变量编码签署前世界+乙1–乙4 未提交台账写回使解析断链、消费测试 2 红为工作树在制面非 HEAD 红），契约演进立候选。证据=acceptance/block503-outputs/yi-rest/（签名档=route §3+signature-record.md）。Jev doc:suggest 已跑（planDoc 建议在案）。零 CSS/组件/token 写面/零新依赖。G0 开发期常态 · 不外推 packaged/Provider/GA.）\n`;
  insertTop(TOP, '最后更新行');
  const anchor = '| 状态 | 日期 | 事项 | 处置边界 |\n';
  const ROWS = `| ✅ | 2026-11-20 | **YI-REST-WB 乙组剩余回写批（用户批量口令「按 Agent 建议 2026-11-20 批量签」）**：乙5 八态矩阵 12 格 verified（input:hover/navItem:active 两格留因）、乙6 P5 两槽 verified/P6 两槽 verified+留因、H-01~H-05/H-07 verified（H-02/H-03/H-05 留因）、H-06/H-08/E-02 分批（H-06 三文件 verified+desktop.css pending 在册+8 文件 pending 补腿；E-02 11 verified/2 cancelled 终态维持+UI-695/UI-331 verified+留因+UI-200 等维持）、E-01/E-03 保持 pending_human_eye 零代填；签名档=docs/ui-design-human-eye-route.md §3+signature-record.md，证据=acceptance/block503-outputs/yi-rest/；**核对抓真：e-class 指南分层陈旧**（UI-695/200/331 台账已 2026-11-16 verified，本批零改写）；closeout 契约重算按设计 throw（不变量编码签署前世界），演进立候选 | 证据=acceptance/block503-outputs/yi-rest/ | BLOCK-503 乙5-乙8 / SIGNED-PARTIAL |\n| 🗃 | 2026-11-20 | **三个 UI 观察点候选 + closeout 契约演进候选（YI-REST-WB 抓真，均不立包不实现）**：①compose chart 节点以结构化 JSON 形态渲染（乙6 读数，需核实是否数据形态问题）；②左栏 QuickActions 无 aria-current（乙5 读数，isActive 恒 false）；③文本钮 hover 0.06 vs 其余 0.07（1pp polish）；④human-eye-closeout 契约演进：signatureSlots/uiLedgerSlots/batchNewUiFaces/humanEyeSlots 四不变量编码「全空/全未签」世界，部分签署后重算 fail-closed throw（乙1–乙4 未提交台账写回亦使解析断链、消费测试 2 红为工作树在制面非 HEAD 红），P5/P6 槽嵌于 BLOCK-474/475 冻结快照——演进需独立小票 | 契约证据=acceptance/block503-outputs/yi-rest/closeout-regen-attempt.txt | OBSERVATIONS / CANDIDATES |\n`;
  if (!out.includes(anchor)) throw new Error('AUDIT-LOG 表头锚点缺失');
  out = out.replace(anchor, anchor + ROWS);
  applied += 1;
} else {
  throw new Error(`未知文件: ${file}`);
}

const blob = execSync(`git hash-object -w --stdin`, { input: out, encoding: 'utf8' }).trim();
execSync(`git update-index --cacheinfo 100644,${blob},${JSON.stringify(file)}`);
console.log(`${file}: staged ${applied} 处插入（HEAD+本批，未裹携他方行）`);
