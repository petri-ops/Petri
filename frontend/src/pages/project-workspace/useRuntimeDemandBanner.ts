import { useEffect, useState } from 'react';
import { listPacksRequiringRuntimes } from '@/lib/domainPack';

// BLOCK-92 Wave B-1 — 运行时缺失横幅状态簇外迁（原 ProjectWorkspace 内联，纯搬运零行为变化）。

// backendStatus.rRuntime 可为 null（状态查询失败 = 未知）。用 `=== false`
// 严格判定"确认缺失"，避免偶发 IPC 异常时误弹缺失横幅。
// BLOCK-86 P2 — 领域感知：只有已装领域包声明运行时才提示（无包不提运行时），
// 文案挂包名。
interface RuntimeDemandBannerStatus {
  loaded: boolean | null | undefined;
  rRuntime: boolean | null | undefined;
  pyRuntime: boolean | null | undefined;
}

export function useRuntimeDemandBanner(backendStatus: RuntimeDemandBannerStatus): {
  showRuntimeBanner: boolean | null | undefined;
  runtimeBannerMessage: string;
} {
  const rRuntimeMissing = backendStatus.rRuntime === false;
  const pyRuntimeMissing = backendStatus.pyRuntime === false;
  const [runtimeDemandPacks, setRuntimeDemandPacks] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    listPacksRequiringRuntimes()
      .then((packs) => { if (alive) setRuntimeDemandPacks(packs.map((p) => p.name)); })
      .catch(() => { /* 桥缺失 = 无包态 = 不提示 */ });
    return () => { alive = false; };
  }, []);
  const runtimeDemandSuffix =
    runtimeDemandPacks.length > 0 ? `（已安装领域包 ${runtimeDemandPacks.map((n) => `「${n}」`).join('、')} 需要）` : '';
  const showRuntimeBanner =
    backendStatus.loaded &&
    runtimeDemandPacks.length > 0 &&
    (rRuntimeMissing || pyRuntimeMissing);
  let runtimeBannerMessage: string;
  if (rRuntimeMissing && pyRuntimeMissing) {
    runtimeBannerMessage = `R 与 Python 运行时均未安装，分析功能暂不可用${runtimeDemandSuffix}。`;
  } else if (rRuntimeMissing) {
    runtimeBannerMessage = `R 运行时未安装，依赖 R 的分析无法运行${runtimeDemandSuffix}。`;
  } else {
    runtimeBannerMessage = `Python 运行时未安装，依赖 Python 的分析无法运行${runtimeDemandSuffix}。`;
  }
  return { showRuntimeBanner, runtimeBannerMessage };
}
