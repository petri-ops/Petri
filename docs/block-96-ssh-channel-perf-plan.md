# BLOCK-96-SSH-CHANNEL-PERF — SSH 远程通道效率与稳定性优化（连接面 / 列表面 / 错误契约 / 进程面 / 可观测）

最后更新：2026-09-16（**P1 收口**：F6 probe 退役（3fa74ea3）+ F2 列表面（f4b74ca8）+ F1 连接面（037de763）+ 实机证据 7/7 allPass（`acceptance/block-96/block96-p1-live.json`）——首连 330ms（黑洞基线 21200ms）、fs_list@500 cold 20ms / warm 15ms（基线 2600ms）、六个特殊文件名（引号/反斜杠/换行/制表符/空格/中文）逐字回填、分页数学与 truncated 标记正确、mux 写列一致；契约 9 套件 73/73 绿（含 mux 透明重试单测 + 特殊文件名/分页夹具固化）；tsc 0 + vitest 36 过；UI-388/389 台账同批登记。**实现期抓真 1 处**：__mux 循环 `out=$(eval ...)` 命令替换剥 NUL 字节——fs_list 改 agent 侧 base64 单行先行（管道直连不过替换），NUL 协议经 mux 全链路存活）。此前：P0 三裁决落定（F1 传输层参数化 / F2 一期含前端游标 / §0.3 立 F6 全做）；用户裁决启动整包 → active/P0-LAUNCH；四处承重代码事实当日抽查与 HEAD 一致）

状态：`active（P1 已收口；P2 F3 错误契约（die 回传/pipefail/LC_ALL=C/错误码表）待做 → P3 F4 进程面 → P4 F5 可观测+评估项结论+整包收口，见 §4）`

计划编号：`BLOCK-96-SSH-CHANNEL-PERF`

用户裁决原话：「就目前的这个脚本或者机制来说。 效率和稳定性如何有哪些方面可以大幅度的优化呢 我还是能感受到不稳定 还有首次连接有些慢  需要新建一个block用来优化」（2026-09-16），并附外部 AI（DeepSeek）对 agent 脚本的静态分析作参考输入。本会话独立通读脚本全文 + 传输层 + gateway，并在本机 WSL 真节点实测取证后立项（DeepSeek 判断：印证 4 / 修正 3 / 新增 5，见 §0.2）。

主模块：`core/biof3-server/helpers/remote-execution/`（`node-agent.js` 内嵌 biof3-agent.sh、`ssh-multiplexer.js`、`ssh-transport.js`、`remote-job-runner.js` ensureAgent）+ `helpers/workspace-gateway.js`（ssh 后端）

关联：BLOCK-67（SSH 远程项目面 + __mux 单连接复用）、BLOCK-77（resident 任务 / exec_bg P5 修复）、BLOCK-78（sys_resource 轮询面）、BLOCK-89/90/91（fs verbs 增量消费方）；BLOCK-92/93/94/95 文件面零触碰

## 0. 实测证据基线（2026-09-16，本机 WSL2 Ubuntu 真节点）

### 0.1 症状定责（用户两大感受的直接根因）

| 症状 | 根因 | 实测数字 |
| --- | --- | --- |
| 首次连接慢 | **IPv6(::1) 黑洞**：`Host wsl`（HostName=localhost）默认地址族序先试 `::1:22`，黑洞挂满超时才回落 IPv4 | 新建 ssh 恒 **21.2s**（Windows OpenSSH 9.5 与 git-bash OpenSSH 10.2 同样，三次采样一致）；`-4` 强制 IPv4 → **247ms**；直连 `127.0.0.1` → **134ms**；`ConnectTimeout=10` **未封顶**黑洞 |
| 首次连接慢（次因） | mux 空闲 5 分钟自动关闭（`IDLE_CLOSE_MS`）+ ensureAgent 哈希校验走一次性 ssh——间歇 >5min 后的首次操作付「全连接成本 ×2 连接」 | 修复黑洞后 mux bootstrap→首响应 **226ms**（健康） |
| 不稳定（悬崖 1） | **fs_list 逐条目 fork**：每条目 basename + wc + tr + `command -v stat` + stat×2 全串行 | 500 文件 **2.6~2.7s** vs 批量 `stat` 同目录 **6.3ms**（**~410×**）；外推 5000 文件 ≈27s **撞 30s mux 默认超时 → killSession → 前端显式报错** |
| 不稳定（悬崖 2） | **mux 死亡无透明重试**：`runOnMux` catch 两分支相同（`workspace-gateway.js`），死亡会话上的在途请求显式失败，下一个请求才懒重建 | 每次断连 = 用户可见失败一次 + 重连成本一次 |
| 不稳定（悬崖 3） | **特殊文件名产出坏 JSON**：agent `printf '{"name":"%s"...}'` 不转义引号/反斜杠 | `a"b.txt` → 该行 JSON.parse 失败 → gateway `parseJsonLines` **静默丢弃** → 文件树缺文件且无任何报错（已实测复现） |
| 不稳定（长跑劣化） | `timeout --signal=KILL` **孙进程存活**（实测 sleep 存活 1 个）+ `ps_pid` 用 `kill -0`（PID 复用误判） | WSL 内孤儿进程随使用累积 |

