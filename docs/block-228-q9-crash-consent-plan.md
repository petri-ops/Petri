---
capability: q9-crash-consent
goal: Q9 K2——本地崩溃同意与诚实提示：crashReporter 仅本地落盘（不上传），启动时检测上次未正常退出并展示时间/转储文件名（解析不可用时不伪造栈），用户可关闭提示。
acceptance:
  - 主进程 crashReporter 以 `uploadToServer:false` 启动；session-health 记录非正常退出；扫描 crashDumps 只读文件名/大小/时间（不解析栈）。
  - `userPrefs.crashNotice`（默认 true，注册表 94→95 键）控制提示显示。
  - 标题栏下方横幅：上次未正常结束 + 时间 +（有转储时）文件名 +「本地记录，未上传」；「打开崩溃目录」「知道了」。
  - 测试 ≥6（状态评估纯函数 / 组件 / 偏好）；类型/主题门禁；9223 实机腿（横幅/关闭/打开目录）；closeout 十三门。
reopen: minidump 栈解析、崩溃同意上传、崩溃率统计、按版本聚合、自动附诊断包。
status: completed
---

# BLOCK-228 · Q9 续项（垂直切片）：崩溃同意与本地提示

> 用户裁决：2026-10-21「Q9 余项和 Q-DOMAIN P4 data model 按顺序做完」。
> 母纲：`docs/qoder-essence-absorption-plan.md` §6-Q9（K2 崩溃同意/本地解析）。

## 1. P0 实码勘察

| 面 | 现状 | 结论 |
| --- | --- | --- |
| crashReporter | 全仓零使用 | 需新增本地采集（不上传） |
| 崩溃提示 | 无；启动失败只进日志 | 需启动时检测上次异常退出 |
| 诊断 IPC | `src/ipc/diagnostic.js` 只有导出诊断包 | 增补 crash-status/open-dumps，沿用 sender guard |
| 偏好 | `user-prefs` 支持布尔 | 新增 `crashNotice` |

## 2. 范围

1. 主进程 `crash-guard`：启动 crashReporter（local-only）、session-health 文件、崩溃转储清单、干净退出标记、状态查询/打开目录；测试实例守卫的模拟状态。
2. IPC + preload + electron.d.ts：`diagnostic:crash-status` / `diagnostic:crash-open-dumps` / 测试实例 `diagnostic:crash-simulate`。
3. `userPrefs.crashNotice`（默认 true）。
4. 前端 `CrashNoticeBanner`：横幅 + 打开目录 + 知道了；偏好关闭时不显示。
5. 测试 + 9223 实机腿 + closeout。

## 3. 非范围（reopen）

minidump 栈解析、任何上传、崩溃率统计、版本聚合、自动诊断包。

## 4. 红线

- 绝不上传；只读文件名/大小/时间，绝不伪造栈。
- 只在真实异常退出时出现；干净退出不打扰。
- 提示可被偏好关闭；关闭后不再渲染。
- session-health 写入失败不阻塞启动。

## 5. 验收门禁

- `node --test test/block228-*.test.mjs` + 配置基线（95 键）。
- 前端 `CrashNoticeBanner.test.tsx`、`useCrashNoticePreference.test.ts`。
- `test:changed` + `theme` + `types` + `code-size`。
- 9223 离屏实机腿 `acceptance/block-228/`；`npm run closeout` 十三门 PASS。

## 6. 完成语义

`completed` 需：主进程/偏好/横幅/测试/实机腿/closeout。**明确声明**：只做本地提示与文件级证据，不做栈解析/上传。

## 7. 收口（2026-10-21）

**结论：BLOCK-228 Q9 K2 崩溃同意与本地提示 completed。**

### 7.1 交付

- 主进程 `crash-guard`：crashReporter `uploadToServer:false` 本地采集；`session-health.json` 记录启动/干净退出；启动时评估上次是否异常退出；扫描 crashDumps 只读 `.dmp` 文件名/大小/时间（≤5）；`openDumps`；测试实例守卫的 `simulateForTest`。
- IPC/preload/electron.d.ts：`diagnostic:crash-status` / `crash-open-dumps` / 测试实例 `crash-simulate`（沿用 sender guard）。
- `userPrefs.crashNotice`（默认 true，注册表 94→95 键）。
- 前端 `CrashNoticeBanner`：标题栏下方横幅（时间 + 转储文件名 +「本地记录，未上传」+ 打开崩溃目录 + 知道了）；偏好关闭时不渲染；查询失败不打扰。
- **rider（closeout 抓真）**：`test:changed` 的相对 require 门禁撞出既有缺陷——`src/ipc/gen-ui.js` 主进程直连 `require('../db')`（路径不存在且违反「主进程不进程内开 better-sqlite3」）；改为后端 REST `/api/tools/status/:id`（与同文件 workspace 解析同源）。block196 契约测同步从 db stub 换成 fetch stub（让测试追上契约），六道闸行为不变。

### 7.2 验证

- Node **7/7**（session-health 三态 / 重启行为 / dump 清单与测试实例守卫 + 配置基线 4/4 含 95 键）。
- 前端 **2/2**（横幅内容/打开目录/关闭；干净退出与偏好关闭不显示）。
- 9223 离屏实机腿 **5/5**：模拟「上次未正常退出 + probe-block228.dmp」→ 刷新出现横幅（含时间/文件名/未上传）→ 亮/暗截图 →「知道了」关闭 → `crashNotice=false` 不再显示；`acceptance/block-228/`。
- `theme-token-contract` 17/17；`quality:types` 0；`quality:lint` 0 error；`gate:code-size` PASS。
- `npm run closeout` 十三门 PASS（收口时执行）。

### 7.3 边界（reopen）

- 不解析 minidump 栈、不上传、无崩溃率统计/版本聚合/自动诊断包。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
