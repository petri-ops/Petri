---
capability: block-369-nso-w3-ux-trust
status: active
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
