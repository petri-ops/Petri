# B1 z-index 六档语义 token 替换 · 证据（2026-11-25）

> Petri harness 隐形体验优化队列 3（材料 §3 序 3）。独立分支 `petri-ops/b1-zindex`，提交留本地、未 push。
> G0 开发期常态 · 不外推 packaged / Provider / GA。owner dev 实例零触碰；主线工作树未跟踪 WIP（含材料文档）零触碰；A1 / B4B5 分支零交叉。

## §1 问题核真

- 审计口径（2026-10-10）：20+ 处裸 `z-index:N`，无语义 token，数值与语义倒挂——Lightbox(100000) > 登录/顶栏(10000) > 分支标签/标题栏菜单(10001) > Toast(9999) > 全屏遮罩(9998)。后果：Toast 在最需要时被标题栏悬浮层压住、又位于登录弹窗之下。
- 2026-11-25 现读：`frontend/src` 全源裸值 **104 处** = CSS **94**（与材料 §1 B1 计数一致）+ TS/TSX 内联 `style={{ zIndex: N }}` **10**（材料计数未单列，本次纳入全量治理）。38 个生产文件。
- 逐个读上下文按语义角色分类：base（rcails / 画布内局部层 / resize 把手）/ sticky（滚动条轨道 / 悬浮工具条 / 内嵌终端）/ dropdown（菜单、popover、透明点击捕获层）/ overlay（变暗遮罩、弹层 backdrop）/ modal（面板、侧栏、确认卡）/ chrome（标题栏列头）/ lightbox（全屏预览）/ toast（顶层通知）。
- **唯一例外（不替换，有据）**：`src/main/gen-ui/guest-bridge.js:310` 的 `z-index:2147483647` 是 Electron guest webContents 内注入的**致命错误横幅**，guest 文档没有 Petri `:root` token 定义，`var(--petri-z-*)` 会解析失败导致横幅不可见；该值是故障兜底上限而非层级军备竞赛，不在 94 处口径内。

## §2 token 层级表

复用主题系统既有的 `--petri-z-*` 单源，**不另立并行 `--z-*` 家族**。任务要求的六档为既有档位的子集，扩展档 `raised / chrome / lightbox` 按需保留。

| 档 | token | 值 | 语义 | 关键消费者 |
|---|---|---:|---|---|
| 1 | `--petri-z-base` | 10 | 布局底座 / 组件内局部层 | 左右下 rail、编辑器局部层、关闭钮、滚动条内容层 |
| 2 | `--petri-z-raised` | 100 | 同层内抬升 | MessageRail 卡片、知识坞 surface、摘要悬浮卡、编辑器 revision 面板 |
| 3 | `--petri-z-sticky` | 500 | 固定/悬浮工具条 | ChatScrollbar 轨道、选择工具条、ToolActivityDock、内嵌终端 |
| 4 | `--petri-z-dropdown` | 1000 | 菜单 / popover / 透明点击捕获层 | 标题栏工具菜单、队列菜单、文件树菜单层、主题菜单、欢迎页 picker |
| 5 | `--petri-z-overlay` | 4000 | 变暗遮罩 / 弹层 backdrop | 命令面板、设置/文件树遮罩、确认弹层、抽屉、移动侧栏遮罩 |
| 6 | `--petri-z-modal` | 6000 | 弹窗内容与侧栏面板 | 移动导航面板、设置侧栏、文件树对话框、登录/深链确认 |
| 7 | **`--petri-z-chrome`（新增）** | **7000** | 窗口 chrome（标题栏 / 列头） | ColumnizedTitleBar `.columnHeader` |
| 8 | `--petri-z-lightbox` | 8000 | 全屏预览 / 必须压过标题栏的顶层内容 | Lightbox、ChatArtifactCard 图片放大、预览遮罩、批注列表、接缝命中带 |
| 9 | `--petri-z-toast` | 10000 | 顶层通知（最高） | CrashNoticeBanner、同步失败提示、workspaceNotice |

**为何新增 chrome 档（按任务要求留证）**：`ColumnizedTitleBar.module.css` 既有行为是「顶栏在模态之上可见」（原 9999 > settingsOverlay 998），直接降级到 overlay/dropdown 会造成顶栏被弹窗盖住的行为回归；直接升到 lightbox 又会与原 top 层同级。取 7000 使 `modal(6000) < chrome(7000) < lightbox(8000) < toast(10000)`：既保持顶栏常驻可见，又使 Toast 成为唯一最高档。`project-workspace.module.css` 接缝命中带需严格高于列头，故走 lightbox(8000)；其在模态打开时由既有 `body:has([data-petri-layer='modal']) .resizeHandleV { visibility: hidden }` 让位，不依赖 z 值低于 modal。

