#!/usr/bin/env node
/**
 * scripts/docs-governance.mjs — `docs/` 注册、覆盖、冲突门禁主入口
 *
 * 子命令：
 *   --status     默认；输出注册数量、状态、类型、未注册文件与契约问题
 *   --check      注册缺失 / 路径失效 / 入口断链 / canonical 冲突时非 0 退出
 *   --reconcile  只读报告：孤立文档、归档候选、稳定保留项、冲突；不写文件
 *   --write-report  与 --reconcile 一起把报告写到 acceptance/...
 *
 * 退出码契约（GATES-1 文档化，2026-08-16）：
 *   0   PASS — 校验通过 / 状态报告正常输出
 *   1   FAIL — 校验发现问题（注册缺失、路径失效、入口断链、canonical 冲突等）
 *   2   分类冲突 — CLI 调用冲突（同时传入多个互斥模式）或未捕获的运行期错误
 *       注意：2 不是 fail-closed；仅提示调用方修正参数 / 修复工具自身 bug，
 *       **不**代表 docs/ 治理栈在你的工作包里有"未通过的契约"。
 *
 * `--report` JSON 输出模式（GATES-2 文档化，2026-08-16）：
 *   与 `--status` / `--check` / `--reconcile` 互斥的并行模式；通过
 *   `--report <path>` 触发，输出机器可读 JSON，由 `docs/schemas/docs-governance-report.schema.json`
 *   强校验，写盘失败 / schema 校验失败 → exit 2（分类冲突）。
 *   退出码语义与现有契约一致：report 模式下的 exit 0/1/2 仍走 0=PASS / 1=FAIL / 2=分类冲突。
 *   报告 `summary.status` 反映业务分类（PASS / FAIL / CLASSIFICATION_CONFLICT），
 *   `exitCode` 反映 `process.exitCode`。
 *
 * 同步文档：`docs/document-governance.md` §4.5"门禁退出码契约" + GATES-2 §3.2"JSON 输出契约"。
 * 该契约为本工作包 DOC-GOVERNANCE-GATES / GATES-1 阶段固化本，不在本阶段内
 * 改动 `process.exit()` 行为；如未来升级退出码语义须同步 §4.5 并联动
 * `package.json` 脚本。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { GATE_REPORT_SCHEMA_VERSION, validateReport } from './lib/gate-report-schema.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');

export const DOCUMENT_KINDS = Object.freeze([
  'governance',
  'vision',
  'roadmap',
  'living-plan',
  'work-package',
  'handoff',
  'audit',
  'reference',
  'release',
]);

export const DOCUMENT_STATUSES = Object.freeze([
  'active',
  'planned',
  'completed',
  'reference',
  'superseded',
  'archived',
]);

export const ARCHIVE_POLICIES = Object.freeze([
  'never_archive',
  'retain_stable_path',
  'archive_after_completion',
  'archive_when_superseded',
  'manual_review',
]);

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function normalizeRepoPath(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const candidate = value.trim().replaceAll('\\', '/');
  if (path.posix.isAbsolute(candidate)) return null;
  if (candidate.split('/').includes('..')) return null;
  const normalized = path.posix.normalize(candidate);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) return null;
  return normalized;
}

function isExcluded(repoPath, excludedPrefixes) {
  return excludedPrefixes.some((prefix) => {
    const normalized = normalizeRepoPath(prefix);
    if (!normalized) return false;
    const base = normalized.replace(/\/$/, '');
    return repoPath === base || repoPath.startsWith(`${base}/`);
  });
}

async function pathExists(absolutePath) {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function walkMarkdown(rootDir, absoluteDir, excludedPrefixes, results) {
  const relativeDir = toPosix(path.relative(rootDir, absoluteDir));
  if (relativeDir && isExcluded(relativeDir, excludedPrefixes)) return;

  let entries;
  try {
    entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries) {
    const absolutePath = path.join(absoluteDir, entry.name);
    const relativePath = toPosix(path.relative(rootDir, absolutePath));
    if (isExcluded(relativePath, excludedPrefixes)) continue;
    if (entry.isDirectory()) {
      await walkMarkdown(rootDir, absolutePath, excludedPrefixes, results);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(relativePath);
    }
  }
}

export async function collectManagedMarkdown(rootDir = DEFAULT_ROOT, coverage = {}) {
  const managedRoots = Array.isArray(coverage.managedRoots) && coverage.managedRoots.length > 0
    ? coverage.managedRoots
    : ['docs'];
  const excludedPrefixes = Array.isArray(coverage.excludedPrefixes)
    ? coverage.excludedPrefixes
    : ['docs/archive/'];
  const results = [];

  for (const root of managedRoots) {
    const repoPath = normalizeRepoPath(root);
    if (!repoPath) continue;
    await walkMarkdown(rootDir, path.join(rootDir, repoPath), excludedPrefixes, results);
  }

  return [...new Set(results)].sort();
}

export async function loadDocumentRegistry(rootDir = DEFAULT_ROOT) {
  const registryPath = path.join(rootDir, 'docs', 'DOC-REGISTRY.json');
  const source = await fs.readFile(registryPath, 'utf8');
  return JSON.parse(source);
}

export function extractLocalMarkdownLinks(markdown, sourcePath) {
  const links = [];
  const pattern = /\[[^\]]*\]\(([^)]+)\)/g;
  let match;

  while ((match = pattern.exec(markdown)) !== null) {
    let target = match[1].trim();
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
    target = target.split(/\s+["']/)[0];
    target = target.split('#')[0].split('?')[0];
    if (!target || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    if (target.startsWith('/')) continue;
    const resolved = normalizeRepoPath(path.posix.join(path.posix.dirname(sourcePath), target));
    if (resolved) links.push(resolved);
  }

  return links;
}

function issue(code, message, documentId = null, documentPath = null) {
  return { code, message, documentId, path: documentPath };
}

export async function validateDocumentRegistry(registry, options = {}) {
  const rootDir = options.rootDir ?? DEFAULT_ROOT;
  const issues = [];

  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    return [issue('REGISTRY_INVALID', 'Registry must be a JSON object.')];
  }
  if (registry.schemaVersion !== 1) {
    issues.push(issue('SCHEMA_VERSION_INVALID', 'schemaVersion must equal 1.'));
  }
  if (!registry.coverage || typeof registry.coverage !== 'object') {
    issues.push(issue('COVERAGE_INVALID', 'coverage must be an object.'));
  }
  if (!Array.isArray(registry.documents)) {
    issues.push(issue('DOCUMENTS_INVALID', 'documents must be an array.'));
    return issues;
  }

  const idOwners = new Map();
  const pathOwners = new Map();
  const truthOwners = new Map();
  const normalizedDocuments = [];

  for (const document of registry.documents) {
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      issues.push(issue('DOCUMENT_INVALID', 'Each document entry must be an object.'));
      continue;
    }

    const id = typeof document.id === 'string' ? document.id.trim() : '';
    const repoPath = normalizeRepoPath(document.path);
    if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(id)) {
      issues.push(issue('ID_INVALID', 'id must use uppercase letters, numbers, dot, underscore, or hyphen.', id || null, repoPath));
    }
    if (!repoPath || !repoPath.startsWith('docs/') || !repoPath.endsWith('.md')) {
      issues.push(issue('PATH_INVALID', 'path must be a safe repository-relative Markdown path under docs/.', id || null, document.path ?? null));
    }
    if (!DOCUMENT_KINDS.includes(document.kind)) {
      issues.push(issue('KIND_INVALID', `kind must be one of: ${DOCUMENT_KINDS.join(', ')}.`, id || null, repoPath));
    }
    if (!DOCUMENT_STATUSES.includes(document.status)) {
      issues.push(issue('STATUS_INVALID', `status must be one of: ${DOCUMENT_STATUSES.join(', ')}.`, id || null, repoPath));
    }
    if (typeof document.canonical !== 'boolean') {
      issues.push(issue('CANONICAL_INVALID', 'canonical must be a boolean.', id || null, repoPath));
    }
    if (!ARCHIVE_POLICIES.includes(document.archivePolicy)) {
      issues.push(issue('ARCHIVE_POLICY_INVALID', `archivePolicy must be one of: ${ARCHIVE_POLICIES.join(', ')}.`, id || null, repoPath));
    }

    if (id) {
      if (idOwners.has(id)) {
        issues.push(issue('DUPLICATE_ID', `id is already used by ${idOwners.get(id)}.`, id, repoPath));
      } else {
        idOwners.set(id, repoPath ?? '<invalid path>');
      }
    }
    if (repoPath) {
      if (pathOwners.has(repoPath)) {
        issues.push(issue('DUPLICATE_PATH', `path is already registered as ${pathOwners.get(repoPath)}.`, id || null, repoPath));
      } else {
        pathOwners.set(repoPath, id || '<invalid id>');
      }
      if (!(await pathExists(path.join(rootDir, repoPath)))) {
        issues.push(issue('DOCUMENT_MISSING', 'Registered document does not exist.', id || null, repoPath));
      }
    }

    if (document.status === 'archived' && repoPath && !repoPath.startsWith('docs/archive/')) {
      issues.push(issue('ARCHIVED_PATH_INVALID', 'archived documents must live under docs/archive/.', id || null, repoPath));
    }
    if (repoPath?.startsWith('docs/archive/') && document.status !== 'archived') {
      issues.push(issue('ARCHIVE_STATUS_INVALID', 'Documents under docs/archive/ must use archived status.', id || null, repoPath));
    }

    if (document.canonical === true) {
      const truthDomain = typeof document.truthDomain === 'string' ? document.truthDomain.trim() : '';
      const entrypoint = normalizeRepoPath(document.entrypoint);
      if (!truthDomain) {
        issues.push(issue('TRUTH_DOMAIN_REQUIRED', 'canonical documents require truthDomain.', id || null, repoPath));
      } else if (!['archived', 'superseded'].includes(document.status)) {
        if (truthOwners.has(truthDomain)) {
          issues.push(issue('DUPLICATE_TRUTH_DOMAIN', `truthDomain is already owned by ${truthOwners.get(truthDomain)}.`, id || null, repoPath));
        } else {
          truthOwners.set(truthDomain, id || '<invalid id>');
        }
      }
      if (!entrypoint) {
        issues.push(issue('CANONICAL_ENTRYPOINT_REQUIRED', 'canonical documents require a safe entrypoint path.', id || null, repoPath));
      } else if (!(await pathExists(path.join(rootDir, entrypoint)))) {
        issues.push(issue('ENTRYPOINT_MISSING', `entrypoint does not exist: ${entrypoint}.`, id || null, repoPath));
      } else if (repoPath) {
        const entrypointSource = await fs.readFile(path.join(rootDir, entrypoint), 'utf8');
        const links = extractLocalMarkdownLinks(entrypointSource, entrypoint);
        if (!links.includes(repoPath)) {
          issues.push(issue('ENTRYPOINT_LINK_MISSING', `${entrypoint} does not link to the canonical document.`, id || null, repoPath));
        }
      }
    }

    if (document.supersedes !== undefined && !Array.isArray(document.supersedes)) {
      issues.push(issue('SUPERSEDES_INVALID', 'supersedes must be an array when present.', id || null, repoPath));
    }
    if (document.acceptanceRefs !== undefined && !Array.isArray(document.acceptanceRefs)) {
      issues.push(issue('ACCEPTANCE_REFS_INVALID', 'acceptanceRefs must be an array when present.', id || null, repoPath));
    }

    // GATES-3: truthDomain must not be retained on archived / superseded entries.
    // P2 closeout already removed truthDomain from IDE-TRANSFORMATION et al; this rule
    // makes the invariant explicit so future regressions fail docs:check loudly.
    if (
      document.truthDomain !== undefined
      && document.truthDomain !== null
      && (typeof document.truthDomain !== 'string' || document.truthDomain.trim() !== '')
      && ['archived', 'superseded'].includes(document.status)
    ) {
      issues.push(issue(
        'TRUTH_DOMAIN_RETAINED_ON_RETIRED',
        `truthDomain must be removed when status is ${document.status}; use tags for historical grouping instead.`,
        id || null,
        repoPath,
      ));
    }

    normalizedDocuments.push({ ...document, id, path: repoPath });
  }

  for (const document of normalizedDocuments) {
    if (!Array.isArray(document.supersedes)) continue;
    for (const supersededId of document.supersedes) {
      if (!idOwners.has(supersededId)) {
        issues.push(issue('SUPERSEDED_ID_MISSING', `supersedes references unknown id ${supersededId}.`, document.id || null, document.path));
      }
    }
  }

  // GATES-3: supersededBy is now an optional array of registered document ids.
  // Validated in a second pass so order of appearance in the registry does not
  // matter; mirrors the existing supersedes post-pass style.
  const livingStatuses = new Set(['active', 'planned', 'completed', 'reference']);
  for (const document of normalizedDocuments) {
    if (document.supersededBy === undefined || document.supersededBy === null) continue;
    if (!Array.isArray(document.supersededBy)) {
      issues.push(issue(
        'SUPERSEDED_BY_INVALID',
        'supersededBy must be an array of registered document ids when present.',
        document.id || null,
        document.path,
      ));
      continue;
    }
    if (document.supersededBy.length === 0) {
      issues.push(issue(
        'SUPERSEDED_BY_EMPTY',
        'supersededBy must contain at least one registered document id when present.',
        document.id || null,
        document.path,
      ));
      continue;
    }
    let hasLivingTarget = false;
    document.supersededBy.forEach((targetId, index) => {
      if (typeof targetId !== 'string' || targetId.trim() === '') {
        issues.push(issue(
          'SUPERSEDED_BY_ELEMENT_INVALID',
          `supersededBy[${index}] must be a non-empty registered document id.`,
          document.id || null,
          document.path,
        ));
        return;
      }
      if (!idOwners.has(targetId)) {
        issues.push(issue(
          'SUPERSEDED_BY_UNKNOWN_ID',
          `supersededBy[${index}] references unknown id ${targetId}.`,
          document.id || null,
          document.path,
        ));
        return;
      }
      const targetDoc = registry.documents.find((entry) => entry && entry.id === targetId);
      if (targetDoc && livingStatuses.has(targetDoc.status)) {
        hasLivingTarget = true;
      }
    });
    if (hasLivingTarget === false) {
      issues.push(issue(
        'SUPERSEDED_BY_NO_LIVING_TARGET',
        'supersededBy must reference at least one living document (active / planned / completed / reference).',
        document.id || null,
        document.path,
      ));
    }
  }

  const coverage = registry.coverage ?? {};
  const managedMarkdown = await collectManagedMarkdown(rootDir, coverage);
  const registeredPaths = new Set(normalizedDocuments.map((document) => document.path).filter(Boolean));
  if (coverage.requireRegistration === true) {
    for (const repoPath of managedMarkdown) {
      if (!registeredPaths.has(repoPath)) {
        issues.push(issue('UNREGISTERED_DOCUMENT', 'Managed Markdown is not registered.', null, repoPath));
      }
    }
  }

  return issues;
}

async function buildInboundReferenceMap(rootDir, markdownPaths) {
  const inbound = new Map(markdownPaths.map((repoPath) => [repoPath, []]));
  for (const sourcePath of markdownPaths) {
    const source = await fs.readFile(path.join(rootDir, sourcePath), 'utf8');
    for (const targetPath of extractLocalMarkdownLinks(source, sourcePath)) {
      if (targetPath !== sourcePath && inbound.has(targetPath)) {
        inbound.get(targetPath).push(sourcePath);
      }
    }
  }
  for (const references of inbound.values()) references.sort();
  return inbound;
}

export async function buildReconciliationReport(registry, options = {}) {
  const rootDir = options.rootDir ?? DEFAULT_ROOT;
  const coverage = registry.coverage ?? {};
  const managedMarkdown = await collectManagedMarkdown(rootDir, coverage);
  const registeredPaths = new Set(registry.documents.map((document) => normalizeRepoPath(document.path)).filter(Boolean));
  const inbound = await buildInboundReferenceMap(rootDir, managedMarkdown);
  const unregistered = managedMarkdown.filter((repoPath) => !registeredPaths.has(repoPath));
  const validationIssues = await validateDocumentRegistry(registry, { rootDir });

  const archiveCandidates = registry.documents
    .filter((document) => ['completed', 'superseded'].includes(document.status))
    .filter((document) => ['archive_after_completion', 'archive_when_superseded'].includes(document.archivePolicy))
    .map((document) => ({
      id: document.id,
      path: document.path,
      inboundReferences: inbound.get(document.path) ?? [],
      readyForExplicitReview: (inbound.get(document.path) ?? []).length === 0,
    }));

  const retainedCompleted = registry.documents
    .filter((document) => document.status === 'completed' && document.archivePolicy === 'retain_stable_path')
    .map((document) => ({ id: document.id, path: document.path }));

  const manualReview = registry.documents
    .filter((document) => document.archivePolicy === 'manual_review')
    .map((document) => ({ id: document.id, path: document.path, status: document.status }));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: 'read_only_reconciliation',
    counts: {
      registered: registry.documents.length,
      managedMarkdown: managedMarkdown.length,
      unregistered: unregistered.length,
      validationIssues: validationIssues.length,
      archiveCandidates: archiveCandidates.length,
      retainedCompleted: retainedCompleted.length,
      manualReview: manualReview.length,
    },
    unregistered,
    orphanDocuments: unregistered.filter((repoPath) => (inbound.get(repoPath) ?? []).length === 0),
    archiveCandidates,
    retainedCompleted,
    manualReview,
    validationIssues,
  };
}

function countBy(documents, field) {
  const counts = new Map();
  for (const document of documents) {
    const key = document[field] ?? '<missing>';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function printIssueList(issues) {
  for (const item of issues) {
    const target = item.path ?? item.documentId ?? 'registry';
    console.error(`  - ${item.code} ${target}: ${item.message}`);
  }
}

function countByStatus(documents) {
  const counts = {};
  for (const document of documents) {
    const key = document.status ?? '<missing>';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function countByKind(documents) {
  const counts = {};
  for (const document of documents) {
    const key = document.kind ?? '<missing>';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * GATES-2 `--report` mode runner. Produces a deterministic JSON report
 * conforming to `docs/schemas/docs-governance-report.schema.json`.
 *
 * Exit codes (per `docs/document-governance.md` §4.5):
 *   0  — schema-valid report written; validation passed
 *   1  — schema-valid report written; registry validation found issues
 *   2  — classification conflict (path invalid, write failed, schema failed)
 *
 * The report is written BEFORE exit; on exit 2 the partial report is still
 * emitted for diagnosis, but `summary.status` is `CLASSIFICATION_CONFLICT`.
 */
