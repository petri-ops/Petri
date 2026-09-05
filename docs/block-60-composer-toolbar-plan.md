# BLOCK-60 — Composer 工具栏优化：弹性保留 + 死控件收敛 + 容器查询自适应

> 状态：`completed`（2026-09-05 用户裁决启动 → 同日一次会话收口：实施+实机验证全绿，UI-291 verified）
> 立项日期：2026-09-05（用户裁决「新开一个 block」）
> truthDomain: `block-60-composer-toolbar`
> 来源：用户反馈聊天输入框底部工具栏「消息/控件堆在一起」→ 定位为 9 控件单行零分组拥挤 → 方案 B+（保留弹性宽度 + 死控件收敛 + 容器查询自适应 + 视觉分组）

## 1. 问题定位

**现象**：输入框底部 `sc-composer-bar`（[SimpleChat.tsx:1794](../frontend/src/components/copilot/SimpleChat.tsx)）将 9 个控件塞进同一 flex 行，仅 `gap: 8px` 统一间距、零视觉分组：

| 位置 | 控件                              | 性质   |
| -- | ------------------------------- | ---- |
| 左  | `+` 添加内容（**disabled**，标题「即将上线」） | 内容操作 |
| 左  | 刷新文件链接                          | 内容操作 |
| 左  | cpu 模型 I/O 信息流                  | 调试   |
| 左  | 完全访问（access mode）               | 权限   |
| 左  | 计划模式（plan mode）                 | 模式切换 |
| 左  | 执行目标（远程，如 `dell`）               | 算力   |
| 右  | 供应商（sensenova）                  | 模型   |
| 右  | 模型（sensenova-6.8-flash-lite）    | 模型   |
| 右  | 发送按钮                            | 主操作  |

**根因**：9 控件分属 6 种性质（内容/调试/权限/模式/算力/模型/主操作），视觉权重完全平等，用户无法快速扫描区分。拥挤在 composer 最窄（560px）时最严重。

**既有弹性效果（必须保留，用户明确喜欢）**：[SimpleChat.tsx:778](../frontend/src/components/copilot/SimpleChat.tsx) `composerWidth = Math.min(980, Math.max(560, 560 + Math.sqrt(inputLength) * 42))` 通过 `--sc-composer-width` CSS 变量驱动 composer 宽度；textarea 高度 `resizeTextarea` 从 52→220px 自适应。**本包一行不动这套弹性逻辑**。

## 2. 设计裁决

1. **弹性逻辑零改动**——`composerWidth` 计算、`--sc-composer-width` 变量、`resizeTextarea` 全部保留；工具栏只「读取」宽度决定显隐，不反向影响宽度
2. **移除死控件** **`+`** **按钮**——永久 disabled、零功能，直接从 DOM 移除（不进溢出菜单，进了也点不了）
3. **低频操作收进** **`⋯`** **工具菜单**——`刷新文件链接` + `模型 I/O 信息流` 合并进一个溢出菜单按钮（均为低频：缓存重建 / 调试）
4. **容器查询自适应（工具栏呼吸感）**——`.sc-composer` 加 `container-type: inline-size`；断点 `680px`：

   - `< 680px`（输入少，composer 窄）：计划模式 + 执行目标也收进 `⋯`，可见 = `完全访问 | 模型组 | ⋯ | 发送`

   - `≥ 680px`（输入多，composer 宽）：全部展开 = `完全访问 | 计划模式 | 执行目标 | 模型组 | ⋯ | 发送`
5. **视觉分组（轻量 CSS）**——模型组（供应商+模型）合并为分段控件视觉（已有 `sc-model-picker-pair` 容器，调 gap/border）；策略组（访问/计划/执行目标）之间加大 gap 区分
6. **0 新 npm 依赖**——纯 CSS 容器查询（Electron 22+ 原生支持）+ 既有组件复用

## 3. 改动清单

### TSX（SimpleChat.tsx）

- 移除 `+` 按钮（[L1796-1804](../frontend/src/components/copilot/SimpleChat.tsx)）

