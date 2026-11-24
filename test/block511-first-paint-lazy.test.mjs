/**
 * BLOCK-511 S4.2 HK-01 — 首屏静态 import 链到不了 three 与 @xyflow/react。
 * 从 App.tsx 沿静态 import（相对路径 + @/ alias）BFS；动态 import() 不计入静态链。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'frontend/src');

function resolveImport(spec, fromFile) {
  if (spec.startsWith('@/')) return path.join(SRC, spec.slice(2));
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const suffix of ['', '.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts']) {
    const p = base + suffix;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

function staticImports(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return [];
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  // 只取顶层 import ... from '...' 与 import '...'（排除 import(...) 动态）
  for (const m of src.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]\s*;?/gm)) out.push(m[1]);
  return out;
}

function reachable(entry) {
  const seen = new Set();
  const queue = [entry];
  const external = new Set();
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of staticImports(file)) {
      if (spec === 'three' || spec.startsWith('three/') || spec === '@xyflow/react') external.add(spec);
      const resolved = resolveImport(spec, file);
      if (resolved) queue.push(resolved);
    }
  }
  return { files: seen, external };
}

const chain = reachable(path.join(SRC, 'App.tsx'));

test('首屏静态链不含 three 与 @xyflow/react', () => {
  assert.deepEqual([...chain.external], [], `首屏静态链含重依赖：${[...chain.external].join(', ')}`);
});

test('ChatArtifactCard 与 ToolActivityDock 用 lazy + Suspense，不再静态 import 重组件', () => {
  const card = fs.readFileSync(path.join(SRC, 'components/copilot/ChatArtifactCard.tsx'), 'utf8');
  const dock = fs.readFileSync(path.join(SRC, 'components/copilot/ToolActivityDock.tsx'), 'utf8');
  assert.doesNotMatch(card, /^import\s+\{?\s*Model3DScene\s*\}?\s+from\s+['"]@\/components\/work-surface\/Model3DScene['"]/m);
  assert.doesNotMatch(dock, /^import\s+\{\s*OrchestrationGraph\s*\}\s+from\s+['"]@\/components\/workspace-panels\/OrchestrationGraph['"]/m);
  assert.match(card, /React\.lazy|lazy\(/);
  assert.match(dock, /React\.lazy|lazy\(/);
  assert.match(card, /Suspense/);
  assert.match(dock, /Suspense/);
});
