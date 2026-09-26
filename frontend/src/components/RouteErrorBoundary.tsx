// ============================================================
// RouteErrorBoundary — 路由级错误边界（健壮性兜底）
//
// 此前全仓零错误边界：任何路由页渲染抛异常（如结果页渲染插件产出的
// 异形数据）都会让整个 React 树卸载 → 整窗白屏，只能重启应用。
// 本边界包住 App.tsx 的两棵路由树（主窗 /window 独立窗），捕获路由
// 渲染期异常并给出可恢复形态：错误摘要 + 重新加载 / 返回主页。
// 页面骨架（标题栏/侧栏）在边界之外，异常时不被波及。
// ============================================================

import React from 'react';
import styles from './RouteErrorBoundary.module.css';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class RouteErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // 保留 devtools 可见性：边界兜底 UI 不吞掉诊断信息
    console.error('[RouteErrorBoundary] 路由渲染异常:', error, info.componentStack);
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
    return (
      <div className={styles.wrap} role="alert">
        <div className={styles.card}>
          <div className={styles.title}>页面出错了</div>
          <div className={styles.message}>
            这个页面渲染时发生异常，其余部分不受影响。可以重新加载本页，或回到主页继续。
          </div>
          {error.message ? (
            <pre className={styles.detail}>{error.message}</pre>
          ) : null}
          <div className={styles.actions}>
            <button type="button" className={styles.primaryBtn} onClick={this.handleReload}>
              重新加载
            </button>
            <button type="button" className={styles.secondaryBtn} onClick={this.handleGoHome}>
              返回主页
            </button>
          </div>
        </div>
      </div>
    );
  }
}
