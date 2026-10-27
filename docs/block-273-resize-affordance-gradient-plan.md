---
capability: block-273-resize-affordance-gradient
goal: 拖拽边界悬停暗示统一为「细线 + 渐变高光」规范（Qoder 式），清除固定宽度实心条带；浮卡左缘常驻线收窄；清死把手样式。用户裁决（2026-10-27）原话：「qoder有个比较好的效果，鼠标放到拖拽的地方，那个地方会有渐变的渲染效果。……我觉得任何可以变化的窗口不应该被固定宽度的条带干扰影响美观」+「项目摘要和侧边聊天的窗口左侧也不要默认有这么宽 换成 一致的统一规范」（附截图）。
acceptance:
  - 全站可调宽边界悬停形态统一为「细亮线 + 上下渐隐 glow」（纯 CSS linear-gradient 首版）；默认态无全高实心条带。
  - FloatCardResizer 常驻指示线 3px→1~2px 收窄变淡，悬停走统一规范；可发现性不回退（不退回纯隐形热区——v25 用户抓真在案），约束写进注释与断言。
  - desktop.css 死样式 `.petri-desktop-workarea__resize-handle` 整块删除（全站无渲染点，2026-10-27 评审核实）。
  - 亮/暗双主题实机取证（9223 测试实例离屏，CDP hover 前后对比）落 acceptance/block-273/；组件级测试绿；theme-token-contract 门绿；UI 台账登记（实现批分配 UI-###）。
  - closeout 十三门 PASS；G0 开发期常态 · 不外推 packaged/Provider/GA。
reopen: 指针跟随渐晕（mousemove 驱动 CSS 变量，Qoder 完整形态）本轮不做，用户要再做；新增可调宽面须挂本规范。
status: completed
---

# BLOCK-273 · 拖拽边界统一渐变暗示规范（UI 打磨 · QODER-ESSENCE-ABSORPTION 切片）

> 归属：方向母纲 [`qoder-essence-absorption-plan.md`](./qoder-essence-absorption-plan.md)（对标吸收 · ui-ux）；
> §6.5 串行队列已清零（P4-REM 收口），本包为用户新增切片，来源=用户实测 Qoder 使用反馈（非 102 点矩阵行）。

## 1. 现状盘点（2026-10-27 评审实测）

| 边界 | 位置 | 现状 | 判定 |
| --- | --- | --- | --- |
| 文件树边界 `.workspaceFileTreeResize` | `frontend/src/pages/project-workspace.module.css`（~6079） | 4px 全高实心 accent-bg 带（hover） | ❌ 主要违和源 |
| 浮卡左缘把手 FloatCardResizer（项目摘要/侧边聊天共用） | `frontend/src/components/workspace-panels/FloatCardResizer.module.css` | 3px 常驻中性线（上下留 14px）+ hover 10px 命中区 16% tint + 线转 accent | ❌ 用户点名「默认不要这么宽」 |
| 主列边界 `.resizeHandleV`（BLOCK-62 精修） | 同 project-workspace.module.css（~3927） | 1px 细线 hover 变 2px accent，全高连续 | ✅ 参照形态，基本不动 |
| 引用面板分隔 artifactPinDivider / 内嵌终端上边界 embeddedTerminalResize | 各自 module.css | pill 抓握提示（34px 短线） | ✅ 克制，核对后标注规范归属 |
| 桌面面板把手 `.petri-desktop-workarea__resize-handle` | `frontend/src/components/desktop/desktop.css`（~195） | 6px 全高实心 accent-border 带；**全站无渲染点** | ⚠️ 死样式，删除 |

痛点根源：拖拽边界视觉规范从未统一——BLOCK-62 只精修了主列一处，其余保持早期原始写法。

## 2. 统一规范（本包交付的合同）

1. **默认态**：1px 中性细线（`--petri-border` 系半透明），无任何全高实心条带。
2. **悬停/拖拽态**：细线转 accent 色，邻侧附上下渐隐的柔和 glow（`linear-gradient(透明→accent→透明)` 窄带）；视觉重量集中在线上，不做整条填色。
3. **可发现性约束（不可回退）**：命中热区宽度不收窄（≥6px）；浮卡左缘保留常驻细线暗示——v25 之前「隐形热区不可发现」是用户抓真过的教训，本包只降视觉重量、不删暗示。
4. **主题纪律**：全部走 `--petri-*` token，禁零定义/禁字面量（`theme-token-contract.test.ts` 守护）；亮/暗两态都要在实机取证。

