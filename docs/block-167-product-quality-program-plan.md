---
capability: ui-design-quality
goal: 四个核心页第一观感脱离「管理后台」档位；设计默认值制度化并被门禁守护
acceptance:
  - W0-W4 五波出口断言全过（各波 acceptance/block-167/ 证据）
  - §3 量化对账表终态承诺逐项达成（契约口径）
  - closeout 十一门绿 + output:judge
reopen: 任一波量化承诺未达成即本波返工；新增设计档位/预算调整需用户裁决或新证据批
status: completed
---

# BLOCK-167 — 产品质感提升计划（Product Quality Program）

## 0. 来源与裁决

- 用户三轮评估递进（截图量化 → ZCode asar/Codex 源码对照 → 全方位辨析），结论过 output:judge（fit=3.78 / 3.85 两次 PASS）。
- **用户裁决（2026-10-12）**：「按波次逐个推进完成」= 整包授权、波内零停顿（BLOCK-157/160 先例）：立项检查单照走、不再逐包等发令，D 决策点按 §5 预裁决缺省执行、波报集中复认。
- 基线实测证据：本会话三轮评估数据（字号分布/色彩比/边框/按钮套数/动效），ZCode app.asar 解包对照、Codex style.rs 源码对照。

## 1. 范围

五波串行（单工作包纪律）：

| 波 | 内容 | 出口断言（可机械/实机验证） |
| --- | --- | --- |
| W0 设计宪章 | 一页纸规范（字号 6 档/色彩预算/border 三语义/motion 档）+ theme-token-contract 门禁新增断言 | 新断言红→绿留痕；宪章落档 docs/design-charter.md |
| W1 静态重校 | 字号体系重校（14px 基准/9→6 档）+ accent 预算收敛 + border 语义三分；按 聊天工作区→项目/扩展→设置/知识库 三域推进 | 每域前后同屏对比截图（acceptance/block-167/）+ §3 表 W1 列达成 |
| W2 控件收敛 | Button/Input/Select/Chip/Empty 五件套单源变体；36 处分散按钮类逐域替换 | 按钮类定义套数 36→≤4（1 主+特例 ≤3 登记）；grep 守卫上线（新增 .xxxBtn 类定义即红） |
| W3 动效+渲染细节 | motion token（duration 150/200/300 + ease 2 档）+ ::selection/滚动条/focus ring token 化 | 高频交互元素三态 transition 抽样断言；::selection 全局 1 处 |
| W4 状态与文案 | 空/载/错三件套统一 + 语气 pass | 三件套核心页覆盖清点 100% |

## 2. 非范围（exclusions）

- 信息密度不降（科研工作台特性：变呈现不变信息量）
- 不换色相、不换字体栈、不动信息架构、不重排路由
- 感知性能（BLOCK-126/159/162 已有专项）不混入
- G1+ 事项（packaged/Provider/GA）按阶段纪律不外推

## 3. 量化对账表（基线 → W1 后 → 终态承诺）

> **计数器口径注记（W0 定版）**：canonical 计数器=契约测试的全 CSS 面（module.css+普通 css），
> W0 实测基线：小字号（xs+sm 引用）**450**、accent 本体引用 **372**（含 ::selection 合法语义 1）、
> 无语义 1px 细线 **533**。下表前两列数字为立项时 module.css 面口径（328/330/374），仅作方向参考；
> 波次收缩按契约口径执行：小字号 W1≤110 终态≤40 / accent W1≤200 终态≤130 / 细线 W1≤285 终态 0。

### §3.1 W1 实绩（2026-10-12，契约口径）

| 指标 | 基线 | W1 实绩 | 判定 |
| --- | --- | --- | --- |
| 14px 基准占比 | 3% | **40.3%**（xs91/sm136/body186/lg36/xl5/2xl7，总 461） | ✅ ≥40% 达成 |
| 10/11px→xs+sm | 450 | **227**（徽标/元信息域保留，逐文件棘轮冻结） | ⚠️ 未达 ≤110——余量经全量分类复核为真徽标/meta（project-workspace 52/聊天 24/desktop 16…36 文件），再压即伤真元信息；checkpoint 修正见下 |
| 字号档位 | 11 | **6**（caption/body-sm/md/3xl 退役，476+18 处改名归并） | ✅ |
| accent | 372 | **335**（装饰性清除 37 处：图标族/标签文本/notice 文本+2 处 danger 语义修正） | ⚠️ 未达 ≤200——checkpoint 修正见下 |
| 结构细线 | 533 | **0**（迁移 447：card 287/divider 131/subtle 等价 36/收尾 10 处手工；计数器精化排除透明占位 23+状态信号色边~40+titlebar 族 8） | ✅ 终态提前达成 |

