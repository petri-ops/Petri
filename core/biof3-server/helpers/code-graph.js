'use strict';

/**
 * helpers/code-graph.js — 符号图/导入边查询内核（BLOCK-124 / C-13 单源）。
 *
 * 血统：HK-03 P1 产物（scripts/symbol-graph.mjs，选型见 docs/hk03-symbol-graph-selection.md
 * 方案 A：typescript Compiler API，零新增依赖）迁入 core；scripts 侧只剩 CLI 薄壳。
 *
 * BLOCK-124 产品化加固（相对 HK-03 原版的三处差异，均有基准依据 acceptance/block-124/）：
 *  1. 流式建图：逐文件「解析→抽取→丢弃」，SourceFile 不再全量驻留——原版全仓 1604 文件
 *     峰值堆 +445MB，流式后峰值与文件总数无关（单文件量级）。
 *  2. 分批让位：每 yieldEvery 个文件 setImmediate 交还事件循环，后端 SSE/REST 不被
 *     秒级同步建图卡死（全仓实测 1.8s 单次阻塞不可接受）。
 *  3. tsconfig/jsconfig paths 通用别名解析（替代原版 `@/ → frontend/src` 仓库特化硬编码）；
 *     无别名配置时不猜测，`@/` 形态如实落 UNRESOLVED。
 *  另：maxFiles 上限（超限抛 too_many_files 供工具层诚实拒绝）+ 单文件读取容错
 *  （unreadable 文件记 parseErrors 跳过，不炸全图）。
 *
 * 诚实盲区（沿 HK-03）：变量形式动态 require / 按路径动态调用 / 字符串引用 → UNRESOLVED，
 * 不猜测。DEAD 语义=静态无已解析使用≠可安全删除（动态消费方在盲区）。
 */

const ts = require('typescript');
const { readdirSync, readFileSync, existsSync, statSync } = require('node:fs');
const { join, resolve, dirname, relative, sep } = require('node:path');

const EXTS = ['.js', '.cjs', '.mjs', '.ts', '.tsx'];
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'build', 'dist', 'coverage', '__fixtures__', '.biof3-dev-user-data',
  // BLOCK-124 产品化补充（常见生成物/依赖目录，JS 项目惯见）
  '.cache', '.turbo', '.next', '.nuxt', '.output', '.svelte-kit', 'bower_components', '.parcel-cache',
]);

const DEFAULT_MAX_FILES = 20000; // 内核安全网（CLI/dev 用）；agent 工具层收紧为 5000
const DEFAULT_YIELD_EVERY = 50; // 0 = 不让位（同步语义，测试小项目零开销）

function listFiles(rootDir) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p);
      } else if (EXTS.includes(e.name.slice(e.name.lastIndexOf('.'))) && !e.name.endsWith('.d.ts')) {
        out.push(p);
      }
    }
  };
  walk(rootDir);
  return out;
}

function scriptKind(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.ts')) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

// 字面量折叠：StringLiteral / 无替换模板 / 字面量拼接（确定性求值，非猜测）
function literalValue(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = literalValue(node.left);
    const r = literalValue(node.right);
    return l !== null && r !== null ? l + r : null;
  }
  return null;
}

// —— tsconfig/jsconfig paths 别名装载（通用化；JSONC 由 ts.readConfigFile 处理注释） ——
function loadAliasMap(rootDir) {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const p = join(rootDir, name);
    if (!existsSync(p)) continue;
    let cfg;
    try {
      cfg = ts.readConfigFile(p, ts.sys.readFile);
    } catch {
      return [];
    }
    const co = (cfg && cfg.config && cfg.config.compilerOptions) || {};
    const paths = co.paths || {};
    const baseDir = co.baseUrl ? resolve(rootDir, co.baseUrl) : rootDir;
    const aliases = [];
    for (const pattern of Object.keys(paths)) {
      const idx = pattern.indexOf('*');
      const prefix = idx === -1 ? pattern : pattern.slice(0, idx);
      const suffix = idx === -1 ? '' : pattern.slice(idx + 1);
      // target 内的 '*' 位置与 pattern 对齐：以 target 自身 '*' 切分
      const out = [];
      for (const t of Array.isArray(paths[pattern]) ? paths[pattern] : []) {
        const starIdx = t.indexOf('*');
        if (starIdx === -1) {
          out.push(resolve(baseDir, t));
        } else {
          out.push({
            dir: resolve(baseDir, t.slice(0, starIdx)),
            suffix: t.slice(starIdx + 1),
          });
        }
      }
      aliases.push({ prefix, suffix, targets: out, hasStar: idx !== -1 });
    }
    return aliases;
  }
  return [];
}

