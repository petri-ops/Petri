---
capability: ui-design-acceptance-checklist-v1
status: active
goal: UI 设计专项 D0–D5 共用的唯一验收尺子（八态矩阵 / 几何四块 / 长内容三态 / 断点表 / 评分卡口径 / 五类证据）。
acceptance:
  - 每一判据可机械复算或有显式人测路线；静态分不等于实机观感分
  - D5 用本清单同套口径出 Before/After 复评表
  - 不新增依赖、不改默认语义
---

# UI 验收清单 v1（canonical 尺子 · 2026-11-11）

> **地位**：本清单是「界面设计优化程序 UI-D0 → UI-D5」唯一验收尺子。冻结于 UI-D0（BLOCK-415），D1–D5 只增补判据实现方式，不改口径；任何口径变更必须先改本文件并同步 `scripts/ui-design-baseline.mjs` 与 `acceptance/ui-design-assessment-2026-11-11/baseline.json`。
> **对账基线**：`acceptance/ui-design-assessment-2026-11-11/baseline.json`（`schema=petri.ui-design.baseline.v1`）。机械门 `npm run gate:ui-baseline` 逐字段核对本清单所引的 §1 读数。
> **证据等级**：清单中所有分数均为**静态评估分**；观感分只能由人测签字产生，Agent 不代答、不写 `verified`。
> G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 八态矩阵（交互状态完备性）

八个状态 × 四类可交互元件。每格判据 = 「有可断言的行为/视觉呈现」+「有机械或实机证据位」；空格必须在 D4 补齐或显式 `cancelled` 留因。

| 状态 | 按钮 / 图标钮 | 输入 / 编辑器 | 列表项 / 卡片 | 导航项 / tab |
| --- | --- | --- | --- | --- |
| `default` | 可见文本或 aria-label；token 底色 | 占位符 + label | 可聚焦、角色正确 | 当前项可辨识 |
| `hover` | **单一** `--petri-hover` 档（D3 收敛） | 边框强调 | 提亮不跳布局 | 提亮不跳布局 |
| `active` / pressed | `aria-pressed` 或 data-state | 聚焦环 | 按下态 | `aria-current` |
| `disabled` | 真 `disabled` + 禁用原因单源 | 只读态 | 不进 tab 序 | 不进 tab 序 |
| `loading` | 进度可见 + `aria-busy` | 骨架/占位 | 骨架行 | 不阻塞导航 |
| `empty` | 空态文案 + 引导动作 | 空输入提示 | 空列表文案 | 空分组不渲染 |
| `error` | `role=alert` / `role=status` + 原因码 | 字段级错误 | 错误态可见 | 失败原因可见 |
| `focus-visible` | 键盘可见焦点（非 `outline:none` 裸删） | 同上 | 同上 | 同上 |

- **机械判据**：D4 的静态门枚举可交互元件选择器与八态规则，逐格产出覆盖表；D5 植入「删掉某态规则」必红负测。
- **禁止**：以 `:hover` 内联注入截图冒充全态覆盖；以「组件库默认有」代替实际选择器核对。

## 2. 几何四块（布局结构验收）

任何容器级 CSS 改动后必须取 `getBoundingClientRect()` 的 `{x,y,w,h}` 并逐条断言：

| # | 判据 | 公式 | 证据 |
| --- | --- | --- | --- |
| G1 | 无重叠 | 对同排块 A/B：`A.right ≤ B.left` 或 `B.right ≤ A.left`；对同列块：`A.bottom ≤ B.top` 或反之 | CDP/DOM 实机读数 |
| G2 | 同行同宽 | 同排块 `y` 相等（容差 ≤1px）、`w` 按设计比例恒定 | 同上 |
| G3 | 不溢出父容器 | 子块 `right ≤ parent.right + 1` 且 `bottom ≤ parent.bottom + 1` | 同上 |
| G4 | 祖先右缘 ≤ 可视列 | 从目标元素向上逐层检查祖先 `right ≤ 可视列.right`；**禁止**用组件子树内部容器当 host | 同上 |

- 配套：`min-width: 0` 贯穿 flex/grid 祖先链；高度链路 = 父 `min-height:0` → 卡 `display:flex;flex-direction:column;min-height:0` → 列表 `flex:1;min-height:0;overflow:auto`。
- **DOM 几何断言 ≠ 视觉验收通过**；另需元素级裁剪截图过目（人眼 E 类），截图失败标 `screenshot_unavailable`。

## 3. 长内容三态

| 态 | 输入 | 预期 |
| --- | --- | --- |
| L1 完整容纳 | 短文本 / 单行 | 无裁切、无滚动条 |
| L2 框内滚动 | 超长单行（≥2000 字符）、多行、大文件名、宽表格 | 容器内滚动；**滚动条可见**（覆盖式滚动条环境需显式 `::-webkit-scrollbar` token 化）；不允许看起来像截断 |
| L3 窄视口 | 视口 ≤900px + 上述长内容 | 不越出宿主列、祖先右缘 ≤ 可视列（G4）、无横向页面滚动 |

