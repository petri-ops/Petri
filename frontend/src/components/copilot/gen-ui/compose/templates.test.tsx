import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { parseComposeSpec } from './spec';
import { ComposeCard } from './ComposeCard';

// BLOCK-464 P4-A — compose spec 模板库命中契约（HK-01 红绿先行）。
// CP-12 spec 化：resources/gen-ui/compose-templates/ 的每个模板必须
// ① 过 parseComposeSpec（fail-closed 校验器绿）② 经 ComposeCard 可渲染。

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../../resources/gen-ui/compose-templates',
);

const templateIds = ['job-overview', 'table-report', 'trend-chart'];

describe('compose 模板库命中契约（BLOCK-464 P4-A）', () => {
  it('三个模板文件在场且 id 一致', () => {
    for (const id of templateIds) {
      const file = path.join(TEMPLATES_DIR, `${id}.json`);
      assert.equal(fs.existsSync(file), true, `模板 ${id}.json 必须在场`);
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.equal(parsed.id, id);
      assert.ok(typeof parsed.description === 'string' && parsed.description.length > 10, `模板 ${id} 需带占位说明`);
    }
  });

  it('逐模板 parseComposeSpec 绿（fail-closed 校验器命中）', () => {
    for (const id of templateIds) {
      const parsed = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, `${id}.json`), 'utf8'));
      const spec = parseComposeSpec(parsed.spec);
      assert.notEqual(spec, null, `模板 ${id}.spec 必须过校验器`);
      assert.equal(spec?.version, 1);
    }
  });

  it('逐模板 ComposeCard 可渲染（占位值不炸穿）', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const id of templateIds) {
      const parsed = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, `${id}.json`), 'utf8'));
      const spec = parseComposeSpec(parsed.spec);
      cleanup();
      render(<ComposeCard spec={spec} conversationId={null} />);
      expect(screen.queryByTestId('compose-invalid')).toBeNull();
      cleanup();
    }
  });

  it('模板 spec 非法变体被拒（模板不可绕过校验器——复制改值后再校验的契约锚）', () => {
    const parsed = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, 'job-overview.json'), 'utf8'));
    const tampered = { ...parsed.spec, nodes: { ...parsed.spec.nodes, bad: { kind: 'iframe' } } };
    expect(parseComposeSpec(tampered)).toBeNull();
  });
});