// 说明符 → 候选绝对路径（别名命中时按 target 模板展开；可多候选）
function aliasCandidates(aliases, spec) {
  const out = [];
  for (const a of aliases) {
    if (!spec.startsWith(a.prefix)) continue;
    if (!a.hasStar) {
      if (spec === a.prefix) {
        for (const t of a.targets) if (typeof t === 'string') out.push(t);
      }
      continue;
    }
    if (!spec.endsWith(a.suffix) || spec.length < a.prefix.length + a.suffix.length) continue;
    const star = spec.slice(a.prefix.length, spec.length - a.suffix.length);
    for (const t of a.targets) {
      if (typeof t === 'string') out.push(t);
      else out.push(join(t.dir, star) + t.suffix);
    }
  }
  return out;
}

// —— 使用计数：收集「裸标识符」出现，排除声明位与属性位 ——
const DECL_PARENT_KINDS = new Set([
  ts.SyntaxKind.ImportSpecifier,
  ts.SyntaxKind.ImportClause,
  ts.SyntaxKind.NamespaceImport,
  ts.SyntaxKind.ExportSpecifier,
  ts.SyntaxKind.BindingElement,
  ts.SyntaxKind.VariableDeclaration,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.EnumMember,
  ts.SyntaxKind.Parameter,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.MethodSignature,
  ts.SyntaxKind.PropertySignature,
  ts.SyntaxKind.PropertyDeclaration,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.PropertyAssignment,
  ts.SyntaxKind.JsxAttribute,
  ts.SyntaxKind.LabeledStatement,
]);

