'use strict';

// BLOCK-92 Wave C-7 — 存储 GC 簇外迁（原 lifecycle 926-1285 行，纯搬运零行为变化）：
// GC 候选枚举 / 源保护计划 / ref-transaction 提交 / private 路径清理。

const fs = require('fs');
const path = require('path');
const {
  resolveWorkspaceAnchor,
  inspectPrivateDirectory,
  inspectPrivateEntry,
  removePrivatePathSync,
} = require('../result-studio-private-path');
const {
  DEFAULT_GC_MIN_AGE_MS,
  GC_SOURCE_REF_PREFIX,
  GC_CHANGESET_REF_PREFIX,
  SAFE_CHANGESET_ID_PATTERN,
  ResultStudioLifecycleError,
  guardPrivatePath,
  sha256,
  expectedGcChangeSetRef,
} = require('./internal');

function listGcEntries({ repository, adapter, workspaceRoot, projectId, minAgeMs = DEFAULT_GC_MIN_AGE_MS, now = Date.now() }) {
  const workspaceAnchor = guardPrivatePath(() => resolveWorkspaceAnchor(workspaceRoot));
  const privateComponents = ['.biof3', 'revision'];
  const privateRoot = guardPrivatePath(() => inspectPrivateDirectory(
    workspaceAnchor,
    privateComponents,
    { allowMissing: true },
  ));
  const changes = repository.listChangeSets({ projectId, limit: 500 });
  const byId = new Map(changes.map((changeSet) => [changeSet.changeSetId, changeSet]));
  const entries = [];
  if (privateRoot) {
    for (const dirent of fs.readdirSync(privateRoot, { withFileTypes: true })) {
      if (dirent.isSymbolicLink()) {
        throw new ResultStudioLifecycleError(
          'private_path_symlink',
          'Result Studio private staging entries must not be symbolic links.',
        );
      }
      if (!dirent.isDirectory()) continue;
      const inspected = guardPrivatePath(() => inspectPrivateEntry(
        workspaceAnchor,
        [...privateComponents, dirent.name],
        { kind: 'directory' },
      ));
      const full = inspected.path;
      const ageMs = Math.max(0, now - inspected.stat.mtimeMs);
      const changeSet = byId.get(dirent.name);
      const temp = dirent.name.startsWith('.tmp-');
      const closed = changeSet && ['validation_failed', 'reverted', 'abandoned'].includes(changeSet.status);
      if (ageMs >= minAgeMs && (temp || closed)) {
        entries.push({ kind: 'private_staging', relativePath: path.relative(workspaceAnchor, full).split(path.sep).join('/'), changeSetId: changeSet?.changeSetId || null, ageMs });
      }
    }
  }
  for (const changeSet of changes) {
    if (!['validation_failed', 'reverted', 'abandoned'].includes(changeSet.status)) continue;
    const expectedRef = expectedGcChangeSetRef(changeSet.changeSetId);
    if (!expectedRef || changeSet.workingBranchRef !== expectedRef) continue;
    const actual = adapter.revParse(expectedRef);
    if (actual && (!changeSet.candidateCommit || actual === changeSet.candidateCommit)) {
      entries.push({ kind: 'candidate_ref', ref: expectedRef, expectedCommit: actual, changeSetId: changeSet.changeSetId });
    }
  }
  return entries;
}

