# 审计广播台历史归档 · through 2026-11-25

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（BLOCK-170 自稳设计；
> 活跃台只留「最后更新」链最近 8 条，本档=被淘汰链行原文追加，搬移不改写）。
> 状态与完成语义以 canonical 文档（roadmap/plan/DOC-REGISTRY）为准，本档仅作广播历史追溯。

最后更新：2026-11-25（🏁 **BLOCK-519 语音本地模型 SenseVoice 阶段一收口（completed；owner 经兴奋转达主人「按你的推荐来，冲吧」第二包开工令）**：speech-config additive provider_chain/local_model + 本地模型管理器（下载/SHA/原子移动/删除，落盘真值、不挂 ledger）+ native worker 子进程隔离 DYLD_LIBRARY_PATH + asr-provider local→deepseek 回退链 + transcribe_audio 链透传 + 设置页本地/云端/链三态切换/语言 auto/模型列表（下载/使用中/删除）+ REST 三口；阶段二 whisper 并列与 composer 麦克风未做。HK-01 红→绿：后端 7/7 + 既有 P6 语音 10/10 + 前端 6/6 + types/lint 0；隔离 /tmp 真机 arm64 模型下载 50s + 官方 zh.wav 本地转写成功、0 云请求（证据 acceptance/voice-local-stage1/）；test:changed 6630/38（余红均存量/他方 WIP，归属见 EVIDENCE.md）+ 静态十门 PASS + docs/ui PASS；1 新依赖 sherpa-onnx-node@2.0.3 精确钉扎；Vite 新源 HMR、owner 3000/3001/9222 三 PID 未触碰；19 项 WIP/frogfish 零触碰、观感零代签。G0 开发期常态 · 不外推 packaged/Provider/GA.）
