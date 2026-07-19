import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import extractZip from "extract-zip";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createResultArchive } = require("../core/r-server/helpers/result-archive.js");

test("createResultArchive packages completed outputs without including itself", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "biof3-result-archive-"));
  const outputDir = path.join(root, "output");
  const extracted = path.join(root, "extracted");
  fs.mkdirSync(outputDir);
  fs.writeFileSync(path.join(outputDir, "report.html"), "<html>ok</html>");
  fs.writeFileSync(path.join(outputDir, "table.csv"), "gene,value\nA,1\n");

  try {
    const result = await createResultArchive(outputDir);
    assert.equal(result.fileName, "all_results.zip");
    assert.ok(result.size > 0);
    await extractZip(result.path, { dir: extracted });
    assert.equal(fs.readFileSync(path.join(extracted, "report.html"), "utf8"), "<html>ok</html>");
    assert.equal(fs.readFileSync(path.join(extracted, "table.csv"), "utf8"), "gene,value\nA,1\n");
    assert.equal(fs.existsSync(path.join(extracted, "all_results.zip")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("result archive loads ESM-only archiver without a CommonJS require", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "core/r-server/helpers/result-archive.js"),
    "utf8",
  );
  assert.match(source, /await import\(["']archiver["']\)/);
  assert.doesNotMatch(source, /require\(["']archiver["']\)/);
});
