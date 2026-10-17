---
capability: settings-quickwins-keymap-effort
goal: BLOCK-200 = 阶段 A 速赢 I（runlist W1）＝ P0-1 快捷键设置面 + P0-5 推理档位可编辑。现状事实（§0 实码抽验）：键位面是**三份互不复用的显示文本 + 零注册表零派发器**——`CommandPalette.tsx:13` 的 `shortcut` 只是自由文本徽章、`:66` 另有第二份硬编码 `SHORTCUTS`、`:383-391` 唯一真绑定写死 `e.key==='k'`，而 `useAppCommands.ts:71` 的 `nav-home` 挂 `⌘N` 徽章却全仓无 Cmd+N 处理器（UI 向用户承诺了不存在的快捷键），真实绑定散落 12+ 处各自独立且无任何可改键持久化形态；推理档位侧是**词表前后端各一份 + 映射与预算全硬编码且不在 BLOCK-199 注册表内**（`thinking-level.js:38/41/44/73-85` vs `thinkingLevel.ts:15/17/20/78` + 三处内联 union），且该链路记录过「composer 显示高、请求体发 standard」的显示与事实分离缺陷（`useChatStream.ts:359-363`）。本包把两族建成 BLOCK-199 地基的**第一个真实消费者**：键位单源注册表 + 全局派发器 + 冲突检测 + 恢复默认，档位默认值/预算/协议映射改为注册表声明且设置面可编辑，跨端词表收敛为一份。
acceptance:
  - P1 键位单源与派发：`keymap` 族（键路径 `keymap.<command>`，值=规范化组合串）+ 全局派发器读注册表而非徽章文本；解析/序列化/修饰符规范化/冲突检测/恢复默认全为纯函数并各有契约测；徽章由注册表派生，三份显示文本收敛为一份（反证=装饰徽章 `⌘N` 要么真绑上要么不再显示）。
  - P2 档位与映射可编辑：`reasoning` 族（`reasoning.defaultLevel` oneOf、`reasoning.anthropicHighBudgetTokens` number 域、`reasoning.mapping.<protocol>.<tier>` oneOf 该协议允许实参）；`thinking-level.js` 的硬编码 switch 改查表且**默认表逐字等于现状映射**（拆前基线冻结）；前端词表/标签/循环消费跨端单源，三处内联 union 副本删除后 `quality:types` 仍绿。
  - P3 设置面两分区与写侧出口：HTTP GET/PUT 复用既有唯一写路径形状（`ai-settings-api.js` 同构：拒 → 400 + `diagnostics`，env 遮蔽 → 409），分区登记进 `DesktopSettingsPanel/types.ts`；`config:doctor` 能点名两族的未知键与被遮蔽项。
  - P4 漂移门扩族与出站腿：`test/block199-config-drift.test.mjs` 的 `UI_CARRIERS`/`WRITE_ROUTES` 加入两族并**先红后绿实证**（证明门能抓）；档位改动断言打到**出站请求体**形状（gateway 出参），不打 UI 状态；UI 腿走 9223 测试实例自动探针出图（禁导航主窗 9222）。
  - P5 兼容与收尾：不动 BLOCK-199 冻结基线测；`validateValue` 只补 `domain.pattern` 一处通用能力，**不给地基加 map 类型**（不长第二套形状）；`impact-map` 为本包新增面补规则不留 fail-closed 盲区；`npm run closeout` 十三门 + 五件套回写。
  - 完成语义：交付的是**应用级命令键位可改 + 档位映射可编辑**，不宣称「全部快捷键可改」（12+ 处组件内就近绑定刻意不迁移，§4 点名）；UI 实机腿未过记 `in_progress` 不标 verified。
reopen: 组件内绑定的分批收编（Cmd+S/Cmd+Enter 类需先有「焦点态门」表达，属键位系统 v2）、键位方案（profile）与多端同步、设置搜索/导出/按区重置=P0-3（runlist W2，载体是本包与 BLOCK-199）、Vim/Emacs 键位模式（未裁决）。
status: active
---

# BLOCK-200 · 阶段 A 速赢 I（P0-1 快捷键设置面 + P0-5 推理档位可编辑）

执行序位置=`docs/stage-3-4-execution-runlist.md` 的 **W1**（W0=BLOCK-199 配置地基已 completed 2026-10-17）。
用户授权（常驻）：「非常好 尽可能的推进更多的内容 不要问我所有工作决策你来定」+「很棒 能否做个plan 一次性 推完呢」⇒ 按序连打，不需逐项发令。

