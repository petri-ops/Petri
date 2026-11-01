---
capability: block-326-audit-debt-sweep
status: completed
goal: AUDIT-LOG 在案 🟡 工程债清偿批（五项，修法均已在案、无需产品裁决）：①server.js 信号 teardown 只关库不退出；②四个 dev-verify flow 缺 id 导出致 --list 必红；③npm run state 对 living-plan 漏报 active 槽位 + BLOCK-322 registry 状态漏翻转；④block322-p3-constraints-live C6 判据过时（mate 已入白名单）；⑤decision-api no_key 早退不落账（next:suggest 实跑台账不可见）。
acceptance:
  - ①SIGTERM 后进程退出：捕获 httpServer，teardown 关库→server.close→exit(0) 带超时兜底；回归测试（spawn 真实 server + SIGTERM + 限时退出断言）。
  - ②四 flow 补 id/description/evidenceDir 导出（对齐 README 契约），npm run verify -- --list 可跑。
  - ③workspace-state 把 living-plan+active 纳入 active 槽位展示（注 kind）；BLOCK-322 registry status active→completed（2026-10-31 终局判定漏回写）。
  - ④C6 夹具改真不在白名单的 kind（bond），断言对齐现文案（align/distance/angle/mate）。
  - ⑤decision-api !config 早退路径补 degraded 落账（point 透传时）；测试：no_key 调用产生 decision_log 行。
  - closeout 十一门 + 台账回写（对应 🟡 条目翻 ✅）。
reopen: mac mp4 外部 ffmpeg 合成 / dev-verify 证据文件名平台化（需用户裁决，留在 🟡）；R 运行时 UI-526 补腿（需授权下载）。
---

# BLOCK-326-AUDIT-DEBT-SWEEP — 审计台工程债清偿批计划

- 立项裁决：用户 2026-11-01「继续冲 搞完」（C-35~C-44 池经核实已全清，本批=剩余可行动队列）
- 唯一真相域：本文件（block-326-audit-debt-sweep）
- 状态：completed（2026-11-01 当日收口。证据：回归 5/5（SIGTERM 真进程退出 + --list + state + C6 源码 + no_key 落账）+ closeout 十一门 PASS；AUDIT-LOG 对应五条 🟡 已移入处理记录。不含需裁决项如实留 🟡。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 定位

五项全部来自 AUDIT-LOG 在案 🟡（修法已在案、非阻塞、纯工程面），收口后对应 🟡 条目翻 ✅。**不含**需用户裁决/外部条件项（mac ffmpeg、平台证据文件名、R 下载授权——留在 🟡 如实）。

## 2. 清单与落点

| # | 条目 | 落点 | 修法 |
| --- | --- | --- | --- |
| ① | SIGTERM 不退出（2026-11-01 🟡） | `core/petri-server/server.js` installBackendExitLifecycle + `app.listen` | 捕获 httpServer；teardown 关库→`httpServer.close(()=>exit(0))`→2000ms 超时兜底 `exit(0)`；回归测试 spawn 真进程 |
| ② | verify --list 必红（2026-10-30 🟡） | flows/{b264,b266,b268,b269}*.cjs | 各补 `id/description/evidenceDir` 导出 |
| ③ | state 漏报 living-plan（2026-10-30 🟡） | `.agents/.../scripts/workspace-state.mjs` + DOC-REGISTRY | active 槽位纳入 living-plan（注 kind）；BLOCK-322 status→completed（收口漏回写，根因修复） |
| ④ | C6 判据过时（2026-10-31 🟡） | `flows/block322-p3-constraints-live.cjs` | 夹具 kind mate→bond；断言文案对齐 scene3d.js:421 现值 |
| ⑤ | next:suggest 不落账（2026-10-30 🟡） | `core/petri-server/helpers/decision-api.js` !config 早退 | 补 degraded 落账（point 透传时），实跑次数台账可见 |

## 3. 非范围

mac ffmpeg 合成、dev-verify 证据文件名平台化、R 运行时下载、G1+ 各项——留 🟡/G1+ 如实。
