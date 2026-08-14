// ============================================================
// ResultCardRenderer — pluggable renderer wrapper around the
// existing ResultCard container.
//
// The registry is a module-level singleton Map so tests can
// inspect / reset it deterministically. Only TextRenderer is
// pre-registered; table / chart / image renderers will be added
// by P1.2 / P1.3 via registerRenderer() (typically through
// ./renderers/index.ts → registerDefaultRenderers()).
//
// Lookups fallback to TextRenderer when type is unknown so the
// container always renders something meaningful.
// ============================================================

import type { ReactNode } from 'react';
import { ResultCard } from './ResultCard';
import { TextRenderer } from './renderers/TextRenderer';
import type { ResultNode, ResultRendererComponent } from './types';

const registry: Map<string, ResultRendererComponent> = new Map();

registry.set('text', TextRenderer);

export function registerRenderer(
  type: string,
  component: ResultRendererComponent,
): void {
  registry.set(type, component);
}

export function getRegisteredRenderer(
  type: string,
): ResultRendererComponent | undefined {
  return registry.get(type);
}

export function listRegisteredRendererTypes(): string[] {
  return Array.from(registry.keys());
}

export function ResultCardRenderer({ node }: { node: ResultNode }): ReactNode {
  const Renderer = registry.get(node.type) ?? TextRenderer;

  return (
    <ResultCard
      title={node.title}
      subtitle={node.subtitle}
      variant={node.variant}
      meta={node.meta}
    >
      <Renderer node={node} />
    </ResultCard>
  );
}