- 新增 `⋯` 溢出菜单按钮：点击弹出菜单，菜单项 = 刷新 / I/O 信息流 +（窄态时）计划模式 / 执行目标

- 计划模式按钮、执行目标 picker 加 `sc-toolbar-secondary` 类名（供容器查询控制显隐）

- 刷新、I/O 信息流按钮移入溢出菜单，不再常驻

### CSS（simple-chat.css）

- `.sc-composer { container-type: inline-size; }`

- `@container (max-width: 679px) { .sc-toolbar-secondary { display: none; } }`

- `.sc-model-picker-pair` 合并为分段控件视觉（gap→0 + 中间细分隔）

- 策略组 gap 微调

- 溢出菜单样式复用 `.sc-access-menu` / `.sc-model-menu` 既有弹窗风格

### 不改

- `composerWidth` / `--sc-composer-width` / `resizeTextarea`

- 发送按钮、模型选择器、access picker 的功能逻辑

- 任何后端 / IPC

## 4. 常态工具栏对比

| 状态             | 控件数 | 排列                                        |
| -------------- | --- | ----------------------------------------- |
| 改动前            | 9   | `+ 刷新 I/O 完全访问 计划模式 dell sensenova 模型 发送` |
| 改动后·窄态（<680px） | 5   | `完全访问 模型组 ⋯ 发送`                           |
| 改动后·宽态（≥680px） | 7   | `完全访问 计划模式 dell 模型组 ⋯ 发送`                 |

`⋯` 菜单内容：刷新文件链接 / 模型 I/O 信息流；窄态额外含 计划模式 / 执行目标。

## 5. 验收

- 实机：输入空时 composer 560px，工具栏 5 控件不挤；输入长文本 composer 扩到 980px，工具栏展开为 7 控件

- `⋯` 菜单：刷新 / I/O / 计划模式 / 执行目标 均可正常触发（窄态）

- 弹性效果：输入越多 composer 越宽越高，行为与改动前一致

- tsc 0；受影响 vitest（copilot 目录）；docs:check；ui:audit:check

## 6. 风险

| 风险                     | 对策                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| 容器查询在当前 Electron 版本不支持 | Electron 22+ / Chromium 108+ 原生支持 `container-type`；若实测不支持，降级为 JS 监听 `ResizeObserver` 切换 class（备选） |
| 移除 `+` 按钮后用户找不到「添加内容」  | 该按钮本就是 disabled「即将上线」，移除零功能损失；若后续上线内容添加，再按设计重新接入                                                  |
| 计划模式窄态收进菜单后用户找不到       | 菜单项明确标注，且计划模式激活时（planMode=true）**强制常驻显示**（不被容器查询隐藏）——已激活的模式必须可见                                   |

## 7. 治理边界

- 0 新 npm 依赖

- 不动后端 / IPC / 弹性宽度逻辑

- 不抢占 BLOCK-57 active 槽位；体量小（单阶段可收口），用户裁决后即可启动

- G0 开发期常态 · 不外推 packaged/Provider/GA

## 8. 进度记录

- 2026-09-05 planned 登记：用户反馈工具栏拥挤 → 定位 9 控件单行零分组 → 方案 B+（保留弹性 + 死控件收敛 + 容器查询自适应 + 视觉分组）→ 用户裁决「新开一个 block」。本计划落盘。

## 11. 进度记录

- 2026-09-05 用户裁决启动 → 同日实施收口：移除死控件 + / 新增 ⋯ 溢出菜单（刷新/I-O 常驻 + 窄态收纳计划模式与执行目标）/ 容器查询自适应（container-type + @container 679px，is-active 计划模式豁免）/ 策略组 gap 分组 / 模型组分段视觉沿用既有。弹性宽度逻辑零改动（空输入 560 ↔ 长文本 860 实测一致）。实机证据 `acceptance/block-60/ui-live.json` + 截图 ×3；UI-291 verified。G0 开发期常态 · 不外推 packaged/Provider/GA。

