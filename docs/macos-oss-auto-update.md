# macOS OSS 自动更新

最后更新：2026-08-16（GATES-4 单行修订：rc.6 历史标注 + 当前基线 rc.7 指针）

## 固定配置

- Bucket：`biof3-uploads`
- Region：`cn-hangzhou`
- Endpoint：`oss-cn-hangzhou.aliyuncs.com`
- 对象前缀：`desktop/updates/macos/`
- 更新清单：`https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/desktop/updates/macos/latest-mac.yml`
- 客户端实现：`src/macos-oss-updater.js`
- 更新方式：自动检查 → 下载匹配架构的 DMG → SHA-512 校验 → 打开安装包

GitHub 只保存源码与不可变标签，不再保存桌面软件资产。DMG、人工校验文件和应用内更新清单统一由 OSS 分发。

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

大于百 MB 的 DMG 默认使用 10 分钟上传响应超时和 10 MiB 分片；网络较慢时可通过
`BIOF3_OSS_UPLOAD_TIMEOUT_MS` / `BIOF3_OSS_UPLOAD_PART_SIZE` 临时调大，不能绕过版本、标签、清单或 SHA 校验。

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

## 当前状态与保留限制

截至 2026-07-19，发布端已从本地 `.biof3-secrets` 安全加载 OSS 凭据并成功发布 `rc.3`、`rc.4`、`rc.6`。客户端只做匿名 HTTPS 读取，不需要 OSS SDK、AccessKey 或 `ossutil`。

Clash Verge 已固定为规则模式：阿里云 OSS 域名直连，OpenAI/Codex/GitHub 继续代理。错误的前置 `MATCH,DIRECT` 已移除；清单读取、DMG 下载与发布上传均验证成功，不再需要发布时手工切换代理模式。

保留限制只有 macOS 签名方式：当前没有 Developer ID 签名和 Apple 公证，应用不会静默覆盖安装。下载与 SHA-512 校验完成后会打开 DMG，由成员手动拖入 Applications。

## 2026-07-15 rc.3 发布结果

- 用户在可连接阿里云 OSS 的网络模式下执行 `npm run release:mac:oss` 成功。
- 上传顺序确认：arm64 DMG → x64 DMG → SHA-256 清单 → `latest-mac.yml`。
- 脚本最终输出 `complete`，用户端测试更新地址可用。
- Codex 所在的 Clash 全局模式仍会阻断阿里云 TLS，因此没有把该环境下的二次读取记为成功验证。
- GitHub 后续只同步源码；桌面 DMG 和自动更新清单统一放 OSS。`rc.3` 的 GitHub Release 草稿及中断上传的资产已删除，Git 标签保留为源码检查点。

`rc.4` 修复检查最新版本时没有任何反馈的问题：设置页成功检查且没有更高版本时显示“当前已是最新版本”。同时更新弹窗不再声称应用会自动重启，而是准确提示下载、校验并打开 DMG。

## 2026-07-15 rc.4 升级验收

- 线上 `latest-mac.yml` 已确认指向 `0.0.1-rc.4`，arm64/x64 DMG 与 SHA-256 清单均已上传。
- 隔离启动真实 `rc.3` 打包应用，通过其正式 IPC 检查更新，返回 `hasUpdate=true` 并正确选择 `BioF3-0.0.1-rc.4-arm64.dmg`。
- 下载文件大小为 197,172,657 字节，与清单一致；SHA-512 与清单一致。
- `updater:install` 成功打开并挂载 `BioF3 0.0.1-rc.4-arm64`，挂载包内版本确认为 `0.0.1-rc.4`。
- 验收使用复制出的临时应用与临时 `BIOF3_LOCAL_DATA_DIR`，不覆盖正式安装；结束后已清理临时进程、应用、local data 与挂载，并恢复 `/Applications/BioF3.app`。

## 2026-07-19 rc.6 发布与升级验收

- main、`origin/main` 与不可变标签 `v0.0.1-rc.6` 的发布提交一致（`907b695`；rc.6 历史节点；当前 OSS 基线为 `v0.0.1-rc.7`，发布提交 `ab519fa`，见 `releases/v0.0.1-rc.7.md`）。
- 上传顺序为 arm64 DMG → x64 DMG → SHA-256 清单 → `latest-mac.yml`，脚本输出 `complete`。
- 匿名清单指向 `0.0.1-rc.6`；人工 SHA-256 与本地最终产物一致。
- 使用正式更新器从 `rc.4`/arm64 视角返回 `hasUpdate=true`，选择 `BioF3-0.0.1-rc.6-arm64.dmg`。
- 公开下载大小为 `194522883` bytes，更新器的大小与 SHA-512 校验通过。
- DMG 校验后只读挂载；包内版本和 build version 均为 `0.0.1-rc.6`，主可执行文件为 arm64。
- 未覆盖 `/Applications/BioF3.app`，保留 rc.4 作为回滚点；未签名 RC 继续由成员手动拖入 Applications。
