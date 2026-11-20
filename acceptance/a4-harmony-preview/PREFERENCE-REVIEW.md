# A4 四档整体观感预审 · 结论（2026-11-20）

## 标准与授权
用户「可以的 冲」= 授权四档整体观感预审闭环。标准=偏好原话「简单文字少，布局和谐」（`docs/user-preferences-codification.md:51`）+ 艺术指导 Q1–Q5。纪律：≤3 轮、仅呈现面、逐条判据 + 截图证据；按 11-20 裁决「偏好预审通过即视为签字」。

## 取证（只 9223 离屏，绝不碰主窗 9222）
- flow `a4-harmony-preview.cjs`：逐档切 `data-accent` + `data-surface`，截 welcome/settings/extensions 三面，12 张 PNG 落 `round1/`。
- 断言 **46/46 allPass**（`round1/a4-harmony-preview-live-darwin.json`）：四档 accent 各异 `#b5482f/#0f766e/#a87c42/#6e9ca0`、四档骨架各异 `#f2efe6/#f4f1e8/#edf0f6/#eaeef2`。
- 9223 跑完即 kill。

## 逐条判据（四档独立判，全部 PASS）
| 判据 | 标准 | 结果 |
|---|---|---|
| P1 文字少 | 副标题 ≤120 字 | 42 字 × 4 档 PASS |
| P2 布局和谐 | 三面无横向溢出 | welcome/settings/extensions × 4 档全 0 溢出 PASS |
| P3 骨架随档 | 四档骨架/点睛色各异 | 八值 distinct PASS |
| P4 点睛纪律 | 每视图点睛 ≤1、active 文字中性 | active atom=1 × 4、文字中性 PASS |
| P5 清晰度 | 弱化字 ≥4.5:1 | 静态门禁最弱 4.64/6.50:1 PASS |

## 人工复核（截图逐档过目）
- **paper-vermilion**：宣纸暖白底 + 米栏 + 朱砂点睛（active 下划线/一键安装/安装标签），留白充分、文字少 → 和谐。
- **celadon-ink**：浅青瓷底 + 青瓷点睛，延续默认 teal 认知 → 和谐。
- **ultramarine-brass**：冷宣纸底 + 铜色点睛，证据/归档气质 → 和谐。
- **indigo-mist**：冷灰蓝底 + 靛青点睛，数据密集克制 → 和谐。
- 四档均无拥挤/溢出/点睛堆叠，符合「简单文字少、布局和谐」。

## 如实标注的边界（不属本次呈现面范围）
1. **`.sc-access-btn`（"完全访问"）固定橙红**：用 `--petri-accent-orange`（#ea580c），四档里都保持橙红（群青档里略显跳）。判定为**安全/权限状态语义**，按 design-charter §2 五类语义之「状态语义」不应随装饰主题漂移——属 U 类，未擅改；如需随和声走，另开裁决。
2. **截图顶部黄条**：dev 调试提示（"应用已暂停 / Chromium 调试"），非产品 UI，环境噪声，不计入判据。
3. P5 对比度由静态门禁（SurfaceDimension 7/7）锁定，实机复核无发虚。

## 结论
首轮（1 轮，≤3）四档 P1–P5 全过 + 人工复核和谐 → 按 11-20 裁决翻**四档观感 verified**（dev Electron / 9223 离屏边界内）。边界仅限四档和声呈现面（色板/骨架/点睛/排版在此四档的观感），不外推到 UI-### 其它面、E 类人眼槽、`sc-access-btn` 状态色或 packaged/Provider/GA。HK-01 红→绿（材料/flow 缺失 6fail → 7/7）。