### 0.2 对 DeepSeek 静态分析的独立复核结论

- **印证**：fs_list O(N) fork（实测 ~410×）；两套错误契约并存 + die 原因（stderr）经 mux **永久丢弃**（客户端只见 exit 64 + 空 stdout，无法区分 fs_write_failed/fs_mkdir_failed）；exec_bg 用 `pgrep -f "bash -c" -n` 猜 PID（并发即错）；timeout 后孙进程存活（实测）。
- **修正**：① probe **不在连接热路径**——probe 是用户触发的一次性 ssh，作业 dispatch 用 DB 缓存 last_probe_json；且本机 WSL 无 R（`Rscript` missing 秒退），probe 启动 R 的成本只在装了 R 的节点存在 → 降级为评估项。② `*.tmp.$$` 过滤在**同一 mux 会话内有效**（fs_write 与 fs_list 同在 mux shell 进程求值，`$$` 相同）——真缺口是**跨会话残留**（旧会话崩溃遗留的 `.tmp.<幽灵pid>` 永不被过滤）。③ `ConnectTimeout=10` 封不住 Windows OpenSSH 的 ::1 黑洞（实测 21.2s > 10s）。
- **新增**（DeepSeek 远程看不到传输层，未覆盖）：IPv6 黑洞（首连慢主根因）；特殊文件名坏 JSON 静默丢文件；mux 死后无透明重试；die 原因经 mux 永久不可见；30s 超时杀整条会话的悬崖（大目录 fs_list 必现）。
- **范围修正**：单操作 mux RTT 健康（fs_stat 15ms / sys_resource 23ms），「每操作 1.1s」是 BLOCK-67 之前的历史；**问题不在传输架构，在脚本 O(N) fork + 连接面黑洞 + 错误契约**。

### 0.3 probe 的 r/python 探测=生信时代残留（2026-09-16 用户追问，P0 裁决项）

用户原话：「关于 probe 那个呢 是不是不需要进行Rscript探测呀 毕竟这首先是个通用agent 不需要 R和python领域包的解释器」。代码事实（file:line 实证）：

- **probe 的 r/python 结果几乎喂死代码**：现役 SSH 项目插件工具链 `ssh-direct-runner.js` **零消费** probe/resolveRuntime（运行时执行时直取 captureREnv）；唯一实质消费方 `mcp/registry.js:1384-1386`（runPluginToolRemote legacy 分支）在 **BLOCK-76 P5 已退役**（非 SSH 项目远程目标直接 fail「远程执行目标已退役」）。
- 剩余活消费=纯展示：`RemoteTargets.tsx:52-56,181` 管理页徽标（`R x.y / Python z` 或「无 R/Python」）；os/hostname 仍被作业元数据使用（通用价值，保留）。
- 调用方硬编码：`target-registry.js` probe 固定传 `['probe', 'r', 'python']`；agent verb 本身已参数化（`probe <lang...>`，未装节点 `command -v` 秒退 ~2ms，装了 R 的节点 `Rscript --version` 真启动 R 0.2-0.8s）。
- **家法同向性**：BLOCK-83 D7 领域中性化（核心零领域运行时依赖，D7 棘轮在扫）+ BLOCK-86 运行时在位判定已改「包 `requires.runtimes` 契约推导」（本地侧 runtimeStatus 已如此，P3 抓真修过）——SSH 侧 probe 硬编码 r/python 是 BLOCK-57/67 生信时代残留，`scheduler=slurm` 检测同为 HPC 时代产物。
- **P0 裁决候选**（终态方向=「核心不问节点有没有 R，装了需要 R 的包才问」）：①调用方默认去 lang（`['probe']`，连通性+os/hostname 保留）；②管理页 R/Python/slurm 徽标移除（未来由已装包 `requires.runtimes` 声明驱动再显式出现）；③agent verb 参数化形态保留（零成本，领域包远程运行时声明可复用）；④registry.js legacy 死分支顺手清。台账 F1-F5 表述不变，P0 若纳入为 F6 再同步登记。

## 1. 六工作面（每面独立可验收、独立提交；F6=2026-09-16 P0 用户裁决新增）

### F1 连接面（首次连接慢的直接根因）

