# BLOCK-86-DOMAIN-PACK-LIFECYCLE — 领域包全生命周期：运行时托管 + 插件化契约

**状态**：`completed`（2026-09-15 整包收口 P0–P3；启动裁决原话「1」，封存裁决原话「选择1 开始这个」）
**立项**：2026-09-14（planned 排队）→ **启动**：2026-09-15（P0 激活对账完成：§1 代码事实全量复核零漂移）
**前置**：BLOCK-83（completed，SPI 基座 + D7 棘轮）、BLOCK-84（completed，记录制一键装/卸 + 商店领域包分区）
**包仓**：Diandian-ops/petri-pack-bio（本地兄弟仓 `../petri-pack-bio`）
**plan 版本**：v1.2（2026-09-15 封存裁决+收口；v1.1 启动；v1.0 立项）

## 0. 用户裁决留痕

- 「选择方案1」——三方案对比（1 全生命周期托管 / 2 半自动联动 / 3 仅改归属文案）后选 1：领域包全生命周期托管运行时。
- 「理解成立」——心智模型确认：**格物桌面本体 = 通用 agent 工作台 + 能力插座；生信领域包 = R/Python 基础环境（生信选型的发行版）+ 15 个分析插件 + 脚本 + 演示数据 + 科学校验钩子 + 工具目录。装 = 整包可用，卸 = 除插座外全部干净移除。**
- 「是的 是的 代码层面是否也隔离开 毕竟后期可能还会有其它领域内容的扩展 要插件化 思维来进行」——插件化思维确认：本包实现纪律 = 不新增任何领域硬编码。
- 「新开 工作包 等其它任务完成后 再来集中处理」——立项排队裁决：登记 planned，BLOCK-85 等在制任务收口后再集中实施。

## 1. 背景与现状核实（2026-09-14 代码事实）

用户想法（生信 = 垂直领域包，R/Python 基础环境属领域内容，装则可用、卸则干净）与 BLOCK-83/84 既定架构方向一致，但当前实现存在三个偏差：

1. **运行时挂错层级**：R/Python 运行时在 `resources/runtime/manifest.json` 作为独立插件条目，商店里是顶层「运行时」分类 + 硬编码「必需」徽标（`frontend/src/components/desktop/PluginStorePanel.tsx:499`）+ 全局缺失提示（同文件 `needRuntimeHint`）——没装任何领域包也在提示运行时。
2. **装不联动（「加载可用」不成立）**：领域包一键安装只写 `<dataDir>/packs/installed.json` 记录（`core/shared-backend/pack-registry.js` `installPack`）；运行时完全不在这条链路里——装完生信包，15 个 R/Python 分析插件全部不可用，需用户自行单独下载 R（windows-x64 约 657MB）与 Python（约 503MB）。
3. **卸不干净（「卸载干干净净」不成立）**：包卸载只删记录（`uninstallPack`，注释「包文件本身不动——用户资产」）；运行时纹丝不动（约 1.1GB 残留），商店里仍作为独立项可见。而纯通用态下运行时**零消费者**（`src/main/backend-proc-manager.js`：petri-server 无 R 照常启动，R/Python 只被领域工具执行用到）——运行时在包卸载后纯属残留。

**可复用原语（无需新机制）**：运行时卸载已是真删（`src/plugin/uninstall.js` `uninstallRuntime` 删目录 + 清 env）；运行时安装 `installPlugin()` 可从主进程直接调用（`src/ipc/plugin.js:59` 先例）；boot 接线 additive（`core/petri-server/server.js:70-86` 零包=零行为）。

**核心领域残留盘点（插件化视角，迁移主体属增量 A，本包只做 UI 感知改造）**：
- 运行时清单在核心仓（`resources/runtime/manifest.json`，notes 自述「领域插件清单随领域包交付」——BLOCK-83 P4 只拆了插件清单一半）；
- 语言档案过渡内置（`core/shared-backend/script-host-languages.js:73-74`，注释自称过渡事实，D10 终态=包注册）；
- 科学校验钩子装配在核心（`core/petri-server/plugin-loader.js:19`，注释「本装配随 scientific-task-* 迁出核心」）;
- UI 领域意识渗透：`frontend/src/pages/home.tsx:8-11,387-391,470`（首启 R 检查 + 引导条）、`project-workspace.tsx:1540-1544`（工作台 banner）、`DesktopOnboarding.tsx:204`（「R 运行时」卡片）、`src/main/env-coordinator.js`（boot warn）；
- 商店「分析工具 0」但包已交付 15 插件——包内容在商店不可见。

