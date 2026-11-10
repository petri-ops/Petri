/**
 * B-11 零几何收敛契约：内层独立语义名 + composes 同一规则，外层不动。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = () => fs.readFileSync(path.join(ROOT, 'frontend/src/pages/project-workspace.module.css'), 'utf8');
const tsx = () => fs.readFileSync(path.join(ROOT, 'frontend/src/components/workspace-panels/CenterPanel.tsx'), 'utf8');

test('内层用 workspaceSessionInner，外层仍是 workspaceSessionLayout', () => {
  const t = tsx();
  assert.ok(t.includes('className={styles.workspaceSessionInner}'));
  assert.ok(t.includes('className={`${styles.workspaceSessionLayout}'), '外层 frame 类名不得改动');
  assert.ok(t.includes('workspaceSessionFrameChat'), 'chat variant 必须保留');
  const occurrences = (t.match(/workspaceSessionLayout/g) || []).length;
  assert.equal(occurrences, 1, '双层同名已消除（只剩外层一处）');
});

test('composes 同一规则：内层无任何几何属性覆盖', () => {
  const c = css();
  const block = /\.workspaceSessionInner\s*\{([^}]*)\}/.exec(c);
  assert.ok(block, '内层规则必须存在');
  assert.ok(/composes:\s*workspaceSessionLayout/.test(block[1]));
  const body = block[1].replace(/composes:\s*workspaceSessionLayout;?/, '').trim();
  assert.equal(body, '', '内层不得声明 flex/gap/padding 等几何属性（否则不是零几何）');
});

test('负测：若有人把内层改成横排/竖排或删掉 composes，必须被识别', () => {
  const c = css();
  const bad = c.replace('composes: workspaceSessionLayout;', 'flex-direction: column;');
  const block = /\.workspaceSessionInner\s*\{([^}]*)\}/.exec(bad);
  assert.ok(!/composes:\s*workspaceSessionLayout/.test(block[1]));
});
