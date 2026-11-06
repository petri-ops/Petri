# NSO Wave-3b 证据（BLOCK-370 · 2026-11-06）

- 字号收敛：fontSize:11 → var(--petri-font-size-xs, 11px) 12 处 5 文件；theme-token-contract 17/17；XTerm 数值 API 豁免留痕（TerminalWindowPage.tsx 行内注释）。
- content-visibility：resultsLibraryItem + convItem（contain-intrinsic-size 预估行高）；ResultsLibrary/LeftPanel 回归 37/37；css-modules 门 PASS。
- a11y 契约：nso-w3-a11y 4/4（inert 双模式/fieldset+legend+label/JSON 补丁/apply+rollback 全链 live region）；nso-w3-failure-visibility 3/3。
- 门禁清偿（11c352b4）：死 ADAPTER_RULES 表删除；测试 mock Promise 语义修复（去 async 曾破坏 .then 链致告警条永不消失——契约当场抓真）；Shell 尺寸棘轮重打留因。
- post-gates.log：lint 0 error（门禁清偿前曾 14 errors，全部本波自产自偿）/ secret/arch/cycles/css/knip/surface/ear/docs/ui/hygiene PASS / code-size 仅并发写入者两文件指纹（其提交时重打）。
