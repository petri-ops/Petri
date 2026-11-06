---
capability: block-371-nso-w3b-live-walkthrough
status: completed
goal: NSO-W3b 实机走查——9223 离屏实例跑 UI-697/698/699 的 live 腿（prefs 失败告警条/树语义/content-visibility/降级原因/inert），证据落 dev-verify。
acceptance:
  - nso-w3-visual-live flow 落盘证据 JSON+PNG；可达腿全 PASS；不可达腿如实 pending（不冒绿）
  - UI-697/698/699 台账回写实机结果
reopen: 结果库行/binary 降级原因两腿待该项目结果面板行数据（其余两腿已 live 通过：会话行 cv + scheduled inert）
---

# BLOCK-371 · NSO-W3b 实机走查

> 前置：UI-696 已落地，9223 实例在跑（共享 dev 数据面）。flow=`.agents/skills/petri-dev-infra/dev-verify/flows/nso-w3-visual-live.cjs`（evalJs 对象直返形态，无 stringify/parse 往返）。
