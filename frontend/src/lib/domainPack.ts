/**
 * domainPack.ts — 领域包感知查询（BLOCK-86 P2「核心 UI 领域感知」共用面）。
 *
 * 单一职责：回答「当前有没有已安装、且契约声明了运行时的领域包」。
 * home 首启检查 / 工作台 banner / DesktopOnboarding 的运行时提示都以此为
 * 门控——**无包不提运行时**；有包缺运行时才提示且文案挂包名。
 * 桥缺失（纯 web）时如实返回空数组：无包态 = 不提示。
 */

import { getBridge } from '@/lib/desktopBridge';

export interface PackRequiringRuntimes {
  packId: string;
  name: string;
}

function unpackPacks(payload: unknown): Array<{
  packId: string;
  name?: string;
  requiresRuntimes?: Array<{ pluginId: string; version?: string }>;
}> {
  if (Array.isArray(payload)) return payload;
  const env = payload as { ok?: boolean; packs?: unknown } | null;
  return env && Array.isArray(env.packs) ? env.packs : [];
}

/** 已安装且契约声明了运行时的领域包列表（名称缺失回退 packId——旧记录兼容）。 */
export async function listPacksRequiringRuntimes(): Promise<PackRequiringRuntimes[]> {
  const bridge = getBridge('packs');
  if (!bridge) return [];
  try {
    const payload = await bridge.listInstalled();
    return unpackPacks(payload)
      .filter((p) => Array.isArray(p.requiresRuntimes) && p.requiresRuntimes.length > 0)
      .map((p) => ({ packId: p.packId, name: p.name || p.packId }));
  } catch {
    return [];
  }
}

/** 把包名列表拼进提示文案：挂包名，多包顿号连接。 */
export function formatPackNames(names: PackRequiringRuntimes[]): string {
  return names.map((p) => `「${p.name}」`).join('、');
}
