/**
 * item 41 hotfix — TSX 真语法门禁（transpileModule reportDiagnostics）。
 *
 * CI（petri-ops/Petri run 45577227462）干净环境有 frontend/node_modules，
 * 9 处裸 var(--petri-z-xxx) 被 TSX parser 报 `Parsing error: Expression expected`；
 * 本机缺 frontend/node_modules 导致 eslint 跳过 TSX 解析而误判全绿。本门禁绕开
 * eslint，直接用仓库已声明的 TypeScript（零新依赖）对 9 个改动文件逐个
 * transpileModule(reportDiagnostics:true)，断言 0 个语法 Error。
 *
 * TypeScript 解析顺序：常规 require（CI root node_modules / NODE_PATH）→
 * frontend/node_modules → root/node_modules；找不到即 fail-closed。
 */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

function loadTypeScript() {
  const candidates = [
    'typescript',
    path.join(ROOT, 'frontend', 'node_modules', 'typescript'),
    path.join(ROOT, 'node_modules', 'typescript'),
  ];
  for (const id of candidates) {
    try {
      const mod = require(id);
      if (mod?.transpileModule) return mod;
    } catch {
      // 逐个尝试下一处已声明依赖的安装位置
    }
  }
  assert.fail(`无法解析仓库已声明的 typescript（尝试：${candidates.join(', ')}）`);
}

const ts = loadTypeScript();
const OPTIONS = {
  reportDiagnostics: true,
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.ReactJSX,
  },
};

function syntaxErrors(source, fileName) {
  const out = ts.transpileModule(source, { ...OPTIONS, fileName });
  return (out.diagnostics ?? [])
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((d) => `TS${d.code} @${d.start}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
}

// 9 个文件、10 处改动（App.tsx 两处）：item 41 全量改动面。
const FILES = [
  'frontend/src/App.tsx',
  'frontend/src/components/copilot/ContextBudgetBar.tsx',
  'frontend/src/components/copilot/ChatArtifactCard.tsx',
  'frontend/src/components/desktop/titlebar/TitleBarRightZone.tsx',
  'frontend/src/components/desktop/InstallDeepLinkDialog.tsx',
  'frontend/src/components/desktop/PluginStorePanel.tsx',
  'frontend/src/components/desktop/CrashNoticeBanner.tsx',
  'frontend/src/pages/window/CommandCenterJobsWall.tsx',
  'frontend/src/themes/ThemeProvider.tsx',
];

test('S1 9 个改动文件 transpileModule 语法错误为 0', () => {
  const errors = [];
  for (const rel of FILES) {
    const found = syntaxErrors(fs.readFileSync(path.join(ROOT, rel), 'utf8'), rel);
    if (found.length) errors.push(`${rel}: ${found.join('; ')}`);
  }
  assert.deepEqual(errors, [], `TSX 语法错误：\n${errors.join('\n')}`);
});

test('S2 合成红自证：裸 var() 必被报语法错、加引号后归零', () => {
  const bare = syntaxErrors('const s = { zIndex: var(--petri-z-toast) };', 'synthetic.tsx');
  assert.ok(bare.length >= 1, '裸 var(--...) 必须被 transpileModule 报语法错');
  assert.deepEqual(
    syntaxErrors("const s = { zIndex: 'var(--petri-z-toast)' };", 'synthetic.tsx'),
    [],
    '加引号后语法错误必须归零',
  );
});
