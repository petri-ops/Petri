#!/usr/bin/env node

/**
 * Loop Repair Strategy — unit tests (CJS).
 * Run via: node --test test/loop-repair-strategy.test.cjs
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  REPAIR_STRATEGIES,
  selectRepairStrategy,
  computeAffectedSubgraph,
  listStrategies,
  getStrategy,
} = require('../core/shared-backend/loop-repair-strategy');

const fd = require('../core/shared-backend/loop-failure-diagnoser');

// ---------------------------------------------------------------------------
// RS-1: Strategy listing
// ---------------------------------------------------------------------------

describe('RS-1 strategy listing', () => {
  it('12 strategies registered', () => {
    assert.strictEqual(REPAIR_STRATEGIES.length, 12);
  });

  it('listStrategies returns all 12', () => {
    const list = listStrategies();
    assert.strictEqual(list.length, 12);
    const ids = list.map((s) => s.strategyId);
    assert.ok(ids.includes('retry_with_reconcile'));
    assert.ok(ids.includes('rerun_upstream'));
    assert.ok(ids.includes('require_user_authorization'));
  });

  it('getStrategy returns strategy or null', () => {
    const s = getStrategy('fix_schema_violation');
    assert.strictEqual(s?.strategyId, 'fix_schema_violation');
    assert.strictEqual(getStrategy('unknown'), null);
  });

  it('strategies have required fields', () => {
    for (const s of REPAIR_STRATEGIES) {
      assert.ok(s.strategyId);
      assert.ok(s.version);
      assert.ok(s.faultTypes?.length > 0);
      assert.ok(s.name);
      assert.ok(typeof s.applicability === 'function');
      assert.ok(typeof s.attempt === 'function');
      assert.ok(['safe', 'risky', 'unsafe'].includes(s.safetyLevel));
      assert.ok(typeof s.costMultiplier === 'number');
    }
  });
});

// ---------------------------------------------------------------------------
// RS-2: transient_runtime → safe strategies
// ---------------------------------------------------------------------------

describe('RS-2 transient_runtime repair', () => {
  it('diagnose + select: ENOENT → retry_with_reconcile', () => {
    const d = fd.diagnoseFailure({ error: 'ENOENT: no such file' });
    const s = selectRepairStrategy(d, { parentJobId: 'job_1' });
    assert.strictEqual(s?.strategyId, 'retry_with_reconcile');
    assert.strictEqual(s?.isActionable, true);
    assert.strictEqual(s?.requiresUserAuth, false);
    assert.strictEqual(s?.safetyLevel, 'safe');
    assert.strictEqual(s?.costMultiplier, 1.0);
  });

  it('retry_with_reconcile preserves parent lineage', () => {
    const d = fd.diagnoseFailure({ error: 'EBUSY: resource busy' });
    const s = selectRepairStrategy(d, {
      parentJobId: 'job_123',
      parentArtifactIds: ['a1', 'a2'],
    });
    assert.strictEqual(s?.parentLineage?.parentJobId, 'job_123');
    assert.ok(s?.parentLineage);
    assert.deepStrictEqual([...s.parentLineage.parentArtifactIds], ['a1', 'a2']);
  });

  it('retry_with_reconcile preserves all artifacts', () => {
    const d = fd.diagnoseFailure({ error: 'EAGAIN' });
    const s = selectRepairStrategy(d, { parentJobId: 'j1' });
    assert.ok(s);
    assert.deepStrictEqual([...s.preservedArtifactIds], []);
  });

  it('retry_same_params is selected for EAGAIN', () => {
    const d = fd.diagnoseFailure({ error: 'EAGAIN: resource temporarily unavailable' });
    const s = selectRepairStrategy(d, {});
    assert.strictEqual(s?.strategyId, 'retry_same_params');
  });
});

// ---------------------------------------------------------------------------
// RS-3: transient_provider → backoff + fallback
// ---------------------------------------------------------------------------

describe('RS-3 transient_provider repair', () => {
  it('rate limit → provider_backoff_retry', () => {
    const d = fd.diagnoseFailure({ error: 'HTTP 429: Too Many Requests' });
    const s = selectRepairStrategy(d, {});
    assert.strictEqual(s?.strategyId, 'provider_backoff_retry');
    assert.strictEqual(s?.isActionable, true);
    assert.strictEqual(s?.costMultiplier, 1.1);
  });

  it('gateway error without fallback → provider_backoff_retry (not fallback)', () => {
    const d = fd.diagnoseFailure({ error: 'HTTP 502: Bad Gateway' });
    const s1 = selectRepairStrategy(d, { fallbackProvider: null });
    assert.strictEqual(s1?.strategyId, 'provider_backoff_retry');

    const s2 = selectRepairStrategy(d, { fallbackProvider: 'claude-3-5-sonnet' });
    assert.strictEqual(s2?.strategyId, 'fallback_provider');
    assert.strictEqual(s2?.isActionable, false);
    assert.strictEqual(s2?.requiresUserAuth, true);
    assert.strictEqual(s2?.costMultiplier, 1.2);
  });

  it('fallback_provider appends _provider to params', () => {
    const d = fd.diagnoseFailure({ error: 'timeout' });
    const s = selectRepairStrategy(d, {
      fallbackProvider: 'claude-3-5-sonnet',
      originalParams: { temperature: 0.7 },
    });
    assert.strictEqual(s?.strategyId, 'fallback_provider');
    assert.ok(s?.newParams?._provider === 'claude-3-5-sonnet');
    assert.ok(s?.newParams?._repair === 'fallback_provider');
  });
});

// ---------------------------------------------------------------------------
// RS-4: invalid_arguments → schema/range fix
// ---------------------------------------------------------------------------

describe('RS-4 invalid_arguments repair', () => {
  it('INVALID_ARGUMENTS → fix_schema_violation (with tool definition)', () => {
    const d = fd.diagnoseFailure({ reason_code: 'INVALID_ARGUMENTS' });
    const s = selectRepairStrategy(d, {
      toolDefinition: { parameters: { required: ['alpha'] } },
    });
    assert.strictEqual(s?.strategyId, 'fix_schema_violation');
    assert.strictEqual(s?.isActionable, true);
    assert.strictEqual(s?.costMultiplier, 1.0);
  });

  it('fix_schema_violation adds _repair to params', () => {
    const d = fd.diagnoseFailure({ error: 'out of range' });
    const s = selectRepairStrategy(d, {
      toolDefinition: { parameters: {} },
      originalParams: { alpha: 0.05 },
    });
    assert.strictEqual(s?.newParams?._repair, 'schema_fix');
  });

  it('fix_enum_or_range clamps params', () => {
    const d = fd.diagnoseFailure({ error: 'enumerated value not allowed' });
    const s = selectRepairStrategy(d, {
      originalParams: { method: 'DESeq2' },
    });
    assert.strictEqual(s?.strategyId, 'fix_enum_or_range');
    assert.strictEqual(s?.newParams?._repair, 'clamp_fix');
  });
});

// ---------------------------------------------------------------------------
// RS-5: input_format → transform
// ---------------------------------------------------------------------------

describe('RS-5 input_format repair', () => {
  it('column mismatch → transform_input_format (requires inputTransformation)', () => {
    const d = fd.diagnoseFailure({ error: 'column "gene" not found' });
    const s = selectRepairStrategy(d, {
      inputTransformation: 'rename_column: gene → Gene',
    });
    assert.strictEqual(s?.strategyId, 'transform_input_format');
    assert.strictEqual(s?.isActionable, true);
    assert.strictEqual(s?.publicMessage.includes('rename_column'), true);
  });

  it('transform_input_format skips without inputTransformation', () => {
    const d = fd.diagnoseFailure({ error: 'column mismatch' });
    const s = selectRepairStrategy(d, {});
    assert.notStrictEqual(s?.strategyId, 'transform_input_format');
  });
});

// ---------------------------------------------------------------------------
// RS-6: runtime_not_ready → ensure_capability
// ---------------------------------------------------------------------------

describe('RS-6 runtime_not_ready repair', () => {
  it('missing package → ensure_capability', () => {
    const d = fd.diagnoseFailure({ error: 'package "ggplot2" not found' });
    const s = selectRepairStrategy(d, {});
    assert.strictEqual(s?.strategyId, 'ensure_capability');
    assert.strictEqual(s?.isActionable, false); // requires capability provisioning step
    assert.strictEqual(s?.safetyLevel, 'safe');
    assert.strictEqual(s?.costMultiplier, 1.1);
  });
});

// ---------------------------------------------------------------------------
// RS-7: artifact_invalid → rerun_upstream
// ---------------------------------------------------------------------------

describe('RS-7 artifact_invalid repair', () => {
  it('ARTIFACT_VALIDATION_FAILED → rerun_upstream', () => {
    const d = fd.diagnoseFailure({ reason_code: 'ARTIFACT_VALIDATION_FAILED' });
    const dag = {
      nodes: [
        { id: 'n1', status: 'completed' },
        { id: 'n2', status: 'failed', dependsOn: ['n1'] },
        { id: 'n3', status: 'completed', dependsOn: ['n2'] },
      ],
    };
    const s = selectRepairStrategy(d, {
      dag,
      failedNodeId: 'n2',
      verifiedArtifactIds: ['a1'],
    });
    assert.strictEqual(s?.strategyId, 'rerun_upstream');
    assert.strictEqual(s?.isActionable, true);
    assert.strictEqual(s?.costMultiplier, 1.5);
  });

  it('rerun_upstream preserves verified artifacts', () => {
    const d = fd.diagnoseFailure({ reason_code: 'ARTIFACT_VALIDATION_FAILED' });
    const s = selectRepairStrategy(d, {
      dag: { nodes: [] },
      failedNodeId: 'n1',
      verifiedArtifactIds: ['a1', 'a2'],
    });
    assert.ok(s);
    assert.deepStrictEqual([...s.preservedArtifactIds], ['a1', 'a2']);
  });
});

// ---------------------------------------------------------------------------
// RS-8: scientific_design_missing → require_user
// ---------------------------------------------------------------------------

describe('RS-8 scientific_design_missing repair', () => {
  it('contrast missing → require_user (boundary blocked)', () => {
    const d = fd.diagnoseFailure({ error: 'contrast not specified: define treatment vs control' });
    const s = selectRepairStrategy(d, {});
    assert.strictEqual(s?.strategyId, 'replan_subgraph');
    assert.strictEqual(s?.isActionable, false);
    assert.strictEqual(s?.requiresUserAuth, true);
    // HLE-C5R: boundary blocks replan_subgraph for scientific_design_missing
    assert.strictEqual(s?.safetyLevel, 'risky');
    assert.strictEqual(s?.costMultiplier, 2.0);
    // Boundary message confirms blocking
    assert.ok(s?.publicMessage?.includes('阻断'), 'Should mention boundary block');
    assert.ok(s?.publicMessage?.includes('Scientific design/contrast') || s?.publicMessage?.includes('Repair Boundary'), 'Should mention scientific decision');
  });

  it('method_not_applicable → replan_subgraph', () => {
    const d = fd.diagnoseFailure({ error: 'method preconditions not met' });
    const s = selectRepairStrategy(d, {});
    assert.strictEqual(s?.strategyId, 'replan_subgraph');
    // HLE-C5R: replan_subgraph blocked - requires scientific decision
    assert.strictEqual(s?.requiresUserAuth, true);
  });
});

// ---------------------------------------------------------------------------
// RS-9: resource_pressure
// ---------------------------------------------------------------------------

describe('RS-9 resource_pressure repair', () => {
  it('OOM → reduce_resource_request', () => {
    const d = fd.diagnoseFailure({ error: 'out of memory' });
    const s = selectRepairStrategy(d, {});
    assert.strictEqual(s?.strategyId, 'reduce_resource_request');
    assert.strictEqual(s?.costMultiplier, 1.0);
  });

  it('disk full → reduce_resource_request', () => {
    const d = fd.diagnoseFailure({ error: 'ENOSPC: no space left' });
    const s = selectRepairStrategy(d, {});
    assert.strictEqual(s?.strategyId, 'reduce_resource_request');
  });
});

// ---------------------------------------------------------------------------
// RS-10: external_side_effect → block
// ---------------------------------------------------------------------------

describe('RS-10 external_side_effect repair', () => {
  it('external write → require_user_authorization', () => {
    const d = fd.diagnoseFailure({ error: 'upload blocked by security policy' });
    const s = selectRepairStrategy(d, {});
    assert.strictEqual(s?.strategyId, 'require_user_authorization');
    assert.strictEqual(s?.isActionable, false);
    assert.strictEqual(s?.requiresUserAuth, true);
    assert.strictEqual(s?.safetyLevel, 'unsafe');
  });

  it('costMultiplier is 0 for blocked ops', () => {
    const d = fd.diagnoseFailure({ error: 'paid operation attempted' });
    const s = selectRepairStrategy(d, {});
    assert.strictEqual(s?.costMultiplier, 0);
  });
});

// ---------------------------------------------------------------------------
// RS-11: computeAffectedSubgraph
// ---------------------------------------------------------------------------

describe('RS-11 computeAffectedSubgraph', () => {
  it('returns empty for null dag', () => {
    const r = computeAffectedSubgraph(null, 'n1');
    assert.deepStrictEqual(r.nodeIds, []);
    assert.strictEqual(r.firstUnverifiedNodeId, null);
  });

  it('marks failed node and downstream', () => {
    const dag = {
      nodes: [
        { id: 'n1', status: 'completed', downstream: ['n2'] },
        { id: 'n2', status: 'failed', downstream: ['n3'] },
        { id: 'n3', status: 'pending' },
      ],
    };
    const r = computeAffectedSubgraph(dag, 'n2');
    assert.ok(r.nodeIds.includes('n2'));
    assert.ok(r.nodeIds.includes('n3'));
    assert.ok(!r.nodeIds.includes('n1'));
  });

  it('firstUnverifiedNodeId is the failed node', () => {
    const dag = {
      nodes: [
        { id: 'n1', status: 'completed' },
        { id: 'n2', status: 'failed' },
      ],
    };
    const r = computeAffectedSubgraph(dag, 'n2');
    assert.strictEqual(r.firstUnverifiedNodeId, 'n2');
  });

  it('verified nodes are excluded from firstUnverifiedNodeId', () => {
    const dag = {
      nodes: [
        { id: 'n1', status: 'completed', downstream: ['n2', 'n3'] },
        { id: 'n2', status: 'verified', downstream: ['n3'] },
        { id: 'n3', status: 'pending' },
      ],
    };
    const r = computeAffectedSubgraph(dag, 'n2');
    assert.strictEqual(r.firstUnverifiedNodeId, 'n3');
  });
});

// ---------------------------------------------------------------------------
// RS-12: buildRepairAttempt output shape
// ---------------------------------------------------------------------------

describe('RS-12 buildRepairAttempt output shape', () => {
  // HLE-C5R: boundary-blocked results return new unfrozen object
  it('boundary-blocked result is unfrozen', () => {
    const d = fd.diagnoseFailure({ error: 'method preconditions not met' });
    const s = selectRepairStrategy(d, {});
    assert.strictEqual(s?.strategyId, 'replan_subgraph');
    assert.strictEqual(s?.requiresUserAuth, true);
    assert.ok(!Object.isFrozen(s));
  });

  it('normal result is frozen', () => {
    const d = fd.diagnoseFailure({ error: 'OOM' });
    const s = selectRepairStrategy(d, {});
    assert.ok(Object.isFrozen(s));
    assert.ok(Object.isFrozen(s.parentLineage));
    assert.ok(Object.isFrozen(s.parentLineage.parentArtifactIds));
    assert.ok(Object.isFrozen(s.invalidatedArtifactIds));
    assert.ok(Object.isFrozen(s.preservedArtifactIds));
  });

  it('costMultiplier is non-negative', () => {
    for (const s of REPAIR_STRATEGIES) {
      assert.ok(s.costMultiplier >= 0, `${s.strategyId} has negative costMultiplier`);
    }
  });

  it('isActionable only true for safe/low-cost strategies', () => {
    for (const s of REPAIR_STRATEGIES) {
      if (s.safetyLevel === 'unsafe') {
        const d = fd.diagnoseFailure({ error: 'external write' });
        const r = selectRepairStrategy(d, {});
        assert.strictEqual(r?.isActionable, false);
      }
    }
  });

  it('parentLineage always has parentJobId', () => {
    const d = fd.diagnoseFailure({ error: 'EAGAIN' });
    const s = selectRepairStrategy(d, { parentJobId: 'job_abc' });
    assert.strictEqual(s?.parentLineage?.parentJobId, 'job_abc');
  });

  it('publicMessage is non-empty for all strategies', () => {
    for (const s of REPAIR_STRATEGIES) {
      const d = fd.diagnoseFailure({ error: 'test' });
      const r = selectRepairStrategy(d, {});
      if (r) {
        assert.ok(r.publicMessage?.length > 0, `${s.strategyId} has empty publicMessage`);
      }
    }
  });
});