- **IPv6 黑洞治理**：用户侧立即可做 = `~/.ssh/config` 的 `Host wsl` 增 `AddressFamily inet`（或 HostName 改 `127.0.0.1`），21.2s → ~0.25s，**不必等本包启动**；产品级 = 目标配置可选 `addressFamily`（传输层按目标注入 `-o AddressFamily=inet`，不全局注入以免破坏 IPv6-only 远端）+ 目标连通性检测带握手计时（>2s 给出黑洞提示与修复指引）。
- **mux 重建透明重试**：幂等只读 verb（fs_stat/fs_list/fs_read/sys_resource）在会话死亡/超时后自动重建并重试一次；写类 verb 不自动重试（保持诚实失败）。
- **IDLE_CLOSE 与轮询协调评估**：10s 资源轮询天然保活 mux；评估空闲关闭是否需要区分「有轮询订阅的会话」。

### F2 列表面（不稳定悬崖 1/3 的直接根因）

- **fs_list 批量化**：逐条目 fork 改单进程（`find -maxdepth 1 -printf` 或批量 `stat`），O(N) fork → O(1)；保留 dotfile 过滤与排序契约。
- **JSON 名字转义修复**：名称/路径输出做 JSON 转义（引号/反斜杠/控制字符），配套**特殊文件名契约夹具**（引号/反斜杠/空格/Unicode），坏行静默丢文件从此绝迹。
- **大目录服务端分页 + 显式截断标记**：fs_list/fs_find 增加 limit/offset 与 `truncated:true`，替代「撞 30s 超时杀会话」；gateway 分页协议与前端树适配。**P0 裁决（2026-09-16）：前端树游标加载一期直做，不在只做协议配合**。

### F6 probe 领域探测退役（2026-09-16 P0 用户裁决「立 F6 全做」，§0.3 升格）

- 调用方默认去 lang：`target-registry.js` probe 固定传 `['probe', 'r', 'python']` → `['probe']`（连通性 + os/hostname 保留，通用价值）。
- 管理页 R/Python/slurm 徽标移除（`RemoteTargets.tsx`）——未来由已装包 `requires.runtimes` 声明驱动再显式出现（BLOCK-86 契约推导同向）。
- agent verb 参数化形态保留（`probe <lang...>` 零成本，领域包远程运行时声明可复用）。
- `mcp/registry.js` runPluginToolRemote legacy 死分支顺手清（BLOCK-76 已退役面）。

### F3 错误契约（可诊断性）

- **die 原因经 mux 回传**：`__mux` 响应 envelope 携带 stderr（b64），替代现在的 mktemp 捕获后 `rm -f` 丢弃；exit 64 类失败客户端能看到具体错误码。
- **`set -o pipefail` + 显式错误**：`wc -c | tr` 失败不再产出 `size:0` 静默条目；统一错误码表（usage/not_found/invalid_*/failed 族）。
- **`LC_ALL=C` 全 verb 设定** + 死代码清理（`now_ms` 未被调用；`getMuxSession` 的 `openTimeoutMs` 形参未使用）。

### F4 进程面（长跑稳定性）

- **exec_bg 身份修复**：子进程写 pidfile（`setsid` 后 `echo $$ > pidfile`）替代 `pgrep -f "bash -c" -n` 猜测；`ps_pid` 加 `/proc/<pid>/stat` starttime 身份校验防 PID 复用误判。
- **进程组清理**：`kill_pid` 支持 `setsid` 进程组击杀（`kill -- -PGID`）；exec 超时的孙进程存活（实测复现）以进程组方案治理。
- 契约对账：exec_bg/ps_pid/kill_pid 语义变化须 block77 resident 契约测试全绿后切换。

### F5 可观测 + 评估项收口

- **verb 级结构化日志**（门控开关，默认关）：每 verb 一行 JSON（verb/耗时/exit/字节数/是否截断/是否分页）——「感觉不稳定」从此可归因。
- **fs_grep 默认排除集**：`--exclude-dir` 默认 `.git/node_modules/target` 等，maxLines 只限输出不限工的问题缓解。
- **评估项**（须有结论，做/不做 + 依据，不允许悬置）：大文件 fs_read 改 sftp/scp 通道；probe 结果按节点 TTL 缓存（仅装 R 节点有收益）；`__mux` 请求 id + 并发分派（架构级，一期保持串行语义）。

## 2. 非范围（exclusions，写死）

- **BLOCK-95 信息流面零触碰**；**BLOCK-92 拆分面零触碰**（落点文件 node-agent 341 行 / ssh-multiplexer 193 行均 <700 不在其清单；workspace-gateway 若届时入清单，撞期即停手上报，BLOCK-95 §6 同款）；**BLOCK-93 文件面零触碰**；
- 前端树的刷新频率/重试 UX 策略不属本包（F2 前端增量**仅游标加载**，经 2026-09-16 P0 用户裁决纳入一期；其余前端面仍不在范围）；
- aliyun 公网 RTT 属网络物理现实，不属代码缺陷（本会话 agent 沙箱内无法复测 aliyun 连通性，已如实登记，不据此下结论）；
- `__mux` 并发化、大文件 sftp 通道一期仅评估不实现；
- 0 新依赖预期；若评估引入须走 `DEPENDENCY-CHANGE-CHECKLIST` + 用户裁决；
- 手机投影远程面；G1+ 发布面不外推（G0 开发期常态 · 不外推 packaged/Provider/GA）。

