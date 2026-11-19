---
capability: block503-human-eye-review-checklist
status: active
phase: MATERIAL
goal: 肉眼核对总清单（用户发令「立一个包 把需要肉眼核对的内容 梳理出来，我一个个判断」）——把当前全部待人眼判断事项收敛为一张可逐项裁决的清单：甲组=读材料即可裁决（3 项）、乙组=实机观感签字（9 组，含怎么看/判什么/签字格式）；全部条目现读 canonical 真源（human-eye-closeout.json 契约+UI 台账+人眼路线文档），零代签、零状态改写。
acceptance:
  - 清单条目全部来自现读真源（resources/design-context/human-eye-closeout.json 六组读数 + docs/ui-productization-audit.md 四槽 + docs/ui-design-human-eye-route.md 路线 + BLOCK-500/501 待评审项 + C-55 成片证据），逐项给「判什么/怎么看/裁决格式」
  - 签字槽保持留空零代签；本包只产出材料不改任何观感状态（UI 台账/human-eye-closeout 契约零写面）
  - 用户裁决后的回写路径写明（用户给口令 → Agent 按台账纪律回写 verified/cancelled+理由，内容出自用户）
  - docs 门禁 + closeout 定向 + 六件套 + commit/push
reopen: 用户裁决批回写后本清单逐项标注终态；新观感面入库时追加
supersedes: 无（汇总投影；各真源仍是签字状态的唯一权威——本清单不承载状态）
---

# BLOCK-503 · 肉眼核对总清单（2026-11-19 现读 · 逐项裁决材料）

> **用法**：从甲 1 开始逐项往下。每项给了「判什么/怎么看/裁决格式」——直接在会话里回口令（示例：`甲1：认可，注册面开工` / `乙1 UI-710：verified，2026-11-19 实机过目无问题` / `乙5-H03：cancelled，理由=…`）。收到口令后由 Agent 按台账纪律回写（内容出自你，Agent 不代签不改判）。
> **现读口径**：条目与计数来自 `resources/design-context/human-eye-closeout.json`（签字槽 11 行全空/四槽 in_progress/E 类 22=11✓+2✕+9 进行中）、UI 台账、[人眼路线](./ui-design-human-eye-route.md)。本清单不承载状态——真源永远是上述文档。

## 乙 0 · 准备（实机组才需要）

```bash
npm run dev        # 打开可见窗口（你看的是真窗口；dev 栈 http://localhost:3000）
# 或手动起测试实例看独立面：bash scripts/start-test-instance.sh --onscreen（手动允许）
```
通用判据：功能正常 + 观感无违和（对齐/对比度/交互反馈）；亮暗两主题都过一眼。证据可留截图（可选），口述结论即可。

---

## 甲组 · 读材料即可裁决（不开软件）

### 甲1 · C-56 论文保真 Skill 手册稿评审（[BLOCK-500 稿](./c56-paper-writing-manual-draft-2026-11-19.md)）
- **判什么**：文末 4 个评审要点——①十节结构够不够手册级 ②中文 F 类六项增删（英文论文是否同批覆盖）③数字锁定粒度（逐字符 vs 数值等价）④是否认可→启动注册面（resources/skills+manifest+发现桥）
- **怎么看**：读该文档（约 120 行）
- **格式**：`甲1：①认可 ②F 类维持/增删X ③粒度=逐字符/数值 ④注册面开工/再等`

### 甲2 · capability-intake 两来源 license 裁决（D5 停等在册）
- **判什么**：provenance 台账两行 `license_unknown=true`（github.com/blader/humanizer + op7418/Humanizer-zh）——C-56 内核的出处。license 未知时接入类动作（装包/引依赖/复制内容）全部禁止；手册层内化已按「取内核弃外壳、零复制」完成
- **选项**：`补抓 license（我去 fetch 仓库 LICENSE 再回填）` / `维持 unknown（仅手册层，永不接入，可接受）` / `放弃该来源`
- **格式**：`甲2：维持 unknown / 补抓 / 放弃`

### 甲3 · E-03 SUS/UMUX-Lite 观感评分方式
- **判什么**：需要真人样本 + 外部量表平台的评分（V 类）；裁决=做/不做/何时做（G0 内可推迟）
- **格式**：`甲3：做（时间）/推迟/取消`

---

## 乙组 · 实机观感签字（打开软件逐项过）

### 乙1 · UI-710 SceneSpec 证据面板 + ::compose↔Result Studio 双形态互达（3D P3 呈现层）
- **判什么**：项目工作区 3D 节点的证据面板（joints/provenance/verifierResults 上屏）+ 从 compose 卡片跳 Result Studio
- **怎么看**：项目工作区 → 含 joints 的 3D 节点 → 右栏证据面板；compose 卡片 → 跳转按钮
- **格式**：`乙1 UI-710：verified/cancelled（理由）`

