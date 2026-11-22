# P6 OOP iframe 深探结论（2026-11-22）

## 结论：真断点 = Chromium sandbox 导航拦截（iframe target 创建前）；坐实方案 B（sandbox token 安全评审）

P6 压测 `table_load` 停在「正在加载「bio-result」」的根因已用 CDP `Target.attachToTarget` 深探定位到**导航层**，非脚本层、非握手层、非 bundle 层。裁决 A（scheme privileges 补 `supportFetchAPI`+`corsEnabled`，commit c58988db/8ae2f2f1）已实证无效——因为断点不在 scheme fetch 能力。

## 四项深探读数（driver-result.json → packSurfaceProbe.oop）

| 读数项 | 实测值 | 判据 |
|---|---|---|
| ① result.html 加载态 | iframe target 数 **0**；frameTree 仅主 frame + 空 URL frame；无 `petri-pack:` frame | 导航在 frame/target 创建前被拒 |
| ② 执行上下文可达性 | `attachedCount=0`、`contextReadableCount=0`——无可 attach 的 iframe target | 上下文根本未建立，非脚本执行失败 |
| ③ console/message 报文 | `rendererConsole` 含精确报错：`Navigation to external protocol blocked by sandbox, because it doesn't contain any of: 'allow-top-navigation-to-custom-protocols', 'allow-top-navigation-by-user-activation', 'allow-top-navigation', or 'allow-popups'` | Chromium 明确点名缺**导航类 sandbox token** |
| ④ ready 握手 | `hostMessages=[]`、`readySignal=false`；但 DOM iframe 在场可见 720px、src=`petri-pack://petri-pack-bio/ui/result.html` | 因 document 从未加载，postMessage 无从发出——握手不是断点 |

`evaluateOopProbe` 纯函数判据树输出：**`verdict=oop_no_iframe_target`**（`iframeTargetCount=0`）。

## 判据链（反假绿）

- DOM 级：`page.packIframes=[{title:'bio-result', src:'petri-pack://petri-pack-bio/ui/result.html', visible:true, width:720}]` —— iframe 元素在场可见。
- CDP 级：`Target.getTargets` 无任何 iframe 类型 target（`iframeTargetCount=0`）—— frame 未建立。
- Console 级：Chromium 报文本身给出根因——sandbox 缺 `allow-top-navigation-to-custom-protocols` 等 token。
- 三者交叉印证：拦截发生在 Chromium 导航层深处（sandbox iframe × 自定义 scheme），在 target 创建之前。

## 修复路径（安全敏感 · 不擅改 · 出材料待裁决）

断点精确定位在 **`frontend/src/components/work-surface/PackSurfaceFrame.tsx:244`**：

```tsx
sandbox="allow-scripts allow-same-origin"
```

加载 `src=petri-pack://...` 时 Chromium 判其为「iframe 导航到自定义协议」，要求 sandbox 含 `allow-top-navigation-to-custom-protocols`（或 `allow-top-navigation*` 之一）。当前 token 集不含，故导航被静默拒绝。

### 方案权衡

| 方案 | 改动 | 风险 | 评价 |
|---|---|---|---|
| B1（推荐评估） | sandbox 增 `allow-top-navigation-to-custom-protocols` | 允许 iframe 发起自定义协议导航；但 pack 内容是**本机已安装 + 已启用**包、协议 handler 只服务包内真实文件（path 遍历防护、`resolvePackAssetPath` 单源），攻击面受控 | 最小且精准：报错点名的 token；需安全评审确认「pack 内容不可信」假设下可接受 |
| B2 | sandbox 增 `allow-top-navigation` 等更宽 token | 允许 iframe 导航顶层窗口到任意 URL | 不建议：过度放宽，偏离最小权限 |
| C | scheme handler 改走 `https://127.0.0.1:<backendPort>` 侧通道 | 大改、绕过 scheme 机制、新攻击面 | 不推荐（U 材料已列） |

注意：`allow-scripts`+`allow-same-origin` 同时存在时，iframe 内脚本可移除自身 sandbox（Chromium 已知语义）——这是现有配置既有面，本次不扩大，但安全评审应一并覆盖。

**本票不擅改 sandbox**（安全边界），登记为「方案可裁决」，等用户对 B1 做安全裁决后另票执行。

## 门禁

- HK-01 红绿先行：先落 3 条 OOP 契约红（3 绿 3 红），实现后 6/6 绿；新增纯函数判据树行为测 1 条（4 分支），最终 **16/16 绿**（含 block216/live-window-policy 邻域）。
- HK-01 红证据：`3 pass / 3 fail`（新增契约因实现缺失而红），已留痕于本票过程。
- `node --check scripts/g0-rs-p6-electron-pressure-driver.cjs` 通过。
- `npx tsc --noEmit -p frontend/tsconfig.json` 0 红。
- 压测复跑：`failedStage=table_load`、`packSurfaceProbe.verdict=no_pack_frame`、`oop.verdict=oop_no_iframe_target`、`timeoutReason` 缺省（主流程正常 catch 落证，非 watchdog 强探）。
- 测试原始输出见同目录 `targeted-tests.txt`；tsc 见 `tsc.txt`；现场读数见 `driver-result.json`。

G0 开发期常态 · 不外推 packaged/Provider/GA。
