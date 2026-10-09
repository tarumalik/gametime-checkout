import type { PaymentMethod } from '../domain/eligibility';

// The contract is the agreed shape of every request and response. The server
// enforces it in server/app.js; the types below write the same rules down on
// the app's side, so if the two ever drift apart, tests catch it.

export type PaymentStatus = 'processing' | 'succeeded' | 'declined';

/** What the server knows about one payment attempt, keyed by idempotency key. */
export type PaymentRecord = {
  paymentId: string;
  idempotencyKey: string;
  orderId: string;
  amountCents: number;
  method: PaymentMethod;
  status: PaymentStatus;
  code?: string;        // e.g. card_declined
  declineCode?: string; // e.g. generic_decline, insufficient_funds
  message?: string;
};

export type CreatePaymentRequest = {
  orderId: string;
  amountCents: number;
  currency: 'USD';
  method: PaymentMethod;
  paymentToken: string;
};

/**
 * The one distinction the whole recovery story hangs on:
 * rejected = the server said no. Definitely not charged.
 * unknown_outcome = timeout, network drop or 5xx. MAYBE charged: never show
 * "declined", never blindly retry; reconcile with a GET first.
 */
export type ApiFailure =
  // payment: on 409 order_already_paid the server attaches the payment that
  // won, so the client can surface that success instead of a dead end.
  | { kind: 'rejected'; httpStatus: number; code: string; message: string; payment?: PaymentRecord }
  | { kind: 'unknown_outcome'; reason: 'timeout' | 'network' | 'server_error' };

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiFailure };

export interface PaymentsApi {
  createPayment(req: CreatePaymentRequest, idempotencyKey: string): Promise<ApiResult<PaymentRecord>>;
  /** null = the server never received this attempt. */
  getPayment(idempotencyKey: string): Promise<ApiResult<PaymentRecord | null>>;
  createAffirmCheckout(req: {
    orderId: string;
    amountCents: number;
    redirectUri: string;
  }): Promise<ApiResult<{ checkoutId: string; redirectUrl: string }>>;
}

/** The minimal slice of fetch we use, so tests can hand in a fake. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

type Options = {
  baseUrl: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  extraHeaders?: () => Record<string, string>; // the dev menu's mock headers ride along here
};

export function createPaymentsApi({
  baseUrl,
  fetchImpl = fetch as unknown as FetchLike,
  timeoutMs = 10_000,
  extraHeaders = () => ({}),
}: Options): PaymentsApi {
  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    // A request that never answers is worse than one that fails: the fan would
    // stare at a spinner forever. Ten seconds, then we abort and reconcile.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs); // Enforces 10-sec timer
    try {
      const res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...extraHeaders(), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        // empty or non-JSON body; the status code still tells the story
      }
      return { ok: true as const, status: res.status, json };
    } catch {
      const reason = controller.signal.aborted ? ('timeout' as const) : ('network' as const);
      return { ok: false as const, error: { kind: 'unknown_outcome' as const, reason } };
    } finally {
      clearTimeout(timer);
    }
  }

  function failure(status: number, json: unknown): { ok: false; error: ApiFailure } {
    // 5xx means the server broke mid-thought: maybe charged. Anything else the
    // server said "no" to on purpose: definitely not charged.
    if (status >= 500) return { ok: false, error: { kind: 'unknown_outcome', reason: 'server_error' } };
    const body = json as { error?: { code?: string; message?: string }; payment?: PaymentRecord } | null;
    return {
      ok: false,
      error: {
        kind: 'rejected',
        httpStatus: status,
        code: body?.error?.code ?? 'unknown',
        message: body?.error?.message ?? 'Request was rejected.',
        ...(body?.payment ? { payment: body.payment } : {}),
      },
    };
  }

  return {
    async createPayment(req, idempotencyKey) {
      const r = await call('POST', '/v1/payments', req, { 'Idempotency-Key': idempotencyKey });
      if (!r.ok) return r;
      // 402 declined is a RESULT the fan acts on, not a transport error.
      if (r.status === 200 || r.status === 202 || r.status === 402) {
        return { ok: true, value: r.json as PaymentRecord };
      }
      return failure(r.status, r.json);
    },
    async getPayment(idempotencyKey) {
      const r = await call('GET', `/v1/payments/${encodeURIComponent(idempotencyKey)}`);
      if (!r.ok) return r;
      if (r.status === 404) return { ok: true, value: null }; // never received = never charged
      if (r.status === 200) return { ok: true, value: r.json as PaymentRecord };
      return failure(r.status, r.json);
    },
    async createAffirmCheckout(req) {
      const r = await call('POST', '/v1/affirm/checkouts', req);
      if (!r.ok) return r;
      if (r.status === 201) return { ok: true, value: r.json as { checkoutId: string; redirectUrl: string } };
      return failure(r.status, r.json);
    },
  };
}
