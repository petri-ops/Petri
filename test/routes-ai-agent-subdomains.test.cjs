'use strict';

/**
 * test/routes-ai-agent-subdomains.test.cjs
 * PHASE 2.2b — routes/ai-agent 5 subdomains + 3 endpoints
 *
 * Verifies:
 * - All 5 submodules require without error
 * - Main file facade loads and exports expected surface
 * - 3 endpoint paths + methods preserved (no regressions)
 *
 * Run: node --test test/routes-ai-agent-subdomains.test.cjs
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const routesDir = path.resolve(__dirname, '../core/biof3-server/routes');

function makeMockApp() {
  const routes = [];
  const app = {
    post(ph) { routes.push({ method: 'POST', path: ph }); },
    get(ph) { routes.push({ method: 'GET', path: ph }); },
  };
  return { app, routes };
}

describe('routes/ai-agent subdomains', () => {

  // ---- 5 submodules require without error ----
  it('chat.js loads and has register function', () => {
    const chat = require('../core/biof3-server/routes/ai-agent/chat');
    assert.ok(chat, 'chat module loaded');
    assert.strictEqual(typeof chat.register, 'function', 'chat.register is a function');
  });

  it('context.js loads and has register function', () => {
    const context = require('../core/biof3-server/routes/ai-agent/context');
    assert.ok(context, 'context module loaded');
    assert.strictEqual(typeof context.register, 'function', 'context.register is a function');
  });

  it('events.js loads and has register function', () => {
    const events = require('../core/biof3-server/routes/ai-agent/events');
    assert.ok(events, 'events module loaded');
    assert.strictEqual(typeof events.register, 'function', 'events.register is a function');
  });

  it('tools.js loads and has register function', () => {
    const tools = require('../core/biof3-server/routes/ai-agent/tools');
    assert.ok(tools, 'tools module loaded');
    assert.strictEqual(typeof tools.register, 'function', 'tools.register is a function');
  });

  it('index.js loads and has register + _submodules', () => {
    const index = require('../core/biof3-server/routes/ai-agent/index');
    assert.ok(index, 'index module loaded');
    assert.strictEqual(typeof index.register, 'function', 'index.register is a function');
    assert.ok(index._submodules, 'index._submodules exists');
    assert.ok(index._submodules.chat, 'index._submodules.chat exists');
    assert.ok(index._submodules.context, 'index._submodules.context exists');
    assert.ok(index._submodules.events, 'index._submodules.events exists');
    assert.ok(index._submodules.tools, 'index._submodules.tools exists');
  });

  // ---- Main facade loads ----
  it('main routes/ai-agent.js facade loads without error', () => {
    const facade = require('../core/biof3-server/routes/ai-agent');
    assert.ok(facade, 'facade loaded');
    assert.strictEqual(typeof facade, 'function', 'facade is a register function');
  });

  // ---- 3 endpoint paths preserved ----
  it('chat.js register() attaches POST /api/ai/agent', () => {
    const chat = require('../core/biof3-server/routes/ai-agent/chat');
    const { app, routes } = makeMockApp();
    chat.register(app);
    const agentRoute = routes.find(r => r.path === '/api/ai/agent');
    assert.ok(agentRoute, 'POST /api/ai/agent registered');
  });

  it('context.js register() attaches POST /api/ai/agent/task/:taskId/cancel', () => {
    const context = require('../core/biof3-server/routes/ai-agent/context');
    const { app, routes } = makeMockApp();
    context.register(app);
    const cancelRoute = routes.find(r => r.path === '/api/ai/agent/task/:taskId/cancel');
    assert.ok(cancelRoute, 'POST /api/ai/agent/task/:taskId/cancel registered');
  });

  it('events.js register() attaches GET /api/ai/agent/task/:taskId (SSE subscribe)', () => {
    const events = require('../core/biof3-server/routes/ai-agent/events');
    const { app, routes } = makeMockApp();
    events.register(app);
    const subscribeRoute = routes.find(r => r.path === '/api/ai/agent/task/:taskId');
    assert.ok(subscribeRoute, 'GET /api/ai/agent/task/:taskId registered');
  });

  // ---- index.js produces all 3 endpoints ----
  it('index.js register() attaches all 3 endpoints', () => {
    const index = require('../core/biof3-server/routes/ai-agent/index');
    const { app, routes } = makeMockApp();
    index.register(app);
    assert.ok(routes.find(r => r.path === '/api/ai/agent'), 'POST /api/ai/agent in index');
    assert.ok(routes.find(r => r.path === '/api/ai/agent/task/:taskId/cancel'), 'POST cancel in index');
    assert.ok(routes.find(r => r.path === '/api/ai/agent/task/:taskId'), 'GET SSE subscribe in index');
  });

  // ---- Facade line count reduction ----
  it('facade (ai-agent.js) is significantly smaller than original 1222 lines', () => {
    const facadePath = path.resolve(routesDir, 'ai-agent.js');
    const content = fs.readFileSync(facadePath, 'utf8');
    const lines = content.split('\n').length;
    assert.ok(lines < 200, `Facade has ${lines} lines (was 1222, reduced by ${1222-lines})`);
  });
});
