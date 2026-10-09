import { useCallback, useEffect, useReducer, useRef } from 'react';
import { AppState } from 'react-native';
import { validateCard, type CardInput } from '../domain/card';
import type { PaymentMethod, WalletMethod } from '../domain/eligibility';
import { openAffirmCheckout, affirmReturnUrl } from '../native-stubs/affirm';
import { tokenizeCard } from '../native-stubs/cardTokenizer';
import { useWalletSheet } from '../native-stubs/WalletSheet';
import { checkoutReducer, initialCheckoutState, isBusy } from './checkoutMachine';
import { reconcilePayment, submitPayment, type FinalOutcome, type PaymentDeps } from './paymentService';

// The lifecycle core: one interaction completes an express purchase, and the
// flow has to survive backgrounding and force-quit along the way. What
// happens in each situation:
//   Two fast taps            -> the inFlight ref blocks the second synchronously.
//   Backgrounded at the sheet -> nothing resets; the awaited promise resumes.
//   Backgrounded processing   -> request finishes or degrades to reconciling;
//                                on return to 'active' we reconcile again.
//   Killed while authorizing  -> relaunch discards the record: "not charged".
//   Killed after submitting   -> relaunch reconciles by GET: never a re-send.

const INTERRUPTED = "Your last payment wasn't completed, and you have not been charged.";

type Args = {
  deps: PaymentDeps;
  orderId: string;
  totalCents: number;
  /** Relaunch recovery found an interrupted attempt: adopt its order id. */
  onRecoveredOrderId?: (orderId: string) => void;
};

