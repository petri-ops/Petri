/**
 * test/act-tool-core.test.mjs — A-008 unit tests for act-tool-core.js
 *
 * Verifies that 4 extracted pure functions behave identically to their
 * inline definitions in act-tools.js (before migration).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const R_SERVER = resolve(__dirname, '..', 'core', 'r-server');
const req = createRequire(import.meta.url);

const _core = req(R_SERVER + '/agent-tools/act-tool-core.js');
const { testFilterExpr, testFilterOne, _setImpliedPage, _getImpliedPage, _getRequestKey } = _core;

// --------------------------------------------------------------
// testFilterOne
// --------------------------------------------------------------

describe('act-tool-core: testFilterOne', () => {
  it('returns true for empty expression', () => {
    assert.strictEqual(testFilterOne('hello', ''), true);
    assert.strictEqual(testFilterOne('hello', '  '), true);
  });

  it('returns true for substring match (case-insensitive)', () => {
    assert.strictEqual(testFilterOne('CD4 T cells', 'cd4'), true);
    assert.strictEqual(testFilterOne('B cells', 'CELLS'), true);
    assert.strictEqual(testFilterOne('NK cells', 'nk'), true);
  });

  it('returns false for non-matching substring', () => {
    assert.strictEqual(testFilterOne('CD4 T cells', 'cd8'), false);
  });

  it('handles > comparison', () => {
    assert.strictEqual(testFilterOne('0.5', '> 0.3'), true);
    assert.strictEqual(testFilterOne('0.2', '> 0.3'), false);
    assert.strictEqual(testFilterOne('abc', '> 0.3'), false);
  });

  it('handles >= comparison', () => {
    assert.strictEqual(testFilterOne('0.5', '>= 0.5'), true);
    assert.strictEqual(testFilterOne('0.5', '>= 0.4'), true);
    assert.strictEqual(testFilterOne('0.3', '>= 0.5'), false);
  });

  it('handles < comparison', () => {
    assert.strictEqual(testFilterOne('0.2', '< 0.3'), true);
    assert.strictEqual(testFilterOne('0.5', '< 0.3'), false);
  });

  it('handles <= comparison', () => {
    assert.strictEqual(testFilterOne('0.5', '<= 0.5'), true);
    assert.strictEqual(testFilterOne('0.5', '<= 0.4'), false);
  });

  it('handles = comparison', () => {
    assert.strictEqual(testFilterOne('10', '= 10'), true);
    assert.strictEqual(testFilterOne('10', '= 11'), false);
  });

  it('handles != comparison', () => {
    assert.strictEqual(testFilterOne('10', '!= 10'), false);
    assert.strictEqual(testFilterOne('10', '!= 11'), true);
  });

  it('handles range syntax', () => {
    assert.strictEqual(testFilterOne('0.5', '0.3 - 0.7'), true);
    assert.strictEqual(testFilterOne('0.2', '0.3 - 0.7'), false);
    assert.strictEqual(testFilterOne('0.5', '0.5 - 0.5'), true);
  });
});

// --------------------------------------------------------------
// testFilterExpr
// --------------------------------------------------------------

describe('act-tool-core: testFilterExpr', () => {
  it('returns true for empty search string', () => {
    assert.strictEqual(testFilterExpr('anything', ''), true);
  });

  it('handles AND operator', () => {
    assert.strictEqual(testFilterExpr('CD4 T cells 0.5', 'cd4 AND 0.5'), true);
    assert.strictEqual(testFilterExpr('CD4 T cells 0.2', 'cd4 AND 0.5'), false);
  });

  it('handles OR operator', () => {
    assert.strictEqual(testFilterExpr('CD4 T cells', 'cd8 OR cd4'), true);
    assert.strictEqual(testFilterExpr('CD8 T cells', 'cd8 OR cd4'), true);
    assert.strictEqual(testFilterExpr('NK cells', 'cd8 OR cd4'), false);
  });

  it('handles comma-separated terms as OR', () => {
    assert.strictEqual(testFilterExpr('CD4 T cells', 'cd8,cd4'), true);
    assert.strictEqual(testFilterExpr('CD8 T cells', 'cd8,cd4'), true);
    assert.strictEqual(testFilterExpr('NK cells', 'cd8,cd4'), false);
  });

  it('handles pipe-separated terms as OR', () => {
    assert.strictEqual(testFilterExpr('B cells', 'cd4|b cells'), true);
    assert.strictEqual(testFilterExpr('NK cells', 'cd4|b cells'), false);
  });

  it('handles comparison operators in compound expressions', () => {
    assert.strictEqual(testFilterExpr('0.5', '> 0.3 AND < 0.8'), true);
    assert.strictEqual(testFilterExpr('0.9', '> 0.3 AND < 0.8'), false);
  });
});

// --------------------------------------------------------------
// _getRequestKey
// --------------------------------------------------------------

describe('act-tool-core: _getRequestKey', () => {
  it('returns null for empty/falsy ctx', () => {
    assert.strictEqual(_getRequestKey(null), null);
    assert.strictEqual(_getRequestKey(undefined), null);
    assert.strictEqual(_getRequestKey({}), null);
  });

  it('returns conversationId-based key', () => {
    const key = _getRequestKey({ conversationId: 'conv-123', _turnTs: '999' });
    assert.strictEqual(key, 'conv-123:999');
  });

  it('falls back to userId-based key', () => {
    const key = _getRequestKey({ userId: 'user-456', _turnTs: '888' });
    assert.strictEqual(key, 'user-456:888');
  });

  it('uses 0 as default turnTs', () => {
    const key = _getRequestKey({ conversationId: 'conv-123' });
    assert.strictEqual(key, 'conv-123:0');
  });
});

// --------------------------------------------------------------
// _setImpliedPage / _getImpliedPage
// --------------------------------------------------------------

describe('act-tool-core: _setImpliedPage / _getImpliedPage', () => {
  it('stores and retrieves implied page', () => {
    const ctx = { conversationId: 'conv-implied-test', _turnTs: '1' };
    _setImpliedPage(ctx, 'figcode');
    assert.strictEqual(_getImpliedPage(ctx), 'figcode');
  });

  it('returns null for unregistered context', () => {
    const ctx = { conversationId: 'never-registered', _turnTs: '2' };
    assert.strictEqual(_getImpliedPage(ctx), null);
  });

  it('returns null when ctx lacks identifiers', () => {
    assert.strictEqual(_getImpliedPage({}), null);
  });
});

// --------------------------------------------------------------
// plan-ui-tools integration: static require of act-tool-core
// --------------------------------------------------------------

describe('act-tool-core: plan-ui-tools integration', () => {
  it('plan-ui-tools can statically require act-tool-core without circular error', () => {
    const planUiTools = req(R_SERVER + '/agent-tools/plan-ui-tools.js');
    assert.strictEqual(typeof planUiTools.tool_plan, 'function');
    assert.strictEqual(typeof planUiTools.actUpdateFigcodeEditor, 'function');
    assert.strictEqual(typeof planUiTools.actOpenFigcodePlot, 'function');
  });
});
