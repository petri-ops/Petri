---
capability: block-393-post-s7-remaining-work
status: completed
goal: 承接 post-S7 程序 H0→H7 收口后的「剩余工作」，一次性把 Agent 侧可开工、无需人眼与有效凭据的部分推完；客观够不着的逐项留补腿条件，不冒充完成。
acceptance:
  - 用户资产二次误入库撤回并转机械门禁（同类第二次转门 + 负测）
  - 无窗口 dev 栈 + 9223 默认离屏实例起通，CDP 断言可达
  - DOM 预算拆前基线（8 档，含服务端截断归因）、布局几何基线、冷启动五段分解、UI 代行 DOM 断言，四份证据在册且形状有契约
  - 跨语言版本字面量对账门 + 负测；css 白名单 13→11 存量收缩
  - 客观边界（凭据 / 人眼 / 用户裁决 / W5b 大拆片）逐项留补腿条件，不写 verified
reopen: 有效模型凭据到位 → 8 任务套件；人眼路线签字 → UI-702 等；W5b 独立切片会话 → 大拆片
---

# BLOCK-393 · post-S7 剩余工作（一次性推进）

> 发令：用户 2026-11-10「那继续剩下的工作内容，可以一次性整完吗」——视为 2026-11-09 预授权连续工作
> 的延续与本条显式「继续」发令；按 dev-infra 预授权连续工作模式直接开工，不逐项请示。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 0. 「一次性整完」的可行性结论（如实，不缩范围）

**不能 100% 整完**，四类客观边界不是工作量问题：

| 类 | 具体项 | 为什么 Agent 不能代答 |
| --- | --- | --- |
| V 有效凭据 | 8 任务套件（B-02） | `ai-settings.json` presets=0、env 0 key；无凭据发起真实推理=伪造成功 |
| V 平台条件 | VoiceOver 朗读、屏幕录制截图、AX 会话档 | 需 OS 授权与真人听觉/视觉确认 |
| E 人眼 | UI-702 暗色观感、32 条 debt 终态化、视觉四件套 | DOM 绿≠视觉绿；Agent 不代答、不冒 verified |
| U 用户裁决 | ADMISSION 默认档、FK=ON 全量切换 | 既有用户裁决维持缓，不得擅自改变 |
| W5b 纪律 | 5 个巨型文件大拆片 | 一切片=一会话 + 拆前拆后同套绿；连续会话多切片会污染基线证据 |

**本包一次性推完的是**：Agent 可开工、可机械/CDP 验证的全部（见 §1）。未闭合项逐件登记在 §3，无静默消失。

## 1. 交付

### 1.1 启动三步与自查自纠

- `docs/AUDIT-LOG.md`：无 🔴 阻塞 / 🟢 待合并项；`npm run state`：串行槽位空闲、常驻计划 G0-LF；`DOC-REGISTRY` 与 handoff 的 active 两层口径与 H0 修复一致。
- **抓到同类第二次事故**：`932b9136` 用 `git add -A docs` 把 `docs/pelican-bicycle.html` 二次入库（首犯 `34076352` → 撤回 `39838552` → 复发）。`git rm --cached` 撤回索引（磁盘文件 Nov 5 19:38 原样保留），`acceptance/block-332/ui-ledger-triage.json` 的 `generatedAt` 时间戳逐字复原。
- **按治理纪律转机械门禁**：新增 `gate:user-assets`（`scripts/user-asset-guard.mjs` + `test/user-asset-guard-baseline.json` 9 项保护清单），清单内路径出现在 `git ls-files` 或暂存区任一侧即红；接入 closeout 首门；契约测 4/4（精确/前缀匹配、tracked/staged 双侧负测、现场零命中、清单自洽）。教训不再只写 AUDIT-LOG。

### 1.2 无窗口 dev 栈与隔离数据面

