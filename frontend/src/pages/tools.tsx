// ============================================================
// Tools — 在线分析工作台（单细胞风格三栏布局）
//
// 左侧：分析记录列表
// 中间：当前分析（参数表单 / 结果展示）
// 右侧：工具集（彩色图标卡片）
// ============================================================

import { errMsg } from '@/lib/error';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { tools as staticTools, toolCategories } from '@/pages/_data';
import type { Tool } from '@/pages/_data';
import { TOOL_IMAGES } from '@/pages/_tool-images';
import { WorkbenchEmpty } from '@/components/ui/WorkbenchEmpty';
import { PageHeader } from '@/components/ui/PageHeader';
import { Lightbox } from '@/components/ui/Lightbox';
import { getToken, getApiPrefix, getStoredUser, isLoggedIn } from '@/lib/authClient';
import { LoginModal } from '@/components/auth/LoginModal';
import { useSetCopilotContext } from '@/lib/copilotContextProvider';
import styles from '@/pages/tools.module.css';

type JobStatus =
  | 'idle'
  | 'uploading'
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface Job {
  id: string;
  tool_id: string;
  status: string;
  created_at: number;
  completed_at?: number;
  error?: string;
  name?: string;
}

interface JobResult {
  files?: Array<{ name: string; type: string; label?: string; url?: string }>;
  summary?: Record<string, any>;
}

// ---- Tool icon colors / report URLs are now sourced from _data.ts.
// The lookup helpers below build maps once at module load. Single source of truth.
const TOOL_COLORS: Record<string, string> = Object.fromEntries(
  staticTools.map((t) => [t.id, t.color])
);

const REPORT_URLS: Record<string, string | undefined> = Object.fromEntries(
  staticTools.filter((t) => t.reportUrl).map((t) => [t.id, t.reportUrl])
);


