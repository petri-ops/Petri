---
capability: riders-clearing
goal: 清尾批——一次闭环四项在册残项：R-2 bundle 体积基线机制、R-5 D2 注入归属校验、R-6 matrix 行选 idField 加固、BLOCK-128-① 取消终态竞窗分类修复（含③ process_pid 核实）
acceptance:
  - R-2：bundle-size 脚本（vite build→dist 资产 gzip 计量）+ 基线 JSON 锚定（@xyflow/react 增量就此入册）+ 计量/比对纯函数契约测试
  - R-5：D2 注入归属校验（总线选择 artifactId 与 activeArtifact 不匹配→不注入+自愈）契约红绿
  - R-6：matrix 行选 idField 解析加固契约红绿（mapping.rowIdField 缺失时的回退不虚构）
  - BLOCK-128-①：取消终态竞窗分类修复契约红绿（击杀后 finalize 落 cancelled 而非 failed）+ ③ process_pid 核实结论留痕
  - 门禁五门（P6 accepted-red 随集成提交刷新）
reopen: ②墙面板跨后端取消（结构性，dev-infra §76③）不在本包；BK-08 Mac 冷启动取证独立事项
status: active
---

# BLOCK-141 — 清尾批：R-2 / R-5 / R-6 / BLOCK-128-①③

> 立项：2026-10-05。用户裁决「开启新的工作继续 搞完」=在册残项一次清完。形态=轻量批扩形（四项单验收边界：全部在册 riders/加映清零）。来源：BLOCK-138 §8 R-2、BLOCK-139 plan R-5/R-6、AUDIT-LOG 2026-10-01 🟡 BLOCK-128 三条之①③。
> 阶段：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 四项规格

1. **R-2 bundle 基线**：`scripts/bundle-size-baseline.mjs`——frontend 生产构建→dist/assets gzip 计量→比对 `acceptance/bundle-size-baseline.json`（单资产增幅 >20% 或总量 >100KB 即红，--write 重锚）；纯函数（解析/比对）契约测试（不跑真构建）；锚定运行一次（@xyflow/react 增量就此有家）。
2. **R-5 注入归属校验**：useResultStudioEditContext 双通道合成（BLOCK-139 走查 S1 修复处）——bus 选择注入前校验 busSelection.artifactId 与 activeArtifact.artifactId 同源（竞窗：换 artifact 一帧内旧 artifact 的总线选择不得注入）；不匹配→不注入+总线自愈清选。契约测试竞窗两态。
3. **R-6 matrix idField**：ScientificInteractionViewer 行选 rowField 回退链（mapping.rowIdField→manifest.idField→columns[0]）——回退到 columns[0] 不得虚构 idField 语义（如实标注回退来源），行选 idField 断言加固。
4. **BLOCK-128-①竞窗分类**：cancel SIGTERM 后 child close 事件先于 owner.cancelRequested 置位的竞窗 → finalize 落 artifact 校验分支误分类 failed。修法=finalize 兼看 durable 取消标记/击杀来源（killLocalToolJob 路径置位时序），竞窗也分类 cancelled。③ process_pid null 随批核实（读时序与写入点）。

## 2. 非范围

②墙面板跨后端取消（dev-infra §76③ 结构性）；BK-08 Mac 冷启动取证；adopt 流 UI 走查；任何新依赖。

## 3. 验收

四项各自契约红绿 + 五门（P6 accepted-red 随集成提交刷新）+ 主代理终审集成。无实机走查项（全部契约级）。

## 收口（2026-10-05）

- **四项全闭环**：R-2（bundle-size-baseline.mjs 三形态 CLI+稳定资产键 fail-closed+纯函数契约 19/19+真构建锚定 45 键，@xyflow/react 增量入册、--measure 复验绿）；R-5（注入归属校验+自愈，契约含竞窗两态）；R-6（idField 只认声明列，展示兜底与选择身份分离）；BLOCK-128-①（run-plugin-script finalize 取消分类先于失败分支，判据双通道=kill flag+durable 落库；③ process_pid 结论：HTTP 链对照组 ownership pid 落库正常，竞窗已随①修复收敛）。集成提交 b21db4d6（P6 门 13/13 刷新）。
- **门禁**：五门=types 0/lint 0 error/code-size 22669 重打/knip 236（含 acceptance 驱动脚本定性）/test:changed P6 门 accepted-red→b21db4d6 刷新。closeout 十一门 PASS（6569f692 同日跑通先例；本包复跑于台账批后）。
- **剩余清单全清**：riders R-2/R-5/R-6 closed、BLOCK-128-① closed（②墙面板跨后端=结构性留 dev-infra §76③、③已核实）、R-1 已随 BLOCK-140；BK-08/adopt 流 UI 为独立登记项非本批。G0 开发期常态 · 不外推 packaged/Provider/GA。
