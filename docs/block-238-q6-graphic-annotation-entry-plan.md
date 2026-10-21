---
capability: q6-graphic-annotation-entry
goal: 让椭圆/箭头批注从「可渲染」变为「可创建」——把已提交的 kind 契约与渲染层接到工具条、会话状态与持久化链，使用户能用形状工具画批注并保存；不新增数据模型、迁移或第二套批注词汇。
acceptance:
  - 前端契约镜像与后端单一源同步：导出 `AnnotationKind` 与 `ANNOTATION_KINDS`（region/ellipse/arrow），`CreateAnnotationInput.kind?: AnnotationKind`；越界值在编译期被拒。
  - 创建链贯通：`annotation-client` 不再写死 `'region'`，kind 由工具条选择经 session → hook → REST 载荷落库；省略 kind 时仍回落 region（既有调用零行为变化）。
  - 工具条在绘制态提供 region/ellipse/arrow 三档选择（可访问名称 + pressed 态），选中形状在 draft 预览中可见；批注列表标出形状语义。
  - 已保存批注按 kind 渲染 region/ellipse/arrow（已提交的渲染层不得回退）。
  - 定向组件/契约测试覆盖：选择回调、REST 载荷 kind、draft 形状、图像宿主端到端落库；红绿证据留痕。
  - `quality:types` 0、批注邻域定向测试全绿、closeout 十三门 PASS；UI-546 按证据等级如实标注（无实机腿即 in_progress）。
reopen: 任意角度箭头（当前以拖拽矩形对角线近似；横/竖细箭头受 `MIN_ANNOTATION_SIDE` 双边约束，属契约层 reopen）；六种图形工具/撤销重做/文字/马赛克；pack iframe 面批注；真实结果 job 实机腿（无夹具时）。
status: completed
---

# BLOCK-238 · Q6 图形批注（ellipse / arrow）：创建入口补齐

> 用户裁决：2026-10-21「补 BLOCK-238 立项 → 读完 4 个文件 → 改一个验一个（types 每步跑）→ 组件测试 → UI-546 + closeout」。
> **治理事实（必须如实保留）**：`edad85ea`（契约白名单）、`20be172d`（渲染层）、`3d219d45`（前端类型）三笔提交**先于立项发生**；本文是补登记，不改写提交历史。补登记前状态=「按包纪律干活但未走立项手续」；本包把验收边界、证据口径与 UI 台账补齐。
> 前置：BLOCK-219 Q6 批注 host（旁路元数据 + 归一化坐标 + PDF/图像区域批注 + 加入任务，UI-533 verified）。

## 1. P0 实码勘察（2026-10-21，只读实测）

| 面 | 当前证据 | 结论 |
| --- | --- | --- |
| 后端 kind 契约 | `core/shared-backend/result-annotation-contracts.js:23` `ANNOTATION_KINDS = ['region','ellipse','arrow']`；`:126-129` 校验未知 kind | 契约已接受三种形状 |
| 持久化 | `src/migrations/015_result_annotations.sql:23` + `result-annotation-schema.js:35` `kind TEXT NOT NULL DEFAULT 'region'`；`result-annotation-store.js:61/101/125` 读写 kind | **零迁移**；BLOCK-219 已建列 |
| 前端类型镜像 | `frontend/src/lib/annotations.ts:18` `AnnotationKind = 'region' \| 'ellipse' \| 'arrow'`（未导出）；`ArtifactAnnotation.kind` 已有 | 类型层已就绪，`CreateAnnotationInput` 缺 kind |
| 渲染层 | `AnnotationOverlay.tsx:117` `data-kind`；`AnnotationOverlay.module.css:87-119` 椭圆/箭头形态；`AnnotationOverlay.test.tsx:40-59` kind 断言 | 已提交，本包不得回退 |
| **创建缺口 1** | `annotation-client.ts:94` 写死 `kind: 'region'` | 无论 UI 选什么都只落 region |
| **创建缺口 2** | `annotations.ts:57-64` `CreateAnnotationInput` 无 kind | 客户端类型无法表达形状 |
| **创建缺口 3** | `useArtifactAnnotations.ts:33-38` add 入参无 kind；`useAnnotationSession.ts:65-69` pending 无 kind | 会话状态不携带形状 |
| **创建缺口 4** | `AnnotationBar.tsx:99-115` 绘制态只有颜色色板；`AnnotationOverlay.tsx:127-134` draft 无 `data-kind` | **用户造不出 ellipse/arrow**，也无形状预览 |
| 测试基线 | `annotation-client.test.ts:97` 断言 kind=region；`AnnotationBar.test.tsx` 6 项；`AnnotatableImagePane.test.tsx` 端到端 2 项 | 需扩 kind 用例并保持旧断言 |

**P0 结论**：数据模型、契约、渲染均已具备；唯一缺口是「创建入口 + 载荷贯通」。本包是**补入口**而非扩模型，风险集中在状态传递遗漏（session 切换/旧调用回落），用类型门禁 + 定向测试兜住。

## 2. 范围与阶段

