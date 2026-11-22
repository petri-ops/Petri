# U 材料 · P6 pack iframe sandbox 拦截修复方向（2026-11-22 · pending_user_ruling 零代答）

> 现状现读：P6 压测 table_load 停「正在加载 bio-result」——iframe onLoad/onError 双未触发
> （=Chromium 判 petri-pack:// 为 external protocol navigation 后静默拒绝，rendererConsole
> "Navigation to external protocol blocked by sandbox" 实锤）。scheme 已 standard+secure 注册
> （app ready 前，src/main/pack-ui/scheme.js:30-35）；主窗 P3 呈现层 verified 时同 iframe 工作过
> ——压测隔离实例（mkdtemp userData + 无键 env）与主窗差异面待归因。

## 可选方向

| 方向 | 说明 | 代价/风险 |
|---|---|---|
| A scheme privileges 补充 | registerSchemesAsPrivileged 增加 `supportFetchAPI: true` + `corsEnabled: true`（部分 Chromium 版本沙箱 iframe 判 external 需要此二者） | 低改动；privileges 放宽面小、可回滚；需压测+主窗双验证 |
| B iframe sandbox token 评审 | sandbox="allow-scripts allow-same-origin" 增补导航相关 token | **sandbox 是安全边界**——放宽 token 前须安全评审（pack 内容不可信面） |
| C protocol 层重定向 | scheme handler 把 petri-pack:// 资源改经 https://127.0.0.1:<backendPort> 侧通道供应 | 改动面大（绕过 scheme 机制=新攻击面），不推荐 |

## 单一推荐：**A scheme privileges 补充**（一句理由）

改动最小且只放宽「fetch 可用性」不触导航权限；A 不生效再升级 B（安全评审兜底）；C 不推荐。

## 裁决格式

`U-P6-SANDBOX：A` 或 `U-P6-SANDBOX：B` / `：C`；裁决后 Agent 执行（A 先行压测+主窗双验证），
P6-TABLE-LOAD 专项随即续推。