function collectUsedLocals(sf) {
  const used = new Set();
  const walk = (node) => {
    if (ts.isIdentifier(node)) {
      const p = node.parent;
      const isPropName = ts.isPropertyAccessExpression(p) && p.name === node;
      const isDeclName = DECL_PARENT_KINDS.has(p.kind) && !ts.isShorthandPropertyAssignment(p);
      // ShorthandPropertyAssignment 的名字即值引用（{ cjsA } ≡ { cjsA: cjsA }）→ 计为使用
      if (!isPropName && !(isDeclName && p.kind !== ts.SyntaxKind.ShorthandPropertyAssignment)) {
        used.add(node.text);
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return used;
}

// —— 边提取：AST 级（ESM import / re-export / require / 动态 import） ——
function extractEdges(sf, file) {
  const edges = [];
  const add = (e) =>
    edges.push({
      file,
      specifier: null,
      target: null,
      resolved: false,
      external: false,
      kind: 'require',
      namespace: false,
      symbols: [],
      namespaceLocal: null,
      ...e,
    });

  const visitRequire = (call) => {
    const arg = call.arguments[0];
    if (!arg) return;
    const lit = literalValue(arg);
    if (lit !== null) {
      const e = { kind: 'require', specifier: lit, symbols: [] };
      let n = call.parent;
      if (ts.isVariableDeclaration(n)) {
        if (ts.isObjectBindingPattern(n.name)) {
          for (const el of n.name.elements) {
            if (ts.isBindingElement(el)) {
              const imported = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
              const local = el.name.text;
              e.symbols.push({ imported, local });
            }
          }
        } else if (ts.isIdentifier(n.name)) {
          e.namespace = true;
          e.namespaceLocal = n.name.text;
        }
      }
      add(e);
    } else {
      // 变量形式 require：盲区，如实报 UNRESOLVED
      add({ specifier: null, resolved: false });
    }
  };

  const walk = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const e = { kind: 'esm-import', specifier: node.moduleSpecifier.text, symbols: [] };
      const c = node.importClause;
      if (c) {
        if (c.name) {
          e.symbols.push({ imported: 'default', local: c.name.text });
        }
        if (c.namedBindings) {
          if (ts.isNamespaceImport(c.namedBindings)) {
            e.namespace = true;
            e.namespaceLocal = c.namedBindings.name.text;
          } else {
            for (const el of c.namedBindings.elements) {
              const imported = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
              e.symbols.push({ imported, local: el.name.text });
            }
          }
        }
      } else {
        e.namespace = true; // 裸 import 'x'：副作用导入
      }
      add(e);
    } else if (
      ts.isExportDeclaration(node) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const e = { kind: 'esm-reexport', specifier: node.moduleSpecifier.text, symbols: [] };
      for (const el of node.exportClause.elements) {
        const imported = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
        e.symbols.push({ imported, local: el.name.text });
      }
      add(e);
    } else if (ts.isCallExpression(node)) {
      const expr = node.expression;
      if (ts.isIdentifier(expr) && expr.text === 'require' && node.arguments.length >= 1) {
        visitRequire(node);
      } else if (expr.kind === ts.SyntaxKind.ImportKeyword) {
        const lit = literalValue(node.arguments[0]);
        if (lit !== null) {
          add({ kind: 'dynamic-import', specifier: lit, namespace: true });
        } else {
          add({ kind: 'dynamic-import', specifier: null, resolved: false, namespace: true });
        }
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return edges;
}

// —— 说明符解析：相对路径 / tsconfig 别名 / 扩展名候选（含 TS 的 ./x.js → x.ts 惯例） ——
function resolveSpecifier(spec, importerFile, rootDir, aliases) {
  if (!spec) return { resolved: false, external: false, target: null };
  if (!spec.startsWith('.') && !spec.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(spec)) {
    const aliasHit = aliasCandidates(aliases, spec);
    if (aliasHit.length === 0) return { resolved: false, external: true, target: null };
    for (const c of aliasHit) {
      const r = tryFileCandidates(c);
      if (r) return { resolved: true, external: false, target: r };
    }
    return { resolved: false, external: false, target: null };
  }
  let base;
  if (/^[A-Za-z]:[\\/]/.test(spec) || spec.startsWith('/')) base = resolve(spec);
  else base = resolve(dirname(importerFile), spec);
  const r = tryFileCandidates(base);
  return r ? { resolved: true, external: false, target: r } : { resolved: false, external: false, target: null };
}

function tryFileCandidates(base) {
  const candidates = [base];
  const noExt = base.replace(/\.(js|mjs|cjs)$/, '');
  if (noExt !== base) candidates.push(noExt);
  for (const ext of EXTS) {
    candidates.push(base + ext);
    candidates.push(noExt + ext);
    candidates.push(join(base, 'index' + ext));
  }
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile() && EXTS.includes(c.slice(c.lastIndexOf('.')))) return c;
  }
  return null;
}

// —— 命名空间属性访问收集：ns.sym / ns['sym'] ——
function collectNamespaceAccesses(sf, nsLocals) {
  const accesses = new Set();
  if (!nsLocals.size) return accesses;
  const walk = (node) => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && nsLocals.has(node.expression.text)) {
      accesses.add(node.name.text);
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      nsLocals.has(node.expression.text) &&
      node.argumentExpression &&
      ts.isStringLiteral(node.argumentExpression)
    ) {
      accesses.add(node.argumentExpression.text);
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return accesses;
}

async function buildGraph(rootDir, options = {}) {
  const maxFiles = options.maxFiles || DEFAULT_MAX_FILES;
  const yieldEvery = options.yieldEvery === undefined ? DEFAULT_YIELD_EVERY : options.yieldEvery;
  rootDir = resolve(rootDir);
  const files = listFiles(rootDir);
  if (files.length > maxFiles) {
    throw Object.assign(new Error(`源文件数 ${files.length} 超过上限 ${maxFiles}，拒绝全量建图`), {
      code: 'too_many_files',
      fileCount: files.length,
      maxFiles,
    });
  }
  const aliases = loadAliasMap(rootDir);
  const parseErrors = [];
  const edges = [];
  for (let i = 0; i < files.length; i += 1) {
    const f = files[i];
    let sf;
    try {
      sf = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, scriptKind(f));
    } catch (e) {
      parseErrors.push({ file: relative(rootDir, f).replace(/\\/g, '/'), error: String((e && e.code) || e) });
      continue;
    }
    const usedLocals = collectUsedLocals(sf);
    const fileEdges = extractEdges(sf, f);
    const nsLocals = new Set(fileEdges.filter((e) => e.namespace && e.namespaceLocal).map((e) => e.namespaceLocal));
    const nsAccesses = collectNamespaceAccesses(sf, nsLocals);
    for (const e of fileEdges) {
      const r = resolveSpecifier(e.specifier, f, rootDir, aliases);
      edges.push({
        ...e,
        target: r.target,
        resolved: r.resolved,
        external: r.external,
        usedLocals,
        nsAccesses: e.namespace ? nsAccesses : null,
      });
    }
    // SourceFile 到此可弃（流式：峰值内存与项目规模解耦）
    if (yieldEvery > 0 && (i + 1) % yieldEvery === 0 && i + 1 < files.length) {
      await new Promise((r2) => setImmediate(r2));
    }
  }
  return { rootDir, files, edges, parseErrors };
}

function isTestFile(f) {
  const base = f.split(sep).pop();
  return /\.test\.|\.spec\./.test(base) || f.split(sep).includes('test');
}

function whoImports(graph, symbol) {
  const hits = [];
  for (const e of graph.edges) {
    if (e.namespace && e.nsAccesses && e.nsAccesses.has(symbol)) {
      hits.push({
        file: relative(graph.rootDir, e.file).replace(/\\/g, '/'),
        specifier: e.specifier,
        target: e.target ? relative(graph.rootDir, e.target).replace(/\\/g, '/') : null,
        resolved: e.resolved,
        symbol,
        used: true,
        via: 'namespace',
        kind: isTestFile(e.file) ? 'USED_TEST' : 'USED_PROD',
      });
    }
    for (const s of e.symbols) {
      if (s.imported !== symbol) continue;
      const used = e.usedLocals.has(s.local);
      hits.push({
        file: relative(graph.rootDir, e.file).replace(/\\/g, '/'),
        specifier: e.specifier,
        target: e.target ? relative(graph.rootDir, e.target).replace(/\\/g, '/') : null,
        resolved: e.resolved,
        symbol,
        used,
        via: 'named',
        kind: used ? (isTestFile(e.file) ? 'USED_TEST' : 'USED_PROD') : 'UNUSED',
      });
    }
  }
  return hits;
}

function extractExports(file) {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, scriptKind(file));
  const names = new Set();
  const walk = (node) => {
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause) && !node.moduleSpecifier) {
      for (const el of node.exportClause.elements) names.add(el.name.text);
    } else if (ts.isExportAssignment(node)) {
      names.add(node.isExportEquals ? '(export=)' : 'default');
    } else if (ts.isVariableStatement(node)) {
      const mods = node.modifiers || [];
      if (mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        for (const d of node.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) names.add(d.name.text);
        }
      }
    } else if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) &&
      node.name &&
      (node.modifiers || []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      names.add(node.name.text);
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const l = node.left;
      if (ts.isPropertyAccessExpression(l) && ts.isIdentifier(l.name) && ((ts.isIdentifier(l.expression) && l.expression.text === 'exports') || (ts.isPropertyAccessExpression(l.expression) && l.expression.name.text === 'exports'))) {
        names.add(l.name.text);
      } else if (ts.isPropertyAccessExpression(l) && ts.isIdentifier(l.expression) && l.expression.text === 'module' && l.name.text === 'exports') {
        if (ts.isObjectLiteralExpression(node.right)) {
          for (const p of node.right.properties) {
            if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) {
              if (ts.isIdentifier(p.name)) names.add(p.name.text);
              else if (ts.isStringLiteral(p.name)) names.add(p.name.text);
            }
          }
        } else if (ts.isIdentifier(node.right)) {
          names.add(node.right.text);
        } else {
          names.add('(anonymous)');
        }
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return [...names];
}

