// ============================================================
// Hash-based router for /spatial SPA
//
// URL shapes:
//   #/                          → Projects list (default)
//   #/project/:projectId        → Project detail (datasets list)
//   #/dataset/:datasetId        → Dataset detail (analyses list, W3-B)
//   #/result/:analysisId        → Analysis result view (W3-B)
//
// 设计与 /single-cell 完全一致——保持用户操作习惯。
// ============================================================

import { useEffect, useState, useCallback } from 'react';

export type Route =
  | { name: 'login' }
  | { name: 'projects' }
  | { name: 'project'; projectId: string }
  | { name: 'dataset'; datasetId: string }
  | { name: 'result'; analysisId: string };

function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '');
  if (!clean) return { name: 'projects' };

  const parts = clean.split('/').filter(Boolean);
  if (parts[0] === 'login') return { name: 'login' };
  if (parts[0] === 'project' && parts[1]) return { name: 'project', projectId: parts[1] };
  if (parts[0] === 'dataset' && parts[1]) return { name: 'dataset', datasetId: parts[1] };
  if (parts[0] === 'result' && parts[1]) return { name: 'result', analysisId: parts[1] };

  return { name: 'projects' };
}

function routeToHash(r: Route): string {
  switch (r.name) {
    case 'login':
      return '#/login';
    case 'projects':
      return '#/';
    case 'project':
      return `#/project/${r.projectId}`;
    case 'dataset':
      return `#/dataset/${r.datasetId}`;
    case 'result':
      return `#/result/${r.analysisId}`;
  }
}

export function useRouter() {
  const [route, setRoute] = useState<Route>(() => {
    if (typeof window === 'undefined') return { name: 'projects' };
    return parseHash(window.location.hash);
  });

  useEffect(() => {
    const handler = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const navigate = useCallback((r: Route) => {
    window.location.hash = routeToHash(r);
  }, []);

  return { route, navigate };
}
