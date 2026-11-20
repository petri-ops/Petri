# A1 色板 token 化 · 门禁账（2026-11-20）

## 裁决链

- A0 裁决「行」（用户「开干」），ruling=`acceptance/a0-identity-translation/ruling.json`: B 青瓷·墨 工作态主 accent + A 宣纸·朱砂 品牌落印点睛 <5%。
- A1 范围：只定义身份色板 token（亮暗双套），不改组件消费、不改观感状态、零新依赖。

## A1 自身门（全绿）

| 门 | 结果 | 证据 |
|---|---|---|
| HK-01 红→绿 | 红 3 failed/1 passed（token 未定义）→ 绿 4/4 | `hk01-red.txt` / `hk01-green.txt` |
| 主 token 契约 | 19/19 PASS | `npx vitest run src/styles/theme-token-contract.test.ts` |
| 明暗成对 | 4 个新 token 均 :root + dark 双套定义 | `identity-palette-contract.test.ts` |
| 点睛语义 | vermilion 双块均带 落印/点睛/品牌 标注 | 同上 |
| 对比度 | 32 对 0 违规；ink/paper 14.97:1、celadon-light 4.76:1、celadon-dark 9.65:1、vermilion/paper 4.64:1 | `node scripts/ui-design-a11y.mjs --check` + `audit_harmony.py` |
| lints | 0 error | read_lints |

## HEAD 存量红（零触碰）

同 A0 `GATE-LEDGER.md` 的六项（test:changed 裸文件名 / user-assets / silent-catch / lint 基线 / knip WIP / code-size 指纹漂移），非 A1 文件面。

## 非范围

- 未改 `--petri-accent` 工作态引用（356 处收敛属 V1 配色稀缺化，另包）。
- 未把新 token 接入任何组件消费（A2/A3 另包）。
- 未翻任何观感状态；点睛面积 <5% 属人眼判据，留预审闭环。
