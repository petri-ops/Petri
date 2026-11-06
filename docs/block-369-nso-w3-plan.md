---
capability: block-369-nso-w3-ux-trust
status: completed
goal: NSO-W3 体验可信化与可达性——把「看起来能用」推进到「任何状态下用户都知道发生了什么、能用什么、为什么不能用」。
acceptance:
  - F-09 viewer 分派：扩展名优先、kind 兜底；preview=false 与未命中返回可读 reason 上抛 Shell（决策表快照测试）
  - F-10 prefsSync 失败可见（ThemeProvider 内联告警+重试）；实验开关拉取失败可见（不静默空段）
  - F-18 a11y：非 chat 投影层 inert；项目树 role=tree/treeitem+aria-expanded；表单 fieldset/label；回滚结果 live region
  - 布局单源（CenterPanel 双层同名 layout 收敛）；字号硬编码收敛 token
  - 消息/会话/结果库 DOM 预算（零依赖 content-visibility 起步）
  - UI 台账 in_progress 终态化分诊（能 CDP 代行的补腿；人眼项如实留档）；每增量同批更新台账
  - 视觉证据按无人化阶梯（元素级截图/几何量测/长内容三态/窄窗口）；人眼项不冒 verified
reopen: 视觉人眼验收项按用户实机路线集中一次处理
---

# BLOCK-369 · NSO-W3 体验可信化与可达性

> 蓝图依据：§6（W3）。解锁：UI-696 已落地（348508f1）；P6 已复绿 13/13。

## 非范围

- 不新增依赖；不建第二 UI 真相；白名单外 plain CSS 不新增
- 并发写入者已收口，无在制面；用户资产不动

## 交付与收口（2026-11-06）

| 项 | 状态 | 证据 |
| --- | --- | --- |
| F-09 viewer 三段式分派 + 降级原因上抛 Shell | ✅ | 决策表 6/6 + registry 四套件 47/47（旧错分派期望有意翻转留理由）+ result-studio 263/263；UI-697 |
| F-10 prefsSync 告警条 + 实验开关失败可见 | ✅ | 3/3 + settings 14/14；UI-697 |
| F-18 inert/tree 语义/表单语义/live region | ✅ | a11y 4/4 + CenterPanel 21/21；UI-698 |
| 字号 token 首例（ResultsLibrary 徽标） | ✅ | theme-token-contract 17/17；其余 5 文件 → W3b |
| 布局单源（CenterPanel 双层 layout） | ⏸ W3b | 涉 CSS 重构与几何量测 |
| DOM 预算（消息/会话/结果库 content-visibility） | ⏸ W3b | 需 CDP 实测节点数定预算 |
| 52 条 in_progress 终态化 | ⏸ W3b | 分诊+CDP 代行/人眼集中一次 |
| 视觉验收四件套（实机） | ⏸ W3b | 无人化阶梯 CDP 腿未跑 |

- **completed（带例外）**：P1 失败可见性与可达性契约全部落地；test:changed 29/29 exit 0；tsc 0；theme 契约 17/17。
- **W3b reopen**：布局单源、字号收敛余量、DOM 预算、台账 52 条终态化、实机视觉/读屏走查（UI-697/698 待 verified）。