- 起栈：后端 `:3001`（`PETRI_DB_PATH` 指向隔离副本）+ vite `:3000`（已在跑）+ `bash scripts/start-test-instance.sh` **默认离屏** 9223。
- **纠正上一轮给出的错误命令**：上一条答复里写了 `--onscreen`，违反用户 2026-10-17 / 10-23 裁决（不开可见窗口、禁 `PETRI_TEST_ONSCREEN`）。本轮全程默认离屏，探针脚本未设置该环境变量。
- **零污染用户主库**：测试实例无独立 DB（共享主库），直接造 400/800 条种子会污染用户数据。改为 `VACUUM INTO` 生成 `/tmp/petri-h8-isolated/data/petri.db` 一致性快照，种子只写副本；主库以 readonly 打开做快照，不作为写入目标。
- 种子脚本 `scripts/post-s7-seed-conversations.cjs`：幂等（按 `H8-SEED-` 前缀先删后插），造会话行与 `copilot_messages` 两类负载。

### 1.3 CDP 实机腿批（4 份证据 + 形状契约）

| 证据 | 内容 |
| --- | --- |
| `acceptance/post-s7-2026-11-10/h8/dom-budget-live.json` | 8 档 DOM 节点数 / rAF 帧间隔 / 几何。400/800 会话档并列 7202 节点 |
| `.../h8/ui-live.json` | 三态视口（1600×1000 / 4000×2500 / 1000×625）几何基线 + 5 项 A11Y 在场 DOM 断言 |
| `.../h8/startup-five-stage.json` | 冷启动五段分解（热栈连续 5 轮，取最差轮） |
| `.../h8/` + `test/post-s7-h8-evidence-contract.test.mjs` | 形状契约 2/2（`humanEyeEquivalent=false`、`verdict=measured`、超上限档必须保留） |

**真实产品发现（不缩分母、不回溯调参）**：首轮 400 与 800 档读数完全相同（7202 / 4860 / 500），归因不是取数 bug，而是 `/api/ai/conversations` 硬编码 `LIMIT 100`（`routes/ai-conversations.js:71`）+ 消息列表前端默认 `?limit=100`（`copilotConversationsClient.ts:129`）。即**「会话/消息列表全量 DOM」这个 B-09 前提本身不成立，服务端已截断**。补上上限内 6 档取得真实增长曲线：会话 25/50/100 → 节点 1777/2202/3052；消息 10/50/100 → 1277/2937/5012；rAF P50=8.3ms / P95=9.3ms / 长帧占比 0（离屏窗口，如实标注可能被 Chromium 节流）。
**基线落盘后才允许动 CSS**：本包只取拆前基线，未改 `content-visibility`（无实机前后对比的改动等于猜测）。

**判定器设计修正（留因）**：五段判定器初版对跨轴数值做单调断言，现场 5 轮全报 `non_monotonic`——根因是五段来自不同时间轴（`mainReady` 是主进程相对时刻、`migrations` 是日志指纹哨兵、其余是 curl 往返耗时），跨轴比大小无意义。改为「逐段在册 + 数值合法 + 慢样本必红」，并补一条跨轴合法现场的正测。不是放宽阈值凑绿，是判据本身设计错误的根修。

### 1.4 其他机械项

| 项 | 交付 |
| --- | --- |
| 跨语言版本对账（B-17 followUp） | `gate:version-parity`：前端 TS `contractVersion: 1` 生产面 5 处与 `schema-versions.js` 登记值机械对账，单边升版/定义被移走即红；契约 4/4。不新建第二真相源、不复制常量 |
| css 白名单（B-31 子集） | 两个已移除的 plain CSS 出白名单，13→11，`gate:css-modules` PASS |
| 影响图 | 新增 `user-asset-index-guard` / `post-s7-h8-live-probes` 两规则；新证据目录登记；`test/test-affected` 23/23 |
| 收口链 | 16→19 门：新增 `gate:user-assets`、`gate:version-parity`（+ 首门位置调整）；`gate:startup-five-stage` **刻意不进常驻链**（依赖活 dev 栈，无栈环境必红＝fail-open 陷阱），只作专项证据脚本 |

## 2. 证据与边界

