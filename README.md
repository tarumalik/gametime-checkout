# Gametime Checkout

A React Native (Expo) checkout screen for iOS and Android. The fan has picked seats; this is where they pay with Apple Pay, Google Pay, Affirm or card, against a mock payment API that runs as a separate local server.

## 1. What this is and how to run it

Two processes: the mock payment server (`server/`, Express, port 4000) and the app (Expo). Install steps are in `INSTALL.md`, exact run commands and troubleshooting in `RUN.md`. The short version:

```
cd server && npm start          # terminal A
npm run ios                     # terminal B (or: npm run android)
```

`npm test` runs the app's unit and component tests, `npm run typecheck` runs TypeScript, and `cd server && npm test` runs the server's contract tests over real HTTP. The architecture map with diagrams is in `SYSTEM_DESIGN.md`.

Platforms tested: the full manual matrix (eligibility, card form, express flows, backgrounding, kill-and-relaunch, forced failures) was run end to end on the iOS simulator (iPhone 17) and on the Android emulator (Pixel 8, API 35), both through Expo Go. Unit and server tests ran on every change along the way.

## 2. Eligibility and how to simulate environments

Rules, evaluated in `src/domain/eligibility.ts` as one pure function:

- Apple Pay: iOS only, and only when the device reports a provisioned card.
- Google Pay: Android only, and only when the device reports it is set up.
- Affirm: only when the total is strictly over $100.00. Exactly $100.00 does not qualify. One ticket is $52.50, so the quantity stepper crosses the line at two tickets, live.
- Card: always available.

Wallet capability is three-state (checking, available, unavailable). While checking, the UI shows a placeholder of the same height as the button, so nothing pops in; an unavailable wallet shows nothing at all, because a payment method that cannot work is worse than no button.

In a dev build, the "Settings" button opens an environment simulator: force the platform, either wallet, the order total, the backend outcome (decline, timeout, 500) and latency, and inspect the pending-payment record on disk. Every control defaults to Auto, which means real detection; the overrides are there so a reviewer can force each scenario on demand. The simulator is compiled out of release builds behind `__DEV__`.

Card numbers for review, mirroring Stripe's test cards: `4242 4242 4242 4242` succeeds, `4000 0000 0000 0002` declines, `4000 0000 0000 9995` fails with insufficient funds. The tokenizer preserves the last four digits and the server keys outcomes off that suffix, so the failure paths work without touching the dev menu. Any future expiry within 20 years, any CVC.

## 3. The API contract and why it looks this way

The server is a separate Node process on purpose: it survives the app being killed, so the kill-and-relaunch behavior in section 4 runs against a real process boundary instead of an in-memory fake that would die with the app.

| Call | Purpose |
|---|---|
| `POST /v1/payments` with `Idempotency-Key` header | Create a charge. Replays with the same key return the stored result and an `Idempotent-Replayed: true` header. Same key with a different body: 409 `idempotency_key_reused`. |
| `GET /v1/payments/:key` | Read-only status by idempotency key. 404 means the attempt never arrived. This is the only call recovery ever makes. |
| `POST /v1/affirm/checkouts` | Creates an Affirm session and returns the mock approval page URL. The page links back into the app with a one-time token. |
| `GET /v1/_debug/payments` | Inspection ledger for manual testing. |

Decisions behind the shape:

- One idempotency key per purchase attempt, minted by the client. The key protects an attempt against duplicate delivery: if the same request reaches the server twice, the server replays the stored result instead of charging again. The client never re-sends a POST whose outcome is unknown; recovery is read-based (GET by key), so every submit is a new attempt with a new key. The key format and replay semantics follow Stripe's idempotency model.
- Declines are results, not errors: HTTP 402 carries machine-readable `code` and `declineCode` fields, so the client can distinguish "insufficient funds" from "try another card" without string matching.
- The server enforces one payment per order (409 `order_already_paid`, `payment_in_progress`). The client keeps the order id stable across relaunches, so this guard holds exactly when it matters. An `order_already_paid` 409 includes the payment that won, and the app resolves it to that payment's confirmation screen: "you already paid" is good news, not an error.
- Money is integer cents everywhere. Floating point cannot be trusted at the $100.00 Affirm boundary.
- Amounts in requests are pinned at tap time; a quantity change mid-flight cannot alter the charge.

The client's error taxonomy mirrors the contract: a rejection (4xx) means this attempt charged nothing; a timeout, network drop or 5xx means outcome unknown, and unknown is never presented as failure. That one distinction drives all of the recovery behavior.

## 4. State flow: from tap to confirmed, including kill and relaunch

