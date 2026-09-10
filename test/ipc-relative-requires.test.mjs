// BLOCK-75 P0 抓真修回归门禁 —— src/ipc/ 抽取家族的相对 require 必须全部可解析。
//
// 缺陷史：BLOCK-9.1 把 main.js 的 setup* 抽到 src/ipc/ 时，diagnostic.js 的
// `require("./diagnostic-redaction")` 没跟改成 `../diagnostic-redaction`（模块本体在
// src/diagnostic-redaction.js）。该 require 位于 handler 函数体内——主进程照常启动，
// 只有「导出诊断日志」链路每次调用即死（BLOCK-75 P0 实机探测首次暴露）。
// 本门禁把该缺陷类机械化：src/ipc/*.js 的所有相对 require 必须解析到真实文件。
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const IPC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "ipc");

function resolvesToFile(target) {
  if (fs.existsSync(target) && fs.statSync(target).isFile()) return true;
  for (const ext of [".js", ".json", ".node"]) {
    if (fs.existsSync(target + ext) && fs.statSync(target + ext).isFile()) return true;
  }
  return fs.existsSync(path.join(target, "index.js"));
}

test("src/ipc/*.js 全部相对 require 可解析（抽取家族路径漂移门禁）", () => {
  const broken = [];
  for (const file of fs.readdirSync(IPC_DIR).filter((f) => f.endsWith(".js"))) {
    const source = fs.readFileSync(path.join(IPC_DIR, file), "utf8");
    for (const m of source.matchAll(/require\((['"])(\.\.?\/[^'"]+)\1\)/g)) {
      const target = path.resolve(IPC_DIR, m[2]);
      if (!resolvesToFile(target)) broken.push(`${file} -> ${m[2]}`);
    }
  }
  assert.deepEqual(broken, []);
});
