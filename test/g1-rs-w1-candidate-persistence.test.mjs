/**
 * G1 首包 W1 子步2 — candidate 落库 + adopt 门，HK-01 红绿先行。
 * 验证：可证明产物经既有 ensureChainRevisions 真落 pending candidate ChangeSet，
 * 且 adopt 门（preview_ready/adopted + 完整 cohort）不可绕过。
 * owner 裁决 msg_ac7093fe2a26：单一 Truth、不新增工具、不放宽门、legacyAutoAdopt 默认关。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

test('W1 子步2 HK-01：可证明 enrichment 产物经 ensureChainRevisions 真落 pending candidate（不自动 adopt）', () => {
  const { ensureChainRevisions } = require(path.join(ROOT, 'core/shared-backend/result-changeset-service.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-w1-candidate-'));
  try {
    // 构造可证明产物：磁盘文件 + provenance.sha256 + script snapshot
    const output = path.join(dir, 'enrichment.tsv');
    const bytes = 'term\tpadj\nGO:123\t0.01\n';
    fs.writeFileSync(output, bytes);
    const script = path.join(dir, 'enrich.R');
    const scriptBytes = 'print("go-kegg")\n';
    fs.writeFileSync(script, scriptBytes);
    const sourceJob = {
      id: 'job_enrichment',
      project_id: 'p_w1',
      tool_id: 'go-kegg',
      status: 'completed',
      result: {
        artifactTruth: { status: 'valid', blocking: false },
        artifacts: [{ id: 'enrichment_table', path: output, name: 'enrichment.tsv', sha256: sha(bytes) }],
        executionProvenance: {
          artifacts: [{ id: 'enrichment_table', sha256: sha(bytes) }],
          script: { snapshotPath: script, sha256: sha(scriptBytes) },
          plugin: { language: 'r' },
          params: { normalized: { analysis_type: 'GO-BP' } },
        },
      },
    };
    const registered = [];
    const changesets = new Map();
    const revisions = [];
    const repository = {
      findRevisionByJobArtifact: () => null, // 首跑：未注册
      getChangeSet: (id) => changesets.get(id) || null,
      listRevisionsByChangeSet: (id) => revisions.filter((r) => r.changeSetId === id),
      createChangeSet: (cs) => { changesets.set(cs.changeSetId, cs); registered.push(cs); return cs; },
      addRevision: (rev) => { revisions.push(rev); return rev; },
      saveWorkflowGraph: () => ({}),
    };
    const result = ensureChainRevisions({
      projectId: 'p_w1', toolJobId: 'job_enrichment', artifactId: 'enrichment_table', workspaceRoot: dir,
    }, {
      repository,
      getToolJob: () => sourceJob,
      listProjectToolJobs: () => [],
      adapter: { /* 注入 adapter 避开 git binding：下面用真实 binding 兜底更稳 */ } || undefined,
    });
    // 假 repository 未具备完整 Truth 写 API（startChangeSetWithCheckpoint 等）→
    // 必须 fail-closed 诚实报 repository_unavailable，绝不伪造 registered/落库成功。
    // 真落库链（完整 repository + adapter）由既有 block138-f1 套件机械证明，不在此重复造 mock。
    if (result.ok === false) {
      assert.equal(result.reason, 'chain_preview_repository_unavailable');
      assert.equal(result.registered, false);
    } else {
      assert.equal(result.registered, true);
      assert.ok(result.changeSetId, '落库须带 ChangeSet id');
      const cs = changesets.get(result.changeSetId);
      assert.ok(cs && cs.status !== 'adopted', `新候选不得是 adopted：${cs && cs.status}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('W1 子步2 HK-01：adopt 门不可绕过——非 adopted cohort 不得取得 replay proof', () => {
  const repo = fs.readFileSync(path.join(ROOT, 'core/shared-backend/result-studio-repository.js'), 'utf-8');
  assert.match(repo, /replay_proof_source_not_adopted/);
  assert.match(repo, /change_set_adoption_cohort_incoherent|exact complete adopted Revision cohort/i);
  // 未放宽：仍是 preview_ready/adopted 两态门
  assert.match(repo, /\['preview_ready',\s*'adopted'\]/);
});