export function useCheckout({ deps, orderId, totalCents, onRecoveredOrderId }: Args) {
  const [state, dispatch] = useReducer(checkoutReducer, initialCheckoutState);
  const presentWalletSheet = useWalletSheet();

  // Refs, not state, because refs change synchronously: two taps in the same
  // frame both read the same `state`, but the second sees inFlight === true.
  const inFlight = useRef(false);
  const reconciling = useRef(false);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const applyFinal = useCallback((outcome: FinalOutcome) => {
    if (outcome.kind === 'succeeded') dispatch({ type: 'SUCCEEDED', payment: outcome.payment });
    else if (outcome.kind === 'declined')
      dispatch({ type: 'DECLINED', message: outcome.payment.message ?? 'Your payment was declined.' });
    else dispatch({ type: 'FAILED', message: outcome.message });
  }, []);

  const reconcile = useCallback(
    async (idempotencyKey: string) => {
      if (reconciling.current) return; // one polling loop at a time
      reconciling.current = true;
      try {
        const outcome = await reconcilePayment(deps, idempotencyKey);
        if (outcome.kind === 'still_unknown') dispatch({ type: 'RECONCILE_STALLED' });
        else applyFinal(outcome);
      } finally {
        reconciling.current = false;
      }
    },
    [deps, applyFinal],
  );

  async function submit(method: PaymentMethod, paymentToken: string) {
    const outcome = await submitPayment(
      deps,
      // Amount captured at tap time: a quantity change after this line cannot
      // alter what the fan is charged.
      { orderId, amountCents: totalCents, method, paymentToken },
      (idempotencyKey) => dispatch({ type: 'SUBMITTED', idempotencyKey }),
    );
    if (outcome.kind === 'unknown') {
      dispatch({ type: 'OUTCOME_UNKNOWN', idempotencyKey: outcome.idempotencyKey });
      await reconcile(outcome.idempotencyKey);
    } else {
      applyFinal(outcome);
    }
  }

  async function cancelAuthorization() {
    await deps.store.clear();
    dispatch({ type: 'AUTHORIZE_CANCELLED' });
  }

  async function runExclusive(method: PaymentMethod, flow: () => Promise<void>) {
    if (inFlight.current || isBusy(stateRef.current)) return;
    inFlight.current = true;
    dispatch({ type: 'AUTHORIZE_START', method });
    try {
      // The authorizing record: if the app dies while the sheet or the Affirm
      // page is up, the relaunch finds this and says "not charged".
      await deps.store.save({ phase: 'authorizing', method, orderId, amountCents: totalCents, createdAt: Date.now() });
      await flow();
    } catch (error) {
      console.warn('Checkout flow error', error);
      dispatch({ type: 'FAILED', message: 'Something went wrong. Please try again.' }); // never strand the fan on a spinner
    } finally {
      inFlight.current = false;
    }
  }

  const payWithCard = (card: CardInput) =>
    runExclusive('card', async () => {
      if (!validateCard(card, new Date()).isValid) return cancelAuthorization(); // defence in depth
      await submit('card', await tokenizeCard(card));
    });

  const payWithWallet = (method: WalletMethod) =>
    runExclusive(method, async () => {
      const result = await presentWalletSheet({ method, amountCents: totalCents, merchantName: 'Gametime' });
      if (result.status === 'cancelled') return cancelAuthorization(); // a choice, not an error
      await submit(method, result.token); // no second tap: straight to charge
    });

  const payWithAffirm = () =>
    runExclusive('affirm', async () => {
      // One nonce per attempt: only a return URL carrying it is trusted.
      // Android can replay an old deep-link intent after the browser closes.
      const state = deps.newIdempotencyKey();
      const checkout = await deps.api.createAffirmCheckout({
        orderId,
        amountCents: totalCents,
        redirectUri: affirmReturnUrl(state),
      });
      if (!checkout.ok) {
        await deps.store.clear();
        dispatch({ type: 'FAILED', message: 'Affirm is unavailable right now. Please choose another payment method.' });
        return;
      }
      const result = await openAffirmCheckout(checkout.value.redirectUrl, state);
      // stale = Android replayed an old return URL and the genuine one never
      // arrived. Nothing was submitted, so treat it like a cancel: quiet. The
      // common cause IS a cancel; in the rare lost-confirm case the missing
      // success screen prompts a retry, which is safe (unused token, and the
      // server allows only one payment per order).
      if (result.status === 'cancelled' || result.status === 'stale') return cancelAuthorization();
      await submit('affirm', result.checkoutToken);
    });

  // Relaunch recovery: runs once when the checkout first mounts (app launch).
  useEffect(() => {
    let mounted = true;
    (async () => {
      const pending = await deps.store.load();
      if (!mounted) return;
      // The machine starts in 'restoring' with everything locked: a tap that
      // lands before this read resolves could start a SECOND payment the app
      // does not know about yet. Each branch below is what opens the gate.
      if (!pending) {
        dispatch({ type: 'RESTORED' });
        return;
      }
      // Resume the SAME order, not a freshly minted one. The server allows one
      // payment per order, but that guard only protects money if a retry after
      // relaunch names the order that was interrupted; a new id sidesteps it.
      onRecoveredOrderId?.(pending.orderId);
      if (pending.phase === 'submitted') {
        dispatch({ type: 'RECONCILE_START', idempotencyKey: pending.idempotencyKey });
        await reconcile(pending.idempotencyKey);
      } else {
        await deps.store.clear(); // nothing ever reached our server
        dispatch({ type: 'RESTORED' });
        dispatch({ type: 'NOTICE', message: INTERRUPTED });
      }
    })();
    return () => {
      mounted = false;
    };
  }, []); // intentionally once per launch

  // An AppState change never resets anything. When the app returns to the
  // foreground while the outcome is unsure, ask the server again.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const s = stateRef.current;
      if (next === 'active' && s.status === 'reconciling') void reconcile(s.idempotencyKey);
    });
    return () => sub.remove();
  }, [reconcile]);

  const checkAgain = () => {
    const s = stateRef.current;
    if (s.status !== 'reconciling') return;
    dispatch({ type: 'RECONCILE_START', idempotencyKey: s.idempotencyKey });
    void reconcile(s.idempotencyKey);
  };

  return {
    state,
    payWithCard,
    payWithWallet,
    payWithAffirm,
    checkAgain,
    reset: () => dispatch({ type: 'RESET' }),
  };
}
