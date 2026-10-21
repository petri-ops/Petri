---
capability: q9-computer-use
goal: E7 电脑控制垂直切片（Windows 边界内）——构建随包 sidecar、暴露只读状态与真实 probe、设置页可见就绪度与权限提示；控制动作仍走 computer_* + 完全访问档 + ackToken，不新增控制入口。
acceptance:
  - Windows sidecar（.NET 8 单文件自包含）与 axfixture 可构建；`probe` 返回 platform/verbs。
  - 后端 `GET /api/computer-use/status`（platform/supported/built/running/权限提示）与 `POST /api/computer-use/probe`（真实 spawn；未构建 503 `sidecar_not_built`）。
  - 设置「决策与调度」节 `ComputerUsePanel`：状态行 + 权限说明 + 测试连接（probe verbs）+ 失败如实报错。
  - 测试：路由（built=false → 503）、面板（状态/探针/失败）；类型/主题/code-size。
  - 9223 离屏实机腿：面板显示已构建 + 真实 probe verbs + 亮/暗截图；closeout 十三门。
reopen: macOS sidecar 构建与屏幕录制/辅助功能引导（需 Mac）、PiP 实时画面、真实 click/type 端到端（需交互桌面/靶 app 可见）、sidecar 自动更新与签名。
status: completed
---

# BLOCK-229 · E7 垂直切片：电脑控制 sidecar（Windows 边界内）

> 用户裁决：2026-10-21「只剩 E7 与 P4。搞定这俩」。
> 母纲：`docs/qoder-essence-absorption-plan.md` §6-Q9（E7/L4 电脑控制）。

## 1. P0 实码勘察（2026-10-21）

| 面 | 现状 | 结论 |
| --- | --- | --- |
| sidecar 源码 | `sidecars/computer-use-windows`（C#/.NET 8 + FlaUI UIA3；probe/snapshot/click/type/press/scroll/screenshot/wait/close） | 代码在库，产物未构建 |
| 本机工具链 | 仅有 .NET 8 runtime（8.0.30），无 SDK | 已装用户级 SDK 8.0.426 后构建成功 |
| 宿主 | `helpers/computer-use-host.js` spawn/协议/恢复/超时；未构建诚实报错 | 可复用，缺只读状态 |
| 工具面 | 8 个 `computer_*`；控制类完全访问档 + ackToken 两段确认 | 控制授权链完整，不新增入口 |
| UI | 无电脑控制状态面 | 需设置页就绪度/权限提示/probe |

## 2. 范围

1. 构建 Windows sidecar + axfixture（产物 gitignore）。
2. `ComputerUseHost.status()`（不 spawn 的只读状态）。
3. 后端 status/probe 路由 + 注册。
4. 设置「决策与调度」节 `ComputerUsePanel`（状态/权限提示/测试连接/失败可见）。
5. 测试 + 9223 实机腿 + closeout。

## 3. 非范围（reopen）

macOS sidecar 构建与权限引导（需 Mac）、PiP 实时画面、真实 click/type 端到端（本会话桌面非交互，靶窗不可见）、自动更新/签名。

## 4. 红线

- 不新增任何控制动作入口；click/type 仍只经 `computer_*` + ackToken。
- probe 只读；未构建必须 503 诚实失败并附构建指引。
- 不把 probe 成功表述为「端到端控制已验证」。

## 5. 验收门禁

- `node --test test/block229-*.test.mjs`；前端 `ComputerUsePanel.test.tsx`。
- `test:changed` + `theme` + `types` + `code-size`。
- 9223 离屏 `acceptance/block-229/`；closeout 十三门 PASS。

## 6. 完成语义

`completed` 需：构建/状态/路由/面板/测试/实机腿/closeout。**明确声明**：仅 Windows 边界内；macOS 与 PiP/端到端控制仍 open。

## 7. 收口（2026-10-21）

**结论：BLOCK-229 E7（Windows 边界内）completed。**

### 7.1 交付

- 用户级 .NET 8 SDK（8.0.426）安装；`dotnet publish` 构建 `petri-computer-use-windows.exe`（单文件自包含）与 `axfixture-windows.exe`（产物 gitignore）。`probe` 返回 `{platform:"windows", verbs:[probe,snapshot,click,type,press,scroll,screenshot,wait,close]}`。
- `ComputerUseHost.status()`：只读（不 spawn）平台/支持/已构建/运行中/二进制路径。
- 后端 `GET /api/computer-use/status`（含平台权限提示）与 `POST /api/computer-use/probe`（真实 spawn；未构建 503 `sidecar_not_built`）；不含任何控制动作。
- 设置「决策与调度」节 `ComputerUsePanel`：状态行、权限说明、测试连接（probe verbs）、失败如实报错；控制动作仍走 `computer_*` + 完全访问档 + ackToken。

### 7.2 验证

- 路由 Node **2/2**（status built=false 诚实 + probe 503 sidecar_not_built）；前端面板 **2/2**（状态/verbs/失败）。
- 9223 离屏实机腿 **6/6**：REST status built=true、真实 probe（含 snapshot）、设置面板「已构建 是 · 运行中 是」、点击测试连接出 verbs、亮/暗截图；`acceptance/block-229/`。
- `quality:types` 0；`quality:lint` 0 error；`theme-token-contract` 17/17；`gate:code-size` PASS。
- `npm run closeout` 十三门 PASS（收口时执行）。

### 7.3 边界（reopen）

- **macOS sidecar 未构建**（需 Mac + Xcode；权限引导为屏幕录制/辅助功能）——本机 Windows 只能验证 Windows 分支。
- **PiP 实时画面未做**；**真实 click/type 端到端未验证**（本会话桌面非交互，axfixture 窗口对 UIA 不可见 `target_not_found`；probe/build/协议就绪已证）。
- sidecar 自动更新/签名、控制动作审计可视化仍 open。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
