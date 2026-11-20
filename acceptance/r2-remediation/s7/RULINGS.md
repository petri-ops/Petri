# S7 测试实例 TTL 机械门禁 · 裁决留痕（2026-11-21）

> 波次：R2 清偿批 S7（P2-2）· 同类第二次（9223 遗留 30+ 分钟→9h，R1 已记→R2 复现）→ 按治理纪律转机械门禁，不只修这一次。

## R-S7-1 设计（单一最合理选择）

**TTL 看门狗内置于 `start-test-instance.sh`**（非 runner 收尾 kill）：实例就绪即布防 detached 看门狗，
超时自动 kill 9223 监听者。理由：①脚本是测试实例唯一入口（BLOCK-457 后唯一 spawner），布防点单源；
②「跑完 kill」靠 agent 记忆已两次失守，TTL 把遗忘的有界代价封顶；③不破坏「一次启动多 flow 复用」的既有模式
（runner 收尾 kill 会破坏复用）。

关键机制：
- 默认 `PETRI_TEST_TTL_S=14400`（4h，≤24h 有界，可覆盖）。
- **代币防误杀**：`.petri-test-instance.ttl` 标记 + 触发时核对——重启实例刷新标记，旧看门狗触发即静默退出。
- 触发时**按端口现查监听者**再杀（不锚启动期 pid，重启漂移安全）；双端同形（darwin lsof / win netstat+taskkill）。
- kill 动作落 `.petri-test-instance.ttl.log` 留痕（事后可归因）。

## R-S7-2 HK-01 红绿

红：`test/test-instance-ttl.test.mjs` 3/3 fail（脚本无 TTL/无代币/无默认值）→
绿：实现后 3/3。门法=源码扫描（与 live-window-policy 同族）。

## R-S7-3 行为验证（实机）

- 短 TTL 实测：`PETRI_TEST_TTL_S=8` 启动 → 16s 后 9223 自动释放，ttl.log 落
  `[ttl-watchdog] TTL 8s reached — killed leftover test instance (pid 54126)`。
- 代币防误杀实测：TTL 8s 启动后 2s 内重启（换代）→ 12s 后**新实例存活**（旧看门狗未误杀），ttl.log 无新增 kill 行。
- 验证完实例已 kill（纪律）。

## 附带

- `.gitignore` 增 `.petri-test-instance.ttl` / `.petri-test-instance.ttl.log`（运行时产物，不入库）。
- impact-map `script-dev-stack` 规则 tests 追加 TTL 契约测（改脚本必跑）；`test:changed:list` exit 0 维持。
