// BLOCK-75 P0 抓真修回归门禁 —— 抽取家族的相对 require 必须全部可解析。
//
// 缺陷史：BLOCK-9.1 把 main.js 的 setup* 抽到 src/ipc/ 时，diagnostic.js 的
// `require("./diagnostic-redaction")` 没跟改成 `../diagnostic-redaction`（模块本体在
// src/diagnostic-redaction.js）。该 require 位于 handler 函数体内——主进程照常启动，
// 只有「导出诊断日志」链路每次调用即死（BLOCK-75 P0 实机探测首次暴露）。
// BLOCK-511 S1.5 — 扫描范围从 src/ipc/*.js 扩到 src 下全部 .js（preload.js 自包含规则不改）：
// 修复前 src/main.js 的 require("../_mapSkillRuntimeStatus") 解析到仓库根即报红。
// 本门禁把该缺陷类机械化：src 下所有 .js 的相对 require 必须解析到真实文件。
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

function resolvesToFile(target) {
  if (fs.existsSync(target) && fs.statSync(target).isFile()) return true;
  for (const ext of [".js", ".json", ".node"]) {
    if (fs.existsSync(target + ext) && fs.statSync(target + ext).isFile()) return true;
  }
  return fs.existsSync(path.join(target, "index.js"));
}

function collectJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

test("src 下全部 .js 相对 require 可解析（抽取家族路径漂移门禁，含 src/main.js）", () => {
  const files = collectJsFiles(SRC_DIR);
  const broken = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    // 注入式 require（函数形参 { require } = require / require = require）解析基准是
    // 调用方注入器，非文件目录；静态路径判定不适用，跳过（调用点 try/catch fail-soft）。
    const injected = /\brequire\b\s*=\s*require\b|\{\s*require\s*\}\s*=\s*require\b/.test(source);
    if (injected) continue;
    // 正则禁止跨行：避免把注释里换行的 `require('./plugin-\n * manager')` 误判为路径。
    for (const m of source.matchAll(/require\((['"])(\.\.?\/[^'"\n]+)\1\)/g)) {
      const target = path.resolve(path.dirname(file), m[2]);
      if (!resolvesToFile(target)) broken.push(`${path.relative(SRC_DIR, file)} -> ${m[2]}`);
    }
  }
  assert.deepEqual(broken, []);
});
