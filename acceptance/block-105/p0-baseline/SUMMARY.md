# BLOCK-105 P0 体检基线报告（2026-09-20）

> 只读体检 · 零产品代码改动 · 零依赖变更（Knip/jscpd 经 npx 一次性运行）。
> 本报告是 P1（lint 层）/P2（存量归因）的豁免基线与规则强度依据。

## 1. 密钥快扫（secret-scan.txt）

- 命中 14 处，**全部位于 test/ 下的 fixture**（假密钥如 `sk-abcd***`、redaction 脱敏测试、loop 合同测试桩）；
- 生产面（src/ core/ scripts/）**零真实密钥**；唯一 PRIVATE KEY 模式命中是 `g0-baseline-qualification.js` 的检测正则本体（非密钥内容）。
- **结论：干净。** P1 的 Gitleaks 门禁可直接以当前状态为基线。

## 2. 依赖漏洞采样（audit-root.json / audit-frontend.json）

### 根工作区：20 条（critical 1 / high 14 / moderate 5）
- **新发现（不在在册 🟡 批次内）：electron-builder 工具链族 9 条 high + 1 条 critical（tar hardlink 路径穿越）**——`fixAvailable=YES(electron-builder@26.15.3)` 一键可修，属构建工具链（不进运行时产物），修复批次可独立裁决，不必等 Mac 侧 P6 同批；
- **extract-zip high 无修复路径**（直接依赖 ^2.0.1，用于 `src/plugin/zip.js` 插件包解压）——需评估迁移到其它解压库或加防御层，登记 P2 归因；
- 其余（brace-expansion/js-yaml/fast-uri/glob 等）均为工具链传递依赖，audit 修复路径明确。

### 前端工作区：12 条（critical 2 / high 4 / moderate 6）
- 与在册 🟡 批次（AUDIT-LOG 2026-09-19）一致：vite（fix=8.3.0 跨大版本）/ vitest（fix=5.0.1 跨大版本）/ happy-dom（**新信息：fix=20.14.5 为小版本**，在册描述「跨 minor 破坏标记」确认仍需走破坏批次）；
- 维持「与 P6 重打同批」裁决不变，本包不扩失配面。

## 3. 死代码采样（knip.json）——⚠️ 未配置原始基线，噪音极大

- 864 文件有发现：死导出 1052 / 死文件 452 / 未列出依赖 172 / 死类型 164 / 死 devDependencies 3；
- **误报性质明确**：无配置默认扫描把 `src/preload.js`、`frontend/vite.config.ts`、`frontend/vitest.config.ts` 等关键入口都标为死文件（Knip 不识 Electron/多入口形态）；
- 分区计数：core 815 / frontend 732 / scripts 174 / src 74；
- **P1 动作**：先写 knip 配置（入口=src/main.js、frontend/src/main.tsx、preload、测试 glob），校准后重扫才是真家底；当前数字只作规模感知，不得直接当清偿清单。

## 4. 重复率（jscpd/jscpd-report.json）

- 扫描 src + core + frontend/src（javascript/typescript）：**152,465 行中 4,093 行重复 = 2.7%**，395 克隆簇——整体健康（<3% 惯例良好线）；
- **热点（实证既有架构候选）**：
  - `loop-orchestrator.js ↔ routes/ai-agent/chat.js` ~167 行
  - `agent-runner.js ↔ routes/ai-agent/chat.js` ~125 行
  （BLOCK-102/104 登记「loop-orchestrator/tools-executor 拆分、chat 编排耦合」候选的数据实证，归独立重构工作包）
  - 同文件内部重复：workspace-tools.js / plans.js / site-snapshot.js（可提本地函数）；
  - `useBranchStore.ts ↔ useResultStore.ts` ~96 行（前端 store 模板同构，评估抽 factory）。

## 5. 汇总与 P1 建议

| 维度 | 规模 | 状态 | 后续 |
| --- | --- | --- | --- |
| 密钥 | 0 真实命中 | ✅ 干净 | P1 Gitleaks 直接门禁化 |
| 依赖漏洞 | root 20 / frontend 12 | ⚠️ | electron-builder 族可独立小批修；extract-zip 归 P2；前端批次维持 P6 同批裁决 |
| 死代码 | 864 文件（高噪音） | ⚠️ 未校准 | P1 先配 knip 入口再重扫 |
| 重复率 | 2.7% | ✅ 健康 | 热点归架构重构候选，本包不清偿 |

## 附：体检命令（可复现）

```bash
npx --yes knip@latest --reporter json --no-exit-code > knip.json
npx --yes jscpd@latest src core frontend/src --min-tokens 50 --reporters json --output jscpd --silent --format "javascript,typescript"
npm audit --json > audit-root.json
npm --prefix frontend audit --json > audit-frontend.json
git grep -nIE "(sk-…|ghp_…|AKIA…|BEGIN …PRIVATE KEY|api[_-]?key…)" -- ':!package-lock.json' ':!frontend/package-lock.json'
```
