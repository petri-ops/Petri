# 创作包 generate.* 内置化证据（owner 裁决「这些包我认为应该是内置的呀」）

## §1 问题链（只读核真）

conv_0d113948-4a2（2026-11-26 14:49–14:56Z）用户要求「用图像生成工具生成一张插画」，模型在 `run_tool` 21 工具目录里找不到生图工具，reasoning 原文：「No image-generation tool or skill. Confirmed: no text-to-image capability in this environment」；随后手绘 SVG，3 个错误全在 SVG 链上（探测 exit 1 / vision 超时 / sha 门），与生图模型无关。transcript 中 `generate.image` 出现 **0 次**。

根因：`core/petri-server/agent-tools/tool-defs/generate.js` 早有 provider 无关定义（bb6064233），但 `tool-defs.js` 只把 `domainModules['generate']` 放入 `DOMAIN_TOOL_DEFS`，**未展开进 `TOOL_DEFS`**，HANDLERS/CONTRACTS 也没有 → 工具从未进入 agent 工具目录。旁证：`test:changed` 恒等红 `⋃域=123 vs TOOL_DEFS=120`。

## §2 落地

- 内置运行时快照 `resources/built-in-packs/petri-pack-create/`（36KB）：仅 pack.json / plugins / registry / scripts；不搬 evidence/docs/tests。registry 增 `exportName` / `credentialProvider`，provider 名只留包侧。
- `electron-builder.yml` 增 `extraResources`，packaged 态随包分发；`PETRI_BUILT_IN_PACKS_DIR` 可覆盖。
- `tool-defs.js` 展开 `...domainModules['generate']`；`registry.js` 同批加 3 个 handler + 3 条 contract（启动一致性要求同进同出）。
- 新增 `core/petri-server/agent-tools/generate-tools.js`：通用派发，从内置包 registry 读 entry/exportName/credentialProvider → 路径越界校验 → 动态 require → 注入 apiKey（credential-store file backend）+ outDir（dataDir）→ 原样返回插件 artifact 描述符；缺 key 明确报错不出假产物；内核零 provider 字面量。
- 元数据/动词/前端/fixture 三键同步；计数基线 118→123（`--update --force` 有意增长留因），120 pin 同步 123；域白名单与 fixture 补齐 mcp/notebook 存量滞后项。

## §3 验证

- HK-01 `test/generate-builtin-tools.test.mjs` 红 4/4 → 绿 4/4（注册齐备+恒等、零 provider 字面量、handler 派发描述符、entry 越界 fail-closed；凭据测试值不出现在返回）。
- 元数据/恒等定向 72/72 绿；包内 create 插件 38/38 无回归。
- 门禁：docs:check / ui:audit:check / types / lint / arch / knip / code-size / arch-cycles / secret。
- live：工具注册在后端启动期冻结，需 owner 重启后端后 `run_tool(op:'list')` 确认 `generate.image/video/model3d` 可见；本批未做真实 Ark 生图自调用（不默认花钱）。

## §4 owner 实机缺陷全链排查（后续 dispatch：agent 看不到 generate.image）

按依赖序逐项 live 核真（非代码推断）：

1. **后端进程时点**：PID 94084 启动于 `2026-11-26 21:29:56 +0800`；薄层 `bb6064233` = 17:50:59，**已加载**；内置修复 `7f25f80e4` = 23:31:46，**晚于后端**。→ 当前运行中的后端必然不含内置修复。
2. **工具注册实测**：`GET /api/ai/tool-approval-policy`（读 `getProviderToolDefs()`）live 返回 **120 工具、generate.* 零命中**；与「进程早于修复」一致。
3. **pack 加载链**：内置路线不依赖 installed.json；live `GET /api/packs/installed` 为 `[]`，但 handler 从 `resources/built-in-packs/petri-pack-create` 动态加载，真实插件 + mock fetch smoke 已出 PNG 描述符（sha256 `c414cd0e…`）。→ 包发现不是当前阻断点。
4. **会话工具快照**：`agent-runner.js:610` 每轮 `resolveToolDefsForContext(context, getToolDefs())` 重算，`tool-router.js` 无会话级缓存 → **老会话无需新建**，重启后端后即刷新。
5. **第二根因（潜在，已修）**：`tool-route` 默认启用（`decision-config.js:33 defaultOn:true`），而 `TOOL_FAMILIES` 九域无 `generate`；`narrowToolDefsByFamily` 原实现只保留「路由域 ∪ session」，会把未映射域的 generate.* 静默剔除。修复为按 D-1「宁全勿缺」保留所有未映射域工具；HK-01 钉住 workspace/computer/knowledge/all 等各域收窄后 `generate.image` 恒在场，15/15 绿。
6. **结论**：先重启后端加载 `7f25f80e4`；重启后即使两跳路由命中特定域，generate.* 也不会被剔除。owner 9223 HMR 只影响渲染层，不加载后端 registry。

## §5 边界

- 本批只内置创作包；`petri-pack-bio` 维持原安装制。
- sibling 仓 `petri-pack-create` 保留为上游源；内置运行时快照与其保持同构，计划内不自动同步。
- 未改任何会话数据；owner 实例配置零触碰。
