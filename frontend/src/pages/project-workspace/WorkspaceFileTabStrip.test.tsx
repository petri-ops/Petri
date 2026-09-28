// UI-451 — WorkspaceFileTabStrip 组件测试：切换/关闭/脏圆点/右键批量菜单/拖拽重排。
// 拖拽用 dataTransfer 桩 + fireEvent；矩形用 getBoundingClientRect 桩控制左右半区。

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActiveWorkspaceFile } from './types';
import { FILE_TAB_DRAG_MIME, WorkspaceFileTabStrip } from './WorkspaceFileTabStrip';

function file(path: string, name?: string): ActiveWorkspaceFile {
  return { path, name: name || path.split('/').pop() || path, url: `http://mock/${path}` };
}

const A = file('a.txt');
const B = file('b.md');
const C = file('c.json');

function dataTransferStub(getDataValue = '') {
  return {
    types: [FILE_TAB_DRAG_MIME],
    setData: vi.fn(),
    getData: vi.fn(() => getDataValue),
    effectAllowed: '',
    dropEffect: '',
  };
}

/** happy-dom 的 DragEvent 构造器丢 clientX：用 MouseEvent 携带几何量 + 手挂 dataTransfer。 */
function fireDragOver(el: HTMLElement, clientX: number) {
  const event = new MouseEvent('dragover', { clientX, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransferStub() });
  fireEvent(el, event);
}

function fireDrop(el: HTMLElement, getDataValue: string, clientX: number) {
  const event = new MouseEvent('drop', { clientX, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransferStub(getDataValue) });
  fireEvent(el, event);
}

function renderStrip(overrides?: Partial<Parameters<typeof WorkspaceFileTabStrip>[0]>) {
  const props: Parameters<typeof WorkspaceFileTabStrip>[0] = {
    files: [A, B, C],
    activePath: 'b.md',
    dirtyPaths: {},
    onActivate: vi.fn(),
    onRequestClose: vi.fn(),
    onMenuAction: vi.fn(),
    onReorder: vi.fn(),
    ...overrides,
  };
  const view = render(<WorkspaceFileTabStrip {...props} />);
  return { view, props };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('WorkspaceFileTabStrip 渲染与切换', () => {
  it('每个文件一个 tab，激活 tab 挂 aria-selected', () => {
    renderStrip();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: /b\.md/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /a\.txt/ }).getAttribute('aria-selected')).toBe('false');
  });

  it('点击 tab：onActivate 收到数组内既有对象（身份不变 → 预览不重载）', () => {
    const { props } = renderStrip();
    fireEvent.click(screen.getByRole('tab', { name: /c\.json/ }));
    expect(props.onActivate).toHaveBeenCalledWith(C);
  });

  it('X 按钮：onRequestClose 收到该 tab path，且不触发激活', () => {
    const { props } = renderStrip();
    fireEvent.click(screen.getByLabelText('关闭 a.txt'));
    expect(props.onRequestClose).toHaveBeenCalledWith('a.txt');
    expect(props.onActivate).not.toHaveBeenCalled();
  });

  it('中键关闭：onRequestClose 收到该 tab path', () => {
    const { props } = renderStrip();
    const tab = screen.getByRole('tab', { name: /a\.txt/ });
    fireEvent(tab, new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }));
    expect(props.onRequestClose).toHaveBeenCalledWith('a.txt');
  });

  it('脏 tab：显示未保存圆点，title 带「有未保存修改」', () => {
    renderStrip({ dirtyPaths: { 'b.md': true } });
    expect(screen.getByTestId('file-tab-dirty')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /b\.md/ }).getAttribute('title')).toContain('有未保存修改');
  });

  it('键盘 Enter 激活', () => {
    const { props } = renderStrip();
    fireEvent.keyDown(screen.getByRole('tab', { name: /a\.txt/ }), { key: 'Enter' });
    expect(props.onActivate).toHaveBeenCalledWith(A);
  });
});

