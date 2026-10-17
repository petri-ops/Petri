---
capability: config-single-source-of-truth
goal: BLOCK-203 = runlist W4（阶段 3 B1b）——把 14 处配置落点里"设置改了不生效"的同族病根收干净。W4 拆两片执行：**W4a（本片）= 纯文件落点收编**（`user-prefs` / `skills-prefs` / `agent-rules` / `mcp-servers` + `ai-settings` 顶层 unknown-key 语义 + renderer `localStorage` 那套并入 profile）+ **D-2 rider**（models 导出默认不再落明文 Key）；**W4b（后续片）= 搬迁**（SQLite `site_settings` / `runtime_json` / `state_json` / `users.permissions` / 主进程 `window-manager-state` + 4 条 data root 脑裂根治）。现状事实见 §0（全部 `path:line` 实码核对，2026-10-17）。
acceptance:
  - P0 口径更正与拆前基线：runlist W4 行「11 处」更正为 **10 处**（14−4，BLOCK-199 自身 §5 写 11、§12 写 10 自相冲突，以逐条枚举为准）；建 `test/block203-config-baseline.test.mjs` 冻结**扩容后**注册表族/键集合与前 8 族一字不变（BLOCK-202 基线 8 族 35 键原样），此后改实现不得改基线。
  - P1 `user-prefs` 收编：`routes/user-prefs.js` 自写 `sanitize`（THEMES/ACCENTS 集合 + fontScale clamp 0.8–1.4）改由注册表族 `user-prefs` 三键校验；**磁盘形状与文件名不变**、`theme/fontScale/accent` 语义逐字对齐现状；写侧未知键 400 + diagnostics（此前静默丢）。
  - P2 `skills-prefs` 收编：`disabled` 映射（动态 id 空间）与 `version` 进注册表；**id 空间真相仍在 skill-registry**，注册表只校验"键形状 + 值类型"，不复制技能清单；审计 `skills-prefs-audit.jsonl` 语义零改动。
  - P3 `agent-rules` 收编：`rules[]` 条目校验从 `loadUserRules` 的内联 filter 收成字段注册（id/matcher.type/matcher.pattern/action/scope/note/createdAt），**first-match 与 fail-soft 语义零改动**；未知条目字段可诊断（读侧报告、写侧拒绝）。
  - P4 `mcp-servers` 收编：`normalizeServerEntry` 的字段规则（id 无空白/斜杠、command 必填、transport stdio|http、http 必带 url、args≤64、servers≤50）收成字段注册；`env` 仍走 `mcp-env-crypto` 密文，**明文永不入快照/导出**；未知条目字段诊断。
  - P5 `ai-settings` 顶层 unknown-key：顶层键白名单化——写侧**过滤 + 结构化 diagnostics 回传**（不 400，理由见 §8 D-W4a-3）⇒ 磁盘不再能长出未注册顶层键；`config:doctor` 增加"磁盘已有未知顶层键"点名 + 自愈提示。
  - P6 renderer `localStorage` 并入 profile：`petri-theme` / font-scale / accent 三键降为**纯启动缓存**（服务端 `user-prefs.json` 唯一真值），键名与 `user-prefs` 族键路径由漂移测双向钉住（`appKeymap.drift.test.ts` 先例）；4 个 legacy 键只读迁移、不再写；缓存值非法时丢弃回落服务端值。
  - P7 D-2 rider：`useEndpointProfilesEditor.ts:381` 的 models 导出**默认脱敏**（Key 打码为 `sk-***...后四位`），"含明文"改为二次显式确认才启用；导出文件名/格式/其余列零改动；密钥扫描门复跑绿。
  - P8 收尾：`config:doctor` 覆盖新族；BLOCK-199 四向漂移门扩到新族（族↔设置面↔写路由 4xx↔RUNTIME_POINTS，对无 HTTP 面的族登记例外并说明）；`config-transfer` 导出/导入/重置覆盖新增可导出族（凭据类与 renderer 缓存面排除并回传排除清单）；`impact-map` 登记；closeout 十三门 + 五件套回写。
  - 完成语义：W4a 完成 = **文件落点收编完成**（覆盖率口径见 §6），**不含** data root 统一——后者是 W4b，同一逻辑设置"主/后端指向同一文件"的跨进程回归测在 W4b 才成立。完成时**不得**表述为"配置已统一"。
