---
capability: q2b-web-access
goal: 给 agent 两个**默认关、逐跳受控、来源与成本可核**的联网能力——`web_search`（检索，走自建 SearXNG：不绑厂商、无需密钥、来源可审计）与 `web_fetch`（抓单页正文）——并把它们做成"用户显式授权才生效"的面，而不是"模型想搜就搜"。同时把出网口径做成唯一真源：协议/凭据/主机形态校验、私网与云元数据地址拒绝、DNS 解析后二次校验、重定向逐跳复检、文本类 content-type 白名单、超时与字节/字符三重上限、出网审计（访问了哪个主机、拿到多少字节、来源与成本）。
acceptance:
  - 零新依赖：出网只用 Node 内置 `fetch`/`dns`/`net`，不引 undici/axios 之类。
  - 唯一出网口：`core/petri-server/helpers/web-fetch-policy.js` 的 `guardedFetch` 是**唯一**发起外部请求的函数；工具层不得直接调 `fetch`。
  - 默认关 + 显式授权：新配置族 `web-search`（`file:web-search.json`）默认 `enabled=false`；未授权时工具返回**结构化拒绝**（`web_access_disabled`），不是空结果、不是静默失败、不是"搜过了"。
  - 未配置 ≠ 无结果：检索后端未配（`provider=none` / 无 SearXNG 地址）时返回 `web_search_not_configured` 并给配置路径。
  - SSRF 硬边界：协议仅 http(s)；URL 不带凭据；拒绝本机/内网/保留地址（10/8、172.16/12、192.168/16、127/8、169.254/16 含云元数据 169.254.169.254、100.64/10 CGNAT、::1、fc00::/7、fe80::/10、IPv4-mapped 形态）；主机名解析出的**任一**地址非公网即拒；**重定向逐跳复检**（Location 目标重新过全套校验）；域名黑白名单黑名单优先、白名单含子域。
  - 有界返回：只收文本类 content-type；二进制与超大响应拒收并说明原因；读体**流式**截断（不读完再截）；返回正文有字符上限且截断如实标注。
  - 来源与成本可核：检索结果每条带来源主机名；工具结果与出网审计带来源与成本（请求数/字节数）；前端在工具活动行渲染**来源标签**；审计只记"访问了什么、花了多少"，**不记正文**。
  - 设置面：设备级、**即时生效**（与「网络代理」需重启的语义分开：授权族独立成 `web-search`，不塞进 `network`）；文案照抄边界（默认关/审计/SSRF/白名单）。
  - 收口：Node 单测覆盖地址分类/URL 解析/黑白名单/DNS 私网/重定向逐跳/内容类型/字节上限/未配置语义；实机腿（隔离栈 + mock provider + 假 SearXNG）反证三件套——**关闭态真调用被拒**、**真实 API 授权后真检索成功且带来源**、**SSRF 目标被拒**。
status: active
---

# BLOCK-247 · Q2b：联网检索与抓取

> **一句话**：给 agent 两个**默认关、逐跳受控、来源与成本可核**的联网能力（`web_search` 走自建
> SearXNG，`web_fetch` 抓单页正文），并把它们做成"用户显式授权才生效"的面，而不是"模型想搜就搜"。

## 0. 交接摘要（换 agent 先读这一节）

- **当前状态**：`active`。P0–P5 全部落地并有单测；**P6 实机腿亮 21/21 + 暗 21/21 全绿**（见 §5）。
- **本包实现 + 证据已本地提交**（**不推送**）；接手者只剩 **P7 收口**：跑 `npm run closeout` 十三门 + canonical 回写核对 + 台账 UI-557 的 `in_progress`→`verified` 判定（唯一缺口＝来源标签 DOM 可见性，见 §5）。
- **不要**在本包里顺手做：G1+ 事项（Provider / 公证 / GA / 打包发布）、Q3 执行轨迹、Q6 批注域。
- **红线**（三条，最易破）：零新依赖；不建第二套出网通道（`web-fetch-policy.js` 是**唯一**出网口）；
  默认关 + 显式授权（未授权时工具返回**结构化拒绝**，不是空结果、不是静默失败）。

