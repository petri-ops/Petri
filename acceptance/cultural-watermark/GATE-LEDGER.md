# 国风简约背景水印 · 门禁账（2026-11-20）

## 用户诉求与两轮反馈
1. 「月洞门/卵石/落印/开环做国风简约朴素美页面背景水印」→ 首版逐页挂 welcome/workspace。
2. 用户实机反馈「**只在欢迎页看到，其它都没看到**」→ 诊断根因并重构为全局层。

## 根因诊断（只读 CDP + 源码）
- 首版只在 welcome/workspace 两处挂 div；home/extensions/settings 压根没挂。
- 工作区虽挂了 2 个水印（CDP 实测 display:block、占满主区），但 `z-index:auto` 且为 workspaceRoot 第一子元素 → 后续内容盖住；且工作区主区被会话/卡片铺满，无欢迎页那种留白 → 几乎不可见。
- 结论：逐页挂不可靠 → 改**全局单源**。

## 重构（全局层，一处挂所有路由）
- `GlobalWatermark.tsx`：四原型一个组件，`main.tsx` 在 `<App/>` 之后挂一次。
- `watermark.css` 加 `.petri-watermark-global { position:fixed; inset:0; pointer-events:none; overflow:hidden }`（不写 z-index，避免裸 z 棘轮），四个纹样分别定位四角。
- 移除 welcome/workspace 里的逐页 div（单源，无重复）。
- 色值不变：`color-mix(ink-base 3%, bg-canvas)` 主题自适应、URI 零字面色、aria-hidden。

## 实机验证（9223 离屏，16/16）
四路由（welcome/home/extensions/settings）逐页断言：global 层在场、`position:fixed`、`pointer-events:none`、四纹样 count=4、截图各一张。
人工过目 settings.png 与 extensions.png：**settings 右下月洞弧+右上淡方印+左侧卵石/开环；extensions 左下卵石群+右侧开环+下方月洞弧**——四纹样在所有页面清晰可见，内容列表/按钮完全不受干扰。这正是用户第二轮诉求的达成证据。

## 自身门（全绿）
| 门 | 结果 |
|---|---|
| HK-01 红→绿 | 红 5fail → 绿 6/6（全局组件四原型/URI 零字面色/3%派生/非交互/单源挂载/零依赖零代签） |
| 邻域回归 | welcome/home 测试 PASS，UI 契约 19/19 |
| TSC | 0 error |
| a11y | 32/32、0 对 <4.5:1（水印 aria-hidden 不入树） |
| 实机 flow | **16/16**：四路由 × 四断言（global/four/fixed+pe/shot） |

## 边界
审美"够不够国风/高级"保持 in_progress 不代签；UI-717 四档 verified 不外推。工作区主区因内容密集水印较淡（正常——计白当黑，留白处才显），四角纹样在边缘可见。G0 开发期常态 · 不外推 packaged/Provider/GA。
