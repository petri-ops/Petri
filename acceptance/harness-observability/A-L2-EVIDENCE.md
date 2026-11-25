# BLOCK-520 A-会话级外部监督器直达 L2 · 证据（2026-11-25）

> 发令：Orca 7d41c850 msg_7cf0a3957a41（主人「给，冲」，直达 L2、取消影子前置）。
> 立项：复用 BLOCK-520 串行槽位（不新开 active 包），子项=A-会话级 L2；材料=`A-EXTERNAL-SUPERVISOR-BOUNDARY.md`。
> 红线：零新依赖、不碰 owner/9223/test-user-data 实例、L3 进程级 kill/restart 永久挂账、不翻 loop/DB 契约。

## §1 核码纠偏（真源，非照抄材料）

| 项 | 材料说法 | 核真 |
|---|---|---|
| C 形态观测汇 | external-supervisor.js 已在跑 | ✅ 203 行 helper，createExternalSupervisor，reasonCode 窄词表，只观测 |
| resume 端点 | 复用 POST :id/resume | ✅ `core/petri-server/routes/ai-agent/resume.js`（BLOCK-38 P1），失败 task 标 recovery_required 已有语义 |
| instance_role 身份标签 | 启动时写 dataDir+/api/health | ⚠️ 现码 grep 零命中 → 本包在 controller 内做身份判定（材料 §2），不写启动面新状态 |
| metrics.restarts | 已有计数 | ✅ `shared-backend/metrics.js`（经 external-supervisor deps 注入） |
| DOC-REGISTRY 登记材料 | 令要求登记 | ⚠️ registry 机制只接受 `docs/` 下路径（PATH_INVALID）——acceptance 材料按机制不进 registry，已登记 backlog/remaining-work/AUDIT-LOG，如实纠正 |

## §2 实现（唯一硬门槛=§2 身份+豁免+fail-safe）

新建 `core/petri-server/helpers/external-supervisor-controller.js`（零新依赖、deps 注入可控时钟/resume/alert）：
- `classifyInstance({instanceRole, dataDir, port, parentChainVerified})`：短路豁免顺序=空角色→identity_unknown / 角色非 prod_user→role_not_prod_user / dataDir 含 dev|test-user-data→对应豁免 / 端口 9222、9223、3003 或 3000–3999 保留段→reserved_port / 父链未验证→identity_unknown；只有显式 prod_user 且四项全过→eligible。
- `decideAction({instance, restartsInWindow, threshold, taskId}, deps)`：豁免→L0(exempt)；重启风暴（≥threshold）→L3 人工告警（**不动作**、熔断）；单次超时→L2 调 `deps.resume`（绑现成 POST :id/resume）；失败/不可用→`outcome:'recovery_required'`（复用 DB 既有语义，不自造状态）。
- **L3 进程级 kill/restart 零代码**（HK-01 断言无 kill/SIGKILL/SIGTERM/.restart()），永久挂账。
- L1 告警复用 C 形态 metrics/incidents 的 fingerprint 计数 + controller 的 alert 注入点，不造第二套计数。

## §3 豁免清单判定证据（HK-01）

`test/block520-a-supervisor-l2.test.mjs` 红 5/5 → 绿 5/5：
1. 六类豁免逐条断言（dev_owner / 9223 / 9222 / test-user-data / dev-user-data / 身份不明）= exempt:true 且 reason 逐项匹配（零误杀）。
2. prod_user 四项全过 → eligible:true、role=prod_user。
3. 单次超时 → L2 调 resume 1 次；重启风暴（9≥5）→ L3 熔断、resume 调用数不变（不动作）。
4. resume 失败 → `outcome=recovery_required`、`reason=resume_failed`（可逆回落）。
5. controller 源码零 kill/restart 字面 + 材料 L3 挂账条款在场。

## §4 状态与边界

- 提交留本地、push 待主人明确口令；HK-01 邻域与静态门禁提交前跑（见回报）。
- 不碰 owner 3000/3001/9222、9223、test-user-data；阈值上线后用 C 形态已积累 metrics/incidents 校准（调参在动作开启后，不设影子观察期）。
- 证据/材料：`acceptance/harness-observability/{A-EXTERNAL-SUPERVISOR-BOUNDARY.md, U-EXTERNAL-SUPERVISOR.md, A-L2-EVIDENCE.md}`。

## §5 门禁归属（提交前实测）

- HK-01 5/5 绿、BLOCK-520 邻域 9/9、types 0 error、lint 0 error、docs:check PASS(675)、ui:audit:check PASS。
- **impact-map 19 红=集成线遗留缺口**：`scripts/console-ratchet.mjs`（harness 集成/console 治理新增 script）未登记任何 `classifiesScripts` 规则 → validateMap 顶层抛错，连带全部用例红。本包只为自己的新测试新增 `block520-a-supervisor-l2` 规则（patterns 仅 controller+test，不含 classifiesScripts，与该错误无关）。按「不动他方文件/存量红如实归属」未改既有规则；建议 harness 线补一条 classifiesScripts 覆盖（`scripts/console-ratchet.mjs`）。
- code-size 红名单（PluginStorePanel/tools-executor/registry/custom.css 等）全为集成线文件，本包新增 controller 不在名单、如实归属。
