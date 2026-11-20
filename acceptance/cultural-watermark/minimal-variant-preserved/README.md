# 极简水印变体留证包（R2 清偿批 S1 · 2026-11-21）

> 用途：水印并发冲突清场的**回退前原样留证**（先例 abfeea76「独立新文件不碰对方」）。
> 终版裁决（预置裁决 R2，`docs/next-phase-e2e-prompt-2026-11-20.md` §2.2）：**留 AI 版**——唯一有实机
> 12/12 绿证据（`acceptance/cultural-watermark/ai-image/live/`，已提交）且 `main.tsx` 已接线；
> 极简版自身 live 证据 `allPass:false`（见 `live-minimal/cultural-watermark-live-darwin.json`）。
> 本包内容为 2026-11-20 21:01–21:05 并发写入窗口落盘的工作区原样字节，未做任何改写。

## 清单

| 文件 | 来源 | 说明 |
|---|---|---|
| `watermark.css` | `frontend/src/styles/watermark.css`（M，回退前） | 极简候选1：12% 墨 uniform stroke |
| `GlobalWatermark.tsx` | `frontend/src/components/common/GlobalWatermark.tsx`（M，回退前） | 极简单文件组件（未接线） |
| `cultural-watermark.cjs` | `.agents/skills/petri-dev-infra/dev-verify/flows/cultural-watermark.cjs`（M，回退前） | 极简版 live flow 改写 |
| `watermark-contract.test.ts` | `frontend/src/styles/watermark-contract.test.ts`（未跟踪） | 5 tests 全绿但锚未接线死代码（R2 §1 发现3） |
| `live-minimal/` | `acceptance/cultural-watermark/live-minimal/`（未跟踪目录） | 极简版自身实机证据：`allPass:false`（vite_bundle_ready FAIL + cdp_socket_not_open） |
| `live-json-worktree-snapshot-ai-run.json` | `acceptance/cultural-watermark/live/cultural-watermark-live-darwin.json`（M，回退前） | AI 版实机 12/12 运行的冗余副本；canonical 副本=已提交的 `ai-image/live/cultural-watermark-ai-live-darwin.json` |

## 回溯命令（如需恢复极简版形态）

```bash
cp acceptance/cultural-watermark/minimal-variant-preserved/watermark.css frontend/src/styles/watermark.css
cp acceptance/cultural-watermark/minimal-variant-preserved/GlobalWatermark.tsx frontend/src/components/common/GlobalWatermark.tsx
cp acceptance/cultural-watermark/minimal-variant-preserved/watermark-contract.test.ts frontend/src/styles/watermark-contract.test.ts
# 注意：main.tsx 需同步改回渲染 GlobalWatermark（极简版）才非死代码；flow 同理取 preserved 副本。
```

清场后 `frontend/src/styles/watermark.css` / `GlobalWatermark.tsx` / flow 回到 HEAD（钢笔笔锋版，提交
`c95c2a26`）；被删 4 张已提交 PNG（`acceptance/cultural-watermark/live/*.png`）由 `git checkout HEAD --` 复原。
归属：水印两并发会话（留证登记，未删任何对方产物）。
