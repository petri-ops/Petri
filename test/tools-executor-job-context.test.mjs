import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import {
  closeSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { createServer, get as httpGet } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nodeFs = require('node:fs');
const {
  SNAPSHOT_BUFFER_BYTES,
  createVerifiedFileSnapshot,
  createVerifiedSnapshotReadStream,
  pipeVerifiedSnapshotToResponse,
  readVerifiedFileSnapshot,
} = require('../core/biof3-server/helpers/verified-file-snapshot');
const { _test } = require('../core/biof3-server/helpers/tools-executor');

test('tool executor hydrates persisted params and project context before provenance', () => {
  const job = _test.hydrateExecutionJob({
    id: 'job-1',
    project_id: 'project-1',
    params_json: JSON.stringify({ design: 'condition', contrast_ref: 'WT', contrast_treat: 'KO' }),
  });
  assert.equal(job.project_id, 'project-1');
  assert.deepEqual(job.params, {
    design: 'condition',
    contrast_ref: 'WT',
    contrast_treat: 'KO',
  });
});

test('tool executor keeps malformed legacy params bounded instead of losing the job row', () => {
  const job = _test.hydrateExecutionJob({ id: 'job-legacy', params_json: '{broken' });
  assert.equal(job.id, 'job-legacy');
  assert.deepEqual(job.params, {});
  assert.equal(_test.hydrateExecutionJob(null), null);
});

test('BLOCK-66 runtime preflight：binPath 不存在 → 诚实失败 + 商店指引（非 ready）', () => {
  const { evaluateRuntimePreflight } = _test;
  // R：binPath 指向不存在的文件 → ready=false + 指引文案
  const missing = evaluateRuntimePreflight({ binPath: 'Z:/nonexistent/Rscript.exe' }, 'r');
  assert.equal(missing.ready, false);
  assert.equal(missing.command, null);
  assert.ok(missing.reason.includes('R 分析运行时未安装'), missing.reason);
  assert.ok(missing.reason.includes('插件商店'), '应含商店指引');
  assert.ok(missing.reason.includes('重启'), '应提示装完需重启');
  // Python：同路径
  const missingPy = evaluateRuntimePreflight({ binPath: 'Z:/nonexistent/python.exe' }, 'python');
  assert.equal(missingPy.ready, false);
  assert.ok(missingPy.reason.includes('Python 分析运行时未安装'), missingPy.reason);
  // binPath 真实存在 → ready=true
  const ok = evaluateRuntimePreflight({ binPath: process.execPath }, 'python');
  assert.equal(ok.ready, true);
  assert.equal(ok.command, process.execPath);
  assert.equal(ok.reason, null);
  // executor 缺失 → 未找到执行器
  const noExecutor = evaluateRuntimePreflight(null, 'r');
  assert.equal(noExecutor.ready, false);
  assert.ok(noExecutor.reason.includes('未找到'), noExecutor.reason);
  // BLOCK-66 P3 实机实证：隔离无 R 环境 binPath=null → 仍给商店指引（非"未找到执行器"）
  const nullBin = evaluateRuntimePreflight({ binPath: null }, 'r');
  assert.equal(nullBin.ready, false);
  assert.ok(nullBin.reason.includes('R 分析运行时未安装'), nullBin.reason);
  assert.ok(nullBin.reason.includes('插件商店'), nullBin.reason);
  assert.ok(nullBin.reason.includes('Rscript'), nullBin.reason);
});

test('P6 final output accounting preserves incomplete scans as a measured lower bound', () => {
  const resourceUsage = {
    peak: { outputBytes: 100 },
    sampling: {
      outputSampleCount: 2,
      directoryTruncated: false,
      directoryReadErrors: 0,
      directoryStatErrors: 0,
      outputMeasurementStatus: 'measured',
    },
  };
  _test.mergeFinalOutputMeasurement(resourceUsage, {
    bytes: 150,
    truncated: true,
    readErrors: 1,
    statErrors: 2,
    complete: false,
  });
  assert.equal(resourceUsage.peak.outputBytes, 150);
  assert.equal(resourceUsage.sampling.outputSampleCount, 3);
  assert.equal(resourceUsage.sampling.directoryTruncated, true);
  assert.equal(resourceUsage.sampling.directoryReadErrors, 1);
  assert.equal(resourceUsage.sampling.directoryStatErrors, 2);
  assert.equal(resourceUsage.sampling.outputMeasurementStatus, 'partial');

  _test.mergeFinalOutputMeasurement(resourceUsage, {
    bytes: 125,
    truncated: false,
    readErrors: 0,
    statErrors: 0,
    complete: true,
  });
  assert.equal(resourceUsage.peak.outputBytes, 150);
  assert.equal(resourceUsage.sampling.outputMeasurementStatus, 'partial');
});

test('P6 cancelled tool results retain measured resources without claiming unavailable peaks', () => {
  const resourceUsage = {
    peak: { cpuPercent: null, rssBytes: 4096, outputBytes: 128 },
    sampling: { status: 'measured', sampleCount: 2, processSampleCount: 0 },
    peakStatus: 'partial_process_peak_unavailable',
  };
  const result = _test.buildCancelledToolResult({
    existingResult: { retained: true },
    jobId: 'job_cancelled',
    resourceUsage,
  });
  assert.deepEqual(result.cancellation, {
    phase: 'execute',
    reason: 'user_stop',
    terminalStatus: 'cancelled',
    processExitConfirmed: true,
  });
  assert.equal(result.retained, true);
  assert.equal(result.toolJobId, 'job_cancelled');
  assert.equal(result.resourceUsage, resourceUsage);
  assert.equal(result.resourceUsage.peak.cpuPercent, null);
  assert.equal(result.resourceUsage.peakStatus, 'partial_process_peak_unavailable');
});

test('P6 failed tool results retain measured resources when provenance is unavailable', () => {
  const resourceUsage = {
    peak: { cpuPercent: 75, rssBytes: 8192, outputBytes: 256 },
    sampling: { status: 'measured', sampleCount: 3 },
  };
  const result = _test.buildFailedToolResult({
    existingResult: { retained: true },
    jobId: 'job_failed',
    reason: 'nonzero_exit',
    exitCode: 2,
    resourceUsage,
  });
  assert.equal(result.retained, true);
  assert.equal(result.toolJobId, 'job_failed');
  assert.deepEqual(result.failure, { phase: 'execute', reason: 'nonzero_exit', exitCode: 2 });
  assert.equal(result.resourceUsage, resourceUsage);
  assert.equal(result.executionProvenance, undefined);
  assert.equal(result.provenanceRef, undefined);
});

test('HTTP tool execution resolves only server-owned manifest or declared artifact result roots', (context) => {
  const jobDir = mkdtempSync(join(tmpdir(), 'biof3-tools-result-root-'));
  const outputDir = join(jobDir, 'output');
  mkdirSync(outputDir);
  context.after(() => rmSync(jobDir, { recursive: true, force: true }));
  const expectedArtifacts = [{ id: 'volcano', filename: 'volcano.png' }];

  writeFileSync(join(jobDir, 'manifest.json'), '{}\n');
  assert.deepEqual(_test.resolveProducedResultDirectory({ jobDir, outputDir, expectedArtifacts }), {
    resultDir: jobDir,
    manifestPath: join(jobDir, 'manifest.json'),
    reason: 'manifest',
  });

  writeFileSync(join(outputDir, 'manifest.json'), '{}\n');
  assert.equal(
    _test.resolveProducedResultDirectory({ jobDir, outputDir, expectedArtifacts }).resultDir,
    outputDir,
    'the standard output directory wins when both manifests exist',
  );
  rmSync(join(outputDir, 'manifest.json'));
  rmSync(join(jobDir, 'manifest.json'));
  writeFileSync(join(jobDir, 'volcano.png'), 'PNG');
  assert.equal(
    _test.resolveProducedResultDirectory({ jobDir, outputDir, expectedArtifacts }).reason,
    'declared_artifact',
  );
  rmSync(join(jobDir, 'volcano.png'));
  writeFileSync(join(jobDir, 'untrusted.txt'), 'not a declared output');
  assert.deepEqual(_test.resolveProducedResultDirectory({ jobDir, outputDir, expectedArtifacts }), {
    resultDir: outputDir,
    manifestPath: join(outputDir, 'manifest.json'),
    reason: 'standard_default',
  });
});

test('private tool artifact reads bind declared flat files to the current Job root', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'biof3-tools-private-read-'));
  const projectJobRoot = join(root, 'project-a', 'results', 'jobs', 'job-current');
  const projectOutputDir = join(projectJobRoot, 'output');
  const otherJobRoot = join(root, 'project-b', 'results', 'jobs', 'job-other');
  const legacyJobsDir = join(root, 'legacy', 'tool-jobs');
  const legacyOutputDir = join(legacyJobsDir, 'job-current', 'output');
  mkdirSync(projectOutputDir, { recursive: true });
  mkdirSync(otherJobRoot, { recursive: true });
  mkdirSync(legacyOutputDir, { recursive: true });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  writeFileSync(join(projectJobRoot, 'volcano.svg'), '<svg/>');
  writeFileSync(join(projectJobRoot, 'undeclared.txt'), 'private');
  writeFileSync(join(projectOutputDir, 'report.html'), '<html/>');
  writeFileSync(join(otherJobRoot, 'volcano.svg'), '<svg/>');
  const outside = join(root, 'outside.svg');
  writeFileSync(outside, '<svg/>');
  symlinkSync(outside, join(projectJobRoot, 'escaped.svg'));

  const layout = {
    workspaceRoot: join(root, 'project-a'),
    jobRoot: projectJobRoot,
    outputDir: projectOutputDir,
  };
  const projectJob = {
    id: 'job-current',
    project_id: 'project-a',
    result_json: JSON.stringify({
      resultDir: projectJobRoot,
      artifacts: [{ filename: 'volcano.svg' }, { filename: 'escaped.svg' }],
      outputs: [{ path: join(projectJobRoot, 'path-only.svg') }],
      manifest: { files: [{ name: 'manifest-declared.svg' }] },
    }),
  };
  const authorizedProjectArtifact = _test.resolveAuthorizedToolResultFile({
    job: projectJob, filename: 'volcano.svg', layout, jobsDir: legacyJobsDir,
  });
  const authorizedProjectArtifactStat = statSync(join(projectJobRoot, 'volcano.svg'));
  assert.equal(authorizedProjectArtifact.ok, true);
  assert.equal(authorizedProjectArtifact.filePath, realpathSync(join(projectJobRoot, 'volcano.svg')));
  assert.equal(authorizedProjectArtifact.resultDir, projectJobRoot);
  assert.deepEqual(authorizedProjectArtifact.fileIdentity, {
    dev: authorizedProjectArtifactStat.dev,
    ino: authorizedProjectArtifactStat.ino,
    size: authorizedProjectArtifactStat.size,
    mtimeMs: authorizedProjectArtifactStat.mtimeMs,
    ctimeMs: authorizedProjectArtifactStat.ctimeMs,
  });
  assert.equal(_test.resolveAuthorizedToolResultFile({
    job: projectJob, filename: '../outside.svg', layout, jobsDir: legacyJobsDir,
  }).error, 'bad_path');
  assert.equal(_test.resolveAuthorizedToolResultFile({
    job: projectJob, filename: 'undeclared.txt', layout, jobsDir: legacyJobsDir,
  }).error, 'file_not_found');
  assert.equal(_test.resolveAuthorizedToolResultFile({
    job: projectJob, filename: 'escaped.svg', layout, jobsDir: legacyJobsDir,
  }).error, 'file_not_found', 'declared symlinks cannot escape the exact Job root');

  const otherProjectJob = {
    ...projectJob,
    result_json: JSON.stringify({
      resultDir: otherJobRoot,
      artifacts: [{ filename: 'volcano.svg' }],
    }),
  };
  assert.equal(_test.resolveAuthorizedToolResultFile({
    job: otherProjectJob, filename: 'volcano.svg', layout, jobsDir: legacyJobsDir,
  }).error, 'file_not_found', 'a stored path for another project or Job is not authorized');

  const linkedWorkspace = join(root, 'project-linked');
  const linkedJobRoot = join(linkedWorkspace, 'results', 'jobs', 'job-current');
  mkdirSync(join(linkedWorkspace, 'results', 'jobs'), { recursive: true });
  symlinkSync(otherJobRoot, linkedJobRoot, 'dir');
  const linkedLayout = {
    workspaceRoot: linkedWorkspace,
    jobRoot: linkedJobRoot,
    outputDir: join(linkedJobRoot, 'output'),
  };
  assert.equal(_test.resolveAuthorizedToolResultFile({
    job: {
      ...projectJob,
      result_json: JSON.stringify({
        resultDir: linkedJobRoot,
        artifacts: [{ filename: 'volcano.svg' }],
      }),
    },
    filename: 'volcano.svg',
    layout: linkedLayout,
    jobsDir: legacyJobsDir,
  }).error, 'file_not_found', 'a Job-root symlink cannot escape its project workspace');

  const outputJob = {
    ...projectJob,
    result_json: JSON.stringify({
      resultDir: projectOutputDir,
      manifest: { outputs: [{ file: 'report.html' }] },
    }),
  };
  assert.equal(_test.resolveAuthorizedToolResultFile({
    job: outputJob, filename: 'report.html', layout, jobsDir: legacyJobsDir,
  }).ok, true, 'the exact project output root remains supported');

  writeFileSync(join(legacyOutputDir, 'legacy.csv'), 'gene\nTP53\n');
  const legacyJob = {
    id: 'job-current',
    project_id: null,
    result_json: JSON.stringify({
      resultDir: legacyOutputDir,
      files: [{ name: 'legacy.csv' }],
    }),
  };
  assert.equal(_test.resolveAuthorizedToolResultFile({
    job: legacyJob, filename: 'legacy.csv', jobsDir: legacyJobsDir,
  }).ok, true, 'the current Job exact managed legacy root remains supported');
  assert.equal(_test.resolveAuthorizedToolResultFile({
    job: { ...legacyJob, result_json: JSON.stringify({
      resultDir: join(legacyJobsDir, 'job-other', 'output'),
      files: [{ name: 'legacy.csv' }],
    }) },
    filename: 'legacy.csv',
    jobsDir: legacyJobsDir,
  }).error, 'file_not_found', 'a different legacy Job root is rejected');
});

