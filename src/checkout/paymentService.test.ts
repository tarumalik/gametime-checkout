import { reconcilePayment, submitPayment, type PaymentDeps } from './paymentService';
import { createInMemoryPendingStore } from './pendingPaymentStore';
import type { PaymentsApi, PaymentRecord } from '../api/paymentsApi';

const record = (status: PaymentRecord['status']): PaymentRecord => ({
  paymentId: 'pay_1',
  idempotencyKey: 'key-1',
  orderId: 'ord_1',
  amountCents: 10500,
  method: 'card',
  status,
});

function setup(api: Partial<PaymentsApi>) {
  const store = createInMemoryPendingStore();
  const deps: PaymentDeps = {
    api: { createPayment: jest.fn(), getPayment: jest.fn(), createAffirmCheckout: jest.fn(), ...api },
    store,
    newIdempotencyKey: () => 'key-1',
    sleep: async () => {},
  };
  return { deps, store };
}

const input = { orderId: 'ord_1', amountCents: 10500, method: 'card' as const, paymentToken: 'tok' };

test('persists the attempt BEFORE calling the API, clears it after success', async () => {
  let phaseSeenByApi: string | undefined;
  const { deps, store } = setup({
    createPayment: jest.fn(async () => {
      phaseSeenByApi = store.current?.phase; // peek at the "disk" mid-request
      return { ok: true as const, value: record('succeeded') };
    }),
  });
  const outcome = await submitPayment(deps, input, () => {});
  expect(phaseSeenByApi).toBe('submitted'); // already on disk when the request ran
  expect(outcome.kind).toBe('succeeded');
  expect(store.current).toBeNull(); // final answer known: nothing left to recover
});

test('reports the key via onSubmitted before the request resolves', async () => {
  const keys: string[] = [];
  const { deps } = setup({
    createPayment: jest.fn(async () => ({ ok: true as const, value: record('succeeded') })),
  });
  await submitPayment(deps, input, (k) => keys.push(k));
  expect(keys).toEqual(['key-1']);
});

test('timeout keeps the pending record and reports unknown', async () => {
  const { deps, store } = setup({
    createPayment: jest.fn(async () => ({
      ok: false as const,
      error: { kind: 'unknown_outcome' as const, reason: 'timeout' as const },
    })),
  });
  expect(await submitPayment(deps, input, () => {})).toEqual({ kind: 'unknown', idempotencyKey: 'key-1' });
  expect(store.current?.phase).toBe('submitted'); // kept: reconcile needs it
});

test('4xx rejection clears the record: not charged', async () => {
  const { deps, store } = setup({
    createPayment: jest.fn(async () => ({
      ok: false as const,
      error: { kind: 'rejected' as const, httpStatus: 422, code: 'x', message: 'Nope' },
    })),
  });
  expect(await submitPayment(deps, input, () => {})).toEqual({ kind: 'not_charged', message: 'Nope' });
  expect(store.current).toBeNull();
});

test('409 order_already_paid resolves to the payment that won, not an error', async () => {
  const paid = record('succeeded');
  const { deps, store } = setup({
    createPayment: jest.fn(async () => ({
      ok: false as const,
      error: {
        kind: 'rejected' as const,
        httpStatus: 409,
        code: 'order_already_paid',
        message: 'This order already has a payment.',
        payment: paid,
      },
    })),
  });
  const outcome = await submitPayment(deps, input, () => {});
  expect(outcome).toEqual({ kind: 'succeeded', payment: paid });
  expect(store.current).toBeNull();
});

test('409 order_already_paid without the record still tells the truth', async () => {
  const { deps } = setup({
    createPayment: jest.fn(async () => ({
      ok: false as const,
      error: { kind: 'rejected' as const, httpStatus: 409, code: 'order_already_paid', message: 'This order already has a payment.' },
    })),
  });
  const outcome = await submitPayment(deps, input, () => {});
  expect(outcome).toEqual({
    kind: 'not_charged',
    message: 'This order was already paid. You have not been charged again.',
  });
});

