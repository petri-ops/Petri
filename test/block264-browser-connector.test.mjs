import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// BLOCK-264（C-40）浏览器连接器垂直切片：
// opt-in 会话 / 动作白名单 / 私网硬拒 / mutating 审批门 / 有界返回

const bc = require('../core/petri-server/helpers/browser-connector.js');

const performOk = async (params) => ({ ok: true, result: params });

test.beforeEach ? null : null;
function freshConnect(opts) {
  bc.disconnect();
  return bc.connect(opts || {});
}

test('BLOCK-264 connect — opt-in 会话：未连接时一切动作拒绝', () => {
  bc.disconnect();
  const refused = bc.status();
  assert.equal(refused.connected, false);
  return bc.act({ action: 'read_text' }, { perform: performOk }).then((r) => {
    assert.equal(r.ok, false);
    assert.equal(r.error, 'browser_not_connected');
  });
});

test('BLOCK-264 connect — 建会话回 sessionId + TTL；status 如实', () => {
  const c = freshConnect();
  assert.equal(c.ok, true);
  assert.match(c.sessionId, /^bc-/);
  const st = bc.status();
  assert.equal(st.connected, true);
  assert.equal(st.sessionId, c.sessionId);
  assert.equal(st.actionsPerformed, 0);
});

test('BLOCK-264 act — 动作白名单外拒绝', async () => {
  freshConnect();
  const r = await bc.act({ action: 'execute_js' }, { perform: performOk });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'action_not_allowed');
});

test('BLOCK-264 act — navigate 私网/环回/云元数据硬拒（公网放行）', async () => {
  freshConnect();
  for (const url of [
    'http://127.0.0.1:3000/x',
    'http://localhost/admin',
    'http://192.168.1.10/router',
    'http://169.254.169.254/latest/meta-data',
    'http://100.64.1.1/cgnat',
    'ftp://example.com/file',
  ]) {
    const r = await bc.act({ action: 'navigate', url }, { perform: performOk });
    assert.equal(r.ok, false, `${url} 应拒绝`);
    assert.ok(['web_url_private_host', 'scheme_not_allowed'].includes(r.error), `${url} error=${r.error}`);
  }
  const ok = await bc.act({ action: 'navigate', url: 'https://example.com/page' }, { perform: performOk });
  assert.equal(ok.ok, true);
  assert.equal(bc.status().lastUrl, 'https://example.com/page');
});

test('BLOCK-264 act — allowedOrigins 非空时白名单外 origin 拒绝', async () => {
  freshConnect({ allowedOrigins: ['https://docs.example.com'] });
  const denied = await bc.act({ action: 'navigate', url: 'https://other.com/x' }, { perform: performOk });
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'origin_not_allowed');
  const allowed = await bc.act({ action: 'navigate', url: 'https://docs.example.com/guide' }, { perform: performOk });
  assert.equal(allowed.ok, true);
});

test('BLOCK-264 act — mutating（click/fill）无 ackToken 拒绝；带 token 放行并计数', async () => {
  freshConnect();
  const noAck = await bc.act({ action: 'click', selector: '#submit' }, { perform: performOk });
  assert.equal(noAck.ok, false);
  assert.equal(noAck.error, 'ack_token_required');

  const withAck = await bc.act({ action: 'fill', selector: '#q', text: 'hello', ackToken: 'ack-1' }, { perform: performOk });
  assert.equal(withAck.ok, true);
  assert.equal(bc.status().actionsPerformed, 1);
});

test('BLOCK-264 act — read_text 超 20k 截断标 truncated；transport 缺失如实报错', async () => {
  freshConnect();
  const long = await bc.act({ action: 'read_text' }, {
    perform: async () => ({ ok: true, result: 'x'.repeat(25000) }),
  });
  assert.equal(long.ok, true);
  assert.equal(long.result.truncated, true);
  assert.equal(long.result.text.length, 20000);

  const noTransport = await bc.act({ action: 'read_text' }, {});
  assert.equal(noTransport.ok, false);
  assert.equal(noTransport.error, 'transport_unavailable');
});

test('BLOCK-264 disconnect — 断开后动作恢复拒绝', async () => {
  freshConnect();
  bc.disconnect();
  const r = await bc.act({ action: 'read_text' }, { perform: performOk });
  assert.equal(r.error, 'browser_not_connected');
});
