"use strict";

const path = require("path");

function resolveDiagnosticRedactionModule({
  isPackaged = false,
  resourcesPath = process.resourcesPath,
} = {}) {
  if (isPackaged && resourcesPath) {
    return path.join(resourcesPath, "core", "shared-backend", "redaction.js");
  }
  return path.join(__dirname, "..", "core", "shared-backend", "redaction.js");
}

let isPackaged = false;
try {
  isPackaged = Boolean(require("electron")?.app?.isPackaged);
} catch {
  // Plain Node tests and backend processes do not expose Electron's app API.
}

const redaction = require(
  resolveDiagnosticRedactionModule({ isPackaged, resourcesPath: process.resourcesPath }),
);

module.exports = { ...redaction, resolveDiagnosticRedactionModule };