test('private tool artifact reads stream the verified descriptor and reject a path swap', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'biof3-tools-private-fd-'));
  const jobsDir = join(root, 'tool-jobs');
  const outputDir = join(jobsDir, 'job-current', 'output');
  const artifactPath = join(outputDir, 'approved.csv');
  const outsidePath = join(root, 'other-job-private.csv');
  const originalPath = join(outputDir, 'approved-original.csv');
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(artifactPath, 'gene,padj\nTP53,0.01\n');
  writeFileSync(outsidePath, 'secret,token\nother,do-not-serve\n');
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const job = {
    id: 'job-current',
    project_id: null,
    result_json: JSON.stringify({
      resultDir: outputDir,
      files: [{ name: 'approved.csv' }],
    }),
  };
  const resolved = _test.resolveAuthorizedToolResultFile({
    job,
    filename: 'approved.csv',
    jobsDir,
  });
  assert.equal(resolved.ok, true);

  const opened = await _test.openVerifiedAuthorizedToolResultFile(resolved);
  assert.equal(opened.ok, true);

  // This is the interval that used to exist between realpath and sendFile.
  // The already-open fd remains the approved file even after its path changes.
  renameSync(artifactPath, originalPath);
  symlinkSync(outsidePath, artifactPath);
  assert.equal(
    await readVerifiedFileSnapshot(opened, { encoding: 'utf8' }),
    'gene,padj\nTP53,0.01\n',
  );

  assert.equal(
    (await _test.openVerifiedAuthorizedToolResultFile(resolved)).error,
    'file_not_found',
    'a symlink inserted after authorization cannot be opened for delivery',
  );

  rmSync(artifactPath);
  writeFileSync(artifactPath, 'gene,padj\nOTHER,0.01\n');
  assert.equal(
    (await _test.openVerifiedAuthorizedToolResultFile(resolved)).error,
    'file_not_found',
    'a regular file from another Job cannot replace the authorized inode',
  );
});

