"use strict";

const fs = require("fs");
const path = require("path");

async function createResultArchive(outputDir, fileName = "all_results.zip") {
  if (!outputDir || !fs.existsSync(outputDir)) {
    throw new Error("result archive output directory does not exist");
  }
  const target = path.join(outputDir, fileName);
  const partial = `${target}.part`;
  fs.rmSync(partial, { force: true });

  // archiver v8 is ESM-only. Dynamic import keeps this CommonJS helper
  // compatible with Electron's Node 20 runtime as well as current Node.
  const { ZipArchive } = await import("archiver");
  const archive = new ZipArchive({ zlib: { level: 6 } });
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(partial, { flags: "wx" });
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    for (const entry of fs.readdirSync(outputDir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name === fileName || entry.name === `${fileName}.part`) {
        continue;
      }
      archive.file(path.join(outputDir, entry.name), { name: entry.name });
    }
    archive.finalize().catch(reject);
  });

  fs.renameSync(partial, target);
  return { fileName, path: target, size: fs.statSync(target).size };
}

module.exports = { createResultArchive };
