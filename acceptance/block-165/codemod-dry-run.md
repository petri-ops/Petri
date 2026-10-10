# BLOCK-165 codemod DRY-RUN 报告（2026-10-10T14:05:20.817Z）

<!-- BLOCK-165-PETRI-OSS-RENAME 证据文件：本文件记录旧名属预期，机械替换豁免 -->

- 内容替换文件数：1680
- 内容替换命中次数：27912
- 行级标记保护行数：5
- 目录重命名：17 个
- 文件重命名：14 个
- 按顶层目录分布：`{"test":344,"frontend":268,"scripts":267,"docs":251,"core":207,"acceptance":206,"src":42,".agents":39,"(root)":12,"resources":12,"agent-transcripts":10,"agent-tools":7,"sidecars":5,"static":4,"build":2,".claude":1,".github":1,"eval-reports":1,"icons":1}`
- 豁免文件：`docs/block-165-petri-oss-rename-plan.md`, `scripts/block165-rename-codemod.mjs`, `test/block165-codemod-idempotent.test.mjs`, `package-lock.json`
- 豁免前缀：`acceptance/block-165/`

## 目录重命名清单

- `sidecars/computer-use/Sources/gewu-computer-use` → `sidecars/computer-use/Sources/petri-computer-use`
- `.agents/skills/gewu-dev-infra/dev-verify/flows` → `.agents/skills/petri-dev-infra/dev-verify/flows`
- `core/biof3-server/helpers/remote-execution` → `core/petri-server/helpers/remote-execution`
- `core/biof3-server/helpers/tools-executor` → `core/petri-server/helpers/tools-executor`
- `core/biof3-server/agent-tools/tool-defs` → `core/petri-server/agent-tools/tool-defs`
- `core/biof3-server/mobile-gateway/public` → `core/petri-server/mobile-gateway/public`
- `.agents/skills/gewu-project-governance` → `.agents/skills/petri-project-governance`
- `core/biof3-server/routes/result-studio` → `core/petri-server/routes/result-studio`
- `core/biof3-server/agent-tools/plugins` → `core/petri-server/agent-tools/plugins`
- `core/biof3-server/routes/_helpers` → `core/petri-server/routes/_helpers`
- `core/biof3-server/routes/ai-agent` → `core/petri-server/routes/ai-agent`
- `core/biof3-server/routes/harness` → `core/petri-server/routes/harness`
- `.agents/skills/gewu-code-review` → `.agents/skills/petri-code-review`
- `core/biof3-server/mcp/ide-tools` → `core/petri-server/mcp/ide-tools`
- `core/biof3-server/mcp/registry` → `core/petri-server/mcp/registry`
- `.agents/skills/gewu-dev-infra` → `.agents/skills/petri-dev-infra`
- `core/biof3-server` → `core/petri-server`

## 文件重命名清单

- `.claude/skills/gewu-code-review` → `.claude/skills/petri-code-review`
- `.claude/skills/gewu-dev-infra` → `.claude/skills/petri-dev-infra`
- `.codebuddy/skills/gewu-code-review` → `.codebuddy/skills/petri-code-review`
- `.codebuddy/skills/gewu-dev-infra` → `.codebuddy/skills/petri-dev-infra`
- `docs/BioF3-Desktop-Evaluation-Report-2026-08-14.md` → `docs/Petri-Desktop-Evaluation-Report-2026-08-14.md`
- `docs/block-61-brand-rename-gewu-plan.md` → `docs/block-61-brand-rename-petri-plan.md`
- `frontend/src/components/editor/integration/GewuOpenFileDevBridge.tsx` → `frontend/src/components/editor/integration/PetriOpenFileDevBridge.tsx`
- `icons/biof3-logo-concept-v1.png` → `icons/petri-logo-concept-v1.png`
- `static/img/avatars/biof3.svg` → `static/img/avatars/petri.svg`
- `static/img/biof3-favicon-1024.png` → `static/img/petri-favicon-1024.png`
- `static/img/biof3-favicon-optimized.png` → `static/img/petri-favicon-optimized.png`
- `static/img/biof3-favicon-watermark.svg` → `static/img/petri-favicon-watermark.svg`
- `static/img/biof3-favicon.svg` → `static/img/petri-favicon.svg`
- `static/img/biof3-social-card.png` → `static/img/petri-social-card.png`
