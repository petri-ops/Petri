# P7 · compose chart 节点 JSON 形态渲染定性（YI-REST-CLOSURE，只读核实）

## 结论

**渲染缺口（非数据形态问题）**——chart 渲染器未注册，兜底显示原始 payload。

## 代码依据

1. `components/copilot/gen-ui/compose/catalog.tsx:74-91`：chart 节点**已正确映射**为 `ResultNode { type: 'chart', payload: { kind: 'bar'|'line', labels, series } }`（数据形态无问题）。
2. `components/copilot/ResultCardRenderer.tsx:7`：注册表注释明言 **"table / chart / image renderers will be added"**——chart 渲染器未注册，未知 type 走原始 payload 兜底显示（即截图中的结构化 JSON）。
3. `components/copilot/renderers/ChartRenderer.tsx`（及 .test.tsx）**已存在**——渲染组件已备，只差在 ResultCardRenderer 注册接线。

## 修复路径（不实现，留候选发令）

在 ResultCardRenderer 注册 chart → ChartRenderer（组件已在，预计小体量接线批）；table 同注释预期一并处理。

## 关联

乙6 P5 完成态证据（p1-review-real 与 yi6-p5p6 的 compose 完成帧）中 metric 渲染正常（metric→type:'text' 已注册），chart 为唯一未注册叶子。候选登记=AUDIT-LOG 🗃 观察点 a 行。
