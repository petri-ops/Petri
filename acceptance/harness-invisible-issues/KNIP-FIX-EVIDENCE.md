# CI knip-ratchet 3 处新增修复证据（item 44 · 2026-11-25）

> 来源：兴奋裁决 B（msg_9726ba7fa86d），授权跨线修 CI run 45583596913 的 knip-ratchet FAIL。
> 基：`origin/main = 42b9a7399`（起分支前 fetch 实测）；独立 worktree `knipfix`，分支 `petri-ops/ci-knip-fix`。
> 三处分诊均非 harness 集成引入（兴奋认可）：2 处 WATERMARK 文件本次未改（存量），settings-speech 是 item 40 提交 `2f90c8518` 新增。

## 三处处置

| 项 | 判定 | 处置 |
|---|---|---|
| `exports::.../watermarkImage.ts::WATERMARK_IMAGE_TYPES` | 同文件 `:20` 有 `includes()` 引用、**无外部 import**（全仓 grep 排除定义文件后为空）；上限/校验逻辑真实生效 | 去掉 `export` 关键字（只收窄对外暴露，行为零变化），**不上调基线** |
| `exports::.../watermarkPrefs.ts::WATERMARK_CUSTOM_MAX_CHARS` | 同文件 `:88/:110` 用做 2MB 缓存上限、**无外部 import**（真缺口已排除，上限确实生效） | 同上，去掉 `export`，不上调基线 |
| `files::.agents/.../dev-verify/flows/settings-speech-section.cjs` | item 40 语音独立成区实机验证脚本，按 BLOCK-517 W3/W4/W5 同类 flow 先例定性为动态入口 | **不删文件**；按先例登记 knip 上限：`test/knip-baseline.json` keys 420→421、growAllowances 14→15，reason 带 item40 + BLOCK-517 同根留因 |

## 验证

- 两处 WATERMARK 去 export：主工作区 typescript `transpileModule` 验证 2 文件 syntaxErrors=0；同文件引用仍在（IMAGE_TYPES.includes ×1、CUSTOM_MAX_CHARS ×3），行为零变化。
- knip 基线 diff 实证：只多 settings-speech 一条 key + 一条 allowance，其余逐字不变；两处 WATERMARK export 不入基线（去 export 后不再产生死 export key）。
- **本地 knip 全量检查不可信**：本 worktree 无 node_modules，软链主工作区 node_modules 后 knip 扫出 283 处新增（主工作区有大量未跟踪文件，读数与 CI 不一致）——正如兴奋提醒「以干净工作区读数为准」，故未据此跑 `--update` 污染基线，改用精确手动登记。CI 干净环境扫描才是真值。
- 零新依赖；观感零代签；未碰任何未跟踪文件（含主工作目录 flows / 主人稿件）；owner dev 实例零触碰。

## 边界

修完后继续盯 CI。后续静态门红：存量且机械可修的（基线登记/多余 export/台账同步）可直接修、每笔留因；涉及行为/依赖/别人未推的活则回报兴奋。
