// ============================================================
// Copilot Result Node — type contract for the pluggable renderer
// registry that wraps the existing ResultCard container.
// Future phases (P1.2 / P1.3) will register table/chart/image
// renderers against the same shape.
// ============================================================

import type { ComponentType } from 'react';

export type ResultNodeType = 'text' | 'table' | 'chart' | 'image';

export type ResultCardVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'error'
  | 'info';

export interface ResultNode {
  id: string;
  type: ResultNodeType;
  title: string;
  subtitle?: string;
  variant?: ResultCardVariant;
  meta?: string;
  payload: unknown;
  createdAt: string;
}

export type ResultRendererComponent = ComponentType<{ node: ResultNode }>;
