# 任务:将 ZCode 的 Gen UI 能力迁移到本项目

> 把本提示词整段交给在本项目中工作的 AI 编码代理。目标:实现"AI 助手在聊天回复里输出一条指令,客户端把模型此前写好的 HTML 文件渲染为聊天流内的沙箱交互页面"的完整能力。规格内容来自对 ZCode 源码的实际分析,参考仓库(只读):`D:\1.WorkDir\reference\ZCode`。

## 1. 效果定义(最终验收形态)

1. 模型在助手消息文本中输出指令 `::visualize{"path":"<HTML文件绝对路径>","title":"可选","mode":"wide可选"}`;
2. 该 HTML 文件是模型事先用普通文件写入工具生成到"会话专属可视化目录"的 HTML 片段(fragment);
3. 助手消息完成后,客户端把文件渲染为聊天流内嵌页面:高度自适应内容(初始 240px、上限 10000px),`mode:"wide"` 时占满全宽;
4. 页面运行在沙箱 iframe 中:与宿主/聊天数据隔离,禁用 fetch/XHR/WebSocket,脚本仅能加载白名单 CDN 且被离线映射为本地文件;
5. 页面通过 `window.zcode` 桥获得:widgetState 读写(跨会话持久化)、追问消息、外部链接打开;
6. 放大预览/折叠不重载页面;深浅色主题自适应;单文件 ≤1MB。

## 2. 总体架构(六层,数据流)

```
模型输出文本(含 ::visualize 指令)
  → [A] 聊天解析器:切分 text/ui/pending/invalid(zod 严格校验)
  → [B] 聊天卡片:锚点 div + 沙箱页面绑定(React GenUiCard)
  → [C] 沙箱宿主(客户端主进程):读文件 → 包壳 → 独立 origin iframe → CSP/协议拦截
  → [D] guest 桥(iframe 内脚本):window.zcode = JSON-RPC over MessagePort
  → [E] 状态服务:widgetState 按 workspace/session/path 持久化
  → [F] 高度/呈现协议:内容高度回报、放大预览、Tweak
```

核心思想:**页面实例与消息组件解耦**。消息组件只租用锚点;页面(iframe)挂在独立页面池上,缩放/预览时迁移锚点而不重建 guest。

## 3. 模型侧契约

### 3.1 可视化输出目录(宿主决定,模型不能自选)
- 目录 = 环境变量 `ZCODE_GEN_UI_OUTPUT_ROOT`(执行端注入)/ `sha256(scopeKey)` 子目录;scopeKey 由 workspacePath + sessionId 等构成。
- 该绝对路径通过系统提示的"可写根"告知模型;模型只允许把 fragment 写进该目录。
- ZCode 参考:`packages/shared/src/node/genUiPaths.ts`。

### 3.2 指令格式(三种形态)
- 推荐:`::visualize{"path":"C:/dir/x.html","title":"标题","mode":"wide"}`
- key=value 旧式:`::visualize{path="..." title="..." mode="wide"}`
- 旧版 Unicode 私有区标记:`U+E200 + "visualize" + U+E202` 开头包裹 JSON(可选兼容项;新实现可只支持前两种)

### 3.3 fragment 规范(模型写作约束,需写进对应 skill/提示词)
- 只写 HTML 片段:禁止 `<!doctype>`、`<html>`、`<head>`、`<body>`;
- 根元素带唯一 id,JS 用 `document.getElementById` 选取;脚本可放在根元素之外;禁止依赖 `document.currentScript`;
- 字面换行书写标记(禁止把 `\n` 作为转义字符串嵌入);写完应读回检查;
- 允许内联 `<style>`/`<script>`;静态资源仅限白名单 CDN:`cdnjs.cloudflare.com`、`esm.sh`、`cdn.jsdelivr.net`、`unpkg.com`、`fonts.googleapis.com`、`fonts.gstatic.com`、`fonts.bunny.net`;
- 禁止 `fetch`/XHR/WebSocket 等网络 API;
- 单文件 ≤1MB(超限拒绝渲染并明确报错);
- 三个固定版本的离线库可直接 `<script src>` 使用(宿主离线映射,见 §6.4):
  - `https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js`(按需加载)
  - Lucide 1.17.0(全局 `lucide`,`<i data-lucide="图标名">` + `lucide.createIcons()`)
  - Floating UI Core 1.7.3 / DOM 1.7.4