test('private tool artifact reads enforce current bytes when a Job has Artifact Truth', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'biof3-tools-private-truth-'));
  const jobsDir = join(root, 'tool-jobs');
  const outputDir = join(jobsDir, 'job-current', 'output');
  const artifactPath = join(outputDir, 'verified.csv');
  const original = 'gene,padj\nTP53,0.01\n';
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(artifactPath, original);
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const expectedSha256 = createHash('sha256').update(original).digest('hex');
  const job = {
    id: 'job-current',
    project_id: null,
    result_json: JSON.stringify({
      resultDir: outputDir,
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [{ id: 'table', filename: 'verified.csv', sha256: expectedSha256 }],
    }),
  };

  const resolved = _test.resolveAuthorizedToolResultFile({ job, filename: 'verified.csv', jobsDir });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.expectedSha256, expectedSha256);
  const opened = await _test.openVerifiedAuthorizedToolResultFile(resolved);
  assert.equal(opened.ok, true);
  assert.equal(opened.actualSha256, expectedSha256);
  writeFileSync(artifactPath, 'gene,padj\nMUTATED_AFTER_HASH,1\n');
  assert.equal(await readVerifiedFileSnapshot(opened, { encoding: 'utf8' }), original);

  writeFileSync(artifactPath, 'gene,padj\nOTHER,0.99\n');
  const drifted = _test.resolveAuthorizedToolResultFile({ job, filename: 'verified.csv', jobsDir });
  assert.equal(drifted.ok, true);
  assert.equal((await _test.openVerifiedAuthorizedToolResultFile(drifted)).error, 'artifact_truth_drift');

  const unhashed = {
    ...job,
    result_json: JSON.stringify({
      resultDir: outputDir,
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [{ id: 'table', filename: 'verified.csv' }],
    }),
  };
  assert.equal(
    _test.resolveAuthorizedToolResultFile({ job: unhashed, filename: 'verified.csv', jobsDir }).error,
    'artifact_truth_unavailable',
  );
});

