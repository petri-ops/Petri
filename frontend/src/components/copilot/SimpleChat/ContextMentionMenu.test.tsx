// BLOCK-245 P4 — `@` 上下文菜单渲染面：分组/来源标签/上限提示/不可用原因/
// 空结果文案/键盘高亮与点选回调。菜单不抢焦点（item 用 onMouseDown 抑制默认）。
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContextMentionMenu } from './ContextMentionMenu';
import {
  CONTEXT_SOURCE_CAPS,
  buildConnectorCandidates,
  buildFileCandidates,
  unavailableContextSource,
  type ContextSourceResult,
} from './contextSources';

afterEach(cleanup);

function files(count: number): ContextSourceResult {
  return buildFileCandidates(
    Array.from({ length: count }, (_, i) => ({ name: `f${i}.R`, type: 'file' as const, size: 0 })),
  );
}

function renderMenu(overrides: Partial<ComponentProps<typeof ContextMentionMenu>> = {}) {
  return render(
    <ContextMentionMenu
      sources={[]}
      activeId={null}
      loading={false}
      onPick={vi.fn()}
      onHover={vi.fn()}
      {...overrides}
    />,
  );
}

describe('ContextMentionMenu（BLOCK-245 P4）', () => {
  it('按源分组渲染：组头=来源标签+本组条数，行尾带来源标签', () => {
    const { container } = renderMenu({
      sources: [
        files(2),
        buildConnectorCandidates([{ id: 'filesystem', status: 'connected', toolCount: 5 }]),
      ],
    });
    const heads = Array.from(container.querySelectorAll('.sc-mention-group-head'));
    expect(heads.map((head) => head.textContent)).toEqual(['文件2', '连接器1']);
    const sources = Array.from(container.querySelectorAll('.sc-mention-item-source'));
    expect(sources.map((row) => row.textContent)).toEqual(['文件', '文件', '连接器']);
    expect(screen.getByText('f0.R')).toBeTruthy();
    expect(screen.getByText('filesystem')).toBeTruthy();
  });

  it('逐项上限：被藏条数可见并带上限值（不静默截断）', () => {
    const source = files(CONTEXT_SOURCE_CAPS.file + 4);
    // 过滤面在宿主做；这里直接给"已截断"的源形态。
    const truncated: ContextSourceResult = {
      ...source,
      candidates: source.candidates.slice(0, CONTEXT_SOURCE_CAPS.file),
      truncated: 4,
    };
    renderMenu({ sources: [truncated] });
    expect(screen.getByText(new RegExp(`还有 4 条未显示`))).toBeTruthy();
    expect(screen.getByText(new RegExp(`每组最多 ${CONTEXT_SOURCE_CAPS.file} 条`))).toBeTruthy();
  });

  it('源不可用：原因逐条可见（不是空白面板）', () => {
    renderMenu({ sources: [unavailableContextSource('agent', '尚未配置子智能体 profile')] });
    expect(screen.getByText('智能体不可用')).toBeTruthy();
    expect(screen.getByText('尚未配置子智能体 profile')).toBeTruthy();
    expect(screen.getByText('没有匹配的上下文候选')).toBeTruthy();
  });

  it('加载中给进行时文案（与零结果文案互斥）', () => {
    renderMenu({ loading: true });
    expect(screen.getByText('正在加载上下文来源…')).toBeTruthy();
    expect(screen.queryByText('没有匹配的上下文候选')).toBeNull();
  });

  it('有界提示（note）随组渲染', () => {
    const bounded = buildFileCandidates([{ name: 'a.R', type: 'file', size: 0 }], { treeTruncated: true });
    renderMenu({ sources: [bounded] });
    expect(screen.getByText(/500/)).toBeTruthy();
  });

  it('activeId 命中行加高亮类并置 aria-selected', () => {
    const source = files(2);
    renderMenu({ sources: [source], activeId: source.candidates[1].id });
    const options = screen.getAllByRole('option');
    expect(options[0].getAttribute('aria-selected')).toBe('false');
    expect(options[1].getAttribute('aria-selected')).toBe('true');
    expect(options[1].className).toContain('sc-mention-item-focused');
  });

  it('点选与悬停回调带回对应候选（鼠标路径与键盘路径一致）', () => {
    const onPick = vi.fn();
    const onHover = vi.fn();
    const source = files(2);
    renderMenu({ sources: [source], onPick, onHover });
    const options = screen.getAllByRole('option');
    fireEvent.mouseEnter(options[0]);
    fireEvent.click(options[1]);
    expect(onHover).toHaveBeenCalledWith(source.candidates[0]);
    expect(onPick).toHaveBeenCalledWith(source.candidates[1]);
  });
});
