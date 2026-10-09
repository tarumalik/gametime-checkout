import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import type { PaymentRecord, PaymentsApi } from '../api/paymentsApi';
import { WalletSheetProvider } from '../native-stubs/WalletSheet';
import type { PaymentDeps } from './paymentService';
import { createInMemoryPendingStore } from './pendingPaymentStore';
import { useCheckout } from './useCheckout';

// The relaunch half of the no-double-charge story: the hook wakes up to a
// pending record written by a previous life of the app and must (a) resume
// the interrupted ORDER, not a freshly minted one, and (b) only ever ASK the
// server what happened, never re-send a charge.

const succeeded: PaymentRecord = {
  paymentId: 'pay_1',
  idempotencyKey: 'idem_1',
  orderId: 'ord_before_kill',
  amountCents: 10500,
  method: 'card',
  status: 'succeeded',
};

function makeDeps(getPayment: PaymentsApi['getPayment']): PaymentDeps {
  return {
    api: { createPayment: jest.fn(), getPayment, createAffirmCheckout: jest.fn() },
    store: createInMemoryPendingStore(),
    newIdempotencyKey: () => 'idem_new',
    sleep: async () => {},
  };
}

const wrapper = ({ children }: { children: ReactNode }) => <WalletSheetProvider>{children}</WalletSheetProvider>;

test('the launch gate: nothing is payable until the pending record has been read', async () => {
  // Hold the disk read open so the test can look at the gap a fast fan
  // would tap into. On device this window is one AsyncStorage read.
  let releaseLoad!: () => void;
  const loadGate = new Promise<void>((resolve) => (releaseLoad = resolve));
  const store = createInMemoryPendingStore();
  const deps: PaymentDeps = {
    api: { createPayment: jest.fn(), getPayment: jest.fn(), createAffirmCheckout: jest.fn() },
    store: {
      ...store,
      load: async () => {
        await loadGate;
        return store.load();
      },
    },
    newIdempotencyKey: () => 'idem_new',
    sleep: async () => {},
  };

  const { result } = await renderHook(
    () => useCheckout({ deps, orderId: 'ord_fresh_mint', totalCents: 10500 }),
    { wrapper },
  );

  expect(result.current.state.status).toBe('restoring'); // locked, not idle
  releaseLoad();
  await waitFor(() => expect(result.current.state).toEqual({ status: 'idle' }));
});

test('relaunch with a submitted record: adopts the stored order id, reconciles by GET to success', async () => {
  const getPayment = jest.fn<ReturnType<PaymentsApi['getPayment']>, [string]>(async () => ({
    ok: true,
    value: succeeded,
  }));
  const deps = makeDeps(getPayment);
  await deps.store.save({
    phase: 'submitted',
    method: 'card',
    orderId: 'ord_before_kill',
    amountCents: 10500,
    idempotencyKey: 'idem_1',
    createdAt: 1,
  });
  const onRecoveredOrderId = jest.fn();

  const { result } = await renderHook(
    // The screen mounts with a NEW id, exactly like the real relaunch does.
    () => useCheckout({ deps, orderId: 'ord_fresh_mint', totalCents: 10500, onRecoveredOrderId }),
    { wrapper },
  );

  await waitFor(() => expect(result.current.state.status).toBe('succeeded'));
  expect(onRecoveredOrderId).toHaveBeenCalledWith('ord_before_kill');
  expect(getPayment).toHaveBeenCalledWith('idem_1');
  expect(deps.api.createPayment).not.toHaveBeenCalled(); // asked, never re-sent
  expect(await deps.store.load()).toBeNull(); // final answer clears the record
});

test('relaunch with an authorizing record: adopts the order id, clears, says not charged', async () => {
  const deps = makeDeps(jest.fn());
  await deps.store.save({
    phase: 'authorizing',
    method: 'apple_pay',
    orderId: 'ord_before_kill',
    amountCents: 10500,
    createdAt: 1,
  });
  const onRecoveredOrderId = jest.fn();

  const { result } = await renderHook(
    () => useCheckout({ deps, orderId: 'ord_fresh_mint', totalCents: 10500, onRecoveredOrderId }),
    { wrapper },
  );

  await waitFor(() =>
    expect(result.current.state).toEqual({
      status: 'idle',
      notice: "Your last payment wasn't completed, and you have not been charged.",
    }),
  );
  // The sheet never closed, so nothing reached the server: same order resumes,
  // and there is nothing to ask the server about.
  expect(onRecoveredOrderId).toHaveBeenCalledWith('ord_before_kill');
  expect(deps.api.getPayment).not.toHaveBeenCalled();
  expect(await deps.store.load()).toBeNull();
});
