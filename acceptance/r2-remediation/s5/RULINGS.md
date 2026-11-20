# S5 默认身份面可见性 · 裁决留痕（2026-11-21）

> 波次：R2 清偿批 S5（P1-3）· 预置裁决 R3（按 ruling.json 现读落默认档 + 旧配置迁移保留 + token 组件面真实消费）。

## R-S5-1 默认档档名（不凭记忆）

`acceptance/a0-identity-translation/ruling.json` 现读：`resolves: "A0 单一建议（B 青瓷·墨 工作态主 accent；A 宣纸·朱砂 品牌落印位点睛 <5%）"`，
`ruling: "行"` → **默认 accent = `celadon-ink`**。消费测试第一锚即裁决真源在场与档名一致（defaultIdentity.test.ts）。

## R-S5-2 改动面（三处，可逆呈现面）

1. `prefCache.ts` `readCachedAccent` 默认 `teal → celadon-ink`（非法/无存储值才回落；注释引裁决真源）。
2. `accents.ts` 选项表（默认）标注迁移（celadon-ink「青瓷·墨（默认）」，teal 退「青碧」遗留基础档）；`applyAccent` teal 移除属性语义不变。
3. `welcome.module.css` 问候区：`.greeting` 色 `--petri-text → --petri-ink-base`（宣纸墨字，随骨架档联切）+ `::after` 落印点
   （`--petri-accent-vermilion` × `--petri-radius-seal` 7px 方印点，品牌落印 <5%，不随 accent 档切换）。

**为什么选 welcome 问候区作组件面消费点**：用户第一身份面（A0 的「默认可见」靶面）；点睛≤1/视图合规；
module.css 属组件面（与 TitleBar.module.css 消费 radius token 同族）；零 DOM/a11y 结构变化（::after）。

## R-S5-3 旧配置迁移语义

- 显式保存过偏好（localStorage 或服务端 user-prefs）→ 原值保留：读链存什么读什么、pull 链服务端真相回填——两链都不经新默认。
- 无存储/非法值 → 新默认 celadon-ink。
- **诚实边界**：存了 `teal` 的用户无法与「旧默认被持久化」区分，按「不覆盖已存偏好」保留 teal（预置裁决 R3 原话边界）；
  其身份面维持遗留基础档，不强行翻新。纯默认路径（双存储皆空）由单测锚定（jsdom）。

## R-S5-4 实机取证首跑抓真（对账记录）

首跑 flow `4/9`：①测试实例 localStorage 存有历史 accent（非全新）②app 会话恢复跳项目工作区致 h1 未命中。
flow 重构为「清缓存→reload→轮询 welcome」+ 断言面收敛为**本实例可证面**：
「服务端已存偏好经 pull 链回填（refill）」=迁移保留语义的活证；纯客户端写 teal 对抗不了服务端真相（pull 按设计回填），
该腿删除（保留语义由 refill 活证 + 单测双证）；**服务端 user-prefs 为用户真实数据零触碰**（不写服务端偏好）。
复跑 **10/10 allPass** + 截图（问候字青瓷墨+朱砂印点+AI 白描水印+宣纸骨架同框）。

## 附带清偿

`gate:css-modules` 红（watermark.css / watermark-ai.css 两 plain CSS 漏入白名单——水印批已提交面漏重锚，
与 S3 code-size 同债类）：全局水印层需稳定全局类名（flow CDP 断言 `.petri-watermark-global`）+ fixed 全局层形态要求，
plain CSS 为该两文件的形态必要；按 `--write` 重锚 13 白名单 + 本节留痕（不追加新 plain CSS 的棘轮语义自新基线生效）。

## 出口核验（现读）

- defaultIdentity 6/6 + 邻域 26/26 + token 契约 36/36 + tsc 0 + ui-a11y 0 违规
- 实机 flow 10/10 allPass + 2 张截图（默认态/服务端偏好保留态）；9223 跑完即 kill
- ui:audit:check exit 0（UI-718 in_progress 条目同步）；身份 token 组件面消费 0 → **3 处**（ink-base/vermilion/radius-seal）
- 审美签字：**in_progress 不代签**（无 codified 偏好覆盖该维度；A0 裁决覆盖方向不覆盖观感终审）

## HK-01 红绿

红：`defaultIdentity.test.ts` 4 failed/2 passed（默认 teal+零消费+（默认）标注错+默认态属性缺失）→
绿：实现后 6/6（红绿输出见 gates/s5-vitest-*.log）。