reopen: W4b 搬迁（SQLite 四落点 + 主进程窗口/路由态 + 4 条 data root 回落链合一）；`config:doctor` 接设置面内联提示；`ai-settings` 顶层键的 400 化（需先让设置页只回传已注册键）；`extraRenderers` 等未测绘的第七个文件族；W5 逐工具策略。
status: active
---

# BLOCK-203 · 阶段 3 B1b（W4a）：纯文件落点收编 + ai-settings 顶层语义 + localStorage 并入 + D-2 rider

执行序位置=`docs/stage-3-4-execution-runlist.md` 的 **W4**（W0–W3 已 completed）。用户常驻授权「按 runlist W0→W8 连打，不再逐项发令」⇒ 本片按队列头自决开立，不另请裁。

## 0. P0 实码核对（2026-10-17，逐条 `path:line`）

### 0.1 口径更正一：落点是 10 处，不是 11 处

| 出处 | 写法 | 实码判定 |
| --- | --- | --- |
| `docs/stage-3-4-execution-runlist.md` §2 W4 行 | 「其余 **11 处**落点收编」 | ❌ 沿用旧数 |
| 同文件 §3 W0-j 勾选项 | 「其余 **10 处** + data root 脑裂」 | ✅ 与本表一致 |
| `docs/block-199-config-schema-service-plan.md` §5 红线 | 「剩余 11 处落点留 B1b/B2」 | ❌ 内部冲突 |
| 同文件 §12 未做清单 / §P6 完成语义 | 「其余 **10 处**落点未收编」「14 落点中收编 3 处」 | ✅ |
| `docs/README.md:226`（BLOCK-199 条目）/ `:227`（runlist 条目） | 「剩余 11 落点留 B1b/B2」/「B1b 11 落点收编」 | ❌ 已同批更正 |
| `docs/project-workspace-handoff.md` BLOCK-202 段恢复要点 | 「其余 11 处落点收编」 | ❌ 已同批更正 |

结论：**14 − 4 = 10**。runlist 行、BLOCK-199 plan §5、README/handoff 旧条目五处同批更正，否则验收口径从一开始就是错的（W1–W3 新增的 `keymap`/`reasoning`/`network`/`runtime` 四族是**新文件族**，不属于这 14 落点，不得拿来抵数）。AUDIT-LOG 与 DOC-REGISTRY 里 BLOCK-199/runlist 的**历史记录行**保留原写法（append-only 记录，可由本条与 plan §0.1 追到更正来源）。

### 0.2 口径更正二：`config-service.js` 不存在——"统一配置服务"是族 helper + schema 函数

BLOCK-199 plan §P2 写「`core/petri-server/config/config-service.js`：后端侧落点适配器」。实码：`git ls-files | grep config-service` **零命中**，`core/petri-server/config/` 目录不存在，`core/packages/shared-config/` 只有 `config-schema.js` + `reasoning-defaults.js`。

真实收编形态=各族 helper 直接 `require` schema 的函数（9 处实证：`helpers/ai-settings.js:26`、`config-transfer.js:21`、`cost-cap.js:19`、`decision-config.js:7`、`feature-flags.js:22`、`keymap.js:25`、`network-config.js:23`、`reasoning-config.js:23`、`runtime-policy.js:23`）。

⇒ **W4a 不新建 service 层**。理由：多一层适配器就是第二个抽象，而现有形态已经满足"形状单源"；W4a 只按同一形态加族。这条也纠正了后续包对该文件的假设（W5/W6 若按 plan §P2 找文件会找不到）。

### 0.3 四个落点现状（自写校验 + 各自回落链）

| 落点 | 文件/行 | 现状校验 | 现状 data root 回落链 |
| --- | --- | --- | --- |
| `user-prefs` | `routes/user-prefs.js:21-45` | 自写 `sanitize`：`THEMES`(system/light/dark)、`ACCENTS`(teal/blue/violet/rose/amber，注释自认曾漏 blue)、`fontScale` 钳 0.8–1.4 且 `===1` 不入盘 | `PETRI_LOCAL_DATA_DIR` → `LOCAL_DATA_DIR` → `cwd/data`（`:56-58`） |
| `mcp-servers` | `helpers/mcp-settings.js:20-21` | 自写 `normalizeServerEntry`（`:36-60`）：id 禁空白/斜杠、command 必填、transport stdio\|http、http 必带 url、args≤64、servers≤50 | `PETRI_LOCAL_DATA_DIR` → `~/Documents/Petri-Local`（**不认 `LOCAL_DATA_DIR`，也不认 `PETRI_USER_DATA_DIR`**） |
| `agent-rules` | `helpers/agent-user-rules.js:34-37` | 内联 filter（`:51-60`）：id 非空 + matcher.pattern 字符串 + action ∈ deny\|require-ack；3s mtime 缓存；fail-soft | `PETRI_LOCAL_DATA_DIR` → `PETRI_USER_DATA_DIR` → `~/Documents/Petri-Local` |
| `skills-prefs` | `core/shared-backend/skill-prefs.js:28-32` | 只校验 `disabled` 是 object；版本字段 `PREFS_VERSION=1` 未校验 | `PETRI_USER_DATA_DIR` → `~/.petri`（**只认 USER_DATA**） |

