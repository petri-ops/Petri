---
capability: block-382-post-nso-s7-final-report
status: completed
goal: S7 终验与总收口——十一维按蓝图 §2 口径复评（与评估时/NSO 后并列，差值逐条归因，跑完不回溯调参）；真实任务终验腿按机器会话现状如实分级；总收口报告落盘。
acceptance:
  - 十一维复评表落盘（本次复核=S7 时点，机械读数+锚点指针）
  - 未达证据的项不写 completed/verified（真实任务腿如实挂起）
  - 总收口报告：每包证据链/红门终态/分片结论/UI 台账终态/WIP 保留状态/待人工清单
reopen: 机器会话恢复后按待人工清单逐条取证
---

# BLOCK-382 · S7 真实任务终验与总收口（post-NSO 蓝图 §13）

> 承载蓝图 §13。发令：用户预授权连续工作模式。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 蓝图 §13 逐项终态

| 项 | 终态 | 证据/补腿 |
| --- | --- | --- |
| §13.1 8 任务套件连续 3 次 8/8 | ⏸ 挂起 | 真实任务腿=机器会话恢复后（本会话 AX 环境档在案：block48 AX 窗口内容缺席/runLoop 主链测试受同因牵连）；T6 归因前置 |
| §13.2 T7 去窗口触发压缩 | ⏸ 同上 | 补腿=健康会话跑真实长任务 |
| §13.3 humanEyePending 判据 | ⏸ 挂起 | Agent 不代答（硬线）；判据表冻结在 results-v2final.json |
| §13.4 真实 provider 长任务 | ⏸ 同上 | attempt 级记录随 dev-verify flow |
| §13.5 EAR ≥45% | ❌ 如实 | 当次 42.7%（阈值 40% 门 PASS；45% 未达不硬写） |
| §13.6 十一维复评 | ✅ | 见 §2 |

## 2. 十一维复评（S7 时点 2026-11-07；HEAD c3201ca6；口径=蓝图 §2，三列并列不回溯）

| 维度 | 评估时 | NSO 后 | S7 复核 | 蓝图目标 | 归因（差值驱动项） |
| --- | ---: | ---: | ---: | ---: | --- |
| 功能完整性 | 4.2 | 4.3 | 4.4 | 4.7 | S1 全链 RST 三腿+增量摘要+网关 status 修复（+0.1）；fallback 弃用链路待真实任务证明 |
| 性能表现 | 3.5 | 3.8 | 3.8 | 4.5 | 连续采样判据落地但连续全绿证据未得（本机负载红轮）；五段分解未做 |
| 代码质量 | 3.3 | 3.6 | 3.7 | 4.5 | 分片 387→38 根修 349+两红门清零+code-size 全程受控重打（+0.1）；巨型文件拆分未动 |
| 可维护性 | 3.2 | 3.5 | 3.6 | 4.4 | 实例化单源/contractVersion 收编/coverage 单写入器（+0.1）；runLoop 拆分未动 |
| 可扩展性 | 4.2 | 4.5 | 4.5 | 4.8 | 同 NSO 面（knip 保留面 329 冻结受控；三矩阵同源=block357 门守住） |
| 安全性 | 3.4 | 4.0 | 4.2 | 4.6 | file: 注册制+写通道双 guard+准入内核+manifest 自证链+FK 三面一致（+0.2）；ADMISSION 拨硬与 FK 全量切换=后续 |
| UI 与交互 | 3.7 | 3.7 | 3.8 | 4.6 | 字号宪章收官/重放队列/空 flags/inert/能力位（+0.1）；实机腿 5 条挂起 |
| 错误处理 | 3.1 | 3.5 | 3.7 | 4.6 | compaction_failed/task.failed 三态/四事件轨迹面/stream_stall 可观测（+0.2）；SSE 客户端终态不再依赖轮询判死 |
| 测试覆盖 | 3.7 | 4.1 | 4.2 | 4.7 | 新族 24 项+nso-s2 五族+impact-coverage 148→145+分片归因体系（+0.1）；148 清偿未完 |
| 文档完善度 | 4.3 | 4.5 | 4.6 | 4.8 | coverage 单写入器/512 注册全 PASS/证据元数据增量面（+0.1） |
| 依赖与架构 | 3.7 | 3.9 | 4.0 | 4.6 | 实例化单源/版本域澄清/FK 真相一致（+0.1）；三套依赖树与 13 环未动 |