## 2. 目标（方案1 完整形态）

**一句话**：装 = 一键整包可用；卸 = 干干净净且资产去向可感知；核心界面无包时不出现任何领域概念。

1. **契约**：`pack.json` 新增 `requires.runtimes`（数据驱动声明依赖的运行时插件 pluginId + 版本约束）；卸载编排**由契约推导**，不硬编码生信。契约同步落在 petri-pack-bio 仓（独立 git 仓，协调提交）。
2. **装**：商店 pack「一键安装」= 写记录 + 依次触发 `requires.runtimes` 运行时下载安装（复用既有 `installPlugin` 进度链）；包已装而运行时缺失时卡片内提示补装。
3. **卸**：确认弹层列明三档处置——领域资产删（运行时 + 演示数据缓存，标明回收体积）/ 用户数据留（results、项目文件、DB）/ 包源目录默认保留（用户资产，可选勾选删除）；卸载完成给「删了什么/留了什么」报告；随后按契约推导卸载运行时（复用 `uninstallRuntime`）。
4. **商店改版**：pack 卡片成为唯一领域入口——可展开显示运行时子项（状态/体积/进度）与功能模块清单（15 分析插件、脚本、演示数据计数）；包交付的插件在「分析工具」分类可见并标注来源包；独立「运行时」分类收编进包视图；「必需」徽标与缺失提示只在「包已装而运行时缺」时出现。
5. **核心 UI 领域感知**：home 首启检查 / 工作台 banner / DesktopOnboarding / 商店提示 / env-coordinator boot warn 全部改为领域感知——无包不提运行时；有包缺运行时才提示且文案挂包名。

## 3. 领域包契约图（北极星验收标准）

核心只留四张领域中性的注册表（语言、工具、钩子、插件源装载器）+ 契约校验器；纪律 = **核心生产代码零 `r`/`python`/生信/`scientific` 领域硬编码**（对齐 BLOCK-83 D7 棘轮）。

| 包内路径/字段 | 状态 |
| --- | --- |
| `plugins/` + `installed.json` | ✅ 已有（BLOCK-83/84） |
| `registry/tool-registry.json` | ✅ 已有（`registerDomainToolsFile`） |
| `demo-data/`、`scripts/` | ✅ 已有 |
| `pack.json` → `requires.runtimes` | **本包新增** |
| 运行时清单（manifest 条目）迁包 | 增量 A（另行立项） |
| `languages/` 语言档案包注册（兑现 D10） | 增量 A（另行立项） |
| `hooks/` 科学校验钩子迁包 | 增量 A（另行立项） |

新领域包 = 照契约图填内容，核心一行不改——这是插件化思维的可检验形态。

## 4. 阶段划分（planned；激活时按 WORK-PACKAGE-LAUNCH-CHECKLIST 复核现状后执行）

- **P0 激活对账**：重跑启动检查单；对照本 plan §1 代码事实复核现状（防 BLOCK-85/G0-RS 期间漂移）；登记 UI-###（商店改版项）。
- **P1 契约与装卸编排（后端）**：`pack.json` `requires.runtimes` 契约 + `pack-registry` 校验扩展；`src/ipc/pack.js` 编排（装=记录+运行时联动安装；卸=三档数据策略+契约推导卸运行时+卸载报告）；petri-pack-bio 仓 pack.json 同步。**实现纪律：编排逻辑读契约，不写死 petri-pack-bio/生信字样。**
- **P2 商店改版与核心 UI 领域感知（前端）**：§2 目标 4、5 两项；随提交登记 `docs/ui-productization-audit.md`（UI-###）。
- **P3 实机 verify flow + 收口**：`npm run verify -- pack-lifecycle` 全链实机；文档/台账回写；`npm run closeout`。

## 5. 验收门禁预先声明（收口时逐项对账）

1. 契约测试：`requires.runtimes` 校验 + 卸载编排由契约推导（含**无 `requires.runtimes` 的包卸载时不触碰运行时**的负例）。
2. 组件测试：PluginStorePanel——pack 卡片运行时子项/进度/确认弹层三档/提示条件（含「无包不提示」负例）。
3. 实机：dev-verify flow `pack-lifecycle`——装包 → 分析入口出现领域工具 → 真实 R 工具 + Python 工具各跑通一个 → 卸载 → `runtimes/R|Python` 目录消失 + 商店无领域痕迹 + 工作台回纯通用态；证据落 `acceptance/block-86/`。
4. 纪律：BLOCK-83 D7 棘轮基线不回退（核心生产代码领域词零新增）；本包新代码 grep 复核零领域硬编码。
5. 治理：`npm run docs:check` + `npm run ui:audit:check` + 定向 `npm run test:changed` 绿；UI 改版项 UI-### 台账同提交。

