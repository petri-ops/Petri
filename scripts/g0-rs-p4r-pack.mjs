#!/usr/bin/env node
/**
 * G0-RS P2 P4R-CORPUS — 领域包感知层。
 *
 * BLOCK-83 把全部生信插件/演示数据迁出核心树（petri-pack-bio 是唯一来源），
 * BLOCK-86 又把 14 插件封存进 plugins.dormant/（deseq2 唯一活跃参考实现）。
 * P4R corpus 链因此在空领域注册表上快速失败（`未知工具: deseq2`），且
 * CORPUS_INPUTS 的两条核心树路径已随迁包删除。
 *
 * 本模块是 corpus 链唯一的包解析点：
 *   - resolveBioPackRoot(): `PETRI_BIO_PACK_ROOT` 覆盖 → 兄弟仓 `../petri-pack-bio`
 *     （沿用 g0-rs-p5-acceptance.mjs findBioPackRoot 先例）
 *   - locatePackPluginDir(): `plugins/` 优先，`plugins.dormant/` 兜底（封存态兼容）
 *   - stagePackPlugins(): 把 corpus 需要的插件目录装配进隔离根 `pack-plugins/`
 *     （目录符号链接，包仓只读复用；symlink 失败退回复制）
 *   - buildPackEnv(): env 注入 —— `PETRI_DEVELOPMENT_PLUGIN_DIRS`（只读开发源，
 *     不触碰 ISOLATED_PATH_ENV 守卫面）+ `PETRI_DOMAIN_TOOL_REGISTRY`
 *     （tool-registry.js 的领域条目注入口）
 *
 * 红线：包仓零改动；核心树零领域回流；隔离根外零写入。
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** corpus 步骤依赖的插件（go-kegg 为 optional 步骤，缺席仅在 --with-enrichment 时致命）。 */
export const PACK_CORPUS_TOOL_IDS = Object.freeze([
  'deseq2',
  'volcano-plot',
  'gene-correlation',
  'go-kegg',
]);

/** 输入文件在包仓内的相对布局（演示数据随 BLOCK-83 迁入包仓，核心树不再携带）。
 * counts/coldata 相对包根；enrichmentGenes 相对 go-kegg 插件目录（封存态下在
 * plugins.dormant/，由 resolvePackCorpusInputs 的 dormant 感知定位解析）。 */
export const CORPUS_INPUTS = Object.freeze({
  counts: 'demo-data/deseq2/demo-counts.csv',
  coldata: 'demo-data/deseq2/demo-coldata.csv',
});

/** 解析领域包根：env 覆盖优先，其次兄弟仓。找不到含 pack.json 的根返回 null。 */
export function resolveBioPackRoot() {
  const override = process.env.PETRI_BIO_PACK_ROOT;
  if (override) return existsSync(path.join(override, 'pack.json')) ? override : null;
  const sibling = path.join(REPO_ROOT, '..', 'petri-pack-bio');
  return existsSync(path.join(sibling, 'pack.json')) ? sibling : null;
}

/** 在包内定位单个插件目录：活跃区优先，封存区兜底。两处皆无 → fail-closed。 */
export function locatePackPluginDir(packRoot, toolId) {
  const active = path.join(packRoot, 'plugins', toolId);
  if (existsSync(path.join(active, 'plugin.json'))) return active;
  const dormant = path.join(packRoot, 'plugins.dormant', toolId);
  if (existsSync(path.join(dormant, 'plugin.json'))) return dormant;
  throw new Error(
    `bio pack ${packRoot} has no plugin '${toolId}' (searched plugins/ and plugins.dormant/)` ,
  );
}

/**
 * 把需要的插件目录装配进 `<captureRoot>/pack-plugins/`。直接复制而不是符号链接：
 * 候选发现用 `readdirSync(withFileTypes).isDirectory()` 过滤（plugin-sdk.js:49），
 * 符号链接目录会被静默跳过（0 候选、零诊断）。包仓保持只读单一来源——这里只是
 * 一次性捕获根内的运行副本，随隔离根一起清理。幂等：已装配的 toolId 跳过。
 */
export function stagePackPlugins({ captureRoot, toolIds, packRoot }) {
  const stagingDir = path.join(captureRoot, 'pack-plugins');
  mkdirSync(stagingDir, { recursive: true });
  for (const toolId of toolIds) {
    const target = path.join(stagingDir, toolId);
    if (existsSync(target)) continue;
    const source = locatePackPluginDir(packRoot, toolId);
    cpSync(source, target, { recursive: true });
  }
  return stagingDir;
}

/**
 * 组装 corpus 子进程 / 隔离服务端共用的包感知 env。
 * 包根缺失或注册表文件缺失都 fail-closed —— corpus 的存在意义是真实产品链，
 * 静默退化为空注册表只会重演 `未知工具: deseq2`。
 */
export function buildPackEnv({ captureRoot, toolIds = PACK_CORPUS_TOOL_IDS } = {}) {
  const packRoot = resolveBioPackRoot();
  if (!packRoot) {
    throw new Error(
      'bio pack not found (set PETRI_BIO_PACK_ROOT or check out petri-pack-bio next to the repo)',
    );
  }
  const registryFile = path.join(packRoot, 'registry', 'tool-registry.json');
  if (!existsSync(registryFile)) {
    throw new Error(`bio pack ${packRoot} is missing registry/tool-registry.json`);
  }
  const stagingDir = stagePackPlugins({ captureRoot, toolIds, packRoot });
  return {
    packRoot,
    registryFile,
    stagingDir,
    stagedToolIds: [...toolIds],
    env: {
      PETRI_DEVELOPMENT_PLUGIN_DIRS: stagingDir,
      PETRI_DOMAIN_TOOL_REGISTRY: registryFile,
    },
  };
}

/** 把包相对输入布局解析为绝对路径；任一缺失即 fail-closed。
 * 随插件交付的输入（go-kegg 的 genes.csv）走 dormant 感知定位——封存态下
 * 它在 plugins.dormant/go-kegg/ 而不是 plugins/go-kegg/。 */
export function resolvePackCorpusInputs(packRoot) {
  const goKeggDir = locatePackPluginDir(packRoot, 'go-kegg');
  const resolved = {
    counts: path.join(packRoot, CORPUS_INPUTS.counts),
    coldata: path.join(packRoot, CORPUS_INPUTS.coldata),
    enrichmentGenes: path.join(goKeggDir, 'demo-data', 'genes.csv'),
  };
  const missing = Object.entries(resolved)
    .filter(([, absolute]) => !existsSync(absolute))
    .map(([key, absolute]) => `${key}: ${absolute}`);
  if (missing.length) throw new Error(`bio pack corpus inputs missing -> ${missing.join('; ')}`);
  return resolved;
}