⇒ 四个落点 **4 条互不相同的回落链**，同一"数据目录"可以是 4 个不同实际目录——这正是 W4b 要搬的东西。W4a 只收编读写形状，**不动根**（红线 §4）。

### 0.4 `ai-settings` 顶层未知键仍是"报告不拒"

`helpers/ai-settings.js:230-243`：`saveAiSettings` = `{ ...prev, ...extracted.settings }` 整坨合并 + `normalizeAiSettings`，**顶层键无白名单**——写了不存在的顶层键会永久存活，`commitGuard` 只覆盖 `generation`/`reasoning`/`costCapCny` 这些已注册子路径。BLOCK-199 §12 已如实登记「拒它会破坏设置页整坨写入」；W4a 要在**不破整坨写入**的前提下把这条堵上（§8 D-W4a-3）。

### 0.5 renderer `localStorage` 是第二套键集

`frontend/src/themes/ThemeProvider.tsx:22/64-70/94-118/172-189`：主题/字号/强调色**双写** localStorage（注释已声明"仅作启动缓存"），另有 4 个 legacy 键只读迁移；`accents.ts:32` 有 `ACCENT_STORAGE_KEY` 第三处引用。⇒ 同一个偏好存在 3 套键名（localStorage 键 / `user-prefs.json` 字段 / 前端常量），且 localStorage 值未经注册表校验（手改 localStorage 可注入非法 accent，虽被 `ACCENTS` 兜住，但兜底逻辑在前端第二份）。

### 0.6 D-2 rider 实锤

`frontend/src/components/desktop/DesktopSettingsPanel/useEndpointProfilesEditor.ts:381`：`window.confirm('导出文件将包含 API Key 明文…')` 后 `readCredential` 逐渠道读 Key 并**明文写入下载文件**（`:381-397`）。该路径**不经** `config-transfer` 的排除清单（独立前端路径）⇒ runlist D-2「凭据永不明文入快照/导出」在 models 导出处是破的。BLOCK-201 只登记不接管（其 plan §4.2），W4a 接手（同一导出/设置语义面，分开做会二次触碰同一块）。

## 1. 判定：patch vs refactor（逐落点）

| 落点 | 判定 | 理由 |
| --- | --- | --- |
| `user-prefs` | **patch + 收编** | 校验规则可完整表达为注册表键域（枚举/区间），自写 `sanitize` 是第 N 份同构实现，删掉换 schema 调用即可；磁盘形状不变 |
| `skills-prefs` | **patch + 收编** | 只有 `disabled` 映射 + `version`；id 空间属 skill-registry，注册表用占位段只校验形状（先例：`point.*.threshold`、`keymap.<command>`） |
| `agent-rules` | **refactor（局部）** | 条目校验内联在读取函数里，写侧另有一份（`saveUserRules`）；两处需收成**一份字段注册**，否则又是两份会漂移的规则 |
| `mcp-servers` | **refactor（局部）** | 同上，且基线能力（集合形状）schema 现在没有——需给地基加 `collection` 形状（**唯一一处给地基加能力**，须契约测 + 冻结） |
| `ai-settings` 顶层 | **patch** | 不改存储形状，只加白名单过滤与诊断出口 |
| renderer localStorage | **patch** | 缓存定位本来就对（注释已声明），要做的是钉住键名同源 + 丢掉前端第二份校验 |
| D-2 rider | **patch** | 只改导出默认姿态与确认流程 |

**不做的取舍**：不把 `agent-rules`/`mcp-servers` 的数组塞进现有的标量键注册表硬掰（会导致"假键路径"与占位段滥用）；改为同一 `CONFIG_KEYS` 数组里的 `family` + `item` 标记承载条目字段，`findEntryByPath` 语义不变。

## 2. 拆片：为什么 W4a 先、W4b 后（D-W4a-1）

