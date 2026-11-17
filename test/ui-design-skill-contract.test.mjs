import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SKILL = resolve(ROOT, '.codebuddy/skills/petri-ui-design');

function read(rel) {
  return readFileSync(resolve(SKILL, rel), 'utf8');
}

test('UI design skill — required files exist', () => {
  for (const rel of [
    'SKILL.md',
    'references/design-brief-template.md',
    'references/module-state-matrix.md',
    'references/reference-analysis.md',
    'references/tool-adoption-matrix.md',
    'references/review-checklist.md',
  ]) {
    assert.ok(statSync(resolve(SKILL, rel)).size > 0, `${rel} must not be empty`);
  }
});

test('UI design skill — frontmatter and two modes', () => {
  const skill = read('SKILL.md');
  assert.match(skill, /^---\r?\nname: petri-ui-design\r?\n/);
  assert.match(skill, /^description: .+/m);
  assert.match(skill, /Internal mode/);
  assert.match(skill, /Product mode/);
  assert.doesNotMatch(skill, /\[TODO/);
});

test('UI design skill — governing sources and hard rules are explicit', () => {
  const skill = read('SKILL.md');
  for (const needle of [
    'docs/design-charter.md',
    'docs/ui-design-acceptance-checklist-v1.md',
    'docs/ui-productization-audit.md',
    'theme-token-contract',
    'pending_human_eye',
    'zero new dependencies',
  ]) {
    assert.ok(skill.includes(needle), `SKILL.md missing ${needle}`);
  }
});

test('UI design skill — design brief has all ten sections', () => {
  const brief = read('references/design-brief-template.md');
  for (const heading of [
    '## 1. Goal and non-goals',
    '## 2. Canonical anchors',
    '## 3. Information hierarchy',
    '## 4. Module state matrix',
    '## 5. Layout and responsive contract',
    '## 6. Token and component mapping',
    '## 7. Interaction and keyboard',
    '## 8. Anti-patterns and exclusions',
    '## 9. External references and licenses',
    '## 10. Verification plan',
  ]) {
    assert.ok(brief.includes(heading), `template missing ${heading}`);
  }
});

test('UI design skill — tool matrix preserves article tools and license stances', () => {
  const matrix = read('references/tool-adoption-matrix.md');
  for (const tool of ['Pinterest', 'Refero Styles', 'CTA Gallery', 'Footer Design', 'React Bits', 'assistant-ui', '21st.dev']) {
    assert.ok(matrix.includes(tool), `tool matrix missing ${tool}`);
  }
  assert.match(matrix, /MIT \+ Commons Clause/);
  assert.match(matrix, /Zero new dependencies/);
});
