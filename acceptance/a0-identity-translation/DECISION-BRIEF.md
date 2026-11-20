# A0 身份转译决策材料（待用户裁决 · pending_user_ruling）

> **形态**：专项（结论型）；plan = `docs/AUDIT-LOG.md` A0 条目。零产品代码 / 零新依赖 / 观感零代签 / 不碰 G1+。
> **证据机读真源**：`decision-material.json`（由 `scripts/lib/a0-identity-translation.mjs::collectIdentityTranslation` 从品牌真源机械派生，逐读数现读可复算）；契约 `schema.json`；HK-01 `hk01-red.txt` / `hk01-green.txt`。
> **性质**：本文件只给**一个建议 + 一句理由**（用户 2026-11-20 裁决「一个建议+一句理由，用户只回行/不行」）；不列多选菜单。观感项无偏好裁决，保持 `in_progress`，Agent 不代签。

---

## 1. 六组读数（现读真源）

| 读数 | 结论 | 真源 |
|---|---|---|
| sourceAssets | 5 件品牌资产全部在场（system-board / palette / grid-contact / FINAL-main / v2-colour-directions） | `petri-logo-concepts_assets/`（未跟踪用户资产，只读发现） |
| artDisciplines | 核心四门（建筑/影视/绘画/艺术史）+ 扩展七门（音乐/雕塑/戏剧/文学/摄影/字体/工业设计）已纳入 | `acceptance/ui-visual-upgrade-2026-11-20/CROSS-DISCIPLINARY-MASTER.md` |
| harmonicSchemes | 四套和声试样 A 宣纸·朱砂 / B 青瓷·墨 / C 群青·铜 / D 靛·雾，各有骨架/墨/点睛 | `00-palette.png` / `v2-colour-directions.png` |
| recommendation | 单一推荐（见 §2），status=`pending_user_ruling` | `ART-DIRECTION.md §2.1` |
| refusals | 明确拒绝 glassmorphism / parallax / film-grain / neon-glow / gradient-text / emoji-as-icon | `CROSS-DISCIPLINARY-MASTER.md §0/§5` |
| boundaries | 观感 in_progress / 产品代码 0 / 新依赖 0 / G1+ false | AGENTS.md G0 纪律 + 2026-11-20 观感裁决 |

## 2. 单一建议与一句理由（只回「行 / 不行」）

**建议**：采用 **B 青瓷·墨** 作为工作态主 accent；**A 宣纸·朱砂** 仅在品牌落印位点睛（面积 <5%）；四套和声作为同一剧本的四场按语义切换，不做四个并列主题。

**理由**：延续既有 teal 认知与「主题色一致」偏好，先用和声关系收敛 accent 预算，把身份点睛留在品牌面而不铺满工具面。

## 3. 若「不行」需要回什么

只需给一句新方向（例如「用 C 群青·铜作主」「朱砂要铺满品牌面」「四套都可并列切换」），我把它作为新的裁决原话回写材料并 reopen；不追问、不开菜单。

## 4. 裁决后的边界（不越过）

- 裁决只授权**方向**；A1 色板 token 化仍是独立阶段，需另行发令。
- 观感项：即便方向裁决为「行」，颜色观感仍走偏好预审闭环或留 `in_progress`，不由静态证据直接翻 `verified`。
- 产品级新依赖（字体文件 / 图标库 / 组件库）不在本建议内；如需引入须另走 DEPENDENCY-CHANGE-CHECKLIST 与用户裁决。
- G1+（packaged 签名 / Provider / GA）不在本包范围。

## 5. 证据索引

- 消费测试：`test/a0-identity-translation.test.mjs`（11 断言：在场/可复算/单一推荐/边界 + 7 类篡改负测）
- HK-01：`acceptance/a0-identity-translation/hk01-red.txt`（MODULE_NOT_FOUND）→ `hk01-green.txt`
- 机械门禁：`docs:check` / `ui:audit:check` / `hygiene:check` / `closeout` 定向链