function buildGcSourceProtection({ repository, adapter, projectId }) {
  const reachability = repository.analyzeRevisionReachability(projectId);
  const revisions = repository.listProjectRevisions(projectId, { limit: 10000 });
  if (revisions.length !== reachability.total) {
    throw new ResultStudioLifecycleError(
      'gc_revision_inventory_incomplete',
      'GC cannot continue without the complete persisted Revision inventory.',
      { listedRevisionCount: revisions.length, reachabilityRevisionCount: reachability.total },
    );
  }

  const reachableById = new Map(
    reachability.reachable.map((entry) => [entry.revisionId, entry.reasons]),
  );
  const gcCandidateIds = new Set(reachability.gcCandidates.map((entry) => entry.revisionId));
  const sourceBindings = revisions.map((revision) => ({
    revisionId: revision.revisionId,
    sourceCommit: revision.sourceCommit,
    sourcePath: revision.sourceScriptRef?.relativePath || null,
    sourceHash: revision.sourceScriptRef?.sha256 || null,
    parametersPath: revision.parametersRef || null,
    parametersHash: revision.parametersHash || null,
    reachability: reachableById.has(revision.revisionId)
      ? { state: 'reachable', reasons: [...reachableById.get(revision.revisionId)].sort() }
      : gcCandidateIds.has(revision.revisionId)
        ? { state: 'gc_candidate', reasons: [] }
        : { state: 'unclassified', reasons: [] },
  })).sort((left, right) => left.revisionId.localeCompare(right.revisionId));

  const invalid = sourceBindings.filter((entry) => !/^[a-f0-9]{40}$/.test(String(entry.sourceCommit || '')));
  if (invalid.length > 0) {
    throw new ResultStudioLifecycleError(
      'gc_revision_source_invalid',
      'GC cannot continue while a persisted Revision has no canonical source commit.',
      { revisionIds: invalid.map((entry) => entry.revisionId) },
    );
  }

  const sourceCommits = [...new Set(sourceBindings.map((entry) => entry.sourceCommit))].sort();
  const resolved = adapter.resolveManyRefs(sourceCommits.map((commit) => `${commit}^{commit}`));
  const missing = sourceCommits.filter((commit) => resolved.get(`${commit}^{commit}`) !== commit);
  if (missing.length > 0) {
    throw new ResultStudioLifecycleError(
      'gc_revision_source_missing',
      'GC cannot continue while a persisted Revision source commit is unavailable.',
      { sourceCommits: missing },
    );
  }

  const bindingsByCommit = new Map();
  for (const binding of sourceBindings) {
    if (!bindingsByCommit.has(binding.sourceCommit)) bindingsByCommit.set(binding.sourceCommit, []);
    bindingsByCommit.get(binding.sourceCommit).push(binding);
  }
  const protectedSourceRefs = sourceCommits.map((sourceCommit) => {
    const ref = `${GC_SOURCE_REF_PREFIX}${sourceCommit}`;
    const currentCommit = adapter.revParse(ref);
    if (currentCommit && currentCommit !== sourceCommit) {
      throw new ResultStudioLifecycleError(
        'gc_source_ref_conflict',
        'A protected Result Studio source ref points to a different commit.',
        { ref, expectedCommit: sourceCommit, actualCommit: currentCommit },
      );
    }
    const bindings = bindingsByCommit.get(sourceCommit);
    return {
      ref,
      sourceCommit,
      currentCommit,
      action: currentCommit === sourceCommit ? 'verify' : 'create_before_cleanup',
      revisionIds: bindings.map((entry) => entry.revisionId),
      reachableRevisionCount: bindings.filter((entry) => entry.reachability.state === 'reachable').length,
      historicalRevisionCount: bindings.length,
    };
  });
  const revisionSourceDigest = sha256(JSON.stringify(sourceBindings));
  const protectedSourceRefDigest = sha256(JSON.stringify(protectedSourceRefs.map((entry) => ({
    ref: entry.ref,
    sourceCommit: entry.sourceCommit,
    revisionIds: entry.revisionIds,
  }))));
  const protectionStateDigest = sha256(JSON.stringify(protectedSourceRefs.map((entry) => ({
    ref: entry.ref,
    currentCommit: entry.currentCommit,
    action: entry.action,
  }))));
  return {
    reachability,
    sourceBindings,
    revisionSourceDigest,
    protectedSourceRefs,
    protectedSourceRefDigest,
    protectionStateDigest,
  };
}

