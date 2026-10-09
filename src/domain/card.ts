// Every rule the Pay button enforces (formatting, card-type detection, Luhn,
// expiry-in-the-future, CVC length) is computed here; the UI only decides
// when to show the messages.

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'discover' | 'unknown';

// A field has four states, not two. 'incomplete' while typing is not an
// error yet; it only becomes one if the fan leaves the field that way.
export type FieldStatus = 'empty' | 'incomplete' | 'invalid' | 'valid';
export type FieldCheck = { status: FieldStatus; message?: string };
export type CardInput = { number: string; expiry: string; cvc: string };

type BrandRule = { length: number; cvcLength: number; gaps: number[] };

// Lengths, security-code sizes and display gaps per brand. Amex is the odd one:
// 15 digits grouped 4-6-5 (3782 822463 10005) with a 4-digit code on the front.
const RULES: Record<CardBrand, BrandRule> = {
  visa: { length: 16, cvcLength: 3, gaps: [4, 8, 12] },
  mastercard: { length: 16, cvcLength: 3, gaps: [4, 8, 12] },
  amex: { length: 15, cvcLength: 4, gaps: [4, 10] },
  discover: { length: 16, cvcLength: 3, gaps: [4, 8, 12] },
  unknown: { length: 16, cvcLength: 3, gaps: [4, 8, 12] },
};

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Brand from the leading digits (IIN ranges): Visa 4, Amex 34/37,
 * Mastercard 51-55 plus the 2-series 2221-2720, Discover 6011/65/644-649.
 */
export function detectBrand(input: string): CardBrand {
  const d = digitsOnly(input);
  if (d.startsWith('4')) return 'visa';
  if (/^3[47]/.test(d)) return 'amex';
  if (/^5[1-5]/.test(d)) return 'mastercard';
  if (d.length >= 4) {
    const prefix = Number(d.slice(0, 4));
    if (prefix >= 2221 && prefix <= 2720) return 'mastercard';
  }
  if (/^(6011|65|64[4-9])/.test(d)) return 'discover';
  return 'unknown';
}

/**
 * Luhn checksum: every real card number is built so this passes, which catches
 * typos before any network call. Example: 4242...4242 sums to 80 (passes);
 * change the last digit to 1 and the sum is 79 (caught instantly).
 */
export function passesLuhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

export function cvcLengthFor(cardNumber: string): number {
  return RULES[detectBrand(cardNumber)].cvcLength;
}

/**
 * Accepts anything typed, pasted or autofilled and returns the display string.
 * Driven by the VALUE, not key events: autofill can replace the whole field in
 * one change, with no focus or blur around it.
 */
export function formatCardNumber(input: string): string {
  const { length, gaps } = RULES[detectBrand(input)];
  const d = digitsOnly(input).slice(0, length);
  let out = '';
  for (let i = 0; i < d.length; i++) {
    if (gaps.includes(i)) out += ' ';
    out += d[i];
  }
  return out;
}

export function validateCardNumber(input: string): FieldCheck & { brand: CardBrand } {
  const d = digitsOnly(input);
  const brand = detectBrand(d);
  if (d.length === 0) return { brand, status: 'empty' };
  if (brand === 'unknown') {
    // Every brand we accept is identifiable within 4 digits, so at 4 digits an
    // unknown prefix is a real answer, not a maybe.
    return d.length >= 4
      ? { brand, status: 'invalid', message: 'We accept Visa, Mastercard, American Express and Discover' }
      : { brand, status: 'incomplete', message: 'Card number is incomplete' };
  }
  const { length } = RULES[brand];
  if (d.length < length) return { brand, status: 'incomplete', message: 'Card number is incomplete' };
  if (d.length > length) return { brand, status: 'invalid', message: 'Card number is too long' };
  if (!passesLuhn(d)) return { brand, status: 'invalid', message: "That card number isn't valid" };
  return { brand, status: 'valid' };
}

/**
 * "4" becomes "04" (no month starts with 4); the slash appears only once a
 * third digit exists. Adding it at 2 digits would fight the backspace key:
 * deleting "12/" would yield "12", which would instantly reformat to "12/".
 * Autofill can hand us MM/YYYY, so that shape is normalized to MM/YY.
 */
export function formatExpiry(input: string): string {
  const full = input.match(/^\s*(\d{1,2})\s*\/\s*(\d{4})\s*$/);
  let d = full ? full[1].padStart(2, '0') + full[2].slice(2) : digitsOnly(input).slice(0, 4);
  if (d.length === 1 && Number(d) > 1) d = `0${d}`;
  return d.length <= 2 ? d : `${d.slice(0, 2)}/${d.slice(2)}`;
}

/** A card stays valid through the LAST day of its expiry month. */
export function validateExpiry(input: string, now: Date): FieldCheck {
  const d = digitsOnly(input);
  if (d.length === 0) return { status: 'empty' };
  if (d.length >= 2) {
    const month = Number(d.slice(0, 2));
    if (month < 1 || month > 12) return { status: 'invalid', message: 'Enter a valid month (01-12)' };
  }
  if (d.length < 4) return { status: 'incomplete', message: 'Expiry date is incomplete' };
  if (d.length > 4) return { status: 'invalid', message: 'Use MM/YY' };

  const month = Number(d.slice(0, 2));
  const year = 2000 + Number(d.slice(2, 4));
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth() + 1; // getMonth() is 0-based
  if (year < nowYear || (year === nowYear && month < nowMonth)) {
    return { status: 'invalid', message: 'This card has expired' };
  }
  if (year > nowYear + 20) return { status: 'invalid', message: 'Check the expiry year' };
  return { status: 'valid' };
}

export function formatCvc(input: string, cardNumber: string): string {
  return digitsOnly(input).slice(0, cvcLengthFor(cardNumber));
}

export function validateCvc(input: string, cardNumber: string): FieldCheck {
  const required = cvcLengthFor(cardNumber);
  const d = digitsOnly(input);
  if (d.length === 0) return { status: 'empty' };
  if (d.length < required) return { status: 'incomplete', message: `Security code must be ${required} digits` };
  if (d.length > required) return { status: 'invalid', message: `Security code must be ${required} digits` };
  return { status: 'valid' };
}

// Why now comes in as a parameter: tests stay deterministic. An "expired card"
// test hard-wired to new Date() would start failing next year on its own.
export function validateCard(card: CardInput, now: Date) {
  const number = validateCardNumber(card.number);
  const expiry = validateExpiry(card.expiry, now);
  const cvc = validateCvc(card.cvc, card.number);
  return {
    brand: number.brand,
    number,
    expiry,
    cvc,
    isValid: number.status === 'valid' && expiry.status === 'valid' && cvc.status === 'valid',
  };
}
