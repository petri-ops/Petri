import type { IconName } from '@/components/icons/Icon';
import type { RemotePlugin } from '@/hooks/usePluginStore';

// BLOCK-92 Wave B-5 — 插件商店类型与分类常量外迁（原 PluginStorePanel.tsx，纯搬运零行为变化）。
// 原导入路径 './PluginStorePanel' 的组件导出面不变。

// BLOCK-84：领域包一键装/卸（记录制；装/卸后需重启生效）
// BLOCK-86 P1/P2：契约（requiresRuntimes）+ 内容概要（contents）
export interface RuntimeRequirement { pluginId: string; version?: string }
export interface PackContents {
  pluginCount: number;
  plugins: Array<{ id: string; language: string | null; version: string | null }>;
  pluginIds: string[];
  scriptCount: number;
  demoDataCount: number;
}
export interface InstalledPack {
  packId: string; name?: string; packRoot: string; version: string; installedAt: string;
  requiresRuntimes?: RuntimeRequirement[];
  contents?: PackContents;
}
export interface AvailablePack {
  packId: string; name: string; nameEn?: string | null; version: string; description: string; packRoot: string; installed: boolean;
  requiresRuntimes?: RuntimeRequirement[];
  contents?: PackContents;
}
export interface UninstallPlan {
  ok: boolean;
  runtimes?: {
    removable: Array<{ pluginId: string; installed: boolean; sizeBytes: number | null }>;
    retained: Array<{ pluginId: string; requiredBy: string[] }>;
  };
  packSource?: { dir: string | null; exists: boolean; sizeBytes: number | null };
  userDataPolicy?: string;
  error?: string;
}

export interface Props {
  onClose: () => void;
  /** UI-347 — 返回按钮文案（与各宿主页面返回语义一致；缺省「返回」）。 */
  backLabel?: string;
  /** BLOCK-156 — 嵌入扩展中心「领域插件」货签时收起自带页头（返回钮/图标/标题），
   * 只留搜索行；宿主页头承载返回。独立页/浮层宿主不传，行为不变。 */
  embedded?: boolean;
}

export type CategoryId = 'all' | 'tool';

export interface Category {
  id: CategoryId;
  label: string;
  icon: IconName;
  filter: (id: string, info: RemotePlugin) => boolean;
}

// UI-374 — 独立「运行时」分类收编进包视图：运行时不再单列，改在包卡片内渲染
export const CATEGORIES: Category[] = [
  { id: 'all', label: '全部', icon: 'puzzle', filter: () => true },
  {
    id: 'tool',
    label: '分析工具',
    icon: 'bar-chart',
    filter: (_, info) => !info.type || info.type !== 'runtime',
  },
];

export function getCategoryIcon(info: RemotePlugin): IconName {
  if (info.type === 'runtime') return 'cpu';
  return 'bar-chart';
}

export function formatSize(bytes?: number | null): string {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + 'GB';
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(0) + 'MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + 'KB';
  return bytes + 'B';
}
