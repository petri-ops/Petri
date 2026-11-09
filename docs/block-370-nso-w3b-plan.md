---
capability: block-370-nso-w3b-polish
status: completed
goal: NSO-W3b 可机械验证子集——字号 token 收敛与长列表 DOM 预算起步；其余 W3 余项（布局单源/台账 52 条终态化/实机视觉走查）因需实机几何量测与 CDP 腿，如实挂起不冒进。
acceptance:
  - fontSize:11 全仓收敛到 var(--petri-font-size-xs, 11px)（XTerm 数值 API 例豁免留痕；theme 契约 17/17 保持）
  - 结果库行与会话行 content-visibility:auto + contain-intrinsic-size（DOM 预算起步；组件回归全绿；css-modules 门 PASS）
  - UI-699 台账同批登记（in_progress）
reopen: 布局单源/台账 52 条终态化/实机视觉读屏走查需实机腿，另行发令
---

# BLOCK-370 · NSO-W3b 体验收尾（可机械验证子集）

## 交付与收口（2026-11-06）

| 项 | 状态 | 证据 |
| --- | --- | --- |
| 字号 token 收敛 12 处 5 文件（XTerm 数值 API 豁免留痕） | ✅ | theme 契约 17/17；组件回归全绿；tsc 0 |
| DOM 预算起步（结果库行/会话行 content-visibility） | ✅ | ResultsLibrary/LeftPanel 回归绿；css-modules 门 PASS |
| UI-699 台账同批登记（in_progress） | ✅ | ui:audit:check PASS（629 编号） |
| docs:coverage 守卫当场抓真 | ✅ | 本批新增文档致 managedMarkdown 漂移即红 → 重算写回 |
| 布局单源 / 台账 52 条终态化 / 实机视觉走查 | ⏸ 挂起 | 需实机几何量测与 CDP 腿，另行发令 |
| 门禁清偿（死表/mock Promise 语义/Shell 棘轮重打） | ✅ | 11c352b4；lint 0 error；298/298 |

**completed（带例外）**：W3b 可机械验证子集全部落地；实机腿与 CSS 重构项如实挂起。

