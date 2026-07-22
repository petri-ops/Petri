import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('ai settings cache reloads changes written by another desktop process', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-ai-settings-'));
  const settingsFile = path.join(dir, 'ai-settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify({ model_fallback_enabled: false }));
  const modulePath = path.resolve('core/r-server/helpers/ai-settings.js');
  const script = `
    const fs = require('fs');
    const settings = require(${JSON.stringify(modulePath)});
    const first = settings.getAiSettings().model_fallback_enabled;
    const next = JSON.parse(fs.readFileSync(settings.SETTINGS_FILE, 'utf8'));
    next.model_fallback_enabled = true;
    next.model_fallback_bindings = { agent: ['backup-agent'] };
    next.model_profiles = [
      ...(next.model_profiles || []),
      { id: 'backup-agent', provider: 'deepseek', model: 'backup', capabilities: ['chat', 'tools'] }
    ];
    fs.writeFileSync(settings.SETTINGS_FILE, JSON.stringify(next, null, 2));
    const now = new Date(Date.now() + 1000);
    fs.utimesSync(settings.SETTINGS_FILE, now, now);
    const second = settings.getAiSettings();
    process.stdout.write(JSON.stringify({ first, enabled: second.model_fallback_enabled, bindings: second.model_fallback_bindings }));
  `;
  const child = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve('.'),
    env: { ...process.env, BIOF3_LOCAL_DATA_DIR: dir },
    encoding: 'utf8',
  });

  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), {
    first: false,
    enabled: true,
    bindings: { agent: ['backup-agent'] },
  });
});