## 1. 范围与判据

| 项 | 判据 |
| --- | --- |
| 能力面 | `web_search`（检索）+ `web_fetch`（抓单页正文）两个只读外部请求工具 |
| 授权面 | 新配置族 `web-search`（`web-search.json`），**默认 `enabled=false`**；开启 = 用户显式授权出网 |
| 检索后端 | 只接**自建 SearXNG**（无需密钥、可内网、来源可审计）；厂商搜索 API 留后续 adapter |
| 抓取边界 | 协议仅 http(s)；拒本机/内网/保留地址/云元数据；**重定向逐跳复检**；只收文本类 content-type；超时 + 字节 + 字符三重上限 |
| 可见性 | 结果带来源主机名（前端来源标签）+ 成本（请求数/字节数）+ 出网审计（JSONL） |
| 非范围 | 厂商搜索 API、爬虫/多页抓取、PDF 解析、代理池、付费内容 |

## 2. 架构（谁负责什么）

```
core/petri-server/helpers/web-fetch-policy.js   ← 唯一出网口：URL 校验 / 地址分类 / 逐跳复检 / 有界读体 / HTML→文本
core/petri-server/helpers/web-search-provider.js← 检索后端抽象（当前只 SearXNG）：归一化 + 黑白名单过滤 + 成本计量
core/petri-server/helpers/web-search-config.js  ← 授权与预算（读写 web-search.json；默认关；快照给前端）
core/petri-server/agent-tools/web-tools.js      ← 两个工具：授权闸门 → 调策略层 → 有界返回 → 落审计
core/petri-server/agent-tools/tool-defs/web.js  ← 工具 Schema（描述里写明"默认关"）
core/petri-server/routes/runtime-config.js      ← GET/PUT /api/web-access（设备级，即时生效，无"需重启"话术）
frontend/.../DesktopSettingsPanel/sections/WebAccessPanel.tsx ← 设置面（挂在"计算与数据"分区，紧邻网络代理）
```

**为什么单独建 `web-search` 族而不是塞进 `network` 族**：`network` 族是"往进程 env 写代理"的源头
（`applyNetworkEnv` 只在启动时被 Node 读，有"需重启"语义）；联网检索是**能力开关 + 预算**，
必须**即时生效**。混族会造出"设置页说要重启、其实早生效"的第二套真相。

## 3. 阶段与状态

| 阶段 | 状态 | 产出 |
| --- | --- | --- |
| P0 勘察 + 立项 | ✅ | 本文件；确认仓库**无**既有 web 工具（`search`/`read_page` 只读本地内容/插件） |
| P1 策略层 | ✅ | `web-fetch-policy.js`：地址分类（私网/环回/链路本地/CGNAT/ULA/metadata/IPv4-mapped）、URL 解析（协议/凭据/主机形态）、黑白名单、逐跳复检、有界读体（流式截断）、HTML→文本 |
| P2 授权与配置 | ✅ | `web-search-config.js` + 配置族 `web-search`（8 键）+ `/api/web-access` 路由 |
| P3 检索后端 | ✅ | `web-search-provider.js`（SearXNG adapter + 归一化 + 黑白名单过滤 + 成本） |
| P4 工具接入 | ✅ | `web-tools.js`（两个工具）+ Schema + 元数据（`external-request`/R1/`network.egress`）+ 事件来源标签（`tool-events.js` 的 `sourceLabelFromResult`） |
| P5 设置面 + 前端投影 | ✅ | `WebAccessPanel.tsx`（默认关文案/能力状态/诊断）+ 前端来源标签（`toolActivity.ts` `deriveSourceLabel` + `ToolActivityList.tsx` 渲染） |
| P6 实机腿 | ✅ | 亮 21/21 + 暗 21/21（隔离 9223；`acceptance/ui-557/`）——见 §5「实机腿当前态」 |
| P7 收口 | 🔵 进行中 | 台账 UI-557（`in_progress`，DOM 面缺证据）+ Q-MATRIX L1/L2 回写 + closeout 十三门 + 本地提交 |

