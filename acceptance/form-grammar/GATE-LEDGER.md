# 艺术性造型升级（形态语义层级）· 门禁账（2026-11-20）

## 用户诉求
「图标小卡片都方方正正，不够高级、没个性」——不是加门禁，是动造型语言。

## 艺术指导（跨门类取形，非贴皮）
- **建筑**：月洞门/拱券的柔 → 纸面区块 14px squircle（宣纸铺展的开放边界）。
- **雕塑**：卵石之润 → 图标座 10px squircle（比小方块柔，仍克制）。
- **绘画**：落印，朱砂印本就是方的 → 点睛处保留 3px 近方（方在此有郑重语义，不是缺陷）。
- **影视/格物 mark**：开环不闭合 → 空态徽章圆形印记与 open-ring 呼应。
一句话：**让方/圆/环各有身份，而非所有东西同一个模子**。

## 实现
- 新 token `--petri-radius-seal:3px` / `--petri-radius-icon:10px` / `--petri-radius-card:14px`（`custom.css`），同步 theme-token-contract 档位清单 + dark 豁免（非色几何 token）。
- 高杠杆换形：TitleBar `.iconBtn`/`.winBtn`、home `.workbenchIcon`(原硬编码15px收编)/`.workbenchCardIcon`、leftQuickAction、emptyResultLaunchIcon → icon/card 档；`.emptyResultBadge` 12px 方卡 → **50% 圆印记**；extensions `.mcpCard` → card 档。
- SVG 单源加 `seal-square` 原子（近方带缺口，与 open-ring 同语，round 笔画同族）；零新依赖。
- KPI grid 的 radius:0 保留——它已是发丝线分隔的"纸面表格"，改圆角反而破坏框架语法（盘点结论）。

## 自身门（全绿）
| 门 | 结果 |
|---|---|
| HK-01 红→绿 | 红 5fail → 绿 7/7（三档层级/契约白名单/图标座换形/hero+徽章/方印原子/零依赖/零代签） |
| 邻域回归 | 5 files / 65 tests（契约 19/19、TitleBar 29、home、IdentityAtoms） |
| TSC | 0 error |
| c53 | 快照重生成纳入三 token，--check 绿，accent 269 不变 |
| 实机 flow | 7/7：三档 live(3/10/14px)、三面图标座 10px、截图在场 |

## 观感边界
实机截图显示变化真实但克制（28px 图标座上 6→10px 属中等可见，圆形徽章/方印原子为点睛）。逐条判据全过、无拥挤/溢出；但**不代签"高级/个性"的审美判断**——按 11-20 裁决可走 ≤3 轮偏好预审，(需用户给偏好标准或口令)否则保持 in_progress。UI-717 四档观感 verified 仅覆盖色板/骨架，不覆盖本次造型，不外推。G0 开发期常态 · 不外推 packaged/Provider/GA。
