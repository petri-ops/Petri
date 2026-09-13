# 交接提示词 · 新会话继续开发（2026-09-13 · 晚间更新）

> 用途：复制下面「提示词正文」整段，粘贴到新的对话框 / 新 agent 会话。
> 本文件本身是交接附件，不是 canonical 状态源（状态以 Git / AUDIT-LOG / DOC-REGISTRY 为准）。

---

## 提示词正文（复制从这里开始）

```
你是 Gewu Desktop（格物，原名 BioF3）项目的开发 Agent。继续在本仓库推进开发。

工作目录：D:\1.WorkDir\biof3-desktop
当前分支：main（与 origin/main 同步，工作区干净）

# 一、开工前必读（顺序不可变）

1. `AGENTS.md` —— 唯一工程指令。**先读「当前阶段纪律（最高优先级 · G0 长期开发期）」整节**，
   这是最容易越界的地方。
2. `docs/AUDIT-LOG.md` —— 审计广播台。🔴 先处理、🟢 评估登记（当前 3 条 🟢：
   DIST-STALENESS 维持不外推 / compute-settings 死 IPC 随 P6 重采清理 / T-AW-013 复核闭环）。
3. 跑 `npm run state`。
4. 读 `docs/next-steps-roadmap.md` + `docs/project-workspace-handoff.md`。
5. 若继续移动方向：读 `docs/block-70-mobile-sync-plan.md`（completed，P5 候选待裁决）。

若入口与 canonical 文档冲突，以 Git / AUDIT-LOG / DOC-REGISTRY 为准。

# 二、G0 开发期铁律（违反即越权）

项目**长期处于 G0 开发期，不是发布期**（用户 2026-08-15 裁决）。
- `qualificationEligible: false` 是常态事实，**不是缺陷、不是待办**。
- **禁止**主动建议：Provider 矩阵实做 / 公证签名 / GA 流水 / dist staleness。
- 收口笔录一句「G0 开发期常态 · 不外推 packaged/Provider/GA」即可，不列举未做项。
- `dev Electron 边界内 verified` / 真机实测确认 = 当前阶段最高证据等级。

# 三、当前状态（2026-09-13 晚间 · 全部已推送 origin/main）

**最近完成（当晚串行超长任务，全部实机验证）**：
1. **BLOCK-84 领域包一键装/卸** → completed（closeout 4/4 全绿）。
2. **BLOCK-83 遗留 A 清债** → 9 个已迁包核心旧副本删除 + C 类 2 项显式 skip +
   g0:chf0 门修复 3/3 转绿（删前基线 99 红）。
3. **🟢 ABI 漂移条目** → 销号（TEST-INFRA-DEBT-3 已清零 + 因根固化 SKILL.md 第 9 条）。
4. **BLOCK-70 手机远程同步 整包 completed（P0–P4）**：
   - P1 移动页 /m + 设置面板「手机连接」（探针 20/20 + 28/28）
   - P2 控制面（批准卡两步确认/取消/发消息）
   - P3 aliyun 反向隧道真远程（隧道管理器/四态/签名清场；实机探针 8/8 真连 aliyun 穿回环）
   - P3.5 桌面投影（/pair?token → 完整桌面 SPA 投到手机浏览器）
   - **真机实测用户确认「挺好 成功啦」** → UI-319 verified
   - aliyun 运维已代办落地：nginx + 自签证书 + 443 反代（公网入口 47.110.228.168 ≠ 出口 IP，
     指引 docs/guides/mobile-tunnel-aliyun-setup.md）
5. **UI-354/355/356**：顶栏入口迭代（后迁左栏底部）、设置页遗留卡清理、Harness 文案改版。

**当前无 active 工作包**；main 与 origin 同步。

# 四、下阶段计划（均需用户裁决启动）

1. **BLOCK-70 P5 候选**（plan §6/§10）：Bot Channel（微信 iLink/飞书，机制取证在 git
   历史 dd11346e）/ 多端会话 / 附件收发 / Web Push。
2. **planned 队列**：G0-RS（Result Studio，含 P6 证据重采）、G0-SDC。
3. **已挂账事项（到达触发条件时处理）**：
   - G0-RS 执行 P6 证据重采时：顺手清 compute-settings 死 IPC 链（AUDIT-LOG 🟢 登记）
     + p4r perf 门 corpus 链包感知化改造。
   - D11 品牌收尾（biof3-server 目录名/biof3:// URI）另行裁决。
4. **隧道日常**：手机面板「停用隧道」即断公网入口；孤儿 ssh 抢端口时
   `ssh aliyun "kill $(ss -tlnp | grep 2233 ...)"` 或桌面端重启栈自动签名清场。

# 五、环境硬前置（踩过坑，照做）

- **必须 Node 24**：shell PATH 默认 v22；`export PATH="$(cygpath -u
  "$APPDATA/fnm/node-versions/v24.20.0/installation"):$PATH"`。
