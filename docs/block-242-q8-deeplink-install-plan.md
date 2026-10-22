---
capability: q8-deeplink-install
goal: 建立 `petri-install://` 深链安装安全面——支持领域包（pack）与 MCP 配置（mcp）两种安装链接；预览只读展示名称/来源/下载地址/大小/SHA-256/风险与替换警告，用户确认后才下载安装；包 sha 双验，MCP 配置禁止携带 env 值。
acceptance:
  - `petri-install://pack?manifest=<https-url>` 与 `petri-install://mcp?config=<base64url-json>` 均可解析；非 https、私网主机（测试可显式放行）、超长/超大载荷被拒。
  - 预览只读：pack 显示 packId/名称/版本/来源/manifest URL/下载地址/大小/SHA-256/风险原因/替换警告（同名包、MCP id 冲突）；mcp 显示 id/传输/命令或 URL/替换警告；env 字段一律拒绝。
  - 确认时重新取 manifest 并与预览快照对账（download URL/sha256/sizeBytes 任一变化即 `manifest_changed` 拒绝）；下载有大小上限与超时，sha256 校验通过后才解压安装；包安装复用 `pack-lifecycle.installPackWithRuntimes`。
  - MCP 安装：未勾选「允许替换」时 id 冲突拒绝；勾选后才 upsert；无 env、`autoConnect=false`；安装结果如实报告（包成功/MCP 失败分列）。
  - OS 协议：`app.setAsDefaultProtocolClient('petri-install')`（测试实例跳过）；second-instance/open-url/冷启动 argv 提取为纯函数并单测；扩展页提供「从链接安装」粘贴入口（同一预览/确认流程）。
  - 测试：core 单测（守卫/预览/确认/替换/env 拒绝）+ 前端弹层组件测 + 隔离 9223 live（mock manifest/zip → 预览 → 确认 → 真实 pack 安装 + MCP 合并 + 亮/暗截图）；closeout 十三门 PASS。
reopen: packaged 真机外部点击唤起（G1+）、代码签名/公证、远程目录与来源 allowlist、运行时自动安装接审批（随 Q1）、包签名（PGP/开发者签名）与信任链、多 pack manifest 选择。
status: completed
---

# BLOCK-242 · Q8 深化：`petri-install://` 深链安装安全面

> 用户裁决：2026-10-22「按照建议开 242深链安装安全面 一次整完」。
> 前置：BLOCK-158 商店面退役后分发通道=领域包 + 运行时；`src/plugin-manager.js#installPlugin` 已有 sha256/size 校验；`src/pack-lifecycle.js#installPackWithRuntimes` 是包安装执行体。

## 1. P0 实码勘察（2026-10-22，只读实测）

| 面 | 当前证据 | 结论 |
| --- | --- | --- |
| 安装执行体 | `pack-lifecycle.installPackWithRuntimes(dataDir, packRoot)`（pack.json 契约 + 可装载性硬证据）；`installPlugin({id,manifest})` 下载时校验 sha256/size | 深链确认后可复用，不新建安装器 |
| 远程清单 | `plugin/manifest-source.getRemoteManifest()` 已随 BLOCK-158 退役（只读 `resources/runtime/manifest.json`） | 深链引入**新**的受控 manifest 读取面（只读、有界、可拒） |
| OS 协议 | `grep setAsDefaultProtocolClient` 零命中；`second-instance` 仅 focus 主窗 | 需新增 `petri-install://` 注册与 argv/open-url 提取 |
| 主→渲染事件 | `webContents.send` + preload `on` 包装 + `channels.js` 单一注册表（双向漂移测试守护） | 新增 `install:*` 三通道即可 |
| 安装校验 | `assertAllowedUrl` + `assertArtifactChecksumDeclared` + `streamingSha256`（plugin-manager） | 深链 manifest 必须声明 sha256；下载后复核 |
| MCP 配置 | `mcp-settings.upsertMcpServer`（env 密文落盘）+ `listMcpServers` | 深链 MCP 只允许 id/transport/command/args/url；**禁止 env**（凭据不进链接） |
| 扩展页入口 | `/extensions` 四货架 + 头部标准件 | 加「从链接安装」粘贴入口（与 OS 推送共用弹层） |

**P0 结论**：本轮新增深链协议与安全预览层；安装执行全部复用现有 pack/runtime/MCP 通路，零新依赖（zip 用既有 `extract-zip`/`archiver`）。

## 2. 范围与阶段