## 4. 断点表与单源

**现状 17 档**（`baseline.json` §1.2）：520 / 560 / 577 / 640 / 680 / 700 / 720 / 760 / 768 / 820 / 860 / 960 / 996 / 997 / 1120 / 1200 / 1380；另有 `@container` 10 条 / 8 文件与 `@media` 32 处 / 15 文件双判据并存；JS `767` 与 CSS `768` 差 1px（D2 对齐）。

- **目标**：≤4 档 + JS/CSS 常量单源（档位具体数值属 **U 类**，出决策材料、不擅自裁定）。
- **机械判据**：静态门从 CSS/TS 提取全部宽度阈值并与单源常量对账；植入一个未登记阈值必红；JS 与 CSS 阈值集合相等。
- **纪律**：`@media` 不支持 `var()`，单源只能是「TS 常量 + 机械对账」，不得伪造 CSS 变量方案。

## 5. 评分卡口径（0–5，静态评估分）

每维 = 该维可机械观测指标的归一化加权；**所有输入必须来自当次命令读数或 `baseline.json`**，不得凭印象给分。D5 用同套公式与同组命令复算 Before/After。

| 维 | 指标（口径） | 归一化 | 权重 |
| --- | --- | --- | --- |
| **A 布局与信息架构** | A1 每功能 canonical 路径数（=1 得满）、A2 孤儿页数（0 或显式 cancelled 得满）、A3 同一可视区布局定义处（=1 得满）、A4 断点档数（≤4 得满，按 `max(0, 5-(n-4))` 线性）、A5 JS/CSS 阈值对齐（相等得满） | 各 0–5 后算术平均 | 1.0 |
| **B 用户体验与交互** | B1 八态矩阵空格数（0 得满，每格 −0.2 下限 0）、B2 `focus-visible` 覆盖率（覆盖率×5）、B3 核心任务点击数（≤3 得满）、B4 命令面板可见入口（有=5）、B5 人眼签字率（**未签字恒 0**） | 平均 | 1.0 |
| **C 视觉一致性与设计感** | C1 hover token 数（=1 得满）、C2 selected 专用 token（有=5）、C3 跨文件重复 token 定义（0 得满）、C4 裸 z-index 单调下降率（相对基线 111 的下降比×5）、C5 `;;` 文件数（0 得满）、C6 fallback 快照与现值偏差（0 得满） | 平均 | 1.0 |
| **D 工程化标准与验收能力** | D1 token 契约通过数（19/19→5）、D2 新增判据负测覆盖率（100%→5）、D3 门禁 PASS/总数（比值×5）、D4 评分卡口径可复算项占比（100%→5） | 平均 | 1.0 |
| **综合** | `(A+B+C+D)/4`，保留 1 位小数 | — | — |

- **现状 Before**（`baseline.json.staticScores`，静态口径）：A=3.0 / B=3.5 / C=3.5 / D=4.5 / 综合≈3.6；`targetPerDimension=4.4` 为建议值（**U 类**，需用户裁决，不擅自当门槛）。
- **禁止**：把静态分写成实机观感分；把 `pending_human_eye` / `external-blocked` / `pending_user_ruling` 计入 B5 的通过数；回溯改历史分。

## 6. 五类证据定义（互不冒充）

| 类 | 定义 | 产出 | 不得冒充 |
| --- | --- | --- | --- |
| ① 行为/契约测试 | 单测 / 组件测 / 契约测，断言真实链路 | vitest / node --test 结果 | 不冒充实机 |
| ② 机械门禁 | 静态扫描 / 棘轮 / 对账门 | npm script EXIT + 摘要 | 不冒充 UI 在场 |
| ③ DOM/CDP 实机 | 9223 离屏实例 `getBoundingClientRect` / computedStyle / 截图 | evidence JSON + PNG | 不冒充人眼观感 |
| ④ 人眼观感 | 人按路线实测并签字 | 路线原文 + 签字记录（日期/覆盖断言） | Agent 不代答 |
| ⑤ 真实任务成功 | 有凭据、可出网、端到端真实任务 | 任务轨迹 + 产物 | 环境阻塞标 `external-blocked` |

- 未跑 / skipped / 复用 / 超时 / 在制 WIP 引起的红一律如实标注；`exit 124/125 = unknown`，不是成功；断言不可编造。
- 实机纪律：默认不开可见窗口；:3000 vite + :3001 后端无窗栈，UI 腿只在 9223 离屏实例，一律不设 `PETRI_TEST_ONSCREEN`，跑完立即 kill。

## 7. 验收结论词（终态封闭集）

`done` / `done-partial` / `retain-with-reason` / `pending_human_eye` / `external-blocked` / `pending_user_ruling`。**零 `in_progress` 悬挂**；`verified` 只在有对应实机或人眼证据时使用。