| 片 | 范围 | 风险 | 可回退性 |
| --- | --- | --- | --- |
| **W4a（本片）** | 6 个纯文件/GUI 落点收编 + ai-settings 顶层语义 + localStorage 并入 + D-2 rider | 低-中 | 逐落点独立：每个落点一个切片、一批测试，红了只回退该切片，磁盘形状零迁移 |
| **W4b（后续片）** | SQLite `site_settings` / `runtime_json` / `state_json` / `users.permissions` / 主进程窗口态 + 4 条 data root 合一 | 中-大 | 需要一次性窗口 + 备份/回退路径；搬错=用户数据落错目录，不可逐点回退 |

混在一包里出事时无法定位是哪一层（文件适配器还是磁盘搬迁），且 W4b 的根统一会改变全部 10 个落点的**实际路径**，先做 W4a 等于先让"形状"统一、再让"位置"统一——两步都可独立验证。**Plan ID 复用 BLOCK-203**，用 phase（P1–P8 = W4a；P9–P10 = W4b）区分，不新建第二个 active 文档（`truthDomain` 唯一）。

## 3. 切片与文件面

- **P1** `core/packages/shared-config/config-schema.js`：+`user-prefs` 族（3 键）+ `CONFIG_COLLECTIONS`/`item` 形状（`agent-rules`、`mcp-servers` 条目字段）+ 集合诊断/写侧守卫函数。
- **P2** `core/petri-server/routes/user-prefs.js`：`sanitize` → schema `validateValue`；写侧 `commitGuard` + 400 diagnostics（保留"无变化不写盘"与原子 rename）。
- **P3** `core/shared-backend/skill-prefs.js`：`disabled`/`version` 键声明 + 写侧形状校验。
- **P4** `core/petri-server/helpers/agent-user-rules.js`：`loadUserRules` 内联 filter 与 `saveUserRules` 校验收成一份字段注册；first-match/fail-soft/3s 缓存零改动。
- **P5** `core/petri-server/helpers/mcp-settings.js`：`normalizeServerEntry` 改由字段注册驱动；`env` 仍走密文；上限常量进注册表 `domain`。
- **P6** `core/petri-server/helpers/ai-settings.js`：`saveAiSettings` 顶层白名单过滤 + `diagnostics` 回传（响应体 additive 字段）；`config:doctor` 增顶层未知键检查。
- **P7** `frontend/src/themes/ThemeProvider.tsx` + `accents.ts`：缓存键名常量化并加漂移测；非法缓存值丢弃；legacy 键迁移后删除。
- **P8** `useEndpointProfilesEditor.ts`：默认脱敏导出 + 明文需二次确认；`settingsFamilies`/`config-transfer` 覆盖新可导出族；`config:doctor` 与四向漂移门扩族。
- **提交粒度约束（P1 与 P2 必须同提交）**：`quality:knip:check` 是"新增导出即红"的棘轮——P1 给 schema 加的集合诊断/条目守卫函数若没有同批消费方，单一 P1 提交会被 knip 判红。故落地序=**P1+P2 同提交**（schema 能力 + `user-prefs` 首个消费者），之后 P3/P4/P5 各自带自己的消费者。
- **另**：`docs/stage-3-4-execution-runlist.md`（口径更正）、`docs/block-199-config-schema-service-plan.md`（§5 红线 11→10 + §P2 config-service 存在性更正，只改事实不改历史结论）、`test/impact-map.json`。

## 4. 红线与非范围

- **不迁移磁盘形状、不改文件名、不改键名**（旧文件不迁可读是验收条款）。
- **不动 data root 回落链**——四条链的合一属 W4b；本片任何落点的实际路径必须与改前逐字节相同（用"改前/改后写到同一绝对路径"的回归测钉住）。
- **不合并凭据**：`env`/Key 仍密文、仍不入快照/导出（`ai-settings.js:11` 红线）。
- **不改既有语义**：`sanitize` 的钳位边界、`first-match` 判序、`fail-soft`、`REQUIRE` 动作集合、`MAX_ARGS`/`MAX_SERVERS` 数值一字不动。
- **不为收编而给设置页加不必要的 400**：`ai-settings` 顶层走过滤+诊断，不 400（§8 D-W4a-3）。
- **不碰**：SQLite 四落点、主进程窗口态、W5 工具策略、W6 记忆/压缩、G1+（Provider/公证/GA 属 G1+，G0 期不外推）。

## 5. 验收证据与门禁

