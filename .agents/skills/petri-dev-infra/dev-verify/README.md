# dev-verify — 实机校验公共底座（BLOCK-71 · petri-dev-infra 随包资产）

把 `block*-live.cjs` 系列反复出现的样板沉淀为四个原语（`lib.cjs`）：

| 原语 | 函数 | 作用 |
| --- | --- | --- |
| ready | `pollTargets({port})` | 轮询 CDP `/json` 直到 dev Electron 就绪（默认 9222，`PETRI_DEBUG_PORT` 覆盖） |
| target | `filterPageTargets` + `selectPageTarget` | URL 预筛 + 主窗探测（BLOCK-68 教训：按项目树+右栏判真主窗） |
| capture | `evalJs` / `screenshotPng` | 带超时/异常透传的页面求值与 PNG 取证 |
| assert | `createRun({name, evidenceDir})` | 断言记录 + `<id>-live.json` 证据落盘（与 block*-live 证据契约同构） |

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

纪律：本底座只连接既有 dev 栈，不启动/重启 Electron（后端代码变更后必须重启
dev Electron —— 这一步留在人/Agent 手里）；CDP 客户端按仓库根懒解析宿主
`scripts/g0-rs-p7-cdp.cjs`（单源复用，不建第二套连接层）；跨仓库复用见 `../PORTING.md`。
