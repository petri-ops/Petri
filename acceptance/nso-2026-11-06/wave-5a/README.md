# NSO Wave-5a 证据（BLOCK-364）

- 契约 `test/nso-w5-impact-coverage.test.mjs` 3/3；负测：临时未映射测试 `test/zz-w5a-probe-unmapped.test.mjs` → 判红并点名，删除后复绿。
- 死熔断删除：git grep 零代码引用；provider-protocol 10/10；quality:arch PASS；knip 327 键冻结。
- `closeout-current-tree.log`：红项与前几波同一归因集合，无新增。
