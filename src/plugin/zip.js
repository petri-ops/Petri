// ============================================================
// src/plugin/zip.js — zip extraction wrapper
//
// Extracted from src/plugin-manager.js by BLOCK-9.2 PHASE 3.
// Original location: lines 434-438.
//
// Pure Node implementation wrapper around extract-zip, avoiding any
// dependency on system unzip / PowerShell.
// ============================================================

const fs = require('fs');
const extractZip = require('extract-zip');

async function extractZipFile(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  await extractZip(zipPath, { dir: destDir });
  return destDir;
}

module.exports = {
  extractZipFile,
};
