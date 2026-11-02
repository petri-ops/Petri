---
capability: block-333-ui-leg-live-batch
status: completed
goal: 按 BLOCK-332 分诊表的「可补实机腿」清单补真实 UI 实机腿。第一批 = UI-639a（Model3D 约束编辑器工作区腿）：从真实入口（文件预览 →「在 3D 模型打开」）走完 选节点/面 → 提交 → 写盘 → 非法约束 fail-closed → 移除 的闭环。
acceptance:
  - 实机 flow `block333-ui639a-constraint-editor-live`：**13/13 allPass**（dev 栈重启后复跑，U10 移除通过、约束 id=c1 由创建端分配）。
  - 契约 test/block333-constraint-id-addressable.test.mjs 5/5（创建即分配唯一 id / 按 id 可删 / 重复 id 拒 / 校验给错 / 老场景加性兼容）。
  - 跨语言白名单一致：test/block322-p3-constraints.test.mjs 8/8（前后端 CONSTRAINT_FIELDS 同步加入 id）。
  - 前端库回归：frontend/src/lib/scene3d.test.ts 15/15。
reopen: 已兑现（2026-11-02 重启后 13/13，UI-639a 翻 verified、live-missing 棘轮 6→5、债 29→28）。下一批候选=UI-475（需 mock 无 vision 模型）/ UI-522（设置面导出实机走查）。
---

# BLOCK-333 — UI 补腿批（第一批：UI-639a 约束编辑器）

状态：**completed（2026-11-02 当日立项当日收口；实机 13/13）**
truthDomain：`block-333-ui-leg-live-batch`
canonical 入口：本文件

## 1. 裁决来源

用户 2026-11-02「行 按照建议继续推进」——承接 `next:suggest` 单一建议 `ui-leg-live-batch`（Jev 不可用 `jev_unavailable:no_key`，按队列序兜底）。范围来自 BLOCK-332 plan §4 分诊表：`live-missing` 6 条中 **UI-639a 是唯一"本机 dev 栈即可补"的一条**（UI-475 需 mock 无 vision 模型、UI-522 需设置面走查、UI-534 实为交付债、UI-595/UI-639h 随 artifact seed、UI-526 卡 R 运行时授权）。

## 2. 实机腿怎么走（真实入口，不是调 API）

`Page.navigate → /project/<id>?file=scene.scene3d.json` → 预览出现「在 3D 模型打开」→ 点进右栏 3D 工作面 → 约束 section 四个下拉（节点 A / 面 A / 节点 B / 面 B）→ 提交 → **读磁盘**确认 `scene.scene3d.json` 里真的多了一条 mate 约束 → 再制造必然失败的约束看错误是否如实透传且不写盘 → 移除 → 文件归零。

判据沿用 BLOCK-322 惯例：**写盘事实由磁盘复核**（不看 UI 自述）、**fail-closed 可见**、**可撤销**。

## 3. 实机腿抓到的真缺陷（本包修了）

**约束一旦建出来就再也删不掉。** 现场证据链：

1. 编辑器「移除」按钮是 `disabled={busy || !row.id}`（`SceneConstraintEditor.tsx:140-146`）；
2. 后端 `remove_constraint` 按 `c.id` 匹配（`scene3d.js:1002`）；
3. 但 `add_constraint` **从不分配 id**（`scene3d.js:982`），`CONSTRAINT_FIELDS` 白名单也不含 `id`——所以 `row.id` 永远 undefined、按钮永远灰着，强发请求也只会 `constraint_not_found`。

**修法（补回既有契约，不是新能力）**：`id` 纳入四类约束白名单 → `add_constraint` 缺省分配唯一 `cN`（避开既有 id）→ 显式传入重复 id 直接 `duplicate_constraint_id` → `validateSceneSpec` 对重复/非法 id 给错。老场景（约束无 id）仍然合法（加性）。

跨语言一致性由既有 `test/block322-p3-constraints.test.mjs` 机械锁死——前端的 `CONSTRAINT_FIELDS`（`frontend/src/lib/scene3d.ts:349`）必须同步，否则该门禁立刻红（本包实测抓到一次）。

## 4. 断言明细（flow 输出）

| # | 断言 | 结果 |
| --- | --- | --- |
| U0 | SPA 目标在场 | PASS |
| U1 | 临时项目 + 工作区就绪 | PASS |
| U2 | 文件预览出现「在 3D 模型打开」 | PASS |
| U3 | 3D 工作面 + 约束编辑器同时在场 | PASS |
| U4 | 四个下拉（2 节点 + 2 面）都有选项 | PASS（base/tower；+x/-x/+y/-y/+z/-z） |
| U5 | 节点下拉可选两个不同节点 | PASS |
| U6 | 选节点后面下拉按特征表重建（6 面） | PASS |
| U6b | 合法约束提交无错误 | PASS（A=+x ↔ B=-x） |
| U7 | **约束真的写进 scene.scene3d.json** | PASS（kind=mate，aFace=+x，bFace=-x） |
| U8 | UI 约束列表反映且无错误 | PASS（`贴合 base·+x ↔ tower·-x`） |
| U9a | 同节点自贴合被前端守卫拒 | PASS（`请选择两个不同的节点。`，文件未变） |
| U9b | 法向同向（+y/+y）被**后端**拒 | PASS（`需要法向相反的同轴平面（+y/+y）`，文件未变） |
| U10 | 移除约束 → 文件归零 | PASS（重启后端后：约束带 id=c1 → 点「移除」→ 文件 constraints 归零、UI 空态） |

## 5. 环境抓真

- `selectPageTarget` 返回的是 **target** 不是 client，必须再 `connectTarget`（首跑踩到）。
- poll 的返回值必须**只在目标态**出现才算数：早期写法把「surface 已出现」当返回，导致 form 还没渲染就判定（已修）。
- 约束可解性有硬条件：**法向相反的同轴平面**（`+x/+x` 被后端明确拒）——最初按 `+x/+x` 选导致 U6b/U7/U8 连续红，诊断打通后才定位。

## 6. 非范围

- 不改约束求值求解器（`applyConstraints` 语义零变化）；只让约束**可寻址**。
- 不迁就老场景补 id（历史约束保持无 id，可通过重新创建获得 id）。
- 本批不覆盖 UI-475/UI-522/UI-534/UI-595/UI-526（见 §1 理由）。

## 7. 完成语义

`completed`＝flow **13/13 allPass**（含重启后 U10）+ UI-639a 翻 `verified`（dev Electron 边界内）+ 契约 5/5 + 跨语言白名单 8/8 + 前端 15/15 + BLOCK-332 棘轮下调（live-missing 6→5、债 29→28）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
