# V2/V3/V4 视觉升级收尾 · 门禁账（2026-11-20）

## 授权形态
用户「可以的 冲 / 后面自己判断，一次整个大的」= **预授权连续工作模式**：V2→V3→V4 一次做完，不再逐期发令；只在 breaking/新依赖停下，优先 deferred 继续。

## 实际范围（探查后收敛——方案写的大面多数已是现状）

### V2 层级单源
- **真问题修复**：`project-workspace.module.css` 的 `.leftPanelWrap` 双定义合并（UI-262 浮卡锚点 `position:relative` 并入主块、删第二块），CSS Modules 同 hash class、零视觉变化。
- **盘点不改**（已是现状/冻结）：裸 z-index 104 处/34 文件是**冻结棘轮**，方案说的"裸 z-index 111 迁移"在现读里已不存在；`--petri-z-*` 8 档已在 `custom.css:183-192`；扫描面（FileTreeItem/ModelMenu/LeftPanel）已是 rows 不是 cards；宽度已有 `--ws-frame-padding` 等 token。
- **deferred（U 类）**：断点 17→≤4 档值（无 ≤900 精确档，改属 breaking + `gate:ui-breakpoints` 新阈值登记）未拍板，不擅动。

### V3 浏览器表面细节
- caret 已 `var(--petri-accent)` 单源、`::selection` 唯一且 accent 派生、scrollbar 8px/token、tabular-nums 已在 home.module.css、阴影三档已在 custom.css——这些**前序已到位**，盘点确认。
- **真问题修复**：
  - `project-workspace.module.css` 128 处 `;;` 双分号（2026-10-11 语法噪声，无契约冻结）机械清零；
  - `Federation.tsx` 标题「添加协作节点」→「协作节点」（标题名词短语纪律；按钮仍动词）。
- **CTA 例外登记**：home「创建第一个项目」是空态主行动标题（3 测试依赖），动词短语在此合规，不改。
- **deferred**：全局 focus-visible 单源（88 处分散，强行收敛属大重构、易触 ratchet）——盘点记录，本次不合并。

### V4 复测回写
- `scripts/lib/v234-scorecard.mjs` 从现读 11 项判据机械派生评分卡，**保守口径**（每维 ≤+0.5、D 封顶 4.7，不宣称审美满分）：before **3.6 → after 4.1**（A3.5/B4.0/C4.0/D4.7）。证据 `scorecard.json`。
- 复用既有 `ui-design-scorecard.mjs` 口径，不另立第二套计分。

## 自身门（全绿）
| 门 | 结果 |
|---|---|
| HK-01 红→绿 | 红 3fail（leftPanelWrap 双定义/`;;`/动词标题）→ 绿 8/8 |
| 邻域回归 | 4 files / 37 tests（含主契约 19/19、home、SettingsNav） |
| 全契约 | 8 files / 60 tests PASS |
| TSC | 0 error |
| c53 --check | PASS（accent 269、slate 5 冻结不变） |
| ui-a11y | 32/32 格、0 对 <4.5:1 |

## 观感与边界
- V2/V3 改动均零视觉变化（class 合并/语法清理/文案名词化），不触发观感签字；V4 分数是机械下限估计，**不等于审美分**。
- 观感仍由 A4 预审签字的 UI-717 覆盖；本包不外推 E 类人眼槽 / packaged/Provider/GA。
- breaking U 类（断点档值、状态色家族合并、全局 focus 单源）登记 deferred，未擅动。
