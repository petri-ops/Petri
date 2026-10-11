# JEV-CLOUD-PROVISIONING — Jev cloud 供给环境配置（换机 playbook）

> 目标：任何一台新机器/新环境上，把 Jev cloud 供给（`test:suggest` / `doc:suggest` /
> `output:judge` 的 `--supply=cloud`）从不可用恢复到可用。用途与选型见
> [DEV-DECISION-TOOLS.md](./DEV-DECISION-TOOLS.md)；本页只管「供给怎么配出来」。
> 本机实例的落地记录（具体路径/组名/备份位置）在 `<repo>/.petri-dev-user-data/JEV-ENV-NOTE.md`
> （gitignored 不随仓库走，每机一份；本页是随仓库分发的 canonical playbook）。

## 症状识别（先诊断后动手）

| 症状 | 根因 | 处置 |
| --- | --- | --- |
| exit 3「cloud 供给不可用：读不到 jev.env.bak-by-user-request」 | key 文件缺失或目录名漂移 | §1 |
| degraded=timeout（reason=timeout） | 直连被网络墙（连接层超时） | §2 |
| degraded=http_error，服务端 451「not available in your region」 | 代理出口区域被封（Typesafe 封 CN/HK） | §2 |
| 台账空 / `decision:session` 报找不到 DB | PETRI_DB_PATH 未锚定或数据面目录改名漂移 | §4 |

快速探针（无 key 也能测，一步定位是哪层）：

```bash
# 走本机代理对真实 API 路径发无鉴权 POST：
curl -sS -o /dev/null -w "HTTP %{http_code} %{time_total}s\n" --max-time 15 \
  -x http://127.0.0.1:<mixed-port> -X POST -H "Content-Type: application/json" \
  -d '{}' https://api.typesafe.ai/v1/systemone
# 403 = 网络与区域都通（无 key 的正常拒绝）；451 = 出口区域被封；超时 = 直连被墙/代理没通
```

## §1 key 文件（供给解析层）

- 路径：`<repo>/.petri-dev-user-data/jev.env.bak-by-user-request`（gitignored，永不入仓）。
- 格式三行：`TYPESAFE_API_KEY=` / `TYPESAFE_BASE_URL=`（默认 api.typesafe.ai）/
  `TYPESAFE_MODEL=`（默认 jev-1.13.0）。
- key 由用户当面提供（2026-09-22 首发裁决「走到一定阶段再轮换」，轮换只改此文件）；
  换机时向用户索取，**不得**从旧机拷贝进任何 git 追踪面。
- 仓库改名会连带改数据面目录约定（biof3→petri 改名先例）：脚本找新名目录，旧机的
  gitignored 数据目录要手工改名对齐，否则 key/台账/设置面全部「消失」（实为路径漂移）。

## §2 网络：代理规则 + 持久层（防断联的关键）

- 出口组选择判据：**整组落在服务区**。Typesafe 封 CN 与 HK；机场的「AI 专用」组通常
  天然排除 HK（为 OpenAI 系准备的惯例），直接指它最稳；指向含 HK 节点的组（如 Ghelper）
  会在 URLTest 自动换节点时间歇性 451。
- Clash Verge（mihomo 内核）持久层：规则写进**订阅的 rules 扩展件**（Verge UI「编辑规则」
  同源文件，`profiles/<uid>.yaml` 的 `prepend:` 段），形如
  `- DOMAIN-SUFFIX,typesafe.ai,<组名>`。只改运行时 `config.yaml` 会被订阅自动更新
  （默认 12h）与应用重启覆盖——运行时改动只算临时验证手段。
- 版本升级无感：扩展件、`mixed-port`、订阅都住用户配置区，应用升级保留；真正的脆弱点
  在订阅侧组改名（规则指向不存在的组时 Verge 应用配置会显式报错，改指别的组即可）。
- 前提依赖如实：Clash 不在跑则 Jev 云必断（与所有海外流量同一前提，非额外脆弱点）。
- **URLTest 失明边界（2026-10-11 实测沉淀）**：组的健康检查打的是通用探针（gstatic），
  节点可能「gstatic 健康、typesafe 路径劣化」而长时间不轮换——症状=规则路径间歇
  timeout/TLS 失败、对照组站点秒通。处置：先重试几分钟（多为瞬时抖动自愈，决策 API
  自带重试退避）；持续坏才动手——用 `/group/<组>/delay` 触发全组测速看存活面、用
  global 模式钉已知健康节点做分辨探针（探完立即还原 rule 模式）。degraded=零建议是
  fail-open 放行，不阻塞工作，过后补跑即可。

## §3 环境变量（Node fetch 吃代理的开关，最易漏的一环）

- `NODE_USE_ENV_PROXY=1`：Node ≥24 的全局 fetch **默认不吃**代理 env，必须显式开——
  漏了它，`HTTPS_PROXY` 设了也等于没设（症状：curl 通、Jev 超时）。
- `HTTPS_PROXY` / `HTTP_PROXY=http://127.0.0.1:<mixed-port>`（Verge 默认 7897）。
- `NO_PROXY=localhost,127.0.0.1,::1`：dev 栈本机端口（:3000/:3001/:9222）不走代理。
- Windows 用户级固化：`setx <名> <值>`（HKCU\Environment，新开终端生效）；
  回滚 `reg delete "HKCU\Environment" /v <名> /f`。
- 与 BLOCK-85 隧道纪律相容：反向隧道主机走代理 DIRECT 规则（47.110.228.168 已登记），
  本节 env 不改变该直连路径；若将来开 TUN 全接管，先复核该 DIRECT 规则仍在。

## §4 台账锚定（防「调用不落账」的静默丢失）

- 解析链：脚本锚点设 `PETRI_DB_PATH`（存在才设）→ `core/petri-server/db/connection.js`
  读同名 env → 都没有时落**散库** `core/petri-server/petri.db`（无 decision_log 表，
  insert 静默失败——best-effort 吞错，台账就凭空丢了）。已登记 repo 级问题，修复合入前
  按「显式带 env」执行。
- dev 数据面尚未统一到 `.petri-dev-user-data/data` 时，显式带：

  ```bash
  PETRI_DB_PATH="$PWD/.<数据面目录>/data/petri.db" npm run test:suggest -- --supply=cloud
  ```

- 取数：`npm run decision:session`（分段口径：本轮增量 + 累计）；报告：`npm run decision:report`。

## §5 验证链（配完三步全过才算通，不许跳步）

1. §2 探针返回 403（区域可达）。
2. `npm run output:judge -- --request "测试" --output "回复"` →
   `verdict: PASS` + `degraded: false` + `model: jev-*`。
3. `npm run decision:session` 计数前进（本轮增量 ≥1）。

## 回滚

- env：reg delete 三项（或对应 shell 配置行删除）。
- 规则：删扩展件 `prepend:` 里的 typesafe 行；运行时如有手工改动，恢复备份后重载。
- key：删文件即可（gitignored，仓库侧零残留）。

## Mac 侧差异

- 历史出口不同：2026-09-25 实证 Mac 直连即通（无 451），可能整段 §2 不需要；
  key 文件每机独立各自就位。本页随仓库 pull 即得，双端共用同一 playbook。