The checkout is a reducer state machine (`src/checkout/checkoutMachine.ts`): restoring, idle, authorizing, processing, reconciling, succeeded, declined, failed. Illegal events return the same state object, so a second tap during processing is a no-op by construction.

Express: one interaction completes the purchase. Tapping Apple Pay or Google Pay presents the sheet, and the sheet's approval resolves directly into the charge call; Affirm opens its approval page in the browser and the nonce-checked return does the same. There is no second Pay tap and no confirmation UI beyond the method's own. Cancelling a sheet or the Affirm page returns quietly to idle, since backing out is a choice rather than an error.

Card: the form gates instead of confirming. Fields format and validate on every change (so autofill behaves the same as typing), the Pay button shows the exact amount and stays disabled until the whole card is valid, and submission tokenizes the card so the server never sees the number. After authorization the two paths converge on the same submit code: a write-ahead record is saved to disk, then the POST goes out, then the result lands. A unit test pins that the record is written before the request leaves the device.

Lifecycle answers:

- Backgrounded mid-flow (Face ID prompt, Affirm redirect, OS interruption): nothing resets. On return to foreground, if the outcome is unknown, the app asks the server again.
- Killed with the sheet open: nothing was sent, so relaunch clears the record and says "Your last payment wasn't completed, and you have not been charged."
- Killed after the POST left: relaunch shows "Checking on your payment" and polls `GET` by idempotency key. A GET cannot create a charge, so this loop is safe to run any number of times. A 404 is only treated as final when the server's last answer in the polling window is still a 404, because a relaunch can race the original POST by milliseconds. A failed read does not count as an answer: if the network drops mid-check, the app keeps the record and stays in the checking state rather than guess "not charged".
- Launch itself is a state: the machine boots in `restoring` with every control locked until the pending record has been read from disk, so a fast tap cannot start a second payment the app does not yet know about. On a clean launch this lasts one storage read.
- The interrupted order's id is restored on relaunch, so a retry targets the same order and the server's one-payment-per-order guard protects it. A new order id is only minted after a completed purchase.

The double-charge test to run: set latency to 8s in the dev menu, pay by card, kill the app during processing, relaunch. The app resolves to the true outcome and `/v1/_debug/payments` shows exactly one charge.

## 5. Tradeoffs

- The payment SDKs are stubs that mirror the real interaction shapes (capability check, present-and-await sheet, redirect out and back with a one-time token). The swap-for-real seam is `src/native-stubs/`; nothing above it would change.
- The server stores state in memory. Restarting it resets the ledger, which fits a mock whose job is the request boundary rather than persistence.
- Brand detection covers Visa, Mastercard, Amex and Discover. Rare variable-length ranges are out; a processor integration would own that table anyway.
- Express buttons are styled text, not Apple's or Google's provided artwork, which their guidelines require for production. Known deviation, acceptable for an SDK-stubbed exercise.
- Card validation shows errors only when a field is complete but wrong, or incomplete after leaving it. Formatting is value-driven rather than keystroke-driven so that autofill, which delivers whole values in one change, takes the same code path as typing. The expiry field deliberately has no native length cap: keychain autofill delivers "12/2028" in one value, and a cap would truncate it to December 2020 before the normalizer could run.
- In the Expo Go dev shell on Android, a second Affirm run in one session can end silently: Android re-delivers the previous run's return link and the app refuses any replayed approval rather than risk a wrong charge. `RUN.md` covers the one-line reset. A production build returns on the app's own scheme and does not have this class of problem.

## 6. With more time

- Real SDK adapters behind the existing stub interfaces (PassKit, Google Pay, Affirm), with the same capability and sheet semantics.
- Server-minted order ids returned at order creation, Stripe style, instead of client-minted ids with client-side restoration.
- Recovering an Affirm approval that lands while the app is dead on Android (cold-start deep link), by persisting the attempt nonce and reading the launch URL. Today that approval is safely lost: the fan is told, truthfully, that nothing was charged, and retries.
- A shorter timeout for reconcile status polls. On a dead network each GET currently burns the full 10 second request timeout, so Android can take close to a minute to reach the "still confirming" banner; a status poll deserves its own budget of a few seconds.
- An error boundary around the checkout, plus try/catch on the restore and foreground effects, so a storage failure could never strand the UI in a busy state.
- An end-to-end suite (Maestro) for the lifecycle rows that are currently a documented manual matrix run on both platforms.
- Screen reader announcements for the decline and stalled transitions: `accessibilityLiveRegion` is Android only, so iOS VoiceOver stays silent on those banners today. Plus Dynamic Type and contrast checks.
- Saved payment methods, receipts and promo codes, which were out of scope by design.
