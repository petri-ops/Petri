# BLOCK-433 · M7 总收口与证据

> 前置：M0–M6（BLOCK-426～432）全部按单包串行收口，各有 closeout 读数与六件套回写。
> 唯一审计输入：`acceptance/m-blueprint-2026-11-11/FULL-AUDIT-AND-BLUEPRINT.md`（§2 七十条发现 M-01…M-70 /
> §3 差距 G-01…G-12 / §4 阶段 / §6 验收）与 `EXECUTION-PROMPT.md`。
> 用户 2026-11-11 预授权连续工作裁决（见 `docs/m-blueprint-2026-11-11-program.md`）。

## 范围（M7 五项）

1. **70 条发现 + G-01…G-12 差距逐件终态**：机械解析蓝图 ID，逐件给终态与证据指针；
   零 `in_progress`、零编造计数。终态枚举 =
   `done / done-partial / retain-with-reason / pending_human_eye / external-blocked / pending_user_ruling / W`。
   U/E/V/W 四类不计入完成数但逐个终态化。
2. **十一维第八列复评**：逐维升/平/降 + 归因 + 当前源码锚点或当次读数；**不回溯改第七列**。
3. **长任务能力自证包**：fixture manifest + 成功率基线 + 崩溃恢复 flow 证据状态 + trace/usage 对账 + 负面边界；
   未达证据上限的部分如实标 `external-blocked`，不宣称「稳定完成长任务」。
4. **六件套 canonical 同批回写** + AUDIT-LOG 登记 + DOC-REGISTRY 状态与 README 入口一致；
   蓝图状态由 `candidate` 转 `completed`（走正式注册流程）。
5. **干净树 `closeout:full` 三连 / `gate:post-h9-contracts` / `docs:reconcile`**：当次读数如实登记；
   未达项给补腿条件，不冒充通过。

## 关键现实边界（逐项留痕，不粉饰）

- **干净树前提不成立**：会话起始 89 M + 68 ?? 在制 WIP 按硬红线**零触碰 / 零 stage / 零提交**，
  因此「干净树」在本轮不可达；W 类红（UI-629 布局 gap 锚、P6 源绑定）会令 `test:changed`
  与 `closeout:full` 拦停。按 §6 W 类处置：登记 owner 归属与补腿条件，不代改、不重打 P6 源绑定。
- **V 类不可达**：真实 Provider / CVE 联网 / macOS TCC / 9223 实机崩溃注入，按 G0 不外推。
- **E 类不可代答**：22 条人眼 + H-01～H-08、暗色/读屏/对比度观感，签字槽保持全空。
- **U 类不改默认**：ADMISSION observe→enforce、FK OFF/ON、typescript 双版本、虚拟列表依赖，
  出决策材料且 `pending_user_ruling`。
- 「十一维第八列」是**本轮证据口径下的独立估值**，不是 `verified` 声明；得分不冒充运行时结果。

## 验收门（当次读数如实）

- `node scripts/m-blueprint-m7-final.mjs --check`（逐件终态 + 计数对账 + 零 in_progress + 四类不代答）。
- `node --test test/m7-final-closeout.test.mjs`（HK-01 红→绿 + 篡改必红）。
- `npm run closeout:full` ×3 / `npm run gate:post-h9-contracts` / `npm run docs:reconcile` /
  `npm run docs:check` / `npm run ui:audit:check`（exit 124/125 = unknown，不是成功）。

## 完成语义

八阶段全部收口且各有 closeout 证据；70+12 逐件终态零 in_progress；六件套回写一致；
零新增依赖 / 零触碰在制 WIP / 零放宽基线 / 零撤销裁决 / 零 G1+ 外推。
**未达证据上限的项逐件标未完成并给补腿条件，不用文档措辞升级运行时结果**。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 收口笔录（2026-11-11 · BLOCK-433 / 八阶段收口，程序终态 done-partial）

**交付**：① 70 条发现 + G-01…G-12 共 **82 件逐件终态**（机械解析蓝图、零 `in_progress`、零编造计数：done 21 / done-partial 47 / pending_human_eye 2 / external-blocked 3 / pending_user_ruling 3 / W 6）；② **十一维第八列复评** 8 升 3 平 0 降，逐维归因与源码锚点，不回溯改第七列、非 verified；③ **长任务自证包**（1000 轮 fixture manifest + 成功率基线 + `gate:long-task-resume` 三连 + trace/usage 对账 + 13 条负面边界，9223 实机腿 external-blocked）；④ 六件套同批回写 + AUDIT-LOG 登记 + registry/front-matter/README 状态一致；⑤ 硬门当次读数（`gate:post-h9-contracts` 186/186 全绿、`docs:reconcile` 0 issues、`closeout:full` 三连）。HK-01 7/7、逐件终态门 0 issues、lint 0、docs:check 578。

**门禁实况（不写全绿）**：`closeout:full` **连续 3 次 exit 1**，均在第 5 门 `test:changed` 拦停（UI-629 布局 gap 锚与 P6 源绑定，两红均 W 类在制 WIP）；前 4 门 PASS、后续 13 门 fail-fast 未执行。首轮另有「M7 plan 未注册 + coverage 漂移」本包引入项，已修后复跑（首轮读数并列留痕）。`test:changed` 独立读数 1504 tests / 2 fail / 7 skipped。

**§8 完成定义逐条对账**：已满足 1/2/4/6/7/8；**第 3 条（干净树三连全门 PASS 0 SKIP）与第 5 条（长任务自证包 9223 实机腿）未达证据上限**。按用户 §8 末句「未达证据上限如实标未完成，不得用文档措辞升级运行时结果」⇒ **程序终态 = `done-partial`**；治理生命周期 `status: completed` 仅表示八阶段执行完毕，不等于验收通过。

**补腿条件**：① owner 收口 89 M + 68 ?? 在制 WIP → 干净树 → 重采 P6 源绑定 → `closeout:full` 三连复跑；② 9223 离屏实例跑崩溃注入→重启 resume（禁 `PETRI_TEST_ONSCREEN`、跑完立即 kill，截图失败标 `screenshot_unavailable`）；③ U/E/V/W 四类保持不代答，签字槽全空、默认语义未改；④ acceptance 蓝图原件属起始 untracked WIP 零触碰，状态由已注册 living-plan 台账承载，回写原件需用户裁决。

**六维度评审**：无 P1；七维逐项过（契约/单一真相/失败语义/测试有效性/边界安全/死代码/YAGNI），详见 `m7/m7-evidence.json:sixDimensionReview`。ocr 本轮未做（可选外部工具、未装/未配置），按 skill 降级如实声明。

**范围守住**：零新增依赖 / 零放宽基线 / 零触碰在制 WIP / 零 stage 零提交 / 零撤销既有裁决（`MAX_AGENT_ITERS=Infinity`、`workspace_exec` 默认放行、ADMISSION/FK/MCP 计量/主题/中栏）/ 零 G1+ 外推。

**证据**：`acceptance/m-blueprint-2026-11-11/m7/`。

G0 开发期常态 · 不外推 packaged/Provider/GA。
