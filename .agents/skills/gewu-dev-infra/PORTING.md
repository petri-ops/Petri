# PORTING — 把 gewu-dev-infra 复用到其他仓库

本 skill 文件夹是自洽工具包：脚本、模板、flow 模板、原则参考全部随包携带，脚本位置无关（向上查找 `package.json` 定位仓库根）。复用步骤：

## 1. 拷贝

把整个 `.agents/skills/gewu-dev-infra/` 目录拷到目标仓库同路径（保持路径让 ZCode / Claude Code 自动发现；Claude Code 另需 `.claude/skills/gewu-dev-infra` 相对链接，内容 `../../.agents/skills/gewu-dev-infra`）。

## 2. 接线 package.json

```json
{
  "scripts": {
    "state": "node .agents/skills/gewu-dev-infra/scripts/workspace-state.mjs",
    "hygiene:check": "node .agents/skills/gewu-dev-infra/scripts/hygiene-check.mjs",
    "closeout": "node .agents/skills/gewu-dev-infra/scripts/closeout-gates.mjs",
    "verify": "node .agents/skills/gewu-dev-infra/dev-verify/run.cjs"
  }
}
```

## 3. 各资产的可移植性矩阵

| 资产 | 可移植性 | 说明 |
| --- | --- | --- |
| `scripts/hygiene-check.mjs` | 开箱即用 | 只依赖 git；临时命名模式可按目标仓库习惯改 |
| `scripts/closeout-gates.mjs` | 开箱即用 | hygiene 随包自带；docs/ui-audit/tests 三个门禁探测宿主 `scripts/` 下对应脚本，缺失时如实标 SKIP-with-reason |
| `scripts/workspace-state.mjs` | 开箱即用（降级） | Git 区块通用；AUDIT-LOG/DOC-REGISTRY 区块按格物路径探测，缺失时诚实降级。目标仓库可改造为读自己的状态文档 |
| `dev-verify/lib.cjs` + `run.cjs` + `flows/` | 需一步接线 | CDP 客户端从宿主 `scripts/g0-rs-p7-cdp.cjs` 懒解析——目标仓库自备等价 `CdpClient`（WebSocket JSON-RPC：send/on event），或拷贝格物的该文件 |
| `templates/delegation-contract.md` | 开箱即用 | 纯流程模板 |
| `references/PRODUCT-PRINCIPLES.md` | 开箱即读 | 非 canonical 原则摘要，按目标仓库治理体系校正 |
| `references/DEV-DECISION-TOOLS.md`（决策建议器方法论） | 开箱即读（方法论层） | 四时点主动行使、`--supply` 选型、θ 门与红线全部通用；npm 命令行按目标仓库 package.json 接线 |
| 决策/校准代码层（`decision-api` / `judge-core` / 校准 harness / 语料构建器） | 需一步对接 | 源码在格物 `core/biof3-server/helpers/` + `scripts/`（不随本 skill 携带）：`judge-core` 经 `overrides {apiKey,baseUrl,model}` 与端点解耦（换模型=换配置）；`decision-api` 打 `{baseUrl}/v1/systemone` 类型化决策端点——目标仓库或复用同一端点（Jev/Laya 为仓库外独立服务），或把该单文件换成自有模型封装。校准方法论（配对语料 gold 确定性/θ 扫描/precision-coverage-trap 门/无证据不门控）直接照搬 |

## 4. 写第一个 flow

参考 `dev-verify/flows/_template.cjs` 与 `dev-verify/README.md`。纪律不变：只连既有 dev 栈不代启停；证据落 `acceptance/`；断言不可编造。

## 5. 回到格物仓库时

无需任何操作——本仓库 package.json 已接线，全部命令开箱可用。