describe('WorkspaceFileTabStrip 右键批量菜单', () => {
  it('右键弹出菜单，含关闭/关闭其他/关闭右侧/关闭全部', () => {
    renderStrip();
    fireEvent.contextMenu(screen.getByRole('tab', { name: /b\.md/ }));
    expect(screen.getByTestId('file-tab-menu')).toBeTruthy();
    expect(screen.getByTestId('file-tab-menu-close')).toBeTruthy();
    expect(screen.getByTestId('file-tab-menu-closeOthers')).toBeTruthy();
    expect(screen.getByTestId('file-tab-menu-closeRight')).toBeTruthy();
    expect(screen.getByTestId('file-tab-menu-closeAll')).toBeTruthy();
  });

  it('点击「关闭其他」回调 onMenuAction(closeOthers, path) 并收起菜单', () => {
    const { props } = renderStrip();
    fireEvent.contextMenu(screen.getByRole('tab', { name: /b\.md/ }));
    fireEvent.click(screen.getByTestId('file-tab-menu-closeOthers'));
    expect(props.onMenuAction).toHaveBeenCalledWith('closeOthers', 'b.md');
    expect(screen.queryByTestId('file-tab-menu')).toBeNull();
  });

  it('末位 tab 无「关闭右侧」；单 tab 无「关闭其他」', () => {
    renderStrip();
    fireEvent.contextMenu(screen.getByRole('tab', { name: /c\.json/ }));
    expect(screen.queryByTestId('file-tab-menu-closeRight')).toBeNull();
    cleanup();
    renderStrip({ files: [A], activePath: 'a.txt' });
    fireEvent.contextMenu(screen.getByRole('tab', { name: /a\.txt/ }));
    expect(screen.queryByTestId('file-tab-menu-closeOthers')).toBeNull();
    expect(screen.getByTestId('file-tab-menu-close')).toBeTruthy();
  });

  it('Esc 与 backdrop 外点关闭菜单', () => {
    renderStrip();
    fireEvent.contextMenu(screen.getByRole('tab', { name: /a\.txt/ }));
    expect(screen.getByTestId('file-tab-menu')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('file-tab-menu')).toBeNull();
    fireEvent.contextMenu(screen.getByRole('tab', { name: /a\.txt/ }));
    fireEvent.mouseDown(screen.getByTestId('file-tab-menu-layer'));
    expect(screen.queryByTestId('file-tab-menu')).toBeNull();
  });
});

