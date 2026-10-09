// The mock payments API. A separate OS process on purpose: it survives app
// kills, so the no-double-charge-after-relaunch demo runs against a boundary
// that behaves like a real backend.

const express = require('express');
const crypto = require('node:crypto');

const METHODS = ['card', 'apple_pay', 'google_pay', 'affirm'];
const AFFIRM_MIN_EXCLUSIVE_CENTS = 10000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errorBody = (code, message) => ({ error: { code, message } });
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function statusCodeFor(record) {
  if (record.status === 'succeeded') return 200;
  if (record.status === 'declined') return 402; // card errors, same convention as Stripe
  return 202; // still processing
}

// Token suffixes mirror Stripe's test cards: ...0002 = generic decline,
// ...9995 = insufficient funds. code identifies the error family,
// declineCode carries the issuer-level reason, exactly Stripe's two-field shape.
function decideOutcome(paymentToken, forcedOutcome) {
  if (forcedOutcome === 'decline' || paymentToken.endsWith('_0002')) {
    return { status: 'declined', code: 'card_declined', declineCode: 'generic_decline', message: 'Your card was declined.' };
  }
  if (paymentToken.endsWith('_9995')) {
    return { status: 'declined', code: 'card_declined', declineCode: 'insufficient_funds', message: 'Your card has insufficient funds.' };
  }
  return { status: 'succeeded' };
}

