# FONT-FAMILY-UNIFICATION — 字体族统一（sans/mono 单栈化） Plan

- **Plan ID**: `FONT-FAMILY-UNIFICATION`（TYPOGRAPHY-HIERARCHY 观察项移交，用户 2026-08-31 裁决：「字体族漂移也修了吧」）
- **状态**: `completed`（2026-08-31 收口：P0 `c824f35` → P1 UI-242 `c4f921e` → 本 commit P2 实机 + 收口；dev Electron 实机 verified，证据 `acceptance/ui-242/`）
- **truthDomain**: `font-family-unification`
- **阶段**: P0 登记 → P1 实现（UI-242）→ P2 实机 + 收口
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 诊断（2026-08-31 实机全栈清点）

| 漂移源 | 现状 | 影响 |
| --- | --- | --- |
| Chrome UA 按钮默认字体 | 无显式 `font-family: inherit` 的 `<button>` 计算栈 = **Arial**（TitleBar 药丸/关闭/红绿灯、所有未接管按钮） | 最大漂移源，英文/数字字形与全局不一致 |
| Infima 元素 | `--ifm-font-family-base`（system-ui 打头、无 CJK）≠ body 栈（-apple-system 打头 + CJK） | Infima 类元素与正文微差 |
| `--biof3-font-sans` token | 缺 CJK 字体（PingFang SC / Hiragino Sans GB / Microsoft YaHei）；body 用自己的字面量栈（`BlinkMacSystemFont` 计算值序列化为 `"system-ui"`，非第二套声明） | token 与实际两套真相 |
| mono 栈动物园 | token 栈 + 聊天 `'SF Mono','Fira Code'`×9（simple-chat.css）+ custom.css `SFMono-Regular` 字面量×2 + desktop.css×1 + RevisionCodeView×1 + CM 幽灵变量 `--font-family-mono`（解析失败回退 generic monospace） | 等宽字形渲染不一 |

## 2. 方案（P1，UI-242，全部单杠杆）

1. **canonical sans**：`--biof3-font-sans` 补 CJK 对齐 body 实际栈；`--ifm-font-family-base` 覆写为同栈（Infima 元素一次收口）；global.css `html/body` 改消费 `var(--biof3-font-sans)`（废字面量）。
2. **表单控件继承**：global.css `button, input, select, textarea { font-family: inherit }`——杀掉 Chrome UA Arial。
3. **canonical mono**：全部字面量栈收口 `var(--biof3-font-mono)`——simple-chat.css ×9、custom.css:1214/1586、desktop.css:1187、RevisionCodeView `.technical dd` 与 `.code code`、CodeMirrorEditor.module.css `.cm-scroller`（幽灵 `--font-family-mono` → token）。
- **不动**：终端 xterm 字体（themes/terminal-themes 独立 deliberate surface）、docs iframe 内部、emoji 字族段。

## 3. 门禁与实机

tsc 0 / theme-token 契约 / docs:check / ui:audit:check；实机（dev Electron CDP）：全栈清点复测期望 sans 单栈 + mono 单栈、按钮计算栈不再 Arial；截图 `acceptance/ui-242/`；台账同提交同步。

## 4. 收口（2026-08-31）

- **实机**（CDP 9222，HMR 推送后复测）：全应用 sans 单栈（含原 UA Arial 的红绿灯按钮/会话选择器入栈）、mono 单栈（token）、**Arial 元素数 = 0**；唯一例外 `xterm-char-measure-element`（xterm 内部测量，deliberate 不动）。附带收口 `font:` 简写里的硬编码字号 ×4（11px→sm / 12px→caption / 13px→body-sm）。
- **门禁**：tsc 0 / theme-token 契约 PASS / docs:check 168 / ui:audit:check 264 编号。
- **字体契约现状**：sans = `--biof3-font-sans`（含 CJK），mono = `--biof3-font-mono`，表单控件 `font-family: inherit`；Infima `--ifm-font-family-base/monospace` 覆写指向同 token。新表面禁止字面量字体栈。

G0 开发期常态 · 不外推 packaged/Provider/GA.
