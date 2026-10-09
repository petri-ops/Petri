// ============================================================
// BLOCK-150 审视吸收批·第一波 B 轨契约测试（⑦ R 缺包守卫 + ⑧ 三源依赖声明收敛）。
//
// ⑦：volcano-plot / go-kegg / gsea 三插件 R 主脚本此前直接 library(...) 无守卫
//    （缺包时报 "there is no package called 'x'"，用户不知缺什么、怎么补）。
//    契约 = 每个主脚本在首个 library() 前有「缺包守卫」块（指纹锚）：
//    - 覆盖全部顶层 library() 的包（deg-standardizer.R 运行时检查范式）；
//    - 中文可操作消息：缺什么（逐包点名）+ 怎么补（install.packages /
//      BiocManager::install 按源分列）+ 指向 environment.json 依赖清单；
//    - 条件包（org.Hs.eg.db / org.Mm.eg.db / msigdbr）在使用点有 requireNamespace
//      守卫（缺包即中文 stop，不得落进 tryCatch 静默降级成 "无显著富集"）。
//    边界：本机无 Rscript，R 语义无法实机执行——本测试是守卫**存在性**指纹锚，
//    R 行为正确性以代码级复查 + 下一 pack 波实机验收兜底。
// ⑧：go-kegg 三源（plugin.json / environment.json / plugins/manifest.json）对
//    packages.r 的声明必须一致，权威 = R 脚本实际 library/requireNamespace 的包
//    （go-kegg.R canonicalize_png 对 png 硬 stop，属硬依赖，三源均须声明）。
//
// pack 仓定位沿用 pack-registry.test.mjs 的兄弟仓约定，仓不在时 skip。
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIBLING_PACK = path.resolve(root, '..', 'gewu-pack-bio');
const hasPack = fs.existsSync(SIBLING_PACK);

const GUARD_MARKER = '# ---- 缺包守卫';

/** 每插件守卫期望：顶层必检包 + 条件包（使用点守卫）+ 主脚本相对路径。 */
const EXPECTATIONS = {
  'volcano-plot': {
    script: 'scripts/volcano-plot.R',
    topPkgs: ['ggplot2', 'ggrepel', 'jsonlite'],
    conditionalPkgs: [],
  },
  'go-kegg': {
    script: 'scripts/go-kegg.R',
    topPkgs: ['clusterProfiler', 'enrichplot', 'ggplot2', 'jsonlite', 'DOSE'],
    conditionalPkgs: ['org.Hs.eg.db', 'org.Mm.eg.db'],
  },
  gsea: {
    script: 'scripts/gsea.R',
    topPkgs: ['clusterProfiler', 'enrichplot', 'ggplot2', 'jsonlite', 'DOSE'],
    conditionalPkgs: ['org.Hs.eg.db', 'org.Mm.eg.db', 'msigdbr'],
  },
};

function readPluginFile(pluginId, rel) {
  return fs.readFileSync(path.join(SIBLING_PACK, 'plugins', pluginId, rel), 'utf8');
}

test('BLOCK-150 ⑦: 三插件 R 主脚本首个 library() 前有缺包守卫（覆盖顶层包 + 中文可操作消息）', { skip: !hasPack && 'sibling pack repo absent' }, () => {
  for (const [pluginId, exp] of Object.entries(EXPECTATIONS)) {
    const src = readPluginFile(pluginId, exp.script);
    const markerIdx = src.indexOf(GUARD_MARKER);
    assert.ok(markerIdx >= 0, `[${pluginId}] 缺少缺包守卫标记「${GUARD_MARKER}」`);
    const firstLibrary = src.indexOf('library(', markerIdx);
    assert.ok(firstLibrary > markerIdx, `[${pluginId}] 守卫块必须位于首个 library() 之前`);
    const guardText = src.slice(markerIdx, firstLibrary);
    for (const pkg of exp.topPkgs) {
      assert.ok(
        guardText.includes(`"${pkg}"`),
        `[${pluginId}] 守卫块未覆盖顶层依赖 ${pkg}（守卫须逐一 requireNamespace 检查）`,
      );
    }
    // 中文可操作消息：缺什么 + 怎么补（按 CRAN/Bioconductor 分列）+ 依赖清单出处。
    assert.ok(guardText.includes('缺少必需的 R 包'), `[${pluginId}] 守卫消息未点名缺包（缺什么）`);
    assert.ok(guardText.includes('install.packages'), `[${pluginId}] 守卫消息未给 CRAN 补装命令（怎么补）`);
    assert.ok(guardText.includes('BiocManager::install'), `[${pluginId}] 守卫消息未给 Bioconductor 补装命令（怎么补）`);
    assert.ok(guardText.includes('environment.json'), `[${pluginId}] 守卫消息未指向依赖清单出处`);
  }
});

test('BLOCK-150 ⑦: 条件包（org db / msigdbr）在使用点有 requireNamespace 守卫 + 中文缺包消息', { skip: !hasPack && 'sibling pack repo absent' }, () => {
  for (const [pluginId, exp] of Object.entries(EXPECTATIONS)) {
    const src = readPluginFile(pluginId, exp.script);
    for (const pkg of exp.conditionalPkgs) {
      assert.ok(
        src.includes(`requireNamespace("${pkg}", quietly = TRUE)`),
        `[${pluginId}] 条件包 ${pkg} 缺少使用点 requireNamespace 守卫`,
      );
      assert.ok(
        src.includes(`缺少必需的 R 包：${pkg}`),
        `[${pluginId}] 条件包 ${pkg} 的守卫 stop 消息未中文点名缺包`,
      );
    }
    // gsea Hallmark 分支：msigdbr 守卫必须在 tryCatch 之前，缺包不得静默降级为「无显著富集」。
    if (pluginId === 'gsea') {
      const guardIdx = src.indexOf('requireNamespace("msigdbr"');
      const hallmarkTry = src.indexOf('tryCatch({', src.indexOf('gene_set == "Hallmark"'));
      assert.ok(guardIdx >= 0 && hallmarkTry > guardIdx, 'gsea Hallmark 分支 msigdbr 守卫须先于 tryCatch（缺包不得静默降级）');
    }
  }
});

test('BLOCK-150 ⑧: 三插件 plugin.json / environment.json / manifest.json 三源 packages.r 声明一致', { skip: !hasPack && 'sibling pack repo absent' }, () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(SIBLING_PACK, 'plugins', 'manifest.json'), 'utf8'));
  for (const pluginId of Object.keys(EXPECTATIONS)) {
    const pluginJson = JSON.parse(readPluginFile(pluginId, 'plugin.json'));
    const envJson = JSON.parse(readPluginFile(pluginId, 'environment.json'));
    const declared = {
      pluginJson: Object.keys(pluginJson.packages.r).sort(),
      envJson: Object.keys(envJson.packages.r).sort(),
      manifestJson: Object.keys(manifest.plugins[pluginId].packages.r).sort(),
    };
    assert.deepEqual(declared.envJson, declared.pluginJson, `[${pluginId}] environment.json 与 plugin.json 的 packages.r 不一致`);
    assert.deepEqual(declared.manifestJson, declared.pluginJson, `[${pluginId}] manifest.json 与 plugin.json 的 packages.r 不一致`);
  }
});
