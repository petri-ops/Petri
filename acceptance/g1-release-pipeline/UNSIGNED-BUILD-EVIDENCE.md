# G1 六序⑥前半 · 未签名打包发布流水证据（2026-11-25）

> 发令：Orca bb8dddaf msg_c0b92aa5abb1（owner「继续按计划推进」，依据「签名/公证不是 G1 硬门」）。
> 纪律：未签名/unsigned 如实标注不伪造签名状态；supported 维持等证书挂账；公证/Windows/真人投放不碰；owner 3000/3001/9222 零触碰。

## §1 核码真源（现成设施，不造第二套）

| 能力 | 现成设施 | 结论 |
|---|---|---|
| mac 打包 | `package.json:36 build:mac = prebuild + build:all + electron-builder --mac --arm64 --x64` | 复用 |
| 未签名形态 | `electron-builder.yml:33 identity: ${CSC_NAME:-null}` | CSC_NAME 未设 → identity:null（unsigned/ad-hoc），符合裁决 |
| ABI 守卫 | `build/afterPack.js:39 probeNativeLoad` / `:88 fail-closed` | 复用；BLOCK-377 安全门 |
| 打包冒烟 | `scripts/block353-packaged-check.mjs`（结构/空数据启动/T2 任务） | 复用 |
| 发布流水 | `release:mac:prepare` / `release:mac:oss:dry-run` / `release:checksums` / `scripts/publish-macos-oss.mjs`（--dry-run/--prepare-only 不上传） | 复用 |
| 历史产物 | `dist/Petri-0.0.1~0.0.4-arm64.dmg` + `acceptance/block-353/packaged-regression.json` | 基线参考 |

## §2 首跑/二跑失败与根因（如实记录，不掩盖）

- `npm run build:mac`（CSC_NAME 未设）两次失败在 afterPack 的 ABI 探针 fail-closed：`ABI 实测探针不可用且未设 PETRI_PACK_PROBE_FALLBACK=1` → better-sqlite3 `bin/darwin-arm64-149/better-sqlite3.node`。
- 根因核真：手动以两个候选探针（`Petri Helper`、node_modules Electron）在 `ELECTRON_RUN_AS_NODE=1` 下 `require` 该 addon，**均 exit=0 / OK**（ABI 149 匹配），故不是 ABI 真不匹配；是 afterPack 时机探针二进制不可用（PROBE_UNAVAILABLE，非 ABI_MISMATCH）。材料注释明确 `PETRI_PACK_PROBE_FALLBACK=1` 是给"探针基础设施缺失的受控场景"的登记制豁免口。

## §3 显式豁免登记（按材料要求）

- 豁免项：`PETRI_PACK_PROBE_FALLBACK=1`，仅用于本次未签名打包流水验证（CI/正式发布不默认开启）。
- 原因：afterPack 时点探针不可达（手动复测两个候选均可加载 addon、ABI 149 匹配），属探针基础设施时机问题，非 ABI 不兼容；采用首候选后**必须由产物冒烟实测证明** addon 在打包后端真加载（不加证明则豁免不成立、构建结论不采信）。
- 风险与回退：若冒烟发现 ERR_DLOPEN_FAILED/ABI 不一致 → 本豁免结论作废，修探针基建后重跑，不用豁免硬凑绿。

## §4 构建/冒烟/发布基线（随验证进度填写）

**构建（显式豁免后 exit=0）**：`PETRI_PACK_PROBE_FALLBACK=1 npm run build:mac`（CSC_NAME 未设）成功——x64 `dist/Petri-0.0.4.dmg`（251,277,658 B / sha 93756cb7…）+ arm64 `dist/Petri-0.0.4-arm64.dmg`（246,011,573 B / sha 36180e48…），均 ~240MB；日志明确 `skipped macOS application code signing reason=Identity name is specified, but no valid identity… allIdentities=0`（unsigned/adhoc 如实）+ `skipping notarization`（APPLE_ID 等未设）。

**产物签名实测**：`codesign -dv dist/mac-arm64/Petri.app` → `Signature=adhoc`（G1 期未签名形态基线，不伪造签名状态；`supported` 字段维持等证书挂账，按既有裁决）。

**隔离冒烟 PASS**（`node scripts/g1-release-smoke.mjs` → `acceptance/g1-release-pipeline/smoke.json`）：打包 addon 在打包 Electron helper（ABI 149）实测 `OK 149 function`=豁免成立（首候选正确，非"没测过伪装测过"）；迁移 24 文件/33 表；打包后端隔离端口 3105 + 临时数据目录启动，`/api/health` **200**（readiness/liveness true、db_ok true、supervisorSnapshot 在场）；SPA `/` 404 = 后端 server.js 不服务静态前端（Electron main file:// 提供，block353 另测 SPA），非产品缺陷；owner 3000/3001/9222 PID 未变（87539/87617/87762）、3105 已清理、临时数据目录已删。不跑 T2 真实 provider（属 G1 序列4 W4 外部依赖，仍挂账）。

**发布流水 dry-run PASS**（`npm run release:mac:oss:dry-run` exit=0）：4 产物 would upload（2 dmg + SHA256SUMS-mac-0.0.4.txt + latest-mac.yml），**零实际上传**。

**checksums 闭环**：`npm run release:checksums` 生成 `dist/SHA256SUMS.txt` → `npm run release:checksums:verify` exit=0（all entries match；mac 专用 SHA256SUMS-mac-0.0.4.txt 由 dry-run 流程另产，两用途不混）。

**G1 期基线（非承诺）**：dmg ~240MB；打包后端 boot→health 200 约 1.3s（09:51:40.9→41.8）；启动/体积基线仅记录，不升格为发布承诺。