function ToolsInner() {
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [activeResult, setActiveResult] = useState<JobResult | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);

  // 桌面版：已装插件工具（从后端 /api/tools/manifest 动态拉取）
  const [pluginTools, setPluginTools] = useState<Tool[]>([]);

  // 工具列表：桌面版只显示已装插件（未安装的工具不出现，符合插件化设计）
  const tools: Tool[] = useMemo(() => {
    return pluginTools;
  }, [pluginTools]);

  // 桌面版启动时拉取已装插件工具定义
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(getApiPrefix() + '/tools/manifest');
        const data = await resp.json();
        if (!cancelled && data.ok && Array.isArray(data.tools)) {
          // 插件 tool-definition.json 字段对齐 Tool 接口（缺的字段补默认值）
          const normalized: Tool[] = data.tools.map((d: Record<string, unknown>) => ({
            id: String(d.id),
            title: String(d.title ?? d.id),
            subtitle: String(d.subtitle ?? ''),
            category: String(d.category ?? '插件'),
            language: (d.language === 'python' ? 'python' : 'r') as 'r' | 'python',
            description: String(d.description ?? ''),
            longDescription: String(d.longDescription ?? d.description ?? ''),
            inputs: Array.isArray(d.inputs) ? (d.inputs as Tool['inputs']) : [],
            outputs: Array.isArray(d.outputs) ? (d.outputs as Tool['outputs']) : [],
            tutorialUrl: String(d.tutorialUrl ?? ''),
            demoDataUrl: d.demoDataUrl ? String(d.demoDataUrl) : undefined,
            estimatedMinutes: Number(d.estimatedMinutes ?? 5),
            packages: Array.isArray(d.packages) ? (d.packages as string[]) : [],
            color: String(d.color ?? '#7c3aed'),
            reportUrl: String(d.reportUrl ?? ''),
            comingSoon: false,
            _manifest: d._manifest && typeof d._manifest === 'object'
              ? (d._manifest as Tool['_manifest'])
              : undefined,
          }));
          if (!cancelled) setPluginTools(normalized);
        }
      } catch {
        /* 拉取失败静默处理，保留静态工具列表 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Form state
  const [params, setParams] = useState<Record<string, any>>({});
  const [files, setFiles] = useState<Record<string, string>>({});
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [filePreviews, setFilePreviews] = useState<Record<string, string[][]>>({});
  const [status, setStatus] = useState<JobStatus>('idle');
  const [importLoading, setImportLoading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | EventSource | null>(null);

  // Load job history
  const fetchHistory = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const resp = await fetch(getApiPrefix() + '/tools/history', {
        headers: { Authorization: 'Bearer ' + token },
      });
      const data = await resp.json();
      if (data.ok) setJobs(data.jobs || []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Auto-select tool from URL param (?tool=deseq2) — used by docs cross-links.
  // Only fires on mount; doesn't react to URL changes after that.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      const toolId = params.get('tool');
      if (!toolId) return;
      const tool = tools.find((t) => t.id === toolId);
      if (!tool) return;
      // If not logged in, show login; selectTool will be invoked after success
      if (!isLoggedIn()) {
        setShowLogin(true);
        return;
      }
      setSelectedTool(tool);
      setShowNewModal(true);
      const defaults: Record<string, unknown> = {};
      tool.inputs.forEach((inp) => {
        if (inp.default !== undefined) defaults[inp.id] = inp.default;
      });
      setParams(defaults);
    } catch {}
  }, []);

  // Load a specific job result
  const loadJobResult = useCallback(async (job: Job) => {
    setActiveJob(job);
    setActiveResult(null);
    setStatus(job.status as JobStatus);
    const tool = tools.find((t) => t.id === job.tool_id) || null;
    setSelectedTool(tool);
    if (job.status === 'completed') {
      const token = getToken();
      const lang: 'r' | 'python' = tool?.language === 'python' ? 'python' : 'r';
      try {
        const resp = await fetch(getApiPrefix(lang) + '/tools/status/' + job.id, {
          headers: token ? { Authorization: 'Bearer ' + token } : {},
        });
        const data = await resp.json();
        if (data.ok && data.result) setActiveResult(data.result);
      } catch {}
    }
  }, []);

  const [showNewModal, setShowNewModal] = useState(false);
  const [showMobileToolSheet, setShowMobileToolSheet] = useState(false);
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 220;
    const saved = localStorage.getItem('biof3-tools-left-w');
    return saved ? parseInt(saved, 10) : 220;
  });
  const [rightWidth, setRightWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 200;
    const saved = localStorage.getItem('biof3-tools-right-w');
    return saved ? parseInt(saved, 10) : 200;
  });

  const _onResizeRight = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = rightWidth;
      const onMove = (ev: MouseEvent) => {
        const newW = Math.max(120, Math.min(400, startW - (ev.clientX - startX)));
        setRightWidth(newW);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setRightWidth((w) => {
          localStorage.setItem('biof3-tools-right-w', String(w));
          return w;
        });
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [rightWidth]
  );

  const onResizeLeft = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = leftWidth;
      const onMove = (ev: MouseEvent) => {
        const newW = Math.max(160, Math.min(360, startW + (ev.clientX - startX)));
        setLeftWidth(newW);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setLeftWidth((w) => {
          localStorage.setItem('biof3-tools-left-w', String(w));
          return w;
        });
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [leftWidth]
  );

  const ensurePythonBackend = useCallback(async (): Promise<void> => {
    if (typeof window === 'undefined' || !window.biof3Desktop?.py?.start) return;
    const result = await window.biof3Desktop.py.start();
    if (!result.ok) {
      throw new Error(result.error || 'Python 后端启动失败');
    }
  }, []);

  // Select a tool to start new analysis (opens modal)
  const selectTool = useCallback((tool: Tool) => {
    if (!isLoggedIn()) {
      setShowLogin(true);
      return;
    }
    if (tool.language === 'python') {
      void ensurePythonBackend().catch(() => {});
    }
    setSelectedTool(tool);
    setShowNewModal(true);
    setError(null);
    // Init defaults
    const defaults: Record<string, unknown> = {};
    tool.inputs.forEach((inp) => {
      if (inp.default !== undefined) defaults[inp.id] = inp.default;
    });
    setParams(defaults);
    setFiles({});
    setFileNames({});
    setFilePreviews({});
  }, [ensurePythonBackend]);

  // File handling — convert text to base64 in chunks to avoid stack overflow / encodeURIComponent
  // hangs on large files (16+ MB demos).
  // Strategy: convert text → UTF-8 bytes via TextEncoder → base64 in 32KB chunks.
  const textToBase64 = useCallback((text: string): string => {
    if (typeof TextEncoder === 'undefined') {
      // Legacy fallback (small files only) — uses old btoa+encodeURI route
      return btoa(unescape(encodeURIComponent(text)));
    }
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    const chunk = 32 * 1024;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    return btoa(binary);
  }, []);

  // Fetch a binary file (e.g. .gz, .h5, .maf.gz) and return its base64 representation.
  // Used by demo loaders for binary files that textToBase64 cannot handle.
  const fetchBinaryAsBase64 = useCallback(async (url: string): Promise<string> => {
    const r = await fetch(url);
    const buf = await r.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 32 * 1024;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    return btoa(binary);
  }, []);

  const handleFileChange = useCallback(
    (inputId: string, file: File | null) => {
      if (!file) return;
      setFileNames((prev) => ({ ...prev, [inputId]: file.name }));
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        const base64 = textToBase64(text);
        setFiles((prev) => ({ ...prev, [inputId]: base64 }));
        const lines = text
          .split('\n')
          .filter((l) => l.trim())
          .slice(0, 6);
        const sep = text.includes('\t') ? '\t' : ',';
        const rows = lines.map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews((prev) => ({ ...prev, [inputId]: rows }));
      };
      reader.readAsText(file);
    },
    [textToBase64]
  );

  // Submit
  const handleSubmit = useCallback(async () => {
    if (!selectedTool) return;
    // Wave 1 placeholder tools (machine-learning column) are not yet runnable.
    // Block submit and explain. Will be flipped to false in Wave 2-4 as scripts ship.
    if (selectedTool.comingSoon) {
      setError(
        `${selectedTool.title} 还在开发中，预计 Wave 2-4 上线（详见教程页底部）。当前可点"示例数据"按钮预览输入格式。`
      );
      return;
    }
    const token = getToken();
    if (!token) {
      setShowLogin(true);
      return;
    }
    for (const inp of selectedTool.inputs) {
      if (inp.required && inp.type === 'file' && !files[inp.id]) {
        setError(`请上传：${inp.label}`);
        return;
      }
      if (inp.required && inp.type !== 'file' && !params[inp.id]) {
        setError(`请填写：${inp.label}`);
        return;
      }
    }
    setStatus('uploading');
    setError(null);
    const lang = selectedTool.language; // 'r' | 'python' — routes to correct backend
    try {
      if (lang === 'python') {
        await ensurePythonBackend();
      }
      // Generate request-id for tracing (stored in sessionStorage for bug reports)
      const rid = crypto.randomUUID?.() || Math.random().toString(36).slice(2, 14);
      const resp = await fetch(getApiPrefix(lang) + '/tools/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
          'X-Request-Id': rid,
        },
        body: JSON.stringify({ toolId: selectedTool.id, params, files }),
      });
      const data = await resp.json();
      if (!data.ok) {
        setError(data.error || '提交失败');
        setStatus('idle');
        return;
      }
      // Store request-id → jobId mapping for debugging
      try {
        sessionStorage.setItem('biof3_last_rid', rid);
        sessionStorage.setItem('biof3_last_job', data.jobId);
      } catch {}
      setJobId(data.jobId);
      setStatus('pending');
      setShowNewModal(false);
      startPolling(data.jobId, selectedTool.id, lang);
      fetchHistory();
    } catch (e: any) {
      setError(e.message);
      setStatus('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensurePythonBackend, selectedTool, params, files, fetchHistory]);

  const stopPolling = useCallback(() => {
    if (!pollRef.current) return;
    if (pollRef.current instanceof EventSource) pollRef.current.close();
    else clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  const startPolling = useCallback(
    (jid: string, toolId: string, lang: 'r' | 'python' = 'r') => {
      stopPolling();
      // py-server 暂无 SSE 端点 → 保留轮询兜底
      if (lang === 'python') {
        pollRef.current = setInterval(async () => {
          const token = getToken();
          try {
            const resp = await fetch(getApiPrefix(lang) + '/tools/status/' + jid, {
              headers: token ? { Authorization: 'Bearer ' + token } : {},
            });
            const data = await resp.json();
            if (data.status === 'completed') {
              stopPolling();
              const completedJob: Job = {
                id: jid,
                tool_id: toolId,
                status: 'completed',
                created_at: Date.now(),
              };
              setStatus('idle');
              fetchHistory();
              setTimeout(() => loadJobResult(completedJob), 300);
            } else if (data.status === 'failed') {
              setStatus('failed');
              setError(data.error || '分析失败');
              stopPolling();
              fetchHistory();
            } else {
              setStatus(data.status as JobStatus);
            }
          } catch {}
        }, 2000);
        return;
      }
      // r-server: SSE 实时状态推送（替代 2s 轮询）
      const token = getToken();
      const url =
        getApiPrefix('r') +
        '/tools/stream/' +
        jid +
        (token ? '?token=' + encodeURIComponent(token) : '');
      const es = new EventSource(url);
      pollRef.current = es;
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.error === 'not_found') {
            stopPolling();
            return;
          }
          if (data.status === 'completed') {
            stopPolling();
            const completedJob: Job = {
              id: jid,
              tool_id: toolId,
              status: 'completed',
              created_at: Date.now(),
            };
            setStatus('idle');
            fetchHistory();
            setTimeout(() => loadJobResult(completedJob), 300);
          } else if (data.status === 'failed') {
            setStatus('failed');
            setError(data.error || '分析失败');
            stopPolling();
            fetchHistory();
          } else if (data.status === 'cancelled') {
            stopPolling();
          } else {
            setStatus(data.status as JobStatus);
          }
        } catch {}
      };
      es.onerror = () => {
        // 连接异常（服务端关闭/网络断开）— 关闭避免 EventSource 自动重连
        stopPolling();
      };
    },
    [fetchHistory, loadJobResult, stopPolling]
  );

  // Load demo data for form pre-fill
  const loadDemoForForm = useCallback(async () => {
    if (!selectedTool) return;
    if (selectedTool.id === 'deseq2') {
      try {
        const base = getApiPrefix() + '/tools/demo-data/deseq2';
        const [cr, cd] = await Promise.all([
          fetch(base + '/demo-counts.csv'),
          fetch(base + '/demo-coldata.csv'),
        ]);
        const ct = await cr.text();
        const cdt = await cd.text();
        setFiles({ counts: textToBase64(ct), coldata: textToBase64(cdt) });
        setFileNames({ counts: 'demo-counts.csv', coldata: 'demo-coldata.csv' });
        setParams((p) => ({
          ...p,
          design: 'condition',
          contrast_ref: 'Control',
          contrast_treat: 'Treatment',
        }));
        const sep = ',';
        const mp = (t: string) =>
          t
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 6)
            .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews({ counts: mp(ct), coldata: mp(cdt) });
      } catch {
        setError('加载示例数据失败');
      }
    } else if (selectedTool.id === 'go-kegg') {
      try {
        const base = getApiPrefix() + '/tools/demo-data/go-kegg';
        const resp = await fetch(base + '/genes.csv');
        const text = await resp.text();
        setFiles({ genes: textToBase64(text) });
        setFileNames({ genes: 'genes.csv' });
        setParams((p) => ({
          ...p,
          species: 'human',
          analysis_type: 'all',
          gene_id_type: 'SYMBOL',
          padj_cutoff: '0.05',
          lfc_cutoff: '1',
          enrich_pvalue: '0.05',
          enrich_qvalue: '0.2',
          top_n: '20',
        }));
        const sep = ',';
        const mp = (t: string) =>
          t
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 6)
            .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews({ genes: mp(text) });
      } catch {
        setError('加载示例数据失败');
      }
    } else if (selectedTool.id === 'gsea') {
      try {
        const base = getApiPrefix() + '/tools/demo-data/gsea';
        const resp = await fetch(base + '/ranked_list.csv');
        const text = await resp.text();
        setFiles({ ranked_list: textToBase64(text) });
        setFileNames({ ranked_list: 'ranked_list.csv' });
        setParams((p) => ({
          ...p,
          organism: 'hsa',
          gene_set: 'GO_BP',
          min_size: '15',
          max_size: '500',
        }));
        const sep = text.includes('\t') ? '\t' : ',';
        const mp = (t: string) =>
          t
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 6)
            .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews({ ranked_list: mp(text) });
      } catch {
        setError('加载示例数据失败');
      }
    } else if (selectedTool.id === 'km-survival') {
      try {
        const base = getApiPrefix() + '/tools/demo-data/km-survival';
        const [er, cr] = await Promise.all([
          fetch(base + '/expression.csv'),
          fetch(base + '/clinical.csv'),
        ]);
        const et = await er.text();
        const ct = await cr.text();
        setFiles({ expression: textToBase64(et), clinical: textToBase64(ct) });
        setFileNames({ expression: 'expression.csv', clinical: 'clinical.csv' });
        setParams((p) => ({
          ...p,
          gene: 'TP53',
          cutoff_method: 'median',
          time_col: 'OS.time',
          event_col: 'OS',
        }));
        const sep = ',';
        const mp = (t: string) =>
          t
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 6)
            .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews({ expression: mp(et), clinical: mp(ct) });
      } catch {
        setError('加载示例数据失败');
      }
    } else if (selectedTool.id === 'lasso-cox') {
      try {
        const base = getApiPrefix() + '/tools/demo-data/lasso-cox';
        const [er, cr] = await Promise.all([
          fetch(base + '/expression.csv'),
          fetch(base + '/clinical.csv'),
        ]);
        const et = await er.text();
        const ct = await cr.text();
        setFiles({ expression: textToBase64(et), clinical: textToBase64(ct) });
        setFileNames({ expression: 'expression.csv', clinical: 'clinical.csv' });
        setParams((p) => ({ ...p, train_ratio: '0.7', seed: '42' }));
        const sep = ',';
        const mp = (t: string) =>
          t
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 6)
            .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews({ expression: mp(et), clinical: mp(ct) });
      } catch {
        setError('加载示例数据失败');
      }
    } else if (selectedTool.id === 'bindea-immune') {
      try {
        const base = getApiPrefix() + '/tools/demo-data/bindea-immune';
        const [tr, gr] = await Promise.all([
          fetch(base + '/tpm_matrix.csv'),
          fetch(base + '/group.csv'),
        ]);
        const tt = await tr.text();
        const gt = await gr.text();
        setFiles({ tpm_matrix: textToBase64(tt), group_file: textToBase64(gt) });
        setFileNames({ tpm_matrix: 'tpm_matrix.csv', group_file: 'group.csv' });
        setParams((p) => ({ ...p, method: 'ssgsea' }));
        const sep = ',';
        const mp = (t: string) =>
          t
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 6)
            .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews({ tpm_matrix: mp(tt), group_file: mp(gt) });
      } catch {
        setError('加载示例数据失败');
      }
    } else if (selectedTool.id === 'maftools-mutation') {
      try {
        const base = getApiPrefix() + '/tools/demo-data/maftools-mutation';
        // maf_file is gzipped MAF (binary), clinical is TSV (text)
        const mafB64 = await fetchBinaryAsBase64(base + '/maf_file');
        const cr = await fetch(base + '/clinical');
        const ct = await cr.text();
        setFiles({ maf_file: mafB64, clinical: textToBase64(ct) });
        setFileNames({
          maf_file: 'TCGA-LAML maf_file (193 AML samples, gz)',
          clinical: 'TCGA-LAML clinical (FAB + survival)',
        });
        setParams((p) => ({
          ...p,
          genome: 'hg19',
          top_n_oncoplot: '20',
          lollipop_top_n: '2',
          n_signatures: '3',
        }));
        const sep = '\t';
        const mp = (t: string) =>
          t
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 6)
            .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews({ clinical: mp(ct) });
      } catch (e: unknown) {
        setError('加载示例数据失败: ' + (errMsg(e) || ''));
      }
    } else if (selectedTool.id === 'cellchat') {
      try {
        const base = getApiPrefix() + '/tools/demo-data/cellchat';
        const [er, mr] = await Promise.all([
          fetch(base + '/expression.csv'),
          fetch(base + '/meta.csv'),
        ]);
        const et = await er.text();
        const mt = await mr.text();
        setFiles({ expression: textToBase64(et), meta: textToBase64(mt) });
        setFileNames({
          expression: 'PBMC 3k expression.csv (9821 genes × 605 cells)',
          meta: 'PBMC 3k meta.csv (9 cell types)',
        });
        setParams((p) => ({
          ...p,
          species: 'human',
          signaling_db: 'Secreted Signaling',
          min_cells_per_group: '10',
          top_pathways_to_visualize: '5',
        }));
        const sep = ',';
        const mp = (t: string) =>
          t
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 6)
            .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews({ expression: mp(et), meta: mp(mt) });
      } catch {
        setError('加载示例数据失败');
      }
    } else if (selectedTool.id === 'complexheatmap') {
      try {
        const base = getApiPrefix() + '/tools/demo-data/complexheatmap';
        const [mr, ar] = await Promise.all([
          fetch(base + '/matrix.csv'),
          fetch(base + '/annotation.csv'),
        ]);
        const mt = await mr.text();
        const at = await ar.text();
        setFiles({ matrix: textToBase64(mt), annotation: textToBase64(at) });
        setFileNames({
          matrix: 'TCGA-BRCA matrix.csv (100 HVGs × 80 samples)',
          annotation: 'TCGA-BRCA annotation.csv (PAM50/ER/HER2/Stage/Age)',
        });
        setParams((p) => ({
          ...p,
          z_score: 'TRUE',
          cluster_rows: 'TRUE',
          cluster_columns: 'TRUE',
          clustering_distance: 'pearson',
          clustering_method: 'ward.D2',
          color_scheme: 'div',
          top_n_label: '20',
        }));
        const sep = ',';
        const mp = (t: string) =>
          t
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 6)
            .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews({ matrix: mp(mt), annotation: mp(at) });
      } catch {
        setError('加载示例数据失败');
      }
    } else if (selectedTool.id === 'wgcna') {
      try {
        const base = getApiPrefix() + '/tools/demo-data/wgcna';
        const [er, tr] = await Promise.all([
          fetch(base + '/expression.csv'),
          fetch(base + '/traits.csv'),
        ]);
        const et = await er.text();
        const tt = await tr.text();
        setFiles({ expression: textToBase64(et), traits: textToBase64(tt) });
        setFileNames({
          expression: 'TCGA-BRCA expression.csv (5000 HVGs × 218 samples)',
          traits: 'TCGA-BRCA traits.csv (10 traits)',
        });
        setParams((p) => ({
          ...p,
          min_module_size: '30',
          merge_cut_height: '0.25',
          network_type: 'signed',
        }));
        const sep = ',';
        const mp = (t: string) =>
          t
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 6)
            .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews({ expression: mp(et), traits: mp(tt) });
      } catch {
        setError('加载示例数据失败');
      }
    } else if (selectedTool.id === 'seurat-standard') {
      try {
        const base = getApiPrefix() + '/tools/demo-data/seurat-standard';
        // PBMC 3k subset (3009 HVGs + MT genes × 2700 cells, ~16 MB CSV)
        // Source: 10X Genomics PBMC 3k filtered_gene_bc_matrices, pre-filtered to top HVGs
        const resp = await fetch(base + '/pbmc3k_demo.csv');
        const text = await resp.text();
        setFiles({ matrix: textToBase64(text) });
        setFileNames({ matrix: 'pbmc3k_demo.csv (PBMC 3k)' });
        setParams((p) => ({
          ...p,
          species: 'human',
          min_features: '200',
          max_features: '2500',
          max_mt: '5',
          nfeatures: '2000',
          dims: '10',
          resolution: '0.5',
          top_n_markers: '10',
        }));
        const sep = ',';
        const mp = (t: string) =>
          t
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 6)
            .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews({ matrix: mp(text) });
      } catch {
        setError('加载示例数据失败');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTool]);

  // Load demo results for display
  const [demoFiles, setDemoFiles] = useState<Array<{ name: string; type: string; url: string }>>(
    []
  );
  const [demoToolId, setDemoToolId] = useState<string>('deseq2');

  const loadToolDemo = useCallback(async (toolId: string) => {
    setDemoToolId(toolId);
    setSelectedTool(null);
    setActiveJob(null);
    setActiveResult(null);
    setStatus('idle');
    // Pick backend based on the tool's language ('r' or 'python').
    const tool = tools.find((t) => t.id === toolId);
    const lang: 'r' | 'python' = tool?.language === 'python' ? 'python' : 'r';
    try {
      if (lang === 'python') {
        await ensurePythonBackend();
      }
      const resp = await fetch(getApiPrefix(lang) + '/tools/public-demo/' + toolId);
      const data = await resp.json();
      if (data.ok) setDemoFiles(data.files || []);
      else setDemoFiles([]);
    } catch {
      setDemoFiles([]);
    }
  }, [ensurePythonBackend]);

  useEffect(() => {
    loadToolDemo('deseq2');
  }, [loadToolDemo]);

  // Auto-open tool from URL hash (e.g. /tools#deseq2)
  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash) {
      const tool = tools.find((t) => t.id === hash);
      if (tool) {
        setTimeout(() => selectTool(tool), 300);
      } else {
        loadToolDemo(hash);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Publish context to Copilot AI assistant
  useSetCopilotContext(
    {
      page: 'tools',
      pageTitle: '分析工具',
      toolId: selectedTool?.id || demoToolId,
      toolName: selectedTool?.title || tools.find((t) => t.id === demoToolId)?.title,
      toolResult: activeResult?.summary || null,
      availableTools: tools.map((t) => t.title),
    },
    [selectedTool, demoToolId, activeResult]
  );

  // Listen for AI assistant tool actions
  useEffect(() => {
    const handleOpenTool = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.toolId) return;
      const tool = tools.find((t) => t.id === detail.toolId);
      if (!tool) return;
      selectTool(tool);
      // KILLER_USE_CASE_1_v1 — auto-import data from a prior tool's job.
      // Currently maps two known flows:
      //   - go-kegg / gsea ← deseq2's deg_table.csv (genes / ranked_list slot)
      // Extend AUTOFILL_RECIPES below as new flows emerge.
      if (detail.autofillFromJobId && detail.autofillSourceTool) {
        await autofillFromJob(tool.id, detail.autofillFromJobId, detail.autofillSourceTool);
      }
    };
    window.addEventListener('biof3:tools-open', handleOpenTool);
    return () => window.removeEventListener('biof3:tools-open', handleOpenTool);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectTool]);

  // agent-led Task 3：open_result handler 触发，按 jobId 加载结果。
  // 收 toolJobId → fetch /tools/status/:id 拿 tool_id + status → 构造 Job 调 loadJobResult。
  const openResultByJobId = useCallback(
    async (toolJobId: string) => {
      const token = getToken();
      try {
        const resp = await fetch(
          getApiPrefix() + '/tools/status/' + encodeURIComponent(toolJobId),
          {
            headers: token ? { Authorization: 'Bearer ' + token } : {},
          }
        );
        const data = await resp.json();
        if (!data || data.error) return;
        // status 端点返回 toolId（驼峰），构造 Job 适配 snake_case 字段
        const job: Job = {
          id: String(toolJobId),
          tool_id: data.toolId || data.tool_id || '',
          status: data.status || 'completed',
          created_at: data.createdAt ? new Date(data.createdAt).getTime() : Date.now(),
          completed_at: data.completedAt ? new Date(data.completedAt).getTime() : undefined,
          error: data.error,
        };
        loadJobResult(job);
      } catch {}
    },
    [loadJobResult]
  );

  // 同页：直接监听事件
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.toolJobId) openResultByJobId(String(detail.toolJobId));
    };
    window.addEventListener('biof3:tools-open-result', handler);
    return () => window.removeEventListener('biof3:tools-open-result', handler);
  }, [openResultByJobId]);

  // 跨页：从 sessionStorage 消费 pending result（open_result handler 跨页导航时 stash）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = sessionStorage.getItem('biof3_pending_tool_result');
      if (!raw) return;
      sessionStorage.removeItem('biof3_pending_tool_result');
      // 延迟一拍等 tools 列表加载完，loadJobResult 内部 find 才能命中 tool
      setTimeout(() => openResultByJobId(raw), 600);
    } catch {}
  }, [openResultByJobId]);

  // KILLER_USE_CASE_1_v1 — autofill recipes describe how to import data from
  // a source tool's job into a target tool's input slot. Same logic as the
  // manual <select> dropdowns the user can use, just driven by the AI.
  const AUTOFILL_RECIPES: Record<
    string,
    Record<string, { file: string; slot: string; label: string }>
  > = {
    // target tool → {source tool: {file in source job's output, slot in target form, friendly label}}
    'go-kegg': {
      deseq2: { file: 'deg_table.csv', slot: 'genes', label: 'deg_table.csv (来自 DESeq2)' },
    },
    gsea: {
      deseq2: { file: 'deg_table.csv', slot: 'ranked_list', label: 'deg_table.csv (来自 DESeq2)' },
    },
  };

  const autofillFromJob = useCallback(
    async (targetTool: string, sourceJobId: string, sourceTool: string) => {
      const recipe = AUTOFILL_RECIPES[targetTool] && AUTOFILL_RECIPES[targetTool][sourceTool];
      if (!recipe) {
        console.warn('[autofill] no recipe for ' + sourceTool + ' → ' + targetTool);
        return;
      }
      setImportLoading(true);
      try {
        const token = getToken();
        const resp = await fetch(
          getApiPrefix() + '/tools/file/' + sourceJobId + '/' + recipe.file,
          {
            headers: token ? { Authorization: 'Bearer ' + token } : {},
          }
        );
        if (!resp.ok) {
          console.warn('[autofill] fetch failed: HTTP ' + resp.status);
          setImportLoading(false);
          return;
        }
        const text = await resp.text();
        setFiles((f) => ({ ...f, [recipe.slot]: textToBase64(text) }));
        setFileNames((f) => ({ ...f, [recipe.slot]: recipe.label }));
        const sep = ',';
        const mp = (t: string) =>
          t
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 6)
            .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews((f) => ({ ...f, [recipe.slot]: mp(text) }));
      } catch (e) {
        console.warn('[autofill] error:', e);
      }
      setImportLoading(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [textToBase64]
  );

  // KILLER_USE_CASE_1_v1 — pick up cross-page autofill from sessionStorage
  // (set when CopilotChat is on a different page when AI fires open_tool).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = sessionStorage.getItem('biof3_pending_tool_autofill');
      if (!raw) return;
      sessionStorage.removeItem('biof3_pending_tool_autofill');
      const detail = JSON.parse(raw);
      if (detail.toolId && detail.autofillFromJobId && detail.autofillSourceTool) {
        // Wait a tick for selectTool from hash effect to finish, then autofill.
        setTimeout(
          () => autofillFromJob(detail.toolId, detail.autofillFromJobId, detail.autofillSourceTool),
          600
        );
      }
    } catch {}
  }, [autofillFromJob]);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  // Pick API base based on the currently-active tool's language. When viewing
  // a job from history, fall back to selectedTool (set by loadJobResult).
  const activeLang: 'r' | 'python' = selectedTool?.language === 'python' ? 'python' : 'r';
  const apiBase = getApiPrefix(activeLang);
  const token = getToken();

  return (
    <div
      className={styles.workspace}
      style={{ gridTemplateColumns: `${leftWidth}px 4px 1fr 4px ${rightWidth}px` }}
    >
      {/* Left: Tool navigation + job history by category */}
      <aside className={styles.leftPanel}>
        <div className={styles.leftHeader}>
          <h3>工具导航</h3>
        </div>
        <div className={styles.toolNav}>
          {toolCategories.map((cat) => {
            const catTools = tools.filter((t) => t.category === cat);
            if (catTools.length === 0) return null;
            return (
              <div key={cat} className={styles.navCategory}>
                <div className={styles.navCatLabel}>{cat}</div>
                {catTools.map((t) => {
                  const toolJobs = jobs.filter((j) => j.tool_id === t.id);
                  return (
                    <div key={t.id} id={t.id} className={styles.navTool}>
                      <button
                        className={`${styles.navToolBtn} ${!selectedTool && !activeJob && demoToolId === t.id ? styles.navToolBtnActive : ''}`}
                        onClick={() => loadToolDemo(t.id)}
                      >
                        <span
                          className={styles.navDot}
                          style={{ background: TOOL_COLORS[t.id] || '#6b7280' }}
                        />
                        {t.title}
                        {t._manifest?.execution?.manifestDrift && (
                          <span className={styles.navToolBadgeDrift}>已变更</span>
                        )}
                      </button>
                      {toolJobs.map((job) => (
                        <div key={job.id} className={styles.navJobRow}>
                          <button
                            className={`${styles.navJobBtn} ${activeJob?.id === job.id ? styles.navJobBtnActive : ''}`}
                            onClick={() => loadJobResult(job)}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              e.currentTarget.style.display = 'none';
                              const input = e.currentTarget.nextElementSibling as HTMLInputElement;
                              if (input && input.classList.contains(styles.navJobRenameInput)) {
                                input.style.display = 'block';
                                input.focus();
                                input.select();
                              }
                            }}
                            title="双击修改名称"
                          >
                            <span
                              className={`${styles.navJobStatus} ${styles['jobStatus_' + job.status]}`}
                            >
                              {job.status === 'completed'
                                ? '✓'
                                : job.status === 'failed'
                                  ? '✗'
                                  : '·'}
                            </span>
                            {job.name ||
                              new Date(job.created_at).toLocaleString('zh-CN', {
                                month: 'numeric',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                          </button>
                          <input
                            className={styles.navJobRenameInput}
                            style={{ display: 'none' }}
                            defaultValue={job.name || ''}
                            onBlur={async (e) => {
                              const newName = e.currentTarget.value.trim();
                              e.currentTarget.style.display = 'none';
                              const btn = e.currentTarget.previousElementSibling as HTMLElement;
                              if (btn) btn.style.display = '';
                              if (newName && newName !== job.name) {
                                const tk = getToken();
                                await fetch(getApiPrefix() + '/tools/job/' + job.id + '/name', {
                                  method: 'PUT',
                                  headers: {
                                    'Content-Type': 'application/json',
                                    ...(tk ? { Authorization: 'Bearer ' + tk } : {}),
                                  },
                                  body: JSON.stringify({ name: newName }),
                                });
                                fetchHistory();
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                              if (e.key === 'Escape') {
                                e.currentTarget.value = job.name || '';
                                e.currentTarget.blur();
                              }
                            }}
                          />
                          <button
                            className={styles.navJobDelete}
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (confirmDeleteId === job.id) {
                                // Already confirming — do the delete
                                const token = getToken();
                                await fetch(getApiPrefix() + '/tools/job/' + job.id, {
                                  method: 'DELETE',
                                  headers: token ? { Authorization: 'Bearer ' + token } : {},
                                });
                                setConfirmDeleteId(null);
                                fetchHistory();
                                if (activeJob?.id === job.id) {
                                  setActiveJob(null);
                                  setActiveResult(null);
                                }
                              } else {
                                // First click — show confirm state
                                setConfirmDeleteId(job.id);
                                setTimeout(
                                  () =>
                                    setConfirmDeleteId((prev) => (prev === job.id ? null : prev)),
                                  3000
                                );
                              }
                            }}
                            title={confirmDeleteId === job.id ? '再次点击确认删除' : '删除'}
                          >
                            {confirmDeleteId === job.id ? '✓' : '×'}
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </aside>

      {/* Left resize handle */}
      <div className={styles.resizeHandle} onMouseDown={onResizeLeft} title="拖拽调整宽度" />

      {/* Center: Main content */}
      <main className={styles.mainPanel}>
        {!activeJob && status !== 'completed' && status !== 'failed' && !activeResult && (
          <div className={styles.resultPanel}>
            <div className={styles.resultHeader}>
              <h3>{tools.find((t) => t.id === demoToolId)?.title || demoToolId}</h3>
            </div>

            {demoFiles.length === 0 ? (
              <WorkbenchEmpty desc="该工具暂无 Demo 结果，点击右侧工具图标提交分析。" />
            ) : (
              <ResultTabs
                files={demoFiles}
                buildUrl={(name: string) => {
                  // W2 (2026-05-28): demo url 必须用工具自身 language 的 prefix
                  // 否则 python 工具的 demo 文件会被拼到 /api/r 而 404
                  const demoTool = tools.find((t) => t.id === demoToolId);
                  const demoLang: 'r' | 'python' = demoTool?.language === 'python' ? 'python' : 'r';
                  const f = demoFiles.find((x) => x.name === name);
                  return f?.url
                    ? `${getApiPrefix(demoLang)}${f.url}`
                    : `${getApiPrefix(demoLang)}/tools/demo/${demoToolId}/${name}`;
                }}
                onReport={() => {
                  const demoTool = tools.find((t) => t.id === demoToolId);
                  const demoLang: 'r' | 'python' = demoTool?.language === 'python' ? 'python' : 'r';
                  const reportFile = demoFiles.find((f) => f.name === 'report.html');
                  if (reportFile?.url) {
                    setReportUrl(`${getApiPrefix(demoLang)}${reportFile.url}`);
                  } else if (REPORT_URLS[demoToolId]) {
                    setReportUrl(REPORT_URLS[demoToolId]);
                  }
                }}
              />
            )}
          </div>
        )}

        {selectedTool && showNewModal && !activeJob && (
          <div className={styles.inlineForm}>
            <div className={styles.inlineFormHeader}>
              <h2>{selectedTool.title}</h2>
              <div className={styles.inlineFormActions}>
                <button className={styles.demoBtn} onClick={loadDemoForForm}>
                  示例数据
                </button>
                <button
                  className={styles.submitBtn}
                  onClick={handleSubmit}
                  disabled={status === 'uploading' || status === 'pending' || importLoading}
                >
                  {importLoading ? '导入中...' : status === 'uploading' ? '提交中...' : '开始分析'}
                </button>
                <button className={styles.modalClose} onClick={() => setShowNewModal(false)}>
                  ×
                </button>
              </div>
            </div>
            {error && <div className={styles.formError}>{error}</div>}
            <div className={styles.inlineFormBody}>
              {selectedTool.inputs
                .filter((inp) => inp.required)
                .map((inp) => (
                  <div key={inp.id} className={styles.formField}>
                    <label>
                      {inp.label}
                      <span className={styles.required}>*</span>
                    </label>
                    {inp.type === 'file' && (
                      <>
                        <input
                          type="file"
                          accept={inp.accept}
                          onChange={(e) => handleFileChange(inp.id, e.target.files?.[0] || null)}
                        />
                        {/* Data linkage: import from previous DESeq2 results */}
                        {selectedTool.id === 'go-kegg' &&
                          inp.id === 'genes' &&
                          jobs.filter((j) => j.tool_id === 'deseq2' && j.status === 'completed')
                            .length > 0 && (
                            <select
                              className={styles.importSelect}
                              defaultValue=""
                              disabled={importLoading}
                              onChange={async (e) => {
                                const jid = e.target.value;
                                if (!jid) return;
                                setImportLoading(true);
                                try {
                                  const token = getToken();
                                  const resp = await fetch(
                                    getApiPrefix() + '/tools/file/' + jid + '/deg_table.csv',
                                    {
                                      headers: token ? { Authorization: 'Bearer ' + token } : {},
                                    }
                                  );
                                  const text = await resp.text();
                                  setFiles((f) => ({ ...f, genes: textToBase64(text) }));
                                  setFileNames((f) => ({
                                    ...f,
                                    genes: 'deg_table.csv (来自 DESeq2)',
                                  }));
                                  const sep = ',';
                                  const mp = (t: string) =>
                                    t
                                      .split('\n')
                                      .filter((l) => l.trim())
                                      .slice(0, 6)
                                      .map((l) =>
                                        l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim())
                                      );
                                  setFilePreviews((f) => ({ ...f, genes: mp(text) }));
                                } catch {
                                  setError('导入失败');
                                }
                                setImportLoading(false);
                              }}
                            >
                              <option value="">
                                {importLoading ? '导入中...' : '从已有 DESeq2 结果导入...'}
                              </option>
                              {jobs
                                .filter((j) => j.tool_id === 'deseq2' && j.status === 'completed')
                                .map((j) => (
                                  <option key={j.id} value={j.id}>
                                    {j.name || `DESeq2 #${j.id.slice(-6)}`}
                                  </option>
                                ))}
                            </select>
                          )}
                        {/* Data linkage: GSEA can import DESeq2 results */}
                        {selectedTool.id === 'gsea' &&
                          inp.id === 'ranked_list' &&
                          jobs.filter((j) => j.tool_id === 'deseq2' && j.status === 'completed')
                            .length > 0 && (
                            <select
                              className={styles.importSelect}
                              defaultValue=""
                              disabled={importLoading}
                              onChange={async (e) => {
                                const jid = e.target.value;
                                if (!jid) return;
                                setImportLoading(true);
                                try {
                                  const token = getToken();
                                  const resp = await fetch(
                                    getApiPrefix() + '/tools/file/' + jid + '/deg_table.csv',
                                    {
                                      headers: token ? { Authorization: 'Bearer ' + token } : {},
                                    }
                                  );
                                  const text = await resp.text();
                                  setFiles((f) => ({ ...f, ranked_list: textToBase64(text) }));
                                  setFileNames((f) => ({
                                    ...f,
                                    ranked_list: 'deg_table.csv (来自 DESeq2)',
                                  }));
                                  const sep = ',';
                                  const mp = (t: string) =>
                                    t
                                      .split('\n')
                                      .filter((l) => l.trim())
                                      .slice(0, 6)
                                      .map((l) =>
                                        l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim())
                                      );
                                  setFilePreviews((f) => ({ ...f, ranked_list: mp(text) }));
                                } catch {
                                  setError('导入失败');
                                }
                                setImportLoading(false);
                              }}
                            >
                              <option value="">
                                {importLoading ? '导入中...' : '从已有 DESeq2 结果导入...'}
                              </option>
                              {jobs
                                .filter((j) => j.tool_id === 'deseq2' && j.status === 'completed')
                                .map((j) => (
                                  <option key={j.id} value={j.id}>
                                    {j.name || `DESeq2 #${j.id.slice(-6)}`}
                                  </option>
                                ))}
                            </select>
                          )}
                        {fileNames[inp.id] && (
                          <span className={styles.fileName}>{fileNames[inp.id]}</span>
                        )}
                        {filePreviews[inp.id] && (
                          <div className={styles.filePreview}>
                            <table>
                              <tbody>
                                {filePreviews[inp.id].map((row, i) => (
                                  <tr key={i} className={i === 0 ? styles.previewHeader : ''}>
                                    {row.slice(0, 6).map((c, j) => (
                                      <td key={j}>{c.length > 12 ? c.slice(0, 12) + '…' : c}</td>
                                    ))}
                                    {row.length > 6 && <td>…</td>}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    )}
                    {inp.type === 'select' && (
                      <select
                        value={params[inp.id] || ''}
                        onChange={(e) => setParams((p) => ({ ...p, [inp.id]: e.target.value }))}
                      >
                        {inp.options?.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    )}
                    {inp.type === 'number' && (
                      <input
                        type="number"
                        value={params[inp.id] ?? ''}
                        placeholder={inp.placeholder}
                        step="any"
                        onChange={(e) =>
                          setParams((p) => ({ ...p, [inp.id]: parseFloat(e.target.value) }))
                        }
                      />
                    )}
                    {inp.type === 'text' && (
                      <input
                        type="text"
                        value={params[inp.id] || ''}
                        placeholder={inp.placeholder}
                        onChange={(e) => setParams((p) => ({ ...p, [inp.id]: e.target.value }))}
                      />
                    )}
                    {inp.hint && <span className={styles.fieldHint}>{inp.hint}</span>}
                  </div>
                ))}

              {selectedTool.inputs.some((inp) => !inp.required) && (
                <details className={styles.optionalParams}>
                  <summary>高级参数（可选，已有默认值）</summary>
                  {selectedTool.inputs
                    .filter((inp) => !inp.required)
                    .map((inp) => (
                      <div key={inp.id} className={styles.formField}>
                        <label>{inp.label}</label>
                        {inp.type === 'file' && (
                          <>
                            <input
                              type="file"
                              accept={inp.accept}
                              onChange={(e) =>
                                handleFileChange(inp.id, e.target.files?.[0] || null)
                              }
                            />
                            {fileNames[inp.id] && (
                              <span className={styles.fileName}>{fileNames[inp.id]}</span>
                            )}
                          </>
                        )}
                        {inp.type === 'select' && (
                          <select
                            value={params[inp.id] || ''}
                            onChange={(e) => setParams((p) => ({ ...p, [inp.id]: e.target.value }))}
                          >
                            {inp.options?.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        )}
                        {inp.type === 'number' && (
                          <input
                            type="number"
                            value={params[inp.id] ?? ''}
                            placeholder={inp.placeholder}
                            step="any"
                            onChange={(e) =>
                              setParams((p) => ({ ...p, [inp.id]: parseFloat(e.target.value) }))
                            }
                          />
                        )}
                        {inp.type === 'text' && (
                          <input
                            type="text"
                            value={params[inp.id] || ''}
                            placeholder={inp.placeholder}
                            onChange={(e) => setParams((p) => ({ ...p, [inp.id]: e.target.value }))}
                          />
                        )}
                        {inp.hint && <span className={styles.fieldHint}>{inp.hint}</span>}
                      </div>
                    ))}
                </details>
              )}
            </div>
          </div>
        )}

        {(status === 'uploading' || status === 'pending' || status === 'running') && (
          <div className={styles.progressBar}>
            <div className={styles.spinner} />
            <div className={styles.progressSteps}>
              <span
                className={
                  status === 'uploading' ? styles.progressStepActive : styles.progressStepDone
                }
              >
                ① 提交
              </span>
              <span
                className={
                  status === 'pending'
                    ? styles.progressStepActive
                    : status === 'running'
                      ? styles.progressStepDone
                      : styles.progressStepPending
                }
              >
                ② 排队
              </span>
              <span
                className={
                  status === 'running' ? styles.progressStepActive : styles.progressStepPending
                }
              >
                ③ 执行
              </span>
              <span className={styles.progressStepPending}>④ 完成</span>
            </div>
            <span className={styles.progressHintInline}>
              预计 {selectedTool?.estimatedMinutes || 2} 分钟
            </span>
          </div>
        )}

        {status === 'completed' && !activeResult && (
          <div
            className={styles.progressBar}
            style={{ background: 'var(--biof3-status-success-bg)', borderColor: 'var(--biof3-status-success-fg)' }}
          >
            <span>✓ 分析完成，加载结果中...</span>
          </div>
        )}

        {status === 'failed' && (
          <div className={styles.errorPanel}>
            <h3>分析失败</h3>
            <pre className={styles.errorPre}>{error}</pre>
            <button
              className={styles.retryBtn}
              onClick={() => {
                setStatus('idle');
                setError(null);
                setActiveJob(null);
              }}
            >
              重新配置
            </button>
          </div>
        )}

        {status === 'completed' && activeResult && (
          <div className={styles.resultPanel}>
            <div className={styles.resultHeader}>
              <h3>{selectedTool?.title || '分析完成'}</h3>
              <div className={styles.resultHeaderRight}>
                {getStoredUser()?.role === 'admin' && (
                  <button
                    className={styles.demoTag}
                    onClick={async () => {
                      const jid = jobId || activeJob?.id;
                      if (!jid) return;
                      const tk = getToken();
                      await fetch(getApiPrefix() + '/tools/job/' + jid + '/public', {
                        method: 'PUT',
                        headers: {
                          'Content-Type': 'application/json',
                          ...(tk ? { Authorization: 'Bearer ' + tk } : {}),
                        },
                        body: JSON.stringify({ is_public: true }),
                      });
                      alert('已设为公开 Demo');
                    }}
                  >
                    设为 Demo
                  </button>
                )}
                {selectedTool && (
                  <span className={styles.tutorialLink} style={{ opacity: 0.5, pointerEvents: 'none' }}>
                    {/* 桌面端已移除教程入口，"查看教程"链接已禁用。如需恢复取消下面注释即可。 */}
                    {/* <Link to={selectedTool.tutorialUrl} className={styles.tutorialLink}>
                      查看教程 →
                    </Link> */}
                  </span>
                )}
              </div>
            </div>

            {activeResult.summary && (
              <div className={styles.resultSummary}>
                {Object.entries(activeResult.summary).map(([k, v]) => (
                  <div key={k} className={styles.resultStat}>
                    <span className={styles.resultStatValue}>{String(v)}</span>
                    <span className={styles.resultStatLabel}>{k}</span>
                  </div>
                ))}
              </div>
            )}

            <ResultTabs
              files={activeResult.files || []}
              buildUrl={(name: string) =>
                `${apiBase}/tools/file/${jobId || activeJob?.id}/${name}${token ? '?token=' + token : ''}`
              }
              onReport={() =>
                setReportUrl(
                  `${apiBase}/tools/file/${jobId || activeJob?.id}/report.html${token ? '?token=' + token : ''}`
                )
              }
            />
          </div>
        )}
      </main>

      {/* Right resize handle (between center and right panel) */}
      <div className={styles.resizeHandle} onMouseDown={_onResizeRight} title="拖拽调整宽度" />

      {/* Right: Tool palette (grid column, no longer floating) */}
      <aside className={styles.rightToolbar}>
        <div className={styles.toolbarTitle}>工具</div>
        <div className={styles.toolGrid}>
          {toolCategories.map((cat) => {
            const catTools = tools.filter((t) => t.category === cat);
            if (catTools.length === 0) return null;
            return (
              <React.Fragment key={cat}>
                <div className={styles.toolGridCatLabel}>{cat}</div>
                {catTools.map((t) => {
                  const img = TOOL_IMAGES[t.id];
                  return (
                    <button
                      key={t.id}
                      className={`${styles.toolIcon} ${selectedTool?.id === t.id ? styles.toolIconActive : ''}`}
                      style={
                        { '--tool-color': TOOL_COLORS[t.id] || '#6b7280' } as React.CSSProperties
                      }
                      onClick={() => selectTool(t)}
                      title={t.comingSoon ? `${t.title}（开发中,Wave 2-4 上线）` : t.title}
                    >
                      {img ? (
                        <img
                          src={img}
                          alt={t.title}
                          className={styles.toolIconCover}
                          loading="lazy"
                        />
                      ) : (
                        <span className={styles.toolIconCircle}>{t.title[0]}</span>
                      )}
                      <span className={styles.toolIconLabel}>
                        {t.title}
                        {t.comingSoon && (
                          <span style={{ fontSize: 9, color: 'var(--biof3-status-warning-fg)', marginLeft: 4 }}>🚧</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
      </aside>

      <LoginModal open={showLogin} onClose={() => setShowLogin(false)} />

      {/* Report Modal */}
      {reportUrl && (
        <div className={styles.modalOverlay} onClick={() => setReportUrl(null)}>
          <div className={styles.reportModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>结果解读报告</h2>
              <div className={styles.modalHeaderActions}>
                <button
                  className={styles.demoBtn}
                  onClick={() => {
                    try {
                      const ifr = document.querySelector(
                        `.${styles.reportIframe}`
                      ) as HTMLIFrameElement | null;
                      if (ifr && ifr.contentWindow) {
                        ifr.contentWindow.focus();
                        ifr.contentWindow.print();
                      } else {
                        // Fallback: open in new tab and print there
                        const w = window.open(reportUrl, '_blank');
                        if (w) {
                          w.addEventListener('load', () => {
                            try {
                              w.print();
                            } catch {}
                          });
                        }
                      }
                    } catch {
                      alert('打印失败,请尝试在新标签页打开报告后使用 Ctrl/Cmd+P');
                    }
                  }}
                  title="打印或另存为 PDF"
                >
                  🖨 打印 / PDF
                </button>
                <a
                  href={reportUrl}
                  download={`${selectedTool?.title || demoToolId || 'BioF3'}-解读报告.html`}
                  className={styles.demoBtn}
                >
                  下载 HTML
                </a>
                <button className={styles.modalClose} onClick={() => setReportUrl(null)}>
                  ×
                </button>
              </div>
            </div>
            <iframe src={reportUrl} className={styles.reportIframe} title="报告" />
          </div>
        </div>
      )}

    </div>
  );
}

function ResultTabs({
  files,
  buildUrl,
  onReport,
}: {
  files: Array<{ name: string; type: string; label?: string; url?: string }>;
  buildUrl: (name: string) => string;
  onReport?: () => void;
}) {
  const [tab, setTab] = useState<'plots' | 'files'>('plots');
  const [previewData, setPreviewData] = useState<string[][] | null>(null);
  const [previewName, setPreviewName] = useState<string>('');
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const plots = files.filter((f) => f.type === 'plot');
  const tables = files.filter((f) => f.type === 'table' || f.type === 'file' || f.type === 'text');

  const previewCsv = useCallback(
    async (name: string) => {
      try {
        const resp = await fetch(buildUrl(name));
        const text = await resp.text();
        const sep = text.includes('\t') ? '\t' : ',';
        const rows = text
          .split('\n')
          .filter((l) => l.trim())
          .slice(0, 20)
          .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setPreviewData(rows);
        setPreviewName(name);
      } catch {
        setPreviewData(null);
      }
    },
    [buildUrl]
  );

  return (
    <>
      <div className={styles.resultTabs}>
        <button
          className={`${styles.resultTab} ${tab === 'plots' ? styles.resultTabActive : ''}`}
          onClick={() => setTab('plots')}
        >
          图表 ({plots.length})
        </button>
        <button
          className={`${styles.resultTab} ${tab === 'files' ? styles.resultTabActive : ''}`}
          onClick={() => setTab('files')}
        >
          数据文件 ({tables.length})
        </button>
        {onReport && (
          <button className={styles.demoTag} onClick={onReport} style={{ marginLeft: 'auto' }}>
            报告
          </button>
        )}
      </div>

      {tab === 'plots' && (
        <div className={styles.plotCardGrid}>
          {plots.map((f, idx) => {
            return (
              <div key={f.name} className={styles.plotCard}>
                <div className={styles.plotCardHeader}>
                  <span className={styles.plotCardNum}>图{idx + 1}</span>
                  <span className={styles.plotCardLabel}>
                    {f.label || f.name.replace('.png', '')}
                  </span>
                </div>
                <div className={styles.plotCardImg}>
                  <img
                    src={buildUrl(f.name)}
                    alt={f.label || f.name}
                    onClick={() => setLightboxSrc(buildUrl(f.name))}
                    style={{ cursor: 'zoom-in' }}
                  />
                </div>
                <div className={styles.plotCardFooter}>
                  <div className={styles.plotCardActions}>
                    <a href={buildUrl(f.name)} download className={styles.plotCardBtn}>
                      PNG
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'files' && (
        <div className={styles.fileCardGrid}>
          {tables.map((f) => (
            <div key={f.name} className={styles.fileCard}>
              <div className={styles.fileCardIcon}>
                {f.type === 'table' ? '📋' : f.type === 'text' ? '📝' : '📦'}
              </div>
              <div className={styles.fileCardName}>{f.label || f.name}</div>
              <div className={styles.fileCardDesc}>{f.name}</div>
              <div className={styles.fileCardActions}>
                <a href={buildUrl(f.name)} download className={styles.plotCardBtn}>
                  下载
                </a>
                {f.name.endsWith('.csv') && (
                  <button className={styles.plotCardBtnPrimary} onClick={() => previewCsv(f.name)}>
                    预览
                  </button>
                )}
              </div>
            </div>
          ))}
          {tables.length === 0 && <p style={{ color: 'var(--biof3-text-muted)', fontSize: 12 }}>暂无数据文件</p>}
        </div>
      )}

      {/* CSV Preview Modal */}
      {previewData && (
        <div className={styles.modalOverlay} onClick={() => setPreviewData(null)}>
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '90vw', width: 800 }}
          >
            <div className={styles.modalHeader}>
              <h2>{previewName}（前 20 行）</h2>
              <div className={styles.modalHeaderActions}>
                <a href={buildUrl(previewName)} download className={styles.demoBtn}>
                  下载完整文件
                </a>
                <button className={styles.modalClose} onClick={() => setPreviewData(null)}>
                  ×
                </button>
              </div>
            </div>
            <div style={{ padding: 16, overflow: 'auto', maxHeight: '60vh' }}>
              <table className={styles.paramsTable} style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                <tbody>
                  {previewData.map((row, i) => (
                    <tr key={i} style={i === 0 ? { fontWeight: 600, background: '#f8faf9' } : {}}>
                      {row.slice(0, 10).map((c, j) => (
                        <td key={j}>{c.length > 20 ? c.slice(0, 20) + '…' : c}</td>
                      ))}
                      {row.length > 10 && <td>…</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </>
  );
}

// ---- Demo tabs (single-cell style: 数据预览 | 图表 | 数据文件 | 参数) ----
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function DemoTabs({
  demoFiles,
  demoToolId,
}: {
  demoFiles: Array<{ name: string; type: string; url: string }>;
  demoToolId: string;
}) {
  const [tab, setTab] = useState<'plots' | 'files' | 'params'>('plots');
  const plots = demoFiles.filter((f) => f.type === 'plot');
  const tables = demoFiles.filter((f) => f.type === 'table' || f.type === 'file');
  const tool = (staticTools as any).find((t: any) => t.id === demoToolId);
  const apiBase = getApiPrefix(tool?.language === 'python' ? 'python' : 'r');

  return (
    <>
      <div className={styles.resultTabs}>
        <button
          className={`${styles.resultTab} ${tab === 'plots' ? styles.resultTabActive : ''}`}
          onClick={() => setTab('plots')}
        >
          图表 ({plots.length})
        </button>
        <button
          className={`${styles.resultTab} ${tab === 'files' ? styles.resultTabActive : ''}`}
          onClick={() => setTab('files')}
        >
          数据文件 ({tables.length})
        </button>
        <button
          className={`${styles.resultTab} ${tab === 'params' ? styles.resultTabActive : ''}`}
          onClick={() => setTab('params')}
        >
          参数
        </button>
      </div>

      {tab === 'plots' && (
        <div className={styles.plotCardGrid}>
          {plots.map((f) => {
            return (
              <div key={f.name} className={styles.plotCard}>
                <div className={styles.plotCardImg}>
                  <img src={`${apiBase}${f.url}`} alt={f.name} />
                </div>
                <div className={styles.plotCardFooter}>
                  <span className={styles.plotCardLabel}>{f.name.replace('.png', '')}</span>
                  <div className={styles.plotCardActions}>
                    <a href={`${apiBase}${f.url}`} download className={styles.plotCardBtn}>
                      PNG
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'files' && (
        <div className={styles.fileList}>
          {tables.map((f) => (
            <a key={f.name} href={`${apiBase}${f.url}`} download className={styles.fileItem}>
              <span className={styles.fileIcon}>{f.name.endsWith('.csv') ? '📋' : '📦'}</span>
              <div className={styles.fileInfo}>
                <span className={styles.fileItemName}>{f.name}</span>
                <span className={styles.fileItemDesc}>
                  {f.name.endsWith('.csv') ? '表格数据（CSV）' : '文件'}
                </span>
              </div>
            </a>
          ))}
          {tables.length === 0 && <p style={{ color: 'var(--biof3-text-muted)', fontSize: 12 }}>暂无数据文件</p>}
        </div>
      )}

      {tab === 'params' && tool && (
        <div className={styles.paramsView}>
          <table className={styles.paramsTable}>
            <tbody>
              <tr>
                <td>工具</td>
                <td>{tool.title}</td>
              </tr>
              <tr>
                <td>语言</td>
                <td>{tool.language === 'r' ? 'R' : 'Python'}</td>
              </tr>
              <tr>
                <td>依赖包</td>
                <td>{tool.packages.join(', ')}</td>
              </tr>
              <tr>
                <td>预计耗时</td>
                <td>~{tool.estimatedMinutes} 分钟</td>
              </tr>
              {/* 桌面端已移除教程入口，"关联教程"行已删除。如需恢复取消下面注释即可。 */}
              {/* <tr>
                <td>关联教程</td>
                <td>
                  <a href={tool.tutorialUrl}>{tool.tutorialUrl}</a>
                </td>
              </tr> */}
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: 'var(--biof3-text-secondary)', marginTop: 12 }}>{tool.longDescription}</p>
        </div>
      )}
    </>
  );
}

export default function ToolsPage(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="分析工具"
        subtitle="BioF3 本地组学分析工具"
        icon="bar-chart"
        breadcrumb={[{ label: '首页', href: '/' }, { label: '分析工具' }]}
      />
      <ToolsInner />
    </>
  );
}