双主题兼容：z 档位是主题无关功能 token，只在 `styles/custom.css` 的 `:root` 定义一次（共 9 处），暗色块不重复定义，避免明暗漂移；`reduced-motion` 兜底块未改动。

## §3 改动清单与逐处语义映射

记号：`B`=base `R`=raised `S`=sticky `D`=dropdown `O`=overlay `M`=modal `C`=chrome `L`=lightbox `T`=toast；`行:档` 为当前文件行号。

| 文件 | 处数 | 映射 |
|---|---:|---|
| `frontend/src/App.tsx` | 2 | 180:O, 184:M |
| `frontend/src/components/annotations/AnnotationBar.module.css` | 1 | 231:L |
| `frontend/src/components/annotations/AnnotationOverlay.module.css` | 2 | 6:B, 295:B |
| `frontend/src/components/copilot/ChatArtifactCard.tsx` | 1 | 310:L |
| `frontend/src/components/copilot/ChatScrollbar.module.css` | 1 | 10:S |
| `frontend/src/components/copilot/ContextBudgetBar.tsx` | 1 | 176:D |
| `frontend/src/components/copilot/MessageRail.module.css` | 2 | 8:R, 55:S |
| `frontend/src/components/copilot/SimpleChat/PromptEnhanceDialog.module.css` | 1 | 4:O |
| `frontend/src/components/copilot/SimpleChat/ScheduleDialog.module.css` | 1 | 4:O |
| `frontend/src/components/copilot/ToolActivityDock.module.css` | 1 | 7:S |
| `frontend/src/components/copilot/simple-chat.css` | 17 | 121:D, 128:D, 155:D, 2075:B, 2273:D, 2280:D, 2492:D, 2503:D, 2845:D, 3317:B, 3353:S, 3392:O, 3982:L, 4141:B, 4249:D, 4526:B, 5400:O |
| `frontend/src/components/desktop/CrashNoticeBanner.tsx` | 1 | 90:T |
| `frontend/src/components/desktop/InstallDeepLinkDialog.tsx` | 1 | 164:O |
| `frontend/src/components/desktop/PluginStorePanel.tsx` | 1 | 400:O |
| `frontend/src/components/desktop/TitleBar.module.css` | 3 | 465:D, 475:D, 496:D |
| `frontend/src/components/desktop/WorkingTreeReview/CodeReviewDrawer.module.css` | 1 | 12:O |
| `frontend/src/components/desktop/WorkingTreeReview/ReviewMode.css` | 5 | 97:D, 341:B, 407:B, 868:D, 875:D |
| `frontend/src/components/desktop/desktop.css` | 3 | 169:B, 2134:B, 2152:B |
| `frontend/src/components/desktop/theme-control.css` | 1 | 37:D |
| `frontend/src/components/desktop/titlebar/ColumnizedTitleBar.module.css` | 1 | 24:C |
| `frontend/src/components/desktop/titlebar/TitleBarRightZone.tsx` | 1 | 230:D |
| `frontend/src/components/knowledge/KnowledgeConsoleDock.module.css` | 2 | 50:R, 76:B |
| `frontend/src/components/result-studio/CompactResultNavigator.module.css` | 2 | 4:B, 111:D |
| `frontend/src/components/result-studio/ContinueAnalysisMenu.module.css` | 1 | 35:D |
| `frontend/src/components/result-studio/RevisionCodeView.module.css` | 1 | 7:D |
| `frontend/src/components/shell/QuitSummaryDialog.module.css` | 1 | 5:O |
| `frontend/src/components/svg-editor/SvgEditorViewer.module.css` | 16 | 242:B, 716:B, 739:B, 763:B, 944:B, 980:B, 1081:B, 1087:B, 1609:R, 1638:R, 1677:R, 1822:B, 1868:B, 1879:B, 1913:B, 1947:B |
| `frontend/src/components/ui/Lightbox.css` | 1 | 6:L |
| `frontend/src/components/workspace-panels/FloatCardResizer.module.css` | 1 | 12:B |
| `frontend/src/pages/project-workspace.module.css` | 26 | 40:O, 400:D, 412:D, 1429:B, 1443:B, 1457:B, 1574:R, 2889:O, 2902:M, 3273:S, 3304:B, 3629:B, 3890:B, 3929:L, 3990:O, 4003:M, 5823:D, 5865:O, 6130:B, 6601:B, 6627:B, 7095:T, 7226:D, 7235:M, 7319:B, 7346:D |
| `frontend/src/pages/welcome.module.css` | 2 | 177:D, 190:D |
| `frontend/src/pages/window/CommandCenterJobsWall.tsx` | 1 | 511:B |
| `frontend/src/pages/window/SideChatWindowPage.module.css` | 1 | 32:B |
| `frontend/src/themes/ThemeProvider.tsx` | 1 | 397:T |
| **合计** | **104** | 34 个生产文件 |

