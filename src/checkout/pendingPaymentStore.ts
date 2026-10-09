import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PaymentMethod } from '../domain/eligibility';

// A force-quit wipes all JavaScript memory. This record, written to disk
// BEFORE anything risky happens, is what the relaunched app finds.
//
// The two phases are the whole point:
//   authorizing: the sheet or Affirm page was open. Nothing was sent to the
//                server, so a relaunch can safely discard it: "not charged".
//   submitted:   the request may have reached the server. A relaunch must ask
//                (GET by idempotency key), never assume and never re-send.
//
// Why AsyncStorage and not SecureStore: the record holds an order id, an
// amount, a method and a UUID. No card data, no tokens, nothing secret.
export type PendingPayment =
  | { phase: 'authorizing'; method: PaymentMethod; orderId: string; amountCents: number; createdAt: number }
  | {
      phase: 'submitted';
      method: PaymentMethod;
      orderId: string;
      amountCents: number;
      idempotencyKey: string;
      createdAt: number;
    };

export interface PendingPaymentStore {
  load(): Promise<PendingPayment | null>;
  save(pending: PendingPayment): Promise<void>;
  clear(): Promise<void>;
}

// Versioned key: if the record's shape ever changes, v2 simply won't read
// stale v1 data as if it were current.
const KEY = 'gametime.checkout.pendingPayment.v1';

type KeyValueStorage = Pick<typeof AsyncStorage, 'getItem' | 'setItem' | 'removeItem'>;

export function createPendingPaymentStore(storage: KeyValueStorage = AsyncStorage): PendingPaymentStore {
  return {
    async load() {
      try {
        const raw = await storage.getItem(KEY);
        return raw ? (JSON.parse(raw) as PendingPayment) : null;
      } catch {
        // Corrupted data: drop it rather than crash the checkout on launch.
        await storage.removeItem(KEY).catch(() => {});
        return null;
      }
    },
    save: (pending) => storage.setItem(KEY, JSON.stringify(pending)),
    clear: () => storage.removeItem(KEY),
  };
}

/** Test double that keeps the record inspectable mid-flow. */
export function createInMemoryPendingStore() {
  const store = {
    // current is exposed so a test can look at the fake disk mid-operation.
    current: null as PendingPayment | null,
    async load() {
      return store.current;
    },
    async save(pending: PendingPayment) {
      store.current = pending;
    },
    async clear() {
      store.current = null;
    },
  };
  return store;
}
