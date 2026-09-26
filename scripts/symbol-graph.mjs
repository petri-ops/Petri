#!/usr/bin/env node
// HK-03 P1 — symbol-graph：导入边精确分类查询（CK-11 批次四方法论机械化）
// 选型与契约：docs/hk03-symbol-graph-selection.md（方案 A：typescript Compiler API，零新增依赖）
// 查询一：node scripts/symbol-graph.mjs who-imports <symbol>
// 查询二：node scripts/symbol-graph.mjs classify-edges <file>
// 诚实盲区：变量形式动态 require / 按路径动态调用 / 字符串引用 → 报 UNRESOLVED，不猜测。
import ts from 'typescript';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXTS = ['.js', '.cjs', '.mjs', '.ts', '.tsx'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'build', 'dist', 'coverage', '__fixtures__', '.biof3-dev-user-data']);

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
      const isPropName =
        ts.isPropertyAccessExpression(p) && p.name === node;
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

// —— 边提取：AST 级（ESM import / re-export / require / 动态 import）——
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
      // 解构形态：const { a, b } = require('x') / const a = require('x')
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

// —— 说明符解析：相对/@ 别名/扩展名候选（含 TS 的 ./x.js → x.ts 惯例）——
function resolveSpecifier(spec, importerFile, rootDir) {
  if (!spec) return { resolved: false, external: false, target: null };
  if (!spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('@/')) {
    return { resolved: false, external: true, target: null };
  }
  let base;
  if (spec.startsWith('@/')) base = join(rootDir, 'frontend', 'src', spec.slice(2));
  else base = resolve(dirname(importerFile), spec);
  const candidates = [base];
  const noExt = base.replace(/\.(js|mjs|cjs)$/, '');
  if (noExt !== base) candidates.push(noExt);
  for (const ext of EXTS) {
    candidates.push(base + ext);
    candidates.push(noExt + ext);
    candidates.push(join(base, 'index' + ext));
  }
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile() && EXTS.includes(c.slice(c.lastIndexOf('.')))) return { resolved: true, external: false, target: c };
  }
  return { resolved: false, external: false, target: null };
}

// —— 命名空间属性访问收集：ns.sym / ns['sym']（CJS 命名空间 require 与 ESM namespace import 的主导消费形态）——
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

export async function buildGraph(rootDir) {
  rootDir = resolve(rootDir);
  const files = listFiles(rootDir);
  const parsed = files.map((f) => {
    const sf = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, scriptKind(f));
    return { file: f, sf, usedLocals: collectUsedLocals(sf), edges: extractEdges(sf, f) };
  });
  const edges = [];
  for (const p of parsed) {
    const nsLocals = new Set(p.edges.filter((e) => e.namespace && e.namespaceLocal).map((e) => e.namespaceLocal));
    const nsAccesses = collectNamespaceAccesses(p.sf, nsLocals);
    for (const e of p.edges) {
      const r = resolveSpecifier(e.specifier, p.file, rootDir);
      edges.push({
        ...e,
        target: r.target,
        resolved: r.resolved,
        external: r.external,
        usedLocals: p.usedLocals,
        nsAccesses: e.namespace ? nsAccesses : null,
      });
    }
  }
  return { rootDir, files, edges };
}

function edgeUsedSymbols(e) {
  // 返回该边中「导入且真实使用」的符号名集合（namespace 边返回其本地名以示部分可判）
  if (e.namespace) return e.namespaceLocal && e.usedLocals.has(e.namespaceLocal) ? new Set(['<namespace>']) : new Set();
  const out = new Set();
  for (const s of e.symbols) if (e.usedLocals.has(s.local)) out.add(s.imported);
  return out;
}

export function whoImports(graph, symbol) {
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

function isTestFile(f) {
  const base = f.split(sep).pop();
  return /\.test\.|\.spec\./.test(base) || f.split(sep).includes('test');
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

export function classifyEdges(graph, file) {
  const targetAbs = resolve(file);
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

// —— CLI（作为库被测试导入时不触发）——
async function main() {
  const [, , cmd, arg] = process.argv;
  if (!cmd || !arg) {
    console.error('用法: node scripts/symbol-graph.mjs who-imports <symbol> | classify-edges <file>');
    process.exit(1);
  }
  const graph = await buildGraph(process.cwd());
  if (cmd === 'who-imports') {
    for (const h of whoImports(graph, arg)) {
      console.log(`${h.kind.padEnd(10)} ${h.file}  [${h.symbol}]  ${h.specifier} -> ${h.target ?? (h.external ? '(external)' : 'UNRESOLVED')}`);
    }
  } else if (cmd === 'classify-edges') {
    const r = classifyEdges(graph, resolve(arg));
    for (const e of r.exports) {
      const imp = e.usedBy.map((u) => u.file).join(', ') || '-';
      console.log(`${e.status.padEnd(10)} ${r.file}::${e.name}  <- ${imp}${e.importedByUnused.length ? `  (导入未用: ${e.importedByUnused.map((u) => u.file).join(', ')})` : ''}`);
    }
    for (const o of r.outbound) {
      console.log(`  out ${o.kind} ${o.specifier ?? '(unresolved)'} -> ${o.target ?? (o.external ? '(external)' : 'UNRESOLVED')}  used=[${o.usedSymbols.join(', ')}]`);
    }
  } else {
    console.error(`未知命令: ${cmd}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
