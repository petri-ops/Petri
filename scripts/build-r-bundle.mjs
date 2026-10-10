#!/usr/bin/env node

/**
 * Build a Petri R capability bundle from packages already verified on the
 * target machine.
 *
 * The builder intentionally copies the installed recursive dependency closure
 * instead of asking BiocManager to install into an empty library:
 *   - BiocManager otherwise sees packages in the system library and may leave
 *     the staging library empty.
 *   - install-time warnings must not be promoted to fatal errors.
 *   - copied binaries exactly match the R/architecture used for the real
 *     scientific-flow validation on this machine.
 *
 * A real build must run on its target architecture. Upload remains a separate,
 * human-authorized B3 operation; this script never reads credentials.
 *
 * Usage:
 *   node scripts/build-r-bundle.mjs --dry-run --bundle-id=r-enrichment
 *   node scripts/build-r-bundle.mjs --bundle-id=r-enrichment
 *   node scripts/build-r-bundle.mjs --bundle-id=r-wgcna
 */

import { createHash } from 'node:crypto';
import {
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

// BLOCK-152 P 轨收敛：宿主→平台键推导单源（core/shared-backend/host-platform.js），
// 本脚本历史副本 currentPlatform() 已删，构建侧与 bundle 域 / 桌面主进程同源。
const require = createRequire(import.meta.url);
const { deriveHostPlatform } = require('../core/shared-backend/host-platform.js');

const DEFAULT_PLATFORM = 'macos-arm64';
const DEFAULT_VERSION = '1.0.0';

const BUNDLE_MANIFESTS = Object.freeze({
  'r-enrichment': Object.freeze({
    bundleId: 'r-enrichment',
    rVersion: '4.5.2',
    bioconductorVersion: '3.22',
    note: 'Validated with clusterProfiler 4.18.4, enrichplot 1.30.5 and ggplot2 4.0.3',
    roots: Object.freeze([
      { name: 'clusterProfiler', version: '4.18.4' },
      { name: 'org.Hs.eg.db', version: '3.22.0' },
      { name: 'org.Mm.eg.db', version: '3.22.0' },
      { name: 'enrichplot', version: '1.30.5' },
      { name: 'DOSE', version: '4.4.0' },
      { name: 'fgsea', version: '1.36.2' },
      { name: 'ggplot2', version: '4.0.3' },
      { name: 'jsonlite', version: '2.0.0' },
      { name: 'base64enc', version: '0.1-6' },
      { name: 'msigdbr', version: '26.1.0' },
    ]),
    includeKeggSnapshots: true,
  }),
  'r-wgcna': Object.freeze({
    bundleId: 'r-wgcna',
    rVersion: '4.5.2',
    bioconductorVersion: '3.22',
    note: 'Validated with WGCNA 1.74, flashClust 1.1.4 and impute 1.84.0',
    roots: Object.freeze([
      { name: 'WGCNA', version: '1.74' },
      { name: 'flashClust', version: '1.1-4' },
      { name: 'impute', version: '1.84.0' },
      { name: 'ggplot2', version: '4.0.3' },
      { name: 'jsonlite', version: '2.0.0' },
      { name: 'dplyr' },
      { name: 'base64enc', version: '0.1-6' },
    ]),
    includeKeggSnapshots: false,
  }),
});

function fail(message) {
  console.error(`[build-r-bundle] ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    force: false,
    bundleId: null,
    platform: DEFAULT_PLATFORM,
  };
  for (const arg of argv) {
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg.startsWith('--bundle-id=')) {
      args.bundleId = arg.slice('--bundle-id='.length);
    } else if (arg.startsWith('--platform=')) {
      args.platform = arg.slice('--platform='.length) || DEFAULT_PLATFORM;
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function runR(program, { capture = true } = {}) {
  const result = spawnSync('Rscript', ['-e', program], {
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) fail(`failed to spawn Rscript: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = capture ? String(result.stderr || result.stdout || '').trim() : '';
    fail(`Rscript failed with exit ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return capture ? String(result.stdout || '').trim() : '';
}

function inspectInstalledClosure(manifest) {
  const roots = manifest.roots.map((item) => item.name);
  const expected = Object.fromEntries(
    manifest.roots.filter((item) => item.version).map((item) => [item.name, item.version])
  );
  const program = `
roots <- jsonlite::fromJSON(${JSON.stringify(JSON.stringify(roots))})
expected <- jsonlite::fromJSON(${JSON.stringify(JSON.stringify(expected))})
db <- installed.packages(noCache = TRUE)
missing_roots <- setdiff(roots, rownames(db))
if (length(missing_roots) > 0) {
  stop(paste("missing root packages:", paste(missing_roots, collapse = ", ")))
}
actual_versions <- setNames(db[roots, "Version"], roots)
mismatched <- names(expected)[actual_versions[names(expected)] != unlist(expected)]
if (length(mismatched) > 0) {
  details <- paste0(mismatched, " expected=", unlist(expected)[mismatched],
                    " actual=", actual_versions[mismatched])
  stop(paste("root package version mismatch:", paste(details, collapse = "; ")))
}

declared_dependency_map <- tools::package_dependencies(
  roots,
  db = db,
  which = c("Depends", "Imports", "LinkingTo"),
  recursive = TRUE
)
declared_closure <- unique(c(roots, unlist(declared_dependency_map, use.names = FALSE)))

# Some R packages load optional runtime helpers from Suggests during namespace
# initialization (currently otel/dichromat). Copy only the observed extras
# beyond the declared closure, without pulling the entire recursive Suggests
# graph (which includes test, vignette and development-only packages).
loaded_before_roots <- loadedNamespaces()
for (package in roots) {
  if (!requireNamespace(package, quietly = TRUE)) {
    stop(paste("root package failed to load:", package))
  }
}
runtime_loaded <- setdiff(loadedNamespaces(), loaded_before_roots)
runtime_loaded <- runtime_loaded[runtime_loaded %in% rownames(db)]
runtime_priority <- db[runtime_loaded, "Priority"]
runtime_loaded <- runtime_loaded[is.na(runtime_priority) | runtime_priority == ""]
runtime_extras <- setdiff(runtime_loaded, declared_closure)
seeds <- unique(c(roots, runtime_extras))
dependency_map <- tools::package_dependencies(
  seeds,
  db = db,
  which = c("Depends", "Imports", "LinkingTo"),
  recursive = TRUE
)
closure <- unique(c(seeds, unlist(dependency_map, use.names = FALSE)))
closure <- closure[!is.na(closure) & closure %in% rownames(db)]
priority <- db[closure, "Priority"]
copy_packages <- sort(closure[is.na(priority) | priority == ""])
records <- lapply(copy_packages, function(package) {
  list(
    name = package,
    version = unname(db[package, "Version"]),
    sourcePath = file.path(unname(db[package, "LibPath"]), package)
  )
})
result <- list(
  rVersion = as.character(getRversion()),
  bioconductorVersion = if (requireNamespace("BiocManager", quietly = TRUE)) {
    as.character(BiocManager::version())
  } else {
    NA_character_
  },
  roots = as.list(actual_versions),
  runtimeLoadedPackages = sort(runtime_extras),
  packages = records
)
cat(jsonlite::toJSON(result, auto_unbox = TRUE))
`;
  const raw = runR(program);
  let plan;
  try {
    plan = JSON.parse(raw);
  } catch (error) {
    fail(`could not parse R package plan: ${error.message}`);
  }
  if (plan.rVersion !== manifest.rVersion) {
    fail(`R version mismatch: expected ${manifest.rVersion}, found ${plan.rVersion}`);
  }
  if (
    manifest.bioconductorVersion &&
    plan.bioconductorVersion !== manifest.bioconductorVersion
  ) {
    fail(
      `Bioconductor version mismatch: expected ${manifest.bioconductorVersion}, ` +
      `found ${plan.bioconductorVersion}`
    );
  }
  for (const pkg of plan.packages || []) {
    if (!pkg.sourcePath || !existsSync(pkg.sourcePath)) {
      fail(`installed package path missing for ${pkg.name}: ${pkg.sourcePath || '(empty)'}`);
    }
  }
  return plan;
}

function copyInstalledClosure(plan, libDir) {
  mkdirSync(libDir, { recursive: true });
  for (const pkg of plan.packages) {
    const destination = join(libDir, pkg.name);
    cpSync(pkg.sourcePath, destination, {
      recursive: true,
      dereference: true,
      preserveTimestamps: true,
    });
  }
}

function generateKeggSnapshots(libDir) {
  const dataDir = join(libDir, '.petri-data');
  mkdirSync(dataDir, { recursive: true });
  const program = `
.libPaths(c(${JSON.stringify(libDir)}, .libPaths()))
download_kegg <- getFromNamespace("download_KEGG", "clusterProfiler")
for (organism in c("hsa", "mmu")) {
  snapshot <- download_kegg(organism)
  payload <- list(
    schemaVersion = 1L,
    organism = organism,
    generatedAt = format(Sys.time(), tz = "UTC", usetz = TRUE),
    clusterProfilerVersion = as.character(packageVersion("clusterProfiler")),
    term2gene = snapshot$KEGGPATHID2EXTID,
    term2name = snapshot$KEGGPATHID2NAME
  )
  saveRDS(payload, file.path(${JSON.stringify(dataDir)}, paste0("kegg-", organism, ".rds")))
}
`;
  runR(program, { capture: false });
  return ['hsa', 'mmu'].map((organism) => {
    const file = join(dataDir, `kegg-${organism}.rds`);
    if (!existsSync(file) || statSync(file).size === 0) {
      fail(`KEGG snapshot was not created: ${file}`);
    }
    return {
      organism,
      file: `.petri-data/${basename(file)}`,
      sizeBytes: statSync(file).size,
    };
  });
}

function writeBundleManifest({ manifest, plan, platform, snapshots, libDir }) {
  const payload = {
    schemaVersion: 1,
    bundleId: manifest.bundleId,
    bundleVersion: DEFAULT_VERSION,
    platform,
    builtAt: new Date().toISOString(),
    rVersion: plan.rVersion,
    bioconductorVersion: plan.bioconductorVersion,
    note: manifest.note,
    rootPackages: manifest.roots,
    runtimeLoadedPackages: plan.runtimeLoadedPackages || [],
    packageCount: plan.packages.length,
    packages: plan.packages.map(({ name, version }) => ({ name, version })),
    keggSnapshots: snapshots,
  };
  writeFileSync(join(libDir, 'bundle-manifest.json'), JSON.stringify(payload, null, 2));
}

function streamingSha256(filePath) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolvePromise(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.bundleId) fail('missing --bundle-id=<r-enrichment|r-wgcna>');
  const manifest = BUNDLE_MANIFESTS[args.bundleId];
  if (!manifest) {
    fail(`unknown bundle-id "${args.bundleId}"`);
  }

  const hostPlatform = deriveHostPlatform();
  if (args.platform !== hostPlatform) {
    fail(
      `cannot cross-build ${args.platform} on ${hostPlatform}; run on the target architecture`
    );
  }

  const fileName = `${manifest.bundleId}-${DEFAULT_VERSION}-${args.platform}.tar.gz`;
  const outFile = resolve(process.cwd(), fileName);
  if (!args.dryRun && existsSync(outFile) && !args.force) {
    fail(`${fileName} already exists; inspect it or pass --force to replace it`);
  }

  console.log(
    `[build-r-bundle] bundleId=${manifest.bundleId} version=${DEFAULT_VERSION} ` +
    `platform=${args.platform}`
  );
  console.log(`[build-r-bundle] ${manifest.note}`);
  console.log('[build-r-bundle] resolving installed recursive dependency closure...');
  const plan = inspectInstalledClosure(manifest);
  console.log(
    `[build-r-bundle] verified R ${plan.rVersion}, Bioconductor ` +
    `${plan.bioconductorVersion}, ${plan.packages.length} external package(s)`
  );
  console.log(
    `[build-r-bundle] roots: ${manifest.roots
      .map((item) => `${item.name}@${plan.roots[item.name]}`)
      .join(', ')}`
  );
  if (Array.isArray(plan.runtimeLoadedPackages) && plan.runtimeLoadedPackages.length > 0) {
    console.log(
      `[build-r-bundle] observed runtime-loaded package(s): ` +
      plan.runtimeLoadedPackages.join(', ')
    );
  }

  if (args.dryRun) {
    console.log('[build-r-bundle] --dry-run: package closure verified; no files copied.');
    console.log(
      `[build-r-bundle] real run will copy ${plan.packages.length} installed package ` +
      `directories, generate offline data when required, tar, and hash.`
    );
    return;
  }

  const workDir = mkdtempSync(join(tmpdir(), `r-bundle-${manifest.bundleId}-`));
  const libDir = join(workDir, 'lib');
  try {
    console.log(`[build-r-bundle] copying verified package closure to ${workDir} ...`);
    copyInstalledClosure(plan, libDir);

    let snapshots = [];
    if (manifest.includeKeggSnapshots) {
      console.log('[build-r-bundle] generating offline KEGG snapshots for human and mouse...');
      snapshots = generateKeggSnapshots(libDir);
    }
    writeBundleManifest({
      manifest,
      plan,
      platform: args.platform,
      snapshots,
      libDir,
    });

    if (args.force) rmSync(outFile, { force: true });
    console.log(`[build-r-bundle] packing ${fileName} ...`);
    const tar = spawnSync('tar', ['-czf', outFile, '-C', libDir, '.'], {
      stdio: 'inherit',
      env: { ...process.env, COPYFILE_DISABLE: '1' },
    });
    if (tar.error) fail(`failed to spawn tar: ${tar.error.message}`);
    if (tar.status !== 0) fail(`tar failed with exit ${tar.status}`);
    if (!existsSync(outFile)) fail(`archive was not created: ${outFile}`);

    const sha256 = await streamingSha256(outFile);
    const sizeBytes = statSync(outFile).size;
    const descriptor = {
      bundleId: manifest.bundleId,
      version: DEFAULT_VERSION,
      platform: args.platform,
      sha256,
      sizeBytes,
      fileName,
    };
    console.log('[build-r-bundle] descriptor JSON:');
    console.log(JSON.stringify(descriptor, null, 2));
    console.log(
      '[build-r-bundle] NEXT: verify extraction + isolated R loading, then backfill ' +
      'capability-bundles.js. OSS upload remains human-gated.'
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => fail(error && error.message ? error.message : String(error)));
