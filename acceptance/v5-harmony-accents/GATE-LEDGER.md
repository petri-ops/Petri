# V5 身份面上线 · 门禁账（2026-11-20）

## 用户裁决

「可见品牌面都加入、设置上切换、其它同理」→ 唯一建议获「行」：四套和声注册为 `[data-accent]` 新档位，与现有 5 档并存于同一 `AccentControl`。

## 实现（复用现成管道，零新机制）

- `frontend/src/themes/prefCache.ts`：`AccentId` 类型 + `ACCENT_VALUES` 加四 id。
- `core/packages/shared-config/config-schema.js`：`userPrefs.accent.domain.oneOf` 同步（drift 契约要求前后端一致）。
- `frontend/src/themes/accents.ts`：`ACCENT_OPTIONS` 加四档（宣纸·朱砂/青瓷·墨/群青·铜/靛·雾）。
- `frontend/src/styles/custom.css`：八块（四档 × 亮暗）覆盖 accent 族 + `--petri-ink-*` 骨架；非机械反色，暗底为微光。
- 切换机制零改动：仍走 `ThemeProvider` → `html[data-accent]` → localStorage → 服务端 user-prefs。

## 自身门（全绿）

| 门 | 结果 |
|---|---|
| HK-01 红→绿 | 红 5fail → 绿 6/6（白名单/前后端漂移/选项表/CSS 亮暗双套/零依赖/不伪造） |
| 邻域回归 | 5 files / 41 tests PASS |
| 主 token 契约 | 19/19（accent 棘轮未回潮：档位覆盖是 token 定义，不新增组件层 `var(--petri-accent)` 引用） |
| prefCache drift | PASS（前后端白名单一致） |
| TSC | 0 error |
| 实机 flow | **17/17 PASS**：四档 computed accent 各异、亮暗双套逐档实测、四张截图在场（`live/`） |

## 实机证据与诚实边界

`acceptance/v5-harmony-accents/live/v5-harmony-accents-live-darwin.json` 17/17 allPass；四张档位截图在场。首跑曾 5/13 FAIL，根因是 flow 按亮色期望而测试实例处于 dark——**不是产品缺陷**，flow 改为按实际主题判期望并显式切另一主题证双套后全过。

**重要局限（必须对用户如实）**：截图复核显示——四档切换**确实改变了点睛色**（如朱砂档的「免费试用」pill 为赤色），但**页面骨架仍是海军蓝**（`--petri-bg-canvas` 等未随档覆盖）。原因：`AccentControl` 的历史契约是"明暗由 `[data-theme]` 承载、主题色只覆盖 accent 族、其余 token 不动"（`accents.ts:7`）。要让「宣纸真的变宣纸底色、群青真的变群青骨架」，必须覆盖骨架 token——那会改 theme 语义、触 dark-pair/navy-ladder/色彩预算棘轮，属**新的 U 类裁决**，不在本次「行」的授权范围内，未擅自做。

## 观感零代签

四档切换的视觉观感（哪档更好看、点睛是否和谐）保持未签；静态/实机只证明 token 生效与双套正确，不声称审美通过。按 11-20 裁决，若给偏好标准可走 ≤3 轮预审闭环，否则留 in_progress。

## HEAD 存量红（零触碰）

同前六项，非本包文件面。
