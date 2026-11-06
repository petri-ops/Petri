# NSO Wave-6a 证据（BLOCK-363）

- 真实进程回归 `test/nso-w6-task-runner-teardown.test.mjs`：修前孙进程存活（红）→ 修后有界消失（绿）；`test/dev-task-runner.test.mjs` 同批绿。
- `closeout-current-tree.log`：test:changed 门红项与前几波同一归因集合，无新增；audit:compact 守卫再次自动改写到带时间戳归档，在制集文件未变。
- 例外：Windows 树终止、node --test 并行挂起根因另批。
