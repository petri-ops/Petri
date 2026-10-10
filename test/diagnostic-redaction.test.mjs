import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  redactSensitiveText,
  resolveDiagnosticRedactionModule,
} = require("../src/diagnostic-redaction.js");

test("diagnostic redaction resolves the packaged core resource path", () => {
  const resourcesPath = "/Applications/Petri.app/Contents/Resources";
  assert.equal(
    resolveDiagnosticRedactionModule({ isPackaged: true, resourcesPath }),
    path.join(resourcesPath, "core", "shared-backend", "redaction.js"),
  );
  // Normalize separators so the trailing-suffix assertion is platform-independent.
  // dev 路径断言只锚 resolver 的真实承诺（src/diagnostic-redaction.js:12 =
  // <repo>/core/shared-backend/redaction.js，由本测试文件位置等价推导），
  // 不锚检出目录名——历史字面量 `desktop/` 把仓库改名/换位（本仓 checkout=
  // petri-desktop-fresh）变成与环境耦合的确定性红，与本测试语义无关。
  const devPath = resolveDiagnosticRedactionModule({ isPackaged: false });
  assert.equal(
    devPath,
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "core", "shared-backend", "redaction.js"),
  );
});

test("diagnostic redaction removes credential-bearing headers and fields", () => {
  const source = [
    "Authorization: Bearer top-secret-token",
    "x-api-key=provider-secret",
    '{"apiKey":"json-secret","remoteComputeToken":"compute-secret","contextToken":"context-secret"}',
    "https://example.test/path?api_key=query-secret&contextToken=query-context-secret&mode=check",
    "provider sk-abcdefghijklmnopqrstuvwxyz123456",
  ].join("\n");

  const redacted = redactSensitiveText(source);
  for (const secret of [
    "top-secret-token",
    "provider-secret",
    "json-secret",
    "compute-secret",
    "context-secret",
    "query-secret",
    "query-context-secret",
    "sk-abcdefghijklmnopqrstuvwxyz123456",
  ]) {
    assert.equal(redacted.includes(secret), false);
  }
  assert.ok(redacted.includes("[REDACTED]"));
});

test("diagnostic redaction does not mistake task identifiers for provider keys", () => {
  const taskPath = "/tmp/task-12345678-1234-1234-1234-123456789012/run_task.R";
  assert.equal(redactSensitiveText(taskPath), taskPath);
});