- 契约测：`test/block203-config-baseline.test.mjs`（扩容后族/键集合冻结 + 前 8 族逐键不变）、`test/block203-user-prefs.test.mjs`（三键合法/非法/清键/未知键 400/路径不变）、`test/block203-collections.test.mjs`（条目字段注册 + 未知字段诊断 + 集合守卫）、`test/block203-skills-agent-mcp.test.mjs`（三落点语义回归）、`test/block203-ai-settings-root.test.mjs`（顶层白名单 + 诊断 + 旧脏键自愈）。
- 前端：`ThemeProvider.localStorageKeys.drift.test.ts`（键名 ↔ 注册表）、导出脱敏 `useEndpointProfilesEditor.d2.test.ts`。
- 门禁：`npm run config:doctor`、BLOCK-199 四向漂移门（扩族后）、`config-transfer` 往返、`test:changed`、`quality:secret`、closeout 十三门。
- 证据落点：`acceptance/block-203/`（本片为纯后端/前端测，无 UI 交互新增 ⇒ 暂不需要 9223 实机腿；若 P7/P8 触碰可见 UI 行为，按 D-6 走 9223 离屏探针）。

## 5.1 已核实的拆前基线（2026-10-17 实跑，P1 动手前）

```
node --test --test-force-exit --test-timeout=120000 \
  test/block201-settings-baseline.test.mjs test/block199-config-drift.test.mjs
→ 10 tests / 10 pass / 0 fail
```

其中两条**冻结断言**会在 P1 加族时变红，属**预期内的基线上调**，必须显式改并留因，不得当废测删：

- `BLOCK-201 — 配置注册表冻结：8 族 / 35 键` → P1 加 `user-prefs` 族后改 9 族 / 38 键，提交说明写明"新增哪族哪几键"；
- `设置分区清单冻结：10 个分区 id` / `导出族集合 == 注册表族集合` → 若新族 `ui:'settings'` 则须同时接设置面承载与 `config-transfer`，否则这族会以"注册了但 UI 不承载"的形态触发 BLOCK-199 漂移门（漂移门正是为此存在，**不许把它改成豁免**）。P1 的默认选择=`user-prefs` 标 `ui:'none'` + 在漂移门登记"该族由主题面而非设置页承载"，等 P7 把主题缓存接好后再评估是否升 `ui:'settings'`。

## 6. 完成语义与覆盖率口径

- 本片完成 = 文件落点收编完成。**覆盖率记两个数，不许只报一个**：
  - 按 BLOCK-199 的记账法（4/14 起步）：本片 +6 ⇒ **10/14**；
  - 按本 plan §0 的逐条枚举（3 已收编文件族 + 本片 4 文件族 + ai-settings 顶层 + localStorage）：**8/14**；
  - 差额=BLOCK-199 把 `generation`/`cost-cap` 记成两处还是同一处 `ai-settings.json` 未交代清楚——**本片不替它裁定**，两个数同时写，禁止用较大的那个宣称"配置已统一"。
- 未收编 4–6 处（SQLite 四 + 主进程窗口/路由态）**明确留给 W4b**，本片收口报告必须点名。

## 7. 回退路径

每个切片独立提交（`feat(block-203): Pn …`），红则 `git revert` 单切片；schema 扩容（P1 的 `collection` 形状）是唯一被后续切片依赖的改动，若它需回退则整片回退（其余切片都 import 它）。基线测 `block203-config-baseline` 在 P1 之后**只许加族不许改既有行**。

## 8. 决策留痕（开工前定死）

- **D-W4a-1**：W4 拆 W4a/W4b，Plan ID 复用 BLOCK-203（phase 区分）。依据=风险与可回退性不同（§2）；用户常驻授权连打，属主代理可自决范围。
- **D-W4a-2**：集合型落点（`agent-rules`/`mcp-servers`）用"条目字段注册"，**不用占位段假装标量键**。理由：占位段会让任意条目字段静默进盘（`keymap` 族已因此被迫逐命令显式登记，见 `config-schema.js:192-196` 注释），在数组条目上会放大成"任意字段都能活"。
- **D-W4a-3**：`ai-settings` 顶层 unknown-key 走**过滤 + 诊断**而非 400。理由：设置页整坨写入会把 GET 回来的未知键原样回传，400 会让"有历史脏键的用户保存不了任何设置"（回归风险），而过滤+诊断同样达成"磁盘不再长出未知键"的目标；**这是对 W0「写不进」规则的显式例外**，在此留痕并在 `config:doctor` 里可见。
- **D-W4a-4**：D-2 rider 取"默认脱敏 + 明文需二次确认"，**不删除**含明文导出的能力（用户可能需要迁移渠道到别的机器）。理由：默认值取最保守档（D-1），但删能力属于功能收缩，需要单独裁决。
- **D-W4a-5**：renderer 缓存键名用漂移测钉住，**不让前端 import `core/**`**（生产代码跨层引用会被 `quality:arch` 拦，且前端已有 `appKeymap.drift.test.ts` 只让测试跨层的先例）。

