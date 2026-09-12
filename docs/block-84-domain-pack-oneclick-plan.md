# BLOCK-84-DOMAIN-PACK-ONECLICK：领域包产品级一键装/卸计划

> 文档版本：v1.0（立项即开工版）
> 创建日期：2026-09-12
> 状态：**active（P0-LAUNCH）**
> truthDomain：block-84-domain-pack-oneclick
> 上游：BLOCK-83（已 completed——本包把「环境变量级拔插」升级为「产品级一键」）

---

## 1. 用户裁决与目标

用户裁决（2026-09-12，原话）：**「是的 需要 产品级 一键」**——领域包的安装/卸载要从环境变量级（开发者体验）升级为产品级 UI 一键操作。

**目标形态**：插件商店内「领域包」分区——每个包一张卡片（名称/版本/提供物/状态），**一键安装 / 一键卸载**，卸载即回到纯通用态（核心零改动，BLOCK-83 已验收的语义）。

## 2. 现状与设计裁决

**现状**：装/卸 = 手工设 `BIOF3_PLUGINS_DIR` + `BIOF3_DOMAIN_TOOL_REGISTRY` 两个 env + 重启；核心五插座已全部就绪（BLOCK-83 P3/P4）；插件商店已有完整插件级安装管道（`plugin:*` 8 IPC + PluginStorePanel + plugin-manager）。

**设计裁决**（机制级，内部裁决；产品可见项见 §3）：

- **D1 安装记录**：`<dataDir>/packs/installed.json`（数组：`{packId, packRoot, version, installedAt}`）——文件制、additive、与插件 `installed.json` 先例同构；dataDir=`BIOF3_LOCAL_DATA_DIR`。
- **D2 包来源（v1）**：本地目录选择（主进程 `dialog.showOpenDialog` 选含 `pack.json` 的目录）+ 兄弟仓自动发现（`../gewu-pack-bio`，dev 便利）；**远程分发 defer**（插件级 remote manifest 机制在，包级远程另立候选）。
- **D3 boot 接线**：server 启动时读 packs 记录 → 每个已装包追加 `{type:'installed', root:<pack>/plugins}` 插件源 + `toolRegistry.registerDomainToolsFile(<pack>/registry/tool-registry.json)`。**tool-registry 从「env 单文件」升级为「env + 命令式注册可叠加」**（内部 map 可变，导出函数不变——消费方零改动）。
- **D4 卸载语义**：移除安装记录 + 诚实提示「重启后生效」（plugin-loader 单例，与运行时安装的重启先例一致）；**不删包文件本身**（包是用户资产）。
- **D5 包校验**：安装时校验 `pack.json`（packId 必填 + plugins/installed.json 存在）；重复安装 = 幂等更新。

## 3. 交付面

| 层 | 内容 |
| --- | --- |
| 主进程 | `src/pack-registry.js`（记录读写 + pack.json 校验 + 兄弟仓发现）+ `src/ipc/pack.js`（`pack:list-available` / `pack:list-installed` / `pack:install-from-dialog` / `pack:install-path` / `pack:uninstall`）+ preload `packs.*` 桥 |
| server boot | `server.js` 读 packs 记录 → 插件源追加 + tool-registry 文件注册（additive，零包=零行为） |
| UI | `PluginStorePanel` 增「领域包」分区（卡片：packId/name/version/provides 摘要/状态/按钮 + 重启提示） |
| 工具注册 | `tool-registry.js` 增 `registerDomainToolsFile()`（导出面 additive） |

## 4. 阶段

- P1 后端（pack-registry + IPC + boot 接线 + tool-registry 叠加注册）+ 契约测试
- P2 前端（商店领域包分区）
- P3 实机验收（装→catalog=15→卸→catalog=0 双态循环 + D13 夹具同样可装）+ 收口

## 5. 范围外

- 远程包分发（候选）；包内单插件粒度管理（插件商店已有）；自动更新；多包冲突仲裁（v1 单包为主，多包叠加按注册顺序）。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 验收门禁预声明

- 契约测试（pack-registry 读写/校验/幂等/tool-registry 叠加）全绿 + tsc 0 + docs/ui 门禁。
- 实机（dev 栈重启循环或隔离探针）：装 gewu-pack-bio → catalog=15 → 卸 → catalog=0；D13 夹具第二租户同法可装可卸。
- 卸载后核心零残留（复用 BLOCK-83 Z4 文件级检查语义）。
