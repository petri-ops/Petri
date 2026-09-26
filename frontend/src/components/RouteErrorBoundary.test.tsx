import { render, screen, cleanup } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { RouteErrorBoundary } from './RouteErrorBoundary';

/**
 * 路由级错误边界契约：此前全仓零错误边界，任何路由页渲染异常=整窗白屏。
 * 本边界兜底后：抛错子树 → 回退 UI（标题/说明/错误摘要/双动作钮）；无错 → 透明渲染子树。
 */

function Bomb({ message }: { message: string }): React.ReactElement {
  throw new Error(message);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RouteErrorBoundary', () => {
  it('无异常时透明渲染子树', () => {
    render(
      <RouteErrorBoundary>
        <div>正常内容</div>
      </RouteErrorBoundary>,
    );
    expect(screen.getByText('正常内容')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('子树渲染抛错 → 回退 UI（不渲染子树，给出错误摘要与双动作）', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <RouteErrorBoundary>
        <Bomb message="爆点：异形结果数据" />
      </RouteErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('页面出错了')).toBeTruthy();
    expect(screen.getByText(/渲染时发生异常/)).toBeTruthy();
    expect(screen.getByText('爆点：异形结果数据')).toBeTruthy();
    expect(screen.getByText('重新加载')).toBeTruthy();
    expect(screen.getByText('返回主页')).toBeTruthy();
    // 抛错子树不渲染
    expect(screen.queryByText(/正常内容/)).toBeNull();
    // 边界兜底不吞诊断信息（console.error 保留 devtools 可见性）
    expect(errSpy).toHaveBeenCalled();
  });

  it('错误态持续：rerender 好子树不自动复位（恢复语义=重新加载/返回主页整页重建）', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(
      <RouteErrorBoundary>
        <Bomb message="第一次炸" />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText('页面出错了')).toBeTruthy();
    rerender(
      <RouteErrorBoundary>
        <div>换回正常内容</div>
      </RouteErrorBoundary>,
    );
    // 边界 state 不因 props 变化复位——回退 UI 持续在场，恢复走两个动作钮
    expect(screen.getByText('页面出错了')).toBeTruthy();
    expect(screen.queryByText('换回正常内容')).toBeNull();
  });
});