const RECT_100 = {
  left: 0, top: 0, right: 100, bottom: 26, width: 100, height: 26, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;

/** happy-dom 的原型级 rect 桩不可靠，直接把矩形赋到目标 tab 元素上。 */
function pinRect(el: HTMLElement): HTMLElement {
  el.getBoundingClientRect = () => RECT_100;
  return el;
}

describe('WorkspaceFileTabStrip 拖拽排序', () => {
  it('tab A 拖到 tab C 右半区：onReorder(a.txt, 3)（C 的 index+1）', () => {
    const { props } = renderStrip();
    const tabC = pinRect(screen.getByRole('tab', { name: /c\.json/ }));
    const tabA = screen.getByRole('tab', { name: /a\.txt/ });
    fireEvent.dragStart(tabA, { dataTransfer: dataTransferStub() });
    fireDragOver(tabC, 90);
    expect(tabC.className).toContain('workspaceFileTabDropRight');
    fireDrop(tabC, 'a.txt', 90);
    expect(props.onReorder).toHaveBeenCalledWith('a.txt', 3);
  });

  it('tab C 拖到 tab A 左半区：onReorder(c.json, 0)', () => {
    const { props } = renderStrip();
    const tabA = pinRect(screen.getByRole('tab', { name: /a\.txt/ }));
    fireEvent.dragStart(screen.getByRole('tab', { name: /c\.json/ }), { dataTransfer: dataTransferStub() });
    fireDragOver(tabA, 10);
    expect(tabA.className).toContain('workspaceFileTabDropLeft');
    fireDrop(tabA, 'c.json', 10);
    expect(props.onReorder).toHaveBeenCalledWith('c.json', 0);
  });

  it('拖到 tab 条空白区：onReorder(fromPath, files.length)（追加末尾）', () => {
    const { props } = renderStrip();
    const strip = screen.getByTestId('file-tab-strip');
    fireEvent.dragStart(screen.getByRole('tab', { name: /a\.txt/ }), { dataTransfer: dataTransferStub() });
    fireEvent.dragOver(strip, { dataTransfer: dataTransferStub() });
    expect(strip.className).toContain('workspaceFileTabStripDropTail');
    fireEvent.drop(strip, { dataTransfer: dataTransferStub('a.txt') });
    expect(props.onReorder).toHaveBeenCalledWith('a.txt', 3);
  });

  it('拖回自己：不触发 onReorder', () => {
    const { props } = renderStrip();
    fireEvent.dragStart(screen.getByRole('tab', { name: /a\.txt/ }), { dataTransfer: dataTransferStub() });
    fireEvent.dragOver(screen.getByRole('tab', { name: /a\.txt/ }), { dataTransfer: dataTransferStub(), clientX: 10 });
    fireEvent.drop(screen.getByRole('tab', { name: /a\.txt/ }), { dataTransfer: dataTransferStub('a.txt'), clientX: 10 });
    expect(props.onReorder).not.toHaveBeenCalled();
  });
});

// UI-451 加映 v2 — 同名去重（P2-3）/ reveal 菜单（P2-5）/ 激活滚入（P2-4）
describe('WorkspaceFileTabStrip 加映 v2', () => {
  it('同名文件显示父目录限定，唯一名不显示；title 仍为全路径', () => {
    const dup1 = file('src/a/x.ts');
    const dup2 = file('lib/b/x.ts');
    const unique = file('readme.md');
    renderStrip({ files: [dup1, dup2, unique], activePath: 'readme.md' });
    const tab1 = screen.getByRole('tab', { name: /x\.ts.*a/ });
    const tab2 = screen.getByRole('tab', { name: /x\.ts.*b/ });
    expect(tab1.textContent).toContain('a');
    expect(tab2.textContent).toContain('b');
    const tab3 = screen.getByRole('tab', { name: /readme/ });
    expect(tab3.textContent).not.toContain('根目录');
    expect(tab1.getAttribute('title')).toBe('src/a/x.ts');
  });

  it('根目录同名文件限定显示「根目录」', () => {
    renderStrip({ files: [file('x.txt'), file('dir/x.txt')], activePath: 'x.txt' });
    const rootTab = document.querySelector('[data-file-tab-path="x.txt"]');
    const dirTab = document.querySelector('[data-file-tab-path="dir/x.txt"]');
    expect(rootTab?.textContent).toContain('根目录');
    expect(dirTab?.textContent).toContain('dir');
  });

  it('右键菜单含「在树中显示」并回调 onMenuAction(reveal, path)', () => {
    const { props } = renderStrip();
    fireEvent.contextMenu(screen.getByRole('tab', { name: /b\.md/ }));
    const item = screen.getByTestId('file-tab-menu-reveal');
    expect(item).toBeTruthy();
    fireEvent.click(item);
    expect(props.onMenuAction).toHaveBeenCalledWith('reveal', 'b.md');
  });

  it('v3 a11y：容器 role=tablist、tab aria-controls 指向面板 id、非活动 tab 出 tabindex 序', () => {
    renderStrip();
    const strip = screen.getByTestId('file-tab-strip');
    expect(strip.getAttribute('role')).toBe('tablist');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.every((t) => !!t.getAttribute('aria-controls'))).toBe(true);
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
  });

  it('v3 a11y：ArrowRight 激活并移焦下一 tab（roving）', () => {
    const { props } = renderStrip();
    const tabA = screen.getByRole('tab', { name: /a\.txt/ });
    tabA.focus();
    fireEvent.keyDown(tabA, { key: 'ArrowRight' });
    expect(props.onActivate).toHaveBeenCalledWith(B);
    expect(document.activeElement?.getAttribute('data-file-tab-path')).toBe('b.md');
  });

  it('v3 双击 tab 触发关闭请求（走脏确认链）', () => {
    const { props } = renderStrip();
    fireEvent.dblClick(screen.getByRole('tab', { name: /c\.json/ }));
    expect(props.onRequestClose).toHaveBeenCalledWith('c.json');
  });

  it('v3 菜单：canReopen 时显示「重新打开已关闭的标签页」并回调；默认不显示', () => {
    const { props } = renderStrip();
    fireEvent.contextMenu(screen.getByRole('tab', { name: /a\.txt/ }));
    expect(screen.queryByTestId('file-tab-menu-reopen')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    cleanup();
    const second = renderStrip({ canReopen: true });
    fireEvent.contextMenu(screen.getByRole('tab', { name: /a\.txt/ }));
    fireEvent.click(screen.getByTestId('file-tab-menu-reopen'));
    expect(second.props.onMenuAction).toHaveBeenCalledWith('reopen', 'a.txt');
    void props;
  });

  it('激活 tab 变化时滚入视野（scrollIntoView 被调用）', () => {
    const { view } = renderStrip();
    const tabC = screen.getByRole('tab', { name: /c\.json/ });
    const scrollSpy = vi.fn();
    tabC.scrollIntoView = scrollSpy;
    view.rerender(
      <WorkspaceFileTabStrip
        files={[A, B, C]}
        activePath="c.json"
        dirtyPaths={{}}
        onActivate={vi.fn()}
        onRequestClose={vi.fn()}
        onMenuAction={vi.fn()}
        onReorder={vi.fn()}
      />,
    );
    expect(scrollSpy).toHaveBeenCalled();
  });
});
