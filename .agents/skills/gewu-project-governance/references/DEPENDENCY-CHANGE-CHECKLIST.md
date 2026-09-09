# 依赖变更检查单

> 适用：新增任何 npm/pip/CRAN/系统运行时依赖，或升级现有依赖的大版本。
> 仓库惯例把"0 新依赖"当作收口成就——新增依赖是需用户裁决的大事，默认答案是"不加"。
> 先例：BLOCK-63 qrcode-generator 标 ⏳ 唯一新依赖待裁决；BLOCK-22 拒绝 monaco/react-diff-viewer 改自研。

## 四问（全部有答案才提案）

- [ ] **替代方案审过没**：stdapi / 既有依赖 / 自研小函数能否覆盖？给出对比结论（先例：拒绝 react-split-pane/monaco，复用 BLOCK-20 diff 资产）
- [ ] **许可证与维护度**：license 兼容？近一年有维护？周下载量/星标量级？传递依赖膨胀多少？
- [ ] **影响面**：bundle 体积 / ABI（native 模块对 Node 版本敏感，先例：better-sqlite3 ABI 137 必须配 fnm Node 24）/ 打包产物 / 启动时长
- [ ] **退出成本**：若未来要移除，封装边界在哪（一层 wrapper 隔离，不散落直引）？

## 提案格式

- [ ] 用户裁决留痕（裁决原话 + 日期），写入对应工作包 plan 的依赖小节
- [ ] 版本钉扎精确（^/~ 策略说明），登记 py-runtime-requirements / r-runtime-packages / package.json 对应清单
- [ ] 收口笔录如实写"N 新依赖"，不再适用"0 新依赖"表述
