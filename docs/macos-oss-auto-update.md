# macOS OSS 自动更新

最后更新：2026-07-15

## 固定配置

- Bucket：`biof3-uploads`
- Region：`cn-hangzhou`
- Endpoint：`oss-cn-hangzhou.aliyuncs.com`
- 对象前缀：`desktop/updates/macos/`
- 更新清单：`https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/desktop/updates/macos/latest-mac.yml`
- electron-updater provider：`generic`
- channel：`latest`

GitHub Release 继续保存 DMG 供手动下载安装，但应用内更新不再访问私有 GitHub Release。

## 发布文件

每个版本同时生成：

- arm64/x64 DMG：用户手动安装。
- arm64/x64 ZIP：`electron-updater` 在 macOS 上实际下载的更新载荷。
- DMG/ZIP blockmap：差分更新元数据。
- `SHA256SUMS-mac-<version>.txt`：人工下载校验。
- `latest-mac.yml`：更新渠道的原子入口。

带版本号的文件使用 `Cache-Control: public,max-age=31536000,immutable`；`latest-mac.yml` 使用 `no-cache,no-store,must-revalidate`。发布脚本始终先上传不可变文件，最后上传清单，避免客户端看到半发布版本。

## 首次配置 OSS 写权限

本机需要安装阿里云 `ossutil`，并使用最小权限 RAM 用户或 STS 凭据。不要使用主账号 AccessKey，也不要把密钥写进仓库。

建议 RAM 权限仅允许对以下前缀执行列举、上传和覆盖：

```text
acs:oss:*:*:biof3-uploads/desktop/updates/macos/*
```

ossutil 支持标准环境变量：

```bash
export OSS_ACCESS_KEY_ID=...
export OSS_ACCESS_KEY_SECRET=...
export OSS_REGION=cn-hangzhou
export OSS_ENDPOINT=oss-cn-hangzhou.aliyuncs.com
```

发布脚本也兼容项目旧变量 `OSS_AK` / `OSS_SK`，但优先使用官方变量名。

## 固定发布流程

```bash
# 1. 设置新版本号并完成源码验证
npm run release:mac:prepare

# 2. 提交、创建不可变标签并推送
git tag -a v<version> -m "BioF3 Desktop v<version>"
git push origin main v<version>

# 3. 预览 OSS 对象、URL 和上传顺序
npm run release:mac:oss:dry-run

# 4. 上传；脚本会验证工作树干净且标签指向 HEAD
npm run release:mac:oss
```

上传后必须匿名验证 `latest-mac.yml`、两套 ZIP 和两套 DMG 均能通过 HTTPS `GET/HEAD` 访问，并核对清单中的 SHA-512 与本地文件一致。

## 当前阻塞

截至 2026-07-15，本机未找到 `ossutil`、`~/.ossutilconfig` 或 OSS 环境变量，因此尚未对 Bucket 执行写入。源码和产物协议已迁移并完成 dry-run。

macOS 自动安装更新还要求应用使用 Apple Developer ID 签名。当前 RC 未签名、未公证，因此 OSS 更新检查与下载配置可以完成，但正式的应用内替换安装必须在签名/公证就绪后启用。现有 `v0.0.1-rc.2` 仍需手动升级到首个签名且指向 OSS 的后续版本。
