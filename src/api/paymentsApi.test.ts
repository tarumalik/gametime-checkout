import { createPaymentsApi, type FetchLike } from './paymentsApi';

const req = {
  orderId: 'ord_1',
  amountCents: 10500,
  currency: 'USD' as const,
  method: 'card' as const,
  paymentToken: 'tok',
};

const respond = (status: number, body: unknown): FetchLike => jest.fn(async () => ({ status, json: async () => body }));
const api = (fetchImpl: FetchLike, timeoutMs = 1000) => createPaymentsApi({ baseUrl: 'http://api.test', fetchImpl, timeoutMs });

test('sends the Idempotency-Key header', async () => {
  const fetchImpl = respond(200, { status: 'succeeded' });
  await api(fetchImpl).createPayment(req, 'key-1');
  expect(fetchImpl).toHaveBeenCalledWith(
    'http://api.test/v1/payments',
    expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'Idempotency-Key': 'key-1' }) }),
  );
});

test('402 is a result (declined), not an error', async () => {
  const r = await api(respond(402, { status: 'declined', declineCode: 'generic_decline' })).createPayment(req, 'k');
  expect(r).toEqual({ ok: true, value: { status: 'declined', declineCode: 'generic_decline' } });
});

test('4xx is rejected: definitely not charged', async () => {
  const r = await api(respond(422, { error: { code: 'affirm_ineligible', message: 'nope' } })).createPayment(req, 'k');
  expect(r).toEqual({
    ok: false,
    error: { kind: 'rejected', httpStatus: 422, code: 'affirm_ineligible', message: 'nope' },
  });
});

test('5xx is unknown outcome: maybe charged', async () => {
  const r = await api(respond(500, {})).createPayment(req, 'k');
  expect(r).toEqual({ ok: false, error: { kind: 'unknown_outcome', reason: 'server_error' } });
});

test('network failure is unknown outcome', async () => {
  const r = await api(
    jest.fn(async () => {
      throw new Error('offline');
    }),
  ).createPayment(req, 'k');
  expect(r).toEqual({ ok: false, error: { kind: 'unknown_outcome', reason: 'network' } });
});

test('a hanging request times out as unknown outcome', async () => {
  const hanging: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const r = await api(hanging, 20).createPayment(req, 'k');
  expect(r).toEqual({ ok: false, error: { kind: 'unknown_outcome', reason: 'timeout' } });
});

test('GET 404 means never received (null), not an error', async () => {
  expect(await api(respond(404, {})).getPayment('k')).toEqual({ ok: true, value: null });
});

test('a non-JSON body still resolves by status code', async () => {
  const fetchImpl: FetchLike = jest.fn(async () => ({
    status: 500,
    json: async () => {
      throw new Error('empty body');
    },
  }));
  const r = await api(fetchImpl).createPayment(req, 'k');
  expect(r).toEqual({ ok: false, error: { kind: 'unknown_outcome', reason: 'server_error' } });
});

test('extra headers (dev menu mock outcome) ride along on every call', async () => {
  const fetchImpl = respond(200, {});
  await createPaymentsApi({
    baseUrl: 'http://api.test',
    fetchImpl,
    extraHeaders: () => ({ 'X-Mock-Outcome': 'decline' }),
  }).getPayment('k');
  expect(fetchImpl).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ headers: expect.objectContaining({ 'X-Mock-Outcome': 'decline' }) }),
  );
});