test('409 payment_in_progress asks the fan to wait, not to retry', async () => {
  const { deps } = setup({
    createPayment: jest.fn(async () => ({
      ok: false as const,
      error: { kind: 'rejected' as const, httpStatus: 409, code: 'payment_in_progress', message: 'This order already has a payment.' },
    })),
  });
  const outcome = await submitPayment(deps, input, () => {});
  expect(outcome).toEqual({
    kind: 'not_charged',
    message: 'A payment for this order is already in progress. Please wait a moment.',
  });
});

test('a declined card settles: record cleared, outcome carries the decline', async () => {
  const { deps, store } = setup({
    createPayment: jest.fn(async () => ({ ok: true as const, value: record('declined') })),
  });
  const outcome = await submitPayment(deps, input, () => {});
  expect(outcome.kind).toBe('declined');
  expect(store.current).toBeNull();
});

test('reconcile polls through "processing" until final', async () => {
  const getPayment = jest
    .fn()
    .mockResolvedValueOnce({ ok: true, value: record('processing') })
    .mockResolvedValueOnce({ ok: true, value: record('succeeded') });
  const { deps } = setup({ getPayment });
  expect((await reconcilePayment(deps, 'key-1')).kind).toBe('succeeded');
  expect(getPayment).toHaveBeenCalledTimes(2);
});

test('reconcile: a PERSISTENT 404 means never received, not charged', async () => {
  const getPayment = jest.fn(async () => ({ ok: true as const, value: null }));
  const { deps, store } = setup({ getPayment });
  await store.save({ phase: 'submitted', method: 'card', orderId: 'o', amountCents: 1, idempotencyKey: 'key-1', createdAt: 0 });
  const outcome = await reconcilePayment(deps, 'key-1', { attempts: 3, intervalMs: 0 });
  expect(outcome.kind).toBe('not_charged');
  expect(getPayment).toHaveBeenCalledTimes(3); // asked until the end, never on first sight
  expect(store.current).toBeNull();
});

test('reconcile: a 404 that turns into succeeded is the race, caught', async () => {
  // Kill right after the POST left: the first GET outruns the landing POST.
  const getPayment = jest
    .fn()
    .mockResolvedValueOnce({ ok: true, value: null })
    .mockResolvedValueOnce({ ok: true, value: record('succeeded') });
  const { deps, store } = setup({ getPayment });
  await store.save({ phase: 'submitted', method: 'card', orderId: 'o', amountCents: 1, idempotencyKey: 'key-1', createdAt: 0 });
  expect((await reconcilePayment(deps, 'key-1')).kind).toBe('succeeded');
  expect(store.current).toBeNull();
});

test('reconcile: a 404 followed by failed reads stays unknown, record kept', async () => {
  // The POST may have landed after the 404; without a final answer from the
  // server, "not charged" would be a guess.
  const getPayment = jest
    .fn()
    .mockResolvedValueOnce({ ok: true, value: null })
    .mockResolvedValue({ ok: false, error: { kind: 'unknown_outcome', reason: 'network' } });
  const { deps, store } = setup({ getPayment });
  await store.save({ phase: 'submitted', method: 'card', orderId: 'o', amountCents: 1, idempotencyKey: 'key-1', createdAt: 0 });
  expect(await reconcilePayment(deps, 'key-1', { attempts: 3, intervalMs: 0 })).toEqual({ kind: 'still_unknown' });
  expect(store.current).not.toBeNull();
});

test('reconcile gives up as still_unknown and keeps the record', async () => {
  const { deps, store } = setup({
    getPayment: jest.fn(async () => ({
      ok: false as const,
      error: { kind: 'unknown_outcome' as const, reason: 'network' as const },
    })),
  });
  await store.save({ phase: 'submitted', method: 'card', orderId: 'o', amountCents: 1, idempotencyKey: 'key-1', createdAt: 0 });
  expect(await reconcilePayment(deps, 'key-1', { attempts: 3, intervalMs: 0 })).toEqual({ kind: 'still_unknown' });
  expect(store.current).not.toBeNull();
});

test('reconcile never calls createPayment (it can never charge)', async () => {
  const createPayment = jest.fn();
  const { deps } = setup({
    createPayment,
    getPayment: jest.fn(async () => ({ ok: true as const, value: record('succeeded') })),
  });
  await reconcilePayment(deps, 'key-1');
  expect(createPayment).not.toHaveBeenCalled();
});
