// Petri 桌面版 auth client — 简化版
// 桌面版无登录，固定本地 admin 用户，所有模块权限全开。
// 替代 Docusaurus 版 authClient.ts 的桌面分支。
// CK-11 首批（2026-09-25）：14 个无消费方的 stub 导出已删除（grep 全仓证伪
// 「防类型缺口」——34 个 import 方只用 getApiPrefix/getToken/getPlatformApiPrefix/
// errMsg/AuthUser；IS_DESKTOP/getComputeApiPrefix 与 lib/env.ts 重复定义亦删）。

import { getApiPrefix, getPlatformApiPrefix } from '@/lib/env';

export const getToken = (): string => 'desktop-local';

export { getApiPrefix, getPlatformApiPrefix };