function createApp(options = {}) {
  const defaultDelayMs = options.defaultDelayMs ?? 1500;
  const hangMs = options.hangMs ?? 30000;
  const payments = new Map(); // idempotencyKey -> { fingerprint, record, done }
  const affirmCheckouts = new Map(); // checkoutId -> checkout session

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (!options.quiet) console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    next();
  });

  app.post('/v1/payments', async (req, res) => {
    const key = req.get('Idempotency-Key');
    if (!key) {
      return res.status(400).json(errorBody('missing_idempotency_key', 'Idempotency-Key header is required.'));
    }

    const { orderId, amountCents, currency, method, paymentToken } = req.body ?? {};
    if (
      typeof orderId !== 'string' || !Number.isInteger(amountCents) || amountCents <= 0 ||
      currency !== 'USD' || !METHODS.includes(method) ||
      typeof paymentToken !== 'string' || paymentToken.length === 0
    ) {
      return res
        .status(400)
        .json(errorBody('invalid_request', 'orderId, amountCents, currency, method and paymentToken are required.'));
    }

    // Defences 1 and 2 below are the server side of the no-double-charge
    // guarantee.
    // 1. Idempotency: a replay of the same key returns the ORIGINAL result.
    //    Same key with a different body is misuse, not a retry: 409.
    const fingerprint = [orderId, amountCents, currency, method, paymentToken].join('|');
    const existing = payments.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return res.status(409).json(errorBody('idempotency_key_reused', 'This Idempotency-Key was used with a different request.'));
      }
      await existing.done; // first request still in flight: wait for its outcome
      res.set('Idempotent-Replayed', 'true'); // same marker Stripe sends on replays
      return res.status(statusCodeFor(existing.record)).json(existing.record);
    }

    // 2. Second line of defence: one order can only ever hold one live payment,
    //    whatever the key. A fresh key against a paid order gets a 409.
    const blocking = [...payments.values()].find((p) => p.record.orderId === orderId && p.record.status !== 'declined');
    if (blocking) {
      if (blocking.record.status === 'succeeded') {
        // Attach the payment that won, so the client can show its
        // confirmation instead of stranding the fan on an error.
        return res
          .status(409)
          .json({ ...errorBody('order_already_paid', 'This order already has a payment.'), payment: blocking.record });
      }
      return res.status(409).json(errorBody('payment_in_progress', 'This order already has a payment.'));
    }

    // 3. Business rules re-checked server side. The client's eligibility logic
    //    is a convenience; the server is the authority.
    if (method === 'affirm') {
      if (amountCents <= AFFIRM_MIN_EXCLUSIVE_CENTS) {
        return res.status(422).json(errorBody('affirm_ineligible', 'Affirm is only available for orders over $100.'));
      }
      const checkout = [...affirmCheckouts.values()].find((c) => c.checkoutToken === paymentToken);
      if (!checkout || checkout.orderId !== orderId || checkout.amountCents !== amountCents) {
        // Log WHY verification failed: token unknown, or which field diverged.
        if (!options.quiet) {
          console.warn('[affirm] verification failed', {
            received: { orderId, amountCents, paymentToken },
            match: checkout
              ? { orderId: checkout.orderId, amountCents: checkout.amountCents }
              : 'no session with this token',
            knownTokens: [...affirmCheckouts.values()].map((c) => c.checkoutToken.slice(0, 18) + '…'),
          });
        }
        return res.status(422).json(errorBody('invalid_affirm_token', 'Affirm checkout could not be verified.'));
      }
      if (checkout.used) {
        return res.status(422).json(errorBody('affirm_token_used', 'This Affirm checkout was already used.'));
      }
      checkout.used = true;
    }

    const forced = req.get('X-Mock-Outcome'); // MOCK ONLY: driven by the app's dev menu
    if (forced === 'server_error') {
      // Fails BEFORE anything is recorded, so a later GET returns 404,
      // which the client reads as "never charged, safe to retry".
      return res.status(500).json(errorBody('internal_error', 'Simulated server failure.'));
    }
    const requestedDelay = Number(req.get('X-Mock-Delay-Ms'));
    const delayMs = Number.isFinite(requestedDelay) ? Math.min(Math.max(requestedDelay, 0), 20000) : defaultDelayMs;

    // 4. Record the attempt IMMEDIATELY (status processing), then "talk to the
    //    processor". If the app dies now, this record lives on and settles by
    //    itself, which is what the relaunched app finds via GET.
    const record = {
      paymentId: `pay_${crypto.randomUUID()}`,
      idempotencyKey: key,
      orderId,
      amountCents,
      currency,
      method,
      status: 'processing',
      createdAt: new Date().toISOString(),
    };
    const done = sleep(delayMs).then(() => Object.assign(record, decideOutcome(paymentToken, forced)));
    payments.set(key, { fingerprint, record, done });
    await done;

    if (forced === 'timeout') await sleep(hangMs); // charge happened, response "lost"
    res.status(statusCodeFor(record)).json(record);
  });

  app.get('/v1/payments/:key', (req, res) => {
    const entry = payments.get(req.params.key);
    if (!entry) return res.status(404).json(errorBody('not_found', 'No payment exists for this Idempotency-Key.'));
    res.status(200).json(entry.record);
  });

  app.post('/v1/affirm/checkouts', (req, res) => {
    const { orderId, amountCents, redirectUri } = req.body ?? {};
    if (typeof orderId !== 'string' || !Number.isInteger(amountCents) || typeof redirectUri !== 'string') {
      return res.status(400).json(errorBody('invalid_request', 'orderId, amountCents and redirectUri are required.'));
    }
    if (amountCents <= AFFIRM_MIN_EXCLUSIVE_CENTS) {
      return res.status(422).json(errorBody('affirm_ineligible', 'Affirm is only available for orders over $100.'));
    }
    const checkoutId = `aff_${crypto.randomUUID()}`;
    affirmCheckouts.set(checkoutId, {
      checkoutId,
      orderId,
      amountCents,
      redirectUri,
      checkoutToken: `affirm_tok_${crypto.randomUUID()}`,
      used: false,
    });
    // Built from the Host header so the URL works from both simulators:
    // localhost on iOS, 10.0.2.2 on the Android emulator.
    res.status(201).json({ checkoutId, redirectUrl: `${req.protocol}://${req.get('host')}/mock-affirm/${checkoutId}` });
  });

  // Stand-in for Affirm's hosted page. The confirm link goes DIRECTLY to the
  // app's deep link, as a user tap. Browsers honor a tapped custom-scheme link
  // far more reliably than a server redirect to one.
  app.get('/mock-affirm/:id', (req, res) => {
    const c = affirmCheckouts.get(req.params.id);
    if (!c) return res.status(404).send('Unknown checkout');
    const confirmUrl = new URL(c.redirectUri);
    confirmUrl.searchParams.set('checkout_token', c.checkoutToken);
    const cancelUrl = new URL(c.redirectUri);
    cancelUrl.searchParams.set('cancelled', '1');
    res.type('html').send(`<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Affirm (mock)</title></head>
<body style="font-family:-apple-system,Roboto,sans-serif;padding:24px">
<h2>Affirm (mock)</h2>
<p>Pay $${(c.amountCents / 100).toFixed(2)} in monthly payments.</p>
<p><a href="${escapeHtml(confirmUrl.toString())}"
style="display:block;padding:14px;background:#4a4af4;color:#fff;text-align:center;border-radius:8px;text-decoration:none">Confirm and pay</a></p>
<p><a href="${escapeHtml(cancelUrl.toString())}">Cancel and return to Gametime</a></p>
</body></html>`);
  });

  // Reviewer aid: one URL that shows every charge the server has taken,
  // plus the Affirm sessions it has issued.
  app.get('/v1/_debug/payments', (_req, res) =>
    res.json({
      payments: [...payments.values()].map((p) => p.record),
      affirmCheckouts: [...affirmCheckouts.values()],
    }),
  );

  return app;
}

module.exports = { createApp };