async function runReportMode(reportPathRaw) {
  const reportPath = path.resolve(reportPathRaw);
  let registry;
  let issues;
  let managed;
  try {
    registry = await loadDocumentRegistry(DEFAULT_ROOT);
    issues = await validateDocumentRegistry(registry, { rootDir: DEFAULT_ROOT });
    managed = await collectManagedMarkdown(DEFAULT_ROOT, registry.coverage);
  } catch (error) {
    console.error(`[docs:report] 分类冲突 — registry/validation failure: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  const isFailure = issues.length > 0;
  const status = isFailure ? 'FAIL' : 'PASS';
  const result = isFailure ? 'fail' : 'pass';
  const exitCode = isFailure ? 1 : 0;
  const report = {
    schemaVersion: GATE_REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    script: 'scripts/docs-governance.mjs',
    mode: 'report',
    exitCode,
    summary: {
      status,
      registered: registry.documents.length,
      managedMarkdown: managed.length,
      validationIssues: issues.length,
      result,
    },
    counts: {
      byStatus: countByStatus(registry.documents),
      byKind: countByKind(registry.documents),
    },
    issues: issues.map((item) => ({
      code: item.code,
      message: item.message,
      documentId: item.documentId ?? null,
      path: item.path ?? null,
    })),
  };

  const validation = validateReport('scripts/docs-governance.mjs', report);
  if (!validation.valid) {
    console.error('[docs:report] 分类冲突 — produced JSON does not match schema:');
    for (const err of validation.errors) {
      console.error(`  - ${err.path} ${err.keyword}: ${err.message}`);
    }
    process.exitCode = 2;
    return;
  }

  try {
    const parentDir = path.dirname(reportPath);
    await fs.mkdir(parentDir, { recursive: true });
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.error(`[docs:report] 分类冲突 — failed to write report to ${reportPath}: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  report.reportPath = reportPath;
  if (isFailure) {
    console.error(`[docs:report] FAIL (${issues.length} validation issue(s)); report written to ${reportPath}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[docs:report] PASS (${registry.documents.length} registered, ${managed.length} managed); report written to ${reportPath}`);
  process.exitCode = 0;
}

async function runCli() {
  const args = new Set(process.argv.slice(2));
  const modes = ['--status', '--check', '--reconcile'].filter((mode) => args.has(mode));
  if (modes.length > 1) {
    console.error('Choose only one of --status, --check, or --reconcile.');
    process.exitCode = 2;
    return;
  }
  if (args.has('--report') && modes.length > 0) {
    console.error('--report is mutually exclusive with --status, --check, --reconcile.');
    process.exitCode = 2;
    return;
  }
  const mode = modes[0] ?? '--status';

  // GATES-2: `--report <path>` JSON output mode. Activated before
  // registry loading so we can fail-closed (exit 2) on path misuse.
  // The path argument is taken literally from the next argv token; no
  // shell expansion, no auto-resolution outside the user's intent.
  if (args.has('--report')) {
    const reportIdx = process.argv.indexOf('--report');
    const reportPathRaw = process.argv[reportIdx + 1];
    if (!reportPathRaw || reportPathRaw.startsWith('--')) {
      console.error('--report requires a non-empty output path argument.');
      process.exitCode = 2;
      return;
    }
    await runReportMode(reportPathRaw);
    return;
  }

  const registry = await loadDocumentRegistry(DEFAULT_ROOT);
  const issues = await validateDocumentRegistry(registry, { rootDir: DEFAULT_ROOT });

  if (mode === '--check') {
    if (issues.length > 0) {
      console.error(`[docs:check] FAIL (${issues.length} issue(s))`);
      printIssueList(issues);
      process.exitCode = 1;
      return;
    }
    console.log(`[docs:check] PASS (${registry.documents.length} registered documents)`);
    return;
  }

  if (mode === '--status') {
    const managed = await collectManagedMarkdown(DEFAULT_ROOT, registry.coverage);
    console.log('BioF3 document governance status');
    console.log(`  Registered: ${registry.documents.length}`);
    console.log(`  Managed Markdown: ${managed.length}`);
    console.log(`  Validation: ${issues.length === 0 ? 'PASS' : `FAIL (${issues.length})`}`);
    console.log('  By status:');
    for (const [status, count] of countBy(registry.documents, 'status')) console.log(`    ${status}: ${count}`);
    console.log('  By kind:');
    for (const [kind, count] of countBy(registry.documents, 'kind')) console.log(`    ${kind}: ${count}`);
    if (issues.length > 0) printIssueList(issues);
    return;
  }

  const report = await buildReconciliationReport(registry, { rootDir: DEFAULT_ROOT });
  console.log('[docs:reconcile] read-only report; no files were moved or deleted');
  console.log(`  Registered: ${report.counts.registered}`);
  console.log(`  Unregistered: ${report.counts.unregistered}`);
  console.log(`  Archive candidates: ${report.counts.archiveCandidates}`);
  for (const candidate of report.archiveCandidates) {
    console.log(`    ${candidate.id}: refs=${candidate.inboundReferences.length}, explicitReview=${candidate.readyForExplicitReview}`);
  }
  console.log(`  Retained completed references: ${report.counts.retainedCompleted}`);
  console.log(`  Manual review: ${report.counts.manualReview}`);
  console.log(`  Validation issues: ${report.counts.validationIssues}`);
  if (report.validationIssues.length > 0) printIssueList(report.validationIssues);

  if (args.has('--write-report')) {
    const reportPath = path.join(DEFAULT_ROOT, 'acceptance', 'project-governance', 'document-audit.json');
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log('  Wrote acceptance/project-governance/document-audit.json');
  }
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  runCli().catch((error) => {
    console.error(`[docs-governance] ${error.message}`);
    process.exitCode = 1;
  });
}
