import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import {
  createProject,
  listSshTargetCandidates,
  validateSshProject,
  type SshTargetCandidate,
} from '@/lib/project-store';
import { petriEvents, dispatchPetriEvent } from '@/lib/events';

// BLOCK-92 Wave B-6 — 首页创建流状态簇外迁（原 home.tsx 内联，纯搬运零行为变化）：
// BLOCK-67/UI-321 SSH 远程项目创建流、UI-257 手动路径兜底 + UI-259 应用内选目录、
// BLOCK-53 P1 拖拽目录直达创建。

export interface PendingWorkspace {
  path: string;
  name: string;
}

type SetPendingWorkspace = Dispatch<SetStateAction<PendingWorkspace | null>>;
type SetCreateError = (message: string) => void;

/**
 * BLOCK-67（UI-321）— SSH 远程项目创建流：目标发现 → 校验（agent 部署 + 路径验证）→ 创建。
 * UI-326 — 别名 / IP+密码 双模式（密码一次性装公钥，绝不存储）。
 */
export function useHomeSshProject(options: {
  creating: boolean;
  setCreating: Dispatch<SetStateAction<boolean>>;
  setCreateError: SetCreateError;
  navigate: NavigateFunction;
}): {
  sshOpen: boolean;
  setSshOpen: Dispatch<SetStateAction<boolean>>;
  sshTargets: SshTargetCandidate[];
  sshAlias: string;
  setSshAlias: Dispatch<SetStateAction<string>>;
  sshRemotePath: string;
  setSshRemotePath: Dispatch<SetStateAction<string>>;
  sshValidating: boolean;
  sshValidated: boolean;
  setSshValidated: Dispatch<SetStateAction<boolean>>;
  sshMode: 'alias' | 'password';
  setSshMode: Dispatch<SetStateAction<'alias' | 'password'>>;
  sshIp: string;
  setSshIp: Dispatch<SetStateAction<string>>;
  sshPort: string;
  setSshPort: Dispatch<SetStateAction<string>>;
  sshUsername: string;
  setSshUsername: Dispatch<SetStateAction<string>>;
  sshPassword: string;
  setSshPassword: Dispatch<SetStateAction<string>>;
  sshRegistering: boolean;
  openSshPanel: () => Promise<void>;
  confirmCreateSsh: () => Promise<void>;
} {
  const { creating, setCreating, setCreateError, navigate } = options;
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
  }, [setCreateError]);

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
        const desktop = (window as unknown as { petriDesktop?: { ssh?: { registerHost: (p: { ip: string; port: number; username: string; password: string }) => Promise<{ ok: boolean; alias?: string; error?: string }> } } });
        const bridge = desktop.petriDesktop?.ssh ?? (window as unknown as { petri?: { ssh?: { registerHost: (p: { ip: string; port: number; username: string; password: string }) => Promise<{ ok: boolean; alias?: string; error?: string }> } } }).petri?.ssh;
        if (!bridge?.registerHost) {
          setCreateError('当前运行环境不支持密码引导连接（请升级 Petri 桌面端）');
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
      // 项目创建广播（softRefresh → AppRail 刷新左栏项目列表，用户反馈「创建项目左栏不更新」）
      try {
        dispatchPetriEvent(petriEvents.softRefresh, undefined);
      } catch {
        // 事件总线失败不阻塞导航
      }
      setSshAlias('');
      setSshRemotePath('');
      setSshIp('');
      setSshPassword('');
      setSshMode('alias');
      void navigate(`/project/${project.id}`, { replace: true });
    } catch (e) {
      setCreateError(`SSH 项目创建失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSshValidating(false);
      setSshRegistering(false);
      setCreating(false);
    }
  }, [creating, navigate, setCreateError, sshAlias, sshIp, sshMode, sshPort, sshRemotePath, sshRegistering, sshUsername, sshPassword, sshValidating]);

  return {
    sshOpen,
    setSshOpen,
    sshTargets,
    sshAlias,
    setSshAlias,
    sshRemotePath,
    setSshRemotePath,
    sshValidating,
    sshValidated,
    setSshValidated,
    sshMode,
    setSshMode,
    sshIp,
    setSshIp,
    sshPort,
    setSshPort,
    sshUsername,
    setSshUsername,
    sshPassword,
    setSshPassword,
    sshRegistering,
    openSshPanel,
    confirmCreateSsh,
  };
}

/**
 * UI-257 — 手动输入路径兜底 + UI-259 应用内「选择文件夹」展开状态 +
 * UI-253 校验通过后进入确认面板。
 */
export function useManualPathFlow(options: {
  creating: boolean;
  setPendingWorkspace: SetPendingWorkspace;
  setCreateError: SetCreateError;
}): {
  manualPathOpen: boolean;
  setManualPathOpen: Dispatch<SetStateAction<boolean>>;
  manualPath: string;
  setManualPath: Dispatch<SetStateAction<string>>;
  manualValidating: boolean;
  browseOpen: boolean;
  setBrowseOpen: Dispatch<SetStateAction<boolean>>;
  browseFrom: string;
  setBrowseFrom: Dispatch<SetStateAction<string>>;
  confirmManualPath: () => Promise<void>;
} {
  const { setPendingWorkspace, setCreateError } = options;
  const [manualPathOpen, setManualPathOpen] = useState(false);
  const [manualPath, setManualPath] = useState('');
  const [manualValidating, setManualValidating] = useState(false);
  // UI-259 — 应用内「选择文件夹」展开状态
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseFrom, setBrowseFrom] = useState('');

  const confirmManualPath = useCallback(async () => {
    if (manualValidating) return;
    const validate = window.petriDesktop?.files?.validateDirectory;
    if (typeof validate !== 'function') {
      setCreateError('当前运行环境不支持路径校验（请在 Petri 桌面应用中使用）。');
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
  }, [manualPath, manualValidating, setCreateError, setPendingWorkspace]);

  return {
    manualPathOpen,
    setManualPathOpen,
    manualPath,
    setManualPath,
    manualValidating,
    browseOpen,
    setBrowseOpen,
    browseFrom,
    setBrowseFrom,
    confirmManualPath,
  };
}

/**
 * BLOCK-53 P1 — 拖拽目录直达创建：拖入的路径走与手动路径相同的校验链
 * （validateDirectory），通过后进 UI-253 既有确认面板。Home 挂载期接管
 * 窗口级文件拖入（Chromium 默认行为是导航到拖入的文件路径）。
 */
export function useHomeDropToCreate(options: {
  setPendingWorkspace: SetPendingWorkspace;
  setCreateError: SetCreateError;
}): void {
  const { setPendingWorkspace, setCreateError } = options;

  const acceptDroppedPath = useCallback(async (rawPath: string | null) => {
    if (!rawPath) {
      setCreateError('无法读取拖入项的路径（请拖入文件夹）。');
      return;
    }
    const validate = window.petriDesktop?.files?.validateDirectory;
    if (typeof validate !== 'function') {
      setCreateError('当前运行环境不支持路径校验（请在 Petri 桌面应用中使用）。');
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
  }, [setCreateError, setPendingWorkspace]);

  // BLOCK-53 P1 — 必须对 dragover/drop 双双 preventDefault；drop 取第一个
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
      const pathFor = window.petriDesktop?.files?.pathForFile;
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
}