- **启动 GUI 前 `unset ELECTRON_RUN_AS_NODE`**（restart-dev-stack.sh 已处理）。
- **启动 dev 栈**：`bash scripts/restart-dev-stack.sh`（一条命令：杀旧+起全栈+CDP 9222）。
- **后端（core/**）改动后必须重启 dev 栈**；Vite 热更偶发漏写，改完 touch 并核对模块。
- 手机远程速查：面板入口=左栏底部「手机连接」（或设置→计算与数据）；
  公网入口 https://47.110.228.168（隧道 connected 时 QR/链接自动切公网地址）；
  配对码一次性 5 分钟；吊销即时生效。

# 六、门禁与测试纪律（按顺序，别跳）

日常：`npm run docs:check` / `npm run ui:audit:check` / `npm run hygiene:check`。
收口：`npm run closeout`（fail-fast 聚合）。
定向：`npm run test:changed:list`（unknown 必须 0）→ `npm run test:changed`。
默认不跑：`npm run check` / `npm run test:all:workspace`（留给发布前 / CI）。
不把定向通过表述为全量通过；红旗如实登记归属。

# 七、Windows 实机纪律（已多次踩坑固化）

- 多行脚本一律落盘执行，禁内联（node -e / bash 双引号嵌套必炸）。
- spawnSync('npm') 在 Windows EINVAL（Node CVE 限制）——test-affected runProcess
  已修（shell:true for npm）；新增门禁命令时注意同类问题。
- 基线对照只对「已提交」内容成立；回退前 git status 全量 + 内容断言核验。
- 隧道/网络类测试：先查远端端口归属（ssh aliyun "ss -tlnp | grep <port>"），
  孤儿会话直接 kill 即可恢复。

# 八、并行会话纪律

- 开工 git status 全量确认归属；提交前 `git add <明确路径>`，**不要 `git add -A`**。
- 未跟踪在制文件可能是别的会话 WIP：只列出，绝不清理、绝不误入提交。

# 九、项目自有 Skill（按需加载）

- `gewu-project-governance` —— 立项/收口/归档/计划治理。
- `gewu-dev-infra` —— 会话启动/收口门禁/实机验收/委派。
- `gewu-code-review` —— 评审 diff/写审计报告。

治理硬线：未跑 `npm run docs:reconcile` + `npm run docs:check`，不得宣称 completed。

# 十、你的开工动作

1. 读 AGENTS.md 阶段纪律 + AUDIT-LOG 头部 + 跑 `npm run state`。
2. 向用户汇报：当前状态、下阶段候选、需要裁决的事项。
3. **用户明确说「继续/开始」之前不动代码。**
```

## 提示词正文（复制到这里结束）

---

## 附：本次交接的关键事实速查

| 项 | 值 |
| --- | --- |
| 分支 | main（已推送，与 origin 同步） |
| 当晚成果 | BLOCK-84 收口 / 遗留 A 清债 / ABI 销号 / BLOCK-70 P0–P4 整包 completed（真机验证） |
| active 工作包 | 无（BLOCK-70 completed，P5 候选待裁决） |
| planned 队列 | G0-RS / G0-SDC / BLOCK-70 P5 候选 |
| 已挂账 | compute-settings 死 IPC 链 + p4r corpus 包感知化（均随 G0-RS/P6 触发） |
| 手机远程 | 公网入口 `https://47.110.228.168`（nginx+自签证书+443 已由 Agent 代办落地）；面板=左栏底部「手机连接」；隧道启停/吊销即时生效 |
| aliyun 资产 | `ssh aliyun`（root@ECS）；nginx 反代 127.0.0.1:2233；隧道 remotePort=2233 / gateway 3005 |
| Node | **必须 24**（fnm；PATH 前缀命令见 §五） |
| 指引文档 | `docs/guides/mobile-tunnel-aliyun-setup.md`（排障表含孤儿会话清理） |
