/**
 * Home — 桌面版启动入口
 *
 * 有项目时直接进入最近项目的工作台，
 * 没有项目时才保留创建项目的启动页。
 *
 * ⚠️ 首次运行死锁修复（见 .workbuddy/memory）：
 * 项目列表走 biof3-server(:3001)，而 biof3-server 需要 R 运行时；R 运行时又只能从
 * 插件商店安装，而商店此前唯一入口在「项目工作台」内部 —— 于是形成死锁：
 *   没装 R → 进不了工作台 → 进不了工作台就装不了 R。
 * 修复：检测到 R 运行时缺失时，本页直接渲染「首次配置」引导页，并内嵌
 * PluginStorePanel（纯 IPC，不依赖任何 HTTP 后端），装完就地重启应用。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { useBackendStatus } from '@/components/backend/BackendStatusProvider';
import { PluginStorePanel } from '@/components/desktop/PluginStorePanel';
import { FolderPicker } from '@/components/desktop/FolderPicker';
import { createProject, listProjectJobs, listProjects, listSshTargetCandidates, validateSshProject, type SshTargetCandidate } from '@/lib/project-store';
import type { Project, ToolJob } from '@/lib/project-types';
import styles from './home.module.css';

function pickRecentProject(projects: Project[]): Project | null {
  if (projects.length === 0) return null;
  return [...projects].sort((a, b) => {
    const bt = new Date(b.updatedAt || b.createdAt || 0).getTime();
    const at = new Date(a.updatedAt || a.createdAt || 0).getTime();
    return bt - at;
  })[0] || null;
}

function pickRecentCompletedJob(jobs: ToolJob[], projects: Project[]): ToolJob | null {
  const projectIds = new Set(projects.map((project) => project.id));
  return (
    [...jobs]
      .filter((job) => job.project_id && projectIds.has(job.project_id) && job.status === 'done')
      .sort((a, b) => {
        const bt = b.completed_at || b.created_at || 0;
        const at = a.completed_at || a.created_at || 0;
        return bt - at;
      })[0] || null
  );
}

export default function Home(): React.ReactElement {
  const backendStatus = useBackendStatus();
  const navigate = useNavigate();
  const location = useLocation();
  // UI-258 — 应用冷启动（location.key === 'default'）保持自动跳最近项目；
  // 应用内导航到 / 时渲染工作台（项目列表 + 常驻创建入口）。
  const isInitialEntry = location.key === 'default';
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [projects, setProjects] = useState<Project[]>([]);
  const [targetProjectId, setTargetProjectId] = useState<string | null>(null);
  const [targetJobId, setTargetJobId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // UI-258 — 空白项目：只填名字创建，工作目录稍后在项目内设置/更换
  const [blankName, setBlankName] = useState('');
  // BLOCK-67 — SSH 远程项目创建（UI-321）：目标选择 + 远程路径 + 创建前校验
  const [sshOpen, setSshOpen] = useState(false);
  const [sshTargets, setSshTargets] = useState<SshTargetCandidate[]>([]);
  const [sshAlias, setSshAlias] = useState('');
  const [sshRemotePath, setSshRemotePath] = useState('');
  const [sshValidating, setSshValidating] = useState(false);
  const [sshValidated, setSshValidated] = useState(false);
  // BLOCK-67 加映（UI-326）— IP+密码 引导模式（密码一次性装公钥，绝不存储）
  const [sshMode, setSshMode] = useState<'alias' | 'password'>('alias');
  const [sshIp, setSshIp] = useState('');
  const [sshPort, setSshPort] = useState('22');
  const [sshUsername, setSshUsername] = useState('root');
  const [sshPassword, setSshPassword] = useState('');
  const [sshRegistering, setSshRegistering] = useState(false);
  // UI-251 — 创建失败可见化（桥缺失/对话框失败/接口报错）
  const [createError, setCreateError] = useState('');
  // UI-253 — 选定工作目录后的创建确认（具体路径可见、可反悔）
  const [pendingWorkspace, setPendingWorkspace] = useState<{ path: string; name: string } | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [storeOpen, setStoreOpen] = useState(false);
  const [relaunching, setRelaunching] = useState(false);
  // 后端就绪等待超时 —— 避免"永远转圈"的无出路状态
  const [waitedTooLong, setWaitedTooLong] = useState(false);

  useEffect(() => {
    if (!backendStatus.isReady) return;
    let cancelled = false;
    (async () => {
      try {
        const projects = await listProjects();
        if (cancelled) return;
        setProjects(projects);
        const jobsByProject = await Promise.all(
          projects.map((project) => listProjectJobs(project.id).catch(() => []))
        );
        if (cancelled) return;
        const jobs = jobsByProject.flat();
        const recentJob = pickRecentCompletedJob(jobs, projects);
        if (recentJob?.project_id) {
          setTargetProjectId(recentJob.project_id);
          setTargetJobId(recentJob.id);
          setStatus('ready');
          return;
        }
        const recent = pickRecentProject(projects);
        setTargetProjectId(recent?.id || null);
        setTargetJobId(null);
        setStatus('ready');
      } catch {
        if (cancelled) return;
        setTargetProjectId(null);
        setTargetJobId(null);
        setStatus('error');
        return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backendStatus.isReady, loadAttempt]);

  // 后端久等未起 → 放出「打开插件商店 / 重启」出路，不再干转圈。
  // 阈值取 30s：dev 冷启动（Vite 全量编译 + Electron 框架准备 + native 模块加载）
  // 实测可达 10s+，12s 会把"后端正在启动"误判成"运行时缺失"而错弹首次配置页。
  useEffect(() => {
    if (backendStatus.isReady) {
      setWaitedTooLong(false);
      return;
    }
    const timer = setTimeout(() => setWaitedTooLong(true), 30000);
    return () => clearTimeout(timer);
  }, [backendStatus.isReady]);

  const handleCreateProject = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setCreateError('');
    try {
      // UI-251 — 创建失败不再静默：桥缺失/对话框失败/接口报错都要有可见反馈
      const dialog = window.biof3Desktop?.files?.openDirectoryDialog;
      if (typeof dialog !== 'function') {
        setCreateError('当前运行环境不支持选择工作目录（请在 Gewu 桌面应用中使用）。');
        return;
      }
      const selectedPath = await dialog();
      if (!selectedPath) return;
      const normalizedPath = selectedPath.replace(/[\\/]+$/, '');
      const name = normalizedPath.split(/[\\/]/).pop()?.trim() || '新项目';
      // UI-253 — 选定目录先确认再创建：具体项目路径可见、可反悔
      setPendingWorkspace({ path: selectedPath, name });
    } catch (e) {
      setCreateError(`创建项目失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCreating(false);
    }
  }, [creating]);

  // UI-257 — 手动输入路径：目录选择面板被系统禁用「打开」按钮时的兜底通道
  const [manualPathOpen, setManualPathOpen] = useState(false);
  const [manualPath, setManualPath] = useState('');
  const [manualValidating, setManualValidating] = useState(false);
  // UI-259 — 应用内「选择文件夹」展开状态
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseFrom, setBrowseFrom] = useState('');

  const confirmManualPath = useCallback(async () => {
    if (manualValidating) return;
    const validate = window.biof3Desktop?.files?.validateDirectory;
    if (typeof validate !== 'function') {
      setCreateError('当前运行环境不支持路径校验（请在 Gewu 桌面应用中使用）。');
      return;
    }
    setManualValidating(true);
    setCreateError('');
    try {
      const res = await validate(manualPath);
      if (!res.ok || !res.data?.path) {
        setCreateError(res.error || '路径校验失败');
        return;
      }
      const finalPath = res.data.path;
      const name = finalPath.split(/[\\/]/).pop()?.trim() || '新项目';
      setPendingWorkspace({ path: finalPath, name });
      setManualPathOpen(false);
      setManualPath('');
    } catch (e) {
      setCreateError(`路径校验失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setManualValidating(false);
    }
  }, [manualPath, manualValidating]);

  // UI-258 — 空白项目：只填名字创建（工作目录缺省由后端分配，可稍后设置/更换）
  const createBlankProject = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setCreateError('');
    try {
      const name = blankName.trim() || `项目-${new Date().toISOString().slice(5, 16).replace('T', '-')}`;
      const project = await createProject({ name, modality: 'general' });
      setBlankName('');
      navigate(`/project/${project.id}`, { replace: true });
    } catch (e) {
      setCreateError(`创建项目失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCreating(false);
    }
  }, [blankName, creating, navigate]);

  const confirmCreatePending = useCallback(async () => {
    if (!pendingWorkspace || creating) return;
    setCreating(true);
    setCreateError('');
    try {
      const project = await createProject({
        name: pendingWorkspace.name,
        modality: 'general',
        workspacePath: pendingWorkspace.path,
      });
      setPendingWorkspace(null);
      navigate(`/project/${project.id}`, { replace: true });
    } catch (e) {
      setCreateError(`创建项目失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCreating(false);
    }
  }, [creating, navigate, pendingWorkspace]);

  // BLOCK-53 P1 — 拖拽目录直达创建：拖入的路径走与手动路径相同的校验链
  //（validateDirectory），通过后进 UI-253 既有确认面板 —— 拖拽降低的只是
  // 「打开系统选择器」的成本，确认与反悔环节不减少。
  const acceptDroppedPath = useCallback(async (rawPath: string | null) => {
    if (!rawPath) {
      setCreateError('无法读取拖入项的路径（请拖入文件夹）。');
      return;
    }
    const validate = window.biof3Desktop?.files?.validateDirectory;
    if (typeof validate !== 'function') {
      setCreateError('当前运行环境不支持路径校验（请在 Gewu 桌面应用中使用）。');
      return;
    }
    try {
      const res = await validate(rawPath);
      if (!res.ok || !res.data?.path) {
        setCreateError(res.error || '拖入的路径校验失败');
        return;
      }
      const finalPath = res.data.path;
      const name = finalPath.split(/[\\/]/).pop()?.trim() || '新项目';
      setPendingWorkspace({ path: finalPath, name });
    } catch (e) {
      setCreateError(`拖入路径校验失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  // BLOCK-53 P1 — Home 挂载期接管窗口级文件拖入：Chromium 默认行为是导航到
  // 拖入的文件路径，必须对 dragover/drop 双双 preventDefault；drop 取第一个
  // 拖入项，经 preload 的 pathForFile（webUtils）解析磁盘绝对路径。
  useEffect(() => {
    const prevent = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file) {
        void acceptDroppedPath(null);
        return;
      }
      const pathFor = window.biof3Desktop?.files?.pathForFile;
      const raw = typeof pathFor === 'function'
        ? pathFor(file)
        : (file as File & { path?: string }).path || null;
      void acceptDroppedPath(raw);
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', onDrop);
    };
  }, [acceptDroppedPath]);

  // BLOCK-67（UI-321）— SSH 远程项目创建流：目标发现 → 校验（agent 部署 + 路径验证）→ 创建。
  // 打开面板时拉目标候选（注册表 + ~/.ssh/config 发现，单一真相在后端）。
  const openSshPanel = useCallback(async () => {
    setSshOpen(true);
    setSshValidated(false);
    setCreateError('');
    try {
      const targets = await listSshTargetCandidates();
      setSshTargets(targets);
    } catch (e) {
      setCreateError(`目标列表获取失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const confirmCreateSsh = useCallback(async () => {
    if (creating || sshValidating || sshRegistering) return;
    const remotePath = sshRemotePath.trim();
    if (!remotePath.startsWith('/')) {
      setCreateError('请填写以 / 开头的远程绝对路径');
      return;
    }
    setSshValidating(true);
    setCreateError('');
    try {
      let alias = sshAlias.trim();
      // UI-326 密码模式：先一次性装公钥 + 生成别名（密码只在主进程内存），再走同一条校验+创建链
      if (sshMode === 'password') {
        const ip = sshIp.trim();
        if (!ip || !/^\d+$/.test(sshPort) || Number(sshPort) < 1 || Number(sshPort) > 65535 || !sshUsername.trim() || !sshPassword) {
          setCreateError('请完整填写 IP、端口（1-65535）、用户名与密码');
          return;
        }
        setSshRegistering(true);
        const desktop = (window as unknown as { biof3Desktop?: { ssh?: { registerHost: (p: { ip: string; port: number; username: string; password: string }) => Promise<{ ok: boolean; alias?: string; error?: string }> } } });
        const bridge = desktop.biof3Desktop?.ssh ?? (window as unknown as { gewu?: { ssh?: { registerHost: (p: { ip: string; port: number; username: string; password: string }) => Promise<{ ok: boolean; alias?: string; error?: string }> } } }).gewu?.ssh;
        if (!bridge?.registerHost) {
          setCreateError('当前运行环境不支持密码引导连接（请升级 Gewu 桌面端）');
          return;
        }
        const reg = await bridge.registerHost({ ip, port: Number(sshPort), username: sshUsername.trim(), password: sshPassword });
        if (!reg.ok || !reg.alias) {
          setCreateError(`主机注册失败：${reg.error || '未知错误'}`);
          return;
        }
        alias = reg.alias;
        setSshAlias(alias);
        // 密码用完即弃
        setSshPassword('');
      }
      if (!alias) {
        setCreateError('请填写 SSH 主机别名');
        return;
      }
      const verdict = await validateSshProject({ alias, remotePath });
      if (!verdict.ok) {
        setCreateError(verdict.retryable
          ? `远程连接失败（可重试）：${verdict.error}`
          : `远程路径校验失败：${verdict.error}`);
        return;
      }
      setSshValidated(true);
      setCreating(true);
      const name = remotePath.split('/').filter(Boolean).pop() || alias;
      const project = await createProject({ name, modality: 'general', workspaceKind: 'ssh', sshHost: alias, remotePath });
      setSshOpen(false);
      setSshAlias('');
      setSshRemotePath('');
      setSshIp('');
      setSshPassword('');
      setSshMode('alias');
      navigate(`/project/${project.id}`, { replace: true });
    } catch (e) {
      setCreateError(`SSH 项目创建失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSshValidating(false);
      setSshRegistering(false);
      setCreating(false);
    }
  }, [creating, navigate, sshAlias, sshIp, sshMode, sshPort, sshRemotePath, sshRegistering, sshUsername, sshPassword, sshValidating]);

  const handleRelaunch = useCallback(async () => {
    if (relaunching) return;
    setRelaunching(true);
    try {
      await window.biof3Desktop?.app?.relaunch?.();
    } finally {
      // relaunch 成功时进程已退出，这里只兜底 relaunch 不可用的情况
      setRelaunching(false);
    }
  }, [relaunching]);

  // ── 启动/配置引导页：两类截然不同的状态，必须分开处理 ──
  // ① runtimeMissing：R 运行时**确认缺失**（backend:status 显式返回 false）。
  //    此时才需要去插件商店装运行时 —— 真正的"首次配置"场景。
  // ② backendNotReady：状态已检测（loaded=true）但后端 30s 仍未就绪（biof3-server
  //    没起来）。这是"后端启动慢/启动失败"，**不是**缺运行时 —— 误导用户去装
  //    运行时毫无意义，应给"重试/重启"出路，文案明确说"本地分析服务未启动"。
  // 注：runtimeMissing 用 `=== false` 而非 `!rRuntime`，因为 rRuntime 为 null
  // （检测异常/未知）时不能当成缺失，否则偶发 IPC 异常会错弹配置页。
  const runtimeMissing = backendStatus.loaded && backendStatus.rRuntime === false;
  const backendNotReady = backendStatus.loaded && !backendStatus.isReady && waitedTooLong;
  // BLOCK-66 P2 — R 缺失不再阻塞：runtimeMissing 只产生非阻塞引导条（runtimeBanner），
  // 全屏门仅保留「后端服务确实未就绪」场景（backendNotReady）。
  // 注：R 缺失时主进程 backend:status 仍会返回 isReady=true（BLOCK-66 P1 语义解绑），
  // 此处 runtimeMissing 只驱动引导条，不影响进入应用。
  const needsSetupGate = backendNotReady;

  if (needsSetupGate && status !== 'ready') {
    // ── BLOCK-66 P2：门内只剩「后端服务确实未就绪」场景 ──
    // R 缺失已改为非阻塞引导条（见下方 runtimeBanner），不再整页拦截。
    return (
      <section className={styles.setupHome} aria-label="本地分析服务未启动">
        <div className={styles.setupIcon}>
          <Icon name="cpu" size={26} />
        </div>
        <h1>本地分析服务未就绪</h1>
        <p className={styles.setupLead}>
          本次启动中后端服务未在预期时间内连上。这与「是否安装分析运行时」无关 ——
          未安装运行时只是分析功能受限，不影响进入应用与通用功能。
        </p>

        <div className={styles.setupChecklist}>
          <div className={`${styles.setupCheckItem} ${backendStatus.rRuntime ? styles.setupCheckOk : ''}`}>
            <Icon name={backendStatus.rRuntime ? 'check' : 'cpu'} size={15} />
            <span className={styles.setupCheckName}>R 运行时</span>
            <span className={styles.setupCheckMeta}>分析功能组件</span>
            <span className={styles.setupCheckState}>
              {backendStatus.rRuntime ? '已安装' : '未安装'}
            </span>
          </div>
          <div className={`${styles.setupCheckItem} ${backendStatus.pyRuntime ? styles.setupCheckOk : ''}`}>
            <Icon name={backendStatus.pyRuntime ? 'check' : 'cpu'} size={15} />
            <span className={styles.setupCheckName}>Python 运行时</span>
            <span className={styles.setupCheckMeta}>分析功能组件</span>
            <span className={styles.setupCheckState}>
              {backendStatus.pyRuntime ? '已安装' : '未安装'}
            </span>
          </div>
        </div>

        <div className={styles.setupActions}>
          <button
            type="button"
            className={styles.setupPrimary}
            onClick={() => {
              setWaitedTooLong(false);
              setLoadAttempt((value) => value + 1);
            }}
          >
            <Icon name="refresh" size={15} />
            重试连接
          </button>
          <button
            type="button"
            className={styles.setupSecondary}
            onClick={() => void handleRelaunch()}
            disabled={relaunching}
          >
            {relaunching ? '正在重启…' : '重启应用'}
          </button>
        </div>

        {backendStatus.downReason && (
          <p className={styles.setupReason}>{backendStatus.downReason}</p>
        )}
      </section>
    );
  }

  // BLOCK-66 P2 — 非阻塞引导条：R 缺失只提示不拦截（对话/文件等通用功能不受影响），
  // 安装入口走插件商店 overlay；装完重启应用即恢复分析功能。
  const runtimeBanner = runtimeMissing ? (
    <div className={styles.runtimeBanner} role="status">
      <Icon name="cpu" size={15} />
      <span className={styles.runtimeBannerText}>
        R 分析运行时未安装 —— 对话、文件等通用功能不受影响；运行 R 类分析工具需安装 R 运行时（约 657MB）。
      </span>
      <button
        className="gewu-btn gewu-btn--ghost gewu-btn--sm"
        type="button"
        onClick={() => setStoreOpen(true)}
      >
        <Icon name="puzzle" size={14} />
        前往安装
      </button>
    </div>
  ) : null;

  const storeOverlay = storeOpen ? (
    <div className={`${styles.setupStoreShell} ${styles.setupStoreShellOverlay}`}>
      <div className={styles.setupStoreFrame}>
        <PluginStorePanel onClose={() => setStoreOpen(false)} />
      </div>
      {backendStatus.rRuntime && (
        <div className={styles.setupStoreFooter}>
          <span>
            <Icon name="check" size={14} /> R 运行时已就绪，重启应用即可开始分析
          </span>
          <button className="gewu-btn gewu-btn--ghost gewu-btn--sm" type="button" onClick={() => void handleRelaunch()} disabled={relaunching}>
            {relaunching ? '正在重启…' : '立即重启应用'}
          </button>
        </div>
      )}
    </div>
  ) : null;

  if (status === 'loading') {
    return (
      <div className={styles.homeState} aria-label="正在启动 Gewu">
        <span className={styles.homeStateDot} />
        <span>{backendStatus.downReason || '正在准备项目工作台…'}</span>
      </div>
    );
  }

  // UI-258 — 创建控制区（空首页与工作台共用）：确认面板 / 选目录 / 手动输路径
  const createControls = (
    <>
      {pendingWorkspace ? (
        <>
          <p className={styles.emptyHomePendingLabel}>将在以下目录创建项目：</p>
          <p className={styles.emptyHomePendingPath} title={pendingWorkspace.path}>
            {pendingWorkspace.path}
          </p>
          <p className={styles.emptyHomePendingLabel}>
            项目名：<strong>{pendingWorkspace.name}</strong>
          </p>
          <div className={styles.emptyHomePendingActions}>
            <button
              className="gewu-btn gewu-btn--sm"
              type="button"
              onClick={() => void confirmCreatePending()}
              disabled={creating}
            >
              {creating ? '创建中…' : '在此处创建'}
            </button>
            <button
              className="gewu-btn gewu-btn--ghost gewu-btn--sm"
              type="button"
              onClick={() => setPendingWorkspace(null)}
              disabled={creating}
            >
              重新选择
            </button>
          </div>
        </>
      ) : (
        <>
          <button className="gewu-btn gewu-btn--ghost gewu-btn--sm" type="button" onClick={() => void handleCreateProject()} disabled={creating}>
            {creating ? '创建中…' : '选择工作目录并创建'}
          </button>
          {/* UI-257 — 手动输入路径兜底：目录面板「打开」被系统禁用时可粘贴完整路径 */}
          {!manualPathOpen ? (
            <button
              className="gewu-btn gewu-btn--ghost gewu-btn--sm"
              type="button"
              onClick={() => setManualPathOpen(true)}
              disabled={creating}
            >
              或手动输入路径
            </button>
          ) : (
            <>
              <div className={styles.emptyHomeManual}>
                <input
                  className={styles.emptyHomeManualInput}
                  type="text"
                  value={manualPath}
                  onChange={(e) => setManualPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void confirmManualPath();
                    if (e.key === 'Escape') setManualPathOpen(false);
                  }}
                  placeholder="/Users/you/path/to/project"
                  autoFocus
                  aria-label="项目工作目录完整路径"
                />
                {/* UI-259 — 应用内选择文件夹：点选目录直接得到路径，不依赖系统面板 */}
                <button
                  className="gewu-btn gewu-btn--ghost gewu-btn--sm"
                  type="button"
                  onClick={() => {
                    if (!browseOpen) setBrowseFrom(manualPath);
                    setBrowseOpen((o) => !o);
                  }}
                  aria-expanded={browseOpen}
                  disabled={manualValidating}
                >
                  选择文件夹…
                </button>
                <button
                  className="gewu-btn gewu-btn--sm"
                  type="button"
                  onClick={() => void confirmManualPath()}
                  disabled={manualValidating || !manualPath.trim()}
                >
                  {manualValidating ? '校验中…' : '确认路径'}
                </button>
              </div>
              {browseOpen && (
                <div className={styles.homeFolderPicker}>
                  <FolderPicker
                    initialPath={browseFrom}
                    pickLabel="就选这个文件夹"
                    onPick={(picked) => {
                      setManualPath(picked);
                      setBrowseOpen(false);
                    }}
                    onCancel={() => setBrowseOpen(false)}
                  />
                </div>
              )}
            </>
          )}
          {/* BLOCK-67 UI-321 — SSH 远程项目：项目本体在远程服务器（对标 ZCode SSH 远程连接形态） */}
          {!sshOpen ? (
            <button
              className="gewu-btn gewu-btn--ghost gewu-btn--sm"
              type="button"
              onClick={() => void openSshPanel()}
              disabled={creating}
            >
              SSH 远程项目…
            </button>
          ) : (
            <div className={styles.emptyHomeManual} data-testid="ssh-project-panel" style={{ flexWrap: 'wrap', rowGap: 6 }}>
              {/* UI-326 — 连接模式切换：别名（~/.ssh/config）| IP+密码（一次性装公钥） */}
              <div style={{ display: 'flex', gap: 6, width: '100%' }} role="tablist" aria-label="SSH 连接方式">
                <button
                  type="button"
                  role="tab"
                  aria-selected={sshMode === 'alias'}
                  className={`gewu-btn gewu-btn--sm ${sshMode === 'alias' ? '' : 'gewu-btn--ghost'}`}
                  onClick={() => { setSshMode('alias'); setSshValidated(false); setCreateError(''); }}
                >
                  别名连接
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={sshMode === 'password'}
                  className={`gewu-btn gewu-btn--sm ${sshMode === 'password' ? '' : 'gewu-btn--ghost'}`}
                  onClick={() => { setSshMode('password'); setSshValidated(false); setCreateError(''); }}
                  title="密码只用于一次性安装本机公钥到服务器，之后免密连接；密码不会被保存"
                >
                  IP + 密码连接
                </button>
              </div>
              {sshMode === 'alias' ? (
                <input
                  className={styles.emptyHomeManualInput}
                  type="text"
                  list="block67-ssh-targets"
                  value={sshAlias}
                  onChange={(e) => { setSshAlias(e.target.value); setSshValidated(false); }}
                  placeholder="SSH 主机别名（如 aliyun）"
                  aria-label="SSH 主机别名"
                  style={{ flex: '0 0 10em' }}
                />
              ) : (
                <>
                  <input
                    className={styles.emptyHomeManualInput}
                    type="text"
                    value={sshIp}
                    onChange={(e) => { setSshIp(e.target.value); setSshValidated(false); }}
                    placeholder="主机 IP 或域名"
                    aria-label="主机 IP 或域名"
                    style={{ flex: '0 0 11em' }}
                    autoFocus
                  />
                  <input
                    className={styles.emptyHomeManualInput}
                    type="text"
                    inputMode="numeric"
                    value={sshPort}
                    onChange={(e) => { setSshPort(e.target.value.replace(/[^0-9]/g, '')); setSshValidated(false); }}
                    placeholder="端口"
                    aria-label="SSH 端口"
                    style={{ flex: '0 0 5em' }}
                  />
                  <input
                    className={styles.emptyHomeManualInput}
                    type="text"
                    value={sshUsername}
                    onChange={(e) => { setSshUsername(e.target.value); setSshValidated(false); }}
                    placeholder="用户名"
                    aria-label="SSH 用户名"
                    style={{ flex: '0 0 7em' }}
                  />
                  <input
                    className={styles.emptyHomeManualInput}
                    type="password"
                    value={sshPassword}
                    onChange={(e) => { setSshPassword(e.target.value); setSshValidated(false); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setSshOpen(false);
                    }}
                    placeholder="密码（仅用于首次装公钥，不保存）"
                    aria-label="SSH 密码（仅用于首次安装公钥，不会被保存）"
                    style={{ flex: '1 1 12em' }}
                  />
                </>
              )}
              <datalist id="block67-ssh-targets">
                {sshTargets.map((t) => (
                  <option key={t.alias} value={t.alias}>{t.registered ? `${t.alias}（已注册）` : t.alias}</option>
                ))}
              </datalist>
              <input
                className={styles.emptyHomeManualInput}
                type="text"
                value={sshRemotePath}
                onChange={(e) => { setSshRemotePath(e.target.value); setSshValidated(false); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void confirmCreateSsh();
                  if (e.key === 'Escape') setSshOpen(false);
                }}
                placeholder="/srv/remote/project"
                aria-label="远程项目绝对路径"
              />
              <button
                className="gewu-btn gewu-btn--sm"
                type="button"
                onClick={() => void confirmCreateSsh()}
                disabled={sshValidating || sshRegistering || creating || !sshRemotePath.trim() || (sshMode === 'alias' ? !sshAlias.trim() : (!sshIp.trim() || !sshPassword))}
                title={sshMode === 'password' ? '用密码把本机公钥装到服务器（密码不保存），然后校验远程路径并创建项目' : '先校验远程路径（含 agent 引导部署）再创建'}
              >
                {sshRegistering ? '连接主机中…' : sshValidating ? '校验中…' : sshMode === 'password' ? '连接并创建' : '校验并创建'}
              </button>
              <button
                className="gewu-btn gewu-btn--ghost gewu-btn--sm"
                type="button"
                onClick={() => setSshOpen(false)}
                disabled={sshValidating || sshRegistering || creating}
              >
                取消
              </button>
              {sshValidated && <span aria-live="polite" style={{ fontSize: 12, color: 'var(--color-success, #2e9e5b)' }}>路径有效</span>}
            </div>
          )}
          {/* UI-258 — 空白项目：只填名字创建，工作目录稍后在项目内设置/更换 */}
          <div className={styles.emptyHomeManual}>
            <input
              className={styles.emptyHomeManualInput}
              type="text"
              value={blankName}
              onChange={(e) => setBlankName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createBlankProject();
              }}
              placeholder="项目名（选填，默认自动命名）"
              aria-label="空白项目名称"
            />
            <button
              className="gewu-btn gewu-btn--sm"
              type="button"
              onClick={() => void createBlankProject()}
              disabled={creating}
              title="先不绑定工作目录，创建后在项目内随时设置"
            >
              创建空白项目
            </button>
          </div>
        </>
      )}
      {createError && (
        <p className={styles.emptyHomeError} role="alert">{createError}</p>
      )}
    </>
  );

  // UI-258 — 工作台视图：应用内导航到 / 时展示项目列表 + 常驻创建入口；
  // 冷启动（isInitialEntry）保持原自动跳最近项目行为，不落在这里。
  // UI-259 — 视觉对齐全局设计语言（radial 渐变 + 图标芯片 + 悬浮卡片，同 setupHome）。
  if (status === 'ready' && !isInitialEntry && projects.length > 0) {
    const sorted = [...projects].sort((a, b) => {
      const bt = new Date(b.updatedAt || b.createdAt || 0).getTime();
      const at = new Date(a.updatedAt || a.createdAt || 0).getTime();
      return bt - at;
    });
    return (
      <section className={styles.workbench} aria-label="项目工作台">
        {runtimeBanner}
        {storeOverlay}
        <div className={styles.workbenchHeader}>
          <div className={styles.workbenchIcon}><Icon name="layers" size={24} /></div>
          <h1>工作台</h1>
          <p className={styles.workbenchLead}>选择项目继续，或创建新项目。</p>
        </div>
        <div className={styles.workbenchBody}>
          <div className={styles.workbenchSectionLabel}>项目 · {sorted.length}</div>
          <div className={styles.workbenchGrid}>
            {sorted.map((project) => (
              <button
                key={project.id}
                type="button"
                className={styles.workbenchCard}
                onClick={() => navigate(`/project/${project.id}`)}
                title={project.workspaceKind === 'ssh' ? `${project.sshHost}:${project.remotePath}` : project.workspacePath || project.name}
              >
                <span className={styles.workbenchCardIcon}><Icon name={project.workspaceKind === 'ssh' ? 'cpu' : 'folder'} size={16} /></span>
                <span className={styles.workbenchCardMain}>
                  <span className={styles.workbenchCardName}>
                    {project.name}
                    {project.workspaceKind === 'ssh' && (
                      <span
                        data-testid="ssh-host-badge"
                        title={`SSH 远程项目 · ${project.sshHost}`}
                        style={{
                          marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 8,
                          border: '1px solid currentColor', opacity: 0.75, verticalAlign: 'middle',
                        }}
                      >
                        SSH·{project.sshHost}
                      </span>
                    )}
                  </span>
                  <span className={styles.workbenchCardPath}>
                    {project.workspaceKind === 'ssh'
                      ? `${project.sshHost}:${project.remotePath}`
                      : project.workspacePath || '未设置工作目录 · 可在项目内更改'}
                  </span>
                </span>
                <span className={styles.workbenchCardDate}>
                  {new Date(project.updatedAt || project.createdAt || 0)
                    .toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
                </span>
              </button>
            ))}
          </div>
          <div className={styles.workbenchSectionLabel}>创建新项目</div>
          <div className={styles.workbenchCreate}>
            {createControls}
          </div>
        </div>
      </section>
    );
  }

  if (targetProjectId) {
    if (targetJobId) {
      // BLOCK-10-audit-closeout: home.tsx 的 auto-navigate 之前用 `?mode=scheduled`，
      // 但 'scheduled' 是只用作「显示 pinned summary」的 mode 标记，**不在 MODE_LABELS**，
      // T85 redirect 会保留它进 URL；ProjectWorkspace.handleOpenResult 的
      // `preserveWorkspaceMode: workspaceMode === 'chat'` 判定只认 'chat'，
      // scheduled 模式下会被强制改 mode 到 'result'，TitleBar 因此显示
      // '样本对齐详情·结果' 而不是项目名/最近 job（HomePage 的设计意图是
      // 「进 chat 模式 + 右栏 results tab 显示该 job」）。
      // 改为 `?mode=chat`：T85 redirect 会删掉默认 mode 段，URL 变成
      // `/project/${id}?job=...`，workspaceMode='chat'，preserveWorkspaceMode=true，
      // 右栏 results 自动打开但主视图仍是 chat（TitleBar 显示项目名）。
      return (
        <Navigate
          to={`/project/${targetProjectId}?mode=chat&job=${encodeURIComponent(targetJobId)}`}
          replace
        />
      );
    }
    return <Navigate to={`/project/${targetProjectId}`} replace />;
  }

  if (status === 'error') {
    return (
      <div className={styles.homeState}>
        <Icon name="flag" size={18} />
        <span>项目列表加载失败</span>
        <button className="gewu-btn gewu-btn--ghost gewu-btn--sm" type="button" onClick={() => {
          setStatus('loading');
          setLoadAttempt((value) => value + 1);
        }}>
          重试
        </button>
      </div>
    );
  }

  return (
    <section className={styles.emptyHome} aria-label="创建第一个项目">
      {runtimeBanner}
      {storeOverlay}
      <div className={styles.emptyHomeIcon}><Icon name="folder" size={22} /></div>
      <h1>创建第一个项目</h1>
      <p>选择工作目录后，将以目录名称创建项目。</p>
      <div className={styles.emptyHomeCreate}>{createControls}</div>
    </section>
  );
}