**立项自检（对标不改魂）**：形借 Qoder 的渐变暗示；自有形态优势=全站单一规范 + token 契约机械门 + 可发现性约束留痕；不做指针跟随、不做动画 flourish（无差别复刻不做），通用 agent 能力主线不受影响。

## 3. 改动面

| 文件 | 动作 |
| --- | --- |
| `frontend/src/pages/project-workspace.module.css` | `.workspaceFileTreeResize` 重构入统一规范（删 4px 实心 hover 带） |
| `frontend/src/components/workspace-panels/FloatCardResizer.module.css` | 常驻线 3px→1~2px 变淡；hover 渐变统一；v25 注释更新（保留教训原文） |
| `frontend/src/components/desktop/desktop.css` | 删 `.petri-desktop-workarea__resize-handle` 全块（含 dark 覆写） |
| `.resizeHandleV` / 两处 pill | 核对+注释标注规范归属（预期行为不动） |
| 组件级测试 | FloatCardResizer/文件树边界：默认无实心带、悬停类、常驻暗示存在性断言 |

## 4. 非范围（红线）

指针跟随渐晕（reopen）；窗口级/OS 级 resize；拖拽逻辑与热区宽度改动（纯视觉层）；新 pane 能力；G1+ 不涉及。

## 5. 断言面与阶段

- 阶段：P1 立项登记（本批）→ P2 组件测试先行 → P3 实现 → P4 实机亮/暗取证（9223 离屏，探针即完即 kill）→ P5 台账+closeout。预期一次会话收口。
- 验收门禁清单：①组件级测试绿（含可发现性约束断言）；②theme-token-contract 绿；③实机亮/暗 hover 前后取证落 `acceptance/block-273/`（新增 live 脚本随批登记 impact-map，patterns 用目录 glob——BLOCK-268 教训）；④UI-### 台账按实机证据定 verified/in_progress；⑤closeout 十三门 PASS。
- 依赖：dev 栈 = vite(:3000) + 后端(:3001) + 9223 测试实例（离屏，`PETRI_TEST_ONSCREEN` 禁设——live-window-policy 门）。
- 无 backlog 行（用户直接裁决立项，非队列项）；注册三件套=DOC-REGISTRY/README/AUDIT-LOG 随本批。

## 6. 收口记录（2026-10-27，P5-CLOSED）

- **代码面**：五处边界按 §2 规范落地（文件树把手重构 / FloatCardResizer 收窄+渐变 / 死样式删除 / 参照与 pill 标注归属）；顺手清偿 AnnotationOverlay 4 处死字面量 fallback（token 均有定义，化石删）。
- **门禁**：theme-token-contract **17/17**（accent 棘轮 93→95 留痕上调，宪章五类拖拽把手态，对标 BLOCK-178 ArtifactPinPane 先例）；FloatCardResizer 消费组件测试 **35/35**；routing unknown=[]（block273 规则登记，patterns 含 CSS 面与取证目录）。
- **实机（acceptance/block-273/）**：亮/暗双主题默认态实机断言全绿（bg=透明/glow=0/分隔线=divider + 源码接线 S1-S4）+ 诊断性观测一次（亮主题激活态 glow=1、分隔线=accent rgb(13,148,136)）。**环境边界如实记录**：隐藏页 getComputedStyle used 值缓存（自定义属性读新值、普通属性读旧值——悬停激活态读数不可靠）+ 离屏截图合成不可用（-32000）；`CSS.forcePseudoState` 本实例静默不生效（-32000/无效果双实测，沉淀进探针脚本头注）。
- **UI-588 = in_progress**（对标 BLOCK-270/UI-587 形态）：亮主题默认态+接线实机断言 done；暗主题悬停态+真实指针 hover 走查=30 秒人测路线随交付（无人化阶梯第 4 级：自动化够不着——隐藏页读取不可靠+离屏截图不可用；用户确认后翻 verified）。
- **评审抓真（实现过程自证）**：`--no_tests` 解析器与文档对齐、共享 cruise options 为原硬编码超集核验、live-skip-evidence 失实注记修正（前包 6ac5167f）。**基础设施抓真**：本包新增规则使「防复发全量扫描」用例（O(规则数×全库扫描)）越过 `--test-timeout` 120s 上限（solo 实测 505s），closeout 首跑结构性红——处置=`--test-timeout` 120s→600s 兜底留痕（scripts/test-affected.mjs；本批新增规则的直接后果由本批背最小修复），根修（用例 memoize 全库扫描）具体化进 BLOCK-272 reopen、另立项落地。Jev：本包无新定向 Node 测试面，未触发 test:suggest（CSS+探针面）；doc:suggest/next:suggest 见交付说明。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