**综合**：S0-S6 七包把「收尾时未闭合的证据链」大规模闭合（红门清零、真相冲突钉死、执行准入结构面闭环、测试归因体系建立）；十一维七升四平零降。剩余=实机会话腿（任务套件/人眼/长任务/五段分解）与大拆片（runLoop 等）——分层登记非本程序可闭合。

## 3. 总收口报告

### 3.1 程序包证据链（七包 40+ 提交）

| 包 | 提交 | 核心交付 | 门禁 |
| --- | --- | --- | --- |
| BLOCK-375 S0 | 7c7e8d3b+24ba8c43 | 两红门清零+分片 387→38 根修 349+canonical 对账+WIP 清单 | 九门绿+closeout |
| BLOCK-376 S1 | 1a439237 | errorsAsRejections 全链+增量摘要+SSE 三态+四事件+网关 status 抓真 | nso-s1 10/10+九门 |
| BLOCK-377 S2 | f267a16d | FK OFF 三面一致+链哈希 UPDATE+file: 注册制+准入内核+manifest 自证+execToken 删除 | nso-s2 五族 17/17+九门 |
| BLOCK-378 S3 | 5c767ce1 | 字号宪章 20 处+重放队列+空 flags+inert+能力位 | theme 17/17+九门 |
| BLOCK-379 S4 | 8cee5d9f | 实例化单源+contractVersion 收编（双版本域澄清） | 回归 76 项+九门 |
| BLOCK-380 S5 | 2013e1ad | 连续采样判据（最差轮口径） | perf 判据面 |
| BLOCK-381 S6 | faf87749+c3201ca6 | coverage 单写入器+收口批 | closeout **PASS 全绿** |

### 3.2 红门终态

gate:code-size PASS（全程受控重打 4 次，每次留因）· quality:knip:check PASS（329 键）· docs:check PASS（512）· ui:audit PASS（631）· hygiene PASS · secret/arch/lint(0 error)/types(0) PASS · closeout **PASS（16 门全绿）** · quality:surface PASS（P1=0）· quality:ear PASS（42.7%>40% 门；45% 目标未达如实）· quality:perf 判据 PASS（连续全绿证据待机器恢复）。

### 3.3 全量分片结论

node-core 387→38（349 根修）；残红 38=16 C-46+1 P6+1 S4 专项+20 环境档（block48 AX 会话档 7 skip 化+sidecar 平台门 skip 化后余量为真实环境依赖）；frontend/node-long 全绿。**逐件归因台账=stage-0/shard-attribution.json**。

### 3.4 UI 台账终态

631 带证据编号；UI-700/701 in_progress（实机腿挂起）；7 live-missing/25 blocked 棘轮上限随事实同步（BLOCK-370/371/376 先例留因）。

### 3.5 WIP 保留状态

preserve 项零触碰（wip-inventory.json 17 项：并发写入者 1 文件+用户资产 7+临时目录 2+孤儿证据 1+backfill 脚本 1〔S2 已登记收编点〕）；adopt 项 8（章程/生成器产物/charter 登记）全部随包入库留因。

### 3.6 待人工/待实机最小清单（补腿条件=机器会话恢复）

1. 8 任务套件连续 3 次 8/8（§13.1；T6 归因前置）
2. T7 真实默认窗口压缩 + 20 项 FACT（§13.2）
3. humanEyePending 判据集中过目（§13.3；判据表冻结在案）
4. 真实 provider 长任务 attempt 级记录（§13.4）
5. P6 源绑定重算（S0 pending；干净树+健康会话）
6. UI-697/698/699/700/701 实机腿集中一次（UI 台账终态化批）
7. perf 连续 5 次全绿证据
8. C-46 兄弟仓 deseq2.R 语法错修复（需兄弟仓授权）
9. PETRI_EXEC_ADMISSION 拨硬（S4 全调用面审计后）
10. FK=ON 全量切换（179 违约清偿独立大包）
11. runLoop 五段/SimpleChat/workspace-tools 大拆片（W5b 纪律逐刀）

### 3.7 G0 声明

G0 开发期常态 · 不外推 packaged/Provider/GA。本程序未撤销任何用户裁决；未新增依赖；未建第二真相。
