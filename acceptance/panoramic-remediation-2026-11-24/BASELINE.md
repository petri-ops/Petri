# BLOCK-511 · S0 基线红绿记录（2026-11-24）

> 基线 HEAD `5ad65367`（`main...origin/main`）。串行槽位空、工作树无他人未提交跟踪改动（19 项未跟踪 WIP 属他包/用户资产，零触碰）。
> 原始门输出：`baseline/*.log`（被 `.gitignore` 的 `*.log` 排除，仅本会话留档）；本表为可入库摘要。

| 门 | 退出码 | 读数/归属 |
|---|---|---|
| docs:check | 0 | PASS (665→立项后 666) |
| ui:audit:check | 0 | PASS |
| hygiene:check | 0 | PASS |
| quality:secret | 0 | PASS |
| quality:arch | 0 | PASS |
| quality:lint | 0 | PASS |
| quality:types | 0 | PASS |
| quality:knip:check | 1 | FAIL：2 处新增死代码 `exports::src/ipc/utility-host.js::ACTIVE`、`shutdownUtilityHosts`（存量，待 S2 归属） |
| gate:css-modules | 0 | PASS |
| gate:arch-cycles | 0 | PASS |
| gate:code-size | 1 | FAIL 7 行：SimpleChat.tsx 1952>1944（行数+指纹）、simple-chat.css 5494>5469（行数+指纹+字节 133453>132770）、src/main.js 925>920（行数+指纹）。QODER-A2/L5 11-23 增长未重打基线，本包 S1/S2 清 |
| test:changed:list | 0 | PASS（影响范围解析） |
| test:changed | 0 | PASS（Node 228/228 + 前端 CulturalWatermark 6/6） |
| W5a（nso-w5-impact-coverage） | 1 | FAIL 1/3：`p6-driver-iframe-probe` / `p6-pack-scheme-privileges` / `utility-host-decision` 三测试未挂规则（存量，本包 S2.1 清） |

## 决策工具（S0）

- `npm run doc:suggest -- --supply=cloud`：suggestions=`["planDoc"]`（plan 文档已随 S0 立项写好，属增量附加已满足）。roadmap/handoff/uiAudit/auditLog 均 suggested=false。
