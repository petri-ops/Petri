import React, { useState, useCallback, useEffect, useRef } from 'react';
import { figThemes, layoutThemes, applyBothThemes, getRecommendedParams } from '@/pages/_themes';

// 桌面版无 Docusaurus baseUrl，useBaseUrl 直接返回原路径
function useBaseUrl(path: string): string {
  return path;
}

interface RunModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  initialCode: string;
  cardId?: string;
  subtitle?: string;
  slogan?: string;
  /** Code language: 'r' (default) or 'python' */
  language?: 'r' | 'python';
  /** Card layout class (compact / default / complex / wide) — drives content-aware
   * defaults when user switches layout theme. */
  figLayout?: 'compact' | 'default' | 'complex' | 'wide';
  /** When set, uses persistent R session (/api/replot/run) instead of /api/run */
  replotTaskId?: string;
  /** Called when a new image is generated — receives the image URL */
  onImageReady?: (imageUrl: string) => void;
  /** When provided, shows a "保存到结果" button after image is generated */
  onSaveToResult?: (imageUrl: string, code: string) => Promise<void>;
  /** Initial image URL to display before user runs code (e.g., from analysis results) */
  initialImage?: string;
  /** Packages required by this card — used for desktop package check */
  packages?: string[];
}

const R_SERVER_TOKEN = 'biof3-figcode-2026';

// R Server 统一地址：本地开发和线上都连同一个远程 R Server
const R_SERVER_BASE = 'http://biof3.com:3001';
const PY_SERVER_BASE = 'http://biof3.com:3002';

function getApiPrefix(language: 'r' | 'python' = 'r'): string {
  if (typeof window === 'undefined') {
    return language === 'python' ? `${PY_SERVER_BASE}/api` : `${R_SERVER_BASE}/api`;
  }
  const host = window.location.hostname;
  // 线上走 nginx 反代（同域，避免 CORS）
  if (host !== 'localhost' && host !== '127.0.0.1') {
    return window.location.origin + (language === 'python' ? '/api/py' : '/api/r');
  }
  // 本地开发直连远程 Server
  return language === 'python' ? `${PY_SERVER_BASE}/api` : `${R_SERVER_BASE}/api`;
}

/**
 * Inject plot size and base_size params directly into R code so user can see them.
 * For Python code, returns the code unchanged (Python handles its own params).
 */
