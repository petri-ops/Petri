# BLOCK-61 — 品牌身份系统化改名：BioF3 → Gewu（格物）

> 状态：`completed`（2026-09-06 用户裁决「Gewu 暂时定这个可以，单独开一个 block 彻底系统性修改名字，设计时让后续改名字变得灵活点」，side chat 会话；当前唯一 active 工作包）
> 立项日期：2026-09-06
> truthDomain: `block-61-brand-rename-gewu`
> 来源：用户判定「BioF3」的 Bio 前缀把领域焊死，而产品已长成本地优先的智能体指挥席（多 agent 派生 49 / 计划模式 55 / 远程执行 57 / 窗口系统 59 / 即有电脑控制 48），领域无关。经候选比对（格物 Gewu / Tycho / Braid / Petri）用户裁决 **Gewu（格物）**。

## 1. 命名决定（不可变记录）

- **英文品牌名**：`Gewu`（词源：格物致知——亲手研究事物而获得知识）
- **中文名**：`格物`
- **窗口标题 / wordmark**：`Gewu`
- **版本号不变**：仍为 `0.0.1-rc.7`（改名是身份元数据，不是版本事件）
- **历史名** `BioF3` 保留为 `LEGACY_APP_NAME`（兼容层用，不是脏词）

## 2. 核心设计：品牌身份单一事实源（用户核心诉求「后续改名灵活」）

改名难的根源是名字散落在 1000+ 文件。本 BLOCK 的第一交付物是**把名字收敛到两个小模块**，此后任何再改名 = 只改这两个文件 + 跑一次机械同步：

- `src/main/brand.js` —— 主进程侧单一事实源：`APP_NAME` / `APP_NAME_ZH` / `LEGACY_APP_NAME` / `ENV_PREFIX` / `LEGACY_ENV_PREFIX` / 窗口标题构建器
- `frontend/src/lib/brand.ts` —— 渲染进程侧镜像（渲染进程不能 require 主进程模块，双文件 + 契约测试锁一致）
- `test/brand-identity.test.mjs` —— **品牌一致性契约**：两模块常量逐字段相等；窗口标题/builders 产出；旧名只允许出现在 LEGACY 常量与白名单（docs/archive、acceptance、.biof3-* 数据目录路径、core/biof3-server 协议路径）

## 3. 三层改名策略

| 层 | 内容 | 策略 |
|---|---|---|
| **Tier A 用户可见面** | 窗口标题、TitleBar wordmark、index.html 标题、应用菜单、MCP displayName、onboarding/关于文案、docs 入口标题 | 全部改 Gewu，字符串一律从 brand 模块取（不许裸写字面量） |
| **Tier B 兼容迁移面** | preload 桥 key（`biof3Desktop`→`gewu`）、localStorage key（`biof3-*`→`gewu-*`）、渲染层事件名（`biof3:*`→`gewu:*`）、IPC 通道名 | 新名生效 + **旧名读取兼容**（localStorage 读旧写新一次性迁移；桥双 key 过渡）——用户无感、数据零丢失 |
| **Tier C 机械协议面** | CSS 令牌 `--biof3-*`→`--gewu-*`、类名 `.biof3-*`→`.gewu-*`、`biof3-btn` 等工具类、`BIOF3_*` 环境变量 | 机械 sed 全量替换（theme-token-contract + 受影响 vitest 护航）；env 双读（GEWU_ 优先，BIOF3_ 兜底） |

## 4. 明确不动（协议命名空间，非品牌——灵活性正是体现在这里）

- **`core/biof3-server/` 目录路径** —— 后端协议路径，import/脚本/impact-map 全关联，改名零用户价值；品牌层已由 MCP displayName 与文档承载
- **`.biof3-dev-user-data/` 等用户数据目录** —— 数据连续性红线：绝不挪用户数据；新装环境由 brand 模块解析新目录，既有开发环境保持旧目录
- **`docs/AUDIT-LOG.md` / `docs/archive/` / 旧 plan / `acceptance/` 证据** —— 历史即历史，治理红线不回写；仅新条目用 Gewu
- **`test/impact-map.json` 中的协议路径** —— 跟随上列路径不动
- git 历史不做任何重写

## 5. 分期