function attachGcSourceProtection(entries, protectedSourceRefs, adapter) {
  const byCommit = new Map(protectedSourceRefs.map((entry) => [entry.sourceCommit, entry]));
  const candidateRefs = new Set(
    entries.filter((entry) => entry.kind === 'candidate_ref').map((entry) => entry.ref),
  );
  const deletableEntries = [];
  const protectedCandidateRefs = [];
  for (const entry of entries) {
    if (entry.kind !== 'candidate_ref') {
      deletableEntries.push(entry);
      continue;
    }
    const expectedRef = expectedGcChangeSetRef(entry.changeSetId);
    if (!expectedRef || entry.ref !== expectedRef) {
      throw new ResultStudioLifecycleError(
        'gc_candidate_ref_contract_mismatch',
        'GC refuses to inspect or delete a ref that is not the exact server-derived ChangeSet candidate ref.',
        { changeSetId: entry.changeSetId, expectedRef, actualRef: entry.ref },
      );
    }
    const sourceProtection = byCommit.get(entry.expectedCommit);
    const containing = adapter.run([
      'for-each-ref',
      '--format=%(refname)',
      `--contains=${entry.expectedCommit}`,
    ], { allowFailure: true, readOnly: true });
    if (!containing.ok) {
      throw new ResultStudioLifecycleError(
        'gc_ref_reachability_unavailable',
        'GC cannot prove independent candidate commit reachability.',
        { changeSetId: entry.changeSetId, code: containing.code, status: containing.status },
      );
    }
    const independentExistingRefCount = new Set(containing.stdout.split('\n')
      .map((ref) => ref.trim())
      .filter((ref) => ref && !candidateRefs.has(ref))).size;
    const projectedIndependentRefCount = independentExistingRefCount + (
      sourceProtection && sourceProtection.action === 'create_before_cleanup' ? 1 : 0
    );
    const annotated = {
      ...entry,
      sourceRevisionIds: sourceProtection?.revisionIds || [],
      independentSourceRef: sourceProtection?.ref || null,
      independentlyReachableAfterPlan: projectedIndependentRefCount > 0,
      independentReachabilityCount: projectedIndependentRefCount,
    };
    if (annotated.independentlyReachableAfterPlan) deletableEntries.push(annotated);
    else protectedCandidateRefs.push({
      ...annotated,
      reason: 'candidate_commit_has_no_independent_ref',
    });
  }
  return { entries: deletableEntries, protectedCandidateRefs };
}

function planResultStudioGc(input = {}, dependencies = {}) {
  if (!dependencies.repository || !dependencies.adapter || !input.workspaceRoot || !input.projectId) {
    throw new ResultStudioLifecycleError('gc_dependencies_missing', 'Repository, adapter, workspace and project are required for GC.');
  }
  const sourceProtection = buildGcSourceProtection({
    repository: dependencies.repository,
    adapter: dependencies.adapter,
    projectId: input.projectId,
  });
  const candidateClassification = attachGcSourceProtection(
    listGcEntries({ ...input, repository: dependencies.repository, adapter: dependencies.adapter }),
    sourceProtection.protectedSourceRefs,
    dependencies.adapter,
  );
  const { entries, protectedCandidateRefs } = candidateClassification;
  const tokenPayload = JSON.stringify({
    gcPlanVersion: 2,
    projectId: input.projectId,
    entries: entries.map((entry) => entry.kind === 'candidate_ref'
      ? {
        kind: entry.kind,
        ref: entry.ref,
        expectedCommit: entry.expectedCommit,
        changeSetId: entry.changeSetId,
        independentSourceRef: entry.independentSourceRef,
      }
      : {
        kind: entry.kind,
        relativePath: entry.relativePath,
        changeSetId: entry.changeSetId,
      }),
    revisionSourceDigest: sourceProtection.revisionSourceDigest,
    protectedSourceRefDigest: sourceProtection.protectedSourceRefDigest,
    protectionStateDigest: sourceProtection.protectionStateDigest,
    protectedCandidateRefs: protectedCandidateRefs.map((entry) => ({
      ref: entry.ref,
      expectedCommit: entry.expectedCommit,
      changeSetId: entry.changeSetId,
      reason: entry.reason,
    })),
  });
  return {
    gcPlanVersion: 2,
    projectId: input.projectId,
    mode: 'dry_run',
    entries,
    planToken: sha256(`${input.projectId}\0${tokenPayload}`),
    protectedRevisionCount: sourceProtection.reachability.reachable.length,
    unreachableRevisionMetadataCount: sourceProtection.reachability.gcCandidates.length,
    sourceRevisionCount: sourceProtection.sourceBindings.length,
    sourceCommitCount: sourceProtection.protectedSourceRefs.length,
    revisionSourceDigest: sourceProtection.revisionSourceDigest,
    protectedSourceRefDigest: sourceProtection.protectedSourceRefDigest,
    protectedSourceRefs: sourceProtection.protectedSourceRefs,
    protectedCandidateRefs,
    sourceProtectionCreateCount: sourceProtection.protectedSourceRefs
      .filter((entry) => entry.action === 'create_before_cleanup').length,
    artifactDeletionCount: 0,
    note: 'GC never deletes Artifact files or Revision history; every persisted Revision source commit is protected by an independent internal ref before closed private staging or matching candidate refs are removed.',
  };
}

