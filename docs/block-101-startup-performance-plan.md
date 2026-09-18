# BLOCK-101-STARTUP-PERFORMANCE — 启动性能专项（瞬时加载 · 用户无感）

状态：planned / P0-PLANNED（2026-09-18 立项登记，排队；启动需用户裁决。用户裁决原话「专项立 BLOCK-101 排队」）

## 1. 背景与问题定义

用户提出（2026-09-18）：「随着项目逐渐递增打开软件加载会不会变得很慢……我希望瞬时加载 用户无感」。

**P0 前置实测（2026-09-18，已采）**：项目列表 API 当前 9 项目 = **6ms / 9.6KB**，单条 SELECT 无 N+1——**项目数量本身不是启动瓶颈**（几百项目量级该接口仍为几十 ms）。真正的启动时间分布未度量，候选嫌疑：①前端首屏 bundle 解析 + 首批 API 串行往返；②左栏项目树 DOM 无虚拟化；③恢复会话的概览类查询（消息加载已被 BLOCK-95 A1 游标限流保护）；④Electron 窗口显示策略。

## 2. 目标与红线

- **目标**：「瞬时加载 · 用户无感」——打开即见上次内容（快照渲染），后台静默对账。
- **家法红线（BLOCK-95 同款）**：**度量先行，无数字不优化**——先立启动 timeline 分段仪表（main ready → window shown → first paint → data ready），基线数字进本 plan，再按数排优先级。
- 不做第二真相：快照只是渲染缓存，DB 仍是唯一事实源（对账后即弃）。

## 3. 工作面（预排，P0 评审后按度量数据调整）

- **P0 立项评审 + 度量基线**：启动分段计时仪表（dev-verify flow `block101-startup-timeline`）；dev 态采样 N 次 + 打包态采样（打包态是否入范围见 D4）；数字回写本 plan §7。
- **P1 首屏 SWR（核心快赢）**：项目列表 localStorage 快照 → 打开瞬间渲染上次内容 → 后台对账刷新（数据~6ms 时代亦消除首帧等待串行链）。
- **P2 首批 API 并发化**：启动期请求依赖图梳理，串行链改并发（按 P0 火焰定位）。
- **P3 左栏虚拟化（按度量决定）**：项目/会话树 DOM 节点数超阈值时才立项实施。
- **P4 打包态启动 profile（评估项）**：unsigned packaged 启动采样（UI-141 先例）；范围裁决见 D4。
- **P5 实机收口**：前后数字对账 + flow 断言 + closeout。

## 4. 非范围

Provider / GA / 发布流水 / 签名（G1+）；Vite dev 冷启动优化（开发态工具链非产品路径）；BLOCK-95 已收口面（消息游标加载/cache）重复建设。

## 5. 预置裁决项

| # | 裁决点 | 推荐 |
| --- | --- | --- |
| D1 | 启动分段口径 | main ready / window shown / first paint / data ready 四段（flow 自动采样） |
| D2 | SWR 快照键与失效 | `gewu-startup-snapshot-v1`（projects 列表），版本号失效；仅渲染缓存不参与业务判断 |
| D3 | 虚拟化阈值 | 树节点 > 300 才实施（按 P0 度量定） |
| D4 | 打包态 profile 入范围 | 推荐入（unsigned packaged，UI-141 先例，仅采样不发布） |
| D5 | 首屏 SWR 与 BLOCK-99 文件面 | KnowledgeSpacePanel 零触碰；AppRailContext/useConversations 若重叠撞期即停手上报 |

## 6. 与既有资产的关系

BLOCK-95 A1（消息游标）已保护会话加载；BLOCK-100 测试实例为启动采样提供隔离环境（flow 直连 9223 不扰用户窗口）；UI-407 领域感知卡与首屏无文件面重叠。

## 7. 度量基线（P0 采样后回写）

（待 P0 填写：dev 态分段数字 / 打包态分段数字 / 目标值）

G0 开发期常态 · 不外推 packaged/Provider/GA。