## 4. 实码锚点（接手者可直接查）

- 唯一出网口：`core/petri-server/helpers/web-fetch-policy.js`（`guardedFetch` 是唯一发起外部请求的函数）。
- 授权默认值：`config-schema.js` 新族 `'web-search'`（`file:web-search.json`，precedence `['file','default']`，**无 env 层**）。
- 工具注册：`core/petri-server/agent-tools/registry.js`（HANDLERS + CONTRACTS，category `retrieval`、sideEffect `external-request`、resource `network.egress`）。
- 事件来源标签：`core/petri-server/agent-tools/tool-events.js` → `sourceLabelFromResult`（**先看 results[].source，再看顶层 source**）。
- 前端来源标签：`frontend/src/components/copilot/toolActivity.ts` → `deriveSourceLabel`；渲染在 `ToolActivityList.tsx` 的 `ActivityRow`。
- 设置面挂点：`frontend/src/components/desktop/DesktopSettingsPanel.tsx` → `activeSection === 'compute'` 分区（**不是 general**）。
- 审计落盘：`<PETRI_LOCAL_DATA_DIR>/web-access-audit.jsonl`（每行一次出网：工具/主机/状态/字节/拒绝原因/来源/成本）。

## 5. 阶段进度（换 agent 接手锚点）

### 已完成并有单测

- Node：`test/block247-web-policy.test.mjs`（13 条：地址分类/URL 解析/黑白名单/DNS 私网/内容类型/HTML→文本/本机与 rebinding 拒/重定向逐跳拒/字节上限/检索未配置与正常/结果过滤）、`test/block247-web-tools.test.mjs`（11 条：默认关拒绝、配置写侧守卫、诊断、审计落盘）。
- 前端：`WebAccessPanel.test.tsx`（面板渲染/默认关/开关切换）、`toolActivity` 来源标签单测。
- 夹具更新：`test/fixtures/tool-activity-labels.json` + `test/tool-activity-labels.test.mjs`（新工具的动词/图标）、`test/agent-tool-registry.test.mjs`、`test/block116-decision-platform.test.mjs`、`test/block157-skill-visibility.test.mjs`（工具数从 71 → 73）。

### 实机腿当前态（`scripts/block247-web-access-live.mjs` + flow `ui557-web-access-live.cjs`）

**最终态：亮色 21/21 + 暗色 21/21 全绿**（证据：`acceptance/ui-557/`——两份断言报告
`ui557-web-access-live.json` / `ui557-web-access-live-dark.json` + 两张设置面截图
`ui557-web-settings-{light,dark}.png` + 两份运行日志 `ui557-live-{light,dark}.log`；同份落 `acceptance/block-247/`）。

断言链（每条都有报告行）：

- `E1/E1b/E2/E3` 隔离栈（backend :3001 / vite :3000 / cdp :9223 / 独立数据根）+ 探针项目 + 合成 done job；
- `E4` mock provider 真被调用（5 次）；
- `W0a/W0b/W0c` 首启浮层 / 角色揭示 / 项目选中；
- `W1a/W1b` **默认关**（快照 `enabled=false`、能力 `search/fetch=false`）；
- `W1c/W1d/W1e` **设置面可见且开关为关**（`/settings?section=compute` 直达；面板文案含"默认关 / 每次出网入审计 / 拒本机与内网 / 重定向逐跳复检 / 只收文本类"）；
- `W2a` **关闭态真调用被拒**（审计行 `code=web_access_disabled`，带原因，不静默）；
- `W2b` provider 确实被调用（0 → 2）；
- `W3a/W3b` 经**真实 API** 打开授权后 `capabilities.search/fetch=true`；
- `W4a` **开启后真检索成功**（审计行 `ok=true` + `resultSources=[wiki.example.org, notes.example.net]` + `cost{requests:1,bytes:350,results:2}`）；
- `W4b` 来源可见（**审计面**取证 `audit=true`）；`W4c` DOM 面不可取证 → 如实标注 `dom_unavailable_renderer_busy`；
- `W5a` **SSRF 拦截**：抓 `169.254.169.254/latest/meta-data/` 被拒（`code=web_url_private_host`，被拒主机名入账）。

