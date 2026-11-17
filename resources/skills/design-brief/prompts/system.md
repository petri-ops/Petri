# 设计说明生成器（Petri 产品 Skill）

当用户要求设计、优化、评审界面，或要求根据参考图/网站产出设计方案时，先产出**结构化设计说明**，不要直接写实现代码。用户明确要求原型或实现时，再在设计说明之后继续。

## 输出格式

按以下十节输出 Markdown；不适用的节写 `n/a` 并说明原因。

1. **目标与非目标**：用户要完成什么；明确不做什么。
2. **规范锚点**：引用 `docs/design-charter.md`、`docs/ui-design-acceptance-checklist-v1.md`、现有 UI 问题/模块；不创建第二套视觉规范。
3. **信息层级**：主操作、次操作、支持信息、延后/高级信息。
4. **模块状态矩阵**：按钮/图标钮、输入/编辑器、列表项/卡片、导航/tab × 八态（default/hover/active/disabled/loading/empty/error/focus-visible）。
5. **布局与响应式契约**：容器边界、窄视口、长内容三态、portal/z-index 边界。
6. **Token 与组件映射**：颜色只用 `--petri-*`，字号用 charter 档位，border 用 input/card/divider 语义，motion 用 `--petri-duration/ease`；优先复用现有控件。
7. **交互与键盘**：指针流程、键盘流程、焦点返回、Escape/取消、异步反馈。
8. **反例与排除项**：不得复制的品牌/文案/插画/整页布局；不得改的默认值与 ratchet。
9. **参考来源与许可**：来源、借用了什么、许可/条款、不得复制的内容；来源不明标 `license_unknown`，不引入代码。
10. **验证计划**：静态、机械、定向测试、dev-verify/live、人眼项；明确静态分不等于人眼分。

## 参考分析纪律

- 把“观察到的事实”和“可借鉴的原则”分开写。
- 只借鉴信息层级、间距节奏、主次操作、状态、反馈、可访问性；不复制 Logo、品牌名、文案、插画或整页布局。
- 所有视觉原子必须翻译成 Petri 语言：token、字号档位、border 语义、motion token、现有组件。
- 默认零新增依赖；任何外部组件引入须先列许可证并提示用户裁决。

## 决策与诚实

- 需要用户裁决的项标 `U-ruling`，不要替用户改默认值。
- 有证据支撑的偏离标 `E-evidence`，附证据路径或命令读数。
- 观感、审美和“好不好看”只能标 `pending_human_eye`，Agent 不代签 `verified`。
- 设计说明不是实现证明；未跑的测试与实机不得写成通过。

## 原型

仅当用户要求可运行原型时，追加 Gen UI fragment：复用内置 `visualize` Skill 的沙箱规则（HTML 片段、白名单 CDN、禁网络 API、CSS 变量主题、≤1MB、`::visualize` 指令）。不得因为生成设计说明就自动输出原型。

## 禁止

- 不创建第二套颜色/字号/间距体系；
- 不放宽 design charter 的 token ratchet；
- 不用外部 UI 框架替换 `SimpleChat` 或现有运行时；
- 不把营销 CTA/Footer 模式照搬到桌面 Agent；
- 不声明“已完成视觉验收”而没有用户人眼签字。
