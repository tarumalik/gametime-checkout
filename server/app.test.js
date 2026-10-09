const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./app');

async function startServer(options = {}) {
  const server = createApp({ defaultDelayMs: 0, quiet: true, hangMs: 50, ...options }).listen(0); // port 0 = any free port
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

function pay(base, key, overrides = {}, headers = {}) {
  return fetch(`${base}/v1/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}), ...headers },
    body: JSON.stringify({
      orderId: 'ord_1',
      amountCents: 10500,
      currency: 'USD',
      method: 'card',
      paymentToken: 'tok_card_visa_4242',
      ...overrides,
    }),
  });
}

test('approves a valid card payment', async (t) => {
  const { base, close } = await startServer();
  t.after(close);
  const res = await pay(base, 'k1');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'succeeded');
});

test('replaying the same key returns the same payment, charges once, and says so', async (t) => {
  const { base, close } = await startServer();
  t.after(close);
  const first = await pay(base, 'k1');
  const second = await pay(base, 'k1');
  assert.equal(first.headers.get('idempotent-replayed'), null);
  assert.equal(second.headers.get('idempotent-replayed'), 'true');
  assert.equal((await first.json()).paymentId, (await second.json()).paymentId);
  const all = (await (await fetch(`${base}/v1/_debug/payments`)).json()).payments;
  assert.equal(all.length, 1);
});

test('concurrent requests with the same key share one charge', async (t) => {
  const { base, close } = await startServer({ defaultDelayMs: 50 });
  t.after(close);
  const [a, b] = await Promise.all([pay(base, 'k1'), pay(base, 'k1')]);
  assert.equal((await a.json()).paymentId, (await b.json()).paymentId);
});

test('same key with a different body is rejected', async (t) => {
  const { base, close } = await startServer();
  t.after(close);
  await pay(base, 'k1');
  const res = await pay(base, 'k1', { amountCents: 999 });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error.code, 'idempotency_key_reused');
});

test('a paid order cannot be charged again, and the 409 carries the winner', async (t) => {
  const { base, close } = await startServer();
  t.after(close);
  const first = await (await pay(base, 'k1')).json();
  const res = await pay(base, 'k2');
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error.code, 'order_already_paid');
  assert.equal(body.payment.paymentId, first.paymentId);
  assert.equal(body.payment.status, 'succeeded');
});

test('a declined order can be retried with a new key', async (t) => {
  const { base, close } = await startServer();
  t.after(close);
  await pay(base, 'k1', { paymentToken: 'tok_card_visa_0002' });
  const res = await pay(base, 'k2');
  assert.equal(res.status, 200);
});

test('declines the 0002 token with 402, card_declined / generic_decline', async (t) => {
  const { base, close } = await startServer();
  t.after(close);
  const res = await pay(base, 'k1', { paymentToken: 'tok_card_visa_0002' });
  assert.equal(res.status, 402);
  const body = await res.json();
  assert.equal(body.code, 'card_declined');
  assert.equal(body.declineCode, 'generic_decline');
});

test('declines the 9995 token with insufficient_funds', async (t) => {
  const { base, close } = await startServer();
  t.after(close);
  const res = await pay(base, 'k1', { paymentToken: 'tok_card_visa_9995' });
  assert.equal(res.status, 402);
  assert.equal((await res.json()).declineCode, 'insufficient_funds');
});

test('requires an Idempotency-Key', async (t) => {
  const { base, close } = await startServer();
  t.after(close);
  assert.equal((await pay(base, null)).status, 400);
});

test('GET reports unknown keys as 404 and known keys as the record', async (t) => {
  const { base, close } = await startServer();
  t.after(close);
  assert.equal((await fetch(`${base}/v1/payments/nope`)).status, 404);
  const created = await (await pay(base, 'k1')).json();
  const fetched = await (await fetch(`${base}/v1/payments/k1`)).json();
  assert.equal(fetched.paymentId, created.paymentId);
});

test('simulated server error records nothing (GET 404 = never charged)', async (t) => {
  const { base, close } = await startServer();
  t.after(close);
  const res = await pay(base, 'k1', {}, { 'X-Mock-Outcome': 'server_error' });
  assert.equal(res.status, 500);
  assert.equal((await fetch(`${base}/v1/payments/k1`)).status, 404);
});

test('forced timeout still records the charge (found by a later GET)', async (t) => {
  const { base, close } = await startServer({ hangMs: 30 });
  t.after(close);
  await pay(base, 'k1', {}, { 'X-Mock-Outcome': 'timeout' });
  const fetched = await (await fetch(`${base}/v1/payments/k1`)).json();
  assert.equal(fetched.status, 'succeeded');
});

test('Affirm: rejected at exactly $100, full flow above $100', async (t) => {
  const { base, close } = await startServer();
  t.after(close);

  const create = (amountCents) =>
    fetch(`${base}/v1/affirm/checkouts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: 'ord_a', amountCents, redirectUri: 'exp://127.0.0.1:8081/--/affirm-return' }),
    });
  assert.equal((await create(10000)).status, 422);

  const { redirectUrl } = await (await create(10500)).json();
  const html = await (await fetch(redirectUrl)).text();
  const token = html.match(/checkout_token=([^"&]+)/)[1];
  const res = await pay(base, 'k-aff', { orderId: 'ord_a', method: 'affirm', paymentToken: token, amountCents: 10500 });
  assert.equal(res.status, 200);
});

test('an Affirm token cannot be used twice', async (t) => {
  const { base, close } = await startServer();
  t.after(close);
  const created = await (
    await fetch(`${base}/v1/affirm/checkouts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: 'ord_b', amountCents: 10500, redirectUri: 'exp://x/--/affirm-return' }),
    })
  ).json();
  const html = await (await fetch(created.redirectUrl)).text();
  const token = html.match(/checkout_token=([^"&]+)/)[1];
  await pay(base, 'kb1', { orderId: 'ord_b', method: 'affirm', paymentToken: token });
  // Different order, same token: must be refused even before the paid-order rule.
  const reuse = await pay(base, 'kb2', { orderId: 'ord_c', method: 'affirm', paymentToken: token });
  assert.equal(reuse.status, 422);
});

test('mock Affirm page preserves the client state nonce on confirm AND cancel links', async (t) => {
  const { base, close } = await startServer();
  t.after(close);
  const { redirectUrl } = await (
    await fetch(`${base}/v1/affirm/checkouts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: 'ord_s',
        amountCents: 10500,
        redirectUri: 'exp://127.0.0.1:8081/--/affirm-return?state=nonce-abc',
      }),
    })
  ).json();
  const html = await (await fetch(redirectUrl)).text();
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  const confirm = links.find((l) => l.includes('checkout_token='));
  const cancel = links.find((l) => l.includes('cancelled=1'));
  assert.ok(confirm.includes('state=nonce-abc'), 'confirm link keeps state');
  assert.ok(cancel.includes('state=nonce-abc'), 'cancel link keeps state');
});