| 阶段 | 内容 | 出口断言 |
| --- | --- | --- |
| **P1 安全核心** | `src/main/install-deep-link-core.js`（electron-free）：解析 pack/mcp 两种链接；https/私网/长度/超时/manifest schema/sha 格式守卫；预览摘要与风险/替换警告；确认时重取对账 + 下载大小/sha 双验 + 注入式安装/MCP upsert | core 单测全绿（含恶意用例） |
| **P2 接线** | `src/main/deep-link-protocol.js`（协议注册/argv/open-url/待发送队列）+ `src/ipc/install-deep-link.js`（preview/confirm handlers）+ `channels.js`/`preload.js`/`desktopBridge` | 通道漂移测 + 协议提取单测 |
| **P3 UI** | 全局 `InstallDeepLinkDialog`（字段/风险/替换警告/允许替换开关/进度/结果）+ 扩展页「从链接安装」入口 | 组件测试 |
| **P4 实机与收口** | 隔离 9223 live：mock manifest/zip → 预览 → 确认 → 真实 pack 安装 + MCP 合并 + 截图；UI-550 台账；closeout | live 全过 + 十三门 PASS |

**批内纪律**：①预览零副作用（只读 manifest/已装清单/MCP 清单）；②确认必须重新取 manifest 对账（防 TOCTOU）；③env 进链接即拒；④私网/非 https 默认拒（`PETRI_INSTALL_ALLOW_PRIVATE=1` 仅测试）；⑤安装失败必须清理临时文件；⑥新 acceptance 目录与 flow 同批登记 impact-map。

## 3. 非范围（reopen）

- packaged 真机外部点击唤起、代码签名/公证（G1+）。
- 远程目录/来源 allowlist（本轮所有外源标记「未验证来源」并需显式确认）。
- 运行时自动安装接审批（随 Q1）；包签名与信任链。
- 多 pack manifest 选择（本轮单 pack）。

## 4. 验收门禁

1. 红绿先行：core 单测（解析/守卫/预览/确认/替换/env 拒绝/TOCTOU/校验和不匹配）先红后绿。
2. Node：block242 + 既有 pack-registry/plugin-checksum 回归。
3. 前端：InstallDeepLinkDialog 组件 + 扩展页入口。
4. `quality:types` 0、theme 17/17、lint/knip/closeout 十三门。
5. 隔离 9223 live：mock manifest/zip → 弹层字段/警告 → 安装成功 + MCP 合并 + 亮/暗截图。
6. `output:judge` 收口声明前跑。

## 5. 完成语义

completed = 安全核心 + 接线 + UI + 测试 + live + UI-550 台账 + closeout 十三门 + canonical 回写。若 OS 外部点击无法在开发态取证，如实记 packaged/G1+ reopen，不冒充。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 收口（2026-10-22）

**结论：BLOCK-242 completed；UI-550 verified（dev Electron 边界内；隔离 9223 live 10/10）。**

### 6.1 交付

- **核心**（`src/main/install-deep-link-core.js`，electron-free）：pack/mcp 解析；https/私网/凭据/长度守卫；manifest schema（sha256 必填、size ≤512MB、mcpServers ≤20）；受控拉取（逐跳重定向复验、超时 10s、manifest ≤256KB）；预览风险/替换警告；确认重取对账 + 归档流式 sha256/size 双验；MCP env 禁止与替换门；临时目录必清理。
- **接线**：`petri-install://` OS 协议注册（测试实例跳过）+ second-instance/open-url/冷启动 argv 提取 + `install:*` 三通道 + pending 补领；preload/desktopBridge 类型齐备。
- **UI**：全局 `InstallDeepLinkDialog`（手动入口 + OS 推送共用）+ 扩展页「从链接安装」。
- **安装执行**：pack 走 `pack-lifecycle.installPackWithRuntimes`，MCP 走 `mcp-settings.upsertMcpServer`（无 env、autoConnect=false）。

### 6.2 验证

- core **8/8**；弹层 **2/2**；通道漂移 **5/5**；`quality:types` 0。
- 隔离 9223 live **10/10**（`acceptance/ui-550/` 亮/暗截图；pack 预览字段/风险/替换警告 + mcp 真实安装/替换 + REST 落盘核对）。
- `npm run closeout` 十三门 PASS；`output:judge` PASS。

### 6.3 边界（reopen）

- packaged 真机外部点击唤起（G1+）与代码签名/公证未做；协议注册仅在 dev Electron 边界内验证（测试实例按设计跳过注册）。
- 来源 allowlist、运行时自动安装接审批（Q1）、包签名/信任链、多 pack manifest 选择未做。
- G0 开发期常态 · 不外推 packaged/Provider/GA。