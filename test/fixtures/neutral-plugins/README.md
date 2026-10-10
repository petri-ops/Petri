# 中性插件夹具（test/fixtures/neutral-plugins/）

核心机制测试的**领域无关**分析插件载体（BLOCK-83 P4）。核心仓删除 `resources/built-in-plugins/`
（生信内容）后，凡是「断言核心机制、恰好拿生信插件当例子」的测试（BLOCK-83 分类 B 类）统一改用本目录。

## 用法

- 装载型测试：把 `PETRI_BUILT_IN_PLUGINS_DIR` 指向本目录（或在进程内 `loadPluginsFromSources({ builtInDir: <本目录> })`）。
- 描述符读取型测试：直接读 `sample-metrics/tool-definition.json` 的 `resultStudio` 块。

## 契约

- `sample-metrics`：最小合法分析插件（plugin.json + tool-definition.json + scripts/ + demo-data/ +
  **合法 resultStudio 描述符** + golden revision）。它的 RS descriptor 通过
  `core/shared-backend/result-studio-plugin-sdk.js` 的 fail-closed lint——契约测试可直接依赖这一点。
- 领域语义零含量：无基因/细胞/通路词汇（受 `test/domain-neutrality.test.mjs` 棘轮约束——夹具在本目录，
  而该门禁只扫 `core/`、`frontend/src/`、`src/`，不扫 test/，但保持本目录干净是纪律）。

## 禁止事项

- 不得把生信插件的副本、片段或领域词搬进本目录（那等于把领域内容从侧门带回核心）。
- 新增夹具插件必须是**领域中性**的最小载体。