test('verified snapshot delivery rejects a retained writable fd before sending a corrupt block', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'biof3-tools-snapshot-namespace-'));
  const sourcePath = join(root, 'source.csv');
  const original = Buffer.alloc(SNAPSHOT_BUFFER_BYTES * 2 + 37);
  original.fill(0x41, 0, SNAPSHOT_BUFFER_BYTES);
  original.fill(0x42, SNAPSHOT_BUFFER_BYTES, SNAPSHOT_BUFFER_BYTES * 2);
  original.fill(0x43, SNAPSHOT_BUFFER_BYTES * 2);
  writeFileSync(sourcePath, original);
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const sourceStat = statSync(sourcePath);
  const expectedSha256 = createHash('sha256').update(original).digest('hex');
  const originalUnlink = nodeFs.promises.unlink;
  let interceptedSnapshotUnlink = 0;
  const retainedWriterFds = [];
  nodeFs.promises.unlink = async (target) => {
    if (String(target).startsWith(`${realpathSync(root)}/biof3-artifact-stream-`)
        && String(target).endsWith('/artifact')) {
      interceptedSnapshotUnlink += 1;
      // Model a same-UID process that opens the pathname before unlink and
      // deliberately retains its writable descriptor after the name is gone.
      retainedWriterFds.push(openSync(target, 'r+'));
    }
    return originalUnlink(target);
  };

  const createSnapshot = () => createVerifiedFileSnapshot(openSync(sourcePath, 'r'), {
    expectedIdentity: {
      dev: sourceStat.dev,
      ino: sourceStat.ino,
      size: sourceStat.size,
      mtimeMs: sourceStat.mtimeMs,
      ctimeMs: sourceStat.ctimeMs,
    },
    expectedSha256,
    tempRoot: root,
  });

  let streamSnapshot = null;
  let wholeReadSnapshot = null;
  try {
    streamSnapshot = await createSnapshot();
    assert.equal(streamSnapshot.sha256, expectedSha256);
    assert.equal(streamSnapshot.verification.blockHashes.length, 3);
    assert.equal(retainedWriterFds.length, 1);

    const delivered = [];
    const stream = createVerifiedSnapshotReadStream(streamSnapshot);
    const streamError = await new Promise((resolve, reject) => {
      stream.on('data', (chunk) => {
        delivered.push(Buffer.from(chunk));
        if (delivered.length !== 1) return;
        writeSync(
          retainedWriterFds[0],
          Buffer.alloc(64, 0x58),
          0,
          64,
          SNAPSHOT_BUFFER_BYTES,
        );
      });
      stream.once('error', resolve);
      stream.once('end', () => reject(new Error('corrupt retained-fd stream unexpectedly completed')));
    });
    assert.equal(streamError.code, 'verified_snapshot_delivery_hash_mismatch');
    assert.equal(delivered.length, 1, 'the corrupt future block must never be pushed');
    assert.deepEqual(delivered[0], original.subarray(0, SNAPSHOT_BUFFER_BYTES));

    wholeReadSnapshot = await createSnapshot();
    assert.equal(retainedWriterFds.length, 2);
    writeSync(retainedWriterFds[1], Buffer.alloc(64, 0x59), 0, 64, 0);
    await assert.rejects(
      () => readVerifiedFileSnapshot(wholeReadSnapshot),
      (error) => error?.code === 'verified_snapshot_delivery_hash_mismatch',
    );
    assert.equal(interceptedSnapshotUnlink, 2);
  } finally {
    nodeFs.promises.unlink = originalUnlink;
    for (const fd of retainedWriterFds) {
      try { closeSync(fd); } catch {}
    }
    if (streamSnapshot?.fd != null) closeSync(streamSnapshot.fd);
    if (wholeReadSnapshot?.fd != null) closeSync(wholeReadSnapshot.fd);
  }
});

