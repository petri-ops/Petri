/**
 * SegmentBoundary — 段落级错误边界（BLOCK-222 / Q9 垂直切片）。
 *
 * 为什么不是「再来一个路由边界」：路由边界（`RouteErrorBoundary`）只能兜住**整页**，
 * 一次渲染异常会把整个页面换成错误卡——结果面预览崩了，结论区、truth 面、上下文条全没了。
 * 段落边界把兜底粒度降到「一段 UI」：预览段崩 → 只有预览段变成可恢复卡片，其余照常。
 *
 * 契约：
 * - `segment`：段落标识，进 `data-segment`（便于实机定位是哪一段崩的）；
 * - `resetKey`：变化即自动清除错误（例如切到另一个产物/文件）——否则用户换个文件还看旧错误；
 * - `onError`：上报钩子（默认只 console.error，不吞诊断）；
 * - 重试：清错误重渲染子树（父层 key 不变，React 会重建子树）；
 * - 诊断复制：`navigator.clipboard` 不可用/被拒时如实显示「复制失败」，不假装成功。
 */

import React from 'react';
import styles from './SegmentBoundary.module.css';
import button from '@/components/ui/controls/button.module.css';

/** 已知段落的兜底文案（单源）：挂载点只传 segment，避免同一段文案多处漂移。 */
const SEGMENT_COPY: Record<string, { title: string; description: string }> = {
  'result-preview': {
    title: '预览没能渲染出来',
    description: '产物记录与结论仍在，只是这一段预览出错。可以重试，或沿原路径打开文件。',
  },
  'workspace-preview': {
    title: '预览没能渲染出来',
    description: '文件仍在磁盘上，只是这一段预览出错。可以重试，或用系统应用打开。',
  },
};

export interface SegmentBoundaryProps {
  segment: string;
  children: React.ReactNode;
  title?: string;
  description?: string;
  onError?: (error: Error, info: React.ErrorInfo) => void;
  resetKey?: unknown;
}

interface SegmentBoundaryState {
  error: Error | null;
  copyState: 'idle' | 'copied' | 'failed';
}

export class SegmentBoundary extends React.Component<SegmentBoundaryProps, SegmentBoundaryState> {
  state: SegmentBoundaryState = { error: null, copyState: 'idle' };

  static getDerivedStateFromError(error: Error): Partial<SegmentBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // 兜底 UI 不吞诊断：控制台保留原始错误与组件栈
    console.error(`[SegmentBoundary:${this.props.segment}] 段落渲染异常:`, error, info.componentStack);
    if (this.props.onError) {
      try {
        this.props.onError(error, info);
      } catch {
        // 上报器自身抛错不得反过来炸边界
      }
    }
  }

  componentDidUpdate(prev: SegmentBoundaryProps): void {
    if (!this.state.error) return;
    if (prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null, copyState: 'idle' });
    }
  }

  private readonly handleRetry = (): void => {
    this.setState({ error: null, copyState: 'idle' });
  };

  private readonly handleCopy = (): void => {
    const { error } = this.state;
    const detail = [
      `segment=${this.props.segment}`,
      `message=${error ? error.message : ''}`,
      error && error.stack ? error.stack : '',
    ].join('\n');
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      this.setState({ copyState: 'failed' });
      return;
    }
    void clipboard.writeText(detail).then(
      () => this.setState({ copyState: 'copied' }),
      () => this.setState({ copyState: 'failed' }),
    );
  };

  render(): React.ReactNode {
    const { error, copyState } = this.state;
    if (!error) return this.props.children;
    const copy = SEGMENT_COPY[this.props.segment];
    const title = this.props.title || (copy ? copy.title : '这一段没能渲染出来');
    const description =
      this.props.description || (copy ? copy.description : '只是这一段出错，其余内容不受影响。可以重试。');
    return (
      <div className={styles.wrap} role="alert" data-segment={this.props.segment} data-segment-crashed="true">
        <div className={styles.title}>{title}</div>
        <div className={styles.message}>{description}</div>
        {error.message ? <pre className={styles.detail}>{error.message}</pre> : null}
        <div className={styles.actions}>
          <button type="button" className={button.primary} onClick={this.handleRetry}>
            重试这一段
          </button>
          <button type="button" className={button.ghost} onClick={this.handleCopy}>
            复制诊断
          </button>
          {copyState === 'copied' ? <span className={styles.hint}>已复制</span> : null}
          {copyState === 'failed' ? <span className={styles.hint}>复制失败</span> : null}
        </div>
      </div>
    );
  }
}
