import AsyncStorage from '@react-native-async-storage/async-storage';
import { createPendingPaymentStore, type PendingPayment } from './pendingPaymentStore';

beforeEach(() => AsyncStorage.clear());

const pending: PendingPayment = {
  phase: 'submitted',
  method: 'card',
  orderId: 'ord_1',
  amountCents: 10500,
  idempotencyKey: 'k1',
  createdAt: 1,
};

test('round-trips a record across a "relaunch" (a brand-new store instance)', async () => {
  await createPendingPaymentStore().save(pending);
  expect(await createPendingPaymentStore().load()).toEqual(pending);
});

test('clear removes it', async () => {
  const store = createPendingPaymentStore();
  await store.save(pending);
  await store.clear();
  expect(await store.load()).toBeNull();
});

test('an authorizing-phase record round-trips too', async () => {
  const authorizing: PendingPayment = {
    phase: 'authorizing',
    method: 'apple_pay',
    orderId: 'ord_2',
    amountCents: 5250,
    createdAt: 2,
  };
  await createPendingPaymentStore().save(authorizing);
  expect(await createPendingPaymentStore().load()).toEqual(authorizing);
});

test('corrupted data is treated as nothing pending, and removed', async () => {
  await AsyncStorage.setItem('gametime.checkout.pendingPayment.v1', '{not json');
  expect(await createPendingPaymentStore().load()).toBeNull();
  expect(await AsyncStorage.getItem('gametime.checkout.pendingPayment.v1')).toBeNull();
});
