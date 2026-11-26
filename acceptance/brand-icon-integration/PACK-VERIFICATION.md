# 品牌图标打包验证（PETRI_PACK_PROBE_FALLBACK=1 豁免重跑）

- 裁决：owner/兴奋 msg_6cb5daceda42 授权显式豁免（G1 release 同探针先例、豁免有效性已证）；非 Agent 自行放宽门。
- 打包：`PETRI_PACK_PROBE_FALLBACK=1 npm run build:mac` → BUILD_EXIT=0；产物 `dist/Petri-0.0.4-arm64.dmg`（235MB）+ `dist/mac-arm64/Petri.app` + `dist/mac/Petri.app`（x64）。
- 图标核验：arm64/x64 两 .app 的 `Contents/Resources/icon.icns` SHA256 = `8e4ec22343c997c51ab630da9195c022fc242db436fa474152f5e553a15e615f`，与替换后的 `icons/icon.icns` **完全一致**；Info.plist `CFBundleIconFile=icon.icns`。`app-bundled-icon.png` 为从打包 icns 直接导出（256×256），视觉确认为 B 案（P monogram + 圆角浅米底 iOS 容器）。
- 签名/公证：日志明示 skipped code signing（keychain 无有效 identity）+ skipped notarization（APPLE_ID 等未设）——与 G0/G1 既有口径一致，不伪造签名证据。
- 新发现（诚实记录，不擅改）：packaged 模式 `resolveResource('icons',...)` 指向 `process.resourcesPath/icons/`（env-coordinator.js:47-52），但两 .app 的 Resources 下**无 icons/ 目录**——`icon-tray-template.png`/`icon-tray.png`/`icon.png` 均未随包复制；tray 图标在打包版会走兜底路径且文件不存在。需单独修 afterPack 资源复制（另立工作包），本次不改（令只要打包图标验证结果）。
- owner 验证：dev 重启 Dock 图标更新由兴奋执行；我零触碰 owner 实例。

## 补验（msg_22bba0ea1f99 tray 资源复制修复后）

- 修复：`build/afterPack.js` 加 `icons/` 全套 `cpSync` → `Resources/icons`（4.2MB，含 tray template/icns/ico/iconset）；HK-01 `test/icons-pack-resources.test.mjs` 红 1/2→绿 2/2。
- 重跑：`PETRI_PACK_PROBE_FALLBACK=1 npm run build:mac` → BUILD_EXIT=0；`dist/mac-arm64/Petri.app/Contents/Resources/icons/` 下确认 `icon.png` / `icon-tray.png` / `icon-tray-template.png` 三候选全部存在（修复前该目录不存在）。签名/公证仍 skipped（无 identity/未设 APPLE_ID），与既有口径一致。
