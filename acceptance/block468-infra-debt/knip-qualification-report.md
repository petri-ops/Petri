# knip 保留面 346 键一次性定性报告（BLOCK-468 / S4 · 2026-11-18）

> 对象：`test/knip-baseline.json`（`_about`: CK-11 收官保留面冻结，新增即红）。
> 门禁：`scripts/knip-ratchet.mjs` / `quality:knip:check`（closeout 链）+ `test/knip-ratchet.test.mjs`。
> 纪律：**本报告只做定性留痕，不改基线键集、不放宽守卫**——346 键原样冻结，删除/新增仍按 knip 棘轮判红；清理后走 `--update` 下调。

## 1. 分类计数（现读，合计 346）

| 类别 | 键数 | 定性结论（与 `_about` 对齐） | 处置 |
|---|---|---|---|
| `exports::` | 71 | CK-11 六批逐案定性已毕：盲区误报（动态 require/懒加载入口）/ 测试契约（仅测试引用的导出）/ 动态入口（renderer/hook 注册） | 冻结保留，清理另案走 `--update` |
| `files::` | 146 | 现存面上界冻结：dev-verify flows（`_template.cjs` 等 CDP 脚本，harness 动态装载）/ vendor 静态资源（d3/lucide/floating-ui）/ 动态 CLI 入口（`verify.mjs`/`gym.mjs`/`sand3d-runner.mjs`）/ workflow 资源 | 冻结保留；动态 CLI 入口是 knip 静态扫描盲区，非真死代码 |
| `types::` | 129 | 现存面上界冻结：前端 action/状态类型经动态联合引用，knip 全量扫描上界，多为跨模块类型契约 | 冻结保留，逐案清理另案 |

## 2. 代表性键逐类举例（定性口径）

**exports（71）**
- `exports::.agents/skills/petri-dev-infra/dev-verify/lib.cjs::DEFAULT_PORT` — dev-verify harness 动态装载的契约常量（盲区误报）。
- `exports::src/plugin-manager.js::streamingSha256` / `loadAllPlugins` — 插件运行时经动态引用调用（CK-11 逐案已定 USED_PROD，knip 静态不可见）。
- 其余同类：renderer/hook 注册型导出、仅测试契约引用型导出——六批逐案定性结论已固化于 `docs/hk03-symbol-graph-selection.md` §CK-11 四锚点。

**files（146）**
- `files::.agents/skills/petri-dev-infra/dev-verify/flows/_template.cjs` 等 dev-verify flows — `npm run verify -- <flow>` 动态装载，非死代码。
- `files::resources/gen-ui/vendor/d3-7.9.0.min.js` / `lucide-1.17.0.js` — 前端运行期按路径加载的 vendored 资源（静态分析盲区）。
- `files::sidecars/three-live-runner/verify.mjs` — BLOCK-462 verification adapter，CLI 动态入口（`node verify.mjs`）。
- `files::sidecars/three-live-runner/gym.mjs` — BLOCK-467 Agent Gym 编排，CLI 动态入口（本轮新登记，镜像 verify.mjs 定性）。
- `files::sidecars/sand3d-runner/sand3d-runner.mjs` — sand3d CLI 动态入口（BLOCK-459/460）。

**types（129）**
- `types::core/packages/shared-copilot/actions.ts::ExternalLinkAction` / `NavigateAction` / `ParsedReply` — 前端 action 联合类型，经动态判别引用，knip 上界收录。
- 其余同类：跨模块状态/契约类型，上界冻结不逐个强清（清理需逐案证伪，成本高于收益，按 CK-11 纪律不擅自放宽）。

## 3. 守卫不变声明

- 本报告**不修改** `test/knip-baseline.json` 任何键；346 键与 `_about` 完全一致。
- `quality:knip:check` 与 `test/knip-ratchet.test.mjs` 均须绿（本批收口实测：knip PASS 346 键冻结 / ratchet 1/1）。
- 新增键仍即红（BLOCK-467 gym.mjs 本轮按"动态 CLI 入口"定性后才 `--update` 登记，未绕过守卫）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
