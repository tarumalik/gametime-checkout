// The four visibility rules as one pure, testable function:
//   Apple Pay: iOS only, and only if a card is provisioned in Wallet.
//   Google Pay: Android only, and only if Google Pay is set up.
//   Affirm: only when the purchase total is over $100.
//   Credit card: always available, the fallback for everyone.

export type PaymentMethod = 'apple_pay' | 'google_pay' | 'affirm' | 'card';
export type ExpressMethod = Exclude<PaymentMethod, 'card'>;
export type WalletMethod = 'apple_pay' | 'google_pay';
export type DevicePlatform = 'ios' | 'android';

// Wallet checks are async device calls, so a boolean is not enough. While a
// check is running the only true answer is "we don't know yet": the UI shows
// a placeholder for 'checking', a button only for 'available'.
export type Capability = 'checking' | 'available' | 'unavailable';

/** Affirm only when the total is OVER $100. Exactly $100.00 does not qualify. */
export const AFFIRM_MIN_EXCLUSIVE_CENTS = 10_000;

export type EligibilityInput = {
  platform: DevicePlatform;
  applePay: Capability;   // device check result, only meaningful on iOS
  googlePay: Capability;  // device check result, only meaningful on Android
  totalCents: number;
};

export type Eligibility = {
  methods: PaymentMethod[]; // show these as tappable buttons
  pending: WalletMethod[];  // still checking: show a placeholder, never a button
};

export function isAffirmEligible(totalCents: number): boolean {
  return Number.isInteger(totalCents) && totalCents > AFFIRM_MIN_EXCLUSIVE_CENTS;
}

export function getEligibility({ platform, applePay, googlePay, totalCents }: EligibilityInput): Eligibility {
  const methods: PaymentMethod[] = [];
  const pending: WalletMethod[] = [];

  const wallet = (method: WalletMethod, requiredPlatform: DevicePlatform, capability: Capability) => {
    if (platform !== requiredPlatform) return; // Apple Pay never on Android, and vice versa
    if (capability === 'available') methods.push(method);
    else if (capability === 'checking') pending.push(method);
  };

  wallet('apple_pay', 'ios', applePay);
  wallet('google_pay', 'android', googlePay);
  if (isAffirmEligible(totalCents)) methods.push('affirm');
  methods.push('card'); // always available: the universal fallback

  return { methods, pending };
}
