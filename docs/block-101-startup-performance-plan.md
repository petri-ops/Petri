# BLOCK-101-STARTUP-PERFORMANCE — 启动性能专项（瞬时加载 · 用户无感）

状态：`completed（2026-09-18 当日启动即收口 P0→P5；基线 dataReady 984ms 中位〔dev 态 5 采样〕+ SWR 快照链落地〔契约 4/4 + 主实例写回 CDP 铁证〕；P2 无串行链/P3 虚拟化 deferred〔>300 节点阈值〕/P4 打包态 deferred〔dist 产物保管〕均如实回写 §7；flow block101-startup-timeline allPass；UI-416 verified）`

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
| D2 | SWR 快照键与失效 | `petri-startup-snapshot-v1`（projects 列表），版本号失效；仅渲染缓存不参与业务判断 |
| D3 | 虚拟化阈值 | 树节点 > 300 才实施（按 P0 度量定） |
| D4 | 打包态 profile 入范围 | 推荐入（unsigned packaged，UI-141 先例，仅采样不发布） |
| D5 | 首屏 SWR 与 BLOCK-99 文件面 | KnowledgeSpacePanel 零触碰；AppRailContext/useConversations 若重叠撞期即停手上报 |

## 6. 与既有资产的关系

BLOCK-95 A1（消息游标）已保护会话加载；BLOCK-100 测试实例为启动采样提供隔离环境（flow 直连 9223 不扰用户窗口）；UI-407 领域感知卡与首屏无文件面重叠。

## 7. 度量基线（P0 采样后回写，2026-09-18 dev 态 5 冷启动采样）

flow `block101-startup-timeline`（自管测试实例，独立 userData 冷启动）×5：

| 段 | 中位 | min~max | 语义 |
| --- | --- | --- | --- |
| mainReady | 106ms | 105~108 | 进程起点→whenReady resolve |
| preload | 313ms | 304~321 | mainReady→did-start-loading（SPA server 等待为主） |
| windowShown | 889ms | 870~902 | →ready-to-show |
| didFinishLoad | 890ms | 871~903 | →文档就绪 |
| firstPaint | 796ms | 772~804 | 渲染层 paintTiming（页面时间轴） |
| **dataReady** | **984ms** | 948~985 | 左栏项目列表到货（D2 主观测点） |
| domContentLoaded | 589ms | 561~593 | 渲染层 navigation timing |

**P0 结论（按数排优先级）**：
1. **dataReady（984ms）≈ windowShown（889ms）后 ~100ms**——「瞬时加载」的感知瓶颈是首帧到内容就绪的窗口：Vite dev 链占大头（模块转换），打包态（P4 评估项）才是真实用户数字；dev 态下该窗口已 <100ms，**SWR（P1）的收益在打包态与后端冷启动竞态**（BLOCK-87 退避重试链证明过 0~15s 等待真实存在）。
2. preload 段 313ms 是 mainReady→did-start-loading 的 SPA server 就绪等待，压缩空间在此段（打包态为本地文件加载，预计大幅缩短）。
3. 左栏项目树 9 项目 ~几十 DOM 节点，**P3 虚拟化按 D3 阈值（>300 节点）不立项**（deferred，量级差两个数量级）。
4. P2 并发化：首批数据链已是单请求（listProjects），无串行瀑布；导航后其余面板按需加载，无启动期可并发化目标——**P2 以 P0 火焰为准无需实施**（诚实结论：没有找到可优化的串行链）。

**P4 打包态评估**：**deferred（2026-09-18 如实登记）**——`npm run build:win` 会重写 `dist/`（当前存放 rc.7 发布候选产物，覆盖违背产物保管；UI-141 先例是打包到独立目录）。打包态采样（dataReady 真实值、preload 段压缩验证）留作独立窗口执行，届时可用 `electron-builder --dir` + `--config.output` 指向临时目录零覆盖。本包核心快赢 SWR 已落地，不阻塞收口。

G0 开发期常态 · 不外推 packaged/Provider/GA。
