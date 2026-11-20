# S1 水印终版裁决与并发清场 · 裁决留痕（2026-11-21）

> 波次：R2 清偿批 S1（P0-1）· 预授权来源：用户 2026-11-20「不需要人参与，agent 自动推进校验复核判断」
> + `docs/next-phase-e2e-prompt-2026-11-20.md` §2 预置裁决 R2（水印终版=留 AI 版，执行序可逆）。

## 裁决与执行

| # | 裁决点 | 裁决 | 一句理由 | 留痕 |
|---|---|---|---|---|
| R-S1-1 | 水印终版 | **留 AI 版**（预置裁决 R2，本批无再裁空间） | 唯一有实机 12/12 绿证据（`ai-image/live/cultural-watermark-ai-live-darwin.json` allPass=true）且 `main.tsx:11-12,20` 已接线；极简版自身 live `allPass:false` | 本文件 + commit |
| R-S1-2 | 极简版处置 | 原样复制到 `acceptance/cultural-watermark/minimal-variant-preserved/` 后回退三文件到 HEAD；未跟踪 `watermark-contract.test.ts` 按 R2 P0-1「归档」路径移除原位（sha256 逐字节一致副本留证） | 可逆替代：先留证再改，恢复命令见 preserved/README.md | `minimal-variant-preserved/`（10 文件） |
| R-S1-3 | live/ 目录复原 | `git checkout HEAD -- acceptance/cultural-watermark/live/` 复原 4 张已提交 PNG + 笔锋版 JSON | 工作区版 JSON 是 AI 运行的**冗余副本**（canonical 已提交于 ai-image/live/），且实为 CSS 定稿前中间态（allPass:false），无证据价值损失 | `live-json-worktree-snapshot-ai-run.json` 留证 |
| R-S1-4 | flow 与终版对齐 | 重写 `dev-verify/flows/cultural-watermark.cjs` 断言 AI 版标记（bg=cultural-watermark.png / fixed / 非交互 / 三路由截图），evidenceDir→`ai-image/live/`；断言结构复刻 canonical 12 断言集 | 终版=AI 版，flow 必须断言已接线产品面，否则验证工具锚死代码（HEAD flow 断言笔锋四纹样，而 main.tsx 渲染 AI 版——并发战争遗留的不一致，留之则任何未来 watermark 验证恒红） | 本文件 + fresh 12/12 证据 |
| R-S1-5 | 9223 遗留实例 | kill（pid 85626/85629，遗留 9h00m48s） | 预置裁决 R2 明确授权「kill 9223 遗留实例」；只杀 9223 测试实例，主栈（9222/:3000/:3001）零触碰 | boot/flow 日志 + 复核「no listener」 |
| R-S1-6 | 并发探测 | 写入窗口 2026-11-20 21:01–21:05，本批执行时静默 10h18m；判定对方会话休眠，按可逆清场推进 | 静默超 10h 且对方产物已全量留证，继续等待无边际（预授权连续推进） | S0 并发探测记录 |

## HK-01 红绿先行

**豁免**（四类之「无法单测的实机验收面」+ 证据治理面）：本波无新行为契约、无产品代码改动——回退/复原/留证/kill 属并发清场；flow 重写属实机取证工具面，其验收即实机断言本身。

## 出口核验（现读）

- `npm run ui:audit:check` exit **0**（清场后；清场前基线 exit 1）
- 4 张已提交 PNG 复原（`git status` 无 `D`）；三文件回到 HEAD（无 M）
- 9223 no listener；主栈 9222/:3000/:3001 存活
- flow 实机 fresh run：**12/12 allPass=true**（`ai-image/live/cultural-watermark-live-darwin.json`，startedAt 2026-11-20T23:23:09Z）+ 3 张路由 PNG 刷新
- 极简版留证可回溯：preserved 包 10 文件 + README 恢复命令

## 诚实边界

- **block463 自执行 flow 遗留问题（他包面，零触碰）**：`dev-verify/flows/block463-workbench-live.cjs` 无 `module.exports` 守卫、模块加载即自执行——run.cjs 装载全部 flows 找 id 时被连带执行（本波两次 verify 相关操作各触发一次：一次 `workspace_route_mounted` FAIL 后重跑 8/8 PASS）。这解释了 `acceptance/block463/*` 在 git status 持续 M 的机制。属他包工具面缺陷，本批不改（零产品代码越界），登记移交。
- AI 版 flow 原始代码在并发窗口被极简方覆盖后丢失，本波 flow 为按 canonical 12 断言证据**复刻**（断言名/顺序/细节与 2026-11-20T13:06Z canonical 证据一致），非原文件恢复。
- 本波未跑全量套件（定向纪律）；docs 六件套回写随 S4 治理归位批统一提交（共享脏 docs 文件携带前批 R2 未提交编辑，避免混入本波 commit）。