function edgeUsedSymbols(e) {
  if (e.namespace) return e.namespaceLocal && e.usedLocals.has(e.namespaceLocal) ? new Set(['<namespace>']) : new Set();
  const out = new Set();
  for (const s of e.symbols) if (e.usedLocals.has(s.local)) out.add(s.imported);
  return out;
}

function classifyEdges(graph, file) {
  // BLOCK-124：file 相对项目根解析（CLI 传绝对路径同样成立）；取代原版 CWD 相对语义
  const targetAbs = resolve(graph.rootDir, file);
  const exportNames = extractExports(targetAbs);
  const inbound = graph.edges.filter((e) => e.resolved && e.target === targetAbs);
  const exports = exportNames.map((name) => {
    const usedBy = [];
    const importedByUnused = [];
    for (const e of inbound) {
      if (e.namespace && e.nsAccesses && e.nsAccesses.has(name)) {
        usedBy.push({ file: relative(graph.rootDir, e.file).replace(/\\/g, '/'), used: true, via: 'namespace' });
        continue;
      }
      const match = e.symbols.find((s) => s.imported === name);
      if (!match) continue;
      const entry = { file: relative(graph.rootDir, e.file).replace(/\\/g, '/'), used: e.usedLocals.has(match.local), via: 'named' };
      (entry.used ? usedBy : importedByUnused).push(entry);
    }
    const status = usedBy.length ? (usedBy.some((u) => isTestFile(join(graph.rootDir, u.file))) ? 'USED_TEST' : 'USED_PROD') : 'DEAD';
    return { name, status, usedBy, importedByUnused };
  });
  const outbound = graph.edges
    .filter((e) => e.file === targetAbs)
    .map((e) => ({
      specifier: e.specifier,
      target: e.target ? relative(graph.rootDir, e.target).replace(/\\/g, '/') : null,
      resolved: e.resolved,
      external: e.external,
      kind: e.kind,
      symbols: e.symbols.map((s) => s.imported),
      usedSymbols: [...edgeUsedSymbols(e)],
    }));
  const namespaceInbound = inbound
    .filter((e) => e.namespace)
    .map((e) => ({ file: relative(graph.rootDir, e.file).replace(/\\/g, '/'), used: e.namespaceLocal ? e.usedLocals.has(e.namespaceLocal) : false }));
  return { file: relative(graph.rootDir, targetAbs).replace(/\\/g, '/'), exports, outbound, namespaceInbound };
}

module.exports = { buildGraph, whoImports, classifyEdges, DEFAULT_MAX_FILES };
