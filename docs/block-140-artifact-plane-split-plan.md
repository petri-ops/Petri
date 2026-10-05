---
capability: artifact-plane-split
goal: 成果面切片 C——result 模式内多 artifact 分屏（主+钉住副栏）+ R-1 rider（空态切换器隐藏）；「单结果单焦点」在此刀终结
acceptance:
  - P0：分屏组件契约（钉住后主区切换产物副栏保持/解除钉住/mode 切换副栏清理）先红后绿 + RS 面回归 + tsc 0
  - R-1：切换器空态契约（无图/单节点链→整组不渲染）先红后绿
  - 实机（dev Electron）：分屏双产物可见、钉住后主区切换保持、空态隐藏、既有单链回归，断言落 acceptance/block-140/
  - 门禁：五门（P6 绑定源门 accepted-red 随集成提交刷新）+ closeout 十一门（主代理集成时跑）
reopen: 拖拽分隔条/跨 job 钉住深化独立裁决；R-2 bundle 基线仍属后续包
status: completed
---

# BLOCK-140 — 成果面切片 C：多 artifact 分屏 + R-1 空态切换器

> 立项：2026-10-05。用户裁决「整下一个工作包」=接受主代理推荐（切片 C + 顺带 R-1）。方向父文档：[`artifact-plane-direction.md`](./artifact-plane-direction.md) §3 切片 C；R-1 自 BLOCK-138 台账迁入（两账同步注记）。
> 阶段：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 一句话目标

result 模式内从「单结果单焦点」升级为「主+钉住副栏」双产物工作面——对比工作流（版本间/产物间）不再来回切换。

## 2. 范围

**P0（分屏骨架）**：①产物工具栏「钉住」动作——把当前查看的产物钉入副栏（40% 底部/侧栏，复用 renderPreview 同一渲染路径，无二次取数）；②钉住后主区自由切换产物/版本，副栏保持；③解除钉住恢复单栏；④mode 切换（code/compare/history）副栏随 result 模式投影清理。
**R-1（空态切换器）**：LineageViewSwitch 自取 /lineage（fetchResultLineage 已在 resultStudioClient.ts:411）——lineage null 或 chain<2 时整组（切换钮+两形态）不渲染；子组件自隐保持双保险。
**P1（第二刀，本包内）**：lineage 节点钉住入口（点祖先 job 产物→钉入副栏）——跨 job 对比的最小闭环；与 selectionBus 的交互=单选择真相 last-write-wins（composer 上下文跟随最后选择，不加第二通道）。

## 3. 非范围（红线）

拖拽分隔条（固定比例，留后续）；不推翻 isSingleActiveMode（分屏是 result 模式内部组合）；零新依赖；后端零改动；不做 compare 差异计算升级（并排即本包边界）。

## 4. 依赖

零新依赖。theme token 纪律随触碰面。

## 5. 设计裁决

D1：钉住=视图级快照（同 renderPreview 路径），非第二数据通道；D2：副栏比例固定 40%（拖拽留后续）；D3：R-1 判空以 /lineage 响应为准（与 builder 真值同源）。

## 6. 验收

契约测试红绿（P0 分屏/R-1 空态）+ RS 面回归 133 测试不破 + tsc 0 + 实机走查三断言（分屏双产物/钉住保持/空态隐藏）+ 五门（P6 accepted-red 模式）+ closeout（集成提交后）。

## 7. 完成语义与节奏

预计两刀（P0+R-1 一刀、P1 一刀）或单会话连做。实现=dynamic workflow（串行红绿+world.run 门禁+实机走查+换眼复核），工作流内不提交，主代理终审集成。

## 收口（2026-10-05）

- **P0 ✓**：分屏骨架（ArtifactPinPane 123 行+Shell 接线，契约 5/5 先红后绿+RS 面 66 绿）；**R-1 ✓**：空态切换器（自取 /lineage 判空，7/7 含既有不破+RS 面 84 绿）；**P1 ✓**：lineage 节点钉住（crossJobPinSnapshot，24 绿+theme 4/4）。集成提交 698d10a9（P6 门 13/13 刷新）。
- **实机走查 ✓（dwfrun-1dea4da6）**：W1 分屏+钉住保持（split-pinned.png）/W2 空态隐藏（empty-state-hidden.png，对照 BLOCK-138 空态常驻缺陷）/W3 有链回归+跨 job 钉住快照（lineage-pin.png）——三截图换眼复核全 confirmed，证据 acceptance/block-140/。
- **门禁**：五门=types 0/lint 0 error/code-size 22666 重打/knip 235/test:changed P6 门 accepted-red→698d10a9 刷新 13/13。hle-c5r skip 守卫环境感知扩展（主线裁决 B 一次性授权，gsea 封存态如实 skip；Mac 激活随 BIO-4 对账）。
- **剩件**：UI-464 用户真窗过目翻 verified；riders R-2（bundle 基线）在册；拖拽分隔条/compare 升级=非范围独立裁决。G0 开发期常态 · 不外推 packaged/Provider/GA。
