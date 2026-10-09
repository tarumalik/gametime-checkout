import {
  checkoutReducer as reduce,
  initialCheckoutState,
  isBusy,
  type CheckoutState,
} from './checkoutMachine';
import type { PaymentRecord } from '../api/paymentsApi';

const payment: PaymentRecord = {
  paymentId: 'pay_1',
  idempotencyKey: 'k1',
  orderId: 'ord_1',
  amountCents: 10500,
  method: 'card',
  status: 'succeeded',
};

// Launch starts at 'restoring' (the gate); most tests begin after it opens.
const idle = reduce(initialCheckoutState, { type: 'RESTORED' });
const run = (...events: Parameters<typeof reduce>[1][]) => events.reduce<CheckoutState>(reduce, idle);

test('launch starts locked: restoring is busy and ignores a Pay tap', () => {
  expect(initialCheckoutState.status).toBe('restoring');
  expect(isBusy(initialCheckoutState)).toBe(true);
  expect(reduce(initialCheckoutState, { type: 'AUTHORIZE_START', method: 'card' })).toBe(initialCheckoutState);
});

test('RESTORED opens the gate exactly once', () => {
  expect(idle).toEqual({ status: 'idle' });
  expect(reduce(idle, { type: 'RESTORED' })).toBe(idle); // ignored outside restoring
});

test('relaunch recovery goes straight from restoring to reconciling', () => {
  const s = reduce(initialCheckoutState, { type: 'RECONCILE_START', idempotencyKey: 'k1' });
  expect(s).toEqual({ status: 'reconciling', idempotencyKey: 'k1', stalled: false });
});

test('happy path: idle -> authorizing -> processing -> succeeded', () => {
  const s = run(
    { type: 'AUTHORIZE_START', method: 'apple_pay' },
    { type: 'SUBMITTED', idempotencyKey: 'k1' },
    { type: 'SUCCEEDED', payment },
  );
  expect(s).toEqual({ status: 'succeeded', payment });
});

test('a second tap while authorizing is ignored (same object back)', () => {
  const s = run({ type: 'AUTHORIZE_START', method: 'card' });
  expect(reduce(s, { type: 'AUTHORIZE_START', method: 'apple_pay' })).toBe(s);
});

test('cancelling the sheet returns to idle with no error', () => {
  expect(run({ type: 'AUTHORIZE_START', method: 'apple_pay' }, { type: 'AUTHORIZE_CANCELLED' })).toEqual({
    status: 'idle',
  });
});

test('SUBMITTED is ignored unless authorizing', () => {
  expect(run({ type: 'SUBMITTED', idempotencyKey: 'k1' })).toBe(idle);
});

test('timeout -> reconciling -> resolved', () => {
  const s = run(
    { type: 'AUTHORIZE_START', method: 'card' },
    { type: 'SUBMITTED', idempotencyKey: 'k1' },
    { type: 'OUTCOME_UNKNOWN', idempotencyKey: 'k1' },
  );
  expect(s).toEqual({ status: 'reconciling', idempotencyKey: 'k1', stalled: false });
  expect(reduce(s, { type: 'SUCCEEDED', payment }).status).toBe('succeeded');
});

test('relaunch goes straight from idle to reconciling', () => {
  expect(run({ type: 'RECONCILE_START', idempotencyKey: 'k1' }).status).toBe('reconciling');
});

test('reconcile can stall, then still resolve', () => {
  const s = run({ type: 'RECONCILE_START', idempotencyKey: 'k1' }, { type: 'RECONCILE_STALLED' });
  expect(s).toEqual({ status: 'reconciling', idempotencyKey: 'k1', stalled: true });
  expect(reduce(s, { type: 'DECLINED', message: 'nope' }).status).toBe('declined');
});

test('can retry after a decline', () => {
  const declined = run(
    { type: 'AUTHORIZE_START', method: 'card' },
    { type: 'SUBMITTED', idempotencyKey: 'k1' },
    { type: 'DECLINED', message: 'Your card was declined.' },
  );
  expect(declined.status).toBe('declined');
  expect(reduce(declined, { type: 'AUTHORIZE_START', method: 'card' }).status).toBe('authorizing');
});

test('a late SUCCEEDED cannot overwrite a fresh idle after cancel', () => {
  const s = run({ type: 'AUTHORIZE_START', method: 'card' }, { type: 'AUTHORIZE_CANCELLED' });
  expect(reduce(s, { type: 'SUCCEEDED', payment })).toBe(s);
});

test('RESET after success lands in idle, never back behind the launch gate', () => {
  const s = run(
    { type: 'AUTHORIZE_START', method: 'card' },
    { type: 'SUBMITTED', idempotencyKey: 'k1' },
    { type: 'SUCCEEDED', payment },
  );
  expect(reduce(s, { type: 'RESET' })).toEqual({ status: 'idle' });
});

test('RESET is ignored while busy', () => {
  const s = run({ type: 'AUTHORIZE_START', method: 'card' });
  expect(isBusy(s)).toBe(true);
  expect(reduce(s, { type: 'RESET' })).toBe(s);
});

test('NOTICE attaches to idle only', () => {
  expect(run({ type: 'NOTICE', message: 'hello' })).toEqual({ status: 'idle', notice: 'hello' });
  const busy = run({ type: 'AUTHORIZE_START', method: 'card' });
  expect(reduce(busy, { type: 'NOTICE', message: 'hello' })).toBe(busy);
});
