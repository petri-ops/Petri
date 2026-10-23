# DEV-DECISION-TOOLS — 开发时决策建议工具（BLOCK-118/119）

> Jev/Laya 决策原语的开发流程接线。三个工具都是**建议器/评判器**——增量附加、只加不减、
> 低置信/降级=零建议或放行；任何分支都不可能减少静态门禁（impact-map 下限/收口链）的既有语义。

## 主动行使纪律（2026-09-23 用户裁决：「能用 Jev/Laya 的地方就用，后续不用提醒」）

下表时点属于**默认工作流的一部分**：到达时点即主动调用，不需要用户提醒或批准，结果
（含零建议）如实附在收口或交付说明里。实操口径：

- **确定性优先不变**：语义残差才轮到 Jev——确定性规则能判的先走确定性（uiAudit 硬规则、
  impact-map 下限、L1/L2 归因层）；Jev 的价值在提前抓机械门禁随后才会抓的问题
  （2026-09-23 实证：doc:suggest 的 uiAudit 确定性命中先于 closeout 门抓到台账漏同步）。
- **按工作包喂，不按天喂**：test:suggest 对聚焦改动面最有效；混合大批量置信度被域信号
  稀释（118 文件混批实测 conf 0.75 < θ 0.8 零建议，同日聚焦批 conf 0.99）。
- **零建议/降级=如实记录**：不是故障、更不是跳过静态下限的理由；每次调用恒落
  decision_log（`npm run decision:report` 可查账）。

## 何时用

| 时点 | 命令 | 作用 |
| --- | --- | --- |
| 规划定向测试前 | `npm run test:suggest -- --supply=cloud` | 在静态 impact-map 下限之上追加测试域建议 |
| 台账回写前 | `npm run doc:suggest -- --supply=cloud --context "<改动说明>"` | 提示可能漏回写的 canonical 文档 |
| 测试失败需要归因时 | `node scripts/block114-failure-triage.mjs <failures.json> -o report.json` | 三层管线：L1 指纹/L2 环境词表（零模型）→ L3 Jev choice 语义残差（仅 L3 出站）；低置信=needs_human |
| 收口/交接给下一个工作包建议前 | `npm run next:suggest -- --supply=cloud --context "<收口摘要 + 队列>" --candidates "Q7|Q4b|..."` | 用 Jev 在母纲 §6.5/backlog 候选中选**一个**：唯一建议，禁止"或"式多选；Jev 不可用按候选首个兜底并标注（用户裁决 2026-10-24） |
| 多轮会话产出关键结论/收口声明前 | `npm run output:judge -- --transcript <conv.jsonl> [--probe 3]`<br>或 `--request "…" --output "…" [--reference …] [--goals "a;b"]` | 评判门三态（PASS 推进/RETRY 重写/ESCALATE 升级），fit score 0-4 + 忠实性（需 reference）+ 目标完备性 |
| 限定提示词脚本输出结构化结果后 | 同上 `--probe k` | 稳定性探针：k 次重放一致率（<2/3=unstable，阈值附近判定须谨慎解读） |

## 供给选择（`--supply`）：agent 默认 `--supply=cloud`

- `--supply=cloud`（**agent 调用时的默认选择**）：从 `.petri-dev-user-data/jev.env.bak-by-user-request`
  读 key 直连 Jev 云（只读不回显）——当前**唯一有校准证据**的供给，建议真实可用。
- `--supply=file`：跟随 `data/decision-config.json`（设置页「决策模型接口」同源）。
  当前指向本地 Laya → 工具恒零建议（安全静默，非故障）。
- **换机/新环境供给配不出来**（exit 3 缺 key / 451 区域封 / timeout 直连墙 / 台账静默丢）：
  按 [JEV-CLOUD-PROVISIONING.md](./JEV-CLOUD-PROVISIONING.md) 的症状表诊断修复。

### 什么时候用 Laya、什么时候用 Jev（2026-09-23 校准证据 + 成本账）

| 场景 | 用哪个 | 依据 |
| --- | --- | --- |
| dev 建议工具（test:suggest / doc:suggest） | **Jev（cloud）** | 唯一过校准门的供给；**成本实测可忽略**：Jev 只收输入 token（$42/十亿 token），一次调用 ≈ 几百 token ≈ 万分之几美分，每月几百次调用合计几美分——「省钱」不构成用 Laya 的理由 |
| 产品运行时五接点（copilot/知识库等） | Laya 可用（现状） | 零采纳=自动回退原行为，安全；想要真实增益需在设置页切 Jev（BLOCK-117/118 证据已证 Laya 全接点零采纳，属另一裁决面） |
| 隐私敏感、不允许出站 | Laya | dev 工具 state 只有文件路径清单+改动说明一句话，无隐私面，此理由在 dev 场景基本不成立 |
| 离线（无网络） | Laya | 云不可达时工具降级零建议，不阻塞流程 |

**Laya 的翻盘条件**：当前本地模型（laya 0.3.5，421M）输出分布平坦、排序无信息量，test-suggest
连 top-probability 门控也救不回（最优精度 0.45 vs 门 0.80）——问题在模型质量而非阈值。
若日后本地换更强决策模型，走「重校准→证据达标→注册表落 per-model 阈值」流程即可翻转；
在那之前，「Laya 不可采纳」是证据裁决定论。

## 如何解读输出

- `建议追加测试域「agent-backend」（N 个测试，conf=… ≥ θ=…）`：追加执行建议清单里的
  定向测试（`node --test <files>` / `npm run test:files --prefix frontend -- <files>`）。
- `零建议（below_threshold，model=…）`：模型置信不足，**不是工具故障**；静态下限照常执行。
- doc:suggest 的 `--context` 强烈建议提供（改动说明一句话）：回写意图主要在语境里，
  无 context 时 planDoc 判别力显著下降（校准三轮 D-修订的证据教训）。
- 两个工具的调用都会落 `decision_log` 台账（含 input_tokens 逐条用量，BLOCK-118 加映 1；
  包装已自动锚定 dev DB——与后端同账本）；**`npm run decision:report [-- --hours=24|--since=日期]`
  一条命令出会话报告**（按接点×模型的调用量/延迟/降级/token 合计与云端成本估算）。

## 红线

1. 建议永远只附加：不许因「零建议」跳过 impact-map 下限、收口门禁或台账回写纪律。
2. 阈值与门控证据绑定（`helpers/decision-thresholds.js` 注册表）：改 θ 必先重校准
   （block116 契约测试机械承载）；「Laya 不可采纳」结论翻转同样需要新校准证据。
3. 校准/运行 cloud 供给时 key 只读 `.petri-dev-user-data/`（gitignored），不回显不入仓。
4. 语料与校准脚本改动 = 接点证据失效，须重跑校准并同步注册表（`scripts/block118-*-calibrate.mjs`）。
5. **评判门不替代执行真相**（BLOCK-119）：功能准确性唯一裁决=测试/门禁/flow；output:judge
   只管语义合格性（fit/忠实性/完备性）；无 reference 的泛判只观测不门控；降级=fail-open 放行。
6. 评判用量观察：`npm run decision:report`（output-judge/report-guard 接点与 token 逐条可见）；
   阈值附近的单次判定建议加 `--probe 3`（实测 fit 分数存在轮间波动，BLOCK-119 dogfood 留痕）。