| 阶段 | 内容 | 出口断言 |
| --- | --- | --- |
| **P1 契约与载荷** | 导出 `AnnotationKind`/`ANNOTATION_KINDS` + `describeAnnotationKind`；`CreateAnnotationInput.kind?`；client 传 `input.kind \|\| 'region'`；hook add 透传 | client 单测：显式 kind 落载荷、省略回落 region |
| **P2 会话状态** | `useAnnotationSession` 增 `kind` + `setKind`，pending 保存时取当前 kind（与颜色同构，不随 scope 切换重置选择） | 会话/host 测试：选择 → 保存载荷 kind 正确 |
| **P3 工具条与预览** | `AnnotationBar` 绘制态三档形状选择（`data-testid=annotation-kind-<kind>`，aria-pressed）；列表条目显示形状；`ConnectedAnnotationBar` 映射；Overlay 增 `kind` prop 并给 draft 标 `data-kind`；两宿主透传 | 工具条选择回调 + draft kind 渲染断言 |
| **P4 测试收口** | 红绿补齐；批注邻域定向测试 + Node 契约测试 | 定向 0 红；`quality:types` 0 |
| **P5 收口** | UI-546 台账 + canonical 回写 + closeout 十三门 | 十三门 PASS；提交；推送另等发令 |

**批内纪律**：①每阶段至少跑一次 `quality:types`（用户明确要求「types 每步跑」）；②旧调用/旧数据回落 region，行为零变化；③不在本包扩 kind 白名单、不改坐标几何、不动后端。

## 3. 非范围（reopen）

- **任意角度箭头**：现有几何=拖拽矩形对角线近似，箭头恒指向右下；横/竖细箭头被 `MIN_ANNOTATION_SIDE`（前端 0.004、后端 0.001）双边约束拒绝。要支持需改契约几何（增加方向/端点），属独立 reopen。
- 六种图形工具（画笔/文字/马赛克等）、撤销重做、批注合成图导出。
- pack iframe 面批注（BLOCK-219 已登记 reopen）。
- 文本选中批注/速记板（Q2）。
- 真实结果 job 实机腿：dev 库无夹具时如实登记，不用合成数据宣称 verified。

## 4. 验收门禁

1. **红绿先行（HK-01）**：先落失败测试（工具条无形状选择 / client 载荷无 kind / draft 无 data-kind），记录失败输出，再写实现转绿。
2. 前端定向：`annotation-client`、`AnnotationBar`、`AnnotationOverlay`、`AnnotatableImagePane`（含 `annotations` 纯函数邻域）。
3. Node 契约：`node --test test/block219-result-annotations.test.mjs`（kind 白名单用例保持绿）。
4. `npm run quality:types`（每阶段）。
5. `npm run test:changed`（若树干净空转，如实记录，不表述为影响范围已验证）。
6. `npm run closeout` 十三门。
7. `npm run output:judge`（收口声明前）。

## 5. 完成语义

- `completed` = 创建链贯通 + 定向测试绿 + UI-546 回写 + closeout 十三门 PASS + canonical 回写。
- **UI-546 证据等级**：代码+组件测试绿但未跑 dev 栈实机腿时记 `in_progress`，不升 `verified`；升级需 9223/dev Electron 边界内实机证据（先例：BLOCK-236 的 UI-544/545）。
- 本包不改写三笔先行提交；补登记与实现同批提交，收口笔录注明治理补票事实。

## 6. 收口（2026-10-21）

**结论：BLOCK-238 completed；UI-546 保持 `in_progress`（无实机腿）。**

### 6.1 交付

- **前端契约**：导出 `AnnotationKind` / `ANNOTATION_KINDS` / `ANNOTATION_KIND_LABELS` / `describeAnnotationKind`；`CreateAnnotationInput.kind?`；`annotation-client` 不再写死 region（省略回落 `region`）。
- **会话与载荷**：`useArtifactAnnotations.add` 与 `useAnnotationSession` 携带 kind；`ConnectedAnnotationBar` 统一映射。
- **UI**：工具条绘制态三档形状（`annotation-kind-<kind>`，aria-pressed）；draft 形状预览；列表形状标签；图像/PDF 两宿主透传。
- **样式**：draft 的椭圆/箭头预览（主题 token）；既有保存态渲染零回退。
- **零迁移、后端零改动**；旧调用行为不变。

### 6.2 验证

- **红绿**：5 条失败（client 载荷 / 工具条选择 / 列表形状 / draft `data-kind` / 宿主端到端）→ 实现后定向 **25/25**。
- **邻域**：**42/42**（annotations / resultAnnotation / WorkspacePdfPreview / WorkspaceFilePreview）；Node 契约 **13/13**；theme **17/17**。
- `quality:types` **0**；`npm run closeout` **13/13 PASS**（test:changed changed=24 / nodeTests=6 / frontendTests=7 / syntax=1；ui-audit 499 IDs；knip 255 键）。
- `output:judge`：首轮 **RETRY**（fit 2.81，判词=未紧扣请求），收紧后复跑 **PASS**（fit 3.55）。
- `test:suggest`：改动前零建议（树干净）；改动后建议 `test/window-manager.test.mjs`，该文件不存在（陈旧建议，如实记录、未执行）；`doc:suggest` 零建议（树干净）。

### 6.3 边界（如实）

- **无实机腿**：未在 dev 栈打开 PDF/图像批注面走「选形状 → 保存 → 渲染」，UI-546 记 `in_progress`；升 `verified` 需 9223/dev Electron 证据。
- **箭头几何**=拖拽矩形对角线近似（恒指向右上）；横/竖细箭头受 `MIN_ANNOTATION_SIDE` 双边约束；任意角度/方向属契约 reopen。
- 六种图形工具/撤销重做/文字/马赛克、pack iframe 面批注不动。
- **治理补票**：先行提交 `edad85ea` / `20be172d` / `3d219d45` 不改写；`20be172d` 的 UI 门禁豁免按不可变提交先例登记，台账=UI-546。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
