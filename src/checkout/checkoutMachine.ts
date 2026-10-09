import type { PaymentMethod } from '../domain/eligibility';
import type { PaymentRecord } from '../api/paymentsApi';

/**
 * The checkout is always in exactly one of these states; StatusViews maps
 * each state to what the fan sees, and reconciling is the "we don't know
 * yet, we're checking" state. The busy ones:
 * restoring:   the launch gate. Until the pending record is read from disk,
 *              the app cannot know whether a payment is already in flight,
 *              so nothing is tappable. On a clean launch this lasts one
 *              AsyncStorage read; the fan never sees it.
 * authorizing: the sheet is up, the Affirm page is open, or the card is being
 *              tokenized. Nothing has been sent to our server yet.
 * processing:  a charge request has been sent.
 * reconciling: "we don't know yet, we're checking". Entered after a timeout,
 *              a 5xx, or a relaunch that found an unfinished attempt.
 */
export type CheckoutState =
  | { status: 'restoring' }
  | { status: 'idle'; notice?: string }
  | { status: 'authorizing'; method: PaymentMethod }
  | { status: 'processing'; method: PaymentMethod; idempotencyKey: string }
  | { status: 'reconciling'; idempotencyKey: string; stalled: boolean }
  | { status: 'succeeded'; payment: PaymentRecord }
  | { status: 'declined'; message: string }
  | { status: 'failed'; message: string };

export type CheckoutEvent =
  | { type: 'RESTORED' }
  | { type: 'AUTHORIZE_START'; method: PaymentMethod }
  | { type: 'AUTHORIZE_CANCELLED' }
  | { type: 'SUBMITTED'; idempotencyKey: string }
  | { type: 'OUTCOME_UNKNOWN'; idempotencyKey: string }
  | { type: 'RECONCILE_START'; idempotencyKey: string }
  | { type: 'RECONCILE_STALLED' }
  | { type: 'SUCCEEDED'; payment: PaymentRecord }
  | { type: 'DECLINED'; message: string }
  | { type: 'FAILED'; message: string }
  | { type: 'NOTICE'; message: string }
  | { type: 'RESET' };

export const initialCheckoutState: CheckoutState = { status: 'restoring' };

/** While busy, every payment button is disabled and the quantity is locked. */
export function isBusy(state: CheckoutState): boolean {
  return (
    state.status === 'restoring' ||
    state.status === 'authorizing' ||
    state.status === 'processing' ||
    state.status === 'reconciling'
  );
}

const canStart = (s: CheckoutState) => s.status === 'idle' || s.status === 'declined' || s.status === 'failed';
const awaitingResult = (s: CheckoutState) => s.status === 'processing' || s.status === 'reconciling';

/**
 * Pure function: (state, event) -> next state.
 * An event that makes no sense in the current state returns the SAME state
 * object, so React skips the re-render. Example: a second Pay tap fires
 * AUTHORIZE_START while already authorizing, and nothing happens.
 */
export function checkoutReducer(state: CheckoutState, event: CheckoutEvent): CheckoutState {
  switch (event.type) {
    case 'RESTORED':
      // The launch gate opens: the disk was read and nothing needs recovery.
      return state.status === 'restoring' ? { status: 'idle' } : state;
    case 'AUTHORIZE_START':
      return canStart(state) ? { status: 'authorizing', method: event.method } : state;
    case 'AUTHORIZE_CANCELLED':
      // Closing the sheet is a choice, not an error: back to idle, no banner.
      return state.status === 'authorizing' ? { status: 'idle' } : state;
    case 'SUBMITTED':
      return state.status === 'authorizing'
        ? { status: 'processing', method: state.method, idempotencyKey: event.idempotencyKey }
        : state;
    case 'OUTCOME_UNKNOWN':
      return state.status === 'processing'
        ? { status: 'reconciling', idempotencyKey: event.idempotencyKey, stalled: false }
        : state;
    case 'RECONCILE_START':
      // From restoring: an app relaunch found a submitted pending record.
      return state.status === 'restoring' || state.status === 'idle' || state.status === 'reconciling'
        ? { status: 'reconciling', idempotencyKey: event.idempotencyKey, stalled: false }
        : state;
    case 'RECONCILE_STALLED':
      return state.status === 'reconciling' ? { ...state, stalled: true } : state;
    case 'SUCCEEDED':
      return awaitingResult(state) ? { status: 'succeeded', payment: event.payment } : state;
    case 'DECLINED':
      return awaitingResult(state) ? { status: 'declined', message: event.message } : state;
    case 'FAILED':
      return isBusy(state) ? { status: 'failed', message: event.message } : state;
    case 'NOTICE':
      return state.status === 'idle' ? { status: 'idle', notice: event.message } : state;
    case 'RESET':
      // A new purchase starts at idle, NOT at the launch gate: restoring is
      // only for boot, before the disk has been read. A reset happens long
      // after that, and nothing would ever re-open the gate.
      return isBusy(state) ? state : { status: 'idle' };
    default:
      return state;
  }
}
