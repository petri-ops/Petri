// ============================================================
// RouteErrorBoundary — 路由级 / 应用级错误边界（健壮性兜底，单一实现）
//
// 此前全仓零错误边界：任何路由页渲染抛异常（如结果页渲染插件产出的
// 异形数据）都会让整个 React 树卸载 → 整窗白屏，只能重启应用。
// `surface="route"`（默认）包住 App.tsx 的两棵路由树，捕获路由渲染期
// 异常；页面骨架（标题栏/侧栏）在边界之外，异常时不被波及。
// `surface="app"`（BLOCK-261 K1）包在整棵树外层，兜住壳层与 Provider
// 链自身抛出的异常——嵌套时内层边界先兜，两级只有一处恢复 UI 实现。
// ============================================================

import React from 'react';
import styles from './RouteErrorBoundary.module.css';
import button from '@/components/ui/controls/button.module.css';

interface Props {
  children: React.ReactNode;
  /** 边界所在层级：route=路由树（默认），app=整棵树外层。 */
  surface?: 'route' | 'app';
}

interface State {
  error: Error | null;
}

const COPY = {
  route: {
    title: '页面出错了',
    message: '这个页面渲染时发生异常，其余部分不受影响。可以重新加载本页，或回到主页继续。',
  },
  app: {
    title: '应用出错了',
    message: '外壳渲染时发生异常，界面已停在安全位置。重新加载可恢复；返回主页会重建整个界面。',
  },
} as const;

export class RouteErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // 保留 devtools 可见性：边界兜底 UI 不吞掉诊断信息
    console.error(`[RouteErrorBoundary:${this.props.surface ?? 'route'}] 渲染异常:`, error, info.componentStack);
  }

  private readonly handleReload = (): void => {
    window.location.reload();
  };

  private readonly handleGoHome = (): void => {
    // 整页跳转回根路由：彻底重建 React 树，不携带异常态
    window.location.assign('/');
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const surface = this.props.surface ?? 'route';
    const copy = surface === 'app' ? COPY.app : COPY.route;
    return (
      <div className={styles.wrap} role="alert" data-testid={`error-boundary-${surface}`}>
        <div className={styles.card}>
          <div className={styles.title}>{copy.title}</div>
          <div className={styles.message}>
            {copy.message}
          </div>
          {error.message ? (
            <pre className={styles.detail}>{error.message}</pre>
          ) : null}
          <div className={styles.actions}>
            <button type="button" className={button.primary} onClick={this.handleReload}>
              重新加载
            </button>
            <button type="button" className={button.ghost} onClick={this.handleGoHome}>
              返回主页
            </button>
          </div>
        </div>
      </div>
    );
  }
}