## 6. 非范围（exclusions）

- **增量 A（核心去生信残留迁移，各自独立立项）**：运行时清单迁包、语言档案包注册（D10 兑现）、科学校验钩子迁包。
- **增量 B（多领域形态）**：运行时槽位归属（共享基础发行版 + 领域叠层 vs 每包独立槽位）——单领域包阶段不解决，契约数据化为它留口。
- **BLOCK-84 范围外维持候选**：远程包分发 / 包内单插件粒度管理 / 自动更新 / 多包冲突仲裁。
- **热生效**：维持「装/卸后重启生效」既定契约（BLOCK-84 D4），不做 server 热重载。
- **G0 阶段纪律**：不外推 packaged/Provider/GA；不列举未做 G1+ 项。

## 7. 依赖

- BLOCK-83（SPI 基座、D7 棘轮门禁）— completed。
- BLOCK-84（记录制装/卸、商店领域包分区、pack IPC 五通道）— completed。
- 在制任务收口（BLOCK-85 联邦收尾与双真机验收 / G0-RS mac 侧 P6 重采）— 用户裁决的排队前置。
- petri-pack-bio 包仓（pack.json 契约变更，独立 git 仓协调提交）。
- 运行时 OSS 制品链（既有 sha256 fail-closed 下载链，零改动复用）。

## 8. 风险与诚实边界

- **卸载删运行时是破坏性动作（约 1.1GB）**：确认弹层列明明细 + 可取消；用户数据（results/项目/DB）永不触碰；包源目录默认保留。
- **运行时槽位按语言全局唯一**：单领域包前提下安全；第二领域包若需不同包集的同语言运行时，属增量 B。
- **生效语义**：安装完成提示只承诺「重启后生效」，不承诺热生效。
- **双平台体积/时长**：Windows R 约 657MB 下载，进度 UI 复用既有链；弱网体验如实标注。
- **跨仓协调**：pack.json 契约在 petri-pack-bio 仓，核心仓测试需夹具包（对齐 BLOCK-84 D13 第二租户夹具先例）。

## 9. 证据位置

- 实机断言：`acceptance/block-86/`（pack-lifecycle flow JSON + 截图）。
- 契约/组件测试：`test/pack-registry.test.mjs`（扩展）、`frontend/src/components/desktop/PluginStorePanel` 相关测试（扩展）。
- dev-verify flow 登记：`scripts/` + verify flow 清单（P3 落地时定名 `pack-lifecycle`）。

## 10. 完成语义

- `completed` = §5 五项门禁全绿 + §2 五项目标在 dev Electron 实机可见 + 本 plan/roadmap/handoff/DOC-REGISTRY/UI 台账回写一致。
- 部分交付不得宣称 completed；增量 A/B 与范围外候选保持显式登记，不静默扩scope。

## 修订记录

- v1.2（2026-09-15）：**测试纪律定型（用户裁决原话「选择1 开始这个」）**——封存 14 插件至包仓 `plugins.dormant/`（git mv，加载器只扫 `plugins/`，核心零改动），保留 `deseq2` 唯一活跃参考实现；日常/大变动只测 deseq2 + BLOCK-86 契约套件，15 插件全量矩阵推迟到「软件版本成型」里程碑（时点用户裁决）；`plugins.dormant/README.md` 登记单插件激活适配 checklist。§5.3 门禁随之修订：「真实 Python 工具跑通」随 Python 代表（celltypist）封存而消解（本机亦无领域 Python 运行时，双重事实）；「真实 R 工具跑通」= deseq2（已在本验收链内）。
- v1.1（2026-09-15）：启动 active（用户裁决原话「1」）。P0 激活对账：§1 全部锚点复核零漂移（pack-registry/installPack:88/uninstallPack:106、uninstall.js uninstallRuntime:107、plugin.js installPlugin 可直调、PluginStorePanel needRuntimeHint 均在位）；运行时清单 pluginId 确认 = `petri-r-runtime` / `petri-py-runtime`（manifest v2.0.0）；P2 商店改版预登记 UI-374。
- v1.0（2026-09-14）：立项登记（planned 排队）。依据 2026-09-14 插件商店现状核实 + 用户四轮裁决（§0）。
