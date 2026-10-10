# BLOCK-165 P0 基线快照（2026-10-10，干净树 @ e7575767）

## 旧名存量
- gewu 文件数: 596
- biof3 文件数: 1309
- 路径含旧名跟踪文件: 382
- 总命中次数: 27779

## 四基线键数
test/impact-map.json topKeys=3 bytes=156147
test/knip-baseline.json topKeys=5 bytes=18808
eslint-suppressions.json topKeys=136 bytes=19472
test/startup-perf-budget.json

## test:changed:list
  "syntax": [],
  "unknown": [
    "acceptance/block-165/p0-baseline.md"
  ],
  "reasons": {
    "acceptance/dev-verify/app-health-live.json": [
      "dev-verify-probe-evidence"
    ]
  }
}
[test:changed] 分类冲突：1 个改动文件未被 test/impact-map.json 任一规则覆盖；exit 2 表示需要补 rule，**不是** fail-closed。
[test:changed] 未映射文件：acceptance/block-165/p0-baseline.md

## closeout 十一门基线（2026-10-10 干净树 @ e7575767 + 对账修复）

| 门禁 | 结果 | 备注 |
| --- | --- | --- |
| hygiene:check | PASS | 符号链接桥全真 symlink |
| docs:check | PASS | 314 文档（163 registry/plan 陈旧 active 已对账翻 completed） |
| ui:audit:check | PASS | 440 编号；b784fa3 漏登按先例补登 UI-484+豁免登记 |
| test:changed | PASS | impact-map 补 block165-rename-evidence 规则后绿 |
| gate:code-size | **存量红（非本包）** | DesktopSettingsPanel 685>672（+13=BLOCK-163 P9/P10 设置面面板）与 PluginStorePanel 526>495（+31=BLOCK-158 商店退役+163 P7 更新徽标）指纹漂移+超基线，git log 归因在案；重锚统一推迟到 P3 改名后一次 --write |
| gate:arch-cycles | PASS | 14 存量环在册无新环 |
| gate:css-modules | PASS | 白名单 13 |
| quality:secret | PASS | fixture 命中为测试夹具 |
| quality:arch | PASS | 1402 模块无违规 |
| quality:lint | PASS* | 有 suppressions leftover 提示（路径键改名后将统一 --suppress-all 重扫） |
| quality:types | PASS | tsc 0 |
| quality:knip:check | PASS | 保留面 240 键冻结 |

## 基线四件（改名后重锚对照）

- test/impact-map.json topKeys=3 rules=160（本次 +1）
- test/knip-baseline.json topKeys=5 / 240 保留键
- eslint-suppressions.json topKeys=136
- code-size 台账：漂移 2 文件待 P3 重锚
