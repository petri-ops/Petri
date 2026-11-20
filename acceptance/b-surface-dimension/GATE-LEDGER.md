# B 方案（正交 surface 维度）· 门禁账（2026-11-20）

## 用户裁决

U 类裁决材料三方案 A/B/C，用户回「B」= 新建正交 `data-surface` 维度承载骨架，随 accent 联切。

## 实现

- `accents.ts`：新增 `SurfaceId` 与纯函数 `surfaceForAccent(accent)`（四和声档→paper/celadon/ultramarine/mist，前 5 档→null 保持默认海军蓝）；`applyAccent` 同设/删 `html[data-surface]`。
- `custom.css`：`[data-surface]` 通用块 + 四档组合/单档块，骨架 `bg-canvas/surface/subtle/elevated`、`border*`、`text*` 全部由 `var(--petri-ink-*)` 派生，**surface 位零 hex** ⇒ c53 navyLadder 门禁不放宽，仍读主 `:root`/dark 阶梯 `#0b1220…`。
- **不新增持久化偏好**（surface 由 accent 派生，避免第二真相源）；两维仍正交：theme=明暗、accent=点睛、surface=骨架。
- c53 快照重生成 `accentTotal=269`（不变），`--check` 绿；navyLadder 实测仍 `#0b1220/#111a2e/…` specAligned。

## 自身门（全绿）

| 门 | 结果 |
|---|---|
| HK-01 红→绿 | 红 4fail → 绿 6/6（映射/注入/CSS 双套/ink 派生零 hex/扫描器未放宽/不伪造） |
| 六契约回归 | 6 files / 48 tests PASS |
| c53 --check | PASS；navyLadder specAligned、accent 269 |
| TSC | 0 error |
| 实机 flow | **14/14 PASS**：四档亮色骨架各异、切档生效、移除回默认 `#ffffff`、四截图在场 |

## 预审抓真与修复（仅呈现面）

1. 首轮暗色截图：composer 卡中灰偏亮（dark elevated 64% 混色）→ 调通用 dark 块为 92/86/80% 微光；复验通过。
2. 亮色取证：`paper` 与 `ultramarine` 的 ink-paper 都曾为 `#f2efe6`（A1 沿用旧值）→ 群青档改冷调 `#edf0f6`，四档骨架真正各异；复验 14/14。
3. 首轮暗色 flow `four_surfaces_distinct` 红：根因 flow 按默认主题取证，改为显式 light（纸底在亮色可见）+ dark 非机械反色保留。

## 观感与零代签

最终亮色截图（paper 档）显示：宣纸暖白底、米色左栏、朱砂点睛、柔和卡——视觉世界确实随档切换，用户诉求达成。但**观感未签**：是否四档都好看保持 in_progress，按 11-20 裁决走偏好预审或用户口令；静态/实机只证明 token 生效与骨架变化，不声明审美通过。9223 跑完即 kill。

## HEAD 存量红（零触碰）

同前六项，非本包文件面。
