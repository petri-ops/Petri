# AUDIT-LOG 自动精简归档 · 2026-10-28（audit-log-compact.mjs）

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（用户裁决「AUDIT-LOG 的规范和精简
> 应该是自动化的过程，仅保留必要的内容」）。内容=「最近处理记录」表窗口外淘汰行原文（搬移不改写）。
> canonical 状态以 roadmap/plan/DOC-REGISTRY 为准，本档仅作广播历史追溯。

| ✅ 处理完成（BLOCK-292/298；用户裁决原话「假如我使用了箭头批注，这个批注就不显示…批注不要隐藏起来呀」） | 2026-10-28 | **批注 pending 预览常驻（UI-599 verified）**：hook 暴露 pendingRect/pendingPath 几何，overlay 新增 pending 渲染块，图像/PDF 双宿主接线——画完松手批注立即可见直到保存；修复 begin* 残留旧语义 `setDrawing(false)`（画完即退绘制模式、第二笔拒识，实机 D6 揭示）。annotations 31/31 + 定向 121/121 + 9223 实机 10/10（acceptance/block-298/）；closeout 十三门 PASS。G0 开发期常态 · 不外推 packaged/Provider/GA | UI-599 / BLOCK-292~298 |

<!-- audit-log-compact.mjs 追加 @ 2026-10-28T04:42:58.007Z -->
| ✅ 处理完成（BLOCK-300/299；用户裁决原话「任何一个用于批注的动作 鼠标停止的时候 批注输入框就应该在结束位置出现…允许不填写」） | 2026-10-28 | **批注就地输入（UI-600 verified）**：所有形状工具画完后就地输入框锚在动作终点（Enter/失焦/✓ 确认、Esc/× 取消），text 工具点击图面即就地开框+量取实际尺寸落库，空评论落 defaultAnnotationComment 占位（后端 comment_required 契约不变）；区域面 bar composer 退场（文本锚点面保留）。annotations 33/33 + 主题棘轮零上调 + 9223 实机 10/10（acceptance/block-299/）；reopen=CDP trusted 鼠标 text 分支输入管线差异（探针用合成 PointerEvent 取证，真实用户点击待日常复核）。G0 开发期常态 · 不外推 packaged/Provider/GA | UI-600 / BLOCK-299~300 |

<!-- audit-log-compact.mjs 追加 @ 2026-10-28T04:56:31.525Z -->
| ✅ 收口（2026-09-21，机器重启后实机补跑；用户裁决「工具封装稳定就保留，聊天页展示更纤细的信息」附参考/实况双图） | 2026-09-21 | **UI-430 合并簇呈现密度修正 verified**：①段模型——相邻无 progress 分隔的工具轮合并为单 ToolsSegment（activities 按迭代拼接 + reasoningByIteration 逐轮思考），progress 与纯思考迭代为分隔符；②qoder 分支按迭代交错渲染（每轮「已思考行→该轮工具行」）+ 单工具簇头携带工具一行摘要（截 64 字）+ 零耗时隐藏；③block107-timeline-live L4「一迭代一簇」契约修订为「簇内迭代非降序」（flow 留痕，UI-430 取代）。验证=契约 62/62 + tsc 0 + lint 0 + 九门（既有绿）+ flow `block108-qoder-stream` **7/7**（机器重启后补跑；同批 flow 健壮性定版=按钮 click 发送[合成 Enter 不被 composer 提交]+导航后 10s 路由稳定等待+提交确认 2.5s×4 重试——flow 侧修正非产品缺陷）。截图 acceptance/block-108/。**当前无 active 工作包**。G0 开发期常态 · 不外推 packaged/Provider/GA | UI-430 / VERIFIED |
| ✅ 处理完成（BLOCK-301/300；用户反馈附图「正常情况下图片预览是不是应该顶层，输入框和顶层栏应该回到它们该有的层」） | 2026-10-28 | **图片灯箱 portal 全屏置顶（UI-601 verified）**：根因=灯箱渲染在面板组件树内，祖先 stacking context 把 fixed 全屏降格为相对定位——遮罩被裁、盖不住 composer/顶栏。修复=createPortal 到 body（四处使用处一处生效）。Lightbox 6/6 + resultAnnotation 3/3 + 9223 实机 6/6（acceptance/block-300/：遮罩=视口 1602×1000、composer/顶栏中心 hit-test 均命中灯箱、Esc 关闭）；closeout 十三门 PASS。G0 开发期常态 · 不外推 packaged/Provider/GA | UI-601 / BLOCK-301 |