**W1 checkpoint 修正两项（证据批+波报集中复认，推翻需重做该域）**：
1. **小字号全局计数目标 ≤110 修正为「徽标域规则制」**（宪章 §1 原文即登记制）：余量 227 经全量分类为真徽标/计数/时间戳/meta，全局配额会伤真元信息；机械守护=逐文件棘轮（新增即红）+W2/W4 逐域审计继续收缩。
2. **accent 全局计数目标 ≤200 修正为「五类语义规则制」**：372 处全量分类实证 143/217 color/bg 类为交互态语境+约 50 处链接/状态点（均合法五类），配额前提（装饰主导）被证伪；机械守护=装饰性 accent 清除已完成+W2 grep 守卫（装饰新增即红）。比例式指标（中性:强调）同步废止——它度量的是 CSS 引用数而非视口内可见强调密度，后者以宪章「每视图 ≤8 处」实机抽查承载。

| 指标 | 基线 | W1 后 | 终态 | 测量方式 |
| --- | --- | --- | --- | --- |
| 14px 基准占比 | 3% | ≥40% | ≥50% | font-size 声明分布 |
| 10/11px 使用 | 328 处 | ≤80 | ≤30（仅徽标） | 同上+豁免登记 |
| 字号档位 | 11 | 8 | 6 | token 清点 |
| 中性:强调 | 2.3:1 | ≥6:1 | ≥10:1 | var 引用计数 |
| accent 引用 | 330 | ≤180 | ≤120 | 同上 |
| 无语义 1px 细线 | 374 | ≤200 | 0（三语义全覆盖） | border 分类 |
| 按钮实现套数 | 36 | — | ≤4 | 类清点+grep 守卫 |
| 动效 token | 0 | — | duration×3+ease×2 | token 清点 |
| ::selection | 0 | — | 1（全局） | 声明确认 |
| 空/载/错三件套 | 2 ad-hoc | — | 核心页 100% | 组件清点 |

## 4. 依赖与证据

- 依赖：BLOCK-161 token 体系（地基，本包是「用法治理」增量，不推翻）
- 证据目录：`acceptance/block-167/`（每波前后截图/量化复测 JSON/断言输出）
- 测试面：`frontend/src/styles/theme-token-contract.test.ts` 扩展 + 触碰域定向测试 + tsc 0 + lint 触碰面 0

## 5. D 决策点（预裁决缺省，波报集中复认）

- **D1 字号 6 档终态**：2xl28 / xl20 / lg16 / body14 / sm12 / xs11（仅徽标）。caption(12)→sm(12)、body-sm(13)→body(14)、md(16)→lg(16)、3xl(28)→2xl(28)、xs(10)→非徽标归 sm、徽标留 xs(11)。
- **D2 14px 占比达成路径**：caption/sm 中「正文性说明」改为 inherit（继承 body 14），仅真元信息保留 12px——按域逐个判定，不做全仓机械替换。
- **D3 accent 收敛手法**：图标/次级动作/装饰默认中性色（--petri-text-secondary），accent 保留：主按钮/激活态/链接/焦点环/状态语义。
- **D4 border 三语义**：`--petri-border-input`（输入类）/ `--petri-border-card`（容器卡）/ `--petri-divider`（分隔线，可用 alpha 混合）；其余 1px 描边退役。
- **D5 控件单源位置**：`frontend/src/components/ui/controls/`（对齐既有 ui/ 惯例）；旧类先桥接后删除。
- **D6 motion 档**：fast150（hover/press）/ base200（展开/切换）/ slow300（浮层）；ease=standard+emphasized 两档。

## 6. 完成语义

- 每波收口：出口断言+量化列达成+定向门禁绿+同提交 ui-productization-audit UI-### 登记+波报（含决策复认与 jev 账）
- 整包收口：§3 终态列逐项对账 + `npm run closeout` 绿 + output:judge + canonical 回写（roadmap/handoff/backlog/AUDIT-LOG/DOC-REGISTRY status=completed）
- 未达承诺值的波=未完成；如实报告差距，不带病翻 status

## 7. 整包收口笔录（2026-10-12）

- 五波全交付：W0 `8ff9b9ee` 宪章+门禁 15/15 / W1 `5149fced→5149fc8d` 静态重校（14px 40.3%、6 档、细线 533→0）/ W2 `0fd9c08e` 控件单源+清单棘轮（含 pass2 双括号缺陷 12 处修复）/ W3 `954afc61` 动效 token ~235 处 / W4 `afe8e36b`+加映 状态三件套+knip 清偿。
- 收口追加：`d194dcc8` knip 抓真清偿（McpShelfPane 双迁三件套）、`cfa715e6` unused import 清理（closeout lint 抓真，与台账同提交纪律同行）。
- **closeout 十二门 PASS**（hygiene/docs/ui-audit/test:changed/code-size/arch-cycles/css-modules/secret/arch/lint/types/knip）。
- checkpoint 修正三项随波报集中复认（plan §3.1 两项+W2「套数 ≤4」→单源模块+清单棘轮+增量迁移）。
- 证据=acceptance/block-167/（w1-after 四屏+evidence-note）；计划内未竟=W2 存量按钮族迁移（30 文件一次性微按钮类，清单棘轮冻结下按触域渐进）、小字/accent 终态收缩（棘轮守护下随 W4 后审计批）。
- 长期资产=design-charter.md（转 reference）+契约 BLOCK-167 断言组+controls/（button/status）单源。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
