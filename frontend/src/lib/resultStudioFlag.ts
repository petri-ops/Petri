// ============================================================
// resultStudioFlag — item 90 阶段一可逆下架的前端 flag 面。
//
// 单一真值在后端 decision-config（point.result-studio.enabled，默认 off）；
// 本模块只做一次性拉取 + React 订阅。契约：
//   - fail-closed：后端不可达/解析失败/无该点 → 一律按 off（宁可少显示，不假开）；
//   - 每页面生命周期只拉一次（模块缓存），ResultsSurface/EvidenceSurface 共用；
//   - 测试注入走 __resetResultStudioFlagForTest + mock fetch。
// ============================================================

import { useEffect, useState } from 'react';
import { getApiPrefix } from '@/lib/env';

interface DecisionPointRuntime {
  point?: string;
  enabled?: boolean;
}

let cachedEnabled: boolean | null = null;
let inflight: Promise<boolean> | null = null;

function fetchEnabled(): Promise<boolean> {
  if (cachedEnabled !== null) return Promise.resolve(cachedEnabled);
  if (!inflight) {
    inflight = (async () => {
      try {
        const response = await fetch(`${getApiPrefix()}/ai/decisions/config`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) return false;
        const data: unknown = await response.json();
        const points: DecisionPointRuntime[] = Array.isArray((data as { points?: unknown })?.points)
          ? (data as { points: DecisionPointRuntime[] }).points
          : [];
        const point = points.find((entry) => entry?.point === 'result-studio');
        return point?.enabled === true;
      } catch {
        return false;
      }
    })().then((value) => {
      cachedEnabled = value;
      inflight = null;
      return value;
    });
  }
  return inflight;
}

/** 订阅 resultStudio flag（off 为 fail-closed 缺省）。 */
export function useResultStudioEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(cachedEnabled ?? false);
  useEffect(() => {
    let alive = true;
    void fetchEnabled().then((value) => {
      if (alive) setEnabled(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return enabled;
}

/** 测试隔离（生产代码不得调用）。 */
export function __resetResultStudioFlagForTest(): void {
  cachedEnabled = null;
  inflight = null;
}
