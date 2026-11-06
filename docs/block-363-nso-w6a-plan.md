---
capability: block-363-nso-w6a-teardown
status: active
goal: NSO-W6a 资源清理——dev-task-runner 终止时把信号下发到整个进程组，长任务（全量测试等）被 SIGTERM/SIGINT 后不再遗留孤儿进程；用真实进程回归钉住。
acceptance:
  - POSIX 下 runner 以独立进程组启动子命令，收到 SIGTERM/SIGINT 时向整组下发；孙进程随之终止
  - 真实进程回归：runner 启动会派生长寿孙进程的命令 → 向 runner 发 SIGTERM → 孙进程在有界时间内消失（修前必红）
  - Windows 路径保持现状并如实登记（树终止需 taskkill /T，另批）
reopen: node --test 默认并行在 627 文件规模确定性挂起的根因（W0 实测三次，串行默认已绕过）另批归因
---

# BLOCK-363 · NSO-W6a teardown 孤儿进程根修

> 蓝图依据：§9（W6-8 资源清理）。实证：W0 发现评估会话 `eval-full-tests` 被 SIGTERM（exit 143）后，其 `node --test` 孙进程空转 16 小时、占满一个 CPU 核。根因：runner `spawn(cmd, { shell: true })` 后 `child.kill(sig)` 只终止 shell。
