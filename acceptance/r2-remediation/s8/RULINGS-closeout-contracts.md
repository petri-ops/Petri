# S8 closeout:full 衁遗清偿 · 裁决留痕（2026-11-21）

> 背景：S2 修复 test:changed 裸文件名工具错后，**被 exit-2 掩盖的存量红首次得以全量执行**，
> closeout:full 首轮暴露 post-h9 契约族 4 红（+knip 棘轮 50 键）。逐件契约演进（测试追上契约，非契约退回测试）：

## R-S8-1 保护清单计数锚（post-h9-evidence-and-ledger:⑤）

「清单=10 项」冻结计数锚与 S2 的合法移除（10→9）冲突 → 演进为「关键成员在册（assets//pelican/post-h9 蓝图/tmp-review）
+ 9≤n≤12 上界 + 已入库脚本不在清单」成员断言；自匹配假红一并修复（契约测源码含旧名，提交后 git grep 自见 → 排除自身路径）。

## R-S8-2 蓝图登记态 parity（POST-H9-D5 摘除语义）

K-07 reader 找已被 D5（2026-11-19「摘除」裁决）移除的 registry 条目 → postH9Registry=null 红。
演进：缺席=`'deregistered'` 摘除态语义（非 null 缺陷）；K-07 断言 `deregistered`+README 无 planned 条目。
该红自 11-19 起存在，被 test:changed exit-2 工具错掩盖至今——**登记为 S2 修复揭开的被遮蔽存量红**。

## R-S8-3 K-15 debt canonical 演进（38/15/23 → 36/13/23）

canonical triage JSON（acceptance/block-332/ui-ledger-triage.json）已随 11-20 yi-rest 批量签字+UI-714 加映演进为
36/13/23；测试/DEBT_CEILING/adjudicator 三处钉值同步演进，并把 adjudicator 判据从字面量改为 DEBT_CEILING 锚定
（下次演进只动一处）。演进 trail 留注释（35/13/22→36/13/23→38/15/23→36/13/23）。

## R-S8-4 K-22 knip 保留面（350 → 402）

- 存量漂移：baseline 实为 352 键（11-18 后 EVO-4 ui716 flow 等两批 +2 漏同步上限行——注释内同根先例）。
- 本批 50 键定性入册（knip-ratchet --update）：dev-verify flows ×8（run.cjs readdir 动态装载，knip 看不见 require 边，
  同 344 批先例）+ acceptance 取证探针 ×39（yi-rest 乙组 _tools/stall/a4/ui-711 他包证据面零触碰）+
  minimal-variant-preserved ×2（S1 终版裁决留证）+ `GlobalWatermark.tsx`（终版=AI 版后笔锋版为已提交回退形态；
  **真死代码定性保留**，清退与 CulturalWatermark.test.ts 契约面一并移交水印 owner 裁决）。
- K-22 上限 350→402 + 负测篡改值 351→403，trail 全注。

## 出口

gate:post-h9-contracts **186/186 全绿**（基线 182/4 红）；node --test 逐文件全绿。

## R-S8-5 c53 manifest 整写丢条目（本批 S3 自伤回归 · 根修）

closeout:full 二轮揭出：S3 的 `c53-design-baseline.mjs` **整写 manifest** 把 9 个非自有条目
（skill-contract/ia-map/responsive-a11y/performance-trust/human-eye-closeout/assistant-ui-pattern/
react-bits-motion/21st-snippet-library/reference-board-review）静默清掉 → c53-skill-contract 契约红
（5e55430c 时点 manifest 有 11 条）。根修=生成器改**合并语义**（只更新自有 design-context.json 条目，
外部条目原样保留、sha 由各自所有者维护；留因注释入生成器），从 git 历史取条目清单+现算 sha 重建，
双生成器重生成 → c53 三套 28/28 绿。同族根修：`c53-visual-consistency.mjs` 的 manifest 同步本就是合并式（无损）。
