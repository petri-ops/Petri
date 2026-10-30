# dev-verify — 实机校验公共底座（BLOCK-71 · petri-dev-infra 随包资产）

把 `block*-live.cjs` 系列反复出现的样板沉淀为四个原语（`lib.cjs`）：

| 原语 | 函数 | 作用 |
| --- | --- | --- |
| ready | `pollTargets({port})` | 轮询 CDP `/json` 直到 dev Electron 就绪（默认 9222，`PETRI_DEBUG_PORT` 覆盖） |
| target | `filterPageTargets` + `selectPageTarget` | URL 预筛 + 主窗探测（BLOCK-68 教训：按项目树+右栏判真主窗） |
| capture | `evalJs` / `screenshotPng` | 带超时/异常透传的页面求值与 PNG 取证 |
| assert | `createRun({name, evidenceDir})` | 断言记录 + `<id>-live.json` 证据落盘（与 block*-live 证据契约同构） |

## 硬规则：UI 面断言一律轮询到目标态（BLOCK-322 P2-01 实机暴露）

- 来自 `onReady`/异步 state 的可见数值（如 3D 面板的「渲染对象」「包围盒」）在**下一个 React commit** 才落地；点击后单次 `textContent` 读取会稳定读到占位「—」。旧 `next04a-model3d-preview-live` 的 W3/W4 即因单次读取在同一票后必红（产品无缺陷，计数确实落）。
- 写法：`poll()` 到目标值再断言，超时才判失败；不得把「读到过一次」当证据，也不得为让单次读取变绿而延时盲等。

## 新增一个校验 flow

1. 拷贝 `flows/_template.cjs` 为 `flows/<id>.cjs`，导出：

```js
module.exports = {
  id: 'my-flow',
  description: '一句话描述',
  evidenceDir: require('node:path').join(process.cwd(), 'acceptance', 'my-block'),
  async run({ assert }) { /* 用 lib.cjs 原语组装断言 */ },
};
```

2. 运行：`npm run verify -- my-flow`；清单：`npm run verify -- --list`。

## 硬规则：测试窗口不得出现在屏幕上（用户裁决 2026-10-17；2026-10-23 复发）

- **Agent 的 flow / live 脚本一律不得设置 `PETRI_TEST_ONSCREEN`**（含直接 `spawn` Electron 时写进 env）。
  测试实例默认 `show:false` 离屏渲染，`backgroundThrottling:false` 保证 rAF 与 CDP 求值照常。
- 人要看测试过程只能手动跑 `bash scripts/start-test-instance.sh --onscreen`（启动器是唯一合法入口）。
- 隐藏窗下 `Page.captureScreenshot` 可能等不到合成帧（BLOCK-243 实测）——截图必须**有界超时**，
  失败就如实记 `screenshot_unavailable`，**不得靠开窗换证据**；DOM/`elementFromPoint` 断言优先。
- 机械门禁：`test/live-window-policy.test.mjs`（扫 `scripts/` 与 `dev-verify/flows/`，命中 `PETRI_TEST_ONSCREEN=1` 即红）。

纪律：本底座只连接既有 dev 栈，不启动/重启 Electron（后端代码变更后必须重启
dev Electron —— 这一步留在人/Agent 手里）；CDP 客户端按仓库根懒解析宿主
`scripts/g0-rs-p7-cdp.cjs`（单源复用，不建第二套连接层）；跨仓库复用见 `../PORTING.md`。
