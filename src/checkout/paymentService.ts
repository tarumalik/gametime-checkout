import type { PaymentsApi, PaymentRecord } from '../api/paymentsApi';
import type { PendingPaymentStore } from './pendingPaymentStore';
import type { PaymentMethod } from '../domain/eligibility';

// The client half of the no-double-charge guarantee is two rules, both here:
//   1. Persist the attempt BEFORE the request leaves the device (write-ahead).
//   2. Recovery only ever ASKS (GET); it never re-sends a charge.

export type PaymentDeps = {
  api: PaymentsApi;
  store: PendingPaymentStore;
  newIdempotencyKey: () => string;
  sleep: (ms: number) => Promise<void>; // injected so tests never actually wait
};

export type FinalOutcome =
  | { kind: 'succeeded'; payment: PaymentRecord }
  | { kind: 'declined'; payment: PaymentRecord }
  | { kind: 'not_charged'; message: string };

export type SubmitOutcome = FinalOutcome | { kind: 'unknown'; idempotencyKey: string };
export type ReconcileOutcome = FinalOutcome | { kind: 'still_unknown' };
export type SubmitInput = { orderId: string; amountCents: number; method: PaymentMethod; paymentToken: string };

const NOT_CHARGED = "We couldn't complete your payment and you have not been charged. Please try again.";

// A fan who already paid must never read "your payment failed": that is
// false, and it invites a retry.
function rejectionMessage(code: string, serverMessage: string): string {
  if (code === 'order_already_paid') return 'This order was already paid. You have not been charged again.';
  if (code === 'payment_in_progress') return 'A payment for this order is already in progress. Please wait a moment.';
  return serverMessage;
}

/** A final answer means nothing is left to recover: clear the pending record. */
async function settle(deps: PaymentDeps, record: PaymentRecord): Promise<FinalOutcome | null> {
  if (record.status === 'processing') return null; // not final yet
  await deps.store.clear();
  return record.status === 'succeeded'
    ? { kind: 'succeeded', payment: record }
    : { kind: 'declined', payment: record };
}

export async function submitPayment(
  deps: PaymentDeps,
  input: SubmitInput,
  onSubmitted: (idempotencyKey: string) => void,
): Promise<SubmitOutcome> {
  // One key per purchase attempt. The key protects this attempt against
  // duplicate delivery (the server replays instead of charging twice). The
  // client never re-sends a POST whose outcome is unknown; recovery is
  // read-based (reconcilePayment), so every submit is a new attempt with a
  // new key.
  const idempotencyKey = deps.newIdempotencyKey();

  // Write-ahead: persist BEFORE the request leaves the device. If the app is
  // killed any time after this line, the relaunch knows to ask the server.
  await deps.store.save({
    phase: 'submitted',
    idempotencyKey,
    method: input.method,
    orderId: input.orderId,
    amountCents: input.amountCents,
    createdAt: Date.now(),
  });
  onSubmitted(idempotencyKey);

  const result = await deps.api.createPayment({ ...input, currency: 'USD' }, idempotencyKey);
  if (!result.ok) {
    if (result.error.kind === 'rejected') {
      // order_already_paid means an EARLIER attempt took the money, and the
      // 409 carries that winning record: show the confirmation, not an error.
      if (result.error.code === 'order_already_paid' && result.error.payment) {
        const final = await settle(deps, result.error.payment);
        if (final) return final;
      }
      // Any other on-purpose "no" charged nothing, so the record can go.
      await deps.store.clear();
      return { kind: 'not_charged', message: rejectionMessage(result.error.code, result.error.message) };
    }
    // Timeout / network / 5xx: KEEP the record. We must reconcile.
    return { kind: 'unknown', idempotencyKey };
  }
  return (await settle(deps, result.value)) ?? { kind: 'unknown', idempotencyKey };
}

/**
 * Ask the server what happened. GET only, so this loop can never create a
 * charge no matter how many times it runs.
 */
export async function reconcilePayment(
  deps: PaymentDeps,
  idempotencyKey: string,
  { attempts = 5, intervalMs = 2000 } = {},
): Promise<ReconcileOutcome> {
  // A 404 is NOT final on first sight: if the app died the instant the POST
  // left, the relaunch can ask before that POST lands. "Missing" only becomes
  // "never received" when the server's LAST word in the window is still a 404.
  // A failed read is not a word from the server: if the window ends on a
  // network error, the outcome stays unknown and the record is kept. Telling
  // the fan "not charged" on anything less than a definitive answer would be
  // a guess, and the one place this app must never guess.
  let lastAnswer: 'none' | 'unreachable' | 'missing' | 'found' = 'none';
  for (let i = 0; i < attempts; i++) {
    const result = await deps.api.getPayment(idempotencyKey);
    if (result.ok) {
      if (result.value === null) {
        lastAnswer = 'missing';
      } else {
        lastAnswer = 'found';
        const final = await settle(deps, result.value);
        if (final) return final;
      }
    } else {
      lastAnswer = 'unreachable';
    }
    if (i < attempts - 1) await deps.sleep(intervalMs);
  }
  if (lastAnswer === 'missing') {
    // The server itself answered, and the answer stayed "never received":
    // the attempt did not land, so nothing was charged.
    await deps.store.clear();
    return { kind: 'not_charged', message: NOT_CHARGED };
  }
  // Record kept on purpose: the UI offers "Check again" and a relaunch retries.
  return { kind: 'still_unknown' };
}
