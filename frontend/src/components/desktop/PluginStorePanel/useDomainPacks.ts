import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { getBridge } from '@/lib/desktopBridge';
import type { RemotePlugin } from '@/hooks/usePluginStore';
import { formatSize, type AvailablePack, type InstalledPack, type UninstallPlan } from './types';

// BLOCK-163 W3 P7（DIST-5）— 宽松版本比较（数字段数值序，缺失段=0）：'1.2.10' > '1.2.9'。
function compareVersionsLoose(a: string, b: string): number {
  const pa = String(a || '0').split('.');
  const pb = String(b || '0').split('.');
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = parseInt(pa[i] || '0', 10) || 0;
    const nb = parseInt(pb[i] || '0', 10) || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

// BLOCK-92 Wave B-5 — 领域包装/卸状态簇外迁（原 PluginStorePanel.tsx 内联，纯搬运零行为变化）。
// BLOCK-84 记录制装/卸 + BLOCK-86 P1/P2 契约与展开态 + UI-374 三档卸载确认与运行时进度。

interface UseDomainPacksOptions {
  /** 运行时标题/体积查询源（usePluginStore 的 remote 清单）。 */
  remote: { plugins?: Record<string, RemotePlugin> };
}

export function useDomainPacks(options: UseDomainPacksOptions): {
  availablePacks: AvailablePack[];
  installedPacks: InstalledPack[];
  packBusy: string | null;
  setPackBusy: (busy: string | null) => void;
  setPackNotice: (notice: string | null) => void;
  packNotice: string | null;
  expandedPackId: string | null;
  setExpandedPackId: (id: string | null) => void;
  packRuntimeProgress: Record<string, { ratio: number; received: number; total: number }>;
  setPackRuntimeProgress: Dispatch<SetStateAction<Record<string, { ratio: number; received: number; total: number }>>>;
  confirmPack: AvailablePack | null;
  setConfirmPack: (pack: AvailablePack | null) => void;
  confirmPlan: UninstallPlan | null;
  setConfirmPlan: (plan: UninstallPlan | null) => void;
  confirmDeleteRuntimes: boolean;
  setConfirmDeleteRuntimes: (next: boolean) => void;
  confirmDeletePackSource: boolean;
  setConfirmDeletePackSource: (next: boolean) => void;
  refreshPacks: () => Promise<void>;
  /** BLOCK-163 W3 P7（DIST-5）— 包更新徽标数据源（packId → 版本对） */
  packUpdates: Map<string, { installedVersion: string; latestVersion: string }>;
  packUpdateCount: number;
  /** BLOCK-163 W3 P7（DIST-5）— 一键更新（覆盖装，同一安装链） */
  handlePackUpdate: (pack: AvailablePack) => Promise<void>;
  /** BLOCK-158 — 运行时补装（包卡片「必需 · 缺失」；进度走 onInstallProgress 事件） */
  handleRuntimeTopUp: (pluginId: string) => Promise<void>;
  /** BLOCK-157 加映（UI-481）— 整包启停（乐观翻转本地缓存；重启后端生效） */
  handlePackSetEnabled: (packId: string, enabled: boolean) => Promise<void>;
  handlePackInstall: (pack: AvailablePack) => Promise<void>;
  beginPackUninstall: (pack: AvailablePack) => Promise<void>;
  handlePackUninstall: (pack: AvailablePack, options: { deleteRuntimes?: boolean; deletePackSource?: boolean }) => Promise<void>;
  runtimeTitleOf: (pluginId: string) => string;
  runtimeSizeLabelOf: (pluginId: string) => string;
  packsRequiringRuntimes: string[];
} {
  const { remote } = options;
  // BLOCK-84：领域包
  const [availablePacks, setAvailablePacks] = useState<AvailablePack[]>([]);
  const [installedPacks, setInstalledPacks] = useState<InstalledPack[]>([]);
  const [packBusy, setPackBusy] = useState<string | null>(null);
  const [packNotice, setPackNotice] = useState<string | null>(null);
  // UI-374 — 包卡片展开态 + 包安装的运行时进度（pack:install-progress）+ 卸载三档确认
  const [expandedPackId, setExpandedPackId] = useState<string | null>(null);
  const [packRuntimeProgress, setPackRuntimeProgress] = useState<
    Record<string, { ratio: number; received: number; total: number }>
  >({});
  const [confirmPack, setConfirmPack] = useState<AvailablePack | null>(null);
  const [confirmPlan, setConfirmPlan] = useState<UninstallPlan | null>(null);
  const [confirmDeleteRuntimes, setConfirmDeleteRuntimes] = useState(true);
  const [confirmDeletePackSource, setConfirmDeletePackSource] = useState(false);

  // IPC 契约（src/ipc/pack.js）：list-installed / list-available 统一返回
  // `{ ok, packs: [...] }`，不是裸数组。早期实现按裸数组解包，导致 state 被塞进
  // 一个普通对象（.length === undefined），`length > 0` 恒为 false，
  // 「领域包」分区因此永不渲染——数据链路全通却看不见卡片（P2 实机抓真）。
  const unpackPacks = <T,>(payload: unknown): T[] => {
    if (Array.isArray(payload)) return payload as T[];
    const env = payload as { ok?: boolean; packs?: T[] } | null;
    return env && Array.isArray(env.packs) ? env.packs : [];
  };

  const refreshPacks = useCallback(async () => {
    try {
      // BLOCK-87 L4-2：桥解析走 getBridge 单点——桌面=IPC 桥，投影=gateway
      // HTTP 桥（手机端领域包/运行时与桌面同源）；普通 web 无桥返回 null。
      // 直接读 window.petriDesktop 在投影下拿到的是垫片 Proxy（解析为
      // undefined），曾是手机端领域包分区空白的根因之一。
      const bridge = getBridge('packs');
      if (!bridge) return;
      const [inst, avail] = await Promise.all([bridge.listInstalled(), bridge.listAvailable()]);
      setInstalledPacks(unpackPacks<InstalledPack>(inst));
      setAvailablePacks(unpackPacks<AvailablePack>(avail));
    } catch {
      // 桥缺失（web shim）时整区不渲染，由 availablePacks 空态兜底
    }
  }, []);

  useEffect(() => { void refreshPacks(); }, [refreshPacks]);

  // BLOCK-163 W3 P7（DIST-5）— 领域包更新体验：已装版本 < 包根当前版本 → 更新徽标；
  // 更新 = 重走 installPath 覆盖装（同一安装链，运行时缺项照常补装提示）。
  const packUpdates = useMemo(() => {
    const map = new Map<string, { installedVersion: string; latestVersion: string }>();
    const installedById = new Map(installedPacks.map((p) => [p.packId, p]));
    for (const avail of availablePacks) {
      const inst = installedById.get(avail.packId);
      if (!inst) continue;
      const a = String(avail.version || '0');
      const b = String(inst.version || '0');
      if (compareVersionsLoose(a, b) > 0) {
        map.set(avail.packId, { installedVersion: b, latestVersion: a });
      }
    }
    return map;
  }, [availablePacks, installedPacks]);

  const packUpdateCount = packUpdates.size;

  async function handlePackUpdate(pack: AvailablePack) {
    setPackBusy(pack.packId);
    setPackNotice(null);
    setPackRuntimeProgress({});
    try {
      const update = packUpdates.get(pack.packId);
      const result = await getBridge('packs')?.installPath(pack.packRoot);
      if (result?.ok) {
        let notice = `「${pack.name}」已更新`;
        if (update) notice += `（${update.installedVersion} → ${update.latestVersion}）`;
        setPackNotice(`${notice}——重启应用后生效`);
      } else {
        setPackNotice(`更新失败：${result?.error ?? '未知错误'}`);
      }
      await refreshPacks();
      setExpandedPackId(pack.packId);
    } finally {
      setPackBusy(null);
      setPackRuntimeProgress({});
    }
  }

  // UI-374 — 包安装的运行时下载进度（主进程 → pack:install-progress → 这里）
  useEffect(() => {
    const bridge = getBridge('packs');
    if (!bridge?.onInstallProgress) return undefined;
    return bridge.onInstallProgress((payload) => {
      setPackRuntimeProgress((prev) => ({ ...prev, [payload.pluginId]: payload.progress }));
    });
  }, []);

  function runtimeTitleOf(pluginId: string): string {
    const info = remote.plugins?.[pluginId];
    return info?.title || pluginId;
  }

  function runtimeSizeLabelOf(pluginId: string): string {
    const size = remote.plugins?.[pluginId]?.size;
    const label = formatSize(size);
    return label ? `约 ${label}` : '';
  }

  // BLOCK-157 加映（UI-481）— 整包启停：翻转 enabled 标志（包文件不动免重装；
  // 乐观更新本地缓存 + notice 提示重启生效；失败回刷还原）
  async function handlePackSetEnabled(packId: string, enabled: boolean) {
    setPackBusy(packId);
    setPackNotice(null);
    try {
      const bridge = getBridge('packs');
      const result = bridge?.setEnabled ? await bridge.setEnabled(packId, enabled) : null;
      if (result?.ok) {
        setInstalledPacks((prev) => prev.map((p) => (p.packId === packId ? { ...p, enabled } : p)));
        setPackNotice(`已${enabled ? '启用' : '停用'}该领域包——重启应用后${enabled ? '恢复' : '不再注册'}其分析插件（免重装）`);
      } else {
        setPackNotice(`切换失败：${result?.error ?? '桥接不可用'}`);
        await refreshPacks();
      }
    } catch (e) {
      setPackNotice(`切换失败：${e instanceof Error ? e.message : '未知错误'}`);
      await refreshPacks();
    } finally {
      setPackBusy(null);
    }
  }

  // BLOCK-158 — 运行时补装（供应链唯一 IPC 写面 pack:install-runtime；notice/进度面复用既有）
  async function handleRuntimeTopUp(pluginId: string) {
    setPackNotice(null);
    try {
      const bridge = getBridge('packs');
      const result = bridge?.installRuntime ? await bridge.installRuntime(pluginId) : null;
      if (result?.ok) {
        setPackNotice(`「${runtimeTitleOf(pluginId)}」安装成功——重启应用后生效`);
      } else {
        setPackNotice(`补装失败：${result?.error ?? '桥接不可用'}`);
      }
    } catch (e) {
      setPackNotice(`补装失败：${e instanceof Error ? e.message : '未知错误'}`);
    }
  }

  async function handlePackInstall(pack: AvailablePack) {
    setPackBusy(pack.packId);
    setPackNotice(null);
    setPackRuntimeProgress({});
    try {
      const result = await getBridge('packs')?.installPath(pack.packRoot);
      if (result?.ok) {
        const runtimeResults = result.runtimes ?? [];
        const failed = runtimeResults.filter((r) => !r.ok);
        const installedNow = runtimeResults.filter((r) => r.ok && !r.skipped);
        let notice = `「${pack.name}」已安装`;
        if (installedNow.length > 0) {
          notice += `；运行时 ${installedNow.map((r) => runtimeTitleOf(r.pluginId)).join('、')} 已就绪`;
        }
        if (failed.length > 0) {
          notice += `；运行时 ${failed.map((r) => runtimeTitleOf(r.pluginId)).join('、')} 安装失败（${failed.map((r) => r.error || '未知错误').join('；')}），可稍后在包卡片内补装`;
        }
        setPackNotice(`${notice}——重启应用后生效`);
      } else {
        setPackNotice(`安装失败：${result?.error ?? '未知错误'}`);
      }
      await refreshPacks();
      setExpandedPackId(pack.packId);
    } finally {
      setPackBusy(null);
      setPackRuntimeProgress({});
    }
  }

  // UI-374 — 卸载两段式：先取契约推导的影响预览（三档数据源），确认后执行
  async function beginPackUninstall(pack: AvailablePack) {
    setPackNotice(null);
    const bridge = getBridge('packs');
    if (!bridge?.uninstallPlan) {
      // 投影桥（HTTP）未提供 plan 通道：退化为直接卸载（记录级，零破坏性）
      await handlePackUninstall(pack, {});
      return;
    }
    const plan = await bridge.uninstallPlan(pack.packId);
    if (!plan?.ok) {
      setPackNotice(`获取卸载方案失败：${plan?.error ?? '未知错误'}`);
      return;
    }
    setConfirmDeleteRuntimes(true);
    setConfirmDeletePackSource(false);
    setConfirmPlan(plan);
    setConfirmPack(pack);
  }

  async function handlePackUninstall(pack: AvailablePack, options: { deleteRuntimes?: boolean; deletePackSource?: boolean }) {
    setPackBusy(pack.packId);
    setPackNotice(null);
    try {
      const result = await getBridge('packs')?.uninstall(pack.packId, options);
      if (result?.ok) {
        const removedRuntimeTitles = (result.removed?.runtimes ?? [])
          .filter((r) => r.ok && !r.skipped)
          .map((r) => runtimeTitleOf(r.pluginId));
        const keptDir = result.kept?.packSourceDir;
        let notice = `「${pack.name}」已卸载`;
        if (removedRuntimeTitles.length > 0) {
          notice += `；已释放运行时 ${removedRuntimeTitles.join('、')}`;
        }
        if (result.removed?.packSourceDir) {
          notice += '；包源目录已删除';
        } else if (keptDir) {
          notice += `；包源目录保留在 ${keptDir}`;
        }
        setPackNotice(`${notice}——重启应用后回到纯通用态`);
      } else {
        setPackNotice(`卸载失败：${result?.error ?? '未知错误'}`);
      }
      await refreshPacks();
    } finally {
      setPackBusy(null);
    }
  }

  // UI-374 — 缺失提示领域感知：只在「包已装而运行时缺」时出现（无包不提运行时），
  // 文案挂包名。runtimeStatus 为 null（检测未知）时维持既有语义：不提示。
  const packsRequiringRuntimes = (() => {
    const byId = new Map<string, string>();
    for (const p of [...installedPacks, ...availablePacks.map(({ packId, name }) => ({ packId, name }))] as Array<{ packId: string; name?: string }>) {
      if (!byId.has(p.packId)) byId.set(p.packId, p.name || p.packId);
    }
    return installedPacks
      .filter((p) => Array.isArray(p.requiresRuntimes) && p.requiresRuntimes.length > 0)
      .map((p) => byId.get(p.packId) || p.packId);
  })();

  return {
    availablePacks,
    installedPacks,
    packBusy,
    setPackBusy,
    setPackNotice,
    packNotice,
    expandedPackId,
    setExpandedPackId,
    packRuntimeProgress,
    setPackRuntimeProgress,
    confirmPack,
    setConfirmPack,
    confirmPlan,
    setConfirmPlan,
    confirmDeleteRuntimes,
    setConfirmDeleteRuntimes,
    confirmDeletePackSource,
    setConfirmDeletePackSource,
    refreshPacks,
    packUpdates,
    packUpdateCount,
    handlePackUpdate,
    handleRuntimeTopUp,
    handlePackSetEnabled,
    handlePackInstall,
    beginPackUninstall,
    handlePackUninstall,
    runtimeTitleOf,
    runtimeSizeLabelOf,
    packsRequiringRuntimes,
  };
}
