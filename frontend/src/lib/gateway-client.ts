/**
 * frontend/src/lib/gateway-client.ts — Gateway 客户端封装
 *
 * Phase 3 产物：前端通过 Electron IPC 访问 Gateway 服务的统一接口。
 *
 * 功能：
 * - Gateway 健康检查聚合
 * - 工具列表查询
 * - 工具执行（通过 IPC 桥接）
 */

import { getBridge } from './desktopBridge';

/**
 * Gateway 健康状态
 */
export interface GatewayHealthStatus {
  gateway: boolean;
  timestamp?: string;
  uptime?: number;
  services?: {
    rServer?: { status: 'healthy' | 'unhealthy'; error?: string };
    pyServer?: { status: 'healthy' | 'unhealthy'; error?: string };
    database?: { status: 'healthy' | 'unhealthy'; error?: string };
  };
  tools?: {
    total: number;
    byLanguage: Record<string, number>;
  };
  error?: string;
}

/**
 * 工具条目
 */
export interface ToolEntry {
  id: string;
  name: string;
  language: 'r' | 'python' | 'builtin';
  endpoint?: string;
  description?: string;
}

/**
 * 工具列表响应
 */
export interface ToolListResponse {
  status: 'ok' | 'error';
  count?: number;
  tools?: ToolEntry[];
  stats?: {
    total: number;
    byLanguage: Record<string, number>;
  };
  error?: string;
}

/**
 * 工具详情响应
 */
export interface ToolDetailResponse {
  status: 'ok' | 'error';
  tool?: ToolEntry & {
    metadata?: {
      description?: string;
      inputSchema?: object;
      outputSchema?: object;
    };
  };
  error?: string;
}

/**
 * 工具执行请求
 */
export interface ToolExecuteRequest {
  toolId: string;
  params?: Record<string, unknown>;
  language?: 'r' | 'python' | 'builtin';
}

/**
 * 工具执行响应
 */
export interface ToolExecuteResponse {
  status: 'ok' | 'error';
  _gateway?: {
    routedTo?: string;
    toolId?: string;
  };
  error?: string;
  [key: string]: unknown;
}

/**
 * 获取 Gateway 健康状态
 */
export async function getGatewayHealth(): Promise<GatewayHealthStatus> {
  const bridge = getBridge('backend');
  if (!bridge) {
    return {
      gateway: false,
      error: 'Backend bridge not available',
    };
  }

  try {
    const status = await bridge.status();
    return {
      gateway: true,
      ...status,
    };
  } catch (e) {
    return {
      gateway: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}

/**
 * 获取 Gateway 工具列表
 */
export async function getGatewayTools(language?: string): Promise<ToolListResponse> {
  const bridge = getBridge('backend');
  if (!bridge) {
    return {
      status: 'error',
      error: 'Backend bridge not available',
    };
  }

  try {
    // 通过 backend bridge 获取工具列表
    // TODO: 需要在 backend bridge 中添加 getTools 方法
    const tools = await (bridge as unknown as { getTools?: (language?: string) => Promise<ToolListResponse> }).getTools?.(language);
    return tools || {
      status: 'error',
      error: 'getTools not implemented',
    };
  } catch (e) {
    return {
      status: 'error',
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}

/**
 * 获取工具详情
 */
export async function getGatewayToolDetail(toolId: string): Promise<ToolDetailResponse> {
  const bridge = getBridge('backend');
  if (!bridge) {
    return {
      status: 'error',
      error: 'Backend bridge not available',
    };
  }

  try {
    const tool = await (bridge as unknown as { getTool?: (id: string) => Promise<ToolDetailResponse> }).getTool?.(toolId);
    return tool || {
      status: 'error',
      error: 'getTool not implemented',
    };
  } catch (e) {
    return {
      status: 'error',
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}

/**
 * 执行工具
 */
export async function executeGatewayTool(request: ToolExecuteRequest): Promise<ToolExecuteResponse> {
  const bridge = getBridge('backend');
  if (!bridge) {
    return {
      status: 'error',
      error: 'Backend bridge not available',
    };
  }

  try {
    const result = await (bridge as unknown as { executeTool?: (req: ToolExecuteRequest) => Promise<ToolExecuteResponse> }).executeTool?.(request);
    return result || {
      status: 'error',
      error: 'executeTool not implemented',
    };
  } catch (e) {
    return {
      status: 'error',
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}

/**
 * 增强 BackendStatus 类型，添加 Gateway 状态
 */
export interface EnhancedBackendStatus {
  /** Gateway 就绪状态 */
  gatewayUp: boolean;
  /** Gateway 健康详情 */
  gatewayHealth?: GatewayHealthStatus;
  /** 原有 BackendStatus 字段 */
  rRuntime: boolean | null;
  pyRuntime: boolean | null;
  rServerUp: boolean;
  pyServerUp: boolean;
  plumberUp: boolean;
  isReady: boolean;
  downReason: string | null;
  loaded: boolean;
}

/**
 * 获取增强的后端状态（包含 Gateway）
 */
export async function getEnhancedBackendStatus(): Promise<EnhancedBackendStatus | null> {
  const bridge = getBridge('backend');
  if (!bridge) {
    return null;
  }

  try {
    const [status, gatewayHealth] = await Promise.all([
      bridge.status(),
      getGatewayHealth(),
    ]);

    return {
      ...status,
      gatewayUp: gatewayHealth.gateway,
      gatewayHealth,
    };
  } catch (e) {
    console.error('[gateway-client] Failed to get enhanced backend status:', e);
    return null;
  }
}