配套改动：`frontend/src/styles/custom.css`（新增 chrome 档）、`frontend/src/styles/theme-token-contract.test.ts`（档位清单 + 顺序守卫 + 裸 z 棘轮归零）、`test/harness-b1-zindex-contract.test.mjs`（新增 HK-01 契约）、`acceptance/block-92/size-baseline.json`（7 个入册文件的 token 化字节增长按 `--allow-grow` 同款格式逐条留因登记；`PluginStorePanel.tsx` 仅重打 sha）、`docs/ui-productization-audit.md`（UI-728 in_progress）。

成对层保持相对顺序：透明点击捕获层与菜单同走 dropdown（DOM 顺序决定覆盖），变暗 backdrop 走 overlay、其内容走 modal；`switcherOverlay/switcherDropdown`、`settingsOverlay/settingsSider`、`sidebarMobileOverlay/sidebarMobileCard`、`pickerOverlay/projectPanel`、`sc-model-overlay/sc-model-menu`、`rvw-menu-backdrop/rvw-overflow-menu` 均按此判据。

## §4 HK-01 红绿先行

`test/harness-b1-zindex-contract.test.mjs`，6 条 Node 静态契约（零新依赖，`node:test`）：

1. 九档 token 定义完整、严格递增、相邻档留 ≥10 扩展空间；
2. Toast > chrome / modal / lightbox / overlay，chrome > modal（顶栏常驻不回退），并静态核验三处顶层通知走 toast、列头走 chrome、标题栏菜单不裸写且未占用 toast；
3. 全源零裸 `z-index:N` / `zIndex:N`，token 引用 ≥104（与 BLOCK-413 同计数口径，var() 不误伤）；
4. z 档位只在 `:root` 定义 9 处、暗色块不另立，`reduced-motion` 兜底在场；
5. `package.json` 四类依赖清单与 HEAD 逐键一致（零新依赖）；
6. 合成红自证（裸值命中、token 形态不命中）。

- **红（实现前）**：6 tests / 2 pass / 4 fail，原始输出 `hk01-b1-red.txt`。
- **绿（实现后）**：6 tests / 6 pass / 0 fail，原始输出 `hk01-b1-green.txt`。

## §5 门禁结果

| 门禁 | 结果 | 说明 |
|---|---|---|
| `node --test test/harness-b1-zindex-contract.test.mjs` | **PASS 6/6** | HK-01 绿 |
| `npm run ui:audit:check` | **PASS** | UI-728 已登记 in_progress |
| `npm run gate:ui-visual` | **PASS** | 108 CSS 文件；`Z_TIER_FROZEN` 原冻结 3 处已随本次发令全量迁移，预算残留为 0 |
| `npm run gate:code-size` | 仅剩**预存红** | `WorkspaceFilePreview.tsx` 731 > 基线 727 + sha 漂移，HEAD 即如此、本包零触碰；本包 8 个入册文件已按 `--allow-grow` 同款格式逐条留因重打 |
| `theme-token-contract`（vitest） | **未能执行（环境阻塞）** | 本机无 `frontend/node_modules`，与 A1/B4B5 同口径；档位顺序与裸 z 归零已由上述 Node 契约 + `test/block413-post-k7-l6-followup.test.mjs` 同口径 static 复核 |
| `npm run test:changed:list` | **预存阻塞** | `test/impact-map.json` 的 `closed-batch-evidence-dirs` 引用不存在的 `test/c56-user-manuscript-fidelity.test.mjs`，HEAD 即如此 |
| 零新依赖 | **PASS** | 契约 5 对 HEAD `package.json` 逐键比对；未安装任何包 |
| 裸 z 残留 | **0** | `grep -rInE 'z-index\s*:\s*[0-9]\|zIndex\s*:\s*[0-9]' frontend/src` 零命中（仅 `src/main/gen-ui/guest-bridge.js` guest 故障兜底例外，见 §1） |

根 `npm run check` / 全量 `test:all:workspace` 按纪律不跑，未验证范围如实说明。

## §6 观感零代签与纪律边界

- 本改动涉及**视觉层级**，所有 `human_eye` / `pending_human_eye` 项一律 **不代签、不翻 verified**。UI-728 仅登记 `in_progress`；静态契约绿 ≠ 实机观感通过。待主人过目项：①标题栏/列头与模态/Toast 三层在实机的视觉遮挡关系；②SVG 编辑器局部层合并到 base/raised 后同层 DOM 顺序的呈现；③各 backdrop/content 成对层的相对覆盖。
- 未碰 owner dev 实例（全程只跑文件级测试与静态门禁，未启 dev 栈）；主线工作树未跟踪 WIP 零触碰（材料文档只读）；A1（`petri-ops/codex-a1-silent-error`）与 B4B5（`petri-ops/b4-focus`）分支零交叉；提交留本地、未 push。
