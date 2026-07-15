# macOS OSS 自动更新

最后更新：2026-07-15

## 固定配置

- Bucket：`biof3-uploads`
- Region：`cn-hangzhou`
- Endpoint：`oss-cn-hangzhou.aliyuncs.com`
- 对象前缀：`desktop/updates/macos/`
- 更新清单：`https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/desktop/updates/macos/latest-mac.yml`
- 客户端实现：`src/macos-oss-updater.js`
- 更新方式：自动检查 → 下载匹配架构的 DMG → SHA-512 校验 → 打开安装包

GitHub Release 继续保存 DMG 供手动下载安装，但应用内更新不再访问私有 GitHub Release。

## 发布文件

每个版本生成：

- arm64/x64 DMG：应用按当前 Mac 架构自动选择、下载并打开。
- `SHA256SUMS-mac-<version>.txt`：人工下载校验。
- `latest-mac.yml`：更新渠道的原子入口。

带版本号的文件使用 `Cache-Control: public,max-age=31536000,immutable`；`latest-mac.yml` 使用 `no-cache,no-store,must-revalidate`。发布脚本始终先上传不可变文件，最后上传清单，避免客户端看到半发布版本。

客户端只需要匿名 HTTPS 读取权限，不需要 AccessKey、OSS SDK 或 `ossutil`。Apple Developer 付费账号也不是这个小团队更新流程的前置条件。

由于应用未使用 Developer ID 签名，安装动作不能静默替换正在运行的 `.app`。下载完成后 BioF3 会打开已校验的 DMG，由成员把 BioF3 拖入 Applications 覆盖旧版本；首次打开仍可能需要在“系统设置 → 隐私与安全性”中确认。

## 发布端 OSS 写权限

发布脚本使用项目内的官方 `ali-oss` Node SDK，不需要在系统中安装 `ossutil`。上传时仍需最小权限 RAM 用户或 STS 凭据；不要使用主账号 AccessKey，也不要把密钥写进仓库。

建议 RAM 权限仅允许对以下前缀执行列举、上传和覆盖：

```text
acs:oss:*:*:biof3-uploads/desktop/updates/macos/*
```

发布脚本读取标准环境变量：

```bash
export OSS_ACCESS_KEY_ID=...
export OSS_ACCESS_KEY_SECRET=...
export OSS_REGION=cn-hangzhou
export OSS_ENDPOINT=oss-cn-hangzhou.aliyuncs.com
```

发布脚本也兼容项目旧变量 `OSS_AK` / `OSS_SK`，但优先使用官方变量名。

本机已有的仓库根目录 `.biof3-secrets` 会由 `scripts/publish-macos-oss.sh` 自动加载。该文件必须保持 `chmod 600`，已加入 `.gitignore`，禁止提交或把内容复制到聊天和日志。

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

上传后必须匿名验证 `latest-mac.yml` 和两套 DMG 均能通过 HTTPS `GET/HEAD` 访问，并核对清单中的 SHA-512 与本地文件一致。

## 当前阻塞

截至 2026-07-15，本机未找到 OSS 上传环境变量，因此尚未对 Bucket 执行写入。客户端已改为不依赖签名的“小团队更新”流程，发布端也已移除 `ossutil` 依赖。

现有 `v0.0.1-rc.2` 是修改前构建，仍使用旧更新代码。`v0.0.1-rc.3` 是首个包含新更新器的版本，团队成员需要手动安装这一次；从 `rc.3` 开始，应用可以自行检查 OSS、下载并打开后续 DMG。

本机 Clash Verge 当前使用全局代理模式，阿里云域名在该模式下会被代理节点关闭 TLS 连接；临时规则模式下 OSS 可正常连接并返回标准 HTTP 响应。该问题属于本机代理链路，不改 BioF3 更新协议，也不应由发布脚本自动修改系统代理。真实团队验证应在可直连阿里云的网络环境中执行。