function executeGcRefTransaction(plan, adapter) {
  const candidateRefs = plan.entries.filter((entry) => entry.kind === 'candidate_ref');
  if (plan.protectedSourceRefs.length === 0 && candidateRefs.length === 0) return;
  const commands = ['start'];
  for (const entry of plan.protectedSourceRefs) {
    commands.push(entry.action === 'create_before_cleanup'
      ? `create ${entry.ref} ${entry.sourceCommit}`
      : `verify ${entry.ref} ${entry.sourceCommit}`);
  }
  for (const entry of candidateRefs) {
    const expectedRef = expectedGcChangeSetRef(entry.changeSetId);
    if (!expectedRef || entry.ref !== expectedRef) {
      throw new ResultStudioLifecycleError(
        'gc_candidate_ref_contract_mismatch',
        'GC refuses to delete a ref that is not the exact server-derived ChangeSet candidate ref.',
        { changeSetId: entry.changeSetId, expectedRef, actualRef: entry.ref },
      );
    }
    commands.push(`delete ${entry.ref} ${entry.expectedCommit}`);
  }
  commands.push('prepare', 'commit');
  const result = adapter.run(['update-ref', '--stdin'], {
    allowFailure: true,
    input: `${commands.join('\n')}\n`,
  });
  if (!result.ok) {
    throw new ResultStudioLifecycleError(
      'gc_ref_transaction_failed',
      'Protected source refs and candidate ref cleanup could not be committed atomically.',
      { code: result.code, status: result.status, stderr: result.stderr },
    );
  }
}

function gcPrivateEntryComponents(entry) {
  const relativePath = String(entry?.relativePath || '');
  const components = relativePath.split('/');
  if (components.length !== 3
      || components[0] !== '.biof3'
      || components[1] !== 'revision'
      || !components[2]
      || components.join('/') !== relativePath) {
    throw new ResultStudioLifecycleError('gc_path_escape', 'GC target escaped private staging.');
  }
  return components;
}

function executeResultStudioGc(input = {}, dependencies = {}) {
  const plan = planResultStudioGc(input, dependencies);
  if (!input.planToken || input.planToken !== plan.planToken) throw new ResultStudioLifecycleError('gc_plan_stale', 'GC plan token is missing or stale.');
  const workspaceRoot = guardPrivatePath(() => resolveWorkspaceAnchor(input.workspaceRoot));
  const privateEntries = plan.entries
    .filter((entry) => entry.kind !== 'candidate_ref')
    .map((entry) => ({
      entry,
      components: gcPrivateEntryComponents(entry),
    }));
  // Validate every deletion target again after planning and before the Git ref
  // transaction. This prevents a stale plan from mutating refs before a
  // replaced private root or staging directory is detected.
  for (const { components } of privateEntries) {
    guardPrivatePath(() => inspectPrivateEntry(workspaceRoot, components, { kind: 'directory' }));
  }
  const removed = [];
  executeGcRefTransaction(plan, dependencies.adapter);
  for (const entry of plan.entries) {
    if (entry.kind === 'candidate_ref') {
      removed.push(entry);
    } else {
      const components = gcPrivateEntryComponents(entry);
      guardPrivatePath(() => removePrivatePathSync(workspaceRoot, components, {
        recursive: true,
        kind: 'directory',
      }));
      removed.push(entry);
    }
  }
  for (const entry of plan.protectedSourceRefs) {
    if (dependencies.adapter.revParse(entry.ref) !== entry.sourceCommit) {
      throw new ResultStudioLifecycleError(
        'gc_source_protection_postcondition_failed',
        'A protected source ref failed its postcondition after GC.',
        { ref: entry.ref, expectedCommit: entry.sourceCommit },
      );
    }
  }
  return {
    ...plan,
    mode: 'executed',
    removedCount: removed.length,
    removed,
    createdProtectedSourceRefCount: plan.sourceProtectionCreateCount,
    protectedSourceRefs: plan.protectedSourceRefs.map((entry) => ({
      ...entry,
      currentCommit: entry.sourceCommit,
      action: 'protected',
    })),
  };
}


module.exports = {
  listGcEntries,
  buildGcSourceProtection,
  attachGcSourceProtection,
  planResultStudioGc,
  executeResultStudioGc,
};
