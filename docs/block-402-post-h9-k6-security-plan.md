---
capability: block-402-post-h9-k6-security
status: completed
goal: 按第四轮蓝图 §4 K6 把已有安全防线延伸到最后一个未覆盖的 BrowserWindow 创建点，并让策略判定与执行边界逐件有终态；U 类 ADMISSION/FK 出决策材料，裁决前不改默认语义。
acceptance:
  - PiP 四项 webPreferences 基线补齐并纳入安全断言名单，红绿先行 + 漏配负测
  - 安全断言名单覆盖全仓全部 BrowserWindow 创建点，新增创建点漏登记必红
  - ADMISSION 默认档 / FK 全量切换出 U 类一页材料，不改默认语义
  - IPC 参数 schema 与豁免口、空 catch 扫描根、dev 双后端逐件定终态
  - docs:check / ui:audit:check / 定向 test:changed / closeout 全绿
reopen: 用户裁决 ADMISSION 默认档 / FK 全量切换后按材料候选另立切片
---

# BLOCK-402 · post-H9 K6 安全与边界纵深

> 状态：completed · COMPLETED
> 发令：用户 2026-11-10 预授权连续工作「K0→K7 全部推完，全程零参与」。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## §1 立项自检（产品个性 · 强制问句）

**与 ZCode/Codex 的差别形态**：①**本地可审计**——窗口创建点、webPreferences 四项、ADMISSION 默认档、FK 分裂都由仓内契约从源码机械复算；②**治理透明**——触及既有用户裁决（ADMISSION observe / FK OFF-ON 分裂 / file sender 豁免）一律出 U 类材料并停线跳项，不代答；③**证据自证**——P0 修复红绿先行（先加名单必红→补配置转绿）+ 漏配负测，安全断言不靠文档声明。形态上是「通用 agent 可靠性维度的本地主权防线」，不是领域内容。

## §2 运行时核实

| 蓝图改进点 | 实码核实 | 处置 |
| --- | --- | --- |
| K-27「PiP 未显式 sandbox/webSecurity 且不在 WINDOW_FILES」 | **成立**：`src/main/computer-use-pip.js:67-72` 只有 `contextIsolation/nodeIntegration/preload`；`test/electron-security-assertions.test.mjs:25-28` 名单只有 `_window-create.js` + `window-manager.js`（3 个创建点），PiP 第 4 个不受断言 | **P0 红绿先行**：先加名单 → 红 → 补两项 → 绿 + 漏配负测 |
| PiP preload 与 sandbox 兼容 | `computer-use-pip-preload.js:1-15` 是自包含字面量，只 require `electron` 的 `contextBridge/ipcRenderer`，无 node 内建/本地模块 → 与 `sandbox:true` 兼容 | 可安全补齐 |
| K-29「ADMISSION 默认 observe / FK OFF-ON 分裂」 | 成立：`execution-admission.js:112-120` 默认 observe；`db/connection.js:24-25` `foreign_keys=OFF` vs `src/database/_db-singleton.js:86-90` ON；H10 `cascade-scan.json`（tracked）记 16 条 CASCADE DDL / 11 条显式 delete；BLOCK-372 曾实测 179 fail 后回退 OFF | **U 类**：出材料，不改默认语义；既有 `docs/post-s7-h1-admission-fk-decision-material.md` 作基础刷新 |
| K-28「统一 IPC 参数 schema / env 豁免口」 | 成立但有边界：`_ipc-trust.js:32-37,88` `PETRI_IPC_FILE_SENDER_EXEMPT_IDS` 已被 `test/nso-w2-ipc-trust.test.mjs:50-53` 钉成期望行为，删除会破契约；统一 schema 覆盖全部 handle 属结构性重构 | 决策材料 + 结构性切片挂起 |
| K-28「空 catch 扫描根扩到 frontend/src/scripts」 | `gate:silent-catch` 扫描根仍是 `['core','src']`，基线 395；扩展会改冻结基线口径，按「不放宽基线」纪律需显式留因 + 负测 | 独立切片挂起，本包只做盘点证据 |
| dev 双后端 | AUDIT-LOG 在册「墙面板取消跨后端 15s 无效果」属 dev-infra §76 结构性修复方向，非产品缺陷 | 登记归属，不改进程模型 |

## §3 交付（红绿先行）

- **红**：把 `src/main/computer-use-pip.js` 加入 `test/electron-security-assertions.test.mjs:25-28` 的 `WINDOW_FILES` 并把 `totalWindows >= 3` 改为 `>= 4` → 安全断言因缺 `sandbox/webSecurity` 必红（记录输出）。
- **绿**：`computer-use-pip.js:67-72` 补 `sandbox: true` / `webSecurity: true` → 既有断言 4 项逐块转绿。
- **负测**：`test/post-h9-k6-security.test.mjs` 用纯函数模拟「删任一项必红」「名单漏登记 PiP 必红」「新增 BrowserWindow 创建点未登记必红」。
- 其余：K-28/K-29 决策材料 + 空 catch 盘点证据 + 逐件终态。

## §4 范围 / 非范围 / 风险

- **范围**：PiP 四项基线 + 名单覆盖门 + U 类材料 + K-27/28/29 终态 + 门禁取证。
- **非范围**：不改 ADMISSION 默认 observe、不改 FK pragma、不删 env 豁免口、不新建第二 IPC 包装器/权限系统、不改 dev 进程模型、不扩 `gate:silent-catch` 扫描根（需独立留因+负测）、不动 10 项用户资产与蓝图原件、不撤销既有用户裁决、不放宽任何基线。
- **依赖**：K0（干净树与判据）、K1（MCP trust 边界）、K5（证据元数据门）。
- **风险**：`sandbox:true` 若破坏 PiP 拉帧 → preload 已核实自包含且只用 electron API；`quality:arch` 与 `quality:types` 验证；新增测试需挂 impact-map。

## §5 U 类决策材料与补腿条件

见 `docs/post-h9-k6-decision-material.md`：ADMISSION 默认档（observe/enforce/分面）、FK 全量切换（维持/全量/分阶段）、IPC 参数 schema、空 catch 扫描根扩展、dev 双后端归属。每项含现状/候选/风险/推荐/证据/补腿条件，**Agent 不代答**。

## §6 touchSurface / sharedBaselines

- `touchSurface`: `src/main/computer-use-pip.js`、`test/electron-security-assertions.test.mjs`、`docs/block-402-*.md`、`docs/post-h9-k6-decision-material.md`、`scripts/lib/post-h9-k6-*`、`test/post-h9-k6-*`、`acceptance/post-h9-2026-11-10/k6/**`、canonical 六件套。
- `sharedBaselines`: `test/silent-catch-baseline.json`、`eslint-suppressions.json`、knip / code-size / arch-cycles 基线全部零改动。

## §7 验收门禁与证据

`npm run docs:check` / `npm run ui:audit:check` / `npm run test:changed` / `npm run closeout` / `node --test test/electron-security-assertions.test.mjs`；证据 `acceptance/post-h9-2026-11-10/k6/` 四字段齐备。