<!-- audit-log-compact.mjs 追加 @ 2026-10-28T05:38:42.865Z -->
| ✅ 处理完成（BLOCK-302；用户裁决原话「点击设置按钮的时候左侧栏应该隐藏 保持好的使用习惯」） | 2026-10-28 | **设置页隐藏壳层左栏（UI-602 verified）**：App 壳层 AppRail 渲染条件加路由判断——/settings 独立页下左栏（AppRail+LeftPanel 全系统）退场、设置页占满窗口，其余页面常驻不变；设置页自带「← 返回」（history.back）无困死风险。9223 实机 4/4（acceptance/block-301/：首页在场→/settings 退场+占满 1602px→返回恢复）；closeout 十三门 PASS。G0 开发期常态 · 不外推 packaged/Provider/GA | UI-602 / BLOCK-302 |

<!-- audit-log-compact.mjs 追加 @ 2026-10-28T06:49:15.510Z -->
| ✅ 处理完成（BLOCK-303/304；用户反馈附图「批注的箭头按钮正常吗…任何一个批注的图形都应该是这个图形的特征，目前好像都是有外部框的…最好能像画笔一样的效果」+「发送到聊天框的时候都应该带批注图片或文字的路径…方便溯源」） | 2026-10-28 | **箭头真形态+draft 特征化+prompt 路径溯源（UI-603/604 verified）**：arrow 升级两点 path（起点→终点 SVG 线+贴合方向头部，ArrowGlyph 三态所见即所得；契约 25/25 含 rect 旧兼容）；全部形状 draft 从外部虚线框改为最终形状本体；加入任务 prompt 显式带工作区相对路径+读取指引、箭头报真坐标。annotations 463/463 + 定向 194+141 + 9223 实机 7/7（acceptance/block-302/，D5 F1 部分跳过=投递面组件级已证）；closeout 十三门 PASS。dev 栈后端（3001）重启后新契约生效（supervisor 未拉起属 dev 脚本直持进程，已手动等价恢复并如实记录）。G0 开发期常态 · 不外推 packaged/Provider/GA | UI-603/604 / BLOCK-303~304 |

<!-- audit-log-compact.mjs 追加 @ 2026-10-28T07:36:24.497Z -->
| ✅ 处理完成（BLOCK-305；用户反馈附图「这些形状的框是不是应该是没有内部填充的，能看到区域内内容」） | 2026-10-28 | **形状批注透明淡染（UI-605 verified）**：区域/椭圆/箭头外形状内部填充从实色 token 改 12% 同色淡染（color-mix 三色族，draft 与保存后同透明所见即所得；hover 加深 20%；text 衬底/mosaic 模糊保持特性）。主题棘轮 0 新增 + 批注域全绿 + 9223 实机 3/3（acceptance/block-303/：draft/box computed alpha=0.12 + clip 截图）；closeout 十三门 PASS。G0 开发期常态 · 不外推 packaged/Provider/GA | UI-605 / BLOCK-305 |

<!-- audit-log-compact.mjs 追加 @ 2026-10-28T08:46:05.070Z -->
| ✅ 处理完成（BLOCK-306；用户反馈「右侧 栏 上面 + 这个点击无效是出了什么异常吗？确定问题并修复」） | 2026-10-28 | **标题栏更多工具菜单弹出位置修复+图标语义校正（UI-606 verified）**：根因=「+」按钮（实为展开更多工具）的菜单 portal 到 body 后，.toolMenu 类残留 left:calc(100%+6px) 语义变「视口宽+6px」→ 菜单整体弹出窗口右外（实测 x=1608>vw=1602）——点击实际生效但不可见；修复=inline left:auto + 图标 plus→more-horizontal（+ 语义错位校正）+ 菜单 maxHeight 钳视口滚动。tsc 0 + titlebar 16/16 + 实机断言（acceptance/block-304/：icon=more-horizontal、菜单 inViewport x=1195/18 项）；closeout 十三门 PASS。G0 开发期常态 · 不外推 packaged/Provider/GA | UI-606 / BLOCK-306 |

<!-- audit-log-compact.mjs 追加 @ 2026-10-28T09:06:02.163Z -->
| ✅ 处理完成（BLOCK-307；用户四条反馈「enter 才可以确认？对号和 x 无法控制」「文本点击后没办法输入文字」「批注都可以点击拖拽方便移动」「图片居中+工具条列左侧」） | 2026-10-28 | **批注交互四条（UI-607/608/609 verified）**：①✓/× 真实鼠标失效根因=pointerdown 无条件 setPointerCapture 劫持 click（+preventDefault 阻断兼容序列）→ capture 延迟到首次 move + finish 显式释放；②text 开框统一 trusted 拖拽管线（单击为补充路径，与待填互斥）；③已存批注任意模式可拖拽移动（stopPropagation 防误采点、>3px 阈值、clamp 进画布），后端新增 store.updateGeometry + PATCH /geometry；④工具条列左 104px+图片水平居中。契约 26/26 + 批注域 36/36 + 9223 实机 8/8（acceptance/block-305/）；closeout 十三门 PASS。**遗留三条（用户 2026-10-28 追加：拖拽有延迟/箭头批注仍不可拖/左栏布局按截图优化）见 docs/block-307-annotation-handoff.md**。G0 开发期常态 · 不外推 packaged/Provider/GA | UI-607/608/609 / BLOCK-307 |

