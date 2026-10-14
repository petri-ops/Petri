---
capability: gen-ui-sandbox
goal: BLOCK-166-NAV-GUARD — Gen UI 沙箱帧导航劫持收口：拆除失实死码+主进程侦测即时恢复通道+劫持循环限幅（2026-10-12 用户裁决「可以排期修」的 knownGap 落地）
acceptance:
  - 死码拆除：security-hardening.js 中签名失配的 params 对象版 will-frame-navigate「阻断」处理器移除，失实「勿回退」注释纠正（BLOCK-168 实证=preventDefault 对子框导航无效）
  - 即时恢复：劫持侦测（遥测处）→ gen-ui:sandbox-hijacked 推送（携帧 petri-genui URL）→ GenUiCard 按 src 精确匹配即时重置，DoS 恢复窗口 9-11s → 亚秒
  - 循环限幅：30s 窗口 ≥3 次劫持 → 卡片挂起（诚实提示+手动恢复），防无限重置循环
  - 红绿：GenUiCard 组件测试（精确匹配即时重置/非本卡不受扰/限幅挂起/恢复）+channels 双向守护
  - 实机：真卡片劫持探针实测亚秒恢复+循环挂起；knownGap 销号
reopen: Electron 升级使 will-frame-navigate 可取消时，改为事件阻断直通（移除恢复通道依赖）
status: completed
---

> **收口（2026-10-14 当日立项当日收口）**：红绿 4/4（GenUiCard NAV-GUARD 组件组）+gen-ui 套件 37/37+channels 守护 5/5+tsc 0；实机探针 scripts/block166-nav-guard-live.mjs 全链 PASS（真 fragment 自劫持循环→did-fail-load 侦测路 3× 推送→即时重置→限幅挂起，导航→挂起 17s 含 lazy 加载 vs 心跳路径 ~29s+，acceptance/block-166/nav-guard-live.json）。
> **实现期勘误（相对 plan §2 的偏离）**：①帧登记法降级为**进程登记法**——实测 OOPIF 帧的 frameRoutingId 跨导航会变（5→17→11），帧 ID 键不可行；②侦测主形态=**did-fail-load(-30) CSP 拦截路**——fragment 的 location.href 自导航不派发 will-frame-navigate、CSP 拦截加载不提交 did-frame-navigate（will/did 两路保留作 CDP 驱动导航等形态的覆盖）；③did-frame-navigate 签名含 httpStatusText 位（'OK' 在 isMainFrame 槽位——arg 位偏移曾多次误判，全参位打印定案）。

# BLOCK-166-NAV-GUARD — 沙箱帧导航劫持收口

## 1. P0 勘察结论（2026-10-14）

- **平台边界（BLOCK-168 实证矩阵，acceptance/block-168/evidence.json）**：Electron 44 对 OOPIF 渲染器自导航（location.href）触发宿主 `will-frame-navigate`（mainFrame=false）但 **preventDefault 无效**（Chromium 不允许阻塞子框导航）——事件守卫路线已在 P1-A 否决。
- **死码发现**：`security-hardening.js` 存留 BLOCK-166 P3 时代的第二处理器（`(event, params)` 对象签名+preventDefault+「实机渗透实证勿回退」注释）——签名与实际 API 不匹配（positional），且即便命中也已被实证无效。死代码+失实注释=审计陷阱，本包拆除。
- **现行缓解**：guest 2.5s 心跳 → GenUiCard 9s 宽限判定 → iframe 重置（恢复窗口 ~9-11s）；劫持可无限循环（每轮卡死 ~9s）。
- **推面上的既有 push 通道形态**：`window:maximize-changed` 先例（webContents.send + preload ipcRenderer.on 返回 unsub）。

## 2. 设计

1. **真相修复**：删死码；遥测处理器（positional 版）保留并升级——确认劫持（petri-genui 帧导航向非 petri-genui）时 `contents.send('gen-ui:sandbox-hijacked', { frameUrl, targetUrl, at })`（frameUrl=被劫持帧的 petri-genui URL，事件时点 frame.origin 仍可读）。
2. **即时恢复**：GenUiCard 订阅信号，`frameUrl === result.url` 精确匹配者立即 `resetSeq+1`（零探针，无歧义）；其余卡片零扰动。
3. **循环限幅**：每卡滑窗 30s 内 ≥3 次劫持重置 → `suspended` 态（诚实提示「检测到反复劫持，已暂停该可视化」+ 手动「恢复」钮清计数重载）。
4. 通道登记走 IPC 三件套（channels/preload/registry 双向守护）；投影环境（浏览器）无桥=订阅静默缺席（能力诚实缺席先例）。

## 3. 非范围

导航阻断本体（平台不允许，maintain 遥测+恢复双层）；guest CSP 收紧（外域加载已拒）；widgetState 丢失面（已持久化）。

## 4. 验证判据

- 组件红绿：劫持信号精确匹配即时重置 / 非本卡不受扰 / 30s×3 挂起 / 手动恢复。
- 实机：真 fragment `location.href='https://example.com'` → 观察亚秒恢复；连续注入 → 挂起提示。
- 门禁：契约+gen-ui 套件+test:changed+docs/ui-audit。