| 阶段 | 内容 | 验收门 |
|---|---|---|
| **P0** | 本 plan + DOC-REGISTRY 注册 + roadmap/AUDIT-LOG 登记 | docs:check PASS |
| **P1** | 品牌模块双端落地 + 契约测试 | brand-identity 契约测试全绿 |
| **P2** | Tier A 用户可见面（窗口标题/TitleBar/index.html/菜单/MCP/onboarding/docs 入口） | grep 无裸写 "BioF3" 于 UI 代码；受影响测试绿；tsc 0 |
| **P3** | Tier B 兼容迁移（桥双 key / localStorage 迁移 / 事件与 IPC 通道名） | 迁移单测（旧 key 数据可读）；实机桥可用 |
| **P4** | Tier C 机械替换（CSS 令牌/类名、env 双读） | theme-token-contract 绿；受影响 vitest 绿 |
| **P5** | 收尾：package name、台账 UI-299、roadmap/plan 收口、docs:reconcile/check + ui:audit:check | 全门禁绿；实机冒烟 |

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| 漏改导致新旧混杂 | brand 契约测试 grep 白名单机制：旧名只允许出现在声明过的位置 |
| 用户数据/偏好丢失 | localStorage 读旧写新；数据目录不挪；桥双 key |
| CSS 大面积替换破坏样式 | theme-token-contract + 受影响组件 vitest + 实机冒烟（主题亮/暗） |
| 外部脚本依赖 BIOF3_* env | 双读兼容（GEWU_ 优先），BIOF3_ 永久兜底 |
| G0 纪律 | 不外推 packaged/Provider/GA；改名为纯本地元数据与 UI 事件 |

## 7. 进度记录

- 2026-09-06 P0–P5 整包收口（一次会话）：P1 品牌模块双端 + 契约测试（4/4：常量/双端镜像/wordmark 走模块/历史名禁裸写白名单扫描）；P2 Tier A（窗口标题 windowTitle() 构建器、TitleBar fallback、index.html、MCP `gewu-mcp`、Documents 目录 resolveLocalDirName 旧目录优先）；P3 Tier B（preload 桥双 key window.gewu+biof3Desktop、storage 五族读旧写新、事件 18 通道 biof3:*→gewu:*）；P4 Tier C（155 文件机械替换：--biof3-*→--gewu-*、.biof3-*→.gewu-*、标识符；theme-token-contract 绿）；P5（package gewu-desktop/gewu-desktop-frontend + lockfile、AGENTS.md/docs/README 品牌行、sidecar gewu-computer-use）。**plan 具体化偏差（如实登记）**：① env 前缀 BIOF3_* 归入协议命名空间不改名（350+ 处 core/脚本关联、零用户可见价值，Tier C 的「env 双读」取消——记入 §4 协议清单）；② Tier A 静态 UI 文案随机械 sed 替换为 Gewu（不逐一走品牌模块 import），「禁裸写」由旧名禁令测试守护；③ 实机抓真修：品牌模块自身被 sed 误伤（LEGACY 常量）+ ThemeProvider legacy 列表被误伤——保护清单必须包含品牌模块自身；④ 主题迁移跨窗竞态如实记录（隐藏轨道窗 storage 监听抢先迁移，行为正确）。**门禁**：brand-identity 4/4 + node 回归 67/67 + tsc 0 + 前端 vitest 79/79 + docs:check 204 + ui:audit:check PASS + 实机 9 断言 allPass（acceptance/block-61/）+ BLOCK-59 ui-live/theme-live 回归 PASS（零破坏）。UI-299 verified。**收口后行动项**：BLOCK-48 恢复 active 继续 P1（检查点 c29d9f04）。G0 开发期常态 · 不外推 packaged/Provider/GA。
- 2026-09-06 P0（active 立项）：用户裁决于 side chat 会话（Gewu 定名 + 本 BLOCK 指令 + 「后续改名灵活」设计要求）。盘点：11,199 行 / 1,073 文件含 biof3 字样；大头 = CSS 机械面（~4,400 行，契约测试护航）与历史文档（~1,700 行，不动）。当前唯一 active 工作包 = BLOCK-61；BLOCK-48 仍为 planned 候选，排本包之后。
