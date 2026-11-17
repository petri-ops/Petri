/**
 * UI-703 — API Endpoint 编辑器信息密度契约（红绿先行）。
 *
 * 用户实测（2026-11-16 截图）：表头 11 列里「上下文窗口」4 字在固定 96px 列内换行成
 * 两行；API Endpoint 区顶部两段说明 + 识图/向量两行说明 + 底部容错小字叠加，重点信息
 * （每个下拉绑什么）被淹没。本契约锁定精简后的稳定形态：
 *   1. 表头「上下文窗口」改为短标签「上下文」（4 字→2 字，96px 内单行）；
 *      BLOCK-456（UI-707）后继裁决：上下文列整列退役（跟具体模型走，聊天模型菜单行内调），
 *      本条升级为「两种上下文表头 span 都不再出现」。
 *   2. 顶部说明压为一段；Key 的显示/导出细节下沉到 title 悬停，不再占正文段落。
 *   3. 角色行（识图/向量）正常态不再各自铺一段长说明，只在「未绑定/无渠道」异常态提示。
 *
 * 采用源码契约（同 block324 词表机械锁先例）：这些文案在完整设置面板里渲染依赖大量
 * IPC/store，文本断言更稳、且精确到「这段长文案不再出现在正文」。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../../../../');
const panelSrc = readFileSync(
  resolve(ROOT, 'frontend/src/components/desktop/DesktopSettingsPanel.tsx'),
  'utf8',
);
const visionSrc = readFileSync(
  resolve(ROOT, 'frontend/src/components/desktop/DesktopSettingsPanel/VisionRoleBinding.tsx'),
  'utf8',
);
const embeddingSrc = readFileSync(
  resolve(ROOT, 'frontend/src/components/desktop/DesktopSettingsPanel/EmbeddingRoleBinding.tsx'),
  'utf8',
);
const cssSrc = readFileSync(
  resolve(ROOT, 'frontend/src/components/desktop/desktop.css'),
  'utf8',
);

describe('UI-703 API Endpoint 编辑器信息密度', () => {
  it('上下文表头退役（BLOCK-456）：长短两种「上下文」span 都不再出现', () => {
    expect(panelSrc).not.toContain('<span>上下文</span>');
    expect(panelSrc).not.toContain('<span>上下文窗口</span>');
  });

  it('顶部说明压为一段：Key 显示/导出细节下沉为 title 悬停，不再是正文段落', () => {
    // 信息保留（title 里），但不作为独立 <p> 正文段落占据版面
    expect(panelSrc).toContain('title="Key 默认隐藏，可点击眼睛显示或复制');
    expect(panelSrc).not.toContain('<p className="petri-field__hint">Key 默认隐藏');
  });

  it('识图角色行正常态不再铺长说明（仅保留 title 悬停 + 异常态提示）', () => {
    expect(visionSrc).not.toContain('换绑后贴图即走所选渠道');
  });

  it('向量角色行正常态不再铺长说明（仅保留 title 悬停 + 异常态提示）', () => {
    expect(embeddingSrc).not.toContain('用于知识空间语义检索与对话记忆召回；模型输出必须为 1024 维');
  });

  it('表头 span 统一 nowrap，列名不再换行', () => {
    const blocks = [...cssSrc.matchAll(/\.petri-endpoint-list-header\s*\{[^}]*\}/gs)].map((m) => m[0]);
    const main = blocks.find((b) => b.includes('padding')) ?? blocks[0];
    expect(main).toContain('white-space: nowrap');
  });
});
