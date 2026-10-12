---
capability: ui-design-quality
goal: 设计默认值的唯一规范真值——档位、预算、语义词汇在此定死，门禁机械守护
acceptance:
  - theme-token-contract BLOCK-167 断言组全绿（三棘轮+存在性+红证据自检）
  - 与本文件冲突的实现即违规（契约棘轮守护）
reopen: 档位/预算调整须证据批+用户裁决；本文件是 BLOCK-167 收口后的长期 reference
status: reference
---

# Petri 设计宪章（Design Charter）

> 来源：BLOCK-167 三轮评估（Petri 全 CSS 量化 + ZCode app.asar 解包对照 + Codex style.rs 源码对照）。
> 立场：**学纪律机制，不抄皮肤**——保留科研工作台信息密度与海军蓝身份，修的是默认值与用法。

## 1. 字号（6 档终态，D1）

| token | 值 | 用途 | 纪律 |
| --- | --- | --- | --- |
| `--petri-font-size-2xl` | 28px | 页面 hero 标题 | 每页 ≤1 处 |
| `--petri-font-size-xl` | 20px | 页/区块标题 | |
| `--petri-font-size-lg` | 16px | 卡片标题/强调数值 | |
| `--petri-font-size-body` | 14px | **全局默认正文** | 不写 font-size 即继承它；占比终态 ≥50% |
| `--petri-font-size-sm` | 12px | 次级元信息/表格紧凑 | |
| `--petri-font-size-xs` | 11px | **仅徽标/角标计数** | 出徽标域即违规（棘轮豁免登记制） |

- 退役档：3xl（并 2xl）、md（并 lg）、body-sm（并 body）、caption（并 sm）、10px（非徽标归 sm、徽标留 xs）。
- 基准原则（ZCode 实证）：设计感来自「绝大多数元素不特殊」——正文性说明**优先 inherit**，显式小字号只给真元信息。

## 2. 色彩预算（D3）

- 中性 : 强调引用比终态 **≥10:1**（基线 2.3:1）；`var(--petri-accent)` 引用总量终态 ≤130（契约口径，基线 371）。
- accent 只许五类语义：**主按钮 / 激活选中态 / 链接 / 焦点环 / 状态语义（success/warning/danger 已有专 token）**。
- 图标、次级动作、装饰性元素默认中性（text-secondary/muted）；「彩色稀缺化」=强调色重新成为信号。
- 每视图可见强调点目标 ≤8 处（实机抽查项，非门禁）。

## 3. 线条三语义（D4）

| token | 语义 | 取值 |
| --- | --- | --- |
| `--petri-border-input` | 输入类可视边界 | `var(--petri-border-strong)` |
| `--petri-border-card` | 容器卡 Quiet 边 | `var(--petri-border-subtle)` |
| `--petri-divider` | 分隔线（最 Quiet） | `color-mix(border 55%, transparent)` |

- **无语义 1px 细线终态 = 0**：所有 `1px solid` 必须用上表之一（契约逐文件棘轮守护，基线 533）。
- 分隔优先序：留白 > 底色差 > divider；线是组合拳一味（配 rounded+底色差+影），不是默认分隔工具。

## 4. 动效（D6）

- duration 3 档：`--petri-duration-fast/base/slow` = 150/200/300ms（hover/press、展开切换、浮层）。
- ease 2 档：`--petri-ease-standard`（常规）/ `--petri-ease-emphasized`（进出场强调）。
- transition 声明引用 token，禁字面 ms 新增；`prefers-reduced-motion` 既有豁免保持。

## 5. 渲染细节基线

- `::selection` 全局唯一（global.css，accent 28% mix）——已在 W0 落地。
- 滚动条/focus ring 沿用既有 token 化成果；W3 只做一致性收尾。

## 6. 控件（W2 兑现）

- Button/Input/Select/Chip/Empty 五件套单源变体（`components/ui/controls/`）；新按钮类定义即红（grep 守卫）。
- 字重纪律：medium(500) 为主，semibold(600) 标题，bold(700) 仅页 hero；650/580 变体退役。

## 7. 门禁映射

全部量化承诺由 `frontend/src/styles/theme-token-contract.test.ts` BLOCK-167 断言组机械承载：
小字号棘轮（450→≤110→≤40）/ accent 棘轮（371→≤200→≤130）/ 无语义细线棘轮（533→≤285→0）/
motion+border token 存在性 / ::selection 唯一性 / 计数器合成违例自检（红证据）。
