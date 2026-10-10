# M2-11 (H4)：mac 签名 + notarization CI 配置

> 延后参考：当前用户明确不购买 Apple Developer 账号，macOS 使用未签名 DMG + OSS 小团队更新流程。本文件只有在未来重新启用 Developer ID 签名/公证时使用。

## 前置条件

- Apple Developer 证书（Developer ID Application）导入 keychain
- App-specific password（for notarization API）
- Apple Team ID

## CI 环境变量（GitHub Actions Secrets）

| Secret | 说明 |
|--------|------|
| `APPLE_ID` | Apple ID 邮箱（如 dev@petri.com） |
| `APP_PASSWORD` | app-specific password（appleid.apple.com 生成） |
| `NOTARIZE_TEAM_ID` | Apple Team ID（如 ABCD123XYZ） |
| `CSC_LINK` | 证书 base64（keychain 导出 .p12 → base64） |
| `CSC_KEY_PASSWORD` | .p12 密码 |

## 本地构建（无证书）

不设上述环境变量时，`identity: null` + afterSign 跳过 notarize，产出未签名 dmg（用户需右键打开）。

## CI 构建签名版

```yaml
# .github/workflows/build-mac.yml
jobs:
  build:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - run: cd desktop-app && npm install
      - name: Build + sign + notarize
        env:
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APP_PASSWORD: ${{ secrets.APP_PASSWORD }}
          NOTARIZE_TEAM_ID: ${{ secrets.NOTARIZE_TEAM_ID }}
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
        run: cd desktop-app && npm run build:mac-arm64
      - name: Validate staple
        run: xcrun stapler validate desktop-app/dist/*.app
```

## 验证

签名 + notarized 的 dmg 在干净 Mac 上双击不弹"无法打开"：
```bash
xcrun stapler validate desktop-app/dist/Petri.app
spctl -a -vvv desktop-app/dist/Petri.app  # 应显示 "accepted"
```
