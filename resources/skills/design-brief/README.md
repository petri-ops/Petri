# design-brief — 设计说明生成器

让 Petri 把“帮我设计/优化界面”转成可审阅、可验证的结构化设计说明，而不是直接堆样式或复制参考站。

## 触发场景

- 生成 `DESIGN.md` 或产品设计说明；
- 根据截图/网站/文字参考提炼设计原则；
- 梳理某模块的八态矩阵、信息层级、键盘与响应式契约；
- 在设计说明之后追加 Gen UI 交互原型。

## 产物

默认输出 Markdown 设计说明；用户明确要求原型时，再复用内置 `visualize` Skill 的 Gen UI fragment 规则。本 Skill 不直接改产品代码、不新增依赖、不宣称视觉已验收。

## 设计上下文真源（v1.1）

产出设计说明前，先读取 `resources/design-context/` 的模型可读契约，按下列顺序消费；它们由静态扫描器从 canonical 真源机械派生，不臆造、不覆盖 design-charter 冻结项：

1. `design-context.json` — 字体档位、颜色预算、border 语义、motion token 的现读基线（P1 上下文包）。
2. `ia-map.json` — 主窗/窗口面路由、重定向与高频路径；用于「信息层级」节的入口与路径可达性判断（P2 IA 映射）。
3. `visual-consistency.json` — 海军蓝暗色阶梯、广谱 slate ratchet、颜色预算现读；用于「Token 与组件映射」节（P3 视觉一致性）。
4. `responsive-a11y.json` — 键盘焦点、焦点隔离、ARIA 状态机、WCAG 对比度、断点与触摸目标；用于「交互与键盘」「布局与响应式契约」节（P4 响应式与可访问性）。
5. `performance-trust.json` — 流式投影可信态、memo 渲染边界、SSE 续传、加载/空/错误状态机、首屏占位；用于「模块状态矩阵」的加载/空/错误态与可信态描述（P5 性能与可信状态）。

清单与 sha256 见 `resources/design-context/manifest.json`；读数由 `node scripts/c53-<阶段>.mjs --check` 可复算。任何真源缺席或漂移即 fail-closed，不以记忆或截图代替。

IA 消费要点：路由、重定向、高频路径三者在 `ia-map.json` 中可复算，设计说明涉及入口/导航时引用其 path/surface，不新造路由。a11y 消费要点：键盘顺序、焦点返回、ARIA 状态、对比度阈值、触摸目标与断点均取 `responsive-a11y.json` 现读，视觉美观仍属 `pending_human_eye`。

## 治理

完整手册见 `prompts/system.md`。设计说明必须区分：设计参考中观察到的内容、可借鉴的原则、Petri 自有 token/组件映射、需要用户裁决的 U 项、以及待人眼确认的观感项。