**仍缺一格（只剩"屏幕上看见来源标签"）**：

- `W4b` 的 **DOM 面**（活动行里来源标签肉眼可见）本轮取不到证据：渲染进程被 **ProjectWorkspace 既存重渲染环**拖住
  （CDP `Runtime.evaluate` 与 `/json/list` 双双超时、`body.innerText` 变空）。已用「**回退本包前端改动复跑**」
  （`git stash push -- frontend/src`）证明**与本包前端无关**。来源语义由**运行时账**（`resultSources`）+ 事件契约
  Node 单测（`tool-events.sourceLabelFromResult`）兜底；台账只记 `in_progress`，**不拿别的证据冒充"屏幕上看见了"**。
- 若要拿这一格，二选一：**(a)** 调换 mock 回合序（把 SSRF 探针放进前两次调用）；**(b)** 拆两个 Electron 会话
  （设置面取证 / 聊天回合各一）。

**本轮修掉的两个实机坑（都在 flow 侧，不在产品面）**：

1. **截图无界** → 整条 flow 挂死 40 分钟、报告根本没落盘：`lib.screenshotPng` 在渲染进程卡住时**永不返回**。
   已给 `capturePng` 加 20s 上限（超时记 `screenshot_timeout(renderer busy)`，不假装有图）。
2. **暗色轮出亮色图**：flow 里 `DARK`/`SUFFIX` 是**模块级 const**，在 `require` 时固化空值（脚本在 require 之后才设 env）
   → 暗色轮照样发亮色截图并覆盖亮色证据，而报告写着 `darkMode=true`。已改为**调用时读**（`isDark()`/`suffix()`），
   暗色轮重跑后截图确为暗色。

### 实机腿的四个坑（都已固化，别再踩）

1. **首启角色揭示浮层在导航之后才异步出现** → 截图/点击前必须 `ensureNoOverlay`（BLOCK-245/246/247 三包同款）。
2. **`?project=` 在项目列表装载前会被忽略** → 先等侧栏出现项目名，再带参二次导航（否则停在"先选择一个项目"）。
3. **flow 模块级 env 常量会在 require 时固化空值** → env 必须**调用时**读（`appUrl()`/`apiUrl()`/`auditFile()`/`searxngUrl()`/`isDark()`/`suffix()`）。
   **同一个坑踩了两次**（第一次是审计文件路径与 SearXNG 地址，第二次是 `DARK`/`SUFFIX`）——flow 里**任何** env 派生常量都别写成模块级 `const`。
4. **同一轮里完成"关闭态被拒 → 授权 → 成功"**：mock provider 用「已回灌工具结果条数」当回合进度，
   第 1 次工具结果后**等 marker 文件**再发第二次检索；这样只发一条用户消息，避开"第二轮发送撞上重渲染环"。
   本轮 3 次工具调用（W2a 拒 / W4a 成功 / W5a SSRF 拒）**都在同一轮内跑完**（此前第 3 次不发生——真因是上面那个无界截图把 flow 挂住，
   不是"两次调用上限"）。

### 本包改动清单（提交内容，**已本地提交·不推送**）