function injectParams(
  code: string,
  w: number,
  h: number,
  sz: number,
  dpi: number,
  ptSize: number,
  lw: number,
  alpha: number,
  legendPos: string,
  facetSize: number,
  facetBorder: boolean,
  facetBg: string,
  lang: 'r' | 'python' = 'r'
): string {
  // Python code: skip R-specific parameter injection
  if (lang === 'python') return code;

  // Strip any previous param injection
  let c = code.replace(/^# \[Plot:.*\]\n/m, '');
  c = c.replace(/^options\(device\s*=\s*function.*\n/m, '');

  // Inject base_size into theme calls
  c = c.replace(
    /theme_(classic|bw|minimal|light|dark|gray|void)\s*\(\s*\)/g,
    `theme_$1(base_size = ${sz})`
  );
  c = c.replace(
    /theme_(classic|bw|minimal|light|dark|gray|void)\s*\(\s*base_size\s*=\s*\d+/g,
    `theme_$1(base_size = ${sz}`
  );

  // Inject point size
  c = c.replace(/geom_point\(([^)]*?)size\s*=\s*[\d.]+/g, `geom_point($1size = ${ptSize}`);

  // Inject line width
  c = c.replace(
    /geom_line\(([^)]*?)(?:linewidth|size)\s*=\s*[\d.]+/g,
    `geom_line($1linewidth = ${lw}`
  );

  // Inject alpha
  c = c.replace(/geom_point\(([^)]*?)alpha\s*=\s*[\d.]+/g, `geom_point($1alpha = ${alpha}`);

  // Inject legend position
  if (legendPos !== 'right') {
    // Replace existing legend.position in theme() calls
    if (/legend\.position/.test(c)) {
      c = c.replace(/legend\.position\s*=\s*"[^"]+"/g, `legend.position = "${legendPos}"`);
    }
  }

  // Inject facet title size
  if (facetSize !== 10) {
    if (/strip\.text/.test(c)) {
      c = c.replace(
        /strip\.text\s*=\s*element_text\([^)]*\)/g,
        `strip.text = element_text(size = ${facetSize}, face = "bold")`
      );
    }
  }

  // Inject facet strip background and border
  const stripBgVal =
    facetBg === 'none'
      ? 'ggplot2::element_blank()'
      : `ggplot2::element_rect(fill = "${facetBg}", color = ${facetBorder ? '"#999999"' : 'NA'})`;
  const facetThemeLine = `ggplot2::theme(strip.text = ggplot2::element_text(size = ${facetSize}, face = "bold"), strip.background = ${stripBgVal})`;

  // Prepend device options + marker
  const header = `# [Plot: ${w}x${h} @${dpi}dpi | font ${sz}pt | point ${ptSize} | line ${lw} | alpha ${alpha} | legend ${legendPos} | facet ${facetSize}pt]\noptions(device = function(...) png(file.path(getwd(), sprintf("plot_%03d.png", length(list.files(pattern="plot_.*\\\\\\\\.png")) + 1)), width = ${w}, height = ${h}, res = ${dpi}, ...))\n.biof3_facet_theme <- ${facetThemeLine}\n`;

  // If code has facet_wrap or facet_grid, append the facet theme
  if (/facet_(wrap|grid)/.test(c)) {
    // Append + .biof3_facet_theme at the end of the last ggplot expression
    c = c.replace(
      /(theme_(?:classic|bw|minimal|light|dark|gray|void)\s*\([^)]*\))/g,
      '$1 + .biof3_facet_theme'
    );
  }

  return header + c;
}

export default function RunModal({
  isOpen,
  onClose,
  title,
  initialCode,
  cardId,
  slogan,
  language = 'r',
  figLayout = 'default',
  replotTaskId,
  onImageReady,
  onSaveToResult,
  initialImage,
  packages,
}: RunModalProps) {
  const [code, setCode] = useState(initialCode);
  const [output, setOutput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [_elapsed, setElapsed] = useState<number | null>(null);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; path: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [themeId, setThemeId] = useState<string>('default');
  const [layoutId, setLayoutId] = useState<string>('classic');
  const [plotWidth, setPlotWidth] = useState(800);
  const [plotHeight, setPlotHeight] = useState(600);
  const [baseSize, setBaseSize] = useState(11);
  const [dpi, setDpi] = useState(300);
  const [pointSize, setPointSize] = useState(1.5);
  const [lineWidth, setLineWidth] = useState(0.6);
  const [alpha, setAlpha] = useState(0.7);
  const [legendPos, setLegendPos] = useState<string>('right');
  const [facetTitleSize, setFacetTitleSize] = useState(10);
  const [facetBorder, setFacetBorder] = useState(true);
  const [facetBg, setFacetBg] = useState('#f3f4f6');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [showDataPreview, setShowDataPreview] = useState(false);
  const [dataPreview, setDataPreview] = useState<string>('');
  const modalRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoRunRef = useRef(false);
  const codeRef = useRef(initialCode);

  // URL helpers — must be at top level before any callbacks
  const _scriptHref = useBaseUrl(cardId ? `/figcode/scripts/${cardId}.R` : '');
  const dataHref = useBaseUrl(cardId ? `/figcode/data/${cardId}.csv` : '');
  const _docHtmlHref = useBaseUrl(cardId ? `/exports/figcode/${cardId}/index.html` : '');
  const _docPdfHref = useBaseUrl(cardId ? `/exports/figcode/${cardId}/article.pdf` : '');

  // Reset when modal opens with new code
  useEffect(() => {
    if (isOpen) {
      setCode(initialCode);
      setOutput('');
      setImages(initialImage ? [initialImage] : []);
      setElapsed(null);
      setUploadedFile(null);
      setLightboxSrc(null);
      setThemeId('default');
      setLayoutId('classic');
      setPlotWidth(800);
      setPlotHeight(600);
      setBaseSize(11);
      setDpi(300);
      setPointSize(1.5);
      setLineWidth(0.6);
      setAlpha(0.7);
      setLegendPos('right');
      setFacetTitleSize(10);
      setFacetBorder(true);
      setFacetBg('#f3f4f6');
      autoRunRef.current = true; // auto-run on open
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialCode, cardId]);

  // Apply combined theme + layout and auto-run
  const handleThemeChange = useCallback(
    (newThemeId: string) => {
      setThemeId(newThemeId);
      const newCode = applyBothThemes(initialCode, newThemeId, layoutId);
      setCode(
        injectParams(
          newCode,
          plotWidth,
          plotHeight,
          baseSize,
          dpi,
          pointSize,
          lineWidth,
          alpha,
          legendPos,
          facetTitleSize,
          facetBorder,
          facetBg,
          language
        )
      );
      autoRunRef.current = true;
    },
    [
      initialCode,
      layoutId,
      plotWidth,
      plotHeight,
      baseSize,
      dpi,
      pointSize,
      lineWidth,
      alpha,
      legendPos,
      facetTitleSize,
      facetBorder,
      facetBg,
      language,
    ]
  );

  const handleLayoutChange = useCallback(
    (newLayoutId: string) => {
      setLayoutId(newLayoutId);
      // Apply recommended params for this layout × figLayout combo. This makes
      // "presentation" / "publication" actually scale font + point + canvas
      // together (instead of just font, leaving points tiny on a now-bigger canvas).
      const rec = getRecommendedParams(newLayoutId, figLayout);
      setBaseSize(rec.baseSize);
      setPointSize(rec.pointSize);
      setLineWidth(rec.lineWidth);
      setPlotWidth(rec.plotWidth);
      setPlotHeight(rec.plotHeight);
      const newCode = applyBothThemes(initialCode, themeId, newLayoutId);
      setCode(
        injectParams(
          newCode,
          rec.plotWidth,
          rec.plotHeight,
          rec.baseSize,
          dpi,
          rec.pointSize,
          rec.lineWidth,
          alpha,
          legendPos,
          facetTitleSize,
          facetBorder,
          facetBg,
          language
        )
      );
      autoRunRef.current = true;
    },
    [
      initialCode,
      themeId,
      figLayout,
      dpi,
      alpha,
      legendPos,
      facetTitleSize,
      facetBorder,
      facetBg,
      language,
    ]
  );

  // Sync plot params into code and auto-run
  const handleParamChange = useCallback(
    (
      w: number,
      h: number,
      sz: number,
      d: number,
      pt: number,
      lw: number,
      a: number,
      lp: string,
      fs: number,
      fb: boolean,
      fbg: string
    ) => {
      setPlotWidth(w);
      setPlotHeight(h);
      setBaseSize(sz);
      setDpi(d);
      setPointSize(pt);
      setLineWidth(lw);
      setAlpha(a);
      setLegendPos(lp);
      setFacetTitleSize(fs);
      setFacetBorder(fb);
      setFacetBg(fbg);
      const base = applyBothThemes(initialCode, themeId, layoutId);
      setCode(injectParams(base, w, h, sz, d, pt, lw, a, lp, fs, fb, fbg, language));
      autoRunRef.current = true;
    },
    [initialCode, themeId, layoutId, language]
  );

  // Copy code to clipboard
  const handleCopyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch (err: any) {
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1200);
  }, [code]);

  // Fetch and show data preview
  const handleShowData = useCallback(async () => {
    if (!dataPreview) {
      try {
        const resp = await fetch(dataHref);
        const text = await resp.text();
        setDataPreview(text.split('\n').slice(0, 20).join('\n'));
      } catch (err: any) {
        setDataPreview('gene,value\nError,无法加载');
      }
    }
    setShowDataPreview(true);
  }, [dataHref, dataPreview]);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(() => {
    if (!isFullscreen) {
      modalRef.current?.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  }, [isFullscreen]);

  // Listen for fullscreen exit (e.g. user presses Esc in fullscreen)
  useEffect(() => {
    const handler = () => {
      if (!document.fullscreenElement) setIsFullscreen(false);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Close on Escape (lightbox first, then modal)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightboxSrc) setLightboxSrc(null);
        else if (isOpen) onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose, lightboxSrc]);

  // 桌面端抽屉式不锁滚动（SPA 恒为桌面版，原 web 锁滚动逻辑已移除）
  useEffect(() => {
    if (!isOpen) return;
  }, [isOpen]);

  // FIGCODE_ACT_v1: listen for AI-driven code replacement events
  useEffect(() => {
    if (!isOpen) return;
    const onReplace = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const newCode = detail.code;
      const autoRun = detail.autoRun !== false;
      if (typeof newCode !== 'string' || newCode.length < 5) return;
      // Inject params + apply
      const injected = injectParams(
        newCode,
        plotWidth,
        plotHeight,
        baseSize,
        dpi,
        pointSize,
        lineWidth,
        alpha,
        legendPos,
        facetTitleSize,
        facetBorder,
        facetBg,
        language
      );
      setCode(injected);
      codeRef.current = injected;
      if (!autoRun) return;
      // Wait for state propagation, then run via the latest runCode ref.
      // If a previous run is still in flight, retry a few times.
      let attempts = 0;
      const tryRun = () => {
        attempts++;
        const fn = runCodeRef.current;
        if (!fn) return;
        // If still running and we haven't retried much, wait a bit more
        if (attempts < 30) {
          // Caller-provided code is the new injected version; pass it explicitly so
          // runCode doesn't depend on state (still subject to its `running` guard).
          fn(injected);
          // We can't directly inspect whether it actually started; simplest: trust that runCode
          // will ignore if running, and we retry only if the act actually never set running=true.
        }
      };
      setTimeout(tryRun, 120);
    };
    window.addEventListener('biof3:figcode-replace-code', onReplace as EventListener);
    return () =>
      window.removeEventListener('biof3:figcode-replace-code', onReplace as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isOpen,
    plotWidth,
    plotHeight,
    baseSize,
    dpi,
    pointSize,
    lineWidth,
    alpha,
    legendPos,
    facetTitleSize,
    facetBorder,
    facetBg,
  ]);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const isLocal =
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

      if (isLocal) {
        // Local dev: upload directly to R Server
        const formData = new FormData();
        formData.append('file', file);
        const resp = await fetch('http://localhost:3001/api/upload', {
          method: 'POST',
          headers: { 'X-API-Token': R_SERVER_TOKEN },
          body: formData,
        });
        const data = await resp.json();
        if (data.status === 'ok') {
          setUploadedFile({ name: data.originalName, path: data.filePath });
          setCode((prev) => {
            const hint = `# 已上传文件: ${data.originalName}\n# 读取方式: df <- read.csv("${data.filePath}")\n\n`;
            if (prev.startsWith('# 已上传文件:')) {
              const lines = prev.split('\n');
              const startIdx = lines.findIndex((l) => !l.startsWith('#') && l.trim() !== '');
              return hint + lines.slice(startIdx).join('\n');
            }
            return hint + prev;
          });
        } else {
          setOutput(`上传失败: ${data.error}`);
        }
      } else {
        // Production: upload to OSS via signed URL
        const signResp = await fetch('/api/platform/oss/sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, contentType: file.type || 'text/csv' }),
        });
        const signData = await signResp.json();
        if (!signData.uploadUrl) throw new Error(signData.error || '获取签名失败');

        // Direct upload to OSS (fast)
        const uploadResp = await fetch(signData.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'text/csv' },
          body: file,
        });
        if (!uploadResp.ok) throw new Error(`上传 OSS 失败: ${uploadResp.status}`);

        // R Server reads from OSS URL
        const ossUrl = signData.fileUrl;
        setUploadedFile({ name: file.name, path: ossUrl });
        setCode((prev) => {
          const hint = `# 已上传文件: ${file.name}\n# 读取方式: df <- read.csv("${ossUrl}")\n\n`;
          if (prev.startsWith('# 已上传文件:')) {
            const lines = prev.split('\n');
            const startIdx = lines.findIndex((l) => !l.startsWith('#') && l.trim() !== '');
            return hint + lines.slice(startIdx).join('\n');
          }
          return hint + prev;
        });
      }
    } catch (err: any) {
      setOutput(`上传失败: ${err.message}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, []);

  const runCode = useCallback(
    async (codeToRun?: string) => {
      const execCode = codeToRun ?? codeRef.current;
      if (!execCode || runningRef.current) return;

      // Desktop: check required packages before running
      if (
        typeof window !== 'undefined' &&
        window.biof3Desktop?.figcode &&
        packages &&
        packages.length > 0
      ) {
        try {
          const result = await window.biof3Desktop.figcode.checkPackages(
            language,
            packages,
            cardId
          );
          if (result.ok && !result.cardInstalled) {
            const pluginNames = (result.missingPlugins || [])
              .map((p: any) => `「${p.title}」`)
              .join('、');
            const pkgList = result.missing.join(', ');
            setOutput(
              `⚠️ 此卡片需要安装插件才能运行\n\n` +
                (pkgList ? `缺少依赖包: ${pkgList}\n\n` : '') +
                (pluginNames ? `需要安装: ${pluginNames}\n\n` : '') +
                `请打开「设置 → 插件商店」安装对应插件后重试。`
            );
            return;
          }
        } catch {
          // check failed — proceed anyway (let server-side error surface)
        }
      }

      runningRef.current = true;
      setRunning(true);
      setOutput('');
      setImages([]);
      const start = Date.now();

      // Replot mode — persistent R session, much faster
      if (replotTaskId) {
        try {
          const resp = await fetch(getApiPrefix() + '/replot/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-Token': R_SERVER_TOKEN },
            body: JSON.stringify({ taskId: replotTaskId, code: execCode }),
          });
          const data = await resp.json();
          setElapsed(Date.now() - start);

          // plumber wraps scalar fields in arrays
          const status = Array.isArray(data.status) ? data.status[0] : data.status;
          const errMsg = Array.isArray(data.error) ? data.error[0] : data.error;
          const image = Array.isArray(data.image) ? data.image[0] : data.image;

          if (status === 'ok' && image) {
            setOutput(`✓ 绘图完成（耗时 ${((Date.now() - start) / 1000).toFixed(1)}s）`);
            setImages([image]);
            if (onImageReady) onImageReady(image);
          } else {
            setOutput(`Error: ${errMsg || '绘图失败'}`);
          }
        } catch (e: unknown) {
          setOutput(`连接 R 服务失败: ${e instanceof Error ? e.message : String(e)}`);
          setElapsed(Date.now() - start);
        } finally {
          runningRef.current = false;
          setRunning(false);
        }
        return;
      }

      // Legacy mode — full R script execution
      try {
        const apiUrl = getApiPrefix(language) + '/run';
        const resp = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Token': R_SERVER_TOKEN },
          body: JSON.stringify({ code: execCode }),
        });
        const data = await resp.json();
        setElapsed(Date.now() - start);

        if (data.status === 'success') {
          setOutput(data.stdout + (data.stderr ? '\n' + data.stderr : ''));
        } else {
          setOutput(`Error: ${data.error}\n${data.stdout || ''}`);
        }
        if (data.images?.length > 0) {
          setImages(data.images);
          if (onImageReady && data.images[0]) onImageReady(data.images[0]);
        }
      } catch (err: any) {
        setOutput(
          `连接 ${language === 'python' ? 'Python' : 'R'} Server 失败: ${err instanceof Error ? err.message : String(err)}\n\n请求地址: ${getApiPrefix(language)}/run`
        );
        setElapsed(Date.now() - start);
      } finally {
        runningRef.current = false;
        setRunning(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [replotTaskId, language]
  );

  // Keep codeRef in sync
  useEffect(() => {
    codeRef.current = code;
  }, [code]);

  // FIGCODE_ACT_v1: keep a ref to the latest runCode so the listener can always call it
  const runCodeRef = useRef(runCode);
  useEffect(() => {
    runCodeRef.current = runCode;
  }, [runCode]);

  // Auto-run when theme/layout changes
  useEffect(() => {
    if (autoRunRef.current && !running) {
      autoRunRef.current = false;
      runCode(code);
    }
  }, [code, running, runCode]);

  const downloadAsPdf = useCallback((imgSrc: string, filename: string) => {
    import('jspdf').then(({ jsPDF }) => {
      const img = new Image();
      img.onload = () => {
        // A4 dimensions in mm
        const pageW = 210;
        const pageH = 297;
        const margin = 10;
        const maxW = pageW - margin * 2;
        const maxH = pageH - margin * 2;

        // Scale image to fit A4 with margins
        const imgRatio = img.width / img.height;
        let w = maxW;
        let h = w / imgRatio;
        if (h > maxH) {
          h = maxH;
          w = h * imgRatio;
        }

        const _x = (pageW - w) / 2;
        const _y = (pageH - h) / 2;

        const pdf = new jsPDF({
          orientation: imgRatio > 1.2 ? 'landscape' : 'portrait',
          unit: 'mm',
          format: 'a4',
        });
        const pW = pdf.internal.pageSize.getWidth();
        const pH = pdf.internal.pageSize.getHeight();
        const mW = pW - margin * 2;
        const mH = pH - margin * 2;
        let fw = mW;
        let fh = fw / imgRatio;
        if (fh > mH) {
          fh = mH;
          fw = fh * imgRatio;
        }
        const fx = (pW - fw) / 2;
        const fy = (pH - fh) / 2;

        pdf.addImage(imgSrc, 'PNG', fx, fy, fw, fh);
        pdf.save(filename);
      };
      img.src = imgSrc;
    });
  }, []);
  if (!isOpen) return null;

  // 桌面端：右栏抽屉式（非阻塞，点击 overlay 不关闭）
  const overlayCls = 'run-modal-overlay run-modal-overlay--desktop';
  const modalCls = 'run-modal run-modal--desktop';

  return (
    <div className={overlayCls}>
      <div className={modalCls} ref={modalRef} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="run-modal-header">
          <div className="run-modal-header-left">
            <h3>{title}</h3>
            {slogan && (
              <div className="run-modal-marquee">
                <span className="run-modal-marquee-text">{slogan}</span>
              </div>
            )}
          </div>
          <div className="run-modal-downloads">
            <button
              className="run-modal-fullscreen-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? '退出全屏' : '全屏'}
            >
              {isFullscreen ? (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="14" y1="10" x2="21" y2="3" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              ) : (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              )}
            </button>
            <button className="run-modal-close" onClick={onClose} aria-label="关闭">
              ×
            </button>
          </div>
        </div>

        {/* Body: left-right split */}
        <div className="run-modal-split">
          {/* Left: code editor */}
          <div className="run-modal-left">
            <div className="run-modal-code-toolbar">
              <button
                className="run-modal-run-btn"
                onClick={() => runCode()}
                disabled={running}
                title={`${typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl'}+Enter 也可以运行`}
              >
                {running ? (
                  <>⏳ 运行中...</>
                ) : (
                  <>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      style={{ verticalAlign: 'middle', marginRight: 4 }}
                    >
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    运行
                  </>
                )}
              </button>
              <span className="run-modal-code-hint">
                {typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl'}
                +Enter 运行
              </span>
              <button
                className={`run-modal-copy-btn ${codeCopied ? 'copied' : ''}`}
                onClick={handleCopyCode}
                title={codeCopied ? '已复制' : '复制代码'}
              >
                {codeCopied ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
            </div>
            <textarea
              className="run-modal-editor"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  runCode();
                }
              }}
              spellCheck={false}
            />
          </div>

          {/* Right: themes + actions + output */}
          <div className="run-modal-right">
            {/* Cards row: params + data side by side */}
            <div className="run-modal-cards-row">
              {/* Card 1: Parameters */}
              <div className="run-modal-card">
                <div className="run-modal-card-title">参数设置</div>
                <div className="run-modal-config">
                  <div className="run-modal-config-row">
                    <span className="run-modal-config-label">配色</span>
                    <div className="run-modal-config-chips">
                      {figThemes.map((t) => (
                        <button
                          key={t.id}
                          className={`run-modal-theme-chip ${themeId === t.id ? 'active' : ''}`}
                          onClick={() => handleThemeChange(t.id)}
                          title={`${t.journal} — ${t.description}`}
                          disabled={running}
                        >
                          {t.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="run-modal-config-row">
                    <span className="run-modal-config-label">模版</span>
                    <div className="run-modal-config-chips">
                      {layoutThemes.map((t) => (
                        <button
                          key={t.id}
                          className={`run-modal-layout-chip ${layoutId === t.id ? 'active' : ''}`}
                          onClick={() => handleLayoutChange(t.id)}
                          title={t.description}
                          disabled={running}
                        >
                          {t.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="run-modal-config-row">
                    <span className="run-modal-config-label">尺寸</span>
                    <div className="run-modal-config-params">
                      <label className="run-modal-param">
                        <input
                          type="number"
                          min={200}
                          max={2000}
                          step={50}
                          value={plotWidth}
                          onChange={(e) =>
                            handleParamChange(
                              Number(e.target.value),
                              plotHeight,
                              baseSize,
                              dpi,
                              pointSize,
                              lineWidth,
                              alpha,
                              legendPos,
                              facetTitleSize,
                              facetBorder,
                              facetBg
                            )
                          }
                        />
                        <span>×</span>
                      </label>
                      <label className="run-modal-param">
                        <input
                          type="number"
                          min={200}
                          max={2000}
                          step={50}
                          value={plotHeight}
                          onChange={(e) =>
                            handleParamChange(
                              plotWidth,
                              Number(e.target.value),
                              baseSize,
                              dpi,
                              pointSize,
                              lineWidth,
                              alpha,
                              legendPos,
                              facetTitleSize,
                              facetBorder,
                              facetBg
                            )
                          }
                        />
                        <span className="run-modal-param-unit">px</span>
                      </label>
                      <label className="run-modal-param">
                        <span className="run-modal-param-sep">DPI</span>
                        <input
                          type="number"
                          min={72}
                          max={600}
                          step={50}
                          value={dpi}
                          onChange={(e) =>
                            handleParamChange(
                              plotWidth,
                              plotHeight,
                              baseSize,
                              Number(e.target.value),
                              pointSize,
                              lineWidth,
                              alpha,
                              legendPos,
                              facetTitleSize,
                              facetBorder,
                              facetBg
                            )
                          }
                        />
                      </label>
                    </div>
                  </div>
                  <div className="run-modal-config-row">
                    <span className="run-modal-config-label">样式</span>
                    <div className="run-modal-config-params">
                      <label className="run-modal-param">
                        <span>字号</span>
                        <input
                          type="number"
                          min={6}
                          max={28}
                          step={1}
                          value={baseSize}
                          onChange={(e) =>
                            handleParamChange(
                              plotWidth,
                              plotHeight,
                              Number(e.target.value),
                              dpi,
                              pointSize,
                              lineWidth,
                              alpha,
                              legendPos,
                              facetTitleSize,
                              facetBorder,
                              facetBg
                            )
                          }
                        />
                      </label>
                      <label className="run-modal-param">
                        <span className="run-modal-param-sep">点</span>
                        <input
                          type="number"
                          min={0.2}
                          max={8}
                          step={0.2}
                          value={pointSize}
                          onChange={(e) =>
                            handleParamChange(
                              plotWidth,
                              plotHeight,
                              baseSize,
                              dpi,
                              Number(e.target.value),
                              lineWidth,
                              alpha,
                              legendPos,
                              facetTitleSize,
                              facetBorder,
                              facetBg
                            )
                          }
                        />
                      </label>
                      <label className="run-modal-param">
                        <span className="run-modal-param-sep">线</span>
                        <input
                          type="number"
                          min={0.1}
                          max={4}
                          step={0.1}
                          value={lineWidth}
                          onChange={(e) =>
                            handleParamChange(
                              plotWidth,
                              plotHeight,
                              baseSize,
                              dpi,
                              pointSize,
                              Number(e.target.value),
                              alpha,
                              legendPos,
                              facetTitleSize,
                              facetBorder,
                              facetBg
                            )
                          }
                        />
                      </label>
                      <label className="run-modal-param">
                        <span className="run-modal-param-sep">透明</span>
                        <input
                          type="number"
                          min={0.1}
                          max={1}
                          step={0.1}
                          value={alpha}
                          onChange={(e) =>
                            handleParamChange(
                              plotWidth,
                              plotHeight,
                              baseSize,
                              dpi,
                              pointSize,
                              lineWidth,
                              Number(e.target.value),
                              legendPos,
                              facetTitleSize,
                              facetBorder,
                              facetBg
                            )
                          }
                        />
                      </label>
                    </div>
                  </div>
                  <div className="run-modal-config-row">
                    <span className="run-modal-config-label">图例</span>
                    <div className="run-modal-config-chips">
                      {['right', 'bottom', 'top', 'left', 'none'].map((pos) => (
                        <button
                          key={pos}
                          className={`run-modal-layout-chip ${legendPos === pos ? 'active' : ''}`}
                          onClick={() =>
                            handleParamChange(
                              plotWidth,
                              plotHeight,
                              baseSize,
                              dpi,
                              pointSize,
                              lineWidth,
                              alpha,
                              pos,
                              facetTitleSize,
                              facetBorder,
                              facetBg
                            )
                          }
                          disabled={running}
                        >
                          {pos === 'right'
                            ? '右'
                            : pos === 'bottom'
                              ? '下'
                              : pos === 'top'
                                ? '上'
                                : pos === 'left'
                                  ? '左'
                                  : '隐藏'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="run-modal-config-row">
                    <span className="run-modal-config-label">分面</span>
                    <div className="run-modal-config-params">
                      <label className="run-modal-param">
                        <span>标题</span>
                        <input
                          type="number"
                          min={6}
                          max={18}
                          step={1}
                          value={facetTitleSize}
                          onChange={(e) =>
                            handleParamChange(
                              plotWidth,
                              plotHeight,
                              baseSize,
                              dpi,
                              pointSize,
                              lineWidth,
                              alpha,
                              legendPos,
                              Number(e.target.value),
                              facetBorder,
                              facetBg
                            )
                          }
                        />
                        <span className="run-modal-param-unit">pt</span>
                      </label>
                      <label className="run-modal-param">
                        <span className="run-modal-param-sep">边框</span>
                        <input
                          type="checkbox"
                          checked={facetBorder}
                          onChange={(e) =>
                            handleParamChange(
                              plotWidth,
                              plotHeight,
                              baseSize,
                              dpi,
                              pointSize,
                              lineWidth,
                              alpha,
                              legendPos,
                              facetTitleSize,
                              e.target.checked,
                              facetBg
                            )
                          }
                        />
                      </label>
                      <label className="run-modal-param">
                        <span className="run-modal-param-sep">背景</span>
                        <select
                          value={facetBg}
                          onChange={(e) =>
                            handleParamChange(
                              plotWidth,
                              plotHeight,
                              baseSize,
                              dpi,
                              pointSize,
                              lineWidth,
                              alpha,
                              legendPos,
                              facetTitleSize,
                              facetBorder,
                              e.target.value
                            )
                          }
                        >
                          <option value="#f3f4f6">浅灰</option>
                          <option value="#ecfdf5">浅绿</option>
                          <option value="#eff6ff">浅蓝</option>
                          <option value="#fef3c7">浅黄</option>
                          <option value="none">无</option>
                        </select>
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 2: Data & Export */}
              {cardId && (
                <div className="run-modal-card">
                  <div className="run-modal-card-section">
                    <div className="run-modal-card-title">示例数据</div>
                    <div className="run-modal-data-actions">
                      <button className="run-modal-data-btn" onClick={handleShowData}>
                        📋 预览
                      </button>
                      <a
                        className="run-modal-data-btn"
                        href={dataHref}
                        download={`${cardId}-demo.csv`}
                      >
                        ⬇ 下载
                      </a>
                    </div>
                  </div>
                  <div className="run-modal-card-section">
                    <div className="run-modal-card-title">上传数据</div>
                    <div className="run-modal-data-actions">
                      <label className="run-modal-data-btn">
                        {uploading ? '⏳' : '📁 选择文件'}
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".csv,.tsv,.txt,.rds,.rda,.xlsx"
                          onChange={handleUpload}
                          style={{ display: 'none' }}
                          disabled={uploading}
                        />
                      </label>
                      {uploadedFile && (
                        <span className="run-modal-file-tag">✓ {uploadedFile.name}</span>
                      )}
                    </div>
                  </div>
                  <div className="run-modal-card-section">
                    <div className="run-modal-card-title">图片保存</div>
                    <div className="run-modal-data-actions">
                      {images.length > 0 ? (
                        <>
                          <a
                            className="run-modal-data-btn"
                            href={images[0]}
                            download={`${cardId}.png`}
                          >
                            ⬇ PNG
                          </a>
                          <button
                            className="run-modal-data-btn"
                            onClick={() => downloadAsPdf(images[0], `${cardId}.pdf`)}
                          >
                            ⬇ PDF
                          </button>
                          {onSaveToResult && (
                            <button
                              className="run-modal-save-btn"
                              id="saveToResultBtn"
                              onClick={async (e) => {
                                const btn = e.currentTarget;
                                btn.disabled = true;
                                btn.textContent = '保存中...';
                                try {
                                  await onSaveToResult(images[0], code);
                                  btn.textContent = '✓ 已保存';
                                  btn.classList.add('saved');
                                  setTimeout(() => {
                                    btn.textContent = '保存到结果';
                                    btn.classList.remove('saved');
                                    btn.disabled = false;
                                  }, 2000);
                                } catch (err: any) {
                                  btn.textContent = '保存失败';
                                  setTimeout(() => {
                                    btn.textContent = '保存到结果';
                                    btn.disabled = false;
                                  }, 2000);
                                }
                              }}
                            >
                              保存到结果
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="run-modal-data-hint">运行后可导出</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
            {/* end cards-row */}

            {/* Output / Plot area */}
            <div className="run-modal-output-area">
              {running && images.length > 0 && (
                <div className="run-modal-reloading">🔄 重新绘图中...</div>
              )}
              {running && images.length === 0 && (
                <div className="run-modal-loading">
                  ⏳ 正在执行 {language === 'python' ? 'Python' : 'R'} 代码...
                </div>
              )}
              {!running && images.length === 0 && !output && (
                <div className="run-modal-placeholder">
                  切换配色/模版自动出图，或按 Ctrl+Enter 运行
                </div>
              )}
              {output && <pre className="run-modal-stdout">{output}</pre>}
              {images.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt={`Plot ${i + 1}`}
                  className={`run-modal-image ${running ? 'reloading' : ''}`}
                  onClick={() => setLightboxSrc(src)}
                  title="点击放大"
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Data preview sub-modal */}
      {showDataPreview && dataPreview && (
        <div className="run-modal-data-overlay" onClick={() => setShowDataPreview(false)}>
          <div className="run-modal-data-modal" onClick={(e) => e.stopPropagation()}>
            <div className="run-modal-data-modal-header">
              <span>示例数据预览</span>
              <button onClick={() => setShowDataPreview(false)}>×</button>
            </div>
            <div className="run-modal-data-table-wrap">
              <table className="run-modal-data-table">
                <thead>
                  <tr>
                    {dataPreview
                      .split('\n')[0]
                      ?.split(',')
                      .map((h, i) => (
                        <th key={i}>{h.replace(/"/g, '')}</th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {dataPreview
                    .split('\n')
                    .slice(1)
                    .filter((l) => l.trim() && l !== '...')
                    .map((row, ri) => (
                      <tr key={ri}>
                        {row.split(',').map((cell, ci) => (
                          <td key={ci}>{cell.replace(/"/g, '')}</td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Image lightbox */}
      {lightboxSrc && (
        <div className="run-modal-lightbox" onClick={() => setLightboxSrc(null)}>
          <button
            className="run-modal-lightbox-close"
            onClick={(e) => {
              e.stopPropagation();
              setLightboxSrc(null);
            }}
            aria-label="关闭"
          >
            ×
          </button>
          <img src={lightboxSrc} alt="Plot preview" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
