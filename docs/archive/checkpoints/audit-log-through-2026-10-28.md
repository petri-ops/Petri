# 审计广播台历史归档 · through 2026-10-28

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（BLOCK-170 自稳设计；
> 活跃台只留「最后更新」链最近 8 条，本档=被淘汰链行原文追加，搬移不改写）。
> 状态与完成语义以 canonical 文档（roadmap/plan/DOC-REGISTRY）为准，本档仅作广播历史追溯。

最后更新：2026-10-28（**推送兑现（用户 2026-10-27「继续 搞完这个」全权收尾指令）**：main 11 笔（e9960ce6..72c1e061，BLOCK-275/276/277/278/279 五包 + UI-591 代落盘 + 对账/自稳治理批）+ 缺失快照标签 snapshot-20261027-7 补推（远端 178=本地全集）；快进推送、未改写历史、未碰其它分支；本行只记录本轮已兑现授权，不构成常驻授权。**当日（10-27）全链**：BLOCK-272~279 八包连收（closeout 定向化/拖拽边界渐变/closeout 内部优化/UI 反馈批×2/计量条恢复/右栏空态重排/UI-587 实机腿）+ UI-588/591/587/589/590/592/593 全 verified + C-35~44 十候选包确认由 BLOCK-264 十包连打完成 + backlog 对账（C-17/19/21 补 ✅）。**剩余用户门**：R 运行时 657MB 授权（解锁结果面批注变体+生信链）/UI-501、503、504、457 过目/UI-588、591 观感异议随时推翻。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-28T11:46:13.570Z -->
最后更新：2026-10-28（**BLOCK-280~289 预授权批 completed（用户「一次性推完 W1-W4，中间不需要我参与」；四波收官）**）：W1=280 C-34 复核证伪+tools 断点加固（原判词漏计 92 工具 ≈21k tokens）/281 C-27 judge 拒绝口径（probe 红绿 2.38→3.73 PASS）/282 C-33 销号核验+标记；W2=283 C-25 合并 v2（同 ts 不丢+ts 稳定排序，BLOCK-169 锁测按授权改写）/284 C-29 chip v2（skill 斜杠→buildSkillItem 结构化通道，UI-594；D15 清单行 stale 纠正）/285 C-31 按裁决跳过；W3=286/287 C-30 按裁决跳过（本机 memory_vectors 实测 0 行，远低于 5 万重开门槛——证据复验留痕）；W4=288 画笔渲染平滑+手掌拒识（存储契约不变，UI-595）/289 右栏空态最近使用面板记忆（按项目 localStorage+上次使用徽章，UI-596）。**教训**：候选池三连过期判词（C-34/C-30/C-31 均为 BLOCK-211 已裁决项）——预授权批启动前逐项读行尾裁定段；UI 面改动即触发 ui:audit 门（UI-594 补行才绿）。UI-594/595/596 in_progress（实机腿随各自实机批）。closeout 十三门全程 PASS；G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-28T12:20:34.405Z -->
最后更新：2026-10-28（**BLOCK-308 completed（UI-610/611/612 verified）**）：拖拽跟手（ref+直写 DOM transform/settle 清场）+ 箭头命中热区 + 三段式图标轨（左工具/中图片/右执行；少时单列、增多自动加列；窄栏换行回退）+ 加入上下文（compose 草稿不发送，顺带修结果面 prompt 丢弃）+ 选择工具（选择态选中/移动、绘制态不抢指针）。证据=批注 41/41 + 受影响前端域 78/78 + 实机 30/30 + 回归 302/303/304；closeout 十三门 PASS。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-28T12:40:20.619Z -->
最后更新：2026-10-28（**BLOCK-309 completed（UI-613 verified；UI-597 两列由用户推翻）**）：模型菜单 mode=all 改「供应商页 → 模型页」下钻（返回行+标题/数量），删除 two-pane 灰底容器与右列提示，选中态改左侧 accent 细线（透明底），菜单 320px；整组不可用仍可进入查看原因。证据=ModelMenu 8/8 + theme 17/17 + 实机 14/14（acceptance/block-307/）+ closeout 十三门 PASS。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-28T13:41:36.219Z -->
最后更新：2026-10-28（**BLOCK-310 completed（UI-614 verified）**）：图片入口识图门改按「有图时的自动决议」判断（自动模式有图会选 DeepSeek 视觉能力），手动/遗留 preset 补能力位，notice 指路；红→绿实机（临时非视觉绑定复现原提示 → 修复后无提示 + 附件入列，共享设置 finally 恢复），auto-model 9/9 + attachments 10/10 + closeout 十三门 PASS。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-28T14:35:36.991Z -->
最后更新：2026-10-28（**BLOCK-311 completed（UI-615 verified）**）：右栏顶部标签条按标签数×可用宽度自动折叠为图标（文本隐藏、title/aria 保留、关闭× hover/激活才出），少标签恢复全标签，仍放不下保留横向滚动；ResizeObserver 驱动。证据=helper 单测 + TitleBar 12/12 + theme 17/17 + 实机 9/9（11 标签 compact/无溢出/图标齐全；关闭其他→1 标签恢复）+ closeout 十三门 PASS。拖出独立窗另案（窗口系统已有 pop-out/return，右侧内容绑工作区 ctx）。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-28T15:25:43.228Z -->
最后更新：2026-10-28（**BLOCK-312 completed（UI-616 verified）**）：输入框/消息图片预览 ImagePreviewModal 顶层化——createPortal(body)+z=100000+body 滚动锁（原 9999 且未 portal，被标题栏/分隔线 10001 压住）；Lightbox 已同口径并实机复核；全量图片预览入口审计入册（内联预览不需要顶层化）。实机 11/11（overlay 覆盖视口/父 body/z=100000/标题栏与全部分隔线 0 miss；灯箱同口径）。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-29T03:32:31.503Z -->
最后更新：2026-10-28（**BLOCK-313 completed（UI-617 verified；UI-613 整页下钻交互由用户追加取代）**）：模型菜单主从两栏——左列供应商常驻（当前使用/模型数/选中 accent 线），右侧二级页显示选中供应商模型；默认当前供应商，点其它供应商只换右栏；去灰底+1px 边框+620px+双列独立滚动。证据=ModelMenu 8/8 + tsc/lint + theme + 实机 11/11（4 供应商常驻/默认 DeepSeek 2 模型/切 ninijoker 左列不消失/回切恢复）+ closeout 十三门 PASS。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-29T04:44:26.986Z -->
最后更新：2026-10-28（**BLOCK-314 completed（UI-618 verified）**）：批注列表弹层改 portal 到 body + fixed 定位——右栏向左展开、左右/上下视口钳制、点外/Esc/滚动关闭、z=10002、高度受限内部滚动；不再被面板/分隔线裁切。证据=AnnotationBar 17/17 + tsc/lint + 实机 8/8（10 条列表全在视口内/placement left/条目完整）+ closeout 十三门 PASS。G0 开发期常态 · 不外推 packaged/Provider/GA。