### 乙2 · UI-709 Gen UI ::compose 受控渲染插座（W11 数据面）
- **判什么**：Composer 触发 visualize 类结构化产物（compose 五 kind）渲染观感
- **怎么看**：聊天里让 agent 出一个可视化产物 → 观察受控渲染卡片
- **格式**：`乙2 UI-709：verified/cancelled（理由）`

### 乙3 · UI-707 模型行悬停配置 + 设置页上下文退役
- **判什么**：模型行悬停就地配上下文窗口/思考档；设置页 IA v2 后上下文配置收进模型级
- **怎么看**：聊天模型行悬停；设置页 → 模型配置区
- **格式**：`乙3 UI-707：verified/cancelled（理由）`

### 乙4 · UI-706 API Endpoint 能力面简化（主表 11→8 列+行详情折叠+角色绑定模型对）
- **判什么**：Endpoint 主表列收敛、行详情折叠展开、选择器显示
- **怎么看**：设置页 → API Endpoint 列表 → 点行看详情
- **格式**：`乙4 UI-706：verified/cancelled（理由）`

### 乙5 · C-53 P4 八态矩阵 32 格人眼格（人眼格 12 在册）
- **判什么**：交互八态（默认/hover/active/focus/disabled/loading/error/selected）呈现一致性；清单 v1 §1 有 32 格判据
- **怎么看**：按 [UI 验收清单 v1](./ui-design-acceptance-checklist-v1.md) §1 逐格触发；人眼格 12 见 [P4 plan](./block473-c53-p4-responsive-a11y-plan.md)
- **格式**：`乙5：12 格勾选表逐格 verified/cancelled（可分批）`

### 乙6 · C-53 P5 性能可信（2 槽）+ P6 产品 Skill（2 槽）观感
- **判什么**：P5=流式 pending 态/首屏占位/加载空错误 12 格观感；P6=design-brief Skill 语义匹配触发观感
- **怎么看**：P5=长回复流式渲染观察；P6=让 agent 走一次 skill 触发链
- **格式**：`乙6-P5：verified/cancelled；乙6-P6：verified/cancelled`

### 乙7 · H-01~H-08 视觉/a11y 路线（每条已有逐步路线，照做即可）
| 编号 | 判什么 | 路线 |
|---|---|---|
| H-01 | 页头 bare 形态（独立页 vs 工作区顶栏） | [路线 §3](./ui-design-human-eye-route.md) |
| H-02 | 768px 阈值对齐（769/768 两态无抖动） | 同上 |
| H-03 | 暗色 hover 收敛（5 类元件同一档） | 同上 |
| H-04 | selected 专用 token（4 色×明暗 8 态） | 同上 |
| H-05 | WCAG 三级文字对比度观感判定 | 同上 |
| H-06 | focus-visible 键盘路径+读屏 | 同上 |
| H-07 | 32 格八态矩阵观感 | 同上 |
| H-08 | 22 条 debt 逐条签字（=乙8） | 同上 |
- **格式**：`乙7-H01：verified/cancelled…`（逐条；证据截图可选）

### 乙8 · E-01 树测试 + E-02 22 条 debt 集中过目
- **判什么**：E-01=IA 收敛后入口可达性（6 步树测试：寻路 ≥80%/首击 ≥70%/核心任务 ≤3 点击）；E-02=22 条 UI 台账 debt 逐条终态（现状 11✓/2✕/9 进行中，其中 3 条 worthReviewing 优先）
- **怎么看**：[IA 决策材料 §6](./ui-design-ia-decision-material.md) + [E 类指南](./e-class-human-eye-guide-2026-11-16.md)
- **格式**：`乙8-E01：三项达标与否`；`乙8-E02：逐条 verified/cancelled（9 条进行中优先）`

### 乙9 · C-55 科普视频成片终审
- **判什么**：成片观感（旁白/字幕/镜头）+ P3 高级镜头审阅
- **怎么看**：播放 `acceptance/block482-c55-video-p0/video.mp4`（21.9s/1280×720/烧录字幕）；审阅材料=acceptance/block487-c55-video-p3/review.md
- **格式**：`乙9：verified/cancelled（理由）`

---

## 签字回写方式

1. 会话里回口令（上述格式，可多条一条消息）→ Agent 逐条回写 UI 台账/human-eye-closeout 契约复核/acceptance 签字记录（内容出自你，含日期与覆盖断言）。
2. 每回写一批跑 `npm run docs:check` + `ui:audit:check` 守门。
3. 全部签字完成 = W4 人工区清零；届时 human-eye-closeout 契约复核需重算（slots 翻 verified）。

## 证据索引（真源，现读）

`resources/design-context/human-eye-closeout.json` · `docs/ui-productization-audit.md`（四槽 §120-151）· `docs/ui-design-human-eye-route.md`（E-01~03+H-01~08 路线）· `docs/ui-design-ia-decision-material.md` §6 · `docs/e-class-human-eye-guide-2026-11-16.md` · `acceptance/block-332/ui-ledger-triage.json` · C-53 P4-P7 各 evidence/snapshot · `acceptance/block482-c55-video-p0/video.mp4`

G0 开发期常态 · 不外推 packaged/Provider/GA。