| 门 | 读数 |
| --- | --- |
| `npm run closeout` | 19 门全绿 |
| `npm run docs:check` / `ui:audit:check` | PASS |
| 新增契约测试 | user-asset 4/4、H8 形状 2/2、五段 5/5、版本对账 4/4、影响图 23/23 |
| 实机证据 | 4 份 JSON（DOM 8 档 / 几何三态 / 五段 5 轮 / UI 代行 5 断言） |

五类证据各归其位：CDP DOM 断言不冒充视觉绿；closeout 绿不冒充 UI 在场；DOM 与帧率读数不冒充人眼观感；热栈 5 轮不冒充冷启动 5 次。

## 3. 仍未闭合项（逐件补腿条件）

| 项 | 终态 | 补腿条件 |
| --- | --- | --- |
| 8 任务套件（B-02） | external-blocked | 提供有效模型凭据 → 按冻结判据复跑 ×3，要求 8/8、0 干预 |
| `humanEyePending` 8 + UI-702 暗色/朗读/32 条 debt（B-34、B-12） | pending_human_eye | 照 `docs/post-s7-h7-human-eye-route.md` 走完并在签名区确认；CDP 代行部分已在 `h8/ui-live.json`，未翻 verified |
| 四事件前端投影 / SSE 重连横幅（B-07、B-14） | retain | dev 栈断线注入三态 + 人眼过目；不为过门禁补形式截图 |
| 布局单源（CenterPanel 双层同名 layout）（B-11） | retain（**拆前基线已在册**） | 用 `h8/ui-live.json` 的三态几何做拆前基线 → 独立切片收敛 → 同套几何复测 + 人眼过目 |
| DOM 预算 CSS 改动（B-09） | retain（**拆前基线已在册**） | 服务端 LIMIT 100 事实确认后重定判据；加 cv 前后同条件复测，节点数不降/帧率不升即回滚 |
| 冷启动五段入门禁（B-22） | retain（专项取数已在册） | 五段需统一时间轴打点（现 migrations 段只有日志指纹哨兵），并做冷启动 ×5，不能靠热栈可达性冒充 |
| 5 巨型文件大拆片（B-16） | retain（W5b） | 一切片=一会话 + 拆前拆后同套绿 |
| 插件源三处 / 13 环 / knip 动态入口 / 三套依赖树（B-18、24、25、26） | retain（结构性重构） | 独立立项 + 全量回归，不与单源收编混批 |
| 165 零消费通道 / lint 2312 warnings / 源码扫描换行为断言（B-33、31、20） | retain | 分域逐批 + 负测守护 |
| ADMISSION 默认档 / FK=ON 全量切换（U 类） | 用户裁决维持缓 | 材料在 `docs/post-s7-h1-admission-fk-decision-material.md` |
| EAR 45%（B-30） | 41.9%（892/2128） | 靠分子增长，不缩分母；本包新增证据已入册 |

## 4. 保护边界自查

- 8 项 untracked 用户资产 + 撤回的 `docs/pelican-bicycle.html` 零触碰（门禁现场零命中）；主库只做 readonly 快照，种子只写 `/tmp` 副本。
- 零新增依赖（`package.json` 只加 npm script）、零第二真相、零阶段跃迁。
- `gate:code-size` 若有尺寸漂移按「重打必须显式留因 + 负测」处置，不放宽基线。

## 5. 复跑命令

```bash
npm run gate:user-assets
npm run gate:version-parity
node --test test/user-asset-guard.test.mjs test/post-s7-h8-evidence-contract.test.mjs \
  test/post-s7-h8-startup-five-stage.test.mjs test/post-s7-h8-version-parity.test.mjs
# 实机腿（需无窗口 dev 栈 + 9223 默认离屏 + 隔离库）
PETRI_DB_PATH=/tmp/petri-h8-isolated/data/petri.db node scripts/post-s7-dom-budget-live.cjs
node scripts/post-s7-h8-ui-live.cjs
node scripts/post-s7-startup-five-stage.mjs
npm run closeout
```

G0 开发期常态 · 不外推 packaged/Provider/GA。