## 3. 原则（本包家法）

1. **先修正确性再谈性能**：F2 转义修复与 F3 pipefail 优先于纯速度优化——静默丢数据/静默 size=0 比慢更危险；
2. **每个性能宣称必须有前后对照数字**：以本会话基线（21.2s / 226ms / 2.6s@500 / 6.3ms 批量）为准绳，收口时同机复测对账；
3. **agent 脚本变更自动重部署**（sha256 版本钉扎，ensureAgent 哈希变即重传）：mux 会话生命周期 ≤ app 会话，无跨版本长连接兼容负担；但同一会话内 fs verbs 行为一致性须契约测试保证；
4. **协议演进最小化**：`__mux` 一期保持「无请求 id 串行」语义（block67 契约依赖），envelope 加 stderr 字段属向后兼容追加；
5. dev 纪律：core/biof3-server 变更须重启 dev 栈并预告用户窗口闪动；fnm Node 24。

## 4. 阶段草案（P0 评审裁剪优先级后串行执行）

| 阶段 | 内容 | 验收门禁 |
| --- | --- | --- |
| P0 | **已收口（2026-09-16）**：五工作面逐项代码事实复核（四处承重事实当日抽查与 HEAD 一致）+ 三裁决落定——F1=传输层参数化 / F2=一期直做前端游标 / §0.3=立 F6 全做 | 评审结论已回写本文件 + 用户确认（候选问答三问三答） |
| P1 | F6 probe 退役（独立提交）→ F1 连接面（addressFamily 参数 + 握手计时 + mux 幂等只读透明重试 + IDLE_CLOSE 评估结论）→ F2 列表面（fs_list 批量化 + JSON 转义 + 服务端分页 + **前端树游标加载**） | block67 族契约测试扩展全绿（特殊文件名夹具 + 大目录分页夹具）+ 前端 tsc/定向 vitest + 实机 WSL 计时对照（首连 21.2s→<1s、fs_list 2.6s→<0.1s @500 文件）+ 证据落 `acceptance/block-96/` |
| P2 | F3 错误契约（die 回传 + pipefail + LC_ALL=C + 错误码表） | 错误注入契约测试（写失败/坏 offset/越界显式错误码，无静默 size=0）+ block67 契约族全绿 |
| P3 | F4 进程面（pidfile + starttime 身份 + 进程组清理） | block77 resident 契约扩展全绿 + WSL 实机孤儿清零断言 |
| P4 | F5 可观测 + 评估项结论登记 + 整包收口 | verb 日志门控测试 + 评估项逐条结论回写 + `npm run closeout` + dev-verify 实机 flow allPass |

**完成语义**：整包 `completed` = 已启动工作面全部收口 + 实机对照数字落 `acceptance/block-96/`（新目录必配 impact-map）；评估项须有「做/不做 + 依据」结论；未启动工作面必须经用户显式裁决 `deferred` 并回写本状态头。

## 5. 风险与红线

- **agent 重部署时窗**：脚本哈希变更 → 各目标下次操作自动重传（ensureAgent 已有幂等重传）；运行中作业不受影响（jobs 面不改动）；多目标滚动窗口内新旧 agent 并存属预期，gateway 以本地哈希为准重传收敛；
- **exec_bg/ps_pid 语义变化**是 block77 消费方的行为变更：P3 必须先跑 block77 全量契约对账，红禁静默；
- **fs_list 分页是 gateway 与前端树的跨层契约**：P0 裁决（2026-09-16）一期即含前端树游标加载；服务端仍保证「不传参 = 全量」行为兼容，游标参数缺失时旧客户端零破坏；
- **测量环境边界**：本会话基线取自本机 WSL（IPv6 黑洞 21.2s 为 Windows OpenSSH 行为）；aliyun/其他远端不打 `-4`（IPv4 字面量）不受黑洞影响，RTT 成本如实按网络现实记录；
- **诚实边界**：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 收口预期预先声明（对账清单）

- 每工作面门禁实况数字（定向测试 x/x + 实机断言数）记入本文件状态头与 AUDIT-LOG 行；
- 性能对照数字（首连时长 / fs_list 耗时 / 每操作 RTT）改前改后同机对照落 `acceptance/block-96/`，impact-map 同步登记；
- 「无静默丢数据」红线逐面验收（特殊文件名夹具 + 错误注入夹具显式断言）；
- `npm run docs:check` 与 `npm run ui:audit:check` 收口必绿。
