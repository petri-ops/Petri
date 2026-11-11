/**
 * BLOCK-414（W5b 第一刀 · SimpleChat guard-ack 簇抽取）契约测试。
 * 行数只减锚 + 抽取单元存在性 + 同套绿由 copilot vitest 套承载。
 */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const countLines = (rel) => { const l = read(rel).split('\n'); if (l.length && l.at(-1) === '') l.pop(); return l.length; };

test('W5b 第一刀：useGuardAck hook 在场且主文件消费（抽取单元存在性）', () => {
  const hook = read('frontend/src/components/copilot/SimpleChat/hooks/useGuardAck.ts');
  assert.match(hook, /export function useGuardAck\(/);
  assert.match(hook, /function findPendingGuardAck\(/, '纯派生函数在档（内部消费，不导出=knip 保留面不增）');
  const main = read('frontend/src/components/copilot/SimpleChat.tsx');
  assert.match(main, /useGuardAck\(conversationId, activeRun\)/, '主文件消费 hook');
  assert.doesNotMatch(main, /const pendingGuardAck = useMemo/, '原内联 memo 已退役');
  assert.doesNotMatch(main, /handleGuardAck = useCallback/, '原内联回调已退役');
});

test('W5b 第一刀行数只减锚：SimpleChat.tsx 2089 → ≤1985（−104 行下限）', () => {
  const n = countLines('frontend/src/components/copilot/SimpleChat.tsx');
  assert.ok(n <= 1985, `SimpleChat.tsx ${n} 行应 ≤1985（拆前 2089）`);
});

test('W5b 第一刀 hook 行数上界：useGuardAck ≤220 行（抽取不膨胀）', () => {
  const n = countLines('frontend/src/components/copilot/SimpleChat/hooks/useGuardAck.ts');
  assert.ok(n <= 220, `useGuardAck ${n} 行应 ≤220`);
});