- 主题只用 CSS 变量(清单见 §7),保证深浅色自适应;
- 交互后调用 `window.zcode.setWidgetState` 保存状态;加载时读 `window.zcode.widgetState` 恢复;监听 `zcode:set_globals` 事件应用外部状态变更。

## 4. 解析器规范(聊天端,`projectGenUiReferences`)

- 输入:消息全文 + 完成标志;输出:有序片段 `{kind:"text"|"ui"|"pending"|"invalid"}`。
- 提取:`::visualize` 前缀指令(通用指令解析器解析 key=value;JSON 参数由 Gen UI 层 `JSON.parse` 后统一走 schema);旧版 PUA 标记正则 `/[\uE200]visualize[\uE202]/gu`。
- 规则:
  - 位于 Markdown 代码围栏内的匹配一律忽略(防注入);
  - 消息未完成:任何指令位置输出 `pending`,且检测未闭合前缀(如 `::vis`)与疑似半截 JSON(参数前缀正则:仅允许 `"key":"value",` 序列前缀)隐藏其后正文,避免闪烁;
  - 消息完成后:JSON 解析 + schema 校验,成功→`ui`,失败→`invalid` 占位;
- schema:`path` 为绝对路径(支持 `C:\`、UNC、POSIX),不含 NUL/换行,文件名为小写字母数字连字符;`title ≤ 250` 可选;`mode ∈ {"wide"}` 可选。
- 同一 `ui` 引用对重复的 HTML 预览卡片/文件摘要去重(Windows 路径分隔符归一化后按全路径比对)。
- 参考实现(约 80 行,可近乎照搬):`packages/ui/src/gen-ui/domain/references.ts`;schema:`packages/shared/src/gen-ui/contract.ts`(`genUiReferenceSchema`)。

## 5. 卡片与页面生命周期(聊天端)

- 卡片 = 工具栏(放大/复制图/Tweak/关闭)+ 锚点 `<div>`;`page.bind(anchor)` 挂载页面。
- **锚点迁移而非重建**:放大预览弹层、折叠展开时把同一页面实例绑到新锚点(ZCode:`acquireGenUiPage` 租约 + `retainedPage`),不重载 iframe。
- 页面池:与 MCP App 页面共享容量(ZCode 上限 64,LRU 驱逐,过期不活跃回收)。迁移初期可每卡片一页,但保留实例/组件解耦接口。
- 高度未上报前卡片高 240px。

## 6. 沙箱页面宿主(客户端核心,安全边界)

### 6.1 隔离模型
- 每页独立 origin:Electron 用自定义协议(如 `zcode-sandbox://shell-<id>`)+ 协议拦截器校验 origin/实例/登记;纯 Web 项目可用独立 sandbox 子域,或 `blob:`/`srcdoc` iframe 且**不加** `allow-same-origin`。
- CSP:`default-src 'none'`;`script-src 'unsafe-inline' + 白名单域`(gen-ui 需允许内联脚本与白名单 CDN);`style-src 'unsafe-inline' + 域`;`img-src/font-src/media-src` 白名单域 + `blob:`/`data:`;`frame-src 'none'`;`form-action 'none'`;`connect-src 'blob:' 'data:'`(等于禁网络 API)。
- guest 固定 `contextIsolation`/`sandbox`,禁 Node、webviewTag、plugins、弹窗、下载、跨页导航;**fragment 内容视为不可信代码**,所有宿主能力必须经显式桥方法并校验参数。
- gen-ui 页面额外禁:子框架、表单提交、connect。

### 6.2 HTML 外壳(宿主读文件后拼装,顺序固定)
1. `<script type="application/json" id="zcode-gen-ui-initial-state">`(转义后的初始 widgetState 快照)——先于作者脚本;
2. guest 桥脚本 `gen-ui.js` + 宿主基础 CSS(§7)+ 可选 inner kit(tooltip、日历);
3. 作者 fragment 原文(其中 CDN `<script>` 按声明顺序加载,主进程拦截映射为本地文件)。
- 不向 gen-ui 页注入旧兼容桥,不开放 `callTool`。

### 6.3 高度协议
- guest 持续测量 body 实际内容高度(读 `getBoundingClientRect`,不触发布局),经桥回报;宿主设置容器高度。
- 初始 240px,上限 10000px;绘制留 5px 补偿 gutter(宿主侧 `height + 10px / margin:-5px` 处理)。
- **防反馈回路**:若相邻两次上报的高度差 ≈ 宿主视口变化差(即 vh/百分比高度跟随宿主),忽略该次上报。

### 6.4 离线 vendor 映射
- 主进程拦截白名单 CDN 请求,按 `vendor/manifest.json`(`url → file → sha256`)精确匹配,重写到本实例的本地资源路径;
- 缺失文件直接失败,**不回退网络**;不因此放宽 CSP;
- 同一份 vendor 供桌面与"独立导出"共用:导出脚本把 vendor 嵌为 data URL 生成完全离线的独立 HTML。
- 参考:`packages/desktop/src/main/pluginSandbox/genUiVendor.ts`、`session.ts`、`csp.ts`;`apps/zcode-cli/packages/visualize-plugin`(skill + `scripts/render.py` + `assets/vendor/manifest.json`)。

### 6.5 外链与交互安全
- `openExternal({href})`:仅绝对 http(s),宿主验证当前可见实例 + 原生用户手势后,经平台打开器交给系统浏览器;页面内导航/弹窗/下载一律阻断;`#fragment` 留在页内。
- 复制图片:经宿主校验 sender/沙箱 ID/几何范围后走原生剪贴板 IPC,不向页面暴露任意 guest ID 或图像字节。

## 7. 主题与基础 CSS(宿主注入,fragment 只准用变量/工具类)

- 颜色变量:`--background --foreground --card --card-foreground --popover --popover-foreground --primary --primary-foreground --secondary --secondary-foreground --muted --muted-foreground --accent --accent-foreground --destructive --border --input --ring --blue --orange --green --red --purple --yellow`;图表序列 `--viz-series-1..6`;字号 `--font-size-base`。
- 工具类:`.card`、`.btn`(`.btn-primary` `.btn-ghost` `.btn-block`)、`.form-control/.form-select/.form-check/.form-switch/.form-range/.form-control-color`、`.nav.nav-pills`(tab 交互由宿主脚本实现)、`.table(.table-sm/.table-responsive)`、`.viz-stat/.viz-grid/.viz-row/.viz-controls/.viz-badge/.viz-tile`、`.text-small(12px,下限11px)`、`.text-muted`、`.tabular-nums`、`.sr-only`、`.viz-dotted-background`。
- `data-tooltip` 属性:宿主用 Floating UI 实现 hover/focus/touch 提示,页面无需初始化。
- 可选 inner kit:日程组件 `<viz-calendar>`。
- 现成资源可直接取用:`apps/zcode-cli/packages/visualize-plugin` 随包 assets(`visualize.css`、vendor、runtime-manifest.json 含各文件 sha256)。

## 8. guest 桥协议(`window.zcode`)

- 传输:JSON-RPC over MessagePort(ZCode 基于 `@modelcontextprotocol/ext-apps` 的 `App` + `PostMessageTransport`;迁移可实现简化版,方法名保持一致便于对照)。
- 常量(与 ZCode 完全一致,见 `packages/shared/src/gen-ui/contract.ts`):
  - 方法:`zcode/gen-ui/state`、`zcode/gen-ui/follow-up`、`zcode/gen-ui/tweak`、`zcode/gen-ui/presentation`
  - 事件:`zcode:set_globals`(`event.detail.globals.widgetState`)
  - 初始状态:`<script id="zcode-gen-ui-initial-state">`
- 页面 API 语义:
  - `window.zcode.widgetState`:只读快照 `{modelContent, privateContent}`;
  - `setWidgetState({modelContent?, privateContent?})`:整体替换式快照,单次 ≤16KiB;宿主持久化成功后 ack 才 resolve;**禁止在页面加载时自动保存**;保存永不触发新的模型轮次;
  - `modelContent` 可(尽力而为)回流给模型作为后续上下文;`privateContent` 仅 UI 恢复用;不可依赖 modelContent 的送达;
  - `sendFollowUpMessage({prompt, title?})`:把追问写入**现有会话的输入绑定**发送;只读/过期绑定必须拒绝;title ≤250 作确认框标题;
  - `openExternal({href})`:见 §6.5;
  - Tweak:设计参数对象绑定 register/update/dispose,序列化 ack(ZCode:`genUiTweakRuntime`)。
- guest 端参考实现:`packages/desktop/src/renderer/src/plugin-sandbox/genUi.ts`;宿主 relay:`同目录 relay.ts`/`main.ts`(iframe `sandbox="allow-scripts allow-same-origin allow-forms"` + origin 校验后的原样转发);页面适配器:`packages/ui/src/gen-ui/adapters/page.ts`(基于 AppBridge,`createGenUiPage`/`acquireGenUiPage`)。

## 9. 持久化与恢复

- widgetState 以 scope(workspace 路径/身份 + sessionId)+ 文件 path 为键持久化(宿主服务,不依赖浏览器存储);
- 会话/应用重开后,页面重建时通过初始状态快照恢复上次交互状态;
- gen-ui 页面使用独立内存分区,清理时按契约先停 guest 再清数据。

## 10. 分阶段实施计划

- **P0 可看(纯静态即可用)**:解析器 + schema + 完成门槛 → 宿主读文件 → 沙箱 iframe(srcdoc/blob,CSP,无 allow-same-origin 或独立 origin)→ 高度自适应上报。此阶段已能渲染静态图表。
- **P1 可交互**:`gen-ui.js` 桥(window.zcode:state/globals 事件/openExternal)+ 主题 CSS/工具类注入 + data-tooltip。
- **P2 完整体验**:widgetState 持久化与恢复、follow-up 追问、放大预览(锚点迁移)、复制图片、Tweak、页面池与租约、独立导出脚本(render.py 等价物:vendor 嵌 data URL;`--serve` 本地预览)。
- **P3 加固**:vendor 清单 sha256 校验、每页独立 origin、CSP 审计、注入渗透测试(把恶意 `::visualize`/脚本写进消息正文、代码块、fragment 本体,验证不逃逸)。

## 11. 关键坑(实测踩过,务必处理)

1. vendor 清单是 sha256 精确校验:文件与清单不同步直接渲染失败(ZCode 真实案例:本地缓存文件与 manifest 不匹配,报 "bundled resource hash mismatch"),要有明确的失败提示而非白屏。
2. 只渲染"已完成"消息;流式期间的半截指令/半截 JSON 必须整体隐藏,否则闪烁。
3. 代码围栏内的 `::visualize` 是普通文本(防注入),解析必须先算代码区间的字符偏移。
4. fragment 里把换行写成 `\n` 转义串会导致整页失效——模型侧 skill 必须要求"字面书写 + 写回读检查"。
5. 高度反馈回路:guest 把宿主高度变化又报回成内容增高;按"高度差 ≈ 视口差则忽略"过滤。
6. `setWidgetState` 禁止 load 时自动保存;必须等宿主持久化 ack。
7. 状态变化绝不能自动开始新的模型轮次(费用与安全边界)。
8. 路径去重前做 Windows 分隔符归一化。
9. D3 固定 7.9.0 按需加载;脚本加载顺序不可乱(bridge → CSS → vendor → 作者脚本)。
10. follow-up 只能走现有会话输入绑定;只读/过期绑定明确拒绝。
11. 单文件 1MB 上限要硬校验,超限给出可操作报错。

## 12. 验收清单

- [ ] 模型输出 `::visualize` 指令的静态图表页正确渲染,高度自适应,深浅色正确;
- [ ] 交互页(D3 + 滑块)可用,刷新/重开会话后 widgetState 恢复上次状态;
- [ ] 未完成消息不渲染(只 pending);代码块内指令不渲染;非法 schema 显示 invalid 占位;
- [ ] 断网渲染成功(vendor 本地映射);删除 vendor 文件则明确失败不回退;
- [ ] fragment 内 fetch/XHR/WS 被禁;window.open、表单提交、下载、导航被阻断;
- [ ] `openExternal` 仅放行绝对 http(s);追问消息进入当前会话输入框;
- [ ] 放大预览/折叠切换不重载页面,交互状态不丢;
- [ ] >1MB fragment 拒绝并报错;非法路径(相对路径/NUL/换行)拒绝。

## 13. ZCode 参考代码索引(`D:\1.WorkDir\reference\ZCode`)

| 模块 | 路径 | 内容 |
|---|---|---|
| 模型侧契约(skill) | `apps/zcode-cli/packages/visualize-plugin/skills/visualize/SKILL.md` + `scripts/render.py` + `assets/` | 写作规范、基础 CSS、vendor、导出脚本 |
| 指令解析 | `packages/ui/src/gen-ui/domain/references.ts` | `projectGenUiReferences`,pending/invalid、代码区排除、PUA 兼容 |
| schema | `packages/shared/src/gen-ui/contract.ts`、`packages/shared/src/node/genUiPaths.ts` | zod 校验、协议常量、输出目录规则 |
| 聊天卡片 | `packages/ui/src/gen-ui/components/GenUiCard.tsx`、`GenUiMessageResponse.tsx`、`TweakPanel.tsx` | 挂载、放大、复制图、Tweak 面板 |
| 页面适配器 | `packages/ui/src/gen-ui/adapters/page.ts`、`retainedPage.ts`、`theme.ts`、`app/tweaks.ts`、`host.ts` | 页面租约、主题变量读取、桥接编排 |
| 沙箱宿主(Electron 主进程) | `packages/desktop/src/main/pluginSandbox/`(`CONTRACT.md` 必读:`session.ts` `registry.ts` `genUiVendor.ts` `csp.ts` `protocol.ts`) | zcode-sandbox:// 协议、独立 origin、CSP、vendor 映射、权限闸门 |
| guest 桥(iframe 内) | `packages/desktop/src/renderer/src/plugin-sandbox/genUi.ts`、`relay.ts`、`main.ts`、`genUiTweakRuntime.*` | window.zcode 实现、高度测量、JSON-RPC 转发 |
| 规格文档 | `packages/ui/src/gen-ui/CONTRACT.md`、`packages/desktop/src/main/pluginSandbox/CONTRACT.md`、`docs/specs/gen-ui-external-links.md`、`docs/specs/gen-ui-file-summary.md`、`apps/zcode-cli/docs/design/v2/visualize-reference-format.md` | 契约原文 |

## 14. 执行要求

1. 先通读 §13 的两个 CONTRACT.md 与 `references.ts`,再产出迁移设计文档(含本项目技术选型:Electron 自定义协议 or Web 独立 origin,页面池是否首期实现);
2. 按 P0→P3 分阶段提交,每阶段附 §12 对应项的自测证据(截图/录屏/日志);
3. 安全项(CSP、origin、桥参数校验、注入测试)不允许以"后续补"为由跳过 P0 合并。
