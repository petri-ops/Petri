# Code signing policy — 前置件证据

日期：2026-11-27
公开 URL（默认分支 main）：https://github.com/petri-ops/Petri/blob/main/docs/releases/code-signing-policy.md

## 改动清单

- `docs/releases/code-signing-policy.md`（新增）：H1 精确为 `# Code signing policy`；正文第 3 行精确为 `Free code signing provided by SignPath.io, certificate by SignPath Foundation`。英文正文说明 Petri Desktop 使用 SignPath 做 Windows 代码签名、签名仅覆盖官方 GitHub Release / 官方 OSS 下载渠道产物、其他渠道包不受保护、发布流水线基于 GitHub Actions；附中文翻译。
- `docs/DOC-REGISTRY.json`：新增登记 `CODE-SIGNING-POLICY`（kind=reference / status=reference / canonical=false / retain_stable_path）；`docs:coverage` 重算 documentCount 674→675、managedMarkdown 657→658、lastUpdated 2026-11-27。
- `README.md`：新增 Signing 段，链接到策略页。
- `docs/README.md`：新增 512s 索引条目，链接到策略页。
- `test/impact-map.json`：①`governance-docs` 规则补 `README.md` pattern——根 README 改动此前未被任何规则覆盖，`test:changed` 会以 exit 2 fail-closed（本批实际抓到）；②新增 `code-signing-policy` 规则认领 `acceptance/code-signing-policy/**`（证据目录零漏测）。
- `test/impact-map-coverage-baseline.json`：移除已被规则覆盖的存量条目 `test/clipboard-ipc.test.mjs`（W5a 棘轮只减要求，顺笔清债）。

## 精确措辞核验

```
docs/releases/code-signing-policy.md:1:# Code signing policy
docs/releases/code-signing-policy.md:3:Free code signing provided by SignPath.io, certificate by SignPath Foundation
README.md:62:...[Code signing policy](./docs/releases/code-signing-policy.md)...
docs/README.md:1:512s. [`code-signing-policy.md`](./releases/code-signing-policy.md) — ...
```

## 门禁与测试（当次实跑）

| 命令 | 结果 |
| --- | --- |
| `npm run docs:check` | PASS（675 registered documents） |
| `npm run ui:audit:check` | PASS（同步检查通过） |
| `npm run quality:secret` | PASS |
| `npm run quality:arch` | PASS（R1-R5 无违规） |
| `npm run quality:lint` | EXIT 0（0 errors，2518 warnings 为存量） |
| `npm run quality:types` | EXIT 0 |
| `npm run quality:knip:check` | PASS（424 键冻结，无新增） |
| `npm run test:changed` | EXIT 0；42 tests / 40 pass / 0 fail / 2 skip（P6 源绑定证据腿按 win32 平台门诚实 skip） |

`test:changed:list` 分类：changed=6 / nodeTests=5 / unknown=0。

## 边界

- 零触碰 `build/afterPack`、凭据段、`copilot/**`、`workspace-panels/**`。
- 未改任何产品代码与签名实现；页面只陈述签名策略，不伪造签名证据、不翻转任何 `supported` 字段。
- 未 push、未提交，改动留在本工作区待 coordinator 处置。