test('aborted HTTP snapshot delivery destroys its source stream and closes the anonymous fd', { timeout: 5000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'biof3-tools-snapshot-abort-'));
  const sourcePath = join(root, 'large-artifact.bin');
  const original = Buffer.alloc(SNAPSHOT_BUFFER_BYTES * 16, 0x5a);
  writeFileSync(sourcePath, original);
  const sourceStat = statSync(sourcePath);
  let snapshot = await createVerifiedFileSnapshot(openSync(sourcePath, 'r'), {
    expectedIdentity: {
      dev: sourceStat.dev,
      ino: sourceStat.ino,
      size: sourceStat.size,
      mtimeMs: sourceStat.mtimeMs,
      ctimeMs: sourceStat.ctimeMs,
    },
    expectedSha256: createHash('sha256').update(original).digest('hex'),
    tempRoot: root,
  });
  const snapshotFd = snapshot.fd;
  let responseFinished = false;
  let serverStream = null;
  let resolveStreamClosed;
  const streamClosed = new Promise((resolve) => { resolveStreamClosed = resolve; });
  const server = createServer((req, res) => {
    serverStream = createVerifiedSnapshotReadStream(snapshot);
    serverStream.once('close', resolveStreamClosed);
    serverStream.once('error', () => {});
    res.once('finish', () => { responseFinished = true; });
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(original.length),
    });
    pipeVerifiedSnapshotToResponse(serverStream, req, res);
  });

  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    const response = await new Promise((resolve, reject) => {
      const request = httpGet({ host: '127.0.0.1', port: address.port, path: '/' }, resolve);
      request.once('error', reject);
    });
    await new Promise((resolve, reject) => {
      response.once('data', () => {
        response.removeListener('error', reject);
        response.on('error', () => {});
        response.destroy();
        resolve();
      });
      response.once('error', reject);
    });
    await streamClosed;

    assert.equal(responseFinished, false, 'client abort must not be mistaken for normal finish');
    assert.equal(serverStream.destroyed, true);
    assert.equal(snapshot.fd, null);
    assert.throws(
      () => fstatSync(snapshotFd),
      (error) => error?.code === 'EBADF',
      'the anonymous snapshot descriptor must be closed on abort',
    );
    snapshot = null;
  } finally {
    if (snapshot?.fd != null) closeSync(snapshot.fd);
    server.closeAllConnections?.();
    if (server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test('normal HTTP finish removes abort bindings without destroying the source again', () => {
  const req = new EventEmitter();
  const res = new EventEmitter();
  res.writableFinished = false;
  res.on('error', () => {});
  const stream = new EventEmitter();
  stream.destroyed = false;
  let destroyCalls = 0;
  stream.destroy = () => {
    destroyCalls += 1;
    stream.destroyed = true;
  };
  stream.pipe = (destination) => destination;

  assert.equal(pipeVerifiedSnapshotToResponse(stream, req, res), res);
  res.writableFinished = true;
  res.emit('finish');
  res.emit('close');
  res.emit('aborted');
  res.emit('error', new Error('late response error'));
  req.emit('aborted');

  assert.equal(destroyCalls, 0);
  assert.equal(stream.listenerCount('close'), 0);

  const alreadyAbortedReq = new EventEmitter();
  alreadyAbortedReq.aborted = true;
  const alreadyClosedRes = new EventEmitter();
  alreadyClosedRes.destroyed = true;
  alreadyClosedRes.writableFinished = false;
  const lateStream = new EventEmitter();
  lateStream.destroyed = false;
  let latePipeCalls = 0;
  let lateDestroyCalls = 0;
  lateStream.pipe = () => { latePipeCalls += 1; };
  lateStream.destroy = () => {
    lateDestroyCalls += 1;
    lateStream.destroyed = true;
  };
  assert.equal(
    pipeVerifiedSnapshotToResponse(lateStream, alreadyAbortedReq, alreadyClosedRes),
    alreadyClosedRes,
  );
  assert.equal(latePipeCalls, 0, 'a response aborted during snapshot creation must never be piped');
  assert.equal(lateDestroyCalls, 1);
});