## 9. 进度（执行中回写）

- ✅ **P1+P2（2026-10-17 同批落地）**：schema 加 `user-prefs` 族（theme/fontScale/accent，注册表 8 族/35 键 → **9 族/38 键**）；`routes/user-prefs.js` 的自写 `sanitize` 下沉为 `helpers/user-prefs.js`（store 单源，形状读注册表）；写侧**未知键 400 + 整批不落盘**，已注册键的非法值仍是 BLOCK-86 的消毒语义（钳位/丢键，诊断 additive 回传）；`config-transfer` 族集合扩该族（导出/导入/按区重置 + 从排除清单移除 `appearance-and-user-prefs`）；`config:doctor` 纳入该落点（路径问 helper，不自猜第五条回落链）。
  - 顺带实测到 W4b 的必要性：doctor 在无 `PETRI_LOCAL_DATA_DIR` 时真实打出 `feature-flags/... → ~/Documents/Petri-Local` 而 `user-prefs → ./data`——**同一个「配置目录」当场分成两个**，这正是 W4b 要合的 4 条链。
  - 证据：`test/block203-user-prefs.test.mjs` 8/8（路径不变/消毒语义冻结/未知键 400 且文件逐字节不变/读侧宽容/重置只清覆盖层/枚举域与前端同源/导入更严）+ 邻域 `block201-config-transfer` 9/9、`user-prefs`（BLOCK-86）1/1、`block201-settings-baseline` 4/4、`block199-config-drift` 6/6；`quality:knip:check` PASS、`quality:types` 0、lint 0 error。
  - 基线变更留因：`block201-settings-baseline` 的 8 族/35 键按新增族显式上调为 9/38（测试内写明理由）；`block201-config-transfer` 的「排除清单 ≥4 条」改为**断类别不断条数**（外观移出排除清单后条数 4→3，计数断言会惩罚正当改善——BLOCK-196 撞过的同型毛病）。
- 🔎 **P3 勘察（已做，三条开工前必须先定的机制问题——不许边写边绕门）**：
  1. **写入面不是 HTTP**：`skills-prefs` 的唯一写路径是 Electron IPC `skills:set-disabled`（`preload.js:383` → `src/main.js:258` → `skills-sdk.js:147` → `skillPrefs.setSkillDisabled`），`routes/` 里没有对应端点。而 BLOCK-199 漂移门的规则是「每族写路径必须能拒绝（route 源码含 `400`）」——对没有 HTTP 面的族，这条门现在只能靠**不登记**来假装通过。处置：P3 给漂移门加 `NON_HTTP_WRITE_FAMILIES` 一张表（断言该族**确实没有** HTTP 写入口 + 其写表面有明确拒绝码，例如 `skill_id_required`），让"每族都有会拒绝的写路径"对全部族成立，而不是只对能被 HTTP 命中的族成立。
  2. **`disabled` 不是布尔映射**：实码 `disabled[skillId] = { at, reason? }`，另有 `uninstalledSources[id] = { sourceDir, at }`（`skill-prefs.js:118-145`）。`findEntryByPath` 只寻址标量，故只能按**点路径**登记（`disabled.<id>.at` / `.reason`、`uninstalledSources.<id>.sourceDir` / `.at`、`version`），读取用 `flattenOneLevel`。
  3. **`mutable:false` 会制造读盘噪音**：`diagnoseObject` 对非 mutable 键**每次读都**报 `READ_ONLY`，而 doctor 把非 UNKNOWN_KEY 一律归入"非法已存值"——若把 `version`/`at` 登记成 `mutable:false`，每次 `config:doctor` 都会报一批假非法值。开工前必须先给 schema 一个"代码侧字段"语义（新增 `owner:'code'` 或让 doctor 过滤 READ_ONLY），**不许靠给字段写 `mutable:true` 糊过去**（那等于允许用户改写版本号与时间戳）。
- ⬜ P4 `agent-rules`（含集合形状进 schema）· ⬜ P5 `mcp-servers` · ⬜ P6 `ai-settings` 顶层 · ⬜ P7 localStorage 并入 · ⬜ P8 D-2 rider
