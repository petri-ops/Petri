import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  redactSensitiveText,
  resolveDiagnosticRedactionModule,
} = require("../src/diagnostic-redaction.js");

test("diagnostic redaction resolves the packaged core resource path", () => {
  assert.equal(
    resolveDiagnosticRedactionModule({
      isPackaged: true,
      resourcesPath: "/Applications/BioF3.app/Contents/Resources",
    }),
    "/Applications/BioF3.app/Contents/Resources/core/shared-backend/redaction.js",
  );
  assert.match(
    resolveDiagnosticRedactionModule({ isPackaged: false }),
    /desktop\/core\/shared-backend\/redaction\.js$/,
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
