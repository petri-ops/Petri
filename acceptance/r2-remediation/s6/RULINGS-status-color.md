# S6a 状态色三套合并单源 · 裁决留痕（2026-11-21）

> 波次：R2 清偿批 S6a（P0-3）· 预置裁决 R5（现读三套→选定单源→机械替换→契约锚→删旧不留别名）。

## R-S6a-1 单源设计（单一最合理选择）

三套现读（custom.css，light/dark 各一）：
| 旧名 | light | dark | 语义角色 |
|---|---|---|---|
| `--petri-success` | #2e7d32 | #7fd8a4 | UI-151 补齐时代产物（对齐组件 fallback），泛 success |
| `--petri-status-success` | #22c55e | #4ade80 | 状态指示/图形（与 --petri-status-online 同值） |
| `--petri-status-success-fg` | #059669 | #4ade80 | 状态卡前景文字（对比度调校） |

**合并方向**：收敛到既有 status 家族形态（bare=指示/图形、-fg=前景文字、-bg=卡片底——与 error/warning
家族同构），删 `--petri-success`，**零兼容别名**。理由：status 家族是 semantic home（bare/-fg/-bg/border
完整形态已在），`--petri-success` 是历史补丁名；error/warning 无第三套平行名，success 对齐后家族语法统一。

## R-S6a-2 机械替换（14 处消费，按角色映射）

- `color:` 角色（11 处）→ `var(--petri-status-success-fg)`：status.module.css:95、simple-chat.css:4587/4652/4706/4817、
  KnowledgeSpacePanel:51/437、AgentTeamRoster:44、WorkSurfacePanels:95（fallback 形态）、project-workspace:1301（fallback 形态）
- `border-color:`/`border-left-color:`/`background:` 图形角色（4 处…实际 3 文件 4 行）→ `var(--petri-status-success)`：
  simple-chat.css:4818、AgentTeamRoster:43、ToastProvider:30/136
- 删除 custom.css light/dark 两处 `--petri-success` 定义；两处 fallback 形态替换后**顺带消掉 raw 颜色 fallback**（禁 fallback 棘轮向）。
- bare token 的 5 处 color 消费（simple-chat:1581/1701、rail-page:54、home.tsx:609、command-center:136）**不动**——
  值语义由 token 本身承载（#22c55e on 白对比度弱为既有观察项，归 a11y U 类，不混入本票 blast radius）。

## R-S6a-3 契约锚

`frontend/src/styles/status-color-single-source.test.ts`（3 tests）：①旧名零定义（不留别名）②旧名零消费（git grep
全前端）③新家族 light/dark 各 4 行定义且只住 custom.css。HK-01：红 3/3（旧名定义+消费在场、家族 4 定义不齐）→ 绿 3/3。

## 出口核验（现读）

- styles 全套 62/62（含 token 契约 19/19、identity-palette、accent-scarcity 等邻域）
- ToastProvider / AgentTeamRoster / KnowledgeSpacePanel 邻域 14/14 + block109 6/6
- tsc 0；gate:ui-a11y PASS（对比度 32 对 0 违规）
- 行为基线：改前同套全绿（S5 刚跑过 styles 套件 36/36 相关面）→ 改后 62/62，同套绿

## 诚实边界

- 文字/边框色值有 in-family 微移（#2e7d32→#059669 / #2e7d32→#22c55e）：合并= authorized breaking（R5 预授权），
  对比度经 a11y 门验证；观感零代签（颜色属既有状态语义域，非新审美维度）。