<!-- audit-log-compact.mjs 追加 @ 2026-10-28T10:16:56.840Z -->
| ✅ 处理完成（BLOCK-309；用户截图「供应商模型列表应该是新的页面，混在一起不专业、灰底不好看」） | 2026-10-28 | **模型菜单下钻页（UI-613 verified；UI-597 两列由用户推翻）**：mode=all 供应商页 → 点供应商进入模型页（返回行 + 标题/数量），删除 two-pane 灰底容器与右列提示，active 态改左侧 accent 细线（透明底），菜单 320px；整组不可用仍可进入看原因（如实展示禁行理由）。证据=ModelMenu 8/8 + theme 17/17 + tsc 0 + lint 0 error + 实机 14/14（acceptance/block-307/live-model-menu-page.json：供应商页无模型行/无 two-pane/页与行透明底、菜单=主题 elevated；模型页返回/2 模型/active inset 细线；返回恢复）+ closeout 十三门 PASS。非范围=mode=supplier/model 单模式与模型目录/白名单/定价链路零改动；供应商页不记忆上次进入项。G0 开发期常态 · 不外推 packaged/Provider/GA | UI-613 / BLOCK-309 |
| ✅ 处理完成（BLOCK-308；用户「开冲」+ 过程中四条追加反馈「工具少时单列/图标」「加入上下文发送后再启动」「选择按钮不冲突」「批注/加入上下文/选择放图片右侧」） | 2026-10-28 | **批注拖拽手感 + 三段式图标轨 + 加入上下文 + 选择工具（UI-610/611/612 verified）**：①拖拽跟手=拖拽态移入 ref、pointermove 直写 transform、settle 后清场（C0-C4：computed 12px/REST 落地/清理）；②箭头透明命中热区+pointer-events（D0-D3）；③三段式=左图标工具轨（少时单列、增多自动 2/3 列）+ 中画布居中 + 右执行区，窄栏换行回退（E0-E7）；④加入上下文=compose 草稿不发送（F0-F2），顺带修结果面零参回调丢弃批注 prompt；⑤选择工具=选择态选中/移动、绘制态批注层不吃指针（G0-G3）。门禁：批注 41/41 + 受影响前端域 78/78 + theme 17/17 + tsc 0 + lint 0 error + 实机 30/30（acceptance/block-306/）+ 回归 302/303/304（7/7·3/3·9/9）+ closeout 十三门 PASS + skills:check。docs:reconcile=manual 0/validation 0（零候选）。非范围=anchor 不可拖/移动撤销不入栈/选中不持久化/后端零改动。G0 开发期常态 · 不外推 packaged/Provider/GA | UI-610/611/612 / BLOCK-308 |

<!-- audit-log-compact.mjs 追加 @ 2026-10-28T10:31:51.531Z -->
| ✅ 处理完成（BLOCK-310；用户「拖图提示识图模型未配置，如何避免？默认识图模型就是 deepseek 可好」） | 2026-10-28 | **图片入口识图门（UI-614 verified）**：根因=入口只读手动 activeModel，自动模式有图会选 DeepSeek（唯一 vision 聊天模型）却判死；修法=按 hasImages=true 自动决议 + 手动/legacy 补能力位 + notice 指路。红→绿实机（探测期临时切 chat/agent 到非视觉 gemini、auto on：旧门禁复现用户原话提示 → 修复后无提示 + 附件入列；finally 恢复绑定，C0 相等）+ auto-model 9/9 + attachments 10/10 + tsc/lint 0 error + closeout 十三门 PASS。非范围=后端 vision 角色绑定/模型目录不动；手动非视觉 + 关自动仍如实阻断。G0 开发期常态 · 不外推 packaged/Provider/GA | UI-614 / BLOCK-310 |

<!-- audit-log-compact.mjs 追加 @ 2026-10-28T10:50:58.173Z -->
| ✅ 处理完成（BLOCK-311；用户截图「右栏顶部标签多时拥挤，应自动变图标/折叠」） | 2026-10-28 | **右栏标签条自适应（UI-615 verified）**：按标签数×可用宽度估算，不足折叠为图标态（文本隐藏、title/aria 保留、关闭× hover/激活才出），少标签恢复全标签，仍放不下保留横向滚动；ResizeObserver 驱动。证据=helper 单测 + TitleBar 12/12 + theme 17/17 + 实机 9/9（11 标签 compact/无溢出/图标齐全；关闭其他→1 标签恢复）+ closeout 十三门。非范围=拖出独立窗另案（窗口系统已有 pop-out/return，右栏内容绑工作区 ctx）；标签顺序/菜单不变。G0 开发期常态 · 不外推 packaged/Provider/GA | UI-615 / BLOCK-311 |
