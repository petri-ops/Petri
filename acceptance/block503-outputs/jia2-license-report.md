# JIA2 · capability-intake 两来源 license 补抓报告

日期：2026-11-19 · 用户口令：`甲2：补抓` · 来源真源=`acceptance/capability-intake/provenance.jsonl`（append-only）

## 结论

两个 C-56 内核来源均为 **MIT License**。原台账两行 `license_unknown=true` 保持不变；按 append-only 纪律追加两行更正记录，`license_unknown=false`，可供后续按 MIT 约束评估接入，但**本批不引入、不下载、不复制受版权正文**。

| 来源 | 原行 | 补抓行 | license | license_source | sha256（URL 可复算） |
|---|---|---|---|---|---|
| `github.com/blader/humanizer` | `ci-2026-11-18-001`（unknown） | `ci-2026-11-19-001` | MIT | `https://raw.githubusercontent.com/blader/humanizer/main/LICENSE` | `0abfcbd5de34a764512a3c35d7bc613c76d3e835f2cf5f126391cfe23c7da200` |
| `github.com/op7418/Humanizer-zh` | `ci-2026-11-18-002`（unknown） | `ci-2026-11-19-002` | MIT | `https://raw.githubusercontent.com/op7418/Humanizer-zh/main/LICENSE` | `ad53e2cd184ce91c98be5f319a40f513604eccc47454bbe37c0e0c64c0fa2f82` |

## 取证方式

1. `web_fetch` 抓 GitHub 仓库页，提取许可证类型与 LICENSE 链接；两页均给出 MIT + `main` 分支 LICENSE。
2. `web_fetch` 抓 raw LICENSE 文件，仅确认文件存在并提取许可证名称（MIT License），**未复制许可证正文或仓库代码**。
3. `sha256` = 对应 LICENSE raw URL 字符串的 sha256（`node:crypto` 现算），可复算；未保存外部正文快照，避免复制受版权内容。
4. 更正行追加到 `acceptance/capability-intake/provenance.jsonl`，字段沿用 D4 十字段；原两行逐字未改。

## 机械自检

`node` 解析 JSONL：`rows=4 / old=2（unknown 未改）/ added=2（MIT 且 license_unknown=false）/ sha256 逐行复算一致 / ok=true`。

## 边界

- 用户裁决只授权「补抓 license 证据」，不等于接入授权；本批零新依赖、零运行时改动、不克隆仓库、不复制受版权资产。
- C-56 手册层「取内核弃外壳、零复制」结论不变；MIT 接入仍需按常规依赖/许可流程另行裁决。
- 不写 verified；观感零代签；不碰 G1+。

G0 开发期常态 · 不外推 packaged/Provider/GA。