## 0. P0 勘察结果（子代理只读盘点 + 主代理逐条实码抽验；BLOCK-195/198/199 三次纠正子代理错路径，本次关键断言我自己读到行号）

### 0.1 P0-1 快捷键面：现状是**三份互不复用的显示文本 + 零注册表零派发器**

- `frontend/src/components/copilot/CommandPalette.tsx:13` `CommandItem` 形状=`{id,label,description?,icon,shortcut?,action,category?}`，其中 **`shortcut` 只是自由文本徽章**（`:341` 渲染），没有键对象、没有冲突元数据。
- `CommandPalette.tsx:66` `SHORTCUTS` 是**第二份**硬编码显示清单（⌘K 命令面板 / ⌘N 新建对话 / ⌘/ 显示帮助）。
- `useAppCommands.ts:71` 只有 `nav-home` 带 `'⌘N'` 徽章，其余 14 条无徽章。**全仓无 Cmd+N 处理器**（grep `addEventListener('keydown'` 逐处读过），所以那两枚徽章是**装饰**——UI 告诉用户「⌘N 新建对话」，按下没有任何反应。
- **不存在全局 keydown→command 派发器**：`useCommandPalette`（`CommandPalette.tsx:383-391`）自带一个硬编码 `if ((e.metaKey||e.ctrlKey) && e.key === 'k')`，是唯一"由命令面自己按住的键"。没有任何代码读 `commands[].shortcut` 去派发。
- 真实绑定散落 **12+ 处各自独立**、全部不经 `useAppCommands`：`App.tsx:226-231`(Cmd/Ctrl+Shift+C)、`hooks/useWorkspacePanelShortcuts.ts:18-29`(Cmd/Ctrl+\`、Cmd/Ctrl+Shift+B)、`SimpleChat.tsx:516-525`(Cmd/Ctrl+T 档位循环，且 `:505` 有 capability 门)、`RightFileTree.tsx:660/669/676`(Cmd/Ctrl+W、Cmd/Ctrl+Shift+T、Ctrl+Tab)、`WorkspaceFilePreview.tsx:278`(Cmd/Ctrl+S)、`ResultAgentComposer.tsx:101` 与 `ReviewMode.tsx:1309/1347`(Cmd/Ctrl+Enter)、Escape 类 12 处（`project-workspace.tsx:267/290`、`BranchTabs.tsx:68`、`ThemeControl.tsx:37`、`Lightbox.tsx:32` 等）、原生菜单加速器 `src/main/_app-menu.js:43`、`src/main/_window-ipc.js:140-142`。
- **无任何持久化/可改键形态**：grep `keymap|keybinding|userShortcuts|shortcuts.json|accelerator` 在 `frontend/src`+`src`+`core/petri-server` 只命中 CodeMirror 的 `keymap.of`（`useCodeMirrorEditor.ts:241`，编辑器自有概念，不并入）。

### 0.2 P0-5 推理档位：档位词表**前后端各一份**，映射与预算**全硬编码**

- 后端单源在 `core/shared-backend/llm-providers/thinking-level.js`：`:38` 档位 `['off','standard','high']`、`:41` 默认 `standard`=什么都不发、`:44` `ANTHROPIC_HIGH_BUDGET_TOKENS=16000` 硬编码、`:73-85` **协议 switch 硬编码映射**（openai-compatible→`reasoning_effort: minimal|high`，anthropic→`thinking.budget_tokens`，DeepSeek→`enable_thinking`），`:71` capability 门，`:107-114` 去参重试的 `isUnknownParameterError` 正则。消费点 `model-gateway.js:233-242`（合并）与 `:281-285`（400 后去参重试一次）、`routes/ai-agent/chat.js:21/58/289/351`。
- 前端**第二份词表**：`frontend/src/components/copilot/thinkingLevel.ts:15` 档位、`:17` 默认 `standard`、`:20` 中文标签、`:78` 循环顺序、`:26-30` 会话级 localStorage 持久化；另有三处**内联 union 副本**（`conversationRunStore.ts:110`、`copilotClient/types.ts:147`、`SimpleChat/hooks/useChatStream.ts:134`）。
- **该族不在 BLOCK-199 注册表内**（grep `config-schema` 消费者只有 ai-settings/cost-cap/decision-config/feature-flags）⇒ 档位与预算是"配置面之外的两个硬编码值"，设置页改不到、`config:doctor` 也看不见。
- `useChatStream.ts:359-363` 的注释记录过一次**真缺陷**：`thinkingLevel` 漏在 `send` 的 deps 数组里，改档后闭包仍拿挂载时的值 ⇒ **composer 显示「高」、请求体发 `standard`、上游收不到 `reasoning_effort`，档位静默失效**。这条已修，但它说明该链路"显示真值分离"的风险等级，验收必须打到出站请求面。

### 0.3 可复用的既有形状（不新建第二套）

- 设置面写路径唯一真相=**HTTP**：`DesktopSettingsPanel/sections/GenerationDefaultsPanel.tsx:28`(GET)/`:66`(PUT) → `routes/ai-settings-api.js:59/:67`（`:73` 把 `config_value_rejected` 映射 400）→ `helpers/ai-settings.js:343/:356(commitGuard)/:371(fs.writeFileSync)`。开关族变体=`settings/ExperimentalFeaturesSection.tsx:134/153` → `routes/feature-flags.js:12/21`（env 遮蔽回 409）→ `helpers/feature-flags.js:121(setFlag)`。IPC 只用于 ai-settings 的 profile CRUD；新增通道须先登记 `src/ipc/channels.js:4-8` 再加 `preload.js` 同名包装（`test/ipc-channels-registry.test.mjs` 双向守护）。
- 设置分区清单=`DesktopSettingsPanel/types.ts:34-44`，挂载 `DesktopSettingsPanel.tsx:667`，路由 `App.tsx:172`。
- BLOCK-199 地基 API=`core/packages/shared-config/config-schema.js:302-315` 导出面；**新族必须过四向漂移门**（`test/block199-config-drift.test.mjs:26 UI_CARRIERS`、`:33 WRITE_ROUTES`、`:58` 集合相等）。`validateValue`（`:167-192`）现只支持 boolean/number/string 三型：string 域只有 `oneOf`，**没有 pattern**；number 有 min/max/integer/round。
- `findEntryByPath`（`:157`）**已支持占位段**（`point.*.enabled` 靠 `entry.path.includes('<point>')` 匹配）⇒ 键位可用 `keymap.<command>`、档位映射可用 `reasoning.<protocol>.<tier>`，**不需要给地基加 map 类型**（避免为了新族长出第二套形状）。

## 1. 判定：patch 还是 refactor（治理 skill 要求写进计划，不留事后）

**P0-1=refactor（新建单源，不在散落监听器上继续叠条件）**。三条信号全命中：①"可改键"是既有概念的**第一个真实体**（现状三份显示文本 + 12 处硬编码，继续在各组件叠 `if (userKey)` 就是十二份特例）；②补丁必须**绕过**已有形状（徽章文本与派发事实本来就分离）；③同族知识重复（`⌘K` 在三处各写一遍，两处是装饰）。
**刻意不做的重构**：不迁移那 12 处组件内绑定（Escape/Tab/Cmd+S/Cmd+Enter 属**就近语义与输入态门**，抽进全局注册表会把"焦点在输入框时不响应"这类局部条件搬成全局特例，属过度设计）——本包只把**应用级命令**收进注册表，其余如实点名不藏（§4）。

**P0-5=patch + 收编**（档位词表与映射**已有后端单源** `thinking-level.js`，前端三份副本是漂移不是缺失）：词表升为**跨端单源**（经 `core/packages/**` 合法共享层被前端消费，R4 明写该层合法），映射表与预算改由 BLOCK-199 注册表声明形状 + 落盘可编辑；不改任何默认出站形状。

## 2. 立项自检（对标不改魂）

「这个能力与 ZCode/Codex 的差别在哪？」——①**本地可审计**：键位与档位都是**用户机器上的明文 JSON + 结构化 diagnostics**，`config:doctor` 能点名未知键与被 env 遮蔽的项，不藏在厂商云侧；②**治理透明**：新族接入即受四向漂移门（注册表↔设置面↔写路由 4xx↔运行时集合）与写侧统一拒绝约束，是 BLOCK-199 地基的**第一个真实消费者**（地基不接真族就是空转）；③**证据自证**：档位腿打到**出站请求体**（`outbound_contains` 形状），因为该链路有「显示与发送分离」的既往缺陷（§0.2），只测 UI 状态等于没测。

## 3. 切片

- **P1 键位单源与派发**：`keymap` 族（`keymap.<command>` = 组合串，默认值由命令注册表给）+ 全局派发器（读注册表，不读徽章文本）+ 冲突检测 + 恢复默认；徽章由注册表派生 ⇒ 三份显示文本收敛为一份。**键位语法**沿用现有显示写法（`Mod` = Mac 用 Cmd / 其他用 Ctrl），解析与序列化纯函数 + 契约测。
- **P2 档位与映射可编辑**：`reasoning` 族（`reasoning.defaultLevel` string oneOf、`reasoning.anthropicHighBudgetTokens` number 域、`reasoning.mapping.<protocol>.<tier>` oneOf 该协议允许的实参）；`thinking-level.js` 的硬编码 switch 改查表（**默认表逐字等于现状映射**，由拆前基线冻结）；前端词表/标签/循环改为消费共享单源，删三份内联 union 副本。
- **P3 设置面两分区 + 写侧**：HTTP GET/PUT（复用 §0.3 形状），拒绝回 400 + diagnostics、env 遮蔽回 409；分区登记进 `DesktopSettingsPanel/types.ts`。
- **P4 漂移门扩展 + 实机腿**：`test/block199-config-drift.test.mjs` 的 `UI_CARRIERS`/`WRITE_ROUTES` 加两族（**门先红后绿**，证明它能抓）；9223 测试实例自动探针出键位分区与档位分区截图与断言 JSON。
- **P5 五件套回写 + closeout 十三门**。

## 4. 范围与非范围（红线）

**范围内**：应用级命令键位（命令面板 ⌘K、导航、设置深链、新建对话、工作区面板折叠等**注册表里的静态命令**）；档位默认值/预算/映射可编辑与跨端词表单源；设置面两分区；写侧守卫与诊断出口；漂移门扩族。

**非范围（点名不藏）**：
- **12+ 处组件内绑定不迁移**（Escape 类、Cmd/Ctrl+S、Cmd/Ctrl+Enter、Ctrl+Tab、Cmd/Ctrl+W、Cmd/Ctrl+Shift+T、`useComposerFocus.ts:44` 裸键聚焦、`_app-menu.js`/`_window-ipc.js` 原生加速器）——本包不宣称「全部快捷键可改」，交付说明必须写「应用级命令键位可改，就近语义绑定保持组件内」。
- 不做键位方案/profile 多端同步、不做 Vim/Emacs 键位模式、不做 CodeMirror 内部 keymap 并入。
- 不改 provider 凭据面（`ai-settings.js:11` 明文 key 永不入快照），不新建第二套 judge 或档位语义，不改 model-gateway 的 400 去参重试语义。
- 不动 BLOCK-199 的拆前基线测（`test/block199-config-compat.test.mjs` 冻结）；新增族的默认值**逐字等于现状硬编码值**（D-1 敏感项最保守）。
- 不推 i18n／hooks 产品化（⛔ 待裁决），不碰 G1+（Provider/公证/GA/远程发布）。
- 探针禁导航用户主窗 9222；UI 腿一律走 9223 测试实例。

## 5. 验收门（机械，逐条可复跑）

1. 拆前基线（先写先绿，此后冻结）：`thinking-level.js` 现映射逐协议逐档位快照 + `useAppCommands` 现徽章文本快照。
2. 键位纯函数契约测：解析/序列化往返、修饰符顺序规范化、冲突检测（同组合两次命中即报）、恢复默认、非法组合拒（如裸 `Shift`）。
3. 派发腿测：注册表驱动的真实派发（含"徽章文本改了、派发事实必须跟着改"这条**显示—事实一致**断言；反证=装饰徽章 `⌘N` 现在要么真绑上要么不再显示）。
4. 档位腿测：映射表默认值=现状；`reasoning.defaultLevel` 与预算改动**确实进出站请求体**（打到 gateway 出参形状，不打 UI 状态）；未知协议/档位组合被 `commitGuard` 拒并回 400 + diagnostics；前端消费单源（内联 union 副本删除后类型门 `quality:types` 绿）。
5. 漂移门扩族后 `--check`：两族未登记设置面或写路由时必须红（红→绿实证），env 遮蔽 409。
6. `test:changed`（impact-map 须为本包两个 helper/前端新目录补规则，不得留 fail-closed 盲区）+ `closeout` 十三门全绿 + `docs:check` + `ui:audit:check`（每个 UI 增量同行登记 `UI-###`，实机腿未过记 `in_progress` 不标 verified）。
7. `output:judge` 收口自证（送判文本 ≤1500 字符窗口，goals 必须可从文本本身验证；timeout/降级如实报「未测量」，不当绿）。

## 6. 证据位置

`acceptance/block-200/`（探针截图与断言 JSON、派发与出站腿输出）；测试即证据，路径随收口写进 plan §7 与台账行。

## 7. 进度（滚动，收口时以实跑事实为准）

- [ ] P0 勘察（本 §0，已完成并经主代理实码抽验）
- [ ] P1 键位单源与派发
- [ ] P2 档位与映射可编辑
- [ ] P3 设置面两分区与写侧出口
- [ ] P4 漂移门扩族与 9223 实机腿
- [ ] P5 五件套回写与 closeout
