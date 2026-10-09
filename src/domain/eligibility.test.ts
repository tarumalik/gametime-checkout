import { getEligibility, isAffirmEligible, type EligibilityInput } from './eligibility';

const base: EligibilityInput = {
  platform: 'ios',
  applePay: 'unavailable',
  googlePay: 'unavailable',
  totalCents: 5000,
};

test('card is always offered, even when nothing else is', () => {
  expect(getEligibility(base).methods).toEqual(['card']);
});

test('Apple Pay only on iOS with a provisioned card', () => {
  expect(getEligibility({ ...base, applePay: 'available' }).methods).toContain('apple_pay');
  expect(getEligibility({ ...base, platform: 'android', applePay: 'available' }).methods).not.toContain('apple_pay');
  expect(getEligibility({ ...base, applePay: 'unavailable' }).methods).not.toContain('apple_pay');
});

test('Google Pay only on Android when set up', () => {
  expect(getEligibility({ ...base, platform: 'android', googlePay: 'available' }).methods).toContain('google_pay');
  expect(getEligibility({ ...base, platform: 'ios', googlePay: 'available' }).methods).not.toContain('google_pay');
});

test('a wallet still being checked is pending, not shown', () => {
  const result = getEligibility({ ...base, applePay: 'checking' });
  expect(result.methods).not.toContain('apple_pay');
  expect(result.pending).toEqual(['apple_pay']);
});

test('a wallet check on the WRONG platform is ignored, not pending', () => {
  const result = getEligibility({ ...base, platform: 'android', applePay: 'checking' });
  expect(result.pending).toEqual([]);
});

test.each([
  [9999, false],
  [10000, false], // exactly $100.00 is NOT over $100
  [10001, true],
  [45000, true],
])('Affirm eligibility at %i cents is %s', (cents, expected) => {
  expect(isAffirmEligible(cents)).toBe(expected);
  expect(getEligibility({ ...base, totalCents: cents }).methods.includes('affirm')).toBe(expected);
});

test('a non-integer total never qualifies for Affirm', () => {
  expect(isAffirmEligible(10000.5)).toBe(false);
});
