import React from 'react';
import styles from './VideoResultViewer.module.css';

/** 前端侧加载预算：成果面是「看一眼」的场合，不是视频编辑器。超限如实拒绝并给原文件出口。 */
const MAX_VIDEO_PREVIEW_BYTES = 64 * 1024 * 1024;

type ViewerState = {
  url: string;
  status: 'loading' | 'ready' | 'failed';
  reason: string | null;
  meta: string | null;
  /** 实际喂给 <video> 的 blob: 源（null=字节还没取回）。 */
  href: string | null;
};

const initialState = (url: string): ViewerState => ({ url, status: 'loading', reason: null, meta: null, href: null });

function formatDuration(value: number): string | null {
  // 流式媒体会把 duration 报成 Infinity/NaN：读不出就不显示，不写「0 秒」也不猜。
  if (!Number.isFinite(value) || value <= 0) return null;
  return `${value.toFixed(2)}s`;
}

/**
 * BLOCK-322 P2-05 — 结果面视频 viewer（转盘/序列动画产物）。
 *
 * 为什么走 fetch→blob 而不是把后端 URL 直接塞进 `<video src>`：实测 Chromium 会
 * 以 `MEDIA_ELEMENT_ERROR: Media load rejected by URL safety check` 拒绝**跨源**媒体加载
 * （页面在 :3000，产物读面在 :3001），而图片/模型预览走的是 fetch（connect-src 已放行）
 * 因此从未暴露这条限制。取回字节后自建 blob: 源，与 GLB/STL/OBJ 预览同一形态，
 * 也顺带得到「有界加载」的 enforcement 点（上限之上直接拒绝，不把 200MB 塞进渲染进程内存）。
 *
 * 三态如实：读取中 / 解出来了（显示时长与真实分辨率）/ 失败（写明是取字节失败还是解码失败）。
 * 不自动播放——打开成果面不等于替用户决定开始看视频。
 */
export function VideoResultViewer({ url, name }: { url: string; name: string }) {
  // BLOCK-250 同类纪律：换产物时的重置在 render 期派生，不在 effect 里同步 setState。
  const [state, setState] = React.useState<ViewerState>(() => initialState(url));
  if (state.url !== url) {
    setState(initialState(url));
  }
  const current = state.url === url ? state : initialState(url);

  React.useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          if (!cancelled) {
            setState((prev) => (prev.url !== url ? prev : {
              url, status: 'failed', reason: `产物读取失败：HTTP ${response.status}`, meta: null, href: null,
            }));
          }
          return;
        }
        const declared = Number(response.headers.get('content-length') || 0);
        if (declared > MAX_VIDEO_PREVIEW_BYTES) {
          if (!cancelled) {
            setState({
              url,
              status: 'failed',
              reason: `视频 ${(declared / 1024 / 1024).toFixed(1)}MB 超过结果面内嵌播放上限 ${MAX_VIDEO_PREVIEW_BYTES / 1024 / 1024}MB，请用原文件出口打开。`,
              meta: null,
              href: null,
            });
          }
          return;
        }
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > MAX_VIDEO_PREVIEW_BYTES) {
          if (!cancelled) {
            setState({
              url,
              status: 'failed',
              reason: `视频 ${Math.round(buffer.byteLength / 1024 / 1024)}MB 超过结果面内嵌播放上限，请用原文件出口打开。`,
              meta: null,
              href: null,
            });
          }
          return;
        }
        const type = response.headers.get('content-type') || 'video/mp4';
        objectUrl = URL.createObjectURL(new Blob([buffer], { type }));
        if (cancelled) return;
        setState((prev) => (prev.url !== url ? prev : { ...prev, status: 'loading', href: objectUrl, reason: null }));
      } catch (error) {
        if (cancelled) return;
        setState({
          url,
          status: 'failed',
          reason: `视频字节读取失败（${error instanceof Error ? error.message : '未知原因'}）；可打开原文件。`,
          meta: null,
          href: null,
        });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return (
    <div className={styles.viewer} data-testid="video-result-viewer">
      {current.href ? (
        <video
          className={styles.frame}
          src={current.href}
          controls
          playsInline
          preload="metadata"
          aria-label={name}
          data-testid="video-result-element"
          onLoadedMetadata={(event) => {
            const element = event.currentTarget;
            const duration = formatDuration(element.duration);
            const geometry = element.videoWidth > 0 && element.videoHeight > 0 ? `${element.videoWidth}×${element.videoHeight}` : null;
            setState((prev) => (prev.url !== url ? prev : {
              ...prev,
              status: 'ready',
              reason: null,
              meta: [duration ? `时长 ${duration}` : null, geometry].filter(Boolean).join(' · ') || null,
            }));
          }}
          onError={() => setState((prev) => (prev.url !== url ? prev : {
            ...prev,
            status: 'failed',
            reason: '字节已取回但当前环境无法解码该视频（编解码支持在浏览器侧判定）。',
            meta: null,
          }))}
        />
      ) : null}
      {current.status === 'loading' ? (
        <div className={styles.note} data-testid="video-result-viewer-state">读取视频字节中…（未自动播放）</div>
      ) : null}
      {current.status === 'failed' ? (
        <div className={styles.fallback} data-testid="video-result-viewer-state">
          <strong>视频预览不可用</strong>
          <span>{current.reason}</span>
          <a href={url} target="_blank" rel="noreferrer">打开或下载原文件</a>
        </div>
      ) : null}
      <div className={styles.metaRow}>
        <span className={styles.name} title={name}>{name}</span>
        {current.meta ? <span className={styles.stats}>{current.meta}</span> : null}
        <span className={styles.hint}>序列帧与 mp4 由 Blender 内置 ffmpeg 产出；帧清单见导出报告的 frameAssets</span>
      </div>
    </div>
  );
}

export default VideoResultViewer;