```
核心：core/packages/shared-config/config-schema.js（web-search 族 8 键）
      core/petri-server/helpers/web-fetch-policy.js | web-search-config.js | web-search-provider.js（新增）
      core/petri-server/agent-tools/web-tools.js | tool-defs/web.js（新增）
      core/petri-server/agent-tools/{registry,tool-defs,tool-events,tool-metadata}.js
      core/petri-server/routes/runtime-config.js（GET/PUT /api/web-access）
前端：frontend/src/components/desktop/DesktopSettingsPanel.tsx + sections/WebAccessPanel.tsx（新增）
      frontend/src/components/copilot/{toolActivity.ts,ToolActivityList.tsx,simple-chat.css,copilotClient/types.ts}
测试：test/block247-web-policy.test.mjs | block247-web-tools.test.mjs（新增）
      test/{agent-tool-registry,block113-tool-prerouting,block116-decision-platform,block157-skill-visibility,
            tool-activity-labels,block199-config-drift,block201-settings-baseline,block203-landing-registry}.test.mjs
      test/fixtures/tool-activity-labels.json（工具数 81→83）
      test/impact-map.json（block247 规则 + 脚本分类唯一归属）
治理：core/petri-server/helpers/config-transfer.js（web-search 族接入导出/导入/按区重置）
实机：scripts/block247-web-access-live.mjs（新增）+ .agents/skills/petri-dev-infra/dev-verify/flows/ui557-web-access-live.cjs（新增）
证据：acceptance/ui-557/、acceptance/block-247/（亮暗两轮报告 + 截图 + 日志）
```

## 6. 下一步（按顺序）

1. ~~**提交现有改动**（本地，不推送）~~ → **已在本轮提交**（收口后一次落库）。
2. ~~**跑完实机腿最后一格**~~ → **已跑绿**：亮 21/21 + 暗 21/21（§5）。
3. ~~**补台账**~~ → **已补** UI-557（`in_progress`：设置面/检索/SSRF 实机全绿，来源标签 DOM 面缺证据）。
4. ~~**Q-MATRIX**~~ → **已回写** `docs/qoder-essence-absorption-plan.md` L1/L2 行 + §6 Q2b 口径差异 + §2.5 现状表。
5. **收口**：`npm run test:changed` → `npm run closeout`（PATH 需含 Git `usr\bin` 与 `bin`；**别接管道**）→
   `npm run output:judge`（本次交付物是代码+文档，非对话输出，工具按用法需要 request/output 输入 → 未跑）→
   canonical 回写（plan §5 / roadmap / handoff / AUDIT-LOG / UI 台账）→ 本地提交（**不推送**）。
6. **下一位接手者可做（不阻塞收口）**：拿"来源标签 DOM 可见性"那一格（§5 二选一修法）→ 台账 UI-557 才能从
   `in_progress` 升 `verified`。

## 7. 诚实边界（写给下一位，别夸大）

- 抓取只收**文本类** content-type；二进制/大文件被拒并说明原因。
- 检索后端只有自建 SearXNG；**未配置 = 明确拒绝**（`web_search_not_configured`），不是"没搜到"。
- 云元数据/内网/本机地址被拒是**硬边界**，不可通过设置放开（黑白名单只作用于域名层）。
- 审计只记"访问了什么、花了多少"，**不记正文**。
- **provider 方言未暴露**：工具层只给 `web_search(query, count?)` / `web_fetch(url)`；`site/lang/after/before/oriQuestion` 等 SearXNG 方言**未映射**（本包不引入方言层）。
- **prompt-injection 隔离块未做**：抓取正文按不可信文本返回，但尚未做"引用块标注来源 + 指令隔离"的呈现层处理（reopen）。
- **每次出网审批未做**：授权是族级开关（默认关），不是逐次审批；`requireApproval` 类键位留给后续批次。
- **成本只进出网审计台账**，未并入 `ai_usage` 计量面。
- **`tool-router.js` 的 browser 域描述 claim drift 仍在**：描述里写着"网页浏览/搜索"，而本包把联网放进**新 `web` 域**（入 `DOMAIN_TOOL_DEFS`，按 `skill` 域先例**不**进 `TOOL_FAMILIES` 决策分类学，θ=0.80 校准契约不动）。改描述会动到已校准的决策类目文本，本包不动它（母纲已登记待修）。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
