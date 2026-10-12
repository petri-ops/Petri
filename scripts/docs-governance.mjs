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

// HK-04 P1（docs/hk04-spec-layer-design.md §2）：capability front-matter 受限格式。
// 设计裁决=不引入完整 YAML 解析器：扁平键 + 单行值 + `acceptance` 块列表（`- 项`），解析确定性可测。
export const CAPABILITY_FRONTMATTER_REQUIRED_KEYS = Object.freeze(['capability', 'goal', 'acceptance', 'status']);
export const CAPABILITY_FRONTMATTER_OPTIONAL_KEYS = Object.freeze(['reopen']);

export function parseCapabilityFrontMatter(content) {
  if (typeof content !== 'string' || !content.startsWith('---')) return null;
  const lines = content.split(/\r?\n/);
  if ((lines[0] ?? '').trim() !== '---') return null;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end === -1) return { ok: false, reason: 'format', error: 'front-matter block not closed' };
  const data = { acceptance: [] };
  let currentKey = null;
  for (let index = 1; index < end; index++) {
    const line = lines[index];
    if (line.trim() === '') continue;
    if (/^\s*-\s+/.test(line)) {
      if (!currentKey || !Array.isArray(data[currentKey])) {
        return { ok: false, reason: 'format', error: `list item outside a list key at line ${index + 1}` };
      }
      data[currentKey].push(line.replace(/^\s*-\s*/, '').trim());
      continue;
    }
    const match = line.match(/^([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!match) return { ok: false, reason: 'format', error: `unparseable line ${index + 1}: ${line.trim()}` };
    const key = match[1];
    const value = match[2].trim();
    currentKey = key;
    if (!CAPABILITY_FRONTMATTER_REQUIRED_KEYS.includes(key) && !CAPABILITY_FRONTMATTER_OPTIONAL_KEYS.includes(key)) {
      return { ok: false, reason: 'unknown-key', error: `unknown key: ${key}` };
    }
    if (key === 'acceptance') {
      if (value !== '') return { ok: false, reason: 'format', error: 'acceptance must be a block list ("- item" lines)' };
      data.acceptance = [];
    } else {
      if (value === '') return { ok: false, reason: 'format', error: `key ${key} requires a single-line value` };
      data[key] = value;
    }
  }
  return { ok: true, data };
}

// capability 聚合视图（--status）：按 registry capability 登记分组（opt-in 语义），列文档与 front-matter 状态。
async function collectCapabilityFrontMatter(registry, rootDir) {
  const rows = [];
  for (const document of registry.documents) {
    if (typeof document.capability !== 'string' || document.capability.trim() === '') continue;
    let status = document.status;
    if (document.path && document.path.endsWith('.md')) {
      try {
        const content = await fs.readFile(path.join(rootDir, document.path), 'utf8');
        const parsed = parseCapabilityFrontMatter(content);
        if (parsed !== null && parsed.ok && typeof parsed.data.status === 'string') status = parsed.data.status;
      } catch {
        // 读取失败按 registry status 呈报（校验问题由 validateDocumentRegistry 负责）
      }
    }
    rows.push({ capability: document.capability.trim(), id: document.id || '<invalid>', status });
  }
  return rows.sort((a, b) => a.capability.localeCompare(b.capability) || a.id.localeCompare(b.id));
}

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

  // SINGLE_ACTIVE_WORK_PACKAGE: document-governance.md §2.1 mandates strictly serial
  // development — at most one work package may be `active` at a time. `npm run state`
  // already treats `kind === 'work-package' && status === 'active'` as the authoritative
  // active-package signal, so this gate makes the same invariant fail loudly instead of
  // letting drift accumulate silently (see docs/git-sync-agent-flow-eval-2026-09-13.md D-2).
  const activeWorkPackages = normalizedDocuments.filter(
    (document) => document.kind === 'work-package' && document.status === 'active',
  );
  if (activeWorkPackages.length > 1) {
    issues.push(issue(
      'MULTIPLE_ACTIVE_WORK_PACKAGES',
      `at most one work package may be active (found ${activeWorkPackages.length}): ${activeWorkPackages.map((d) => d.id || '<invalid id>').join(', ')}. Close out or downgrade the extras — see docs/document-governance.md §2.1.`,
    ));
  }

  // ORPHAN_ACTIVE_REVIEW: a design-review / process artefact must not stay `active`
  // once its owning work package has been retired. Leaving `phase: P0-REVIEW` behind
  // makes state recovery believe a review stage is still running.
  const retiredOwnerStatuses = new Set(['completed', 'superseded', 'archived']);
  const documentById = new Map(
    normalizedDocuments.filter((document) => document.id).map((document) => [document.id, document]),
  );
  for (const document of normalizedDocuments) {
    if (document.status !== 'active') continue;
    const ownerIds = [
      ...(Array.isArray(document.supersedes) ? document.supersedes : []),
      ...(Array.isArray(document.supersededBy) ? document.supersededBy : []),
      ...(Array.isArray(document.relatedWorkPackages) ? document.relatedWorkPackages : []),
    ];
    const retiredOwner = ownerIds.find((ownerId) => {
      const owner = documentById.get(ownerId);
      return owner && retiredOwnerStatuses.has(owner.status);
    });
    if (retiredOwner) {
      issues.push(issue(
        'ORPHAN_ACTIVE_REVIEW',
        `status is active but its owning work package ${retiredOwner} is already retired; downgrade this document and drop any stale phase.`,
        document.id || null,
        document.path,
      ));
    }
  }

  // HK-04 P1（docs/hk04-spec-layer-design.md §2）：capability front-matter 增量校验。
  // 触发语义（实现期修正，见设计稿 §5）：registry 条目显式声明 `capability` 才校验——
  // 存量文档大量以 `---` 水平线开头，按「文件出现 front-matter 即校验」必误伤；
  // registry capability=能力命名空间的显式登记（opt-in），未登记文档零影响（增量采纳、无迁移墙）。
  // 校验三条：①四键格式 ②status 与 registry 一致（防第二真相漂移）③capability 与 registry 一致。
  for (const document of normalizedDocuments) {
    if (typeof document.capability !== 'string' || document.capability.trim() === '') continue;
    if (!document.path || !document.path.startsWith('docs/') || !document.path.endsWith('.md')) continue;
    if (!(await pathExists(path.join(rootDir, document.path)))) continue; // 缺失由 DOCUMENT_MISSING 另行报
    let content;
    try {
      content = await fs.readFile(path.join(rootDir, document.path), 'utf8');
    } catch {
      continue;
    }
    const parsed = parseCapabilityFrontMatter(content);
    if (parsed === null) {
      issues.push(issue('FRONTMATTER_INVALID_FORMAT', `registry declares capability "${document.capability.trim()}" but the document has no capability front-matter.`, document.id || null, document.path));
      continue;
    }
    if (!parsed.ok) {
      issues.push(issue(
        parsed.reason === 'unknown-key' ? 'FRONTMATTER_UNKNOWN_KEY' : 'FRONTMATTER_INVALID_FORMAT',
        `capability front-matter invalid: ${parsed.error}.`,
        document.id || null,
        document.path,
      ));
      if (parsed.reason !== 'unknown-key') continue;
    }
    const data = parsed.data ?? {};
    for (const key of CAPABILITY_FRONTMATTER_REQUIRED_KEYS) {
      const value = data[key];
      const missing = key === 'acceptance'
        ? !Array.isArray(value) || value.length === 0
        : typeof value !== 'string' || value.trim() === '';
      if (missing) {
        issues.push(issue('FRONTMATTER_INVALID_FORMAT', `capability front-matter missing required key: ${key}.`, document.id || null, document.path));
      }
    }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(data.capability ?? '')) {
      issues.push(issue('FRONTMATTER_CAPABILITY_INVALID', 'capability must be kebab-case (a-z / 0-9 / hyphen).', document.id || null, document.path));
    }
    if (data.capability !== undefined && data.capability !== document.capability.trim()) {
      issues.push(issue('FRONTMATTER_CAPABILITY_MISMATCH', `front-matter capability "${data.capability}" != registry capability "${document.capability.trim()}".`, document.id || null, document.path));
    }
    if (data.status !== undefined && data.status !== document.status) {
      issues.push(issue('FRONTMATTER_STATUS_MISMATCH', `front-matter status "${data.status}" != registry status "${document.status}".`, document.id || null, document.path));
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
// ── AUDIT-LOG 台账健康（BLOCK-170 自稳设计的门禁半边；修剪半边=scripts/audit-log-compact.mjs）──
// 硬阈=单读工具安全阈（超限连「整读」都做不到，fail-closed）；建议阈=广播规则保留策略目标；
// 行预算提示=行写入纪律「≤3 行约 600 字符」的宽裕上界，疑似整包收口报告误入台账时提示收进 plan 文档。
export const AUDIT_LEDGER_REL_PATH = 'docs/AUDIT-LOG.md';
export const AUDIT_LEDGER_FAIL_BYTES = 120 * 1024;
export const AUDIT_LEDGER_WARN_BYTES = 50 * 1024;
export const AUDIT_LEDGER_ENTRY_WARN_BYTES = 3072;

export async function checkAuditLedgerHealth(rootDir = DEFAULT_ROOT) {
  const issues = [];
  const advisories = [];
  const ledgerPath = path.join(rootDir, AUDIT_LEDGER_REL_PATH);
  let stat;
  try {
    stat = await fs.stat(ledgerPath);
  } catch {
    issues.push(issue('AUDIT_LOG_MISSING', `${AUDIT_LEDGER_REL_PATH} 不存在——审计广播台缺位，人工核查。`, 'AUDIT-LOG', AUDIT_LEDGER_REL_PATH));
    return { issues, advisories };
  }

  if (stat.size > AUDIT_LEDGER_FAIL_BYTES) {
    issues.push(
      issue(
        'AUDIT_LOG_OVERSIZE',
        `${AUDIT_LEDGER_REL_PATH} ${stat.size} bytes > ${AUDIT_LEDGER_FAIL_BYTES}（单读安全阈）——跑 npm run audit:compact 自稳后复跑本门。`,
        'AUDIT-LOG',
        AUDIT_LEDGER_REL_PATH,
      ),
    );
  } else if (stat.size > AUDIT_LEDGER_WARN_BYTES) {
    advisories.push(
      `[audit-ledger] ${Math.round(stat.size / 1024)}KB > ${Math.round(AUDIT_LEDGER_WARN_BYTES / 1024)}KB 保留阈——npm run audit:compact 幂等自稳（closeout 首步已自动执行）。`,
    );
  }

  const raw = await fs.readFile(ledgerPath, 'utf8');
  const fatEntries = raw
    .split('\n')
    .map((text, index) => ({ line: index + 1, bytes: Buffer.byteLength(text, 'utf8'), text }))
    .filter((entry) => entry.bytes > AUDIT_LEDGER_ENTRY_WARN_BYTES)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 3);
  if (fatEntries.length > 0) {
    advisories.push(
      `[audit-ledger] ${fatEntries.length} 条台账行超 ${AUDIT_LEDGER_ENTRY_WARN_BYTES}B（行写入纪律 ≤600 字符的宽裕上界）——详情移 plan/closeout 文档，台账行留指针：`,
    );
    for (const entry of fatEntries) {
      advisories.push(`  L${entry.line} ${entry.bytes}B：${entry.text.slice(0, 60)}…`);
    }
  }
  return { issues, advisories };
}

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
  const ledgerHealth = await checkAuditLedgerHealth(DEFAULT_ROOT);

  if (mode === '--check') {
    const allIssues = issues.concat(ledgerHealth.issues);
    if (allIssues.length > 0) {
      console.error(`[docs:check] FAIL (${allIssues.length} issue(s))`);
      printIssueList(allIssues);
      process.exitCode = 1;
      return;
    }
    console.log(`[docs:check] PASS (${registry.documents.length} registered documents)`);
    for (const line of ledgerHealth.advisories) console.log(line);
    return;
  }

  if (mode === '--status') {
    const managed = await collectManagedMarkdown(DEFAULT_ROOT, registry.coverage);
    console.log('Petri document governance status');
    console.log(`  Registered: ${registry.documents.length}`);
    console.log(`  Managed Markdown: ${managed.length}`);
    console.log(`  Validation: ${issues.length === 0 ? 'PASS' : `FAIL (${issues.length})`}`);
    console.log('  By status:');
    for (const [status, count] of countBy(registry.documents, 'status')) console.log(`    ${status}: ${count}`);
    console.log('  By kind:');
    for (const [kind, count] of countBy(registry.documents, 'kind')) console.log(`    ${kind}: ${count}`);
    console.log('  By capability (front-matter spec layer, HK-04):');
    const capabilityRows = await collectCapabilityFrontMatter(registry, DEFAULT_ROOT);
    if (capabilityRows.length === 0) {
      console.log('    (none — no registered document declares a capability yet)');
    }
    for (const row of capabilityRows) {
      console.log(`    ${row.capability}: ${row.id}(${row.status})`);
    }
    for (const line of ledgerHealth.advisories) console.log(`  ${line}`);
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
