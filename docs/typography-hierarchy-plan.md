# TYPOGRAPHY-HIERARCHY — 字号层次系统性统一（代码表面 13px 基准 + Infima 接管 + 脏值收口） Plan

- **Plan ID**: `TYPOGRAPHY-HIERARCHY`（用户反馈驱动，2026-08-31：「编辑区或者diff区域文字的大小层次不齐的 不协调呀…要整体协调」）
- **状态**: `active`（P0 登记）
- **truthDomain**: `typography-hierarchy`
- **阶段**: P0 登记 → P1 CodeMirror 13px 基准（UI-239）→ P2 `code`/`pre` 接管 + 代码块统一（UI-240）→ P3 低于阶梯硬编码收口（UI-241）→ P4 实机 fixture 验收 + 收口
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 诊断（2026-08-31 实测 + 源码审计）

browser-use 连 localhost:3000 实测 computed style + 全仓 CSS 审计，同屏字号从 7px 到 16px 共 9 档混排。三条机制性根因：

1. **CodeMirror 全链无字号声明**：`CodeMirrorEditor.module.css` 的 `.cm-scroller` 只声明 font-family；`.wt-cm-diff` → `.rvw-*` 容器一路到 body（16px）均无 font-size；CM6 baseTheme 无默认字号（dist 验证）。→ 审阅 diff 代码/提交全文（UI-224）渲染 16px，同屏 chrome（标题 13 / 统计 12 / tab 12）差 3~4px。
2. **Infima `code`/`pre` 的 88% 规则未被桌面覆盖**：`custom.css --ifm-code-font-size: 88%` + Infima 裸元素规则（`code{font-size:var(--ifm-code-font-size)}`、`pre{font:88%/1.45 mono}`）；`global.css` 只接管了背景/边框。→ HighlightedCode/预览代码块 = 容器 × 0.88（13→11.4、16→14.1），各容器基准不同，「小一号」互不一致。
3. **低于阶梯的硬编码脏值**：token 阶梯最小 xs(10px)，但文件树文件大小 9px（`_fileTreeSize`）、图标徽标 7~8px（`WorkspaceFileIcon.module.css`）硬编码。

实测全景：body 16 / 聊天正文 13 / 聊天 meta 11 / 文件树文件名 13 / 文件大小 9 / 徽标 7~8 / markdown 预览正文 13 / 预览行内 code 12 / 代码块 11.4 / 审阅 chrome 12~13 / diff 正文 16（继承）。

## 2. 方案

### P1（UI-239）CodeMirror 全场景 13px 基准

`CodeMirrorEditor.module.css` `.cmEditor :global(.cm-scroller)` 增加 `font-size: var(--biof3-font-size-body-sm)`——一处声明覆盖审阅 diff、提交全文、blame、未来编辑区所有 CM 挂载；行号 gutter 同步继承 13px。基准对齐聊天正文/文件树/markdown 预览（13px）。

### P2（UI-240）`code`/`pre` 接管 + 代码块统一 13px

`global.css` 桌面基线覆盖区（裸元素 `code`/`pre` 规则处）扩权：

- bare `code`：接管 `font-size: var(--biof3-font-size-caption)`（行内代码 12px）+ `font-family: var(--biof3-font-mono)`；
- bare `pre`：接管 `font: var(--biof3-font-size-body-sm)/1.5 var(--biof3-font-mono)`（代码块 13px）；
- `pre code` 维持 100%/inherit。

废 88% 漂移。同步 `.cp-md .cp-code-pre` caption→body-sm（聊天内两套代码块 12/13 对齐为一档）。显式规则（`.sc-msg-body pre/code` 13、`.workspaceMarkdownPreview code` 行内 12）specificity 更高不受影响；docs 页在 iframe 文档内不受影响。

### P3（UI-241）低于阶梯硬编码收口

`project-workspace.module.css` `_fileTreeSize` 9px→`var(--biof3-font-size-xs)`；`WorkspaceFileIcon.module.css` 7px/8px→xs（徽标字符可能溢出小图标，实机核对，必要时同步图标盒尺寸）；grep 兜底代码表面 7~9px 清零。

### P4 实机 fixture 验收 + 收口

disposable fixture repo（/tmp）+ 新建项目指向（UI-127 consent 先例，UI 点击授权）：造脏文件 → 审阅 diff 断言 `.cm-line`/gutter 13px、CommitDiffFileView 全文 13px；.py HighlightedCode 13px mono；markdown 预览正文 13/行内 code 12；聊天代码块 13；文件树 13/10。截图 `acceptance/ui-239/`~`acceptance/ui-241/`；每 UI 增量同提交更新 `docs/ui-productization-audit.md`；验收后项目入回收站 + fixture 清理 0 残留。

## 3. 范围外

- 字体族漂移（-apple-system 与 system-ui/Arial 并存）——登记为观察项，后续小包
- 暗色主题字号（消费同一 token，不单独调）；行高/间距/字重；token 阶梯值本身
- CodeMirror 编辑区业务挂载（UI-193/194 遗留，独立候选）
- git 写操作（分支切换/暂存区/push-pull，维持排除）

## 4. 门禁

tsc 0 / 定向 vitest（theme-token 契约 + 受影响组件测试）/ docs:check / ui:audit:check；P4 收口加 docs:reconcile；台账每增量同提交同步。

G0 开发期常态 · 不外推 packaged/Provider/GA.